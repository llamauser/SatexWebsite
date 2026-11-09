"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/data/format";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { cn } from "@/lib/utils";

interface Kpis {
  quotes_to_review: number; quotes_to_convert: number; samples_to_prepare: number; cutting_queue: number; orders_open: number; deliveries_today: number;
  low_stock_colors: number; reservations_expiring: number; messages_unhandled: number; quotes_value_open: number | string;
}
const CARDS = [
  { key: "quotes_to_review", href: "/admin/quotes" },
  { key: "quotes_to_convert", href: "/admin/quotes" },
  { key: "orders_open", href: "/admin/orders" },
  { key: "cutting_queue", href: "/admin/cutting" },
  { key: "deliveries_today", href: "/admin/deliveries" },
  { key: "samples_to_prepare", href: "/admin/samples" },
  { key: "low_stock_colors", href: "/admin/stock" },
  { key: "reservations_expiring", href: "/admin/reservations" },
  { key: "messages_unhandled", href: "/admin/messages" },
] as const;

/** The numbers that tell sales what to do next. One database call; each card leads to the page that handles it. */
export function Dashboard() {
  const t = useTranslations("admin.dashboard");
  const locale = useLocale();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [currency, setCurrency] = useState("EUR");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      const sb = await loadBrowserSupabase();
      if (!sb) return setFailed(true);
      const [k, c] = await Promise.all([sb.rpc("admin_dashboard"), sb.from("public_settings").select("value").eq("key", "currency").maybeSingle()]);
      if (k.error) return setFailed(true);
      setKpis(k.data as Kpis);
      if (typeof c.data?.value === "string") setCurrency(c.data.value);
    })();
  }, []);

  if (failed) return <Alert>{t("error")}</Alert>;
  if (!kpis) return <p className="text-text-muted">{t("loading")}</p>;
  return (
    <div data-testid="dashboard">
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => {
          const n = Number(kpis[c.key]);
          return (
            <li key={c.key}>
              <Link href={c.href} className={cn("block rounded-md border bg-surface p-5 hover:border-primary", n > 0 ? "border-border" : "border-border border-dashed")} data-testid={`kpi-${c.key}`} data-value={n}>
                <span className="block font-display text-4xl font-bold tabular-nums" dir="ltr">{n}</span>
                <span className="mt-1 block font-medium">{t(`cards.${c.key}`)}</span>
                <span className="block text-sm text-text-muted">{t(`hints.${c.key}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-sm text-text-muted" data-testid="kpi-open-value">{t("openValue", { amount: formatMoney(Number(kpis.quotes_value_open), currency, locale) })}</p>
    </div>
  );
}
