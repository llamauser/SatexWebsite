"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { loose } from "@/lib/i18n-loose";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { DeliveryCard, type DeliveryData } from "./DeliveryCard";

interface Row extends DeliveryData { created_at: string; orders: { id: string; ref: string; clients: { company_name: string } | null } | null }
const FILTERS = ["open", "today", "all", "scheduled", "in_transit", "delivered", "failed"] as const;

/** Every delivery with its actions. "Open" = scheduled or on the way. */
export function DeliveriesAdmin() {
  const t = useTranslations("admin.deliveries");
  const ts = useTranslations("orders.delivery");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("open");

  const load = useCallback(async () => {
    const sb = await loadBrowserSupabase();
    if (!sb) return setFailed(true);
    const { data, error } = await sb.from("deliveries").select("id, status, carrier, tracking_number, scheduled_date, delivered_at, failure_reason, created_at, orders(id, ref, clients(company_name))").order("scheduled_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(300);
    if (error) return setFailed(true);
    setRows(data as unknown as Row[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const shown = (rows ?? []).filter((r) => filter === "all" || (filter === "open" ? r.status === "scheduled" || r.status === "in_transit" : filter === "today" ? r.scheduled_date === today && (r.status === "scheduled" || r.status === "in_transit") : r.status === filter));

  return (
    <div className="space-y-6" data-testid="deliveries-admin">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={t("filter")} className="h-11 rounded-full border border-border bg-surface px-3" data-testid="delivery-filter">
          {FILTERS.map((f) => <option key={f} value={f}>{f === "open" ? t("filterOpen") : f === "today" ? t("filterToday") : f === "all" ? t("filterAll") : loose(ts)(f)}</option>)}
        </select>
      </div>
      {failed && <Alert>{t("error")}</Alert>}
      {rows === null && !failed && <p className="text-text-muted">{t("loading")}</p>}
      {rows && shown.length === 0 && <p className="rounded-md border border-dashed border-border p-8 text-center text-text-muted" data-testid="deliveries-empty">{t("empty")}</p>}
      <ul className="space-y-4">
        {shown.map((d) => (
          <li key={d.id} data-testid="delivery-row" data-order={d.orders?.ref}>
            <p className="mb-2 text-sm"><Link href={`/admin/orders/${d.orders?.id}`} className="font-semibold hover:text-primary" dir="ltr">{d.orders?.ref}</Link> · {d.orders?.clients?.company_name}</p>
            <DeliveryCard delivery={d} onChanged={load} />
          </li>
        ))}
      </ul>
    </div>
  );
}
