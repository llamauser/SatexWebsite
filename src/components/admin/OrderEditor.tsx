"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Alert, Input, Select } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { describeColors } from "@/lib/cart/cart";
import { formatMoney, localized, type I18nField } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { Badge, CUTTING_TONE, ORDER_TONE } from "./Badge";
import { DeliveryCard, type DeliveryData } from "./DeliveryCard";
import { Section, TextArea, tableCls, tdCls, thCls } from "./ui";

interface OrderLine { id: string; sku: string; fabric: I18nField; color: I18nField; meters: number; unitPrice: number; total: number; job: { status: string; planned_m: number; cut_m: number | null } | null }
interface Order {
  id: string; ref: string; status: string; payment: string; currency: string; subtotal: number; discount: number; vat: number; total: number; notes: string; cancelledReason: string | null;
  company: string; clientId: string; quoteId: string; quoteRef: string; createdAt: string; shipping: Record<string, string> | null;
}
type Msg = { kind: "success" | "error"; text: string } | null;
const PAYMENTS = ["unpaid", "partial", "paid"] as const;

/** One order: status actions, payment, lines with their cutting jobs, deliveries. */
export function OrderEditor({ id }: { id: string }) {
  const t = useTranslations("admin.order");
  const to = useTranslations("orders.status");
  const tp = useTranslations("orders.payment");
  const tc = useTranslations("orders.cutting");
  const locale = useLocale();
  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryData[]>([]);
  const [missing, setMissing] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [plan, setPlan] = useState({ carrier: "", tracking: "", date: "" });

  const load = useCallback(async () => {
    const sb = await loadBrowserSupabase();
    if (!sb) return setMissing(true);
    const { data } = await sb.from("orders")
      .select("id, ref, status, payment_status, currency, subtotal, discount_pct, vat_rate, total, internal_notes, cancelled_reason, client_id, quote_id, created_at, shipping_address, clients(company_name), quotes(ref), order_lines(id, color_id, meters, unit_price, line_total, cutting_jobs(status, planned_m, cut_m)), deliveries(id, status, carrier, tracking_number, scheduled_date, delivered_at, failure_reason, created_at)")
      .eq("id", id).maybeSingle();
    if (!data) return setMissing(true);
    const r = data as unknown as {
      id: string; ref: string; status: string; payment_status: string; currency: string; subtotal: number | string; discount_pct: number | string; vat_rate: number | string; total: number | string; internal_notes: string | null;
      cancelled_reason: string | null; client_id: string; quote_id: string; created_at: string; shipping_address: Record<string, string> | null; clients: { company_name: string } | null; quotes: { ref: string } | null;
      order_lines: { id: string; color_id: string; meters: number | string; unit_price: number | string; line_total: number | string; cutting_jobs: { status: string; planned_m: number | string; cut_m: number | string | null }[] | { status: string; planned_m: number | string; cut_m: number | string | null } | null }[];
      deliveries: (DeliveryData & { created_at: string })[];
    };
    const info = await describeColors(sb, r.order_lines.map((l) => l.color_id));
    setLines(r.order_lines.flatMap((l) => {
      const c = info.get(l.color_id);
      const job = Array.isArray(l.cutting_jobs) ? l.cutting_jobs[0] : l.cutting_jobs;
      return c ? [{ id: l.id, sku: c.sku, fabric: c.fabricName, color: c.colorName, meters: Number(l.meters), unitPrice: Number(l.unit_price), total: Number(l.line_total), job: job ? { status: job.status, planned_m: Number(job.planned_m), cut_m: job.cut_m === null ? null : Number(job.cut_m) } : null }] : [];
    }));
    setDeliveries([...r.deliveries].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    const subtotal = Number(r.subtotal);
    setOrder({
      id: r.id, ref: r.ref, status: r.status, payment: r.payment_status, currency: r.currency, subtotal, discount: Number(r.discount_pct), vat: Number(r.vat_rate), total: Number(r.total), notes: r.internal_notes ?? "",
      cancelledReason: r.cancelled_reason, company: r.clients?.company_name ?? "", clientId: r.client_id, quoteId: r.quote_id, quoteRef: r.quotes?.ref ?? "", createdAt: r.created_at, shipping: r.shipping_address,
    });
    setNotes(r.internal_notes ?? "");
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const fail = (text: string) => setMsg({ kind: "error", text });
  async function status(next: "in_preparation" | "ready" | "cancelled") {
    setMsg(null);
    setBusy(next);
    const sb = (await loadBrowserSupabase())!;
    const { error } = await sb.rpc("set_order_status", { p_id: id, p_status: next, p_reason: next === "cancelled" ? reason : null });
    setBusy(null);
    if (error) return fail(/reason is required/.test(error.message) ? t("reasonRequired") : t("actionError"));
    setCancelling(false);
    setMsg({ kind: "success", text: t("statusDone", { status: loose(to)(next) }) });
    await load();
  }
  async function setPayment(value: string) {
    const sb = (await loadBrowserSupabase())!;
    const { error } = await sb.from("orders").update({ payment_status: value }).eq("id", id);
    if (error) return fail(t("saveError"));
    setMsg({ kind: "success", text: t("paymentDone") });
    await load();
  }
  async function saveNotes() {
    const sb = (await loadBrowserSupabase())!;
    const { error } = await sb.from("orders").update({ internal_notes: notes.trim() || null }).eq("id", id);
    setMsg(error ? { kind: "error", text: t("saveError") } : { kind: "success", text: t("notesSaved") });
  }
  async function createDelivery() {
    setMsg(null);
    setBusy("delivery");
    const sb = (await loadBrowserSupabase())!;
    const { error } = await sb.rpc("create_delivery", { p_order_id: id, p_carrier: plan.carrier || null, p_tracking: plan.tracking || null, p_date: plan.date || null });
    setBusy(null);
    if (error) return fail(t("actionError"));
    setPlan({ carrier: "", tracking: "", date: "" });
    await load();
  }

  if (missing) return <Alert>{t("notFound")}</Alert>;
  if (!order) return <p className="text-text-muted">{t("loading")}</p>;
  const money = (v: number) => formatMoney(v, order.currency, locale);
  const canStart = order.status === "confirmed";
  const canReady = order.status === "confirmed" || order.status === "in_preparation";
  const canCancel = ["confirmed", "in_preparation", "ready"].includes(order.status);
  const canDeliver = order.status === "ready" && !deliveries.some((d) => d.status === "scheduled" || d.status === "in_transit");
  const done = lines.filter((l) => l.job?.status === "ready").length;

  return (
    <div className="space-y-6" data-testid="order-editor" data-status={order.status}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-bold" dir="ltr" data-testid="order-ref">{order.ref}</h1>
          <Badge label={loose(to)(order.status)} tone={ORDER_TONE[order.status]} testId="order-status" status={order.status} />
        </div>
        <Link href="/admin/orders" className={buttonStyles({ variant: "ghost" })}>{t("back")}</Link>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {order.cancelledReason && <Alert><span data-testid="order-cancel-reason">{t("cancelledReason", { reason: order.cancelledReason })}</span></Alert>}

      <Section title={t("summary")}>
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-text-muted">{t("client")}</dt><dd className="font-medium"><Link href={`/admin/clients/${order.clientId}`} className="hover:text-primary" data-testid="order-client">{order.company}</Link></dd></div>
          <div><dt className="text-text-muted">{t("quote")}</dt><dd className="font-medium" dir="ltr"><Link href={`/admin/quotes/${order.quoteId}`} className="hover:text-primary">{order.quoteRef}</Link></dd></div>
          <div><dt className="text-text-muted">{t("total")}</dt><dd className="font-medium" dir="ltr" data-testid="order-total">{money(order.total)}</dd></div>
          <div><dt className="text-text-muted">{t("progress")}</dt><dd className="font-medium" data-testid="order-progress">{t("jobsDone", { done, total: lines.length })}</dd></div>
        </dl>
        {order.shipping && <p className="text-sm text-text-muted">{t("shipTo")} : {[order.shipping.line1, order.shipping.line2, order.shipping.postal_code, order.shipping.city, order.shipping.country].filter(Boolean).join(", ")}</p>}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Select label={t("payment")} value={order.payment} onChange={(e) => void setPayment(e.target.value)} data-testid="order-payment">
              {PAYMENTS.map((p) => <option key={p} value={p}>{loose(tp)(p)}</option>)}
            </Select>
          </div>
          {canStart && <Button type="button" variant="secondary" loading={busy === "in_preparation"} onClick={() => void status("in_preparation")} data-testid="order-start">{t("start")}</Button>}
          {canReady && <Button type="button" loading={busy === "ready"} onClick={() => void status("ready")} data-testid="order-ready">{t("markReady")}</Button>}
          {canCancel && !cancelling && <Button type="button" variant="ghost" onClick={() => setCancelling(true)} data-testid="order-cancel">{t("cancel")}</Button>}
        </div>
        {cancelling && (
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3" data-testid="order-cancel-box">
            <div className="min-w-64 flex-1"><Input label={t("cancelReason")} value={reason} onChange={(e) => setReason(e.target.value)} hint={t("cancelHint")} data-testid="order-cancel-reason-input" /></div>
            <Button type="button" loading={busy === "cancelled"} onClick={() => void status("cancelled")} data-testid="order-cancel-confirm">{t("cancelConfirm")}</Button>
            <Button type="button" variant="ghost" onClick={() => setCancelling(false)}>{t("keep")}</Button>
          </div>
        )}
      </Section>

      <Section title={t("lines")}>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className={tableCls} data-testid="order-lines">
            <thead className="bg-surface-muted text-text-muted"><tr>{(["fabric", "meters", "unitPrice", "lineTotal", "cutting"] as const).map((k) => <th key={k} scope="col" className={thCls}>{t(`cols.${k}`)}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => (
                <tr key={l.id} data-testid="order-line" data-sku={l.sku}>
                  <td className={tdCls}><span className="font-medium" dir="ltr">{l.sku}</span> · {localized(l.fabric, locale)}<span className="block text-xs text-text-muted">{localized(l.color, locale)}</span></td>
                  <td className={tdCls} dir="ltr">{l.meters}</td>
                  <td className={tdCls} dir="ltr">{money(l.unitPrice)}</td>
                  <td className={tdCls} dir="ltr">{money(l.total)}</td>
                  <td className={tdCls}>{l.job ? <><Badge label={loose(tc)(l.job.status)} tone={CUTTING_TONE[l.job.status]} testId="line-job" status={l.job.status} />{l.job.cut_m !== null && <span className="ms-2 text-xs text-text-muted" dir="ltr">{l.job.cut_m} / {l.job.planned_m} m</span>}</> : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link href="/admin/cutting" className="text-sm text-primary hover:underline">{t("toBoard")}</Link>
      </Section>

      <Section title={t("deliveries")} testId="order-deliveries">
        {canDeliver && (
          <div className="rounded-md border border-dashed border-border p-4" data-testid="new-delivery">
            <p className="text-sm text-text-muted">{t("deliveryHint")}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Input label={t("carrier")} value={plan.carrier} onChange={(e) => setPlan({ ...plan, carrier: e.target.value })} data-testid="new-delivery-carrier" />
              <Input label={t("tracking")} value={plan.tracking} dir="ltr" onChange={(e) => setPlan({ ...plan, tracking: e.target.value })} data-testid="new-delivery-tracking" />
              <Input label={t("date")} type="date" value={plan.date} onChange={(e) => setPlan({ ...plan, date: e.target.value })} data-testid="new-delivery-date" />
            </div>
            <div className="mt-3"><Button type="button" loading={busy === "delivery"} onClick={() => void createDelivery()} data-testid="create-delivery">{t("createDelivery")}</Button></div>
          </div>
        )}
        {deliveries.length === 0 && !canDeliver && <p className="text-sm text-text-muted">{t("noDelivery")}</p>}
        {deliveries.map((d) => <DeliveryCard key={d.id} delivery={d} onChanged={load} />)}
      </Section>

      <Section title={t("notes")}>
        <TextArea label={t("internalNotes")} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="order-notes" />
        <Button type="button" variant="secondary" onClick={() => void saveNotes()} data-testid="order-notes-save">{t("saveNotes")}</Button>
      </Section>
    </div>
  );
}
