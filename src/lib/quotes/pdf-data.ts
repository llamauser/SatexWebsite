import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localized, type I18nField } from "@/lib/data/format";
import { computeTotals, lineTotal } from "./calc";
import type { QuotePdfData } from "./pdf";

export type QuoteLocale = "fr" | "en" | "ar";

interface AddressRow { kind: "billing" | "shipping"; line1: string; line2: string | null; city: string; postal_code: string | null; country: string; is_default: boolean }
const oneLine = (a: AddressRow | undefined) => (a ? [a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ") : "");

/** Reads a quote with everything its PDF shows. Uses the service client: the caller has already been checked. */
export async function loadQuotePdfData(service: SupabaseClient, quoteId: string): Promise<{ data: QuotePdfData; locale: QuoteLocale } | null> {
  const { data: q } = await service
    .from("quotes")
    .select("id, ref, revision, currency, vat_rate, discount_pct, valid_until, client_message, client_id, created_at, submitted_at, clients(company_name, tax_id), quote_lines(meters, unit_price, sort, fabric_colors(code, name, fabrics(sku, name)))")
    .eq("id", quoteId)
    .maybeSingle();
  if (!q) return null;

  const [{ data: addresses }, { data: profile }, { data: settings }] = await Promise.all([
    service.from("addresses").select("kind, line1, line2, city, postal_code, country, is_default").eq("client_id", q.client_id).order("is_default", { ascending: false }),
    service.from("profiles").select("preferred_locale").eq("client_id", q.client_id).eq("role", "client").order("created_at").limit(1).maybeSingle(),
    service.from("app_settings").select("key, value").in("key", ["company_name", "contact_email", "contact_phone", "contact_address", "founded_year", "quote_terms"]),
  ]);
  const locale = (["fr", "en", "ar"].includes(profile?.preferred_locale ?? "") ? profile!.preferred_locale : "fr") as QuoteLocale;
  const setting = new Map((settings ?? []).map((r) => [r.key as string, r.value as unknown]));
  const text = (k: string, fallback = "") => (typeof setting.get(k) === "string" ? (setting.get(k) as string) : fallback);

  type RawLine = { meters: string | number; unit_price: string | number; sort: number; fabric_colors: { code: string; name: I18nField; fabrics: { sku: string; name: I18nField } } };
  const rawLines = ((q.quote_lines ?? []) as unknown as RawLine[]).sort((a, b) => a.sort - b.sort);
  const lines = rawLines.map((l) => ({
    sku: l.fabric_colors.fabrics.sku, fabric: localized(l.fabric_colors.fabrics.name, locale), color: localized(l.fabric_colors.name, locale), code: l.fabric_colors.code,
    meters: Number(l.meters), unitPrice: Number(l.unit_price), lineTotal: lineTotal(Number(l.meters), Number(l.unit_price)),
  }));
  const discountPct = Number(q.discount_pct);
  const vatRate = Number(q.vat_rate);
  const rows = (addresses ?? []) as AddressRow[];
  const client = q.clients as unknown as { company_name: string; tax_id: string | null } | null;

  return {
    locale,
    data: {
      ref: q.ref ?? "", revision: q.revision, date: (q.submitted_at ?? q.created_at) as string, validUntil: q.valid_until, currency: q.currency ?? "EUR", vatRate, discountPct,
      totals: computeTotals(lines, discountPct, vatRate), clientMessage: q.client_message,
      company: { name: text("company_name", "SATEX Commerce"), email: text("contact_email"), phone: text("contact_phone"), address: text("contact_address"), foundedYear: Number(setting.get("founded_year")) || 1995 },
      client: { company: client?.company_name ?? "", taxId: client?.tax_id ?? "", billing: oneLine(rows.find((a) => a.kind === "billing")), shipping: oneLine(rows.find((a) => a.kind === "shipping")) },
      lines,
      terms: typeof setting.get("quote_terms") === "object" ? localized(setting.get("quote_terms") as I18nField, locale) : text("quote_terms"),
    },
  };
}
