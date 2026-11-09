import type { Spec } from "./schema";

/** Deterministic refinement chips (docs/06-ai-matching.md §3): they change the spec, never call the model. */
export const REFINEMENTS = ["lighter", "heavier", "cheaper", "more_stretch", "softer", "natural", "other_colors"] as const;
export type Refinement = (typeof REFINEMENTS)[number];

export interface RefineContext {
  /** Median weight and price of the results currently shown (used when the spec has no range / budget yet). */
  medianGsm: number | null;
  medianPrice: number | null;
  currentColorIds: string[];
}

const NATURAL = ["cotton", "linen", "wool", "silk", "viscose", "modal"] as const;
const STRETCH_ORDER = ["none", "mechanical", "two_way", "four_way"] as const;
const round = (n: number) => Math.round(n);

export function applyRefinement(spec: Spec, key: Refinement, ctx: RefineContext): { spec: Spec; excludeColorIds: string[] } {
  const next: Spec = structuredClone(spec);
  let excludeColorIds: string[] = [];
  switch (key) {
    case "lighter":
    case "heavier": {
      const factor = key === "lighter" ? 0.8 : 1.2;
      const centre = next.gsm_min !== null || next.gsm_max !== null ? null : ctx.medianGsm;
      if (centre !== null) {
        next.gsm_min = round(centre * factor * 0.9);
        next.gsm_max = round(centre * factor * 1.1);
      } else {
        if (next.gsm_min !== null) next.gsm_min = round(next.gsm_min * factor);
        if (next.gsm_max !== null) next.gsm_max = round(next.gsm_max * factor);
      }
      break;
    }
    case "cheaper": {
      const base = ctx.medianPrice ?? next.budget_max_per_m;
      if (base !== null) next.budget_max_per_m = Math.round(base * 0.8 * 100) / 100;
      break;
    }
    case "more_stretch": {
      const i = next.stretch ? STRETCH_ORDER.indexOf(next.stretch) : 0;
      next.stretch = STRETCH_ORDER[Math.min(i + 1, STRETCH_ORDER.length - 1)]!;
      break;
    }
    case "softer":
      next.feel = { ...next.feel, softness: Math.min(10, Math.max(next.feel.softness ?? 0, 7) + 1) };
      break;
    case "natural":
      next.fibers_preferred = [...NATURAL];
      next.fibers_avoid = [...new Set([...next.fibers_avoid, "polyester" as const])];
      break;
    case "other_colors":
      excludeColorIds = ctx.currentColorIds;
      break;
  }
  return { spec: next, excludeColorIds };
}

export function applyRefinements(spec: Spec, keys: Refinement[], ctx: RefineContext): { spec: Spec; excludeColorIds: string[] } {
  let current = spec;
  let exclude: string[] = [];
  for (const key of keys) {
    const r = applyRefinement(current, key, ctx);
    current = r.spec;
    exclude = [...exclude, ...r.excludeColorIds];
  }
  return { spec: current, excludeColorIds: [...new Set(exclude)] };
}

export const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
