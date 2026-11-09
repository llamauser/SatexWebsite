import { z } from "zod";
import { embedText } from "@/lib/ai/embed";
import { createServerSupabase } from "@/lib/db/server";
import { createServiceSupabase } from "@/lib/db/service";
import { candidateFetcher } from "@/lib/match/service";
import { retrieveAndRank } from "@/lib/match/pipeline";
import { SpecSchema, STYLES, type Spec } from "@/lib/match/schema";
import { calculateMeters } from "@/lib/planner/meterage";
import { paletteBonus, paletteCoherence, paletteDistance } from "@/lib/planner/palette";
import { planCollection } from "@/lib/planner/plan";
import { evenSizeRun, SIZES } from "@/lib/planner/garments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  collectionId: z.uuid().optional(),
  name: z.string().trim().min(1).max(120),
  season: z.enum(["spring_summer", "autumn_winter", "all_season"]).nullable().default(null),
  audienceText: z.string().trim().max(200).default(""),
  styles: z.array(z.enum(STYLES)).max(3).default([]),
  budgetPerM: z.number().positive().max(1000).nullable().default(null),
  description: z.string().trim().min(1).max(600),
  pieces: z.array(z.object({
    garmentType: z.string().regex(/^[a-z][a-z_]*$/),
    label: z.string().trim().max(120).default(""),
    quantity: z.number().int().min(1).max(100000),
    sizeRun: z.record(z.enum(SIZES), z.number().int().min(0)).optional(),
    notes: z.string().trim().max(500).default(""),
  }).superRefine((piece, ctx) => {
    if (piece.sizeRun && Object.values(piece.sizeRun).reduce((sum, quantity) => sum + quantity, 0) !== piece.quantity) {
      ctx.addIssue({ code: "custom", message: "size_run_must_equal_quantity", path: ["sizeRun"] });
    }
  })).min(1).max(12),
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

type RankedPlannerItem = {
  garment_type: string; label: string; quantity_units: number; size_run: Record<string, number>; notes: string; spec: Spec;
  chosen_color_id: string; meters_needed: number; sort: number;
  alternatives: { colorId: string; fabricId: string; slug: string; name: { fr?: string; en?: string; ar?: string }; colorName: { fr?: string; en?: string; ar?: string }; hex: string; widthCm: number; moqM: number; availableM: number; price: number | null; pct: number }[];
};

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_request", issues: parsed.error.issues });
  const auth = await (await createServerSupabase()).auth.getUser();
  if (!auth.data.user) return json(401, { error: "unauthorized" });
  const sb = createServiceSupabase();
  const { data: profile } = await sb.from("profiles").select("client_id, role").eq("id", auth.data.user.id).maybeSingle();
  if (!profile?.client_id || profile.role !== "client") return json(403, { error: "forbidden" });

  const { data: allowed, error: limitError } = await sb.rpc("hit_rate_limit", { p_key: `planner:${auth.data.user.id}`, p_limit: 10, p_window_seconds: 3600 });
  if (limitError || allowed === null) return json(503, { error: "rate_limit_unavailable" });
  if (allowed === false) return json(429, { error: "rate_limited" });

  const input = parsed.data;
  const { data: garments, error: garmentError } = await sb.from("garment_consumption").select("garment_type, base_m_per_unit, ref_width_cm, size_factors").in("garment_type", input.pieces.map((piece) => piece.garmentType));
  if (garmentError) return json(503, { error: "unavailable" });
  const garmentMap = new Map((garments ?? []).map((garment) => [garment.garment_type, garment]));
  if (input.pieces.some((piece) => !garmentMap.has(piece.garmentType))) return json(400, { error: "invalid_garment" });

  if (input.collectionId) {
    const { data: existing } = await sb.from("collections").select("id, status").eq("id", input.collectionId).eq("client_id", profile.client_id).maybeSingle();
    if (!existing) return json(404, { error: "not_found" });
    if (existing.status === "quoted") return json(409, { error: "already_quoted" });
  }

  const generated = await planCollection({ description: input.description, audienceText: input.audienceText, season: input.season, styles: input.styles, budgetPerM: input.budgetPerM }, input.pieces.map((piece, index) => ({ index, garmentType: piece.garmentType, label: piece.label, notes: piece.notes })));
  let ranked: RankedPlannerItem[];
  try {
  ranked = await Promise.all(input.pieces.map(async (piece, index) => {
    const planned = generated.plan.pieces.find((entry) => entry.index === index)!;
    const spec = SpecSchema.parse(planned.spec);
    let embedding: number[] | null = null;
    try { embedding = (await embedText(spec.query_text || input.description)).vector; } catch { /* semantic search is optional */ }
    const garment = garmentMap.get(piece.garmentType)!;
    const sizeRun = piece.sizeRun ?? evenSizeRun(piece.quantity);
    const estimatedRequired = calculateMeters(sizeRun, garment, garment.ref_width_cm, 0);
    let outcome = await retrieveAndRank(spec, candidateFetcher(sb, embedding), { requiredM: estimatedRequired, limit: 15 });
    if (!outcome.results.length && estimatedRequired > 0) outcome = await retrieveAndRank(spec, candidateFetcher(sb, embedding), { requiredM: 0, limit: 15 });
    const scored = outcome.results.map((result) => ({
      result,
      score: result.score + paletteBonus(result.candidate, generated.plan.palette),
      metersNeeded: calculateMeters(sizeRun, garment, result.candidate.width_cm, Number(result.candidate.moq_m)),
    }));
    scored.sort((a, b) => b.score - a.score);
    const inStock = scored.filter((item) => Number(item.result.candidate.available_m) >= item.metersNeeded);
    const pool = inStock.length ? inStock : scored;
    const chosen = pool.find((item) => paletteDistance(item.result.candidate.hex, generated.plan.palette) < 15) ?? pool[0];
    if (!chosen) throw new Error("no fabric candidates");
    const alternatives = [chosen, ...scored.filter((item) => item !== chosen)].slice(0, 3);
    return {
      garment_type: piece.garmentType,
      label: piece.label || piece.garmentType,
      quantity_units: piece.quantity,
      size_run: sizeRun,
      notes: piece.notes,
      spec,
      chosen_color_id: chosen.result.candidate.color_id,
      meters_needed: chosen.metersNeeded,
      sort: index,
      alternatives: alternatives.map(({ result }) => ({
        colorId: result.candidate.color_id, fabricId: result.candidate.fabric_id, slug: result.candidate.slug,
        name: result.candidate.name, colorName: result.candidate.color_name, hex: result.candidate.hex,
        widthCm: result.candidate.width_cm, moqM: Number(result.candidate.moq_m), availableM: Number(result.candidate.available_m),
        price: result.candidate.price === null ? null : Number(result.candidate.price), pct: result.pct,
      })),
    };
    }));
  } catch {
    return json(422, { error: "no_candidates" });
  }

  const brief = { audienceText: input.audienceText, styles: input.styles, budgetPerM: input.budgetPerM, description: input.description };
  let collectionId = input.collectionId;
  let previousItemIds: string[] = [];
  if (!collectionId) {
    const { data: collection, error } = await sb.from("collections").insert({
      client_id: profile.client_id, name: input.name, season: input.season, status: "draft", brief, palette: generated.plan.palette,
    }).select("id").single();
    if (error || !collection) return json(503, { error: "save_failed" });
    collectionId = collection.id;
  } else {
    // a collection that got its quote in the meantime is left alone; the old pieces stay until the new ones are saved
    const { data: updated, error } = await sb.from("collections")
      .update({ name: input.name, season: input.season, status: "draft", palette: generated.plan.palette, brief })
      .eq("id", collectionId).eq("client_id", profile.client_id).neq("status", "quoted").select("id");
    if (error) return json(503, { error: "save_failed" });
    if (!updated?.length) return json(409, { error: "already_quoted" });
    previousItemIds = ((await sb.from("collection_items").select("id").eq("collection_id", collectionId)).data ?? []).map((row) => row.id as string);
  }
  const { data: savedItems, error: itemError } = await sb.from("collection_items").insert(ranked.map((item) => ({ ...item, collection_id: collectionId }))).select("id, garment_type, label, quantity_units, size_run, notes, chosen_color_id, alternatives, meters_needed, sort");
  if (itemError || !savedItems) return json(503, { error: "save_failed" });
  if (previousItemIds.length) await sb.from("collection_items").delete().in("id", previousItemIds);
  const { error: statusError } = await sb.from("collections").update({ status: "planned" }).eq("id", collectionId).eq("client_id", profile.client_id).neq("status", "quoted");
  if (statusError) return json(503, { error: "save_failed" });
  const items = savedItems.map((saved) => ({
    ...saved,
    meters_needed: Number(saved.meters_needed),
    alternatives: saved.alternatives as typeof ranked[number]["alternatives"],
    chosen: (saved.alternatives as typeof ranked[number]["alternatives"]).find((alternative) => alternative.colorId === saved.chosen_color_id),
  }));
  const chosen = items.map((item) => item.chosen).filter((item): item is NonNullable<typeof item> => Boolean(item));
  return json(200, { collectionId, palette: generated.plan.palette, items, coherence: paletteCoherence(chosen.map((item) => ({ hex: item.hex, color_id: item.colorId, fabric_id: item.fabricId, available_m: item.availableM } as never)), generated.plan.palette, items.map((item) => item.meters_needed)) });
}
