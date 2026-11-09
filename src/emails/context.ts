import type { SupabaseClient } from "@supabase/supabase-js";
import { formatMoney } from "@/lib/data/format";
import type { JobPayload } from "@/lib/jobs/runner";
import { TEMPLATES, isEmailTemplate, type EmailTemplate } from "./registry";
import type { EmailLocale } from "./render";

export interface Recipient {
  email: string;
  locale: EmailLocale;
  name: string;
  userId: string | null;
}
export interface EmailJob {
  template: EmailTemplate;
  entityId: string;
  recipients: Recipient[];
  /** Facts of the email, formatted for one language. */
  vars: (locale: EmailLocale) => Record<string, string>;
  /** A file kept in Storage that goes with the email (the quote PDF). */
  attachment?: { bucket: string; path: string; filename: string };
}
export interface SiteSettings {
  company: string;
  email: string;
  foundedYear: number;
  timezone: string;
}

const asLocale = (v: unknown): EmailLocale => (v === "en" || v === "ar" ? v : "fr");
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const money = (amount: unknown, currency: unknown, locale: EmailLocale) => formatMoney(Number(amount), text(currency) || "EUR", locale);

export function formatDateTime(iso: string | null | undefined, locale: EmailLocale, timeZone: string, withTime = true): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}), timeZone }).format(new Date(iso));
}

export async function loadSiteSettings(sb: SupabaseClient): Promise<SiteSettings & { staffEmail: string; staffLocale: EmailLocale }> {
  const { data } = await sb.from("app_settings").select("key, value");
  const map = new Map<string, unknown>((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  const s = (k: string, d: string) => (typeof map.get(k) === "string" && map.get(k) ? (map.get(k) as string) : d);
  return {
    company: s("company_name", "SATEX Commerce"),
    email: s("contact_email", "Satexcommerce@ymail.com"),
    foundedYear: typeof map.get("founded_year") === "number" ? (map.get("founded_year") as number) : 1995,
    timezone: s("timezone", "Europe/Paris"),
    staffEmail: s("staff_notification_email", s("contact_email", "Satexcommerce@ymail.com")),
    staffLocale: asLocale(map.get("staff_locale")),
  };
}

async function userRecipient(sb: SupabaseClient, userId: string): Promise<Recipient | null> {
  const [{ data: profile }, { data: auth }] = await Promise.all([
    sb.from("profiles").select("full_name, preferred_locale").eq("id", userId).maybeSingle(),
    sb.auth.admin.getUserById(userId),
  ]);
  const email = auth?.user?.email;
  if (!email) return null;
  return { email, locale: asLocale(profile?.preferred_locale), name: profile?.full_name ?? "", userId };
}

async function clientRecipients(sb: SupabaseClient, clientId: string): Promise<Recipient[]> {
  const { data } = await sb.from("profiles").select("id").eq("client_id", clientId).eq("role", "client");
  const all = await Promise.all(((data ?? []) as { id: string }[]).map((p) => userRecipient(sb, p.id)));
  return all.filter((r): r is Recipient => r !== null);
}

const staffRecipient = (settings: Awaited<ReturnType<typeof loadSiteSettings>>): Recipient[] => [
  { email: settings.staffEmail, locale: settings.staffLocale, name: "", userId: null },
];

/**
 * Turns a queue message ({template, id}) into who gets which email with which facts. Returns null when the entity no
 * longer exists (nothing to send). Throws on unknown templates (the job is retried, then archived).
 */
export async function loadEmailJob(sb: SupabaseClient, message: JobPayload, settings: Awaited<ReturnType<typeof loadSiteSettings>>): Promise<EmailJob | null> {
  const template = message.template;
  if (!isEmailTemplate(template)) throw new Error(`unknown email template "${String(template)}"`);
  const id = text(message.id);
  if (!id) throw new Error("email job without an entity id");
  const def = TEMPLATES[template];
  const tz = settings.timezone;

  const job = (recipients: Recipient[], vars: (l: EmailLocale) => Record<string, string>): EmailJob => ({ template, entityId: id, recipients, vars });

  switch (template) {
    case "contact_message_staff": {
      const { data } = await sb.from("contact_messages").select("id, name, company, email, phone, message").eq("id", id).maybeSingle();
      if (!data) return null;
      return job(staffRecipient(settings), () => ({ id, name: text(data.name), company: text(data.company), email: text(data.email), phone: text(data.phone), message: text(data.message) }));
    }
    case "account_welcome": {
      const r = await userRecipient(sb, id);
      return r ? job([r], () => ({ id })) : null;
    }
    case "reservation_created":
    case "reservation_expiring":
    case "reservation_expired": {
      const { data } = await sb
        .from("stock_reservations")
        .select("id, client_id, meters, expires_at, fabric_colors(name, fabrics(name))")
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      const color = data.fabric_colors as unknown as { name: Record<string, string>; fabrics: { name: Record<string, string> } } | null;
      return job(await clientRecipients(sb, data.client_id), (l) => ({
        id,
        fabric: color?.fabrics?.name?.[l] || color?.fabrics?.name?.fr || "",
        color: color?.name?.[l] || color?.name?.fr || "",
        meters: `${Number(data.meters)} m`,
        expires: formatDateTime(data.expires_at, l, tz),
      }));
    }
    case "quote_submitted_client":
    case "quote_submitted_staff":
    case "quote_sent":
    case "quote_accepted_staff":
    case "quote_rejected_staff":
    case "quote_expired": {
      const { data } = await sb
        .from("quotes")
        .select("id, ref, client_id, total, currency, valid_until, rejection_reason, pdf_path, revision, clients(company_name)")
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      const company = (data.clients as unknown as { company_name: string } | null)?.company_name ?? "";
      const recipients = def.audience === "staff" ? staffRecipient(settings) : await clientRecipients(sb, data.client_id);
      const quoteJob = job(recipients, (l) => ({
        id, ref: text(data.ref), company, total: money(data.total, data.currency, l), validUntil: formatDateTime(data.valid_until, l, tz, false), reason: text(data.rejection_reason),
      }));
      // the quote the client receives comes with its PDF
      if (template === "quote_sent" && data.pdf_path) quoteJob.attachment = { bucket: "quote-pdfs", path: data.pdf_path, filename: `${text(data.ref) || "quote"}.pdf` };
      return quoteJob;
    }
    case "order_confirmed":
    case "order_ready": {
      const { data } = await sb.from("orders").select("id, ref, client_id, total, currency").eq("id", id).maybeSingle();
      if (!data) return null;
      return job(await clientRecipients(sb, data.client_id), (l) => ({ id, ref: text(data.ref), total: money(data.total, data.currency, l) }));
    }
    case "delivery_in_transit":
    case "delivery_delivered": {
      const { data } = await sb.from("deliveries").select("id, carrier, tracking_number, orders(id, ref, client_id)").eq("id", id).maybeSingle();
      if (!data) return null;
      const order = data.orders as unknown as { id: string; ref: string; client_id: string } | null;
      if (!order) return null;
      return job(await clientRecipients(sb, order.client_id), () => ({ id, orderId: order.id, ref: text(order.ref), carrier: text(data.carrier), tracking: text(data.tracking_number) }));
    }
    case "sample_status_changed":
    case "sample_requested_staff": {
      const { data } = await sb
        .from("sample_requests")
        .select("id, ref, client_id, status, carrier, tracking_number, clients(company_name)")
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      const company = (data.clients as unknown as { company_name: string } | null)?.company_name ?? "";
      const recipients = def.audience === "staff" ? staffRecipient(settings) : await clientRecipients(sb, data.client_id);
      return job(recipients, () => ({ id, ref: text(data.ref), company, statusKey: text(data.status), carrier: text(data.carrier), tracking: text(data.tracking_number) }));
    }
  }
}
