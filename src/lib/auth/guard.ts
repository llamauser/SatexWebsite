/**
 * Route protection rules (docs/03-permissions.md, docs/01-sitemap.md). Pure, so it is unit-tested; used by the middleware.
 * The role comes from the `user_role` claim that the access-token hook copies from profiles.role.
 */
export type AppRole = "client" | "sales" | "admin";
export type GuardDecision = "allow" | "sign-in" | "forbidden" | "to-account";

export const LOCALES = ["fr", "en", "ar"] as const;

export function isStaff(role: string | null | undefined): boolean {
  return role === "sales" || role === "admin";
}

/** Split "/fr/account/profile" into { locale: "fr", rest: "/account/profile" }. */
export function splitLocale(pathname: string): { locale: string; rest: string } | null {
  const m = /^\/(fr|en|ar)(\/.*)?$/.exec(pathname);
  if (!m) return null;
  return { locale: m[1]!, rest: m[2] && m[2] !== "/" ? m[2].replace(/\/$/, "") : "/" };
}

/** Does this path need the session to be looked at (so we skip the network call on public pages)? */
export function needsSession(rest: string): boolean {
  return /^\/(account|admin|auth\/(sign-in|sign-up))(\/|$)/.test(rest);
}

export function guard(rest: string, role: string | null): GuardDecision {
  const signedIn = role !== null;
  if (/^\/account(\/|$)/.test(rest)) return signedIn ? "allow" : "sign-in";
  if (/^\/admin(\/|$)/.test(rest)) {
    if (!signedIn) return "sign-in";
    return isStaff(role) ? "allow" : "forbidden";
  }
  if (/^\/auth\/(sign-in|sign-up)(\/|$)/.test(rest)) return signedIn ? "to-account" : "allow";
  return "allow";
}

/** Only allow redirects to locale-prefixed paths on this site (prevents open redirects). */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (!/^\/(fr|en|ar)(\/|\?|#|$)/.test(next)) return fallback;
  if (next.includes("//") || next.includes("\\") || /[\r\n]/.test(next)) return fallback;
  return next;
}

/** Decode a JWT payload without verifying it. For UI hints only: the server never trusts this. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0)))) as Record<string, unknown>;
  } catch {
    return null;
  }
}
