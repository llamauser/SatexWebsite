"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Input } from "@/components/ui/Field";
import { localized } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { SAMPLE_STATUSES, isOpen, nextStatuses, type SampleStatus } from "@/lib/samples/rules";
import { Badge, type Tone } from "./Badge";

interface Row {
  id: string; ref: string; status: SampleStatus; created_at: string; shipping_address: Record<string, string>; rejection_reason: string | null; carrier: string | null; tracking_number: string | null;
  clients: { company_name: string } | null;
  sample_request_items: { fabric_colors: { code: string; name: Record<string, string>; hex: string; fabrics: { sku: string; name: Record<string, string> } } | null }[];
}
const TONE: Record<SampleStatus, Tone> = { requested: "info", approved: "info", rejected: "danger", preparing: "warn", shipped: "warn", delivered: "success" };
const FILTERS = ["todo", "all", ...SAMPLE_STATUSES] as const;
type Msg = { kind: "success" | "error"; text: string } | null;

/** Sample requests: approve or refuse, prepare, ship with a tracking number, mark delivered. The database enforces the order. */
export function SamplesAdmin() {
  const t = useTranslations("admin.samples");
  const ts = useTranslations("samples.status");
  const locale = useLocale();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("todo");
  const [forms, setForms] = useState<Record<string, { reason: string; carrier: string; tracking: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    const sb = await loadBrowserSupabase();
    if (!sb) return setFailed(true);
    const { data, error } = await sb.from("sample_requests").select("id, ref, status, created_at, shipping_address, rejection_reason, carrier, tracking_number, clients(company_name), sample_request_items(fabric_colors(code, name, hex, fabrics(sku, name)))").order("created_at", { ascending: false }).limit(300);
    if (error) return setFailed(true);
    setRows(data as unknown as Row[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const form = (id: string) => forms[id] ?? { reason: "", carrier: "", tracking: "" };
  const setForm = (id: string, patch: Partial<{ reason: string; carrier: string; tracking: string }>) => setForms((f) => ({ ...f, [id]: { ...form(id), ...patch } }));

  async function move(row: Row, next: SampleStatus) {
    setMsg(null);
    const f = form(row.id);
    if (next === "rejected" && !f.reason.trim()) return setMsg({ kind: "error", text: t("needReason") });
    if (next === "shipped" && !f.tracking.trim()) return setMsg({ kind: "error", text: t("needTracking") });
    setBusy(row.id + next);
    const sb = (await loadBrowserSupabase())!;
    const patch: Record<string, unknown> = { status: next };
    if (next === "rejected") patch.rejection_reason = f.reason.trim();
    if (next === "shipped") { patch.tracking_number = f.tracking.trim(); patch.carrier = f.carrier.trim() || null; }
    const { error } = await sb.from("sample_requests").update(patch).eq("id", row.id);
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: t("error") });
    setMsg({ kind: "success", text: t("moved", { ref: row.ref, status: loose(ts)(next) }) });
    await load();
  }

  const shown = (rows ?? []).filter((r) => filter === "all" || (filter === "todo" ? isOpen(r.status) && r.status !== "shipped" : r.status === filter));
  const date = (iso: string) => new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium" }).format(new Date(iso));

  return (
    <div className="space-y-6" data-testid="samples-admin">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={t("filter")} className="h-11 rounded-full border border-border bg-surface px-3" data-testid="sample-filter">
          {FILTERS.map((f) => <option key={f} value={f}>{f === "todo" ? t("filterTodo") : f === "all" ? t("filterAll") : loose(ts)(f)}</option>)}
        </select>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {failed && <Alert>{t("loadError")}</Alert>}
      {rows === null && !failed && <p className="text-text-muted">{t("loading")}</p>}
      {rows && shown.length === 0 && <p className="rounded-md border border-dashed border-border p-8 text-center text-text-muted" data-testid="samples-empty">{t("empty")}</p>}
      <ul className="space-y-4">
        {shown.map((r) => {
          const next = nextStatuses(r.status);
          const f = form(r.id);
          return (
            <li key={r.id} className="rounded-md border border-border bg-surface p-4" data-testid="sample-card" data-ref={r.ref} data-status={r.status}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-semibold" dir="ltr">{r.ref}</p><p className="text-sm text-text-muted">{r.clients?.company_name} · {date(r.created_at)}</p></div>
                <Badge label={loose(ts)(r.status)} tone={TONE[r.status]} testId="sample-status" status={r.status} />
              </div>
              <ul className="mt-3 flex flex-wrap gap-2">
                {r.sample_request_items.map((i, k) => i.fabric_colors && (
                  <li key={k} className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs"><span className="size-3.5 rounded-full border border-border" style={{ background: i.fabric_colors.hex }} aria-hidden /><span dir="ltr">{i.fabric_colors.fabrics.sku}</span> · {localized(i.fabric_colors.fabrics.name, locale)} · {localized(i.fabric_colors.name, locale)}</li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-text-muted">{[r.shipping_address.recipient, r.shipping_address.line1, r.shipping_address.line2, r.shipping_address.postal_code, r.shipping_address.city, r.shipping_address.country].filter(Boolean).join(", ")}</p>
              {r.rejection_reason && <p className="mt-2 text-sm text-danger">{t("reason", { reason: r.rejection_reason })}</p>}
              {r.tracking_number && <p className="mt-2 text-sm" data-testid="sample-tracking">{t("tracking", { carrier: r.carrier ?? "–", number: r.tracking_number })}</p>}
              {next.length > 0 && (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  {next.includes("rejected") && <Input label={t("rejectReason")} value={f.reason} onChange={(e) => setForm(r.id, { reason: e.target.value })} data-testid="sample-reason" />}
                  {next.includes("shipped") && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input label={t("carrier")} value={f.carrier} onChange={(e) => setForm(r.id, { carrier: e.target.value })} data-testid="sample-carrier" />
                      <Input label={t("trackingNumber")} dir="ltr" value={f.tracking} onChange={(e) => setForm(r.id, { tracking: e.target.value })} data-testid="sample-tracking-input" />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {next.map((n) => <Button key={n} type="button" variant={n === "rejected" ? "ghost" : "primary"} loading={busy === r.id + n} onClick={() => void move(r, n)} data-testid={`sample-to-${n}`}>{loose(t)(`actions.${n}`)}</Button>)}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
