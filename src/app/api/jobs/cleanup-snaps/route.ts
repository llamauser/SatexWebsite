import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/db/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEP_DAYS = 30;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Daily (vercel.json): deletes the photos of Snap & Match searches that are older than 30 days. */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let sb;
  try {
    sb = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "backend not configured" }, { status: 503 });
  }
  const limit = Date.now() - KEEP_DAYS * 86_400_000;
  const old: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await sb.storage.from("snap-uploads").list("", { limit: 100, offset, sortBy: { column: "created_at", order: "asc" } });
    if (error || !data || data.length === 0) break;
    for (const f of data) if (f.created_at && Date.parse(f.created_at) < limit) old.push(f.name);
    if (data.length < 100 || old.length >= 500) break;
  }
  if (old.length > 0) await sb.storage.from("snap-uploads").remove(old);
  return NextResponse.json({ deleted: old.length });
}
