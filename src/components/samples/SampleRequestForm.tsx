"use client";

import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccountData } from "@/components/account/useAccountData";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Alert, Input } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { localized } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import {
  countOpen, describeSelection, loadRules, loadSamples, readSelection, requestSamples, SampleFailure, SAMPLES_CHANGED, unselectColor,
  type SampleItem, type SampleRules,
} from "@/lib/samples/client";
import { DEFAULT_MAX_COLORS, EMPTY_ADDRESS, missingAddressFields, type ShippingAddress } from "@/lib/samples/rules";

const FIELDS: { key: keyof ShippingAddress; required: boolean; autoComplete: string }[] = [
  { key: "recipient", required: false, autoComplete: "name" },
  { key: "line1", required: true, autoComplete: "shipping address-line1" },
  { key: "line2", required: false, autoComplete: "shipping address-line2" },
  { key: "city", required: true, autoComplete: "shipping address-level2" },
  { key: "postal_code", required: false, autoComplete: "shipping postal-code" },
  { key: "country", required: true, autoComplete: "shipping country-name" },
  { key: "phone", required: false, autoComplete: "tel" },
];

/** The sample request form: the chosen colors, the shipping address (prefilled from the account), and the send button. */
export function SampleRequestForm() {
  const t = useTranslations("samples.form");
  const locale = useLocale();
  const { profile, addresses, status } = useAccountData();
  const [ids, setIds] = useState<string[]>([]);
  const [items, setItems] = useState<SampleItem[] | null>(null);
  const [rules, setRules] = useState<SampleRules | null>(null);
  const [open, setOpen] = useState(0);
  const [address, setAddress] = useState<ShippingAddress>(EMPTY_ADDRESS);
  const [touched, setTouched] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string } | null>(null);
  const prefilled = useRef(false);

  // the selection: read once, then follow changes (another tab, the remove buttons)
  useEffect(() => {
    const sync = () => setIds(readSelection(100));
    sync();
    window.addEventListener(SAMPLES_CHANGED, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SAMPLES_CHANGED, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const idsKey = ids.join(",");
  useEffect(() => {
    let cancelled = false;
    void describeSelection(idsKey ? idsKey.split(",") : []).then((r) => !cancelled && setItems(r));
    return () => { cancelled = true; };
  }, [idsKey]);

  useEffect(() => {
    void (async () => {
      const sb = await loadBrowserSupabase();
      if (sb) setRules(await loadRules(sb));
      const mine = await loadSamples();
      if (mine) setOpen(countOpen(mine.rows));
    })();
  }, []);

  // prefill from the account (the shipping address, else the billing one) unless the client already started typing
  useEffect(() => {
    if (status !== "ready" || !profile || prefilled.current || touched) return;
    prefilled.current = true;
    const a = addresses.find((x) => x.kind === "shipping") ?? addresses.find((x) => x.kind === "billing");
    setAddress({
      recipient: profile.fullName || profile.companyName, line1: a?.line1 ?? "", line2: a?.line2 ?? "", city: a?.city ?? "",
      postal_code: a?.postalCode ?? "", country: a?.country ?? profile.country, phone: profile.phone,
    });
  }, [status, profile, addresses, touched]);

  const maxColors = rules?.maxColors ?? DEFAULT_MAX_COLORS;
  const shown = useMemo(() => items ?? [], [items]);
  const openLimit = rules !== null && open >= rules.maxOpen;
  const tooMany = shown.length > maxColors;

  async function submit() {
    const gaps = missingAddressFields(address);
    setMissing(gaps);
    setError(null);
    if (gaps.length > 0) return;
    setBusy(true);
    try {
      const res = await requestSamples(shown.map((i) => i.colorId), address);
      setDone({ ref: res.ref });
    } catch (e) {
      setError(e instanceof SampleFailure ? e.code : "error");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4" data-testid="sample-submitted">
        <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
        <Alert kind="success">{t("submitted", { ref: done.ref })}</Alert>
        <Link href="/account/samples" className={buttonStyles()} style={{ background: "var(--primary-gradient)" }}>{t("viewRequests")}</Link>
      </div>
    );
  }

  return (
    <div data-testid="sample-form">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <p className="mt-1 text-sm text-text-muted">{t("intro", { max: maxColors })}</p>

      <section className="mt-6" aria-labelledby="sample-colors-title">
        <h2 id="sample-colors-title" className="font-display text-xl font-semibold">{t("colors")}</h2>
        <p className="text-xs text-text-muted" data-testid="sample-count">{t("count", { n: shown.length, max: maxColors })}</p>
        {items === null ? (
          <p className="mt-3 text-text-muted">{t("loading")}</p>
        ) : shown.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-border bg-surface p-8 text-center" data-testid="sample-empty">
            <p className="text-text-muted">{t("none")}</p>
            <Link href="/catalog" className={`${buttonStyles({ variant: "secondary" })} mt-4`}>{t("browse")}</Link>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-md border border-border bg-surface" data-testid="sample-colors">
            {shown.map((i) => (
              <li key={i.colorId} className="flex items-center gap-3 px-4 py-3" data-testid="sample-color">
                <span className="size-6 shrink-0 rounded-full border border-border" style={{ background: i.hex }} aria-hidden />
                <span className="flex-1 text-sm">
                  <Link href={`/catalog/${i.slug}`} className="font-medium hover:text-primary">{localized(i.fabricName, locale)}</Link>
                  <span className="block text-xs text-text-muted">{localized(i.colorName, locale)}</span>
                </span>
                <button type="button" onClick={() => unselectColor(i.colorId)} aria-label={t("remove")} className="rounded-full p-1.5 text-text-muted hover:bg-surface-muted hover:text-danger" data-testid="sample-remove">
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {tooMany && <p role="alert" className="mt-2 text-sm text-danger" data-testid="sample-too-many">{t("tooMany", { max: maxColors })}</p>}
      </section>

      <section className="mt-8" aria-labelledby="sample-address-title">
        <h2 id="sample-address-title" className="font-display text-xl font-semibold">{t("address")}</h2>
        <p className="text-xs text-text-muted">{t("addressHelp")}</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.key === "line1" || f.key === "line2" || f.key === "recipient" ? "sm:col-span-2" : undefined}>
              <Input
                name={f.key}
                label={`${t(`field.${f.key}`)}${f.required ? " *" : ""}`}
                value={address[f.key]}
                onChange={(e) => { setTouched(true); setAddress((a) => ({ ...a, [f.key]: e.target.value })); }}
                autoComplete={f.autoComplete}
                maxLength={200}
                error={missing.includes(f.key) ? t("required") : undefined}
                data-testid={`sample-${f.key}`}
              />
            </div>
          ))}
        </div>
      </section>

      {openLimit && rules && <div className="mt-6"><Alert kind="info"><span data-testid="sample-open-limit">{t("openLimit", { max: rules.maxOpen })}</span> <Link href="/account/samples" className="underline">{t("viewRequests")}</Link></Alert></div>}
      {error && <div className="mt-6"><Alert>{loose(t)(`error.${error}`, { max: maxColors, open: rules?.maxOpen ?? 2 })}</Alert></div>}

      <div className="mt-6">
        <Button type="button" loading={busy} disabled={shown.length === 0 || tooMany || openLimit} onClick={() => void submit()} data-testid="sample-submit">{t("submit")}</Button>
      </div>
    </div>
  );
}
