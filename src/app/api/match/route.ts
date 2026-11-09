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
import { explainResults, extractSpec, type Locale } from "@/lib/match/llm";
import { retrieveAndRank } from "@/lib/match/pipeline";
import { applyRefinements, median, REFINEMENTS, type Refinement } from "@/lib/match/refine";
import { WizardInputSchema, type Spec } from "@/lib/match/schema";
import { candidateFetcher, createSession, isOwner, loadSession, saveIteration, updateIteration } from "@/lib/match/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  input: WizardInputSchema,
  locale: z.enum(["fr", "en", "ar"]),
  sessionId: z.uuid().optional(),
  refinements: z.array(z.enum(REFINEMENTS)).max(7).default([]),
});

const TOKEN_COOKIE = "satex_match";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function currentUserId(): Promise<string | null> {
  if (!supabaseEnv()) return null;
  try {
    const sb = await createServerSupabase();
    const { data } = await sb.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Streams the matching as NDJSON events: progress, results, explanations, done (docs/06-ai-matching.md §2). */
export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_request", issues: parsed.error.issues.map((i) => i.message) });
  const { input, locale, sessionId, refinements } = parsed.data;

  let sb;
  try {
    sb = createServiceSupabase();
  } catch {
    return json(503, { error: "unavailable" });
  }

  // who is asking: a signed-in user, or an anonymous visitor identified by an httpOnly cookie
  const jar = await cookies();
  const userId = await currentUserId();
  const token = jar.get(TOKEN_COOKIE)?.value ?? randomUUID();
  const owner = { userId, token };

  // rate limit (settings: match_rate_limit_per_hour_guest / _user)
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipHash = createHash("sha256").update(`${process.env.IP_HASH_SALT ?? "satex"}:${ip}`).digest("hex").slice(0, 32);
  const { data: limitRows } = await sb.from("app_settings").select("key, value").in("key", ["match_rate_limit_per_hour_guest", "match_rate_limit_per_hour_user"]);
  const limit = (key: string, fallback: number) => Number(limitRows?.find((r: { key: string }) => r.key === key)?.value ?? fallback);
  const allowed = userId
    ? await sb.rpc("hit_rate_limit", { p_key: `match:u:${userId}`, p_limit: limit("match_rate_limit_per_hour_user", 30), p_window_seconds: 3600 })
    : await sb.rpc("hit_rate_limit", { p_key: `match:g:${ipHash}`, p_limit: limit("match_rate_limit_per_hour_guest", 10), p_window_seconds: 3600 });
  if (allowed.data === false) return json(429, { error: "rate_limited" });

  // a refinement continues an existing session (owner only)
  let previous = null as Awaited<ReturnType<typeof loadSession>>;
  if (sessionId) {
    previous = await loadSession(sb, sessionId);
    if (!previous) return json(404, { error: "not_found" });
    if (!isOwner(previous, owner)) return json(403, { error: "forbidden" });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const started = Date.now();
      try {
        send({ type: "progress", stage: "understanding" });
        let baseSpec: Spec;
        let usage = { inputTokens: 0, outputTokens: 0 };
        if (previous) {
          baseSpec = previous.iterations[0]?.specs as Spec; // refinements are always applied to the original reading of the brief
        } else {
          const extracted = await extractSpec(input);
          baseSpec = extracted.spec;
          usage = extracted.usage;
        }

        const last = previous?.iterations.at(-1);
        const shown = last?.results ?? [];
        const refined = applyRefinements(baseSpec, refinements as Refinement[], {
          medianGsm: median(shown.map((r) => r.gsm)),
          medianPrice: median(shown.flatMap((r) => (r.price === null ? [] : [r.price]))),
          currentColorIds: shown.map((r) => r.colorId),
        });
        const spec = refined.spec;

        send({ type: "progress", stage: "searching" });
        let embedding: number[] | null = null;
        try {
          embedding = (await embedText(spec.query_text || input.description)).vector;
        } catch {
          embedding = null; // embeddings not configured or down: the semantic part is simply left out
        }
        const outcome = await retrieveAndRank(spec, candidateFetcher(sb, embedding), { requiredM: input.requiredM ?? 0, excludeColorIds: refined.excludeColorIds });
        send({ type: "progress", stage: "ranking", scanned: outcome.scanned });

        const id = previous?.id ?? (await createSession(sb, owner, locale, input));
        const n = (previous?.iterations.length ?? 0) + 1;
        const cards = outcome.results.map((r) => toResultCard(r, templateExplanation(r, spec, locale as Locale)));
        const iterationId = await saveIteration(sb, id, {
          n, refinements, specs: spec, results: cards, latency_ms: Date.now() - started,
          llm_input_tokens: usage.inputTokens, llm_output_tokens: usage.outputTokens, cost_usd: llmCostUsd(usage),
        });
        if (!previous) await sb.from("match_sessions").update({ specs: baseSpec }).eq("id", id);
        send({ type: "results", sessionId: id, iteration: n, results: cards, relaxed: outcome.relaxed });

        send({ type: "progress", stage: "explaining" });
        const explained = await explainResults(outcome.results, spec, locale as Locale);
        if (explained) {
          const withText = cards.map((c) => ({ ...c, explanation: explained.texts[c.colorId] ?? c.explanation }));
          const totalUsage = { inputTokens: usage.inputTokens + explained.usage.inputTokens, outputTokens: usage.outputTokens + explained.usage.outputTokens };
          await updateIteration(sb, iterationId, {
            results: withText, latency_ms: Date.now() - started, llm_input_tokens: totalUsage.inputTokens, llm_output_tokens: totalUsage.outputTokens, cost_usd: llmCostUsd(totalUsage),
          });
          send({ type: "explanations", items: withText.map((c) => ({ colorId: c.colorId, text: c.explanation })) });
        }
        send({ type: "done", sessionId: id, iteration: n });
      } catch (error) {
        console.error(JSON.stringify({ event: "match.error", error: error instanceof Error ? error.message : String(error) }));
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
