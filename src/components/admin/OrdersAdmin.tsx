"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { Badge, ORDER_TONE, PAYMENT_TONE } from "./Badge";
import { tableCls, tdCls, thCls } from "./ui";

interface Row {
  id: string; ref: string; status: string; payment_status: string; total: number | string; currency: string; created_at: string;
  clients: { company_name: string } | null; order_lines: { count: number }[];
}
const FILTERS = ["open", "all", "confirmed", "in_preparation", "ready", "shipped", "delivered", "cancelled"] as const;

export function OrdersAdmin() {
  const t = useTranslations("admin.orders");
  const to = useTranslations("orders.status");
  const tp = useTranslations("orders.payment");
  const locale = useLocale();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("open");
  const [query, setQuery] = useState("");

  useEffect(() => {
    void (async () => {
      const sb = await loadBrowserSupabase();
      if (!sb) return setFailed(true);
      const { data, error } = await sb.from("orders").select("id, ref, status, payment_status, total, currency, created_at, clients(company_name), order_lines(count)").order("created_at", { ascending: false }).limit(500);
      if (error) return setFailed(true);
      setRows(data as unknown as Row[]);
    })();
  }, []);

  const q = query.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) =>
    (filter === "all" || (filter === "open" ? ["confirmed", "in_preparation", "ready", "shipped"].includes(r.status) : r.status === filter)) &&
    (q === "" || (r.ref ?? "").toLowerCase().includes(q) || (r.clients?.company_name ?? "").toLowerCase().includes(q)));
  const date = (iso: string) => new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium" }).format(new Date(iso));

  return (
    <div className="space-y-6" data-testid="orders-admin">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-11 w-full max-w-sm rounded-full border border-border bg-surface px-4" data-testid="order-search" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={t("filter")} className="h-11 rounded-full border border-border bg-surface px-3" data-testid="order-filter">
          {FILTERS.map((f) => <option key={f} value={f}>{f === "open" ? t("filterOpen") : f === "all" ? t("filterAll") : loose(to)(f)}</option>)}
        </select>
      </div>
      {failed && <Alert>{t("error")}</Alert>}
      {rows === null && !failed && <p className="text-text-muted">{t("loading")}</p>}
      {rows && (
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className={tableCls} data-testid="order-table">
            <thead className="bg-surface-muted text-text-muted"><tr>{(["ref", "client", "status", "payment", "lines", "date", "total"] as const).map((k) => <th key={k} scope="col" className={thCls}>{t(`cols.${k}`)}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.id} data-testid="order-row" data-ref={r.ref} data-status={r.status}>
                  <td className={tdCls}><Link href={`/admin/orders/${r.id}`} className="font-semibold hover:text-primary" dir="ltr" data-testid="order-open">{r.ref}</Link></td>
                  <td className={tdCls}>{r.clients?.company_name ?? "–"}</td>
                  <td className={tdCls}><Badge label={loose(to)(r.status)} tone={ORDER_TONE[r.status]} testId="order-status" status={r.status} /></td>
                  <td className={tdCls}><Badge label={loose(tp)(r.payment_status)} tone={PAYMENT_TONE[r.payment_status]} /></td>
                  <td className={tdCls} dir="ltr">{r.order_lines[0]?.count ?? 0}</td>
                  <td className={tdCls} dir="ltr">{date(r.created_at)}</td>
                  <td className={tdCls} dir="ltr">{formatMoney(Number(r.total), r.currency, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="p-6 text-center text-text-muted" data-testid="orders-empty">{t("empty")}</p>}
        </div>
      )}
    </div>
  );
}
