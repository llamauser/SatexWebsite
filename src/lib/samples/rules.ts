/** Pure helpers for sample requests: selection, address check, error mapping, status flow. */

export const SAMPLE_STATUSES = ["requested", "approved", "rejected", "preparing", "shipped", "delivered"] as const;
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];

/** Statuses that count toward the "open requests" limit. */
export const OPEN_STATUSES: readonly SampleStatus[] = ["requested", "approved", "preparing", "shipped"];
export const isOpen = (s: string) => (OPEN_STATUSES as readonly string[]).includes(s);

/** The steps of the progress bar (a rejection leaves the flow after "requested"). */
export const FLOW: readonly SampleStatus[] = ["requested", "approved", "preparing", "shipped", "delivered"];

export function nextStatuses(s: SampleStatus): SampleStatus[] {
  switch (s) {
    case "requested": return ["approved", "rejected"];
    case "approved": return ["preparing"];
    case "preparing": return ["shipped"];
    case "shipped": return ["delivered"];
    default: return [];
  }
}

/** 0-based position of a status in the progress bar; -1 for a rejected request. */
export const flowIndex = (s: SampleStatus) => FLOW.indexOf(s);

// ------------------------------------------------------------------ the colors a client wants samples of
export const SAMPLE_KEY = "satex.samples.v1";
export const DEFAULT_MAX_COLORS = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the stored selection: only valid, distinct ids, at most `max` of them. Never throws. */
export function parseSelection(raw: string | null | undefined, max = DEFAULT_MAX_COLORS): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const ids: string[] = [];
    for (const v of value) if (typeof v === "string" && UUID.test(v) && !ids.includes(v)) ids.push(v);
    return ids.slice(0, max);
  } catch {
    return [];
  }
}

/** Adds an id (no duplicate). `full` tells the caller that the limit stopped it. */
export function addId(ids: string[], id: string, max = DEFAULT_MAX_COLORS): { ids: string[]; full: boolean } {
  if (ids.includes(id)) return { ids, full: false };
  if (ids.length >= max) return { ids, full: true };
  return { ids: [...ids, id], full: false };
}

// ------------------------------------------------------------------ the shipping address
export interface ShippingAddress {
  recipient: string;
  line1: string;
  line2: string;
  city: string;
  postal_code: string;
  country: string;
  phone: string;
}
export const EMPTY_ADDRESS: ShippingAddress = { recipient: "", line1: "", line2: "", city: "", postal_code: "", country: "", phone: "" };
export const REQUIRED_ADDRESS_FIELDS = ["line1", "city", "country"] as const;

/** The required fields that are empty. */
export function missingAddressFields(a: ShippingAddress): (typeof REQUIRED_ADDRESS_FIELDS)[number][] {
  return REQUIRED_ADDRESS_FIELDS.filter((k) => a[k].trim() === "");
}

// ------------------------------------------------------------------ errors raised by request_samples()
export type SampleError = "colors" | "openLimit" | "tooMany" | "address" | "inactive" | "auth" | "error";

export function sampleErrorCode(message: string | null | undefined): SampleError {
  const m = (message ?? "").toLowerCase();
  if (m.includes("open sample request limit")) return "openLimit";
  if (m.includes("too many colors")) return "tooMany";
  if (m.includes("at least one color")) return "colors";
  if (m.includes("address")) return "address";
  if (m.includes("inactive")) return "inactive";
  if (m.includes("sign in")) return "auth";
  return "error";
}
