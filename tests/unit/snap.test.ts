import { describe, expect, it } from "vitest";
import { dominantColors, toHex } from "@/lib/snap/colors";
import { describeVisual, specFromVisual } from "@/lib/snap/spec";
import { neutralVisual, parseVisual } from "@/lib/snap/visual";

const solid = (r: number, g: number, b: number, n: number) => Array.from({ length: n }, () => [r, g, b, 255]).flat();

describe("dominant colors", () => {
  it("one flat color is one color with all of the image", () => {
    expect(dominantColors(solid(30, 60, 160, 400))).toEqual([{ hex: "#1E3CA0", share: 1 }]);
  });
  it("two colors come out in order of share", () => {
    const px = [...solid(200, 30, 30, 300), ...solid(250, 250, 250, 100)];
    expect(dominantColors(px)).toEqual([{ hex: "#C81E1E", share: 0.75 }, { hex: "#FAFAFA", share: 0.25 }]);
  });
  it("shades of one color are merged into it", () => {
    const px = [...solid(30, 60, 160, 200), ...solid(40, 70, 170, 200), ...solid(25, 55, 150, 200)];
    const out = dominantColors(px);
    expect(out).toHaveLength(1);
    expect(out[0]!.hex).toMatch(/^#[0-9A-F]{6}$/);
  });
  it("at most `max` colors, transparent pixels ignored, empty input is empty", () => {
    const px = [...solid(255, 0, 0, 50), ...solid(0, 255, 0, 40), ...solid(0, 0, 255, 30), ...solid(0, 0, 0, 20)];
    expect(dominantColors(px, 4, 3).map((c) => c.hex)).toEqual(["#FF0000", "#00FF00", "#0000FF"]);
    expect(dominantColors([10, 10, 10, 0, 10, 10, 10, 0])).toEqual([]);
    expect(dominantColors([])).toEqual([]);
  });
  it("RGB without alpha", () => {
    expect(dominantColors([0, 128, 0, 0, 128, 0], 3)).toEqual([{ hex: "#008000", share: 1 }]);
    expect(toHex(0, 0, 0)).toBe("#000000");
    expect(toHex(300, -5, 15.6)).toBe("#FF0010");
  });
});

describe("reading the vision model's answer", () => {
  it("accepts a complete answer, even wrapped in prose or code fences", () => {
    const v = parseVisual('Here you go:\n```json\n{"is_textile": true, "construction_guess": "knit", "structure_guess": "pique", "pattern": "solid", "sheen": 2, "texture": "textured", "garment_guess": "polo shirt", "likely_uses": ["polos", "t_shirts"], "confidence": 0.8, "notes": "A textured pique knit."}\n```');
    expect(v).toMatchObject({ is_textile: true, construction_guess: "knit", structure_guess: "pique", garment_guess: "polo shirt", likely_uses: ["polos", "t_shirts"] });
  });
  it("replaces unknown values by safe ones instead of failing", () => {
    const v = parseVisual({ is_textile: "yes", construction_guess: "knitted", structure_guess: "spaghetti", pattern: "zigzag", sheen: 99, texture: 5, likely_uses: ["polos", "rockets"], notes: 7 })!;
    expect(v).toMatchObject({ is_textile: true, construction_guess: null, structure_guess: null, pattern: "other", texture: "smooth", likely_uses: ["polos"], notes: "" });
    expect(v.sheen).toBe(3);
  });
  it("a refusal to see a fabric is kept", () => {
    expect(parseVisual({ is_textile: false })!.is_textile).toBe(false);
  });
  it("nonsense is null, never an exception", () => {
    for (const raw of ["", "not json", "{", null, undefined, 42, []]) expect(() => parseVisual(raw)).not.toThrow();
    expect(parseVisual("not json")).toBeNull();
    expect(parseVisual(null)).toBeNull();
  });
});

describe("search specification from a photo", () => {
  const visual = parseVisual({ is_textile: true, construction_guess: "knit", structure_guess: "jersey", pattern: "stripe", sheen: 4.6, texture: "ribbed", garment_guess: "t-shirt", likely_uses: ["t_shirts"], notes: "A fine striped jersey." })!;
  const colors = [{ hex: "#1E3CA0", share: 0.7 }, { hex: "#FAFAFA", share: 0.3 }];
  it("carries what the photo shows and the answers", () => {
    const spec = specFromVisual(visual, colors, { season: "spring_summer", stretch: "a_lot" });
    expect(spec).toMatchObject({ construction: "knit", structures: ["jersey"], uses: ["t_shirts"], seasons: ["spring_summer"], stretch: "four_way", gsm_min: null, gsm_max: null });
    expect(spec.colors.map((c) => c.hex)).toEqual(["#1E3CA0", "#FAFAFA"]);
    expect(spec.feel.sheen).toBe(5);
    expect(spec.query_text).toContain("t-shirt");
    expect(spec.query_text).toContain("stripe");
    expect(spec.query_text).toContain("ribbed");
  });
  it("skipped questions leave the weight, season and stretch open", () => {
    const spec = specFromVisual(visual, colors, { season: null, stretch: null });
    expect(spec.seasons).toEqual([]);
    expect(spec.stretch).toBeNull();
    expect(specFromVisual(visual, colors, { season: null, stretch: "none" }).stretch).toBe("none");
    expect(specFromVisual(visual, colors, { season: null, stretch: "some" }).stretch).toBe("mechanical");
  });
  it("a neutral reading (model off or failing) still searches by color", () => {
    const spec = specFromVisual(neutralVisual(colors), colors, { season: null, stretch: null });
    expect(spec.colors).toHaveLength(2);
    expect(spec.structures).toEqual([]);
    expect(spec.query_text.length).toBeGreaterThan(0);
  });
  it("the stored description is long enough for a valid brief and carries the colors", () => {
    expect(describeVisual(neutralVisual([]), []).length).toBeGreaterThanOrEqual(10);
    expect(describeVisual(visual, colors)).toContain("#1E3CA0");
    expect(describeVisual({ ...visual, notes: "x".repeat(900) }, colors).length).toBeLessThanOrEqual(600);
  });
});
