import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/db/service";
import { handleEmail } from "@/lib/jobs/handlers/email";
import { handleEmbed } from "@/lib/jobs/handlers/embed";
import { handleTranslate } from "@/lib/jobs/handlers/translate";
import { createSupabaseQueue } from "@/lib/jobs/queue";
import { parseRetryDelays, runJobs } from "@/lib/jobs/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never open when the secret is not configured
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Consumed every minute by Vercel Cron (vercel.json), which sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let sb;
  try {
    sb = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "backend not configured" }, { status: 503 });
  }
  const summary = await runJobs({
    queue: createSupabaseQueue(sb),
    handlers: {
      q_embed: (m) => handleEmbed(m, sb),
      q_translate: (m) => handleTranslate(m, sb),
      q_email: (m) => handleEmail(m, sb),
    },
    budgetMs: 50_000,
    retryDelaysS: parseRetryDelays(process.env.JOB_RETRY_DELAYS_S),
    log: (event, data) => console.log(JSON.stringify({ event, ...data })),
  });
  return NextResponse.json(summary);
}
