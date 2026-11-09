"use client";

import { Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Link, usePathname } from "@/i18n/navigation";
import { cartMode, type CartMode } from "@/lib/cart/cart";
import { formatNumber } from "@/lib/data/format";
import { hasAuthCookie, loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { loose } from "@/lib/i18n-loose";
import { checkReserveMeters, slotsLeft } from "@/lib/reservations/rules";
import { countActive, loadRules, reserve, ReserveFailure, type ReservationRules } from "@/lib/reservations/client";
import { roundToStep } from "@/lib/cart/pricing";

/**
 * "Reserve for 48 h" on a color of the fabric page. Signed-in clients reserve (the database function checks stock, the
 * minimum and the limit); visitors are invited to sign in; staff see nothing (they reserve for clients from the admin area).
 */
export function ReserveStock({ colorId, moqM, availableM }: { colorId: string; moqM: number; availableM: number | null }) {
  const t = useTranslations("cart.reserve");
  const locale = useLocale();
  const pathname = usePathname();
  const [mode, setMode] = useState<CartMode | "loading">("loading");
  const [staff, setStaff] = useState(false);
  const [rules, setRules] = useState<ReservationRules | null>(null);
  const [active, setActive] = useState(0);
  const [value, setValue] = useState(String(roundToStep(moqM)));
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ meters: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sb = await loadBrowserSupabase();
      const m = await cartMode(sb);
      if (cancelled) return;
      setStaff(m === "guest" && hasAuthCookie()); // signed in but not a client: staff
      setMode(m);
      if (sb && m === "client") {
        const [r, n] = await Promise.all([loadRules(sb), countActive(sb)]);
        if (!cancelled) { setRules(r); setActive(n); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (mode === "loading" || staff) return null;

  if (mode === "guest") {
    return (
      <div className="mt-3 rounded-md border border-dashed border-border bg-surface p-4 text-sm" data-testid="reserve-box">
        <p className="flex items-center gap-2 font-medium"><Clock className="size-4 text-primary" aria-hidden />{t("title")}</p>
        <p className="mt-1 text-text-muted">{t("signInHelp")}</p>
        <Link href={{ pathname: "/auth/sign-in", query: { next: `/${locale}${pathname === "/" ? "" : pathname}` } }} className={`${buttonStyles({ variant: "secondary" })} mt-3`} data-testid="reserve-signin">
          {t("signIn")}
        </Link>
      </div>
    );
  }

  const left = rules ? slotsLeft(active, rules.max) : 1;
  const limitReached = rules !== null && left === 0;
  const out = availableM !== null && availableM < moqM;

  async function submit() {
    const meters = Number(value.replace(",", "."));
    const issue = checkReserveMeters(meters, moqM, availableM);
    if (issue) return setProblem(issue);
    setProblem(null);
    setDone(null);
    setBusy(true);
    try {
      await reserve(colorId, meters);
      setDone({ meters });
      setActive((n) => n + 1);
    } catch (e) {
      setProblem(e instanceof ReserveFailure ? e.code : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-surface p-4" data-testid="reserve-box">
      <p className="flex items-center gap-2 text-sm font-medium"><Clock className="size-4 text-primary" aria-hidden />{rules ? t("titleHours", { hours: rules.hours }) : t("title")}</p>
      <p className="mt-1 text-xs text-text-muted">{t("help")}</p>

      {limitReached ? (
        <p role="status" className="mt-3 text-sm text-warning" data-testid="reserve-limit">
          {t("limit", { max: rules?.max ?? 0 })} <Link href="/account/reservations" className="underline">{t("manage")}</Link>
        </p>
      ) : out ? (
        <p className="mt-3 text-sm text-text-muted" data-testid="reserve-out">{t("out")}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium">
            {t("quantity")}
            <input
              type="number" inputMode="decimal" min={moqM} step={0.5} value={value}
              onChange={(e) => { setValue(e.target.value); setProblem(null); setDone(null); }}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              className="mt-1 block h-11 w-32 rounded-sm border border-border bg-surface px-3 text-base"
              aria-invalid={problem ? true : undefined}
              data-testid="reserve-meters"
            />
          </label>
          <Button type="button" variant="secondary" loading={busy} onClick={() => void submit()} data-testid="reserve-button">{t("button")}</Button>
        </div>
      )}

      {rules && !limitReached && <p className="mt-2 text-xs text-text-muted" data-testid="reserve-slots">{t("slots", { used: active, max: rules.max })}</p>}
      {problem && <p role="alert" className="mt-2 text-xs text-danger" data-testid="reserve-problem">{loose(t)(`problem.${problem}`, { m: formatNumber(moqM, locale), max: rules?.max ?? 0, left: formatNumber(Math.floor(availableM ?? 0), locale) })}</p>}
      {done && !problem && (
        <p role="status" className="mt-2 text-xs text-success" data-testid="reserve-done">
          {t("done", { m: formatNumber(done.meters, locale) })} <Link href="/account/reservations" className="underline">{t("view")}</Link>
        </p>
      )}
    </div>
  );
}
