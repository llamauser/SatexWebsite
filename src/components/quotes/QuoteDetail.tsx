"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Card } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { describeColors } from "@/lib/cart/cart";
import { formatMoney, localized, type I18nField } from "@/lib/data/format";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { StatusPill } from "./StatusPill";

interface Quote {
  id: string; ref: string; status: string; currency: string; discount_pct: number | string; vat_rate: number | string; subtotal: number | string; total: number | string;
  valid_until: string | null; client_message: string | null; rejection_reason: string | null; revision: number; pdf_path: string | null;
  created_at: string; submitted_at: string | null; sent_at: string | null; decided_at: string | null;
  quote_lines: { id: string; color_id: string; meters: number | string; unit_price: number | string; line_total: number | string; sort: number }[];
}
interface Line { id: string; fabric: I18nField; color: I18nField; sku: string; slug: string; hex: string; meters: number; unit: number; total: number }

export function QuoteDetail({ id }: { id: string }) {
  const t = useTranslations("quotes.detail");
  const locale = useLocale();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [reason, setReason] = useState("");
  const [deciding, setDeciding] = useState<"accepted" | "rejected" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const sb = await loadBrowserSupabase();
    if (!sb) return setState("missing");
    const { data } = await sb
      .from("quotes")
      .select("id, ref, status, currency, discount_pct, vat_rate, subtotal, total, valid_until, client_message, rejection_reason, revision, pdf_path, created_at, submitted_at, sent_at, decided_at, quote_lines(id, color_id, meters, unit_price, line_total, sort)")
      .eq("id", id)
      .maybeSingle();
    if (!data) return setState("missing");
    const q = data as unknown as Quote;
    const info = await describeColors(sb, q.quote_lines.map((l) => l.color_id));
    setLines(
      q.quote_lines.sort((a, b) => a.sort - b.sort).flatMap((l) => {
        const c = info.get(l.color_id);
        return c ? [{ id: l.id, fabric: c.fabricName, color: c.colorName, sku: c.sku, slug: c.slug, hex: c.hex, meters: Number(l.meters), unit: Number(l.unit_price), total: Number(l.line_total) }] : [];
      }),
    );
    setQuote(q);
    setState("ready");
  }, [id]);
  useEffect(() => void load(), [load]);

  async function decide(decision: "accepted" | "rejected") {
    setBusy(true);
    setError(false);
    const sb = await loadBrowserSupabase();
    const { error: e } = await sb!.rpc("client_decide_quote", { p_id: id, p_decision: decision, p_reason: decision === "rejected" ? reason.trim() || null : null });
    setBusy(false);
    if (e) return setError(true);
    setDeciding(null);
    await load();
  }

  async function downloadPdf() {
    const sb = await loadBrowserSupabase();
    if (!sb || !quote?.pdf_path) return;
    const { data } = await sb.storage.from("quote-pdfs").createSignedUrl(quote.pdf_path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    else setError(true);
  }

  if (state === "loading") return <p className="text-text-muted">{t("loading")}</p>;
  if (state === "missing" || !quote) return <Alert>{t("missing")}</Alert>;

  const money = (v: number | string) => formatMoney(Number(v), quote.currency, locale);
  const dt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : null);
  const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium" }).format(new Date(`${iso}T12:00:00`)) : null);
  const open = quote.status === "sent" && (!quote.valid_until || quote.valid_until >= new Date().toISOString().slice(0, 10));
  const timeline = [
    { key: "created", at: quote.created_at },
    { key: "submitted", at: quote.submitted_at },
    { key: "sent", at: quote.sent_at },
    { key: quote.status === "rejected" ? "rejected" : "accepted", at: quote.decided_at },
    ...(quote.status === "expired" ? [{ key: "expired", at: quote.valid_until }] : []),
  ].filter((e) => e.at);
  const discount = Number(quote.discount_pct);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/account/quotes" className="text-sm text-primary hover:underline">{t("back")}</Link>
          <h1 className="mt-1 font-display text-3xl font-bold" dir="ltr" data-testid="quote-ref">{quote.ref}</h1>
        </div>
        <div className="flex items-center gap-3">
          {quote.pdf_path && quote.status !== "draft" && <Button variant="secondary" onClick={() => void downloadPdf()} data-testid="client-download-pdf">{t("pdf")}</Button>}
          <StatusPill status={quote.status} />
        </div>
      </div>

      <Card className="p-0 sm:p-0">
        <table className="w-full text-sm" data-testid="quote-lines">
          <thead className="text-text-muted">
            <tr><th className="px-4 py-3 text-start font-medium">{t("fabric")}</th><th className="px-4 py-3 text-end font-medium">{t("meters")}</th><th className="hidden px-4 py-3 text-end font-medium sm:table-cell">{t("unit")}</th><th className="px-4 py-3 text-end font-medium">{t("lineTotal")}</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((l) => (
              <tr key={l.id} data-testid="quote-line">
                <td className="px-4 py-3">
                  <Link href={`/catalog/${l.slug}`} className="font-semibold hover:text-primary">{localized(l.fabric, locale)}</Link>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted"><span className="size-3 rounded-full border border-border" style={{ background: l.hex }} aria-hidden />{localized(l.color, locale)} · <span dir="ltr">{l.sku}</span></span>
                </td>
                <td className="px-4 py-3 text-end tabular-nums">{l.meters} m</td>
                <td className="hidden px-4 py-3 text-end tabular-nums sm:table-cell">{money(l.unit)}</td>
                <td className="px-4 py-3 text-end font-medium tabular-nums">{money(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="space-y-1 border-t border-border px-4 py-4 text-sm" data-testid="quote-totals">
          <div className="flex justify-between"><dt className="text-text-muted">{t("subtotal")}</dt><dd>{money(quote.subtotal)}</dd></div>
          {discount > 0 && <div className="flex justify-between"><dt className="text-text-muted">{t("discount", { pct: discount })}</dt><dd>−{money(Number(quote.subtotal) * discount / 100)}</dd></div>}
          <div className="flex justify-between"><dt className="text-text-muted">{t("vat", { pct: Math.round(Number(quote.vat_rate) * 100) })}</dt><dd>{money(Number(quote.subtotal) * (1 - discount / 100) * Number(quote.vat_rate))}</dd></div>
          <div className="flex justify-between text-base font-bold"><dt>{t("total")}</dt><dd data-testid="quote-total">{money(quote.total)}</dd></div>
        </dl>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg font-semibold">{t("progress")}</h2>
          <ol className="mt-3 space-y-2 border-s border-border ps-4 text-sm" data-testid="quote-timeline">
            {timeline.map((e) => (
              <li key={e.key} className="relative">
                <span className="absolute -start-[21px] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
                <span className="font-medium">{(t as unknown as (k: string) => string)(`timeline.${e.key}`)}</span>
                <span className="block text-xs text-text-muted">{e.key === "expired" ? day(e.at) : dt(e.at)}</span>
              </li>
            ))}
          </ol>
          {quote.valid_until && quote.status === "sent" && <p className="mt-3 text-sm text-text-muted">{t("validUntil", { date: day(quote.valid_until) ?? "" })}</p>}
          {quote.client_message && <p className="mt-3 rounded-sm bg-surface-muted p-3 text-sm"><span className="font-medium">{t("yourMessage")}</span><br />{quote.client_message}</p>}
          {quote.rejection_reason && <p className="mt-3 text-sm text-text-muted">{t("reason", { reason: quote.rejection_reason })}</p>}
        </Card>

        <Card>
          <h2 className="font-display text-lg font-semibold">{t("decision")}</h2>
          {open ? (
            deciding === "rejected" ? (
              <div className="mt-3 space-y-3">
                <label className="block text-sm font-medium">{t("rejectReason")}
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className="mt-1 w-full rounded-sm border border-border bg-surface px-3 py-2 text-base" data-testid="reject-reason" />
                </label>
                {error && <Alert>{t("error")}</Alert>}
                <div className="flex gap-3">
                  <Button variant="danger" loading={busy} onClick={() => void decide("rejected")} data-testid="reject-confirm">{t("rejectConfirm")}</Button>
                  <Button variant="ghost" onClick={() => setDeciding(null)}>{t("cancel")}</Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-text-muted">{t("decisionHelp")}</p>
                {error && <Alert>{t("error")}</Alert>}
                <div className="flex flex-wrap gap-3">
                  <Button loading={busy} onClick={() => void decide("accepted")} data-testid="accept-quote">{t("accept")}</Button>
                  <Button variant="secondary" onClick={() => setDeciding("rejected")} data-testid="reject-quote">{t("reject")}</Button>
                </div>
              </div>
            )
          ) : (
            <p className="mt-3 text-sm text-text-muted" data-testid="decision-closed">{t(`closed.${["submitted", "in_review", "accepted", "rejected", "expired", "cancelled", "converted"].includes(quote.status) ? quote.status : "other"}` as never)}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
