"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { AddToQuote } from "@/components/cart/AddToQuote";
import { buttonStyles } from "@/components/ui/Button";
import { RequestSample } from "@/components/samples/RequestSample";
import { Alert } from "@/components/ui/Field";
import { Link, useRouter } from "@/i18n/navigation";
import { compositionShort } from "@/lib/catalog/params";
import { formatMoney, localized } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import type { ResultCard } from "@/lib/match/card";
import { REFINEMENTS, type Refinement } from "@/lib/match/refine";
import type { Spec, WizardInput } from "@/lib/match/schema";
import { cn } from "@/lib/utils";

export interface ResultView extends ResultCard {
  imageUrl: string | null;
}

const REFINEMENT_KEYS: Record<Refinement, string> = {
  lighter: "lighter", heavier: "heavier", cheaper: "cheaper", more_stretch: "moreStretch", softer: "softer", natural: "natural", other_colors: "otherColors",
};

export function MatchResults({
  sessionId, input, spec, results, activeRefinements, canRefine, feedback, currency,
}: {
  sessionId: string;
  input: WizardInput;
  spec: Spec;
  results: ResultView[];
  activeRefinements: Refinement[];
  canRefine: boolean;
  feedback: number | null;
  currency: string;
}) {
  const t = useTranslations("match.results");
  const ts = useTranslations("structures");
  const tf = useTranslations("fibers");
  const tstr = useTranslations("stretches");
  const tu = useTranslations("uses");
  const tc = useTranslations("constructions");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [vote, setVote] = useState<number | null>(feedback);

  async function refine(next: Refinement[]) {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/match", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input, locale, sessionId, refinements: next }) });
      if (!res.ok || !res.body) throw new Error("failed");
      const text = await res.text(); // the stream is short: read it all, then reload the page data
      if (!text.includes('"type":"done"')) throw new Error("failed");
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const toggleRefinement = (key: Refinement) => void refine(activeRefinements.includes(key) ? activeRefinements.filter((k) => k !== key) : [...activeRefinements, key]);

  async function sendFeedback(value: 1 | -1) {
    setVote(value);
    await fetch("/api/match/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, value }) }).catch(() => undefined);
  }

  const chips: string[] = [];
  if (spec.gsm_min !== null || spec.gsm_max !== null) chips.push(t("spec.gsm", { min: spec.gsm_min ?? spec.gsm_max ?? 0, max: spec.gsm_max ?? spec.gsm_min ?? 0 }));
  if (spec.construction) chips.push(loose(tc)(spec.construction));
  spec.structures.forEach((v) => chips.push(loose(ts)(v)));
  spec.fibers_preferred.forEach((v) => chips.push(loose(tf)(v)));
  if (spec.stretch && spec.stretch !== "none") chips.push(loose(tstr)(spec.stretch));
  spec.uses.slice(0, 3).forEach((v) => chips.push(loose(tu)(v)));
  if (spec.budget_max_per_m !== null) chips.push(t("spec.budget", { price: formatMoney(spec.budget_max_per_m, currency, locale) }));

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-beige-strong">{t("eyebrow")}</p>
      <h1 className="mt-1 font-display text-4xl font-bold">{t("title")}</h1>

      {chips.length > 0 && (
        <div className="mt-4">
          <p className="text-sm text-text-muted">{t("understood")}</p>
          <ul className="mt-2 flex flex-wrap gap-2" data-testid="spec-chips">
            {chips.map((c, i) => (
              <li key={`${c}-${i}`} className="rounded-full bg-surface-muted px-3 py-1 text-sm">{c}</li>
            ))}
          </ul>
        </div>
      )}

      {canRefine && (
        <div className="mt-6">
          <p className="text-sm font-medium">{t("refine")}</p>
          <ul className="mt-2 flex flex-wrap gap-2" data-testid="refinements">
            {REFINEMENTS.map((k) => {
              const on = activeRefinements.includes(k);
              return (
                <li key={k}>
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => toggleRefinement(k)}
                    className={cn("rounded-full border px-4 py-1.5 text-sm font-medium transition", on ? "border-text bg-text text-white" : "border-border bg-surface hover:bg-surface-muted", busy && "opacity-60")}
                    data-testid={`refine-${k}`}
                  >
                    {loose(t)(`refinements.${REFINEMENT_KEYS[k]}`)}
                  </button>
                </li>
              );
            })}
          </ul>
          {error && <div className="mt-3"><Alert>{t("refineError")}</Alert></div>}
        </div>
      )}

      {results.length === 0 ? (
        <div className="mt-10 rounded-md border border-dashed border-border bg-surface p-10 text-center" data-testid="match-empty">
          <h2 className="font-display text-xl font-semibold">{t("empty.title")}</h2>
          <p className="mt-2 text-text-muted">{t("empty.body")}</p>
          <Link href={{ pathname: "/contact", query: {} }} className={`${buttonStyles()} mt-5`} style={{ background: "var(--primary-gradient)" }}>
            {t("empty.cta")}
          </Link>
        </div>
      ) : (
        <ol className={cn("mt-8 space-y-6", busy && "opacity-60")} data-testid="match-results" aria-busy={busy}>
          {results.map((r, index) => {
            const name = localized(r.name, locale);
            const colorName = localized(r.colorName, locale);
            return (
              <li key={r.colorId} className="overflow-hidden rounded-lg border border-border bg-surface shadow-card md:grid md:grid-cols-[minmax(0,340px)_1fr]" data-testid="match-result" data-sku={r.sku}>
                <div className="relative aspect-[4/3] bg-surface-muted md:aspect-auto md:min-h-[300px]">
                  {r.imageUrl ? (
                    <Image src={r.imageUrl} alt={`${name} – ${colorName}`} fill sizes="(min-width: 768px) 340px, 100vw" unoptimized={/^https?:\/\/(127\.0\.0\.1|localhost)/.test(r.imageUrl)} priority={index === 0} className="object-cover" />
                  ) : (
                    <div className="h-full w-full" style={{ background: r.hex }} aria-hidden />
                  )}
                  <span className="absolute start-3 top-3 rounded-full bg-accent-beige px-3 py-1 text-sm font-bold text-white" data-testid="match-pct">
                    {t("badge", { pct: r.pct })}
                  </span>
                </div>
                <div className="p-6">
                  <h2 className="font-display text-2xl font-bold">{name}</h2>
                  <p className="mt-1 flex items-center gap-2 text-sm text-primary-strong">
                    <span className="size-4 rounded-full border border-border" style={{ background: r.hex }} aria-hidden />
                    {colorName} · {t("available", { m: r.availableM })}
                  </p>
                  <p className="mt-3 text-text-muted" data-testid="match-explanation">{r.explanation}</p>
                  <dl className="mt-4 divide-y divide-border text-sm">
                    {([
                      [t("spec.composition"), r.composition.map((c) => `${c.pct}% ${loose(tf)(c.fiber)}`).join(" · ")],
                      [t("spec.weight"), `${r.gsm} GSM`],
                      [t("spec.width"), `${r.widthCm} cm`],
                      [t("spec.bestFor"), r.uses.slice(0, 3).map((u) => loose(tu)(u)).join(", ")],
                    ] as const).map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-4 py-2">
                        <dt className="text-text-muted">{label}</dt>
                        <dd className="text-end font-semibold" dir={label === t("spec.composition") ? "ltr" : undefined}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-1 text-xs text-text-muted" dir="ltr">{compositionShort(r.composition)}</p>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <AddToQuote colorId={r.colorId} moqM={r.moqM ?? 1} defaultMeters={input.requiredM ?? undefined} compact />
                    <RequestSample colorId={r.colorId} compact />
                    <Link href={{ pathname: "/contact", query: { ref: r.sku } }} className={buttonStyles()} style={{ background: "var(--primary-gradient)" }}>
                      {t("actions.ask")}
                    </Link>
                    <Link href={`/catalog/${r.slug}`} className={buttonStyles({ variant: "secondary" })}>
                      {t("actions.view")}
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
        <Link href="/match" className="text-sm font-medium text-primary hover:underline">{t("newSearch")}</Link>
        {canRefine && (
          <div className="flex items-center gap-2 text-sm" data-testid="feedback">
            {vote ? (
              <span className="text-text-muted">{t("feedback.thanks")}</span>
            ) : (
              <>
                <span className="text-text-muted">{t("feedback.question")}</span>
                <button type="button" onClick={() => void sendFeedback(1)} aria-label={t("feedback.up")} className="rounded-full border border-border p-2 hover:bg-surface-muted" data-testid="feedback-up">
                  <ThumbsUp className="size-4" aria-hidden />
                </button>
                <button type="button" onClick={() => void sendFeedback(-1)} aria-label={t("feedback.down")} className="rounded-full border border-border p-2 hover:bg-surface-muted" data-testid="feedback-down">
                  <ThumbsDown className="size-4" aria-hidden />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
