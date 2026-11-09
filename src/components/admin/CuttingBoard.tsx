"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Input } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { describeColors } from "@/lib/cart/cart";
import { localized, type I18nField } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { cn } from "@/lib/utils";

type Column = "queued" | "cutting" | "ready";
const COLUMNS: Column[] = ["queued", "cutting", "ready"];

interface Job {
  id: string; status: Column; plannedM: number; cutM: number | null; lotId: string | null; colorId: string; orderId: string; orderRef: string; orderCreated: string;
  company: string; sku: string; fabric: I18nField; color: I18nField; hex: string;
}
interface Lot { id: string; lot_code: string; meters: number | string; location: string | null }
type Dialog = { kind: "start"; job: Job } | { kind: "finish"; job: Job } | null;
type Msg = { kind: "success" | "error"; text: string } | null;

/** The cutting board: queued -> cutting -> ready. Cards can be dragged between columns or moved with their buttons. */
export function CuttingBoard() {
  const t = useTranslations("admin.cutting");
  const locale = useLocale();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [lotId, setLotId] = useState("");
  const [cutM, setCutM] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState<Column | null>(null);
  const dragging = useRef<Job | null>(null);

  const load = useCallback(async () => {
    const sb = await loadBrowserSupabase();
    if (!sb) return;
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data } = await sb.from("cutting_jobs")
      .select("id, status, planned_m, cut_m, lot_id, finished_at, order_lines(color_id, order_id, orders(id, ref, created_at, status, clients(company_name)))")
      .in("status", ["queued", "cutting", "ready"]).or(`status.neq.ready,finished_at.gte.${since}`).order("sort").order("id").limit(500);
    type Raw = { id: string; status: Column; planned_m: number | string; cut_m: number | string | null; lot_id: string | null; order_lines: { color_id: string; order_id: string; orders: { id: string; ref: string; created_at: string; status: string; clients: { company_name: string } | null } } };
    const raw = ((data ?? []) as unknown as Raw[]).filter((j) => j.order_lines?.orders && j.order_lines.orders.status !== "cancelled");
    const info = await describeColors(sb, [...new Set(raw.map((j) => j.order_lines.color_id))]);
    setJobs(raw.flatMap((j) => {
      const c = info.get(j.order_lines.color_id);
      const o = j.order_lines.orders;
      return c ? [{ id: j.id, status: j.status, plannedM: Number(j.planned_m), cutM: j.cut_m === null ? null : Number(j.cut_m), lotId: j.lot_id, colorId: j.order_lines.color_id, orderId: o.id, orderRef: o.ref, orderCreated: o.created_at, company: o.clients?.company_name ?? "", sku: c.sku, fabric: c.fabricName, color: c.colorName, hex: c.hex }] : [];
    }));
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 20_000); // other people move cards too
    return () => clearInterval(timer);
  }, [load]);

  async function open(kind: "start" | "finish", job: Job) {
    setMsg(null);
    setDialog({ kind, job });
    if (kind === "start") {
      setLots(null);
      setLotId("");
      const sb = (await loadBrowserSupabase())!;
      const { data } = await sb.from("stock_lots").select("id, lot_code, meters, location").eq("color_id", job.colorId).gte("meters", job.plannedM).order("meters");
      const found = (data ?? []) as Lot[];
      setLots(found);
      if (found[0]) setLotId(found[0].id);
    } else setCutM(String(job.plannedM));
  }

  async function confirm() {
    if (!dialog) return;
    setBusy(true);
    setMsg(null);
    const sb = (await loadBrowserSupabase())!;
    const { error } = dialog.kind === "start"
      ? await sb.rpc("start_cut", { p_job_id: dialog.job.id, p_lot_id: lotId })
      : await sb.rpc("record_cut", { p_job_id: dialog.job.id, p_cut_m: Number(cutM.replace(",", ".")) });
    setBusy(false);
    if (error) return setMsg({ kind: "error", text: /not enough meters/.test(error.message) ? t("lotTooSmall") : /positive/.test(error.message) ? t("cutInvalid") : /overdraw|check constraint|meters_check/.test(error.message) ? t("cutTooMuch") : t("error") });
    setMsg({ kind: "success", text: dialog.kind === "start" ? t("started", { ref: dialog.job.orderRef }) : t("finished", { ref: dialog.job.orderRef }) });
    setDialog(null);
    await load();
  }

  const drop = (to: Column) => {
    const job = dragging.current;
    dragging.current = null;
    setOver(null);
    if (!job) return;
    if (job.status === "queued" && to === "cutting") void open("start", job);
    else if (job.status === "cutting" && to === "ready") void open("finish", job);
    else if (job.status !== to) setMsg({ kind: "error", text: t("badMove") });
  };

  const age = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

  return (
    <div className="space-y-6" data-testid="cutting-board">
      <div><h1 className="font-display text-3xl font-bold">{t("title")}</h1><p className="mt-1 text-sm text-text-muted">{t("lead")}</p></div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {jobs === null && <p className="text-text-muted">{t("loading")}</p>}
      {jobs && (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLUMNS.map((col) => {
            const items = jobs.filter((j) => j.status === col);
            return (
              <section key={col} aria-labelledby={`col-${col}`} data-testid={`column-${col}`}
                onDragOver={(e) => { e.preventDefault(); setOver(col); }} onDragLeave={() => setOver((o) => (o === col ? null : o))} onDrop={(e) => { e.preventDefault(); drop(col); }}
                className={cn("min-h-48 rounded-md border bg-surface-muted/50 p-3", over === col ? "border-primary bg-primary/5" : "border-border")}>
                <h2 id={`col-${col}`} className="mb-3 flex items-center justify-between font-display text-lg font-semibold">{loose(t)(`columns.${col}`)}<span className="rounded-full bg-surface px-2 text-sm" data-testid={`count-${col}`}>{items.length}</span></h2>
                <ul className="space-y-3">
                  {items.map((j) => (
                    <li key={j.id} draggable={col !== "ready"} onDragStart={() => { dragging.current = j; }} data-testid="cutting-card" data-job={j.id} data-order={j.orderRef}
                      className="rounded-md border border-border bg-surface p-3 shadow-card">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/admin/orders/${j.orderId}`} className="font-semibold hover:text-primary" dir="ltr">{j.orderRef}</Link>
                        <span className="text-xs text-text-muted">{t("age", { days: age(j.orderCreated) })}</span>
                      </div>
                      <p className="text-xs text-text-muted">{j.company}</p>
                      <p className="mt-2 flex items-center gap-2 text-sm"><span className="size-4 rounded-full border border-border" style={{ background: j.hex }} aria-hidden /><span dir="ltr" className="font-medium">{j.sku}</span> · {localized(j.fabric, locale)}</p>
                      <p className="text-xs text-text-muted">{localized(j.color, locale)}</p>
                      <p className="mt-2 text-sm" dir="ltr" data-testid="card-meters">{j.cutM !== null ? `${j.cutM} / ${j.plannedM} m` : `${j.plannedM} m`}</p>
                      {col === "queued" && <Button type="button" className="mt-3" onClick={() => void open("start", j)} data-testid="start-cut">{t("start")}</Button>}
                      {col === "cutting" && <Button type="button" className="mt-3" onClick={() => void open("finish", j)} data-testid="finish-cut">{t("finish")}</Button>}
                    </li>
                  ))}
                  {items.length === 0 && <li className="text-sm text-text-muted">{t("emptyColumn")}</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-text/40 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="cut-title" className="w-full max-w-md rounded-md bg-surface p-6 shadow-pop" data-testid="cut-dialog">
            <h2 id="cut-title" className="font-display text-xl font-semibold">{dialog.kind === "start" ? t("startTitle", { ref: dialog.job.orderRef }) : t("finishTitle", { ref: dialog.job.orderRef })}</h2>
            <p className="mt-1 text-sm text-text-muted">{dialog.job.sku} · {localized(dialog.job.color, locale)} · <span dir="ltr">{dialog.job.plannedM} m</span></p>
            {dialog.kind === "start" ? (
              <div className="mt-4" data-testid="lot-choice">
                {lots === null && <p className="text-text-muted">{t("loading")}</p>}
                {lots && lots.length === 0 && <Alert>{t("noLot", { m: dialog.job.plannedM })}</Alert>}
                {lots && lots.length > 0 && (
                  <fieldset>
                    <legend className="text-sm font-medium">{t("chooseLot")}</legend>
                    <ul className="mt-2 space-y-2">
                      {lots.map((l) => (
                        <li key={l.id}>
                          <label className="flex cursor-pointer items-center gap-3 rounded-sm border border-border p-2 text-sm">
                            <input type="radio" name="lot" checked={lotId === l.id} onChange={() => setLotId(l.id)} data-testid="lot-option" data-lot={l.lot_code} />
                            <span className="flex-1" dir="ltr">{l.lot_code}</span><span dir="ltr">{Number(l.meters)} m</span>{l.location && <span className="text-xs text-text-muted">{l.location}</span>}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                )}
              </div>
            ) : (
              <div className="mt-4"><Input label={t("actualMeters")} value={cutM} inputMode="decimal" dir="ltr" onChange={(e) => setCutM(e.target.value)} hint={t("actualHint", { m: dialog.job.plannedM })} data-testid="cut-meters" /></div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => setDialog(null)} data-testid="cut-cancel">{t("cancel")}</Button>
              <Button type="button" loading={busy} disabled={dialog.kind === "start" && !lotId} onClick={() => void confirm()} data-testid="cut-confirm">{dialog.kind === "start" ? t("confirmStart") : t("confirmFinish")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
