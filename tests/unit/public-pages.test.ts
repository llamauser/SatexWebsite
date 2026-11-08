import { describe, expect, it } from "vitest";
import { fillLegal, LEGAL } from "../../src/content/legal";
import { digitsOnly, formatMoney, formatNumber, localized } from "../../src/lib/data/format";
import { fieldErrors } from "../../src/lib/validation/auth";
import { contactSchema } from "../../src/lib/validation/contact";

describe("formatting helpers", () => {
  it("uses Latin digits in every locale", () => {
    for (const locale of ["fr", "en", "ar"]) {
      const text = formatMoney(1234.5, "EUR", locale);
      expect(text).not.toMatch(/[٠-٩]/); // Latin digits only
      expect(text.replace(/\D/g, "")).toBe("123450");
      expect(formatNumber(240, locale)).toBe("240");
    }
    expect(formatMoney(9.5, "EUR", "en")).toBe("€9.50");
  });
  it("localized() falls back to French, then empty", () => {
    expect(localized({ fr: "Maille", en: "Knits" }, "en")).toBe("Knits");
    expect(localized({ fr: "Maille", en: "Knits" }, "ar")).toBe("Maille");
    expect(localized({ en: "Knits" }, "fr")).toBe("");
    expect(localized(null, "fr")).toBe("");
  });
  it("digitsOnly keeps just the digits (for tel: and wa.me links)", () => {
    expect(digitsOnly("+33 (0)1 23-45.67")).toBe("330123456" + "7");
  });
});

describe("contact schema", () => {
  const good = { name: "Nour", company: "", email: "nour@example.com", phone: "", message: "Je cherche un jersey de 180 GSM.", consent: true, locale: "fr" };
  it("accepts a valid message with optional fields empty", () => {
    expect(contactSchema.safeParse(good).success).toBe(true);
  });
  it("reports one message key per invalid field", () => {
    const r = contactSchema.safeParse({ ...good, name: "N", email: "nope", phone: "abc", message: "short", consent: false });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(fieldErrors(r.error)).toEqual({ name: "nameMin", email: "email", phone: "phone", message: "messageMin", consent: "consentRequired" });
    }
  });
  it("rejects unknown locales", () => {
    expect(contactSchema.safeParse({ ...good, locale: "de" }).success).toBe(false);
  });
});

describe("legal content", () => {
  it.each(["privacy", "terms"] as const)("%s has the same structure in fr, en and ar and only known placeholders", (doc) => {
    const fr = LEGAL[doc].fr;
    for (const locale of ["en", "ar"] as const) {
      const c = LEGAL[doc][locale];
      expect(c.sections).toHaveLength(fr.sections.length);
      expect(c.sections.map((s) => s.body.length)).toEqual(fr.sections.map((s) => s.body.length));
      expect(c.notice.length).toBeGreaterThan(10);
    }
    for (const locale of ["fr", "en", "ar"] as const) {
      const text = JSON.stringify(LEGAL[doc][locale]);
      const placeholders = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(placeholders.every((p) => p === "company" || p === "email")).toBe(true);
      expect(fillLegal(text, { company: "SATEX", email: "a@b.co" })).not.toMatch(/\{\w+\}/);
    }
    expect(LEGAL[doc].ar.title).toMatch(/[؀-ۿ]/);
  });
});
