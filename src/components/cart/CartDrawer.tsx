"use client";

import { Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Field";
import { Link, usePathname } from "@/i18n/navigation";
import { CART_CHANGED, loadCart, removeLine, setLineMeters, submitCart, type CartLine, type CartState } from "@/lib/cart/cart";
import { estimate, validateMeters } from "@/lib/cart/pricing";
import { formatMoney, formatNumber, localized } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { cn } from "@/lib/utils";

/** The quote cart panel (loaded only when it is opened). */
export default function CartDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("cart.drawer");
  const locale = useLocale();
  const pathname = usePathname();
  const [state, setState] = useState<CartState | null>(null);
  const [message, setMessage] = useState("");
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => setState(await loadCart()), []);
  useEffect(() => {
    void refresh();
    window.addEventListener(CART_CHANGED, refresh);
    return () => window.removeEventListener(CART_CHANGED, refresh);
  }, [refresh]);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const money = (v: number) => formatMoney(v, state?.currency ?? "EUR", locale);
  const lines = state?.lines ?? [];
  const priced = lines.every((l) => l.unitPrice !== null);
  const totals = state?.serverTotals ?? estimate(lines, state?.vatRate ?? 0.2);

  async function commit(line: CartLine, raw: string) {
    const meters = Number(raw.replace(",", "."));
    const issue = validateMeters(meters, line.moqM);
    if (issue) return setProblems((p) => ({ ...p, [line.key]: issue }));
    setProblems((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== line.key)));
    if (meters !== line.meters && state) await setLineMeters(state, line, meters);
  }

  async function submit() {
    if (!state?.quoteId) return;
    setBusy(true);
    setError(false);
    try {
      await submitCart(state.quoteId, message);
      setSubmitted(state.quoteId);
      setMessage("");
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button type="button" className="absolute inset-0 bg-text/40" aria-label={t("close")} onClick={onClose} tabIndex={-1} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-title"
        tabIndex={-1}
        className="absolute inset-y-0 end-0 flex w-full max-w-md flex-col bg-surface shadow-pop outline-none"
        data-testid="cart-drawer"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="cart-title" className="font-display text-xl font-bold">{t("title")}</h2>
          <button type="button" onClick={onClose} aria-label={t("close")} className="rounded-full p-2 hover:bg-surface-muted"><X className="size-5" aria-hidden /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {submitted ? (
            <div className="space-y-4" data-testid="cart-submitted">
              <Alert kind="success">{t("submitted")}</Alert>
              <Link href={`/account/quotes/${submitted}`} onClick={onClose} className={buttonStyles()} style={{ background: "var(--primary-gradient)" }}>{t("viewQuote")}</Link>
            </div>
          ) : !state ? (
            <p className="text-text-muted">{t("loading")}</p>
          ) : lines.length === 0 ? (
            <div className="py-10 text-center" data-testid="cart-empty">
              <p className="text-text-muted">{t("empty")}</p>
              <Link href="/catalog" onClick={onClose} className={`${buttonStyles({ variant: "secondary" })} mt-4`}>{t("browse")}</Link>
            </div>
          ) : (
            <ul className="space-y-4" data-testid="cart-lines">
              {lines.map((l) => (
                <li key={l.key} className="rounded-md border border-border p-3" data-testid="cart-line" data-color={l.colorId}>
                  <div className="flex items-start gap-3">
                    <span className="mt-1 size-5 shrink-0 rounded-full border border-border" style={{ background: l.hex }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <Link href={`/catalog/${l.slug}`} onClick={onClose} className="block truncate font-semibold hover:text-primary">{localized(l.fabricName, locale)}</Link>
                      <p className="text-xs text-text-muted">{localized(l.colorName, locale)} · <span dir="ltr">{l.sku}</span></p>
                    </div>
                    <button type="button" onClick={() => state && void removeLine(state, l)} aria-label={t("remove")} className="rounded-full p-1.5 text-text-muted hover:bg-surface-muted hover:text-danger" data-testid="cart-remove">
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <label className="text-xs text-text-muted">
                      {t("meters")}
                      <input
                        key={`${l.key}-${l.meters}`}
                        type="number" inputMode="decimal" min={l.moqM} step={0.5} defaultValue={l.meters}
                        onBlur={(e) => void commit(l, e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        className={cn("mt-1 block h-10 w-28 rounded-sm border bg-surface px-2 text-base text-text", problems[l.key] ? "border-danger" : "border-border")}
                        aria-invalid={problems[l.key] ? true : undefined}
                        data-testid="cart-meters"
                      />
                    </label>
                    <p className="text-end text-sm">
                      {l.unitPrice !== null ? (
                        <>
                          <span className="block text-xs text-text-muted">{t("unit", { price: money(l.unitPrice) })}</span>
                          <span className="font-semibold" data-testid="cart-line-total">{money(Math.round(l.meters * l.unitPrice * 100) / 100)}</span>
                        </>
                      ) : <span className="text-xs text-text-muted">{t("priceHidden")}</span>}
                    </p>
                  </div>
                  {problems[l.key] && <p role="alert" className="mt-1 text-xs text-danger">{loose(t)(`problem.${problems[l.key]}`, { m: formatNumber(l.moqM, locale) })}</p>}
                  {l.availableM !== null && l.meters > l.availableM && <p className="mt-1 text-xs text-warning" data-testid="cart-partial">{t("partial", { m: formatNumber(Math.floor(l.availableM), locale) })}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {!submitted && state && lines.length > 0 && (
          <footer className="space-y-3 border-t border-border px-5 py-4">
            {priced && (
              <dl className="space-y-1 text-sm" data-testid="cart-totals">
                <div className="flex justify-between"><dt className="text-text-muted">{t("subtotal")}</dt><dd>{money(totals.subtotal)}</dd></div>
                <div className="flex justify-between font-semibold"><dt>{t("total", { vat: Math.round(state.vatRate * 100) })}</dt><dd data-testid="cart-total">{money(totals.total)}</dd></div>
              </dl>
            )}
            {priced && <p className="text-xs text-text-muted">{t("estimateNote")}</p>}
            {state.mode === "client" ? (
              <>
                <label className="block text-sm font-medium">
                  {t("message")}
                  <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={1000} className="mt-1 w-full rounded-sm border border-border bg-surface px-3 py-2 text-base" data-testid="cart-message" />
                </label>
                {error && <Alert>{t("error")}</Alert>}
                <Button className="w-full" loading={busy} disabled={Object.keys(problems).length > 0} onClick={() => void submit()} data-testid="cart-submit">{t("submit")}</Button>
              </>
            ) : (
              <>
                <p className="text-sm text-text-muted">{t("signInToSubmit")}</p>
                <Link href={{ pathname: "/auth/sign-in", query: { next: `/${locale}${pathname === "/" ? "" : pathname}` } }} onClick={onClose} className={`${buttonStyles()} w-full`} style={{ background: "var(--primary-gradient)" }} data-testid="cart-signin">
                  {t("signIn")}
                </Link>
              </>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
