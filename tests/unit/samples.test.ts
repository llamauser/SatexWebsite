import { describe, expect, it } from "vitest";
import {
  addId, EMPTY_ADDRESS, FLOW, flowIndex, isOpen, missingAddressFields, nextStatuses, parseSelection, sampleErrorCode, SAMPLE_STATUSES,
} from "@/lib/samples/rules";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("the colors chosen for a sample request", () => {
  it("reads a stored list, keeping only valid, distinct ids up to the limit", () => {
    expect(parseSelection(JSON.stringify([A, B, A, "nope", 5, null, C]), 5)).toEqual([A, B, C]);
    expect(parseSelection(JSON.stringify([A, B, C]), 2)).toEqual([A, B]);
  });
  it("never throws on garbage", () => {
    for (const raw of [null, undefined, "", "{", "null", "42", '{"a":1}']) expect(parseSelection(raw)).toEqual([]);
  });
  it("adds a color once and stops at the limit", () => {
    expect(addId([A], B, 2)).toEqual({ ids: [A, B], full: false });
    expect(addId([A, B], A, 2)).toEqual({ ids: [A, B], full: false }); // already there: nothing to do
    expect(addId([A, B], C, 2)).toEqual({ ids: [A, B], full: true });
  });
});

describe("the shipping address", () => {
  it("needs a street, a city and a country", () => {
    expect(missingAddressFields(EMPTY_ADDRESS)).toEqual(["line1", "city", "country"]);
    expect(missingAddressFields({ ...EMPTY_ADDRESS, line1: "10 rue des Tissus", city: "Lyon", country: "FR" })).toEqual([]);
    expect(missingAddressFields({ ...EMPTY_ADDRESS, line1: "  ", city: "Lyon", country: "FR" })).toEqual(["line1"]);
  });
});

describe("statuses", () => {
  it("the flow goes requested -> approved -> preparing -> shipped -> delivered", () => {
    expect(FLOW).toEqual(["requested", "approved", "preparing", "shipped", "delivered"]);
    for (let i = 0; i < FLOW.length - 1; i++) expect(nextStatuses(FLOW[i]!)).toContain(FLOW[i + 1]);
  });
  it("a request can only be rejected at the start; final statuses lead nowhere", () => {
    expect(nextStatuses("requested")).toEqual(["approved", "rejected"]);
    expect(nextStatuses("approved")).not.toContain("rejected");
    expect(nextStatuses("delivered")).toEqual([]);
    expect(nextStatuses("rejected")).toEqual([]);
  });
  it("open means not yet delivered or rejected", () => {
    expect(SAMPLE_STATUSES.filter(isOpen)).toEqual(["requested", "approved", "preparing", "shipped"]);
  });
  it("positions on the progress bar", () => {
    expect(flowIndex("requested")).toBe(0);
    expect(flowIndex("delivered")).toBe(4);
    expect(flowIndex("rejected")).toBe(-1);
  });
});

describe("sampleErrorCode", () => {
  it("maps the messages of request_samples()", () => {
    expect(sampleErrorCode("open sample request limit reached")).toBe("openLimit");
    expect(sampleErrorCode("too many colors (maximum 5)")).toBe("tooMany");
    expect(sampleErrorCode("choose at least one color")).toBe("colors");
    expect(sampleErrorCode("a shipping address is required (street, city, country)")).toBe("address");
    expect(sampleErrorCode("address field too long")).toBe("address");
    expect(sampleErrorCode("unknown or inactive color")).toBe("inactive");
    expect(sampleErrorCode("sign in to request samples")).toBe("auth");
    expect(sampleErrorCode("boom")).toBe("error");
    expect(sampleErrorCode(undefined)).toBe("error");
  });
});
