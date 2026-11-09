"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Input } from "@/components/ui/Field";
import { loose } from "@/lib/i18n-loose";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { Badge, DELIVERY_TONE } from "./Badge";

export interface DeliveryData {
  id: string; status: string; carrier: string | null; tracking_number: string | null; scheduled_date: string | null; delivered_at: string | null; failure_reason: string | null;
}

/** One delivery with its actions: edit carrier / tracking / date while scheduled, ship, mark delivered, or record a failure. */
export function DeliveryCard({ delivery, onChanged }: { delivery: DeliveryData; onChanged: () => void | Promise<void> }) {
  const t = useTranslations("admin.delivery");
  const ts = useTranslations("orders.delivery");
  const locale = useLocale();
  const [form, setForm] = useState({ carrier: delivery.carrier ?? "", tracking: delivery.tracking_number ?? "", date: delivery.scheduled_date ?? "" });
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = delivery.status === "scheduled";
  const dateTime = (iso: string | null) => (iso ? new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "–");

  async function run(name: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setError(null);
    setBusy(name);
    const { error: e } = await fn();
    setBusy(null);
    if (e) return setError(/carrier and a tracking/.test(e.message) ? t("needTracking") : /reason is required/.test(e.message) ? t("needReason") : t("error"));
    setFailing(false);
    setReason("");
    await onChanged();
  }
  const save = async () => {
    const sb = (await loadBrowserSupabase())!;
    return run("save", () => sb.from("deliveries").update({ carrier: form.carrier.trim() || null, tracking_number: form.tracking.trim() || null, scheduled_date: form.date || null }).eq("id", delivery.id));
  };
  const setStatus = async (status: string, why?: string) => {
    const sb = (await loadBrowserSupabase())!;
    return run(status, () => sb.rpc("set_delivery_status", { p_id: delivery.id, p_status: status, p_reason: why ?? null }));
  };

  return (
    <div className="rounded-md border border-border p-4" data-testid="delivery-card" data-status={delivery.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge label={loose(ts)(delivery.status)} tone={DELIVERY_TONE[delivery.status]} testId="delivery-status" status={delivery.status} />
        {delivery.delivered_at && <span className="text-xs text-text-muted" dir="ltr">{dateTime(delivery.delivered_at)}</span>}
      </div>
      {delivery.failure_reason && <p className="mt-2 text-sm text-danger" data-testid="delivery-failure">{t("failure", { reason: delivery.failure_reason })}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Input label={t("carrier")} value={form.carrier} disabled={!editable} onChange={(e) => setForm({ ...form, carrier: e.target.value })} data-testid="delivery-carrier" />
        <Input label={t("tracking")} value={form.tracking} dir="ltr" disabled={!editable} onChange={(e) => setForm({ ...form, tracking: e.target.value })} data-testid="delivery-tracking" />
        <Input label={t("date")} type="date" value={form.date} disabled={!editable} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="delivery-date" />
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <div className="mt-3 flex flex-wrap gap-3">
        {editable && <Button type="button" variant="secondary" loading={busy === "save"} onClick={() => void save()} data-testid="delivery-save">{t("save")}</Button>}
        {editable && <Button type="button" loading={busy === "in_transit"} onClick={() => void setStatus("in_transit")} data-testid="delivery-ship">{t("ship")}</Button>}
        {delivery.status === "in_transit" && <Button type="button" loading={busy === "delivered"} onClick={() => void setStatus("delivered")} data-testid="delivery-delivered">{t("delivered")}</Button>}
        {(delivery.status === "scheduled" || delivery.status === "in_transit") && !failing && <Button type="button" variant="ghost" onClick={() => setFailing(true)} data-testid="delivery-fail">{t("fail")}</Button>}
      </div>
      {failing && (
        <div className="mt-3 flex flex-wrap items-end gap-3" data-testid="delivery-fail-box">
          <div className="min-w-64 flex-1"><Input label={t("failReason")} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="delivery-fail-reason" /></div>
          <Button type="button" loading={busy === "failed"} onClick={() => void setStatus("failed", reason)} data-testid="delivery-fail-confirm">{t("failConfirm")}</Button>
          <Button type="button" variant="ghost" onClick={() => setFailing(false)}>{t("keep")}</Button>
        </div>
      )}
    </div>
  );
}
