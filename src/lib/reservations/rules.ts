/** Pure helpers for reservations (no browser, no database): countdown, quantity checks, error mapping. */

export interface Remaining {
  /** Milliseconds left, never negative. */
  ms: number;
  hours: number;
  minutes: number;
  expired: boolean;
  /** Less than 6 hours left: the "expires soon" state. */
  soon: boolean;
}

export const SOON_HOURS = 6;

export function remaining(expiresAt: string | Date, now: number = Date.now()): Remaining {
  const end = typeof expiresAt === "string" ? Date.parse(expiresAt) : expiresAt.getTime();
  const ms = Number.isFinite(end) ? Math.max(0, end - now) : 0;
  const totalMinutes = Math.ceil(ms / 60_000); // 1 s left still reads "00:01", never "00:00" while active
  return { ms, hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60, expired: ms === 0, soon: ms > 0 && ms <= SOON_HOURS * 3_600_000 };
}

/** "47:58" (hours:minutes). Digits are always Latin so the same text reads the same in French, English and Arabic. */
export function formatCountdown(r: Remaining): string {
  return `${String(r.hours).padStart(2, "0")}:${String(r.minutes).padStart(2, "0")}`;
}

export type ReserveProblem = "min" | "step" | "max" | "invalid" | "stock";

/**
 * Checks a quantity before it is sent. The database re-checks everything; this only saves a round trip and gives a
 * precise message. Same rules as the quote cart (steps of 0.5 m), plus "not more than what is available".
 */
export function checkReserveMeters(meters: number, moqM: number, availableM: number | null): ReserveProblem | null {
  if (!Number.isFinite(meters) || meters <= 0) return "invalid";
  if (meters < moqM) return "min";
  if (Math.abs(meters * 2 - Math.round(meters * 2)) > 1e-9) return "step";
  if (meters > 10_000) return "max";
  if (availableM !== null && meters > availableM) return "stock";
  return null;
}

export type ReserveError = "limit" | "stock" | "min" | "auth" | "inactive" | "error";

/** Maps the messages raised by `reserve_stock()` to a code the UI can translate. */
export function reserveErrorCode(message: string | null | undefined): ReserveError {
  const m = (message ?? "").toLowerCase();
  if (m.includes("limit reached")) return "limit";
  if (m.includes("not enough stock")) return "stock";
  if (m.includes("minimum order")) return "min";
  if (m.includes("sign in")) return "auth";
  if (m.includes("not available") || m.includes("inactive")) return "inactive";
  return "error";
}

/** Reservations the client can still make. */
export const slotsLeft = (active: number, max: number) => Math.max(0, max - active);
