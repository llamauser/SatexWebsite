"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Badge, ORDER_TONE, PAYMENT_TONE } from "@/components/admin/Badge";
import { buttonStyles } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";

interface Row { id: string; ref: string; status: string; payment_status: string; total: number | string; currency: string; created_at: string; order_lines: { count: number }[] }

/** The client's orders, newest first. */
export function OrdersList() {
  const t = useTranslations("orders.list");
  const to = useTranslations("orders.status");
  const tp = useTranslations("orders.payment");
  const locale = useLocale();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      const sb = await loadBrowserSupabase();
      if (!sb) return setFailed(true);
      const { data, error } = await sb.from("orders").select("id, ref, status, payment_status, total, currency, created_at, order_lines(count)").order("created_at", { ascending: false });
      if (error) return setFailed(true);
      setRows(data as unknown as Row[]);
    })();
  }, []);

  const date = (iso: string) => new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium" }).format(new Date(iso));
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      {failed && <div className="mt-6"><Alert>{t("error")}</Alert></div>}
      {rows === null && !failed && <p className="mt-6 text-text-muted">{t("loading")}</p>}
      {rows?.length === 0 && (
        <div className="mt-8 rounded-md border border-dashed border-border bg-surface p-10 text-center" data-testid="orders-empty">
          <p className="text-text-muted">{t("none")}</p>
          <Link href="/account/quotes" className={`${buttonStyles({ variant: "secondary" })} mt-4`}>{t("toQuotes")}</Link>
        </div>
      )}
      {rows && rows.length > 0 && (
        <ul className="mt-6 divide-y divide-border rounded-md border border-border bg-surface" data-testid="orders-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/account/orders/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 hover:bg-surface-muted" data-testid="order-row" data-ref={r.ref}>
                <span><span className="block font-semibold" dir="ltr">{r.ref}</span><span className="text-xs text-text-muted">{t("lines", { count: r.order_lines[0]?.count ?? 0 })} · {date(r.created_at)}</span></span>
                <span className="flex items-center gap-3">
                  <Badge label={loose(to)(r.status)} tone={ORDER_TONE[r.status]} testId="order-status" status={r.status} />
                  <Badge label={loose(tp)(r.payment_status)} tone={PAYMENT_TONE[r.payment_status]} />
                  <span className="min-w-24 text-end font-semibold" dir="ltr">{formatMoney(Number(r.total), r.currency, locale)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
