"use client";

import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Badge, DELIVERY_TONE, ORDER_TONE, PAYMENT_TONE } from "@/components/admin/Badge";
import { Alert, Card } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { describeColors } from "@/lib/cart/cart";
import { formatMoney, localized, type I18nField } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { cn } from "@/lib/utils";

const FLOW = ["confirmed", "in_preparation", "ready", "shipped", "delivered"] as const;
interface Order {
  id: string; ref: string; status: string; payment_status: string; currency: string; subtotal: number | string; discount_pct: number | string; vat_rate: number | string; total: number | string;
  created_at: string; cancelled_reason: string | null; quote_id: string; quotes: { ref: string } | null;
  order_lines: { id: string; color_id: string; meters: number | string; unit_price: number | string; line_total: number | string }[];
  deliveries: { id: string; status: string; carrier: string | null; tracking_number: string | null; scheduled_date: string | null; delivered_at: string | null; created_at: string }[];
}
interface Line { id: string; fabric: I18nField; color: I18nField; sku: string; slug: string; hex: string; meters: number; unit: number; total: number }

/** One order for the client: where it stands, what is in it, how it travels. */
export function OrderDetail({ id }: { id: string }) {
  const t = useTranslations("orders.detail");
  const to = useTranslations("orders.status");
  const tp = useTranslations("orders.payment");
  const td = useTranslations("orders.delivery");
  const locale = useLocale();
  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    void (async () => {
      const sb = await loadBrowserSupabase();
      if (!sb) return setState("missing");
      const { data } = await sb.from("orders").select("id, ref, status, payment_status, currency, subtotal, discount_pct, vat_rate, total, created_at, cancelled_reason, quote_id, quotes(ref), order_lines(id, color_id, meters, unit_price, line_total), deliveries(id, status, carrier, tracking_number, scheduled_date, delivered_at, created_at)").eq("id", id).maybeSingle();
      if (!data) return setState("missing");
      const o = data as unknown as Order;
      const info = await describeColors(sb, o.order_lines.map((l) => l.color_id));
      setLines(o.order_lines.flatMap((l) => {
        const c = info.get(l.color_id);
        return c ? [{ id: l.id, fabric: c.fabricName, color: c.colorName, sku: c.sku, slug: c.slug, hex: c.hex, meters: Number(l.meters), unit: Number(l.unit_price), total: Number(l.line_total) }] : [];
      }));
      setOrder(o);
      setState("ready");
    })();
  }, [id]);

  if (state === "loading") return <p className="text-text-muted">{t("loading")}</p>;
  if (state === "missing" || !order) return <Alert>{t("missing")}</Alert>;
  const money = (v: number | string) => formatMoney(Number(v), order.currency, locale);
  const dt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium" }).format(new Date(iso)) : "–");
  const at = FLOW.indexOf(order.status as (typeof FLOW)[number]);
  const cancelled = order.status === "cancelled";
  const deliveries = [...order.deliveries].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="space-y-6" data-testid="order-detail" data-status={order.status}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/account/orders" className="text-sm text-primary hover:underline">{t("back")}</Link>
          <h1 className="mt-1 font-display text-3xl font-bold" dir="ltr" data-testid="order-ref">{order.ref}</h1>
          <p className="text-sm text-text-muted">{t("placed", { date: dt(order.created_at) })}{order.quotes ? <> · <Link href={`/account/quotes/${order.quote_id}`} className="hover:underline" dir="ltr">{order.quotes.ref}</Link></> : null}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge label={loose(to)(order.status)} tone={ORDER_TONE[order.status]} testId="order-status" status={order.status} />
          <Badge label={loose(tp)(order.payment_status)} tone={PAYMENT_TONE[order.payment_status]} testId="order-payment" />
        </div>
      </div>

      {cancelled ? (
        <Alert>{t("cancelled", { reason: order.cancelled_reason ?? "–" })}</Alert>
      ) : (
        <ol className="flex items-start gap-1 text-xs" aria-label={t("progress")} data-testid="order-progress">
          {FLOW.map((s, i) => (
            <li key={s} className={cn("flex flex-1 flex-col items-center gap-1 text-center", i <= at ? "text-primary" : "text-text-muted")} aria-current={i === at ? "step" : undefined}>
              <span className={cn("flex size-7 items-center justify-center rounded-full border", i <= at ? "border-primary bg-primary text-white" : "border-border")}>{i < at || order.status === "delivered" ? <Check className="size-4" aria-hidden /> : i + 1}</span>
              <span>{loose(to)(s)}</span>
            </li>
          ))}
        </ol>
      )}

      <Card className="p-0 sm:p-0">
        <table className="w-full text-sm" data-testid="order-lines">
          <thead className="text-text-muted"><tr><th className="px-4 py-3 text-start font-medium">{t("fabric")}</th><th className="px-4 py-3 text-end font-medium">{t("meters")}</th><th className="hidden px-4 py-3 text-end font-medium sm:table-cell">{t("unit")}</th><th className="px-4 py-3 text-end font-medium">{t("lineTotal")}</th></tr></thead>
          <tbody className="divide-y divide-border">
            {lines.map((l) => (
              <tr key={l.id} data-testid="order-line">
                <td className="px-4 py-3"><Link href={`/catalog/${l.slug}`} className="font-semibold hover:text-primary">{localized(l.fabric, locale)}</Link><span className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted"><span className="size-3 rounded-full border border-border" style={{ background: l.hex }} aria-hidden />{localized(l.color, locale)} · <span dir="ltr">{l.sku}</span></span></td>
                <td className="px-4 py-3 text-end tabular-nums">{l.meters} m</td>
                <td className="hidden px-4 py-3 text-end tabular-nums sm:table-cell">{money(l.unit)}</td>
                <td className="px-4 py-3 text-end font-medium tabular-nums">{money(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="space-y-1 border-t border-border px-4 py-4 text-sm" data-testid="order-totals">
          <div className="flex justify-between"><dt className="text-text-muted">{t("subtotal")}</dt><dd>{money(order.subtotal)}</dd></div>
          {Number(order.discount_pct) > 0 && <div className="flex justify-between"><dt className="text-text-muted">{t("discount", { pct: Number(order.discount_pct) })}</dt><dd>-{money(Number(order.subtotal) * Number(order.discount_pct) / 100)}</dd></div>}
          <div className="flex justify-between font-bold"><dt>{t("total", { vat: Math.round(Number(order.vat_rate) * 100) })}</dt><dd data-testid="order-total">{money(order.total)}</dd></div>
        </dl>
      </Card>

      <section aria-labelledby="deliv" data-testid="order-deliveries">
        <h2 id="deliv" className="font-display text-xl font-semibold">{t("delivery")}</h2>
        {deliveries.length === 0 ? <p className="mt-2 text-sm text-text-muted">{t("noDelivery")}</p> : (
          <ul className="mt-3 space-y-3">
            {deliveries.map((d) => (
              <li key={d.id} className="rounded-md border border-border bg-surface p-4 text-sm" data-testid="delivery" data-status={d.status}>
                <div className="flex items-center justify-between gap-3"><Badge label={loose(td)(d.status)} tone={DELIVERY_TONE[d.status]} /><span className="text-text-muted" dir="ltr">{d.delivered_at ? dt(d.delivered_at) : dt(d.scheduled_date)}</span></div>
                {(d.carrier || d.tracking_number) && <p className="mt-2" data-testid="delivery-tracking">{t("carrier", { carrier: d.carrier ?? "–" })} · <span dir="ltr">{d.tracking_number ?? "–"}</span></p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
