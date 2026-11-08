import { render } from "@react-email/render";
import { createTranslator } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { TEMPLATES, type EmailTemplate } from "./registry";

export type EmailLocale = "fr" | "en" | "ar";
const MESSAGES = { fr, en, ar } as const;

export interface EmailInput {
  template: EmailTemplate;
  locale: EmailLocale;
  /** Facts of the email (reference, total, ...). Already formatted for the recipient's language. */
  vars: Record<string, string>;
  recipientName?: string;
  siteUrl: string;
  company: string;
  email: string;
  foundedYear: number;
}
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** The button target, absolute. */
  url: string | null;
}

// ---- brand (docs/10-design-system.md), inline styles because email clients ignore CSS files
const C = { bg: "#F7F9FB", card: "#FFFFFF", text: "#14243B", muted: "#5B6B7F", border: "#E2E8EE", primary: "#2F74B5", primaryStrong: "#1F4E79" };
const font = "Inter, Helvetica, Arial, 'Segoe UI', Tahoma, sans-serif";

function Shell({ dir, lang, preview, children, footer }: { dir: "ltr" | "rtl"; lang: string; preview: string; children: ReactNode; footer: string }) {
  const align = dir === "rtl" ? "right" : "left";
  const page: CSSProperties = { margin: 0, padding: 0, background: C.bg, fontFamily: font, color: C.text };
  return (
    <html lang={lang} dir={dir}>
      {/* eslint-disable-next-line @next/next/no-head-element -- a standalone email document, not a Next page */}
      <head>
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{preview}</title>
      </head>
      <body style={page}>
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden", opacity: 0 }}>{preview}</div>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ background: C.bg }}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: "24px 12px" }}>
                <table role="presentation" width="600" cellPadding={0} cellSpacing={0} style={{ maxWidth: 600, width: "100%", background: C.card, borderRadius: 16, border: `1px solid ${C.border}` }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "24px 32px 8px", textAlign: align, fontSize: 20, fontWeight: 700, letterSpacing: 0.5 }}>
                        SA<span style={{ color: C.primary }}>TEX</span>{" "}
                        <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: 3, color: C.muted }}>COMMERCE</span>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 32px 32px", textAlign: align, fontSize: 16, lineHeight: 1.6 }}>{children}</td>
                    </tr>
                  </tbody>
                </table>
                <p style={{ maxWidth: 600, margin: "16px auto 0", fontSize: 12, color: C.muted, textAlign: "center" }}>{footer}</p>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

/** Build and render one email (subject, HTML and plain text) in the recipient's language. */
export async function renderEmail(input: EmailInput): Promise<RenderedEmail> {
  const { template, locale } = input;
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "emails" } as never) as unknown as (key: string, values?: Record<string, string | number>) => string;
  const def = TEMPLATES[template];
  const dir = locale === "ar" ? "rtl" : "ltr";
  // a status key (e.g. a sample request status) is shown as translated words
  const vars: Record<string, string> = { ...input.vars };
  if (vars.statusKey) vars.status = t(`sampleStatus.${vars.statusKey}`);
  const values = { name: input.recipientName ?? "", ...vars, company: vars.company ?? input.company };

  const subject = t(`${template}.subject`, values);
  const title = t(`${template}.title`, values);
  const intro = t(`${template}.intro`, values);
  const path = def.link(vars);
  const url = path ? `${input.siteUrl.replace(/\/$/, "")}/${locale}${path}` : null;
  const details = def.details.map((k) => [t(`labels.${k}`), vars[k] ?? ""] as const).filter(([, v]) => v !== "");
  const greeting = input.recipientName ? t("common.greeting", { name: input.recipientName }) : null;
  const footer = `${input.company} · ${t("common.since", { year: input.foundedYear })} · ${input.email}`;

  const element = (
    <Shell dir={dir} lang={locale} preview={subject} footer={footer}>
      {greeting && <p style={{ margin: "0 0 12px" }}>{greeting}</p>}
      <h1 style={{ margin: "0 0 12px", fontSize: 22, lineHeight: 1.3, color: C.text }}>{title}</h1>
      <p style={{ margin: "0 0 16px", color: C.muted }}>{intro}</p>
      {details.length > 0 && (
        <div style={{ margin: "0 0 20px", borderTop: `1px solid ${C.border}` }}>
          {details.map(([label, value]) => (
            <div key={label} style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontSize: 14, whiteSpace: "pre-line" }}>
              <span style={{ color: C.muted }}>{label}: </span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}
      {url && (
        <p style={{ margin: "8px 0 20px" }}>
          <a href={url} style={{ display: "inline-block", background: C.primaryStrong, color: "#FFFFFF", textDecoration: "none", fontWeight: 600, padding: "12px 24px", borderRadius: 999 }}>
            {t(`${template}.cta`)}
          </a>
        </p>
      )}
      <p style={{ margin: "16px 0 0", fontSize: 13, color: C.muted }}>{t("common.help", { email: input.email })}</p>
    </Shell>
  );

  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text, url };
}
