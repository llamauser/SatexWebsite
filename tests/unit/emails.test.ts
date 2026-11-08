import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES, TEMPLATES, type EmailTemplate } from "../../src/emails/registry";
import { renderEmail, type EmailLocale } from "../../src/emails/render";

const SAMPLE: Record<EmailTemplate, Record<string, string>> = {
  account_welcome: { id: "u1" },
  quote_submitted_client: { id: "q1", ref: "Q-2026-000123", total: "1 234,50 €" },
  quote_submitted_staff: { id: "q1", ref: "Q-2026-000123", company: "Atelier Nour", total: "1 234,50 €" },
  quote_sent: { id: "q1", ref: "Q-2026-000123", total: "1 234,50 €", validUntil: "15 nov. 2026" },
  quote_accepted_staff: { id: "q1", ref: "Q-2026-000123", company: "Atelier Nour", total: "1 234,50 €" },
  quote_rejected_staff: { id: "q1", ref: "Q-2026-000123", company: "Atelier Nour", reason: "Prix trop élevé" },
  quote_expired: { id: "q1", ref: "Q-2026-000123" },
  order_confirmed: { id: "o1", ref: "O-2026-000045", total: "1 234,50 €" },
  order_ready: { id: "o1", ref: "O-2026-000045" },
  delivery_in_transit: { id: "d1", orderId: "o1", ref: "O-2026-000045", carrier: "DHL", tracking: "JD0146001" },
  delivery_delivered: { id: "d1", orderId: "o1", ref: "O-2026-000045" },
  sample_status_changed: { id: "s1", ref: "S-2026-000007", statusKey: "shipped", carrier: "Colissimo", tracking: "6A02001" },
  sample_requested_staff: { id: "s1", ref: "S-2026-000007", company: "Maison Lina" },
  reservation_created: { id: "r1", fabric: "Piqué coton / élasthanne", color: "Bleu marine", meters: "25 m", expires: "10 nov. 2026, 14:30" },
  reservation_expiring: { id: "r1", fabric: "Piqué coton / élasthanne", color: "Bleu marine", meters: "25 m", expires: "10 nov. 2026, 14:30" },
  reservation_expired: { id: "r1", fabric: "Piqué coton / élasthanne", color: "Bleu marine", meters: "25 m", expires: "10 nov. 2026, 14:30" },
  contact_message_staff: { id: "m1", name: "Camille", company: "Atelier E2E", email: "camille@example.com", phone: "+33 1 23 45 67 89", message: "Bonjour, je cherche un jersey.\nMerci." },
};

const base = { siteUrl: "https://satex.example", company: "SATEX Commerce", email: "contact@satex.example", foundedYear: 1995 };
const LOCALES: EmailLocale[] = ["fr", "en", "ar"];

describe("email templates", () => {
  it("the registry and the samples cover the same 17 emails", () => {
    expect(EMAIL_TEMPLATES).toHaveLength(17);
    expect(Object.keys(SAMPLE).sort()).toEqual([...EMAIL_TEMPLATES].sort());
    expect(Object.keys(TEMPLATES).sort()).toEqual([...EMAIL_TEMPLATES].sort());
  });

  for (const template of EMAIL_TEMPLATES) {
    for (const locale of LOCALES) {
      it(`${template} renders in ${locale}`, async () => {
        const staff = TEMPLATES[template].audience === "staff";
        const mail = await renderEmail({ template, locale, vars: SAMPLE[template], recipientName: staff ? undefined : "Nour Haddad", ...base });

        // complete, readable and fully filled in
        expect(mail.subject.length).toBeGreaterThan(5);
        for (const text of [mail.subject, mail.text]) expect(text).not.toMatch(/\{\w+\}|undefined|\[object/);
        expect(mail.html).toContain(`lang="${locale}"`);
        expect(mail.html).toContain(locale === "ar" ? 'dir="rtl"' : 'dir="ltr"');
        if (locale === "ar") expect(mail.subject).toMatch(/[؀-ۿ]/);
        // greeting only for named recipients
        expect(/Nour Haddad/.test(mail.text)).toBe(!staff);
        // the button points to the page in the recipient's language
        const path = TEMPLATES[template].link(SAMPLE[template]!);
        if (path) {
          expect(mail.url).toBe(`https://satex.example/${locale}${path}`);
          expect(mail.html).toContain(`href="https://satex.example/${locale}${path}"`);
        }
        // every listed fact appears
        for (const key of TEMPLATES[template].details) {
          const value = key === "status" ? null : SAMPLE[template]![key];
          if (value) expect(mail.text.replace(/\s+/g, " ")).toContain(value.split("\n")[0]!);
        }
        expect({ subject: mail.subject, text: mail.text }).toMatchSnapshot();
      });
    }
  }

  it("a sample status is shown as translated words", async () => {
    const fr = await renderEmail({ template: "sample_status_changed", locale: "fr", vars: SAMPLE.sample_status_changed, ...base });
    const ar = await renderEmail({ template: "sample_status_changed", locale: "ar", vars: SAMPLE.sample_status_changed, ...base });
    expect(fr.subject).toBe("Échantillons S-2026-000007 : Expédié");
    expect(ar.subject).toContain("تم الشحن");
  });

  it("the contact sender's name is used in the subject (it is not replaced by the recipient)", async () => {
    const mail = await renderEmail({ template: "contact_message_staff", locale: "fr", vars: SAMPLE.contact_message_staff, ...base });
    expect(mail.subject).toBe("Nouveau message de contact — Camille");
  });

  it("escapes HTML coming from users", async () => {
    const mail = await renderEmail({
      template: "contact_message_staff", locale: "en", ...base,
      vars: { ...SAMPLE.contact_message_staff, message: '<script>alert("x")</script>' },
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
