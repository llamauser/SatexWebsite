export interface FeelComposition { fiber: string; pct: number }
export interface MeasuredFeel { drape_coefficient?: number; stretch_pct_warp?: number; stretch_pct_weft?: number }
export interface FeelInput {
  composition: FeelComposition[];
  gsm: number;
  structure: string;
  construction: string;
  stretch: string;
  stretchPct: number | null;
  finish: string[];
  measured?: MeasuredFeel | null;
  existing?: Partial<FeelScores> | null;
  isMeasured?: boolean;
}
export interface FeelScores { softness: number; drape: number; stretch: number; sheen: number; breathability: number }
export interface FeelProfile extends FeelScores { source: "estimated" | "measured" }

const FIBER: Record<string, readonly [number, number, number]> = {
  cotton: [7, 8, 2], linen: [4, 10, 3], wool: [6, 7, 2], silk: [9, 8, 9], viscose: [8, 8, 6],
  modal: [9, 8, 5], polyester: [5, 3, 5], nylon: [5, 3, 6], elastane: [6, 3, 4], acrylic: [6, 4, 3], other: [5, 5, 3],
};
const clamp = (value: number, min = 0, max = 10) => Math.max(min, Math.min(max, value));
const rounded = (value: number) => Math.round(clamp(value) * 2) / 2;
const has = (items: readonly string[], value: string) => items.some((item) => item.toLowerCase() === value);

export function scoreFromStretchPct(pct: number): number {
  const points: readonly [number, number][] = [[0, 0], [5, 2], [15, 5], [30, 7.5], [60, 10]];
  const x = clamp(Number.isFinite(pct) ? pct : 0, 0, 60);
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x0, y0] = points[i - 1]!;
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 10;
}

/** Derive the five customer-facing feel scores from the current fabric attributes. */
export function estimateFeel(input: FeelInput): FeelProfile {
  const parts = input.composition.filter((item) => Number.isFinite(item.pct) && item.pct > 0);
  const total = parts.reduce((sum, item) => sum + item.pct, 0);
  const normalized = total > 0 ? parts.map((item) => ({ ...item, share: item.pct / total })) : [{ fiber: "other", pct: 100, share: 1 }];
  const average = (axis: 0 | 1 | 2) => normalized.reduce((sum, item) => sum + item.share * (FIBER[item.fiber] ?? FIBER.other!)[axis], 0);
  const share = (fiber: string) => normalized.filter((item) => item.fiber === fiber).reduce((sum, item) => sum + item.share, 0);
  const finish = input.finish.map((value) => value.toLowerCase());
  const structure = input.structure.toLowerCase();
  const knit = input.construction.toLowerCase() === "knit";

  const softness = average(0)
    + (has(finish, "brushed") || has(finish, "peached") ? 1.5 : 0)
    + (has(finish, "mercerized") ? 0.5 : 0)
    - (["denim", "canvas"].includes(structure) ? 2 : 0)
    - (input.gsm > 300 ? 1 : 0);
  const breathability = average(1) - Math.max(0, (input.gsm - 150) / 50)
    + (structure === "mesh" ? 2 : 0)
    - (has(finish, "water_repellent") || has(finish, "coated") ? 1 : 0);
  const sheen = average(2)
    + (structure === "satin" ? 3 : 0)
    + (structure === "velvet" ? 2 : 0)
    + (has(finish, "mercerized") ? 1 : 0)
    - (["crepe", "denim", "canvas", "fleece"].includes(structure) ? 1 : 0);
  let drape = 10 - (input.gsm - 60) / 40
    + (knit ? 1 : 0)
    + (["chiffon", "crepe", "satin"].includes(structure) ? 1.5 : 0)
    + (structure === "jersey" ? 1 : 0)
    - (["denim", "canvas", "gabardine"].includes(structure) ? 2 : 0)
    - (structure === "felt" ? 3 : 0)
    + 2 * (share("viscose") + share("silk") + share("modal"))
    - share("linen");
  const measured = input.measured ?? {};
  if (typeof measured.drape_coefficient === "number") drape = 10 * (0.95 - clamp(measured.drape_coefficient, 0, 1)) / 0.65;

  const measuredStretch = [measured.stretch_pct_warp, measured.stretch_pct_weft].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const pct = measuredStretch.length ? Math.max(...measuredStretch) : input.stretchPct;
  const baseStretch = pct !== null
    ? scoreFromStretchPct(pct)
    : ({ none: 0, mechanical: 2, two_way: 6, four_way: 8.5 }[input.stretch] ?? 0);
  const stretch = baseStretch + 0.2 * share("elastane") * 100;

  const values: FeelScores = { softness: rounded(softness), drape: rounded(drape), stretch: rounded(stretch), sheen: rounded(sheen), breathability: rounded(breathability) };
  if (input.isMeasured) {
    for (const axis of Object.keys(values) as (keyof FeelScores)[]) {
      const existing = input.existing?.[axis];
      if (typeof existing === "number" && Number.isFinite(existing)) values[axis] = rounded(existing);
    }
  }
  return { ...values, source: input.isMeasured ? "measured" : "estimated" };
}
