import { describe, expect, it } from "vitest";
import { checkReserveMeters, formatCountdown, remaining, reserveErrorCode, slotsLeft } from "@/lib/reservations/rules";

const NOW = Date.parse("2026-11-09T10:00:00Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();
const H = 3_600_000;
const M = 60_000;

describe("countdown", () => {
  it("counts hours and minutes down to the end", () => {
    const r = remaining(at(47 * H + 58 * M), NOW);
    expect(r).toMatchObject({ hours: 47, minutes: 58, expired: false, soon: false });
    expect(formatCountdown(r)).toBe("47:58");
  });
  it("rounds a partial minute up, so an active reservation never shows 00:00", () => {
    expect(formatCountdown(remaining(at(1_000), NOW))).toBe("00:01");
    expect(formatCountdown(remaining(at(61 * M + 1), NOW))).toBe("01:02");
  });
  it("is expired at or after the end, and never negative", () => {
    for (const ms of [0, -1, -5 * H]) {
      const r = remaining(at(ms), NOW);
      expect(r).toMatchObject({ ms: 0, expired: true, soon: false });
      expect(formatCountdown(r)).toBe("00:00");
    }
  });
  it("flags the last 6 hours as 'soon'", () => {
    expect(remaining(at(6 * H), NOW).soon).toBe(true);
    expect(remaining(at(6 * H + M), NOW).soon).toBe(false);
    expect(remaining(at(M), NOW).soon).toBe(true);
  });
  it("treats an unreadable date as expired", () => {
    expect(remaining("not a date", NOW).expired).toBe(true);
  });
  it("always uses Latin digits", () => {
    expect(formatCountdown(remaining(at(5 * H + 7 * M), NOW))).toMatch(/^[0-9]{2}:[0-9]{2}$/);
  });
});

describe("checkReserveMeters", () => {
  it("accepts the minimum, steps of 0.5 and the available maximum", () => {
    expect(checkReserveMeters(5, 5, 100)).toBeNull();
    expect(checkReserveMeters(12.5, 5, 100)).toBeNull();
    expect(checkReserveMeters(100, 5, 100)).toBeNull();
  });
  it("rejects bad quantities with a precise reason", () => {
    expect(checkReserveMeters(Number.NaN, 5, 100)).toBe("invalid");
    expect(checkReserveMeters(0, 5, 100)).toBe("invalid");
    expect(checkReserveMeters(-3, 5, 100)).toBe("invalid");
    expect(checkReserveMeters(4.5, 5, 100)).toBe("min");
    expect(checkReserveMeters(12.3, 5, 100)).toBe("step");
    expect(checkReserveMeters(20_000, 5, null)).toBe("max");
    expect(checkReserveMeters(100.5, 5, 100)).toBe("stock");
  });
  it("does not check stock when the availability is unknown", () => {
    expect(checkReserveMeters(500, 5, null)).toBeNull();
  });
});

describe("reserveErrorCode", () => {
  it("maps the messages of reserve_stock()", () => {
    expect(reserveErrorCode("reservation limit reached")).toBe("limit");
    expect(reserveErrorCode("not enough stock available (3 m left)")).toBe("stock");
    expect(reserveErrorCode("below the minimum order quantity (5 m)")).toBe("min");
    expect(reserveErrorCode("sign in to reserve stock")).toBe("auth");
    expect(reserveErrorCode("fabric is not available")).toBe("inactive");
    expect(reserveErrorCode("unknown or inactive color")).toBe("inactive");
    expect(reserveErrorCode("something else")).toBe("error");
    expect(reserveErrorCode(null)).toBe("error");
  });
});

describe("slotsLeft", () => {
  it("never goes below zero", () => {
    expect(slotsLeft(0, 3)).toBe(3);
    expect(slotsLeft(3, 3)).toBe(0);
    expect(slotsLeft(5, 3)).toBe(0);
  });
});
