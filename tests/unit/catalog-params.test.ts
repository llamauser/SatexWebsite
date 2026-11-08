import { describe, expect, it } from "vitest";
import { pageWindow } from "../../src/lib/catalog/pagination";
import {
  activeFilterCount, compositionShort, DEFAULT_FILTERS, pageCount, parseCatalogParams, serializeCatalogParams, stockLevel, toRpcArgs,
} from "../../src/lib/catalog/params";

describe("parseCatalogParams", () => {
  it("returns the defaults for an empty query (in stock on, relevance, page 1)", () => {
    expect(parseCatalogParams({})).toEqual(DEFAULT_FILTERS);
    expect(parseCatalogParams(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
  });

  it("reads every filter from the query string", () => {
    const f = parseCatalogParams({
      q: " piqué ", category: "denim,knits", construction: "knit", structure: "pique,jersey", fiber: "cotton,elastane", gsm_min: "150", gsm_max: "300",
      stretch: "two_way", use: "activewear,polos", season: "spring_summer", color: "navy,blue", in_stock: "0", sort: "price_asc", page: "3",
    });
    expect(f).toEqual({
      q: "piqué", category: ["denim", "knits"], construction: ["knit"], structure: ["pique", "jersey"], fiber: ["cotton", "elastane"],
      gsmMin: 150, gsmMax: 300, stretch: ["two_way"], use: ["activewear", "polos"], season: "spring_summer", color: ["blue"], inStock: false, sort: "price_asc", page: 3,
    });
  });

  it("drops unknown or malicious values instead of failing", () => {
    const f = parseCatalogParams({
      category: "denim,<script>,UPPER,../x", structure: "nope,twill", fiber: "unobtainium", stretch: "x", use: "x", season: "winter", color: "chartreuse",
      sort: "random", gsm_min: "abc", gsm_max: "-5", page: "0", construction: "knit,knit",
    });
    expect(f.category).toEqual(["denim"]);
    expect(f.structure).toEqual(["twill"]);
    expect(f.fiber).toEqual([]);
    expect(f.stretch).toEqual([]);
    expect(f.season).toBeNull();
    expect(f.color).toEqual([]);
    expect(f.sort).toBe("relevance");
    expect(f.gsmMin).toBeNull();
    expect(f.gsmMax).toBeNull();
    expect(f.page).toBe(1);
    expect(f.construction).toEqual(["knit"]);
  });

  it("clamps the weight range, swaps it when reversed, and caps the search text", () => {
    expect(parseCatalogParams({ gsm_min: "5", gsm_max: "9999" })).toMatchObject({ gsmMin: 20, gsmMax: 600 });
    expect(parseCatalogParams({ gsm_min: "300", gsm_max: "100" })).toMatchObject({ gsmMin: 100, gsmMax: 300 });
    expect(parseCatalogParams({ q: "x".repeat(500) }).q).toHaveLength(80);
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseCatalogParams({ sort: ["newest", "gsm_asc"] }).sort).toBe("newest");
  });
});

describe("serializeCatalogParams", () => {
  it("omits defaults so the URL stays canonical", () => {
    expect(serializeCatalogParams(DEFAULT_FILTERS).toString()).toBe("");
    expect(serializeCatalogParams({ ...DEFAULT_FILTERS, inStock: false }).toString()).toBe("in_stock=0");
  });

  it("round-trips any filter set", () => {
    const f = parseCatalogParams({ q: "lin", category: "natural-fibers", fiber: "linen", gsm_min: "100", use: "shirts,dresses", season: "all_season", color: "beige", sort: "gsm_desc", page: "2", in_stock: "0" });
    expect(parseCatalogParams(serializeCatalogParams(f))).toEqual(f);
  });
});

describe("toRpcArgs", () => {
  it("maps empty lists to null and computes the offset from the page", () => {
    const args = toRpcArgs({ ...DEFAULT_FILTERS, page: 3, fiber: ["cotton"] });
    expect(args).toMatchObject({ p_q: null, p_categories: null, p_fibers: ["cotton"], p_in_stock: true, p_sort: "relevance", p_limit: 24, p_offset: 48 });
  });
});

describe("helpers", () => {
  it("counts active filters (search, sort and page excluded)", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, q: "x", sort: "newest", page: 4 })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, category: ["a", "b"], gsmMin: 100, gsmMax: 200, season: "all_season", inStock: false })).toBe(5);
  });
  it("formats compositions and page counts", () => {
    expect(compositionShort([{ fiber: "cotton", pct: 92 }, { fiber: "elastane", pct: 8 }])).toBe("92% CO · 8% EA");
    expect(pageCount(0)).toBe(1);
    expect(pageCount(24)).toBe(1);
    expect(pageCount(25)).toBe(2);
    expect(pageCount(80)).toBe(4);
  });
  it("stock level: out below the MOQ, low under the threshold", () => {
    expect(stockLevel(0, 5, 50)).toBe("out");
    expect(stockLevel(4.5, 5, 50)).toBe("out");
    expect(stockLevel(5, 5, 50)).toBe("low");
    expect(stockLevel(49, 5, 50)).toBe("low");
    expect(stockLevel(50, 5, 50)).toBe("in");
  });
  it("pagination window keeps first, last and neighbours with gaps", () => {
    expect(pageWindow(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, "gap", 20]);
    expect(pageWindow(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageWindow(20, 20)).toEqual([1, "gap", 17, 18, 19, 20]);
  });
});
