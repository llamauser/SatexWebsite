"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Input, Select } from "@/components/ui/Field";
import { loose } from "@/lib/i18n-loose";
import { Section, tableCls, tdCls, thCls } from "./ui";
import { useStaffRole } from "./useRole";

interface User { id: string; email: string; name: string; role: "client" | "sales" | "admin"; createdAt: string }
type Msg = { kind: "success" | "error" | "info"; text: string } | null;

/** Staff accounts and roles. Everything goes through /api/admin/users, which checks the caller against the database. */
export function UsersAdmin() {
  const t = useTranslations("admin.users");
  const locale = useLocale();
  const role = useStaffRole();
  const [users, setUsers] = useState<User[] | null>(null);
  const [me, setMe] = useState("");
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<"sales" | "admin">("sales");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    const res = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}`);
    if (!res.ok) return setUsers([]);
    const body = (await res.json()) as { users: User[]; me: string };
    setUsers(body.users);
    setMe(body.me);
  }, []);
  useEffect(() => { void load(query); }, [load, query]);

  async function add() {
    setMsg(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setMsg({ kind: "error", text: t("emailInvalid") });
    setBusy("add");
    const res = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim(), role: newRole, locale }) });
    setBusy(null);
    if (!res.ok) return setMsg({ kind: "error", text: t("addError") });
    const body = (await res.json()) as { invited: boolean };
    setMsg({ kind: "success", text: body.invited ? t("invited", { email: email.trim() }) : t("promoted", { email: email.trim() }) });
    setEmail("");
    await load(query);
  }

  async function change(user: User, next: User["role"]) {
    setMsg(null);
    setBusy(user.id);
    const res = await fetch("/api/admin/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: user.id, role: next }) });
    setBusy(null);
    if (!res.ok) {
      const code = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      return setMsg({ kind: "error", text: code === "last_admin" ? t("lastAdmin") : code === "self" ? t("self") : t("changeError") });
    }
    setMsg({ kind: "success", text: t("changed", { email: user.email, role: loose(t)(`roles.${next}`) }) });
    await load(query);
  }

  if (role !== "loading" && role !== "admin") return <Alert>{t("adminOnly")}</Alert>;

  return (
    <div className="space-y-6" data-testid="users-admin">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Section title={t("addTitle")} hint={t("addHint")}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1"><Input label={t("email")} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="staff-email" /></div>
          <Select label={t("role")} value={newRole} onChange={(e) => setNewRole(e.target.value as "sales" | "admin")} data-testid="staff-role">
            <option value="sales">{t("roles.sales")}</option><option value="admin">{t("roles.admin")}</option>
          </Select>
          <Button type="button" loading={busy === "add"} onClick={() => void add()} data-testid="staff-add">{t("add")}</Button>
        </div>
        <p className="text-xs text-text-muted">{t("signInAgain")}</p>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-11 w-full max-w-sm rounded-full border border-border bg-surface px-4" data-testid="user-search" />
        <span className="text-xs text-text-muted">{t("searchHint")}</span>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className={tableCls} data-testid="user-table">
          <thead className="bg-surface-muted text-text-muted"><tr>{(["email", "name", "role", "since"] as const).map((k) => <th key={k} scope="col" className={thCls}>{t(`cols.${k}`)}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {users?.map((u) => (
              <tr key={u.id} data-testid="user-row" data-email={u.email}>
                <td className={tdCls} dir="ltr">{u.email}{u.id === me && <span className="ms-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{t("you")}</span>}</td>
                <td className={tdCls}>{u.name || "–"}</td>
                <td className={tdCls}>
                  <select value={u.role} disabled={u.id === me || busy === u.id} aria-label={t("roleOf", { email: u.email })} onChange={(e) => void change(u, e.target.value as User["role"])} className="h-9 rounded-sm border border-border bg-surface px-2" data-testid="user-role">
                    <option value="client">{t("roles.client")}</option><option value="sales">{t("roles.sales")}</option><option value="admin">{t("roles.admin")}</option>
                  </select>
                </td>
                <td className={tdCls} dir="ltr">{new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium" }).format(new Date(u.createdAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {users === null && <p className="p-6 text-center text-text-muted">{t("loading")}</p>}
        {users?.length === 0 && <p className="p-6 text-center text-text-muted">{t("empty")}</p>}
      </div>
    </div>
  );
}
