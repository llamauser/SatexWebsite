import { deltaE00, hexToLab, type Lab } from "@/lib/color/lab";
import type { Candidate, Components, ScoredCandidate, Spec } from "./schema";

/** Weights of the match score (docs/06-ai-matching.md §2 C). Tune here, in one place. */
export const WEIGHTS = {
  semantic: 0.25,
  gsm: 0.2,
  fiber: 0.15,
  stretch: 0.1,
  use_season: 0.1,
  structure: 0.08,
  feel: 0.07,
  color: 0.05,
} as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const STRETCH_ORDER = ["none", "mechanical", "two_way", "four_way"];

export function semanticScore(sim: number): number {
  return clamp01((sim - 0.2) / 0.6);
}

export function gsmScore(spec: Spec, gsm: number): number | null {
  const { gsm_min: min, gsm_max: max } = spec;
  if (min === null && max === null) return null;
  // "light" gives only a maximum and "heavy" only a minimum: the other side is open
  const lo = min ?? 0;
  const hi = max ?? Number.POSITIVE_INFINITY;
  if (gsm >= lo && gsm <= hi) return 1;
  const mid = min !== null && max !== null ? (min + max) / 2 : (min ?? max)!;
  const dist = gsm < lo ? lo - gsm : gsm - hi;
  return clamp01(1 - dist / (0.5 * mid));
}

export function fiberScore(spec: Spec, composition: { fiber: string; pct: number }[]): number | null {
  if (spec.fibers_preferred.length === 0) return null;
  const preferred = new Set<string>(spec.fibers_preferred);
  const share = composition.filter((c) => preferred.has(c.fiber)).reduce((s, c) => s + c.pct, 0) / 100;
  const top = [...composition].sort((a, b) => b.pct - a.pct)[0];
  return clamp01(share + (top && preferred.has(top.fiber) ? 0.2 : 0));
}

export function stretchScore(spec: Spec, stretch: string): number | null {
  if (!spec.stretch) return null;
  const diff = STRETCH_ORDER.indexOf(stretch) - STRETCH_ORDER.indexOf(spec.stretch);
  return diff >= 0 ? 1 : diff === -1 ? 0.4 : 0;
}

export function usageSeasonScore(spec: Spec, uses: string[], seasons: string[]): number | null {
  const wUse = spec.uses.length ? 0.6 : 0;
  const wSeason = spec.seasons.length ? 0.4 : 0;
  if (wUse + wSeason === 0) return null;
  const useHit = spec.uses.some((u) => uses.includes(u)) ? 1 : 0;
  const seasonHit = seasons.includes("all_season") || spec.seasons.some((s) => seasons.includes(s)) ? 1 : 0;
  return (wUse * useHit + wSeason * seasonHit) / (wUse + wSeason);
}

export function structureScore(spec: Spec, structure: string): number | null {
  if (spec.structures.length === 0) return null;
  return spec.structures.includes(structure as never) ? 1 : 0;
}

export function feelScore(spec: Spec, feel: Candidate["feel"]): number | null {
  const targets = Object.entries(spec.feel).filter(([, v]) => typeof v === "number") as [string, number][];
  if (targets.length === 0) return null;
  if (!feel) return 0.5;
  const diffs = targets.map(([k, target]) => {
    const actual = (feel as Record<string, number | null | undefined>)[k];
    return typeof actual === "number" ? Math.abs(target - actual) : 5;
  });
  return clamp01(1 - diffs.reduce((a, b) => a + b, 0) / diffs.length / 10);
}

export function colorScore(spec: Spec, lab: number[] | null, hex: string): number | null {
  if (spec.colors.length === 0) return null;
  const mine: Lab = lab && lab.length === 3 ? [lab[0]!, lab[1]!, lab[2]!] : hexToLab(hex);
  const best = Math.min(...spec.colors.map((c) => deltaE00(mine, hexToLab(c.hex))));
  return clamp01(1 - best / 40);
}

export function budgetMultiplier(spec: Spec, price: number | null): number {
  if (spec.budget_max_per_m === null || price === null || price <= spec.budget_max_per_m) return 1;
  return Math.max(0.6, 1 - (price - spec.budget_max_per_m) / spec.budget_max_per_m);
}

/** Score one in-stock color against the spec. Components without information in the spec are left out and their weight is shared by the rest. */
export function scoreCandidate(spec: Spec, c: Candidate): ScoredCandidate {
  const price = c.price === null ? null : Number(c.price);
  const components: Components = {
    semantic: semanticScore(c.text_sim),
    gsm: gsmScore(spec, c.gsm),
    fiber: fiberScore(spec, c.composition),
    stretch: stretchScore(spec, c.stretch),
    use_season: usageSeasonScore(spec, c.uses, c.seasons),
    structure: structureScore(spec, c.structure),
    feel: feelScore(spec, c.feel),
    color: colorScore(spec, c.lab, c.hex),
    budget: budgetMultiplier(spec, price),
  };
  let weight = 0;
  let sum = 0;
  for (const key of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) {
    const v = components[key];
    if (v === null) continue;
    weight += WEIGHTS[key];
    sum += WEIGHTS[key] * v;
  }
  const score = (weight > 0 ? sum / weight : 0) * components.budget;
  return { candidate: c, score, pct: Math.round(Math.min(score, 0.99) * 100), components };
}

/**
 * Best results with variety: at most 2 colors per fabric, different fabrics first. Returns up to `n` (default 5),
 * highest score first.
 */
export function pickTop(scored: ScoredCandidate[], n = 5, perFabric = 2): ScoredCandidate[] {
  const sorted = [...scored].sort((a, b) => b.score - a.score || a.candidate.sku.localeCompare(b.candidate.sku));
  const chosen: ScoredCandidate[] = [];
  const count = new Map<string, number>();
  const take = (limit: number) => {
    for (const s of sorted) {
      if (chosen.length >= n) return;
      if (chosen.includes(s)) continue;
      if ((count.get(s.candidate.fabric_id) ?? 0) >= limit) continue;
      chosen.push(s);
      count.set(s.candidate.fabric_id, (count.get(s.candidate.fabric_id) ?? 0) + 1);
    }
  };
  take(1); // one color per fabric first
  take(perFabric); // then a second color of a good fabric if there is room
  return chosen.sort((a, b) => b.score - a.score || a.candidate.sku.localeCompare(b.candidate.sku));
}
