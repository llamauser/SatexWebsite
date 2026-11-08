/**
 * The transactional emails of Phase 1 (docs/05-commerce.md §8). Text lives in messages/*.json under `emails.<key>`;
 * this registry says who receives each one, which facts are listed in it and where its button leads.
 */
export const EMAIL_TEMPLATES = [
  "account_welcome",
  "quote_submitted_client",
  "quote_submitted_staff",
  "quote_sent",
  "quote_accepted_staff",
  "quote_rejected_staff",
  "quote_expired",
  "order_confirmed",
  "order_ready",
  "delivery_in_transit",
  "delivery_delivered",
  "sample_status_changed",
  "sample_requested_staff",
  "reservation_created",
  "reservation_expiring",
  "reservation_expired",
  "contact_message_staff",
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export type Audience = "client" | "staff" | "user";

export interface TemplateDef {
  audience: Audience;
  /** Also create an in-app notification (bell) for client recipients. */
  notify: boolean;
  /** Facts listed under the text: keys of the variables, labels are `emails.labels.<key>`. */
  details: string[];
  /** Path (without locale) the button leads to, built from the variables; null = no button. */
  link: (v: Record<string, string>) => string | null;
}

export const TEMPLATES: Record<EmailTemplate, TemplateDef> = {
  account_welcome: { audience: "user", notify: true, details: [], link: () => "/account" },
  quote_submitted_client: { audience: "client", notify: true, details: ["ref", "total"], link: (v) => `/account/quotes/${v.id}` },
  quote_submitted_staff: { audience: "staff", notify: false, details: ["ref", "company", "total"], link: (v) => `/admin/quotes/${v.id}` },
  quote_sent: { audience: "client", notify: true, details: ["ref", "total", "validUntil"], link: (v) => `/account/quotes/${v.id}` },
  quote_accepted_staff: { audience: "staff", notify: false, details: ["ref", "company", "total"], link: (v) => `/admin/quotes/${v.id}` },
  quote_rejected_staff: { audience: "staff", notify: false, details: ["ref", "company", "reason"], link: (v) => `/admin/quotes/${v.id}` },
  quote_expired: { audience: "client", notify: true, details: ["ref"], link: (v) => `/account/quotes/${v.id}` },
  order_confirmed: { audience: "client", notify: true, details: ["ref", "total"], link: (v) => `/account/orders/${v.id}` },
  order_ready: { audience: "client", notify: true, details: ["ref"], link: (v) => `/account/orders/${v.id}` },
  delivery_in_transit: { audience: "client", notify: true, details: ["ref", "carrier", "tracking"], link: (v) => `/account/orders/${v.orderId}` },
  delivery_delivered: { audience: "client", notify: true, details: ["ref"], link: (v) => `/account/orders/${v.orderId}` },
  sample_status_changed: { audience: "client", notify: true, details: ["ref", "status", "carrier", "tracking"], link: () => "/account/samples" },
  sample_requested_staff: { audience: "staff", notify: false, details: ["ref", "company"], link: () => "/admin/samples" },
  reservation_created: { audience: "client", notify: true, details: ["fabric", "color", "meters", "expires"], link: () => "/account/reservations" },
  reservation_expiring: { audience: "client", notify: true, details: ["fabric", "color", "meters", "expires"], link: () => "/account/reservations" },
  reservation_expired: { audience: "client", notify: true, details: ["fabric", "color", "meters"], link: () => "/account/reservations" },
  contact_message_staff: { audience: "staff", notify: false, details: ["name", "company", "email", "phone", "message"], link: () => "/admin/messages" },
};

export const isEmailTemplate = (v: unknown): v is EmailTemplate => typeof v === "string" && (EMAIL_TEMPLATES as readonly string[]).includes(v);
