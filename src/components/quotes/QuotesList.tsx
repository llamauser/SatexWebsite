"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Field";
import { buttonStyles } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/data/format";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { loose } from "@/lib/i18n-loose";
import { QUOTE_STATUSES, StatusPill } from "./StatusPill";

interface Row {
  id: string; ref: string; status: string; total: number | string; currency: string; valid_until: string | null; created_at: string; submitted_at: string | null;
  quote_lines: { count: number }[];
}

export function QuotesList() {
  const t = useTranslations("quotes.list");
  const ts = useTranslations("quotes.status");
  const locale = useLocale();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    void (async () => {
      const sb = await loadBrowserSupabase();
      if (!sb) return setFailed(true);
      // the draft is the cart, not a quote yet
      const { data, error } = await sb.from("quotes").select("id, ref, status, total, currency, valid_until, created_at, submitted_at, quote_lines(count)").neq("status", "draft").order("created_at", { ascending: false });
      if (error) return setFailed(true);
      setRows((data ?? []) as unknown as Row[]);
    })();
  }, []);

  const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium" }).format(new Date(iso)) : "–");
  const shown = (rows ?? []).filter((r) => filter === "all" || r.status === filter);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-text-muted">{t("filter")}</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-10 rounded-full border border-border bg-surface px-3" data-testid="quote-filter">
            <option value="all">{t("all")}</option>
            {QUOTE_STATUSES.map((s) => <option key={s} value={s}>{loose(ts)(s)}</option>)}
          </select>
        </label>
      </div>

      {failed && <div className="mt-6"><Alert>{t("error")}</Alert></div>}
      {rows === null && !failed && <p className="mt-6 text-text-muted">{t("loading")}</p>}
      {rows !== null && shown.length === 0 && (
        <div className="mt-8 rounded-md border border-dashed border-border bg-surface p-10 text-center" data-testid="quotes-empty">
          <p className="text-text-muted">{rows.length === 0 ? t("none") : t("noneForFilter")}</p>
          {rows.length === 0 && <Link href="/catalog" className={`${buttonStyles({ variant: "secondary" })} mt-4`}>{t("browse")}</Link>}
        </div>
      )}
      {shown.length > 0 && (
        <ul className="mt-6 divide-y divide-border rounded-md border border-border bg-surface" data-testid="quotes-list">
          {shown.map((r) => (
            <li key={r.id}>
              <Link href={`/account/quotes/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 hover:bg-surface-muted" data-testid="quote-row" data-ref={r.ref}>
                <span>
                  <span className="block font-semibold" dir="ltr">{r.ref}</span>
                  <span className="text-xs text-text-muted">{t("lines", { count: r.quote_lines[0]?.count ?? 0 })} · {date(r.submitted_at ?? r.created_at)}</span>
                </span>
                <span className="flex items-center gap-4">
                  {r.status === "sent" && r.valid_until && <span className="text-xs text-text-muted">{t("validUntil", { date: date(r.valid_until) })}</span>}
                  <StatusPill status={r.status} />
                  <span className="min-w-24 text-end font-semibold">{formatMoney(Number(r.total), r.currency, locale)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
