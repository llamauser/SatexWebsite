"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

let client: SupabaseClient | null = null;

/** Browser Supabase client (session kept in cookies so the middleware can read it). Null if not configured. */
export function getBrowserSupabase(): SupabaseClient | null {
  const env = supabaseEnv();
  if (!env) return null;
  client ??= createBrowserClient(env.url, env.anonKey);
  return client;
}
