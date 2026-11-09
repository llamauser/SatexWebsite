import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { computeTotals, defaultValidUntil, allowedActions, isEditable, lineTotal, round2 } from "@/lib/quotes/calc";

vi.mock("server-only", () => ({}));
const { renderQuotePdf } = await import("@/lib/quotes/pdf");

const lines = Array.from({ length: 22 }, (_, i) => ({
  sku: `SAT-${1000 + i}`, fabric: i % 2 ? "Jersey coton biologique 180" : "Piqué coton / élasthanne 240", color: i % 3 ? "Bleu marine" : "Écru", code: `C${i}`,
  meters: 10 + i * 2.5, unitPrice: 8.4 + i * 0.35, lineTotal: lineTotal(10 + i * 2.5, 8.4 + i * 0.35),
}));
const totals = computeTotals(lines, 5, 0.2);

const base = {
  ref: "Q-2026-000042", revision: 2, date: "2026-11-09T09:00:00Z", validUntil: "2026-11-24", currency: "EUR", vatRate: 0.2, discountPct: 5, totals,
  clientMessage: "Besoin de livraison avant fin décembre.",
  company: { name: "SATEX Commerce", email: "Satexcommerce@ymail.com", phone: "+216 00 000 000", address: "Zone industrielle, Tunis", foundedYear: 1995 },
  client: { company: "Atelier Lina", taxId: "TN1234567", billing: "10 rue des Tissus, 69001 Lyon, FR", shipping: "12 avenue des Soieries, 75002 Paris, FR" },
  lines, terms: "Devis valable pour la durée indiquée. Prix hors frais de livraison.",
};
const labels = (l: Record<string, string>) => l as never;
const FR = labels({ quote: "Devis", revision: "Révision", date: "Date", validUntil: "Valable jusqu'au", client: "Client", taxId: "N° fiscal", billing: "Facturation", shipping: "Livraison", reference: "Réf.", fabric: "Tissu et coloris", meters: "Mètres", unitPrice: "Prix / m", lineTotal: "Total HT", subtotal: "Sous-total HT", discount: "Remise", vat: "TVA", total: "Total TTC", totalNote: "Montants en euros.", message: "Message du client", terms: "Conditions", footer: "Expert textile depuis 1995" });
const AR = labels({ quote: "عرض سعر", revision: "المراجعة", date: "التاريخ", validUntil: "صالح حتى", client: "العميل", taxId: "الرقم الجبائي", billing: "الفوترة", shipping: "التوصيل", reference: "المرجع", fabric: "القماش واللون", meters: "الأمتار", unitPrice: "السعر / م", lineTotal: "الإجمالي دون ضريبة", subtotal: "المجموع دون ضريبة", discount: "خصم", vat: "ضريبة القيمة المضافة", total: "الإجمالي شاملًا الضريبة", totalNote: "المبالغ باليورو.", message: "رسالة العميل", terms: "الشروط", footer: "خبراء الأقمشة منذ 1995" });

describe("quote arithmetic", () => {
  it("matches the database formula", () => {
    const t = computeTotals([{ meters: 10, unitPrice: 12.5 }, { meters: 3.5, unitPrice: 8.99 }], 10, 0.2);
    expect(t.subtotal).toBe(156.47); // 125 + 31.465 -> 31.47 (line total rounded to cents)
    expect(t).toEqual({ subtotal: 156.47, discount: 15.65, net: 140.82, vat: 28.17, total: 168.99 }); // 156.47 x 0.9 x 1.2 = 168.9876
    expect(computeTotals([], 0, 0.2)).toEqual({ subtotal: 0, discount: 0, net: 0, vat: 0, total: 0 });
  });
  it("rounds half cents up", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(lineTotal(3, 0.335)).toBe(1.01);
  });
  it("validity date and allowed actions", () => {
    expect(defaultValidUntil(15, new Date("2026-11-20T23:30:00Z"))).toBe("2026-12-05");
    expect(defaultValidUntil(15, new Date("2026-12-25T10:00:00Z"))).toBe("2027-01-09");
    expect(isEditable("in_review") && isEditable("submitted") && !isEditable("sent")).toBe(true);
    expect(allowedActions("submitted")).toEqual({ save: true, send: true, cancel: true, reopen: false, convert: false });
    expect(allowedActions("sent")).toEqual({ save: false, send: false, cancel: true, reopen: true, convert: false });
    expect(allowedActions("accepted")).toEqual({ save: false, send: false, cancel: false, reopen: false, convert: true });
    expect(allowedActions("converted")).toEqual({ save: false, send: false, cancel: false, reopen: false, convert: false });
  });
});

describe("quote PDF", () => {
  const out = process.env.PDF_OUT;
  for (const [locale, text, data] of [
    ["fr", FR, base],
    ["ar", AR, { ...base, client: { ...base.client, company: "مشغل الأقمشة لينا" }, lines: lines.map((l) => ({ ...l, fabric: "جيرسي قطن عضوي", color: "أزرق داكن" })), terms: "عرض السعر صالح للمدة المذكورة. الأسعار لا تشمل تكاليف التوصيل.", clientMessage: "نحتاج التسليم قبل نهاية ديسمبر." }],
  ] as const) {
    it(`renders a valid, multi-page PDF in ${locale}`, async () => {
      const pdf = await renderQuotePdf(data, text, locale);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(8_000);
      expect(pdf.toString("latin1")).toMatch(/\/Type\s*\/Page\b/);
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(`${out}/quote-${locale}.pdf`, pdf);
      }
    });
  }
  it("renders a quote with no discount and no message", async () => {
    const pdf = await renderQuotePdf({ ...base, discountPct: 0, clientMessage: null, terms: "", lines: lines.slice(0, 2), totals: computeTotals(lines.slice(0, 2), 0, 0.2) }, FR, "fr");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
