import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AddToCompare } from "@/components/compare/AddToCompare";
import { MiniFeelCard } from "@/components/feel/FeelCard";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getFabricDetailsByIds } from "@/lib/data/catalog";
import { localized } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";

export const metadata: Metadata = { robots: { index: false, follow: true } };

export default async function ComparePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ ids?: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { ids = "" } = await searchParams;
  const requested = ids.split(",").slice(0, 3);
  const [fabrics, t, feelT, tf, tc] = await Promise.all([
    getFabricDetailsByIds(requested), getTranslations("compare"), getTranslations("fabric.feel"), getTranslations("fibers"), getTranslations("constructions"),
  ]);
  const rows = [
    [t("weight"), (fabric: typeof fabrics[number]) => `${fabric.gsm} GSM`],
    [t("width"), (fabric: typeof fabrics[number]) => `${fabric.widthCm} cm`],
    [t("composition"), (fabric: typeof fabrics[number]) => fabric.composition.map((fiber) => `${fiber.pct}% ${loose(tf)(fiber.fiber)}`).join(" · ")],
    [t("construction"), (fabric: typeof fabrics[number]) => loose(tc)(fabric.construction)],
    [t("stock"), (fabric: typeof fabrics[number]) => `${Math.max(0, ...Object.values(fabric.availability)).toFixed(1)} m`],
    [t("price"), (fabric: typeof fabrics[number]) => fabric.tiers.length ? `${Math.min(...fabric.tiers.map((tier) => tier.pricePerM)).toFixed(2)} / m` : "—"],
  ] as const;
  return <main className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
    <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
    {!fabrics.length ? <p className="mt-4 text-text-muted">{t("empty")}</p> : <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="min-w-[640px] w-full border-collapse text-sm" data-testid="fabric-comparison">
        <thead><tr><th className="w-44 border-b border-border p-4 text-start font-medium text-text-muted">{t("feel")}</th>{fabrics.map((fabric) => <th key={fabric.id} className="min-w-52 border-b border-border p-4 text-start align-top">
          <div className="flex items-start gap-3"><Link href={`/catalog/${fabric.slug}`} className="font-semibold text-primary hover:underline">{localized(fabric.name, locale)}</Link><MiniFeelCard scores={fabric.feel} /></div>
          <p className="mt-1 text-xs text-text-muted">{fabric.sku}</p><div className="mt-2 flex gap-1">{fabric.colors.slice(0, 8).map((color) => <span key={color.id} title={localized(color.name, locale)} className="size-4 rounded-full border border-border" style={{ backgroundColor: color.hex }} />)}</div>
          <AddToCompare fabricId={fabric.id} slug={fabric.slug} className="mt-3" />
        </th>)}</tr></thead>
        <tbody>
          {rows.map(([label, getValue]) => <tr key={label}><th scope="row" className="border-b border-border p-4 text-start font-medium text-text-muted">{label}</th>{fabrics.map((fabric) => <td key={fabric.id} className="border-b border-border p-4">{getValue(fabric)}</td>)}</tr>)}
          {( ["softness", "drape", "stretch", "sheen", "breathability"] as const).map((axis) => <tr key={axis}><th scope="row" className="border-b border-border p-4 text-start font-medium text-text-muted">{feelT(`axes.${axis}`)}</th>{fabrics.map((fabric) => <td key={fabric.id} className="border-b border-border p-4"><span className="font-semibold tabular-nums" dir="ltr">{fabric.feel[axis].toFixed(1)} / 10</span><span className="ms-2 text-xs text-text-muted">{t(`source.${fabric.feel.source}`)}</span></td>)}</tr>)}
        </tbody>
      </table>
    </div>}
  </main>;
}
