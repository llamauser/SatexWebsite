"use client";

import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { buttonStyles } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { localized } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { loadSamples, type SampleRow, type SampleRules } from "@/lib/samples/client";
import { FLOW, flowIndex, isOpen, SAMPLE_STATUSES, type SampleStatus } from "@/lib/samples/rules";
import { cn } from "@/lib/utils";

const PILL: Record<SampleStatus, string> = {
  requested: "bg-surface-muted text-text-muted",
  approved: "bg-primary/10 text-primary",
  rejected: "bg-danger/10 text-danger",
  preparing: "bg-primary/10 text-primary",
  shipped: "bg-warning/15 text-warning",
  delivered: "bg-success/10 text-success",
};

export function SamplesList() {
  const t = useTranslations("samples");
  const ts = useTranslations("samples.status");
  const locale = useLocale();
  const [data, setData] = useState<{ rows: SampleRow[]; rules: SampleRules } | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    void loadSamples().then((r) => (r ? setData(r) : setFailed(true)));
  }, []);

  const date = (iso: string) => new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium" }).format(new Date(iso));
  const rows = (data?.rows ?? []).filter((r) => filter === "all" || r.status === filter);
  const open = (data?.rows ?? []).filter((r) => isOpen(r.status)).length;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">{t("list.title")}</h1>
          {data && <p className="mt-1 text-sm text-text-muted" data-testid="samples-open">{t("list.open", { n: open, max: data.rules.maxOpen })}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-text-muted">{t("list.filter")}</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-10 rounded-full border border-border bg-surface px-3" data-testid="sample-filter">
              <option value="all">{t("list.all")}</option>
              {SAMPLE_STATUSES.map((s) => <option key={s} value={s}>{loose(ts)(s)}</option>)}
            </select>
          </label>
          <Link href="/account/samples/new" className={buttonStyles()} style={{ background: "var(--primary-gradient)" }} data-testid="new-sample">{t("list.new")}</Link>
        </div>
      </div>

      {failed && <div className="mt-6"><Alert>{t("list.error")}</Alert></div>}
      {data === null && !failed && <p className="mt-6 text-text-muted">{t("list.loading")}</p>}
      {data && rows.length === 0 && (
        <div className="mt-8 rounded-md border border-dashed border-border bg-surface p-10 text-center" data-testid="samples-empty">
          <p className="text-text-muted">{data.rows.length === 0 ? t("list.none") : t("list.noneForFilter")}</p>
          {data.rows.length === 0 && <Link href="/catalog" className={`${buttonStyles({ variant: "secondary" })} mt-4`}>{t("list.browse")}</Link>}
        </div>
      )}

      {rows.length > 0 && (
        <ul className="mt-6 space-y-4" data-testid="samples-list">
          {rows.map((r) => {
            const at = flowIndex(r.status);
            return (
              <li key={r.id} className="rounded-md border border-border bg-surface p-4" data-testid="sample-row" data-ref={r.ref} data-status={r.status}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold" dir="ltr">{r.ref}</p>
                    <p className="text-xs text-text-muted">{t("list.sentOn", { date: date(r.createdAt) })} · {t("list.colors", { count: r.items.length })}</p>
                  </div>
                  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", PILL[r.status])} data-testid="sample-status">{loose(ts)(r.status)}</span>
                </div>

                {r.status !== "rejected" && (
                  <ol className="mt-4 flex items-center gap-1 text-xs" aria-label={t("list.progress")} data-testid="sample-progress">
                    {FLOW.map((s, i) => (
                      <li key={s} className={cn("flex flex-1 flex-col items-center gap-1 text-center", i <= at ? "text-primary" : "text-text-muted")} aria-current={i === at ? "step" : undefined}>
                        <span className={cn("flex size-6 items-center justify-center rounded-full border", i <= at ? "border-primary bg-primary text-white" : "border-border")}>
                          {i < at ? <Check className="size-3.5" aria-hidden /> : i + 1}
                        </span>
                        <span>{loose(ts)(s)}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {r.status === "rejected" && <p className="mt-3 text-sm text-danger" data-testid="sample-reason">{t("list.reason", { reason: r.rejectionReason ?? "–" })}</p>}
                {(r.status === "shipped" || r.status === "delivered") && r.tracking && (
                  <p className="mt-3 text-sm" data-testid="sample-tracking">{t("list.tracking", { carrier: r.carrier ?? "–", number: r.tracking })}</p>
                )}

                <ul className="mt-4 flex flex-wrap gap-2">
                  {r.items.map((i) => (
                    <li key={i.colorId}>
                      <Link href={`/catalog/${i.slug}`} className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs hover:bg-surface-muted">
                        <span className="size-3.5 rounded-full border border-border" style={{ background: i.hex }} aria-hidden />
                        {localized(i.fabricName, locale)} · {localized(i.colorName, locale)}
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-text-muted">{[r.address.line1, r.address.city, r.address.country].filter(Boolean).join(", ")}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
