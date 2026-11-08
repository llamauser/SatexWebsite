import { describe, expect, it } from "vitest";
import { COLORS } from "../../scripts/seed-data/dictionaries";
import { buildFabrics } from "../../scripts/seed-data/fabrics";
import { CATEGORIES, DEPARTMENTS } from "../../scripts/seed-data/reference";

const fabrics = buildFabrics();
const bySlug = new Map(fabrics.map((f) => [f.slug, f]));

describe("seed fabrics", () => {
  it("has exactly 80 fabrics with the required category counts", () => {
    expect(fabrics).toHaveLength(80);
    const counts: Record<string, number> = {};
    for (const f of fabrics) counts[f.categorySlug] = (counts[f.categorySlug] ?? 0) + 1;
    expect(counts).toEqual({
      knits: 14, "technical-activewear": 10, shirting: 10, suiting: 8, denim: 7,
      "natural-fibers": 10, eveningwear: 9, upholstery: 8, linings: 4,
    });
  });

  it("every fabric references a known category and has unique slug and SKU", () => {
    const cats = new Set(CATEGORIES.map((c) => c.slug));
    expect(fabrics.every((f) => cats.has(f.categorySlug))).toBe(true);
    expect(new Set(fabrics.map((f) => f.slug)).size).toBe(80);
    expect(new Set(fabrics.map((f) => f.sku)).size).toBe(80);
    expect(fabrics.every((f) => /^SAT-[A-Z]{2}-\d{4}$/.test(f.sku))).toBe(true);
  });

  it("compositions sum to 100 and specs are in the allowed ranges", () => {
    for (const f of fabrics) {
      expect(f.composition.reduce((s, c) => s + c.pct, 0)).toBe(100);
      expect(f.gsm).toBeGreaterThanOrEqual(20);
      expect(f.widthCm).toBeGreaterThanOrEqual(50);
      expect(f.moqM).toBeGreaterThanOrEqual(1);
      expect(f.moqM).toBeLessThanOrEqual(50);
      expect(f.basePrice).toBeGreaterThanOrEqual(3);
      expect(f.basePrice).toBeLessThanOrEqual(45);
    }
  });

  it("names, descriptions and colors exist in French, English and Arabic", () => {
    for (const f of fabrics) {
      for (const field of [f.name, f.shortDescription, f.description]) {
        expect(field.fr.length).toBeGreaterThan(3);
        expect(field.en.length).toBeGreaterThan(3);
        expect(field.ar).toMatch(/[؀-ۿ]/);
      }
      for (const c of f.colors) expect(c.name.ar).toMatch(/[؀-ۿ]/);
    }
    for (const c of Object.values(COLORS)) expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("each fabric has 3 to 8 distinct colors, about 400 in total", () => {
    for (const f of fabrics) {
      expect(f.colors.length).toBeGreaterThanOrEqual(3);
      expect(f.colors.length).toBeLessThanOrEqual(8);
      expect(new Set(f.colors.map((c) => c.code)).size).toBe(f.colors.length);
    }
    const total = fabrics.reduce((s, f) => s + f.colors.length, 0);
    expect(total).toBeGreaterThan(340);
    expect(total).toBeLessThan(520);
  });

  it("price tiers: first tier is the MOQ at the base price, then decreasing", () => {
    for (const f of fabrics) {
      expect(f.tiers[0]).toEqual({ minM: f.moqM, pricePerM: f.basePrice });
      expect(f.tiers[1]!.pricePerM).toBeLessThan(f.tiers[0]!.pricePerM);
      expect(f.tiers[2]!.pricePerM).toBeLessThan(f.tiers[1]!.pricePerM);
      expect(f.tiers.map((t) => t.minM)).toEqual([...f.tiers.map((t) => t.minM)].sort((a, b) => a - b));
    }
  });

  it("is deterministic (identical on every run)", () => {
    expect(JSON.stringify(buildFabrics())).toBe(JSON.stringify(fabrics));
  });

  it("includes the 8 golden fabrics used by tests", () => {
    const golden: Record<string, Record<string, unknown>> = {
      "cotton-elastane-pique": { gsm: 240, widthCm: 150, construction: "knit", structure: "pique", stretch: "two_way", seasons: ["spring_summer"] },
      "breathable-poly-mesh": { gsm: 140, structure: "mesh" },
      "organic-cotton-jersey-180": { gsm: 180, structure: "jersey" },
      "stretch-denim-12oz": { gsm: 400, structure: "denim" },
      "linen-plain-160": { gsm: 160, structure: "plain" },
      "silk-satin-90": { gsm: 90, structure: "satin" },
      "wool-gabardine-260": { gsm: 260, structure: "gabardine" },
      "velvet-upholstery-480": { gsm: 480, structure: "velvet" },
    };
    for (const [slug, expected] of Object.entries(golden)) {
      expect(bySlug.get(slug), slug).toBeDefined();
      expect(bySlug.get(slug)).toMatchObject(expected);
    }
    const pique = bySlug.get("cotton-elastane-pique")!;
    expect(pique.composition).toEqual([{ fiber: "cotton", pct: 92 }, { fiber: "elastane", pct: 8 }]);
    expect(pique.uses).toEqual(expect.arrayContaining(["activewear", "polos"]));
    expect(pique.name.en).toBe("Cotton / Elastane Piqué");
    expect(bySlug.get("organic-cotton-jersey-180")!.composition).toEqual([{ fiber: "cotton", pct: 100 }]);
    expect(bySlug.get("organic-cotton-jersey-180")!.eco).toMatchObject({ organic: true });
    expect(fabrics.filter((f) => f.isFeatured).length).toBeGreaterThanOrEqual(8);
  });
});

describe("reference data", () => {
  it("has 9 categories and 11 departments", () => {
    expect(CATEGORIES).toHaveLength(9);
    expect(DEPARTMENTS).toHaveLength(11);
    expect(DEPARTMENTS.filter((d) => d.floor === 0)).toHaveLength(8);
    const cats = new Set(CATEGORIES.map((c) => c.slug));
    for (const d of DEPARTMENTS) for (const c of d.categories) expect(cats.has(c)).toBe(true);
    // every category is shown in exactly one department
    const shown = DEPARTMENTS.flatMap((d) => d.categories).sort();
    expect(shown).toEqual([...cats].sort());
  });
});
