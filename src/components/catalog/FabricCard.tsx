import { getTranslations } from "next-intl/server";
import { FabricImage } from "@/components/home/FabricImage";
import { Link } from "@/i18n/navigation";
import { compositionShort } from "@/lib/catalog/params";
import type { CatalogItem } from "@/lib/data/catalog";
import { formatMoney, localized } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { cn } from "@/lib/utils";

export function StockBadge({ level, label }: { level: "in" | "low" | "out"; label: string }) {
  const styles = {
    in: "bg-success/10 text-success",
    low: "bg-warning/15 text-warning",
    out: "bg-surface-muted text-text-muted",
  }[level];
  return <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold", styles)}>{label}</span>;
}

export async function FabricCard({
  item, locale, currency, lowThresholdM, priority = false,
}: { item: CatalogItem; locale: string; currency: string; lowThresholdM: number; priority?: boolean }) {
  const [t, ts] = await Promise.all([getTranslations("catalog.card"), getTranslations("structures")]);
  const name = localized(item.name, locale);
  const level = !item.inStock ? "out" : item.availableM < lowThresholdM ? "low" : "in";
  const extra = item.colorCount - item.colors.length;

  return (
    <Link
      href={`/catalog/${item.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-md border border-border bg-surface shadow-card transition hover:-translate-y-0.5"
    >
      <div className="relative aspect-[4/3] bg-surface-muted">
        <FabricImage path={item.imagePath} alt={name} sizes="(min-width: 1280px) 280px, (min-width: 640px) 33vw, 100vw" priority={priority} />
        <span className="absolute start-3 top-3">
          <StockBadge level={level} label={t(`stock.${level}`)} />
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-semibold leading-snug group-hover:text-primary">{name}</h3>
        <p className="mt-1 text-sm text-text-muted">
          {loose(ts)(item.structure)} · {item.gsm} GSM · {item.widthCm} cm
        </p>
        <p className="mt-1 text-xs text-text-muted" dir="ltr">
          {compositionShort(item.composition)}
        </p>
        <div className="mt-3 flex items-center gap-1.5" aria-label={t("colors", { count: item.colorCount })}>
          {item.colors.map((c) => (
            <span key={c.code} title={localized(c.name, locale)} className="size-5 rounded-full border border-border" style={{ background: c.hex }} />
          ))}
          {extra > 0 && <span className="text-xs text-text-muted">+{extra}</span>}
        </div>
        {item.fromPrice !== null && (
          <p className="mt-auto pt-3 text-sm font-medium text-primary-strong">{t("from", { price: formatMoney(item.fromPrice, currency, locale) })}</p>
        )}
      </div>
    </Link>
  );
}
