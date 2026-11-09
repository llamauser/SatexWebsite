import { createHash, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { llmCostUsd } from "@/lib/ai/cost";
import { embedText } from "@/lib/ai/embed";
import { createServerSupabase } from "@/lib/db/server";
import { createServiceSupabase } from "@/lib/db/service";
import { supabaseEnv } from "@/lib/db/env";
import { toResultCard } from "@/lib/match/card";
import { templateExplanation } from "@/lib/match/explain";
import { explainResults, type Locale } from "@/lib/match/llm";
import { retrieveAndRank } from "@/lib/match/pipeline";
import { SNAP_WEIGHTS } from "@/lib/match/score";
import { candidateFetcher, createSession, saveIteration, updateIteration } from "@/lib/match/service";
import { analyzePhoto } from "@/lib/snap/analyze";
import { dataUrlBytes, prepareImage } from "@/lib/snap/image";
import { describeVisual, specFromVisual } from "@/lib/snap/spec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const BodySchema = z.object({
  image: z.string().max(12_000_000),
  locale: z.enum(["fr", "en", "ar"]),
  season: z.enum(["spring_summer", "autumn_winter", "all_season"]).nullable().default(null),
  stretch: z.enum(["none", "some", "a_lot"]).nullable().default(null),
});

const TOKEN_COOKIE = "satex_match";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function currentUserId(): Promise<string | null> {
  if (!supabaseEnv()) return null;
  try {
    const { data } = await (await createServerSupabase()).auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Snap & Match (docs/08b-phase2-4-features.md §A): a photo in, the matching in-stock fabrics out, as the same NDJSON stream and
 * the same results page as the wizard. The photo is checked and cleaned (sharp), read by the vision model, and kept 30 days.
 */
export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_request" });
  const { locale, season, stretch } = parsed.data;
  const bytes = dataUrlBytes(parsed.data.image);
  if (!bytes) return json(415, { error: "unsupported_image" });

  let sb;
  try {
    sb = createServiceSupabase();
  } catch {
    return json(503, { error: "unavailable" });
  }

  const jar = await cookies();
  const userId = await currentUserId();
  const token = jar.get(TOKEN_COOKIE)?.value ?? randomUUID();
  const owner = { userId, token };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipHash = createHash("sha256").update(`${process.env.IP_HASH_SALT ?? "satex"}:${ip}`).digest("hex").slice(0, 32);
  const { data: limitRows } = await sb.from("app_settings").select("key, value").in("key", ["match_rate_limit_per_hour_guest", "match_rate_limit_per_hour_user"]);
  const limit = (key: string, fallback: number) => Number(limitRows?.find((r: { key: string }) => r.key === key)?.value ?? fallback);
  const allowed = userId
    ? await sb.rpc("hit_rate_limit", { p_key: `snap:u:${userId}`, p_limit: limit("match_rate_limit_per_hour_user", 30), p_window_seconds: 3600 })
    : await sb.rpc("hit_rate_limit", { p_key: `snap:g:${ipHash}`, p_limit: limit("match_rate_limit_per_hour_guest", 10), p_window_seconds: 3600 });
  if (allowed.data === false) return json(429, { error: "rate_limited" });

  let image;
  try {
    image = await prepareImage(bytes); // anything that is not a real, reasonably sized image stops here
  } catch {
    return json(415, { error: "unsupported_image" });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const started = Date.now();
      try {
        send({ type: "progress", stage: "understanding" });
        const vision = await analyzePhoto(image.forModel, image.colors);
        if (!vision.visual.is_textile) {
          send({ type: "error", code: "not_textile" });
          return;
        }
        const spec = specFromVisual(vision.visual, image.colors, { season, stretch });

        send({ type: "progress", stage: "searching" });
        let embedding: number[] | null = null;
        try {
          embedding = (await embedText(spec.query_text || "fabric")).vector;
        } catch {
          embedding = null;
        }
        const outcome = await retrieveAndRank(spec, candidateFetcher(sb, embedding), { weights: SNAP_WEIGHTS });
        send({ type: "progress", stage: "ranking", scanned: outcome.scanned });

        const input = { audience: null, audienceText: "", styles: [], brand: [], priceTarget: null, description: describeVisual(vision.visual, image.colors), requiredM: null };
        const id = await createSession(sb, owner, locale, input, "snap");
        const path = `${id}.webp`;
        const stored = await sb.storage.from("snap-uploads").upload(path, image.stored, { contentType: "image/webp", upsert: true });
        await sb.from("match_sessions").update({ specs: spec, input: { ...input, snapPath: stored.error ? null : path, snapSource: vision.source } }).eq("id", id);

        const cards = outcome.results.map((r) => toResultCard(r, templateExplanation(r, spec, locale as Locale)));
        const iterationId = await saveIteration(sb, id, {
          n: 1, refinements: [], specs: spec, results: cards, latency_ms: Date.now() - started,
          llm_input_tokens: vision.usage.inputTokens, llm_output_tokens: vision.usage.outputTokens, cost_usd: llmCostUsd(vision.usage),
        });
        send({ type: "results", sessionId: id, iteration: 1, results: cards, relaxed: outcome.relaxed });

        send({ type: "progress", stage: "explaining" });
        const explained = await explainResults(outcome.results, spec, locale as Locale);
        if (explained) {
          const withText = cards.map((c) => ({ ...c, explanation: explained.texts[c.colorId] ?? c.explanation }));
          const usage = { inputTokens: vision.usage.inputTokens + explained.usage.inputTokens, outputTokens: vision.usage.outputTokens + explained.usage.outputTokens };
          await updateIteration(sb, iterationId, { results: withText, latency_ms: Date.now() - started, llm_input_tokens: usage.inputTokens, llm_output_tokens: usage.outputTokens, cost_usd: llmCostUsd(usage) });
          send({ type: "explanations", items: withText.map((c) => ({ colorId: c.colorId, text: c.explanation })) });
        }
        send({ type: "done", sessionId: id, iteration: 1 });
      } catch (error) {
        console.error(JSON.stringify({ event: "snap.error", error: error instanceof Error ? error.message : String(error) }));
        send({ type: "error", code: "server" });
      } finally {
        controller.close();
      }
    },
  });

  const response = new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
  if (!jar.get(TOKEN_COOKIE)) {
    response.headers.append("set-cookie", `${TOKEN_COOKIE}=${token}; Path=/; Max-Age=${60 * 60 * 24 * 90}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  }
  return response;
}
