"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Loads the Supabase browser client on demand, so the ~40 kB client library is NOT part of the initial JavaScript of
 * every page (only forms and signed-in users need it). See docs/11-non-functional.md §1.
 */
export async function loadBrowserSupabase(): Promise<SupabaseClient | null> {
  const { getBrowserSupabase } = await import("./browser");
  return getBrowserSupabase();
}

/** True when Supabase's auth cookie is present: lets guests skip loading the client entirely. */
export function hasAuthCookie(): boolean {
  return document.cookie.split("; ").some((c) => /^sb-.+-auth-token/.test(c));
}
