import { describe, expect, it } from "vitest";
import { deltaE00, hexToLab } from "../../src/lib/color/lab";
import { fallbackSpec } from "../../src/lib/match/fallback";
import { retrieveAndRank, type FetchArgs } from "../../src/lib/match/pipeline";
import { applyRefinement, applyRefinements, median } from "../../src/lib/match/refine";
import { emptySpec, SpecSchema, WizardInputSchema, type Candidate, type Spec } from "../../src/lib/match/schema";
import {
  budgetMultiplier, colorScore, feelScore, fiberScore, gsmScore, pickTop, scoreCandidate, semanticScore, stretchScore, structureScore, usageSeasonScore, WEIGHTS,
} from "../../src/lib/match/score";

const spec = (patch: Partial<Spec> = {}): Spec => ({ ...emptySpec(), ...patch });
const cand = (patch: Partial<Candidate> = {}): Candidate => ({
  color_id: "c1", fabric_id: "f1", slug: "s", sku: "SAT-KN-0001", name: { fr: "Tissu" }, structure: "jersey", construction: "knit",
  composition: [{ fiber: "cotton", pct: 92 }, { fiber: "elastane", pct: 8 }], gsm: 200, width_cm: 150, stretch: "two_way", uses: ["activewear"], seasons: ["spring_summer"],
  moq_m: 5, feel: null, available_m: 100, price: 10, text_sim: 0.8, hex: "#1F3A5F", lab: null, color_code: "NAVY", color_name: { fr: "Marine" }, image_path: null, ...patch,
});

describe("color maths", () => {
  it("hexToLab matches known values", () => {
    const [L, a, b] = hexToLab("#FF0000");
    expect(L).toBeCloseTo(53.2, 0);
    expect(a).toBeCloseTo(80.1, 0);
    expect(b).toBeCloseTo(67.2, 0);
    expect(hexToLab("#FFFFFF")[0]).toBeCloseTo(100, 0);
  });
  it("deltaE00 reproduces the published reference pairs (Sharma et al.)", () => {
    const pairs: [number[], number[], number][] = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
      [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
      [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    ];
    for (const [a, b, expected] of pairs) expect(deltaE00(a as never, b as never)).toBeCloseTo(expected, 3);
  });
  it("identical colors are 0 apart and very different colors are far apart", () => {
    expect(deltaE00(hexToLab("#2C5AA0"), hexToLab("#2C5AA0"))).toBe(0);
    expect(deltaE00(hexToLab("#2C5AA0"), hexToLab("#C0392B"))).toBeGreaterThan(40);
  });
});

describe("score components", () => {
  it("semantic: 0.2 similarity or less scores 0, 0.8 or more scores 1", () => {
    expect(semanticScore(0.1)).toBe(0);
    expect(semanticScore(0.5)).toBeCloseTo(0.5, 5);
    expect(semanticScore(0.95)).toBe(1);
  });
  it("gsm: 1 inside the range, decays outside, null when the spec has no weight", () => {
    const s = spec({ gsm_min: 170, gsm_max: 230 });
    expect(gsmScore(s, 200)).toBe(1);
    expect(gsmScore(s, 170)).toBe(1);
    expect(gsmScore(s, 250)).toBeCloseTo(1 - 20 / 100, 5); // 20 over, half the mid (200) is 100
    expect(gsmScore(s, 600)).toBe(0);
    expect(gsmScore(spec(), 200)).toBeNull();
    expect(gsmScore(spec({ gsm_max: 150 }), 140)).toBe(1); // open-ended range
  });
  it("fiber: share of preferred fibers plus a bonus when the main fiber is preferred", () => {
    const s = spec({ fibers_preferred: ["cotton"] });
    expect(fiberScore(s, [{ fiber: "cotton", pct: 92 }, { fiber: "elastane", pct: 8 }])).toBe(1); // .92 + .2 capped
    expect(fiberScore(s, [{ fiber: "polyester", pct: 100 }])).toBe(0);
    expect(fiberScore(s, [{ fiber: "polyester", pct: 60 }, { fiber: "cotton", pct: 40 }])).toBeCloseTo(0.4, 5);
    expect(fiberScore(spec(), [{ fiber: "cotton", pct: 100 }])).toBeNull();
  });
  it("stretch: at or above the requirement is 1, one level below 0.4, otherwise 0", () => {
    const s = spec({ stretch: "two_way" });
    expect(stretchScore(s, "four_way")).toBe(1);
    expect(stretchScore(s, "two_way")).toBe(1);
    expect(stretchScore(s, "mechanical")).toBe(0.4);
    expect(stretchScore(s, "none")).toBe(0);
    expect(stretchScore(spec(), "none")).toBeNull();
  });
  it("use / season: 60% use, 40% season, all-season fabrics match any season", () => {
    const s = spec({ uses: ["activewear"], seasons: ["spring_summer"] });
    expect(usageSeasonScore(s, ["activewear"], ["spring_summer"])).toBe(1);
    expect(usageSeasonScore(s, ["activewear"], ["autumn_winter"])).toBeCloseTo(0.6, 5);
    expect(usageSeasonScore(s, ["shirts"], ["all_season"])).toBeCloseTo(0.4, 5);
    expect(usageSeasonScore(s, ["shirts"], ["autumn_winter"])).toBe(0);
    expect(usageSeasonScore(spec({ uses: ["shirts"] }), ["shirts"], ["autumn_winter"])).toBe(1); // no season wanted: only the use counts
    expect(usageSeasonScore(spec(), ["shirts"], ["all_season"])).toBeNull();
  });
  it("structure, feel and color", () => {
    expect(structureScore(spec({ structures: ["pique"] }), "pique")).toBe(1);
    expect(structureScore(spec({ structures: ["pique"] }), "jersey")).toBe(0);
    expect(structureScore(spec(), "jersey")).toBeNull();
    expect(feelScore(spec({ feel: { softness: 8 } }), { softness: 6 })).toBeCloseTo(0.8, 5);
    expect(feelScore(spec({ feel: { softness: 8 } }), null)).toBe(0.5);
    expect(feelScore(spec(), { softness: 6 })).toBeNull();
    const navy = spec({ colors: [{ name: "navy", hex: "#1F3A5F" }] });
    expect(colorScore(navy, null, "#1F3A5F")).toBe(1);
    expect(colorScore(navy, null, "#C0392B")).toBeLessThan(0.2);
    expect(colorScore(spec(), null, "#1F3A5F")).toBeNull();
  });
  it("budget: no penalty under budget, softened penalty above, never below 0.6", () => {
    const s = spec({ budget_max_per_m: 10 });
    expect(budgetMultiplier(s, 9)).toBe(1);
    expect(budgetMultiplier(s, 12)).toBeCloseTo(0.8, 5);
    expect(budgetMultiplier(s, 30)).toBe(0.6);
    expect(budgetMultiplier(s, null)).toBe(1);
    expect(budgetMultiplier(spec(), 99)).toBe(1);
  });
});

describe("scoreCandidate", () => {
  it("weights add up to 1", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
  it("a perfect match reaches the cap of 99%, never 100%", () => {
    const s = spec({ gsm_min: 170, gsm_max: 230, structures: ["jersey"], stretch: "two_way", uses: ["activewear"], seasons: ["spring_summer"], fibers_preferred: ["cotton"] });
    const r = scoreCandidate(s, cand({ text_sim: 1 }));
    expect(r.score).toBeCloseTo(1, 5);
    expect(r.pct).toBe(99);
  });
  it("components absent from the spec do not hurt: their weight goes to the others", () => {
    const only = scoreCandidate(spec({ gsm_min: 170, gsm_max: 230 }), cand({ text_sim: 0.2 }));
    expect(only.components.fiber).toBeNull();
    // semantic 0 (weight .25) and gsm 1 (weight .20): 0.20 / 0.45
    expect(only.score).toBeCloseTo(0.2 / 0.45, 5);
  });
  it("a worse fit scores lower; going over budget lowers the score", () => {
    const s = spec({ gsm_min: 170, gsm_max: 230, budget_max_per_m: 10 });
    const good = scoreCandidate(s, cand({ gsm: 200, price: 9 }));
    const heavy = scoreCandidate(s, cand({ gsm: 320, price: 9 }));
    const dear = scoreCandidate(s, cand({ gsm: 200, price: 14 }));
    expect(good.score).toBeGreaterThan(heavy.score);
    expect(good.score).toBeGreaterThan(dear.score);
    expect(dear.components.budget).toBeCloseTo(0.6, 5);
  });
});

describe("pickTop", () => {
  const mk = (id: string, fabric: string, score: number) => ({ candidate: cand({ color_id: id, fabric_id: fabric, sku: id }), score, pct: Math.round(score * 100), components: scoreCandidate(spec(), cand()).components });
  it("prefers different fabrics, allows 2 colors per fabric, returns at most 5 sorted by score", () => {
    const list = [mk("a1", "A", 0.95), mk("a2", "A", 0.94), mk("a3", "A", 0.93), mk("b1", "B", 0.8), mk("c1", "C", 0.7), mk("d1", "D", 0.6), mk("e1", "E", 0.5)];
    const top = pickTop(list).map((r) => r.candidate.color_id);
    expect(top).toEqual(["a1", "b1", "c1", "d1", "e1"]); // one color of each fabric first; a2 only if there is room
    const few = pickTop([mk("a1", "A", 0.9), mk("a2", "A", 0.8), mk("a3", "A", 0.7)]).map((r) => r.candidate.color_id);
    expect(few).toEqual(["a1", "a2"]); // never more than 2 of the same fabric
  });
});

describe("refinements", () => {
  const ctx = { medianGsm: 200, medianPrice: 10, currentColorIds: ["x", "y"] };
  it("lighter / heavier scale an existing range or build one around the shown results", () => {
    expect(applyRefinement(spec({ gsm_min: 200, gsm_max: 250 }), "lighter", ctx).spec).toMatchObject({ gsm_min: 160, gsm_max: 200 });
    expect(applyRefinement(spec({ gsm_min: 200, gsm_max: 250 }), "heavier", ctx).spec).toMatchObject({ gsm_min: 240, gsm_max: 300 });
    expect(applyRefinement(spec(), "lighter", ctx).spec).toMatchObject({ gsm_min: 144, gsm_max: 176 });
  });
  it("cheaper sets the budget to 80% of the median price shown", () => {
    expect(applyRefinement(spec(), "cheaper", ctx).spec.budget_max_per_m).toBe(8);
  });
  it("more stretch climbs one level; softer raises the softness target; natural prefers natural fibers and avoids polyester", () => {
    expect(applyRefinement(spec(), "more_stretch", ctx).spec.stretch).toBe("mechanical");
    expect(applyRefinement(spec({ stretch: "two_way" }), "more_stretch", ctx).spec.stretch).toBe("four_way");
    expect(applyRefinement(spec({ stretch: "four_way" }), "more_stretch", ctx).spec.stretch).toBe("four_way");
    expect(applyRefinement(spec(), "softer", ctx).spec.feel.softness).toBe(8);
    expect(applyRefinement(spec({ feel: { softness: 9 } }), "softer", ctx).spec.feel.softness).toBe(10);
    const natural = applyRefinement(spec(), "natural", ctx).spec;
    expect(natural.fibers_preferred).toEqual(["cotton", "linen", "wool", "silk", "viscose", "modal"]);
    expect(natural.fibers_avoid).toContain("polyester");
  });
  it("other colors excludes what is currently shown; the input spec is never mutated", () => {
    const original = spec({ gsm_min: 100, gsm_max: 200 });
    const r = applyRefinement(original, "other_colors", ctx);
    expect(r.excludeColorIds).toEqual(["x", "y"]);
    applyRefinement(original, "lighter", ctx);
    expect(original).toMatchObject({ gsm_min: 100, gsm_max: 200 });
  });
  it("several refinements combine", () => {
    const r = applyRefinements(spec({ gsm_min: 200, gsm_max: 250 }), ["lighter", "cheaper", "other_colors"], ctx);
    expect(r.spec).toMatchObject({ gsm_min: 160, gsm_max: 200, budget_max_per_m: 8 });
    expect(r.excludeColorIds).toEqual(["x", "y"]);
  });
  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("keyword fallback", () => {
  const input = (description: string, extra: Partial<Parameters<typeof fallbackSpec>[0]> = {}) => ({ description, styles: [], brand: [], priceTarget: null, audience: null, ...extra });
  it("reads the video brief: knit jersey, activewear, summer, 200 GSM +/-15%", () => {
    const s = fallbackSpec(input("Breathable jersey for a summer activewear line, ~200 GSM."));
    expect(s).toMatchObject({ construction: "knit", structures: ["jersey"], uses: ["activewear"], seasons: ["spring_summer"], gsm_min: 170, gsm_max: 230, stretch: "two_way" });
    expect(s.feel.breathability).toBe(8);
  });
  it("understands French and Arabic", () => {
    const fr = fallbackSpec(input("Popeline de coton léger pour chemises d'été"));
    expect(fr).toMatchObject({ structures: ["poplin"], fibers_preferred: ["cotton"], uses: ["shirts"], seasons: ["spring_summer"], gsm_max: 170 });
    const ar = fallbackSpec(input("قماش قطن ناعم للأطفال"));
    expect(ar.fibers_preferred).toEqual(["cotton"]);
    expect(ar.uses).toContain("kidswear");
    expect(ar.feel.softness).toBe(8);
  });
  it("uses the wizard answers: price target, sporty style, eco style, kids audience", () => {
    expect(fallbackSpec(input("un tissu pour ma collection", { priceTarget: 12 })).budget_max_per_m).toBe(12);
    expect(fallbackSpec(input("un tissu pour ma collection", { styles: ["sporty"] })).uses).toContain("activewear");
    expect(fallbackSpec(input("un tissu pour ma collection", { styles: ["eco"] })).fibers_preferred).toContain("linen");
    expect(fallbackSpec(input("un tissu pour ma collection", { audience: "kids" })).uses).toContain("kidswear");
  });
  it("always returns a valid spec, even for gibberish", () => {
    const s = fallbackSpec(input("zzzz qqqq wwww"));
    expect(SpecSchema.safeParse(s).success).toBe(true);
    expect(s.query_text).toContain("zzzz");
  });
});

describe("schemas", () => {
  it("the wizard needs a description of at least 10 characters", () => {
    expect(WizardInputSchema.safeParse({ description: "short" }).success).toBe(false);
    const ok = WizardInputSchema.safeParse({ description: "jersey for summer wear" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toMatchObject({ styles: [], brand: [], audience: null, priceTarget: null });
    expect(WizardInputSchema.safeParse({ description: "jersey for summer wear", styles: ["a", "b", "c", "d"] }).success).toBe(false);
  });
  it("the spec fills defaults and rejects unknown enum values", () => {
    expect(SpecSchema.parse({}).structures).toEqual([]);
    expect(SpecSchema.safeParse({ structures: ["nope"] }).success).toBe(false);
    expect(SpecSchema.safeParse({ gsm_min: 5 }).success).toBe(false);
  });
});

describe("retrieveAndRank", () => {
  const fabrics = (n: number) => Array.from({ length: n }, (_, i) => cand({ color_id: `c${i}`, fabric_id: `f${i}`, sku: `S${i}`, gsm: 200 + i }));

  it("returns the best results and how many colors were scored", async () => {
    const out = await retrieveAndRank(spec({ gsm_min: 190, gsm_max: 210 }), async () => fabrics(8));
    expect(out.results).toHaveLength(5);
    expect(out.scanned).toBe(8);
    expect(out.relaxed).toEqual([]);
  });

  it("relaxes the weight, then the construction, then the fibers to avoid when fewer than 3 fabrics match, and says so", async () => {
    const calls: FetchArgs[] = [];
    const fetch = async (a: FetchArgs) => {
      calls.push(structuredClone(a));
      const s = a.spec;
      if (s.gsm_min !== null) return fabrics(1);
      if (s.construction !== null) return fabrics(2);
      if (s.fibers_avoid.length) return fabrics(2);
      return fabrics(6);
    };
    const original = spec({ gsm_min: 100, gsm_max: 120, construction: "woven", fibers_avoid: ["wool"] });
    const out = await retrieveAndRank(original, fetch);
    expect(out.relaxed).toEqual(["gsm", "construction", "fibers_avoid"]);
    expect(calls).toHaveLength(4);
    expect(out.results.length).toBeGreaterThanOrEqual(3);
    // the scoring still uses the ORIGINAL weight target, so relaxed matches honestly score lower
    expect(out.results.every((r) => r.components.gsm !== null && r.components.gsm < 1)).toBe(true);
    expect(original.gsm_min).toBe(100); // the caller's spec is untouched
  });

  it("does not report a relaxation that changed nothing", async () => {
    const out = await retrieveAndRank(spec({ uses: ["shirts"] }), async () => fabrics(1));
    expect(out.relaxed).toEqual([]);
    expect(out.results).toHaveLength(1);
  });

  it("passes the required meters and the excluded colors to the search", async () => {
    let seen: FetchArgs | null = null;
    await retrieveAndRank(spec(), async (a) => { seen = a; return fabrics(4); }, { requiredM: 120, excludeColorIds: ["x"] });
    expect(seen).toMatchObject({ requiredM: 120, excludeColorIds: ["x"] });
  });
});
