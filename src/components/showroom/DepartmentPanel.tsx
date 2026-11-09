"use client";

import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { buttonStyles } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { formatNumber, localized } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { departmentStock, panelKind, type ShowroomData, type ShowroomDepartment } from "@/lib/showroom/model";

/** What a visitor sees after choosing a department: live stock for a hall, public counters for the cutting room and the dock. */
export function DepartmentPanel({ department, data, onClose }: { department: ShowroomDepartment; data: ShowroomData; onClose: () => void }) {
  const t = useTranslations("showroom");
  const locale = useLocale();
  const kind = panelKind(department);
  const stock = kind === "hall" ? departmentStock(department, data.availability) : null;
  const name = localized(department.name, locale);
  const hasText = (t as unknown as { has: (key: string) => boolean }).has(`dept.${department.slug}`); // departments created later in the back-office have no text yet

  return (
    <aside aria-labelledby="dept-title" data-testid="department-panel" data-slug={department.slug}
      className="fixed inset-x-0 bottom-0 z-20 max-h-[70vh] overflow-y-auto rounded-t-lg border border-border bg-surface p-5 shadow-pop lg:static lg:max-h-none lg:rounded-md lg:shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">{loose(t)(`kinds.${department.kind}`)} · {t("floorName", { n: department.floor })}</p>
          <h2 id="dept-title" className="font-display text-2xl font-bold" data-testid="panel-title">{name}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label={t("panel.close")} className="rounded-full p-2 hover:bg-surface-muted" data-testid="panel-close"><X className="size-5" aria-hidden /></button>
      </div>
      <p className="mt-2 text-sm text-text-muted">{hasText ? loose(t)(`dept.${department.slug}`) : loose(t)(`kinds.${department.kind}`)}</p>

      {stock && (
        <>
          <p className="mt-4 text-sm font-medium" data-testid="panel-total">{t("panel.total", { m: formatNumber(stock.totalM, locale) })}</p>
          {stock.fabrics.length === 0 ? <p className="mt-2 text-sm text-text-muted">{t("panel.noFabrics")}</p> : (
            <ul className="mt-3 divide-y divide-border rounded-md border border-border" data-testid="panel-fabrics">
              {stock.fabrics.slice(0, 12).map((f) => (
                <li key={f.slug}>
                  <Link href={`/catalog/${f.slug}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-muted" data-testid="panel-fabric" data-slug={f.slug}>
                    <span className="flex -space-x-1.5 rtl:space-x-reverse" aria-hidden>{f.dots.map((hex) => <span key={hex} className="size-4 rounded-full border border-surface" style={{ background: hex }} />)}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{localized(f.name, locale)}</span><span className="text-xs text-text-muted"><span dir="ltr">{f.gsm}</span> g/m²</span></span>
                    <span className={f.availableM > 0 ? "text-sm font-semibold text-success" : "text-sm text-text-muted"} dir="ltr">{f.availableM > 0 ? `${formatNumber(f.availableM, locale)} m` : t("panel.out")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            {department.categorySlugs[0] && <Link href={{ pathname: "/catalog", query: { category: department.categorySlugs.join(",") } }} className={buttonStyles()} style={{ background: "var(--primary-gradient)" }} data-testid="panel-catalog">{t("panel.catalog")}</Link>}
            <Link href="/match" className={buttonStyles({ variant: "secondary" })} data-testid="panel-ai">{t("panel.ai")}</Link>
          </div>
        </>
      )}

      {kind === "counters" && (
        <dl className="mt-4 grid grid-cols-2 gap-3" data-testid="panel-counters">
          {department.kind === "cutting" ? (
            <>
              <div className="rounded-md bg-surface-muted p-3"><dd className="font-display text-3xl font-bold" dir="ltr" data-testid="counter-cutting-today">{data.stats.cuttingToday}</dd><dt className="text-xs text-text-muted">{t("panel.cuttingToday")}</dt></div>
              <div className="rounded-md bg-surface-muted p-3"><dd className="font-display text-3xl font-bold" dir="ltr" data-testid="counter-cutting-queue">{data.stats.cuttingQueue}</dd><dt className="text-xs text-text-muted">{t("panel.cuttingQueue")}</dt></div>
            </>
          ) : (
            <div className="col-span-2 rounded-md bg-surface-muted p-3"><dd className="font-display text-3xl font-bold" dir="ltr" data-testid="counter-shipped">{data.stats.shippedWeek}</dd><dt className="text-xs text-text-muted">{t("panel.shippedWeek")}</dt></div>
          )}
        </dl>
      )}

      {kind === "tour" && (
        <div className="mt-4">
          <p className="text-sm text-text-muted">{t("panel.tourSoon")}</p>
          <Link href="/contact" className={`${buttonStyles()} mt-3`} style={{ background: "var(--primary-gradient)" }} data-testid="panel-contact">{t("panel.contact")}</Link>
        </div>
      )}
    </aside>
  );
}
