import { cookies } from "next/headers";
import { z } from "zod";
import { createServerSupabase } from "@/lib/db/server";
import { createServiceSupabase } from "@/lib/db/service";
import { supabaseEnv } from "@/lib/db/env";
import { isOwner, loadSession } from "@/lib/match/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ sessionId: z.uuid(), value: z.union([z.literal(1), z.literal(-1)]) });

/** Thumbs up / down on a match session (owner only). */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });

  let sb;
  try {
    sb = createServiceSupabase();
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  let userId: string | null = null;
  if (supabaseEnv()) {
    try {
      userId = (await (await createServerSupabase()).auth.getUser()).data.user?.id ?? null;
    } catch {
      userId = null;
    }
  }
  const session = await loadSession(sb, parsed.data.sessionId);
  if (!session) return Response.json({ error: "not_found" }, { status: 404 });
  if (!isOwner(session, { userId, token: (await cookies()).get("satex_match")?.value ?? null })) return Response.json({ error: "forbidden" }, { status: 403 });

  await sb.from("match_sessions").update({ feedback: parsed.data.value }).eq("id", session.id);
  return Response.json({ ok: true });
}
