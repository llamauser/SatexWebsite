import { describe, expect, it } from "vitest";
import { estimateFeel, scoreFromStretchPct } from "@/lib/cloth/feel";
import { mapFeelToPhysics } from "@/lib/cloth/mapping";

const fabric = (overrides: Partial<Parameters<typeof estimateFeel>[0]> = {}) => estimateFeel({
  composition: [{ fiber: "cotton", pct: 100 }], gsm: 180, structure: "jersey", construction: "knit", stretch: "none", stretchPct: null, finish: [], ...overrides,
});

describe("fabric feel profile", () => {
  it("weights fiber scores and applies structure, weight and finish rules", () => {
    const basic = fabric();
    const brushed = fabric({ finish: ["brushed", "mercerized"] });
    expect(basic.softness).toBe(7);
    expect(basic.drape).toBe(9);
    expect(basic.breathability).toBe(7.5);
    expect(brushed.softness).toBe(9);
    expect(fabric({ composition: [{ fiber: "silk", pct: 100 }], structure: "satin", construction: "woven", gsm: 90, stretch: "none" }).sheen).toBe(10);
  });

  it("uses the documented piecewise stretch curve and measured overrides", () => {
    expect(scoreFromStretchPct(5)).toBe(2);
    expect(scoreFromStretchPct(10)).toBe(3.5);
    expect(scoreFromStretchPct(60)).toBe(10);
    const measured = fabric({ measured: { drape_coefficient: 0.3, stretch_pct_warp: 5, stretch_pct_weft: 15 } });
    expect(measured.drape).toBe(10);
    expect(measured.stretch).toBe(5);
  });

  it("clamps measured score overrides and maps them to the two simulation targets", () => {
    const profile = estimateFeel({ composition: [{ fiber: "linen", pct: 100 }], gsm: 400, structure: "canvas", construction: "woven", stretch: "none", stretchPct: null, finish: [], isMeasured: true, existing: { softness: 12, drape: 4, stretch: 3, sheen: 2, breathability: 1 } });
    expect(profile).toMatchObject({ softness: 10, drape: 4, source: "measured" });
    const params = mapFeelToPhysics(profile, 400, { gridSize: 30, avgVertexArea: 0.00004 });
    expect(params.xpbd.particleMass).toBeCloseTo(0.0004 * (0.4 / 29) ** 2);
    expect(params.blender.quality).toBe(10);
    expect(params.blender.bendingStiffness).toBeGreaterThan(0);
    expect(params.version).toBe(1);
  });
});
