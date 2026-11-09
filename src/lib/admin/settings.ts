/** The settings the admin can edit (table app_settings): their type, group and limits. Pure and unit-tested. */
export type SettingType = "text" | "email" | "number" | "percent" | "bool" | "i18n" | "locale" | "currency";
export interface SettingDef {
  key: string;
  type: SettingType;
  group: "company" | "commerce" | "limits" | "notifications";
  min?: number;
  max?: number;
  integer?: boolean;
}

export const SETTINGS: SettingDef[] = [
  { key: "company_name", type: "text", group: "company" },
  { key: "tagline", type: "i18n", group: "company" },
  { key: "contact_email", type: "email", group: "company" },
  { key: "contact_phone", type: "text", group: "company" },
  { key: "contact_address", type: "text", group: "company" },
  { key: "whatsapp", type: "text", group: "company" },
  { key: "founded_year", type: "number", group: "company", min: 1800, max: 2100, integer: true },
  { key: "currency", type: "currency", group: "commerce" },
  { key: "vat_rate", type: "percent", group: "commerce", min: 0, max: 1 },
  { key: "show_prices_public", type: "bool", group: "commerce" },
  { key: "timezone", type: "text", group: "commerce" },
  { key: "quote_validity_days", type: "number", group: "commerce", min: 1, max: 365, integer: true },
  { key: "low_stock_threshold_m", type: "number", group: "limits", min: 0, max: 100000 },
  { key: "reservation_hours", type: "number", group: "limits", min: 1, max: 720, integer: true },
  { key: "max_active_reservations_per_client", type: "number", group: "limits", min: 1, max: 50, integer: true },
  { key: "max_colors_per_sample_request", type: "number", group: "limits", min: 1, max: 20, integer: true },
  { key: "max_open_sample_requests_per_client", type: "number", group: "limits", min: 1, max: 20, integer: true },
  { key: "match_rate_limit_per_hour_guest", type: "number", group: "limits", min: 1, max: 1000, integer: true },
  { key: "match_rate_limit_per_hour_user", type: "number", group: "limits", min: 1, max: 1000, integer: true },
  { key: "staff_notification_email", type: "email", group: "notifications" },
  { key: "staff_locale", type: "locale", group: "notifications" },
];
export const GROUPS = ["company", "commerce", "limits", "notifications"] as const;
export const CURRENCIES = ["EUR", "USD", "TND", "MAD", "DZD", "GBP", "AED", "SAR"] as const;
export const defOf = (key: string) => SETTINGS.find((s) => s.key === key);

export type SettingIssue = "required" | "number" | "range" | "integer" | "email" | "locale" | "currency" | "i18n";

/** Turns what was typed into the JSON value to store, or says what is wrong. */
export function coerceSetting(def: SettingDef, input: unknown): { ok: true; value: unknown } | { ok: false; issue: SettingIssue } {
  switch (def.type) {
    case "bool":
      return typeof input === "boolean" ? { ok: true, value: input } : { ok: false, issue: "required" };
    case "text": {
      const v = String(input ?? "").trim();
      if (def.key === "company_name" && v === "") return { ok: false, issue: "required" };
      return { ok: true, value: v };
    }
    case "email": {
      const v = String(input ?? "").trim();
      if (v === "" ) return { ok: false, issue: "required" };
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? { ok: true, value: v } : { ok: false, issue: "email" };
    }
    case "number":
    case "percent": {
      const raw = String(input ?? "").trim().replace(",", ".");
      if (raw === "") return { ok: false, issue: "required" };
      // a percentage is typed as 20 (%) and stored as 0.20
      const typed = Number(raw);
      if (!Number.isFinite(typed)) return { ok: false, issue: "number" };
      const n = def.type === "percent" ? Math.round(typed * 100) / 10000 : typed;
      if (def.integer && !Number.isInteger(n)) return { ok: false, issue: "integer" };
      if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) return { ok: false, issue: "range" };
      return { ok: true, value: n };
    }
    case "locale":
      return ["fr", "en", "ar"].includes(String(input)) ? { ok: true, value: String(input) } : { ok: false, issue: "locale" };
    case "currency":
      return (CURRENCIES as readonly string[]).includes(String(input)) ? { ok: true, value: String(input) } : { ok: false, issue: "currency" };
    case "i18n": {
      const o = (input ?? {}) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const l of ["fr", "en", "ar"]) {
        const v = typeof o[l] === "string" ? (o[l] as string).trim() : "";
        if (v) out[l] = v;
      }
      return out.fr ? { ok: true, value: out } : { ok: false, issue: "i18n" };
    }
  }
}

/** The value as shown in a form field (percentages as 20, not 0.2). */
export function displayValue(def: SettingDef, value: unknown): string {
  if (def.type === "percent") return typeof value === "number" ? String(Math.round(value * 10000) / 100) : "";
  if (def.type === "bool") return value === true ? "true" : "false";
  if (def.type === "i18n") return JSON.stringify(value ?? {});
  return value === null || value === undefined ? "" : String(value);
}
