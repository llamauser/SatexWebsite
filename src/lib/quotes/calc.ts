/** Quote arithmetic, identical to the database (docs/05-commerce.md §2): used by the editor's live totals and the PDF. */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const lineTotal = (meters: number, unitPrice: number) => round2(meters * unitPrice);

export interface Totals {
  subtotal: number;
  /** Amount taken off (positive). */
  discount: number;
  /** After the discount, before VAT. */
  net: number;
  vat: number;
  total: number;
}

/** subtotal = sum of line totals; total = round(subtotal * (1 - discount%) * (1 + VAT), 2), exactly as `quotes_before_write` does. */
export function computeTotals(lines: { meters: number; unitPrice: number }[], discountPct: number, vatRate: number): Totals {
  const subtotal = round2(lines.reduce((s, l) => s + lineTotal(l.meters, l.unitPrice), 0));
  const total = round2(subtotal * (1 - discountPct / 100) * (1 + vatRate));
  const discount = round2((subtotal * discountPct) / 100);
  const net = round2(subtotal - discount);
  return { subtotal, discount, net, vat: round2(total - net), total };
}

/** A quote can be edited by sales only while it is waiting for or under review. */
export const isEditable = (status: string) => status === "submitted" || status === "in_review";

/** Default validity date: today + N days, as YYYY-MM-DD. */
export function defaultValidUntil(days: number, today: Date = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days));
  return d.toISOString().slice(0, 10);
}

/** What sales may do with a quote in each status. */
export function allowedActions(status: string): { save: boolean; send: boolean; cancel: boolean; reopen: boolean; convert: boolean } {
  return {
    save: isEditable(status),
    send: isEditable(status),
    cancel: ["submitted", "in_review", "sent"].includes(status),
    reopen: status === "sent",
    convert: status === "accepted",
  };
}
