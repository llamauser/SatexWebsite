"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Field";
import { StatusPill } from "@/components/quotes/StatusPill";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/data/format";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { tableCls, tdCls, thCls } from "./ui";

interface Row {
  id: string; ref: string; status: string; total: number | string; currency: string; submitted_at: string | null; created_at: string; valid_until: string | null; revision: number;
  clients: { company_name: string } | null; quote_lines: { count: number }[];
}
const FILTERS = ["todo", "all", "submitted", "in_review", "sent", "accepted", "rejected", "expired", "cancelled", "converted"] as const;

/** The quote queue: what waits for review first, then everything else. */
export function QuotesAdmin() {
  const t = useTranslations("admin.quotes");
  const ts = useTranslations("quotes.status");
  const locale = useLocale();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("todo");
  const [query, setQuery] = useState("");

  useEffect(() => {
    void (async () => {
      const sb = await loadBrowserSupabase();
      if (!sb) return setFailed(true);
      const { data, error } = await sb.from("quotes").select("id, ref, status, total, currency, submitted_at, created_at, valid_until, revision, clients(company_name), quote_lines(count)")
        .neq("status", "draft").order("submitted_at", { ascending: false, nullsFirst: false }).limit(500);
      if (error) return setFailed(true);
      setRows(data as unknown as Row[]);
    })();
  }, []);

  const q = query.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) =>
    (filter === "all" || (filter === "todo" ? r.status === "submitted" || r.status === "in_review" || r.status === "accepted" : r.status === filter)) &&
    (q === "" || (r.ref ?? "").toLowerCase().includes(q) || (r.clients?.company_name ?? "").toLowerCase().includes(q)));
  const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium" }).format(new Date(iso)) : "–");
  const todo = (rows ?? []).filter((r) => r.status === "submitted" || r.status === "in_review").length;

  return (
    <div className="space-y-6" data-testid="quotes-admin">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
          {rows && <p className="mt-1 text-sm text-text-muted" data-testid="quotes-todo">{t("todo", { n: todo })}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-11 w-full max-w-sm rounded-full border border-border bg-surface px-4" data-testid="quote-search" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={t("filter")} className="h-11 rounded-full border border-border bg-surface px-3" data-testid="quote-filter">
          {FILTERS.map((f) => <option key={f} value={f}>{f === "todo" ? t("filterTodo") : f === "all" ? t("filterAll") : ts(f)}</option>)}
        </select>
      </div>

      {failed && <Alert>{t("error")}</Alert>}
      {rows === null && !failed && <p className="text-text-muted">{t("loading")}</p>}
      {rows && (
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className={tableCls} data-testid="quote-table">
            <thead className="bg-surface-muted text-text-muted"><tr>{(["ref", "client", "status", "lines", "submitted", "total"] as const).map((k) => <th key={k} scope="col" className={thCls}>{t(`cols.${k}`)}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.id} data-testid="quote-row" data-ref={r.ref} data-status={r.status}>
                  <td className={tdCls}><Link href={`/admin/quotes/${r.id}`} className="font-semibold hover:text-primary" dir="ltr" data-testid="quote-open">{r.ref}</Link>{r.revision > 1 && <span className="ms-2 text-xs text-text-muted">r{r.revision}</span>}</td>
                  <td className={tdCls}>{r.clients?.company_name ?? "–"}</td>
                  <td className={tdCls}><StatusPill status={r.status} /></td>
                  <td className={tdCls} dir="ltr">{r.quote_lines[0]?.count ?? 0}</td>
                  <td className={tdCls} dir="ltr">{date(r.submitted_at ?? r.created_at)}</td>
                  <td className={tdCls} dir="ltr">{formatMoney(Number(r.total), r.currency, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="p-6 text-center text-text-muted" data-testid="quotes-empty">{t("empty")}</p>}
        </div>
      )}
    </div>
  );
}
