"use client";

import { Check, ShoppingBag } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { addToCart, openCart } from "@/lib/cart/cart";
import { roundToStep, validateMeters } from "@/lib/cart/pricing";
import { formatNumber } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";

/**
 * "Add to quote": a quantity (at least the MOQ, steps of 0.5 m) and a button. `compact` is just the button, with the
 * default quantity (match results). Works for guests (localStorage) and signed-in clients (the draft quote).
 */
export function AddToQuote({ colorId, moqM, availableM, defaultMeters, compact = false }: {
  colorId: string; moqM: number; availableM?: number | null; defaultMeters?: number; compact?: boolean;
}) {
  const t = useTranslations("cart.add");
  const locale = useLocale();
  const initial = String(roundToStep(Math.max(defaultMeters ?? moqM, moqM)));
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    const meters = Number(compact ? initial : value.replace(",", "."));
    const issue = validateMeters(meters, moqM);
    if (issue) return setProblem(issue);
    setProblem(null);
    setBusy(true);
    try {
      await addToCart(colorId, meters);
      setAdded(meters);
      openCart();
    } catch {
      setProblem("error");
    } finally {
      setBusy(false);
    }
  }

  const button = (
    <Button type="button" onClick={() => void add()} loading={busy} data-testid="add-to-quote" variant={compact ? "secondary" : "primary"}>
      {added !== null ? <Check className="size-4" aria-hidden /> : <ShoppingBag className="size-4" aria-hidden />}
      {t("button")}
    </Button>
  );
  if (compact) return button;

  return (
    <div className="mt-4 rounded-md border border-border bg-surface p-4" data-testid="add-to-quote-box">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium">
          {t("quantity")}
          <span className="ms-1 text-xs font-normal text-text-muted">({t("min", { m: formatNumber(moqM, locale) })})</span>
          <input
            type="number" inputMode="decimal" min={moqM} step={0.5} value={value}
            onChange={(e) => { setValue(e.target.value); setProblem(null); }}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            className="mt-1 block h-11 w-32 rounded-sm border border-border bg-surface px-3 text-base"
            aria-invalid={problem ? true : undefined}
            data-testid="add-meters"
          />
        </label>
        {button}
      </div>
      {problem && <p role="alert" className="mt-2 text-xs text-danger" data-testid="add-problem">{loose(t)(`problem.${problem}`, { m: formatNumber(moqM, locale) })}</p>}
      {added !== null && !problem && <p role="status" className="mt-2 text-xs text-success">{t("added", { m: formatNumber(added, locale) })}</p>}
      {availableM !== undefined && availableM !== null && Number(value) > availableM && (
        <p className="mt-2 text-xs text-warning">{t("partial", { m: formatNumber(Math.floor(availableM), locale) })}</p>
      )}
    </div>
  );
}
