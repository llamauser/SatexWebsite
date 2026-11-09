"use client";

import { Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Alert, Input, Select } from "@/components/ui/Field";
import { StatusPill } from "@/components/quotes/StatusPill";
import { Link } from "@/i18n/navigation";
import { describeColors } from "@/lib/cart/cart";
import { roundToStep, unitPriceFor, type PriceTier } from "@/lib/cart/pricing";
import { formatMoney, localized, type I18nField } from "@/lib/data/format";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { allowedActions, computeTotals, defaultValidUntil, lineTotal } from "@/lib/quotes/calc";
import { Section, TextArea, tableCls, tdCls, thCls } from "./ui";

interface EditLine {
  id: string | null; colorId: string; sku: string; fabric: I18nField; color: I18nField; code: string; hex: string;
  meters: string; unitPrice: string; priceOverridden: boolean; tiers: PriceTier[];
}
interface Quote {
  id: string; ref: string; status: string; revision: number; currency: string; vatRate: number; discountPct: string; validUntil: string; internalNotes: string;
  clientMessage: string | null; rejectionReason: string | null; pdfPath: string | null; subtotal: number; total: number; clientId: string;
  company: string; createdAt: string; submittedAt: string | null; sentAt: string | null; decidedAt: string | null;
}
interface ColorOption { id: string; code: string; name: I18nField; fabrics: { sku: string; name: I18nField } }
type Msg = { kind: "success" | "error" | "info"; text: string } | null;
const num = (v: string) => Number(v.trim().replace(",", "."));

/** One quote for sales: review, change prices and quantities, discount and validity, then send, cancel, reopen or convert. */
export function QuoteEditor({ id }: { id: string }) {
  const t = useTranslations("admin.quote");
  const locale = useLocale();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [colors, setColors] = useState<ColorOption[]>([]);
  const [validityDays, setValidityDays] = useState(15);
  const [missing, setMissing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [adding, setAdding] = useState({ colorId: "", meters: "" });
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [order, setOrder] = useState<{ id: string; ref: string } | null>(null);

  const load = useCallback(async () => {
    const sb = await loadBrowserSupabase();
    if (!sb) return setMissing(true);
    const { data: q } = await sb.from("quotes")
      .select("id, ref, status, revision, currency, vat_rate, discount_pct, valid_until, internal_notes, client_message, rejection_reason, pdf_path, subtotal, total, client_id, created_at, submitted_at, sent_at, decided_at, clients(company_name), quote_lines(id, color_id, meters, unit_price, price_overridden, sort)")
      .eq("id", id).maybeSingle();
    if (!q) return setMissing(true);
    const raw = q as unknown as {
      id: string; ref: string; status: string; revision: number; currency: string; vat_rate: number | string; discount_pct: number | string; valid_until: string | null; internal_notes: string | null;
      client_message: string | null; rejection_reason: string | null; pdf_path: string | null; subtotal: number | string; total: number | string; client_id: string; created_at: string;
      submitted_at: string | null; sent_at: string | null; decided_at: string | null; clients: { company_name: string } | null;
      quote_lines: { id: string; color_id: string; meters: number | string; unit_price: number | string; price_overridden: boolean; sort: number }[];
    };
    const [settings, codeRows] = await Promise.all([
      sb.from("app_settings").select("value").eq("key", "quote_validity_days").maybeSingle(),
      sb.from("fabric_colors").select("id, code").in("id", raw.quote_lines.map((l) => l.color_id)),
    ]);
    const codes = new Map(((codeRows.data ?? []) as { id: string; code: string }[]).map((r) => [r.id, r.code]));
    const days = Number(settings.data?.value) || 15;
    setValidityDays(days);
    const info = await describeColors(sb, raw.quote_lines.map((l) => l.color_id));
    setLines(raw.quote_lines.sort((a, b) => a.sort - b.sort).flatMap((l) => {
      const c = info.get(l.color_id);
      return c ? [{ id: l.id, colorId: l.color_id, sku: c.sku, fabric: c.fabricName, color: c.colorName, code: codes.get(l.color_id) ?? "", hex: c.hex, meters: String(Number(l.meters)), unitPrice: String(Number(l.unit_price)), priceOverridden: l.price_overridden, tiers: c.tiers }] : [];
    }));
    setRemoved([]);
    setQuote({
      id: raw.id, ref: raw.ref, status: raw.status, revision: raw.revision, currency: raw.currency, vatRate: Number(raw.vat_rate), discountPct: String(Number(raw.discount_pct)),
      validUntil: raw.valid_until ?? defaultValidUntil(days), internalNotes: raw.internal_notes ?? "", clientMessage: raw.client_message, rejectionReason: raw.rejection_reason, pdfPath: raw.pdf_path,
      subtotal: Number(raw.subtotal), total: Number(raw.total), clientId: raw.client_id, company: raw.clients?.company_name ?? "",
      createdAt: raw.created_at, submittedAt: raw.submitted_at, sentAt: raw.sent_at, decidedAt: raw.decided_at,
    });
    setDirty(false);
  }, [id]);

  useEffect(() => {
    void (async () => {
      const sb = await loadBrowserSupabase();
      if (!sb) return setMissing(true);
      await sb.rpc("open_quote_for_review", { p_id: id }); // "someone is looking at it": submitted -> in review
      await load();
      const c = await sb.from("fabric_colors").select("id, code, name, fabrics(sku, name)").eq("is_active", true).order("code").limit(2000);
      setColors((c.data ?? []) as unknown as ColorOption[]);
    })();
  }, [id, load]);

  const actions = quote ? allowedActions(quote.status) : null;
  const patchLine = (i: number, patch: Partial<EditLine>) => { setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); setDirty(true); };
  const edit = (patch: Partial<Quote>) => { setQuote((q) => (q ? { ...q, ...patch } : q)); setDirty(true); };
  const fail = (text: string) => setMsg({ kind: "error", text });

  const linesValid = lines.length > 0 && lines.every((l) => num(l.meters) > 0 && num(l.unitPrice) >= 0);
  const discountOk = quote ? num(quote.discountPct) >= 0 && num(quote.discountPct) <= 100 : true;
  const totals = useMemo(() => computeTotals(lines.map((l) => ({ meters: num(l.meters) || 0, unitPrice: num(l.unitPrice) || 0 })), num(quote?.discountPct ?? "0") || 0, quote?.vatRate ?? 0), [lines, quote?.discountPct, quote?.vatRate]);
  const money = (v: number) => formatMoney(v, quote?.currency ?? "EUR", locale);

  async function addLine() {
    const meters = num(adding.meters);
    const c = colors.find((x) => x.id === adding.colorId);
    if (!c || !(meters > 0)) return fail(t("addInvalid"));
    if (lines.some((l) => l.colorId === c.id)) return fail(t("addDuplicate"));
    const sb = (await loadBrowserSupabase())!;
    const info = (await describeColors(sb, [c.id])).get(c.id);
    const qty = roundToStep(meters);
    const price = info ? unitPriceFor(info.tiers, qty) ?? 0 : 0;
    setLines((ls) => [...ls, { id: null, colorId: c.id, sku: c.fabrics.sku, fabric: c.fabrics.name, color: c.name, code: c.code, hex: "#CCCCCC", meters: String(qty), unitPrice: String(price), priceOverridden: false, tiers: info?.tiers ?? [] }]);
    setAdding({ colorId: "", meters: "" });
    setDirty(true);
    setMsg(null);
  }

  /** Writes the quote header and the lines. Returns false (with a message) if something is wrong. */
  async function persist(): Promise<boolean> {
    if (!quote) return false;
    if (!linesValid) { fail(t("linesInvalid")); return false; }
    if (!discountOk) { fail(t("discountInvalid")); return false; }
    const sb = (await loadBrowserSupabase())!;
    for (const lineId of removed) {
      const { error } = await sb.from("quote_lines").delete().eq("id", lineId);
      if (error) { fail(t("saveError")); return false; }
    }
    for (const [i, l] of lines.entries()) {
      const row = { meters: num(l.meters), unit_price: num(l.unitPrice), price_overridden: l.priceOverridden, sort: i };
      const { error } = l.id ? await sb.from("quote_lines").update(row).eq("id", l.id) : await sb.from("quote_lines").insert({ ...row, quote_id: quote.id, color_id: l.colorId });
      if (error) { fail(t("saveError")); return false; }
    }
    const { error } = await sb.from("quotes").update({ discount_pct: num(quote.discountPct), valid_until: quote.validUntil || null, internal_notes: quote.internalNotes.trim() || null }).eq("id", quote.id);
    if (error) { fail(t("saveError")); return false; }
    return true;
  }

  async function save() {
    setMsg(null);
    setBusy("save");
    const ok = await persist();
    if (ok) { await load(); setMsg({ kind: "success", text: t("saved") }); }
    setBusy(null);
  }

  async function send() {
    if (!quote) return;
    setMsg(null);
    setBusy("send");
    if (!(await persist())) return setBusy(null);
    const res = await fetch(`/api/admin/quotes/${quote.id}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ validUntil: quote.validUntil }) });
    setBusy(null);
    if (!res.ok) {
      const code = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      await load();
      return fail(code === "past" ? t("sendPast") : code === "no_lines" ? t("linesInvalid") : t("sendError"));
    }
    await load();
    setMsg({ kind: "success", text: t("sent") });
  }

  async function rpc(name: "cancel_quote" | "reopen_quote" | "convert_quote_to_order", args: Record<string, unknown>, ok: string) {
    setMsg(null);
    setBusy(name);
    const sb = (await loadBrowserSupabase())!;
    const { data, error } = await sb.rpc(name, args);
    setBusy(null);
    if (error) return fail(/reason is required/.test(error.message) ? t("reasonRequired") : t("actionError"));
    if (name === "convert_quote_to_order") setOrder({ id: (data as { id: string }).id, ref: (data as { ref: string }).ref });
    setCancelling(false);
    await load();
    setMsg({ kind: "success", text: ok });
  }

  async function downloadPdf() {
    if (!quote?.pdfPath) return;
    const sb = (await loadBrowserSupabase())!;
    const { data } = await sb.storage.from("quote-pdfs").createSignedUrl(quote.pdfPath, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    else fail(t("pdfError"));
  }

  if (missing) return <Alert>{t("notFound")}</Alert>;
  if (!quote || !actions) return <p className="text-text-muted">{t("loading")}</p>;
  const editable = actions.save;
  const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "–");

  return (
    <div className="space-y-6" data-testid="quote-editor" data-status={quote.status}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-3xl font-bold" dir="ltr" data-testid="quote-ref">{quote.ref}</h1>
          <StatusPill status={quote.status} />
          {quote.revision > 1 && <span className="text-sm text-text-muted">{t("revision", { n: quote.revision })}</span>}
        </div>
        <Link href="/admin/quotes" className={buttonStyles({ variant: "ghost" })}>{t("back")}</Link>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {order && <Alert kind="success"><span data-testid="order-created">{t("orderCreated", { ref: order.ref })}</span></Alert>}

      <Section title={t("client")}>
        <p className="font-medium" data-testid="quote-company">{quote.company}</p>
        {quote.clientMessage && <p className="rounded-sm bg-surface-muted p-3 text-sm" data-testid="quote-client-message"><span className="block text-xs text-text-muted">{t("clientMessage")}</span>{quote.clientMessage}</p>}
        {quote.rejectionReason && <p className="text-sm text-danger" data-testid="quote-reason">{t("reason", { reason: quote.rejectionReason })}</p>}
        <dl className="grid gap-2 text-sm sm:grid-cols-4">
          {([["created", quote.createdAt], ["submitted", quote.submittedAt], ["sentAt", quote.sentAt], ["decided", quote.decidedAt]] as const).map(([k, v]) => <div key={k}><dt className="text-text-muted">{t(`dates.${k}`)}</dt><dd dir="ltr">{date(v)}</dd></div>)}
        </dl>
      </Section>

      <Section title={t("lines")} testId="quote-lines-section">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className={tableCls} data-testid="quote-lines">
            <thead className="bg-surface-muted text-text-muted"><tr>{(["fabric", "meters", "unitPrice", "lineTotal", ""] as const).map((k, i) => <th key={i} scope="col" className={thCls}>{k ? t(`cols.${k}`) : <span className="sr-only">{t("remove")}</span>}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {lines.map((l, i) => {
                const tierPrice = unitPriceFor(l.tiers, num(l.meters));
                return (
                  <tr key={l.id ?? l.colorId} data-testid="quote-line" data-sku={l.sku}>
                    <td className={tdCls}>
                      <span className="font-medium" dir="ltr">{l.sku}</span> · {localized(l.fabric, locale)}
                      <span className="block text-xs text-text-muted">{localized(l.color, locale)}{l.code ? ` (${l.code})` : ""}</span>
                    </td>
                    <td className={tdCls}>
                      {editable ? <input value={l.meters} inputMode="decimal" dir="ltr" aria-label={t("cols.meters")} onChange={(e) => patchLine(i, { meters: e.target.value })} className="h-9 w-24 rounded-sm border border-border bg-surface px-2" data-testid="line-meters" /> : <span dir="ltr">{l.meters}</span>}
                    </td>
                    <td className={tdCls}>
                      {editable ? (
                        <>
                          <input value={l.unitPrice} inputMode="decimal" dir="ltr" aria-label={t("cols.unitPrice")} onChange={(e) => patchLine(i, { unitPrice: e.target.value, priceOverridden: tierPrice === null || num(e.target.value) !== tierPrice })} className="h-9 w-24 rounded-sm border border-border bg-surface px-2" data-testid="line-price" />
                          {l.priceOverridden && <span className="ms-2 text-xs text-warning" data-testid="line-overridden">{t("overridden")}</span>}
                        </>
                      ) : <span dir="ltr">{money(num(l.unitPrice))}{l.priceOverridden ? ` · ${t("overridden")}` : ""}</span>}
                    </td>
                    <td className={tdCls} dir="ltr" data-testid="line-total">{money(lineTotal(num(l.meters) || 0, num(l.unitPrice) || 0))}</td>
                    <td className={tdCls}>
                      {editable && <button type="button" onClick={() => { if (l.id) setRemoved((r) => [...r, l.id!]); setLines((ls) => ls.filter((_, j) => j !== i)); setDirty(true); }} aria-label={t("remove")} className="rounded-full p-1.5 text-text-muted hover:text-danger" data-testid="line-remove"><Trash2 className="size-4" aria-hidden /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lines.length === 0 && <p className="p-4 text-center text-text-muted">{t("noLines")}</p>}
        </div>

        {editable && (
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-border p-3" data-testid="add-line">
            <div className="min-w-64 flex-1">
              <Select label={t("addColor")} value={adding.colorId} onChange={(e) => setAdding({ ...adding, colorId: e.target.value })} data-testid="add-color">
                <option value="">{t("choose")}</option>
                {colors.map((c) => <option key={c.id} value={c.id}>{c.fabrics.sku} · {localized(c.fabrics.name, locale)} · {localized(c.name, locale)} ({c.code})</option>)}
              </Select>
            </div>
            <div className="w-32"><Input label={t("cols.meters")} value={adding.meters} inputMode="decimal" dir="ltr" onChange={(e) => setAdding({ ...adding, meters: e.target.value })} data-testid="add-meters" /></div>
            <Button type="button" variant="secondary" onClick={() => void addLine()} data-testid="add-line-button">{t("addLine")}</Button>
          </div>
        )}
      </Section>

      <Section title={t("conditions")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t("discount")} value={quote.discountPct} inputMode="decimal" dir="ltr" disabled={!editable} onChange={(e) => edit({ discountPct: e.target.value })} error={discountOk ? undefined : t("discountInvalid")} data-testid="quote-discount" />
          <Input label={t("validUntil")} type="date" value={quote.validUntil} disabled={!editable} onChange={(e) => edit({ validUntil: e.target.value })} hint={t("validHint", { days: validityDays })} data-testid="quote-valid-until" />
        </div>
        <TextArea label={t("internalNotes")} value={quote.internalNotes} disabled={!editable && quote.status !== "sent"} onChange={(e) => edit({ internalNotes: e.target.value })} data-testid="quote-notes" />
        <dl className="ms-auto w-full max-w-sm space-y-1 text-sm" data-testid="quote-totals">
          <div className="flex justify-between"><dt className="text-text-muted">{t("subtotal")}</dt><dd dir="ltr" data-testid="total-subtotal">{money(editable ? totals.subtotal : quote.subtotal)}</dd></div>
          {num(quote.discountPct) > 0 && <div className="flex justify-between"><dt className="text-text-muted">{t("discountAmount")}</dt><dd dir="ltr">-{money(totals.discount)}</dd></div>}
          <div className="flex justify-between"><dt className="text-text-muted">{t("vat", { pct: Math.round(quote.vatRate * 10000) / 100 })}</dt><dd dir="ltr">{money(totals.vat)}</dd></div>
          <div className="flex justify-between text-base font-semibold"><dt>{t("total")}</dt><dd dir="ltr" data-testid="total-total">{money(editable ? totals.total : quote.total)}</dd></div>
        </dl>
      </Section>

      <div className="flex flex-wrap items-center gap-3" data-testid="quote-actions">
        {actions.save && <Button type="button" variant="secondary" loading={busy === "save"} disabled={!dirty} onClick={() => void save()} data-testid="save-quote">{t("save")}</Button>}
        {actions.send && <Button type="button" loading={busy === "send"} onClick={() => void send()} data-testid="send-quote">{t("send")}</Button>}
        {actions.reopen && <Button type="button" variant="secondary" loading={busy === "reopen_quote"} onClick={() => void rpc("reopen_quote", { p_id: quote.id }, t("reopened"))} data-testid="reopen-quote">{t("reopen")}</Button>}
        {actions.convert && <Button type="button" loading={busy === "convert_quote_to_order"} onClick={() => void rpc("convert_quote_to_order", { p_id: quote.id }, t("converted"))} data-testid="convert-quote">{t("convert")}</Button>}
        {quote.pdfPath && <Button type="button" variant="ghost" onClick={() => void downloadPdf()} data-testid="download-pdf">{t("pdf")}</Button>}
        {actions.cancel && !cancelling && <Button type="button" variant="ghost" onClick={() => setCancelling(true)} data-testid="cancel-quote">{t("cancel")}</Button>}
      </div>
      {cancelling && (
        <Section title={t("cancelTitle")} hint={t("cancelHint")} testId="cancel-box">
          <TextArea label={t("cancelReason")} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} data-testid="cancel-reason" />
          <div className="flex gap-3">
            <Button type="button" loading={busy === "cancel_quote"} onClick={() => void rpc("cancel_quote", { p_id: quote.id, p_reason: cancelReason }, t("cancelled"))} data-testid="cancel-confirm">{t("cancelConfirm")}</Button>
            <Button type="button" variant="ghost" onClick={() => setCancelling(false)}>{t("keep")}</Button>
          </div>
        </Section>
      )}
    </div>
  );
}
