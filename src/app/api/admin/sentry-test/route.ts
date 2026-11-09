import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/db/server";
import { createServiceSupabase } from "@/lib/db/service";

export const dynamic = "force-dynamic";

/**
 * "Does error monitoring work?" Admins only. Sends one test error to Sentry and says whether monitoring is switched on.
 * Used once at launch (docs/launch-checklist.md) and after changing the DSN.
 */
export async function POST() {
  const sb = await createServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: profile } = await createServiceSupabase().from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (!process.env.SENTRY_DSN) return NextResponse.json({ sent: false, reason: "SENTRY_DSN is not set" });
  const Sentry = await import("@sentry/nextjs");
  const eventId = Sentry.captureException(new Error("SATEX test error (sent from the back-office)"));
  const flushed = await Sentry.flush(3000);
  return NextResponse.json({ sent: true, eventId, flushed });
}
