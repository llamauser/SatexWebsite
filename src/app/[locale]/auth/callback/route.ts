import { NextResponse } from "next/server";
import { safeNext } from "@/lib/auth/guard";
import { supabaseEnv } from "@/lib/db/env";
import { createServerSupabase } from "@/lib/db/server";

/** Email links (confirm sign-up, magic link, password recovery) land here with ?code=... (PKCE). */
export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"), `/${locale}/account`);

  if (code && supabaseEnv()) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    // The link itself was valid (the code was issued) but this browser is not the one that asked for it, so it cannot finish the sign-in.
    // For a confirmation link the e-mail address is confirmed anyway.
    return NextResponse.redirect(new URL(`/${locale}/auth/sign-in?error=browser`, url.origin));
  }
  return NextResponse.redirect(new URL(`/${locale}/auth/sign-in?error=link`, url.origin));
}
