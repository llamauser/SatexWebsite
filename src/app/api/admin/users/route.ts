import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/db/server";
import { createServiceSupabase } from "@/lib/db/service";

export const dynamic = "force-dynamic";

/**
 * Staff accounts (admins only). Runs with the service role because Auth users and e-mail addresses are not readable from
 * the browser; the caller is checked here, against the database, never against what the browser says.
 */
async function requireAdmin() {
  const sb = await createServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const service = createServiceSupabase();
  const { data: profile } = await service.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  return profile?.role === "admin" ? { id: data.user.id, service } : null;
}

const deny = () => NextResponse.json({ error: "forbidden" }, { status: 403 });

interface UserRow { id: string; email: string; name: string; role: "client" | "sales" | "admin"; createdAt: string }

async function listUsers(service: ReturnType<typeof createServiceSupabase>, q: string): Promise<UserRow[]> {
  const [{ data: auth }, { data: profiles }] = await Promise.all([
    service.auth.admin.listUsers({ perPage: 1000 }),
    service.from("profiles").select("id, role, full_name"),
  ]);
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p as { role: UserRow["role"]; full_name: string | null }]));
  const needle = q.trim().toLowerCase();
  return (auth?.users ?? [])
    .map((u) => ({ id: u.id, email: u.email ?? "", name: byId.get(u.id)?.full_name ?? "", role: byId.get(u.id)?.role ?? "client", createdAt: u.created_at }))
    .filter((u) => u.role !== "client" || (needle.length >= 3 && (u.email.toLowerCase().includes(needle) || u.name.toLowerCase().includes(needle))))
    .sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === "admin" ? -1 : 1));
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return deny();
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json({ users: await listUsers(admin.service, q), me: admin.id });
}

const postSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), role: z.enum(["sales", "admin"]), locale: z.enum(["fr", "en", "ar"]).default("fr") });
const patchSchema = z.object({ userId: z.string().uuid(), role: z.enum(["client", "sales", "admin"]) });

/** Add a staff member: promote the account with this e-mail, or invite a new one by e-mail. */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return deny();
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { email, role, locale } = parsed.data;

  const { data: auth } = await admin.service.auth.admin.listUsers({ perPage: 1000 });
  let user = auth?.users.find((u) => u.email?.toLowerCase() === email);
  let invited = false;
  if (!user) {
    const created = await admin.service.auth.admin.inviteUserByEmail(email, { data: { preferred_locale: locale, company_name: "SATEX" } });
    if (created.error || !created.data.user) return NextResponse.json({ error: "invite_failed" }, { status: 502 });
    user = created.data.user;
    invited = true;
  }
  // the sign-up trigger created the profile; the service role (no auth.uid()) may set the role
  const { error } = await admin.service.from("profiles").update({ role }).eq("id", user.id);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  return NextResponse.json({ ok: true, invited, userId: user.id });
}

/** Change a role. Nobody can change their own, and the last admin can never be demoted. */
export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return deny();
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { userId, role } = parsed.data;
  if (userId === admin.id) return NextResponse.json({ error: "self" }, { status: 409 });

  const { data: target } = await admin.service.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (target.role === "admin" && role !== "admin") {
    const { count } = await admin.service.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
    if ((count ?? 0) <= 1) return NextResponse.json({ error: "last_admin" }, { status: 409 });
  }
  const { error } = await admin.service.from("profiles").update({ role }).eq("id", userId);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
