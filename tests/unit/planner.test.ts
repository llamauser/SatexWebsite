import { afterEach, describe, expect, it, vi } from "vitest";
import { evenSizeRun } from "@/lib/planner/garments";
import { calculateMeters } from "@/lib/planner/meterage";
import { paletteBonus, paletteCoherence, paletteDistance } from "@/lib/planner/palette";
import { CollectionPlanSchema, PLAN_TOOL_SCHEMA } from "@/lib/planner/schema";
import { planCollection } from "@/lib/planner/plan";

describe("collection planner", () => {
  it("splits quantities evenly and keeps the total", () => {
    expect(Object.values(evenSizeRun(13)).reduce((sum, value) => sum + value, 0)).toBe(13);
    expect(evenSizeRun(13).XS).toBe(3);
  });

  it("calculates width-adjusted meterage with waste and MOQ", () => {
    expect(calculateMeters({ M: 10 }, { garment_type: "t_shirt", base_m_per_unit: 0.8, ref_width_cm: 150, size_factors: { M: 1 } }, 150, 5)).toBe(9);
    expect(calculateMeters({ M: 1 }, { garment_type: "t_shirt", base_m_per_unit: 0.8, ref_width_cm: 150, size_factors: { M: 1 } }, 150, 5)).toBe(5);
  });

  it("scores palette proximity and coherence", () => {
    const palette = [{ name: "red", hex: "#ff0000" }];
    const candidate = { color_id: "c", fabric_id: "f", hex: "#ff1010" } as never;
    expect(paletteDistance("#ff0000", palette)).toBe(0);
    expect(paletteBonus(candidate, palette)).toBeGreaterThan(0.09);
    expect(paletteCoherence([candidate], palette).paletteFit).toBe(true);
  });

  it("returns a deterministic valid fake-provider plan", async () => {
    const result = await planCollection({ description: "summer cotton line", styles: ["casual"], budgetPerM: null }, [{ index: 0, garmentType: "t_shirt", label: "Core tee", notes: "" }], { ...process.env, AI_PROVIDER: "fake" });
    expect(CollectionPlanSchema.parse(result.plan).pieces).toHaveLength(1);
    expect(result.source).toBe("fallback");
  });

  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  const pieces = [{ index: 0, garmentType: "t_shirt", label: "Core tee", notes: "" }, { index: 1, garmentType: "skirt", label: "Midi", notes: "" }];

  it("the fallback follows the season: another palette and the season in every piece's spec", async () => {
    const summer = await planCollection({ description: "une ligne légère", styles: [], budgetPerM: null, season: "spring_summer" }, pieces, env({ AI_PROVIDER: "fake" }));
    const winter = await planCollection({ description: "une ligne chaude", styles: [], budgetPerM: null, season: "autumn_winter" }, pieces, env({ AI_PROVIDER: "fake" }));
    expect(summer.plan.palette).not.toEqual(winter.plan.palette);
    expect(summer.plan.pieces.every((p) => p.spec.seasons.join() === "spring_summer")).toBe(true);
    expect(winter.plan.pieces.every((p) => p.spec.seasons.join() === "autumn_winter")).toBe(true);
    expect(summer.plan.pieces[1]!.spec.uses).toContain("skirts"); // every garment of the consumption table has its default use
  });

  it("gives the model the real spec schema, with its allowed values, for every piece", () => {
    const spec = PLAN_TOOL_SCHEMA.properties.pieces.items.properties.spec as unknown as { properties: { structures: { items: { enum: string[] } }; stretch: { enum: (string | null)[] } } };
    expect(spec.properties.structures.items.enum).toContain("jersey");
    expect(spec.properties.stretch.enum).toContain("four_way");
  });

  describe("with a model", () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
    const answer = (input: unknown) => vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "tool_use", input }], usage: { input_tokens: 10, output_tokens: 20 } }), { status: 200 }));
    const spec = (o: object = {}) => ({ construction: "knit", structures: ["jersey"], fibers_preferred: ["cotton"], fibers_avoid: [], gsm_min: 140, gsm_max: 200, stretch: "two_way", seasons: ["spring_summer"], uses: ["t_shirts"], colors: [], query_text: "light cotton jersey", ...o });

    it("uses a valid plan from the model and reports its tokens", async () => {
      vi.stubGlobal("fetch", answer({ palette: [{ name: "Lin", hex: "#d9cbb4" }, { name: "Olive", hex: "#6b7a4b" }, { name: "Nuit", hex: "#1c2a44" }], pieces: [{ index: 0, spec: spec() }, { index: 1, spec: spec({ structures: ["crepe"], uses: ["skirts"] }) }] }));
      const result = await planCollection({ description: "x", styles: [], budgetPerM: null }, pieces, env({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }));
      expect(result.source).toBe("llm");
      expect(result.plan.palette.map((c) => c.name)).toEqual(["Lin", "Olive", "Nuit"]);
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    });

    it("falls back, and logs why, when the model forgets a piece or breaks the schema", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.stubGlobal("fetch", answer({ palette: [{ name: "Lin", hex: "#d9cbb4" }, { name: "Olive", hex: "#6b7a4b" }, { name: "Nuit", hex: "#1c2a44" }], pieces: [{ index: 0, spec: spec() }] }));
      const missing = await planCollection({ description: "x", styles: [], budgetPerM: null }, pieces, env({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }));
      expect(missing.source).toBe("fallback");
      vi.stubGlobal("fetch", answer({ palette: [{ name: "Un", hex: "red" }], pieces: [] }));
      const broken = await planCollection({ description: "x", styles: [], budgetPerM: null }, pieces, env({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }));
      expect(broken.source).toBe("fallback");
      expect(CollectionPlanSchema.parse(broken.plan).pieces).toHaveLength(2);
      expect(log.mock.calls.map((c) => String(c[0])).every((line) => line.includes("planner.llm.failed"))).toBe(true);
      expect(log).toHaveBeenCalledTimes(2);
    });
  });
});
