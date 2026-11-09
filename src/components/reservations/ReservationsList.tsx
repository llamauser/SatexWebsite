"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { addToCart, openCart } from "@/lib/cart/cart";
import { formatNumber, localized } from "@/lib/data/format";
import { cancelReservation, loadReservations, type ReservationRow, type ReservationRules } from "@/lib/reservations/client";
import { formatCountdown, remaining, slotsLeft } from "@/lib/reservations/rules";
import { loose } from "@/lib/i18n-loose";
import { cn } from "@/lib/utils";

const PILL: Record<ReservationRow["status"], string> = {
  active: "bg-success/10 text-success",
  expired: "bg-surface-muted text-text-muted",
  cancelled: "bg-surface-muted text-text-muted",
  converted: "bg-primary/10 text-primary",
};

/** The client's reservations: active ones with a live countdown first, then the history. */
export function ReservationsList() {
  const t = useTranslations("reservations");
  const ts = useTranslations("reservations.status");
  const locale = useLocale();
  const [data, setData] = useState<{ rows: ReservationRow[]; rules: ReservationRules } | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const [addedId, setAddedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await loadReservations();
    if (!res) return setFailed(true);
    setData(res);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  async function cancel(id: string) {
    setBusy(id);
    setProblem(false);
    try {
      await cancelReservation(id);
      await refresh();
    } catch {
      setProblem(true);
    } finally {
      setBusy(null);
    }
  }

  async function toQuote(r: ReservationRow) {
    setBusy(r.id);
    setProblem(false);
    try {
      await addToCart(r.colorId, r.meters);
      setAddedId(r.id);
      openCart();
    } catch {
      setProblem(true);
    } finally {
      setBusy(null);
    }
  }

  const dateTime = (iso: string) => new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  // a reservation whose time has passed but that the 5-minute job has not closed yet counts as expired
  const isLive = (r: ReservationRow) => r.status === "active" && !remaining(r.expiresAt, now).expired;
  const live = (data?.rows ?? []).filter(isLive);
  const history = (data?.rows ?? []).filter((r) => !isLive(r));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-sm text-text-muted">{t("intro")}</p>
        </div>
        {data && <p className="text-sm text-text-muted" data-testid="reservation-slots">{t("slots", { used: live.length, max: data.rules.max })}</p>}
      </div>

      {failed && <div className="mt-6"><Alert>{t("error")}</Alert></div>}
      {problem && <div className="mt-6"><Alert>{t("actionError")}</Alert></div>}
      {data === null && !failed && <p className="mt-6 text-text-muted">{t("loading")}</p>}

      {data && data.rows.length === 0 && (
        <div className="mt-8 rounded-md border border-dashed border-border bg-surface p-10 text-center" data-testid="reservations-empty">
          <p className="text-text-muted">{t("none", { hours: data.rules.hours })}</p>
          <Link href="/catalog" className={`${buttonStyles({ variant: "secondary" })} mt-4`}>{t("browse")}</Link>
        </div>
      )}

      {live.length > 0 && (
        <section className="mt-6" aria-labelledby="res-active">
          <h2 id="res-active" className="font-display text-xl font-semibold">{t("active")}</h2>
          <ul className="mt-3 space-y-3" data-testid="reservations-active">
            {live.map((r) => {
              const left = remaining(r.expiresAt, now);
              return (
                <li key={r.id} className="rounded-md border border-border bg-surface p-4" data-testid="reservation-row" data-id={r.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-1 size-6 shrink-0 rounded-full border border-border" style={{ background: r.hex }} aria-hidden />
                      <div>
                        <Link href={`/catalog/${r.slug}`} className="font-semibold hover:text-primary">{localized(r.fabricName, locale)}</Link>
                        <p className="text-sm text-text-muted">{localized(r.colorName, locale)} · {t("meters", { m: formatNumber(r.meters, locale) })}</p>
                      </div>
                    </div>
                    <div className="text-end">
                      <p className={cn("text-2xl font-bold tabular-nums", left.soon && "text-warning")} dir="ltr" data-testid="reservation-countdown" data-soon={left.soon}>{formatCountdown(left)}</p>
                      <p className="text-xs text-text-muted">{t("until", { date: dateTime(r.expiresAt) })}</p>
                    </div>
                  </div>
                  {left.soon && <p role="status" className="mt-2 text-sm text-warning" data-testid="reservation-soon">{t("soon")}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button type="button" loading={busy === r.id} onClick={() => void toQuote(r)} data-testid="reservation-to-quote">{t("toQuote")}</Button>
                    <Button type="button" variant="secondary" loading={busy === r.id} onClick={() => void cancel(r.id)} data-testid="reservation-cancel">{t("cancel")}</Button>
                    {addedId === r.id && <span role="status" className="text-xs text-success">{t("added")}</span>}
                  </div>
                  <p className="mt-2 text-xs text-text-muted">{t("keepHint")}</p>
                </li>
              );
            })}
          </ul>
          {slotsLeft(live.length, data?.rules.max ?? 0) === 0 && <p className="mt-3 text-sm text-warning" data-testid="reservations-full">{t("full", { max: data?.rules.max ?? 0 })}</p>}
        </section>
      )}

      {history.length > 0 && (
        <section className="mt-8" aria-labelledby="res-history">
          <h2 id="res-history" className="font-display text-xl font-semibold">{t("history")}</h2>
          <ul className="mt-3 divide-y divide-border rounded-md border border-border bg-surface" data-testid="reservations-history">
            {history.map((r) => {
              const status = r.status === "active" ? "expired" : r.status; // past its time, not yet closed by the job
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid="reservation-past" data-id={r.id} data-status={status}>
                  <span className="flex items-center gap-3">
                    <span className="size-5 shrink-0 rounded-full border border-border" style={{ background: r.hex }} aria-hidden />
                    <span>
                      <span className="block text-sm font-medium">{localized(r.fabricName, locale)}</span>
                      <span className="text-xs text-text-muted">{localized(r.colorName, locale)} · {t("meters", { m: formatNumber(r.meters, locale) })} · {dateTime(r.createdAt)}</span>
                    </span>
                  </span>
                  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", PILL[status])} data-testid="reservation-status">{loose(ts)(status)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
