import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseEnv } from "@/lib/db/env";

export const dynamic = "force-dynamic";

/**
 * Liveness check for the uptime monitor (docs/11-non-functional.md §7): the app answers, and the database answers a trivial
 * query. Public by design and says nothing about the data: only "ok" or "down".
 */
export async function GET() {
  const env = supabaseEnv();
  let db: "ok" | "down" | "unconfigured" = "unconfigured";
  if (env) {
    try {
      const sb = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await sb.from("public_settings").select("key", { head: true, count: "exact" }).abortSignal(AbortSignal.timeout(3000));
      db = error ? "down" : "ok";
    } catch {
      db = "down";
    }
  }
  const ok = db !== "down";
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", db, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev", time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
