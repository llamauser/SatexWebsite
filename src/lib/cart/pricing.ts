/**
 * Pure cart rules (docs/05-commerce.md §2-3): price tiers, quantity validation, local cart format, merging.
 * No browser or database access here, so everything is unit-tested.
 */
export interface PriceTier {
  minM: number;
  pricePerM: number;
}

/** Unit price for a quantity: the tier with the highest minimum that the quantity reaches. Null if no tier applies. */
export function unitPriceFor(tiers: PriceTier[], meters: number): number | null {
  const applicable = tiers.filter((t) => meters >= t.minM).sort((a, b) => b.minM - a.minM);
  return applicable[0]?.pricePerM ?? null;
}

export const MAX_METERS = 10_000;
export const METERS_STEP = 0.5;

export type MetersProblem = "min" | "step" | "max" | "invalid";

/** Quantity rules: at least the MOQ, in steps of 0.5 m, at most 10 000 m. Returns null when valid. */
export function validateMeters(meters: number, moqM: number): MetersProblem | null {
  if (!Number.isFinite(meters) || meters <= 0) return "invalid";
  if (meters < moqM) return "min";
  if (meters > MAX_METERS) return "max";
  if (Math.abs(meters / METERS_STEP - Math.round(meters / METERS_STEP)) > 1e-9) return "step";
  return null;
}

export function roundToStep(meters: number): number {
  return Math.round(meters / METERS_STEP) * METERS_STEP;
}

// ------------------------------------------------------------------ guest cart (localStorage)
export interface LocalLine {
  colorId: string;
  meters: number;
}
export const LOCAL_CART_KEY = "satex.cart.v1";

/** Tolerant parser: anything that is not a clean list of {colorId, meters} is ignored. */
export function parseLocalCart(raw: string | null): LocalLine[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const lines: LocalLine[] = [];
    for (const item of data) {
      const { colorId, meters } = (item ?? {}) as { colorId?: unknown; meters?: unknown };
      if (typeof colorId === "string" && /^[0-9a-f-]{36}$/i.test(colorId) && typeof meters === "number" && Number.isFinite(meters) && meters > 0) {
        lines.push({ colorId, meters: Math.min(meters, MAX_METERS) });
      }
    }
    return mergeLines(lines, []);
  } catch {
    return [];
  }
}

/** Sum the meters of lines that point to the same color. */
export function mergeLines(a: LocalLine[], b: LocalLine[]): LocalLine[] {
  const byColor = new Map<string, number>();
  for (const line of [...a, ...b]) byColor.set(line.colorId, Math.min((byColor.get(line.colorId) ?? 0) + line.meters, MAX_METERS));
  return [...byColor].map(([colorId, meters]) => ({ colorId, meters }));
}

/** Estimated total for display (the database computes the real one for a saved quote). */
export function estimate(lines: { meters: number; unitPrice: number | null }[], vatRate: number) {
  const subtotal = lines.reduce((s, l) => s + Math.round(l.meters * (l.unitPrice ?? 0) * 100) / 100, 0);
  const rounded = Math.round(subtotal * 100) / 100;
  return { subtotal: rounded, total: Math.round(rounded * (1 + vatRate) * 100) / 100 };
}
