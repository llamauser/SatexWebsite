import { describe, expect, it } from "vitest";
import { estimate, mergeLines, parseLocalCart, roundToStep, unitPriceFor, validateMeters } from "../../src/lib/cart/pricing";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const tiers = [{ minM: 5, pricePerM: 10 }, { minM: 100, pricePerM: 9.2 }, { minM: 500, pricePerM: 8.5 }];

describe("unitPriceFor", () => {
  it("takes the tier with the highest minimum that the quantity reaches", () => {
    expect(unitPriceFor(tiers, 5)).toBe(10);
    expect(unitPriceFor(tiers, 99.5)).toBe(10);
    expect(unitPriceFor(tiers, 100)).toBe(9.2);
    expect(unitPriceFor(tiers, 499)).toBe(9.2);
    expect(unitPriceFor(tiers, 5000)).toBe(8.5);
  });
  it("returns null below the first tier or without tiers (prices hidden)", () => {
    expect(unitPriceFor(tiers, 4)).toBeNull();
    expect(unitPriceFor([], 50)).toBeNull();
  });
});

describe("validateMeters", () => {
  it("accepts at least the MOQ in steps of 0.5 m up to 10 000 m", () => {
    expect(validateMeters(5, 5)).toBeNull();
    expect(validateMeters(5.5, 5)).toBeNull();
    expect(validateMeters(10000, 5)).toBeNull();
  });
  it("explains what is wrong", () => {
    expect(validateMeters(4.5, 5)).toBe("min");
    expect(validateMeters(5.3, 5)).toBe("step");
    expect(validateMeters(10000.5, 5)).toBe("max");
    expect(validateMeters(0, 1)).toBe("invalid");
    expect(validateMeters(Number.NaN, 1)).toBe("invalid");
    expect(validateMeters(-3, 1)).toBe("invalid");
  });
  it("rounds to the nearest half meter", () => {
    expect(roundToStep(5.3)).toBe(5.5);
    expect(roundToStep(5.2)).toBe(5);
    expect(roundToStep(12)).toBe(12);
  });
});

describe("guest cart storage", () => {
  it("reads a clean list and ignores damaged data", () => {
    expect(parseLocalCart(JSON.stringify([{ colorId: A, meters: 10 }, { colorId: B, meters: 2.5 }]))).toEqual([{ colorId: A, meters: 10 }, { colorId: B, meters: 2.5 }]);
    expect(parseLocalCart(null)).toEqual([]);
    expect(parseLocalCart("not json")).toEqual([]);
    expect(parseLocalCart('{"a":1}')).toEqual([]);
    expect(parseLocalCart(JSON.stringify([{ colorId: "x", meters: 5 }, { colorId: A, meters: -1 }, { colorId: A, meters: "5" }, null, 7]))).toEqual([]);
  });
  it("sums duplicate colors and caps the quantity", () => {
    expect(parseLocalCart(JSON.stringify([{ colorId: A, meters: 10 }, { colorId: A, meters: 5 }]))).toEqual([{ colorId: A, meters: 15 }]);
    expect(parseLocalCart(JSON.stringify([{ colorId: A, meters: 999999 }]))[0]!.meters).toBe(10000);
  });
});

describe("mergeLines (guest cart into the account cart)", () => {
  it("sums the meters of the same color and keeps the others", () => {
    expect(mergeLines([{ colorId: A, meters: 10 }], [{ colorId: A, meters: 5 }, { colorId: B, meters: 2 }])).toEqual([{ colorId: A, meters: 15 }, { colorId: B, meters: 2 }]);
    expect(mergeLines([], [])).toEqual([]);
  });
});

describe("estimate", () => {
  it("adds the lines and the VAT with cents rounding", () => {
    expect(estimate([{ meters: 12.5, unitPrice: 10.1 }, { meters: 7, unitPrice: 3 }], 0.2)).toEqual({ subtotal: 147.25, total: 176.7 });
    expect(estimate([{ meters: 10, unitPrice: null }], 0.2)).toEqual({ subtotal: 0, total: 0 });
  });
});
