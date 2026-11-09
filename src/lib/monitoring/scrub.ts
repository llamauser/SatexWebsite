/**
 * Removes personal data from an error report before it leaves the server or the browser (docs/11-non-functional.md §5, §7):
 * cookies and authorization headers, request bodies, the user's e-mail and IP address, and tokens in URLs.
 * Pure and unit-tested; the shape is the part of a Sentry event that can carry such data.
 */
export interface ScrubbableEvent {
  user?: { id?: string; email?: string; username?: string; ip_address?: string } & Record<string, unknown>;
  request?: { url?: string; cookies?: unknown; headers?: Record<string, unknown>; data?: unknown; query_string?: unknown } & Record<string, unknown>;
  breadcrumbs?: { data?: Record<string, unknown>; message?: string }[];
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

const SENSITIVE_HEADERS = /^(authorization|cookie|set-cookie|x-forwarded-for|x-real-ip|apikey|x-supabase-auth)$/i;
const TOKEN_PARAMS = /([?&#](?:access_token|refresh_token|token|code|key|apikey|password|email)=)[^&#\s]*/gi;

export const scrubUrl = (url: string) => url.replace(TOKEN_PARAMS, "$1[removed]");

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {}; // an id is enough to find a case; no e-mail, name or IP
  const req = event.request;
  if (req) {
    delete req.cookies;
    delete req.data;
    delete req.query_string;
    if (req.url) req.url = scrubUrl(req.url);
    if (req.headers) for (const k of Object.keys(req.headers)) if (SENSITIVE_HEADERS.test(k)) delete req.headers[k];
  }
  for (const b of event.breadcrumbs ?? []) {
    if (b.data) for (const k of Object.keys(b.data)) if (typeof b.data[k] === "string" && /^https?:/.test(b.data[k] as string)) b.data[k] = scrubUrl(b.data[k] as string);
    if (b.message) b.message = scrubUrl(b.message);
  }
  return event;
}
