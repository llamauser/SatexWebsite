import { createServerClient } from "@supabase/ssr";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { guard, needsSession, splitLocale } from "./lib/auth/guard";
import { supabaseEnv } from "./lib/db/env";
import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);

/** Redirect while keeping the cookies the session refresh may have set. */
function redirectKeepingCookies(url: URL, from: NextResponse): NextResponse {
  const res = NextResponse.redirect(url);
  for (const c of from.cookies.getAll()) res.cookies.set(c);
  return res;
}

// Order: 1) locale detection / prefix redirects (next-intl)  2) session refresh + route guard (Supabase)
export default async function middleware(request: NextRequest) {
  const response = intl(request);
  if (response.headers.has("location")) return response; // locale redirect, nothing else to do

  const env = supabaseEnv();
  const parts = splitLocale(request.nextUrl.pathname);
  if (!env || !parts || !needsSession(parts.rest)) return response;

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims verifies the JWT and refreshes an expired session; the role comes from the access-token hook.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;
  const role = claims ? String((claims as Record<string, unknown>).user_role ?? "client") : null;

  const decision = guard(parts.rest, role);
  const base = request.nextUrl.origin;
  if (decision === "sign-in") {
    const next = encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search);
    return redirectKeepingCookies(new URL(`/${parts.locale}/auth/sign-in?next=${next}`, base), response);
  }
  if (decision === "forbidden") return redirectKeepingCookies(new URL(`/${parts.locale}/forbidden`, base), response);
  if (decision === "to-account") return redirectKeepingCookies(new URL(`/${parts.locale}/account`, base), response);
  return response;
}

export const config = {
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};
