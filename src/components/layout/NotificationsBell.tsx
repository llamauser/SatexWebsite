"use client";

import { Bell } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { hasAuthCookie, loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { loose } from "@/lib/i18n-loose";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  type: string;
  payload: { ref?: string; fabric?: string; link?: string | null };
  read_at: string | null;
  created_at: string;
}

/** In-app notifications (row level security: a user only ever reads their own). Visible for signed-in users only. */
export function NotificationsBell() {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const [signedIn, setSignedIn] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const unread = items.filter((i) => !i.read_at).length;

  const refresh = useCallback(async () => {
    const supabase = await loadBrowserSupabase();
    if (!supabase) return;
    const { data } = await supabase.from("notifications").select("id, type, payload, read_at, created_at").order("created_at", { ascending: false }).limit(15);
    setItems((data ?? []) as Item[]);
  }, []);

  useEffect(() => {
    if (!hasAuthCookie()) return;
    setSignedIn(true);
    void refresh();
    const poll = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markAllRead() {
    const supabase = await loadBrowserSupabase();
    if (!supabase) return;
    const now = new Date().toISOString();
    setItems((list) => list.map((i) => ({ ...i, read_at: i.read_at ?? now })));
    await supabase.from("notifications").update({ read_at: now }).is("read_at", null);
  }

  async function markRead(id: string) {
    const supabase = await loadBrowserSupabase();
    setItems((list) => list.map((i) => (i.id === id ? { ...i, read_at: i.read_at ?? new Date().toISOString() } : i)));
    await supabase?.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
  }

  if (!signedIn) return null;

  const label = (i: Item) => {
    const key = `items.${i.type}`;
    return t.has(key as never) ? loose(t)(key, { ref: i.payload.ref ?? "", fabric: i.payload.fabric ?? "" }) : t("items.generic");
  };
  const date = (iso: string) => new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread > 0 ? `${t("open")} (${t("unread", { count: unread })})` : t("open")}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void refresh();
        }}
        className="relative flex size-10 items-center justify-center rounded-full text-text hover:bg-surface-muted"
        data-testid="bell-button"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute end-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white" data-testid="bell-count">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute end-0 z-40 mt-2 w-80 max-w-[90vw] rounded-md border border-border bg-surface shadow-pop" data-testid="bell-panel">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold">{t("title")}</p>
            {unread > 0 && (
              <button type="button" onClick={() => void markAllRead()} className="text-xs font-medium text-primary hover:underline" data-testid="bell-mark-all">
                {t("markAll")}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-text-muted">{t("empty")}</p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {items.map((i) => {
                const body = (
                  <>
                    <span className={cn("block text-sm", !i.read_at && "font-semibold")}>{label(i)}</span>
                    <span className="block text-xs text-text-muted">{date(i.created_at)}</span>
                  </>
                );
                return (
                  <li key={i.id} className={cn(!i.read_at && "bg-primary/5")} data-testid="bell-item" data-read={i.read_at ? "true" : "false"}>
                    {i.payload.link ? (
                      <Link href={i.payload.link} role="menuitem" className="block px-4 py-3 hover:bg-surface-muted" onClick={() => void markRead(i.id)}>
                        {body}
                      </Link>
                    ) : (
                      <button type="button" role="menuitem" className="block w-full px-4 py-3 text-start hover:bg-surface-muted" onClick={() => void markRead(i.id)}>
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
