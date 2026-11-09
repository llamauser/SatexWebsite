"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/Field";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";

interface Message { id: string; name: string; company: string | null; email: string; phone: string | null; message: string; locale: string; handled: boolean; created_at: string }

/** Messages sent through the contact form: read them, mark them handled. */
export function MessagesAdmin() {
  const t = useTranslations("admin.messages");
  const locale = useLocale();
  const [rows, setRows] = useState<Message[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<"open" | "all" | "handled">("open");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = await loadBrowserSupabase();
    if (!sb) return setFailed(true);
    const { data, error } = await sb.from("contact_messages").select("id, name, company, email, phone, message, locale, handled, created_at").order("created_at", { ascending: false }).limit(300);
    if (error) return setFailed(true);
    setRows(data as Message[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggle(m: Message) {
    setBusy(m.id);
    const sb = (await loadBrowserSupabase())!;
    await sb.from("contact_messages").update({ handled: !m.handled }).eq("id", m.id);
    setBusy(null);
    await load();
  }

  const shown = (rows ?? []).filter((m) => filter === "all" || (filter === "open" ? !m.handled : m.handled));
  const date = (iso: string) => new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  return (
    <div className="space-y-6" data-testid="messages-admin">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={t("filter")} className="h-11 rounded-full border border-border bg-surface px-3" data-testid="message-filter">
          <option value="open">{t("open")}</option><option value="handled">{t("handled")}</option><option value="all">{t("all")}</option>
        </select>
      </div>
      {failed && <Alert>{t("error")}</Alert>}
      {rows === null && !failed && <p className="text-text-muted">{t("loading")}</p>}
      {rows && shown.length === 0 && <p className="rounded-md border border-dashed border-border p-8 text-center text-text-muted" data-testid="messages-empty">{t("empty")}</p>}
      <ul className="space-y-4">
        {shown.map((m) => (
          <li key={m.id} className="rounded-md border border-border bg-surface p-4" data-testid="message-card" data-handled={m.handled}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{m.name}{m.company ? ` · ${m.company}` : ""}</p>
                <p className="text-sm text-text-muted"><a href={`mailto:${m.email}`} className="hover:text-primary" dir="ltr">{m.email}</a>{m.phone ? <> · <span dir="ltr">{m.phone}</span></> : null} · {m.locale.toUpperCase()} · <span dir="ltr">{date(m.created_at)}</span></p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={m.handled} disabled={busy === m.id} onChange={() => void toggle(m)} className="size-4 accent-[var(--primary)]" data-testid="message-handled" />
                {t("markHandled")}
              </label>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm" data-testid="message-text">{m.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
