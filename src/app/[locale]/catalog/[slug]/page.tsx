import { ChevronRight, Leaf } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ColorStock, type ColorView } from "@/components/catalog/ColorStock";
import { FabricCard } from "@/components/catalog/FabricCard";
import { BlobBackground } from "@/components/layout/BlobBackground";
import { buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getFabricDetail, getSimilarFabrics } from "@/lib/data/catalog";
import { formatMoney, localized } from "@/lib/data/format";
import { getPublicSettings, storageUrl } from "@/lib/data/public";
import { loose } from "@/lib/i18n-loose";
import { breadcrumbLd, localizedPath, productLd, siteUrl } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { alternatesFor } from "@/lib/seo";

type Props = { params: Promise<{ locale: string; slug: string }> };

// Rendered on demand: the data queries are cached for 5 minutes (fetch cache), so repeat views stay cheap and a
// missing slug is a clean 404. (Static generation + notFound() + next-intl is fragile; revisit with the P1-17 SEO work.)

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const fabric = await getFabricDetail(slug);
  if (!fabric) return {};
  const image = fabric.colors[0]?.photoPath ? storageUrl(fabric.colors[0].photoPath) : null;
  return {
    title: localized(fabric.name, locale),
    description: localized(fabric.shortDescription, locale),
    alternates: alternatesFor(locale, `/catalog/${slug}`),
    openGraph: { type: "website", title: localized(fabric.name, locale), description: localized(fabric.shortDescription, locale), ...(image ? { images: [image] } : {}) },
  };
}

export default async function FabricPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const fabric = await getFabricDetail(slug);
  if (!fabric) notFound();

  const [t, tf, tn, ts, tFib, tCons, tStretch, tSeason, tUse, tFin, settings] = await Promise.all([
    getTranslations("fabric"),
    getTranslations("fabric.specs"),
    getTranslations("nav"),
    getTranslations("structures"),
    getTranslations("fibers"),
    getTranslations("constructions"),
    getTranslations("stretches"),
    getTranslations("seasons"),
    getTranslations("uses"),
    getTranslations("finishes"),
    getPublicSettings(),
  ]);
  const related = await getSimilarFabrics({ id: fabric.id, categorySlug: fabric.category.slug, gsm: fabric.gsm, structure: fabric.structure }, 4);

  const name = localized(fabric.name, locale);
  const url = `${siteUrl()}${localizedPath(locale, `/catalog/${slug}`)}`;
  const prices = fabric.tiers.map((x) => x.pricePerM); // empty when prices are not shown to visitors: then there is no offer either
  const inStock = Object.values(fabric.availability).some((m) => m >= fabric.moqM);
  const structured = [
    productLd({
      name, description: localized(fabric.shortDescription, locale) || undefined, sku: fabric.sku, url, brand: settings.companyName, currency: settings.currency,
      image: (fabric.colors[0]?.photoPath ? storageUrl(fabric.colors[0].photoPath) : null) ?? undefined,
      lowPrice: prices.length ? Math.min(...prices) : null, highPrice: prices.length ? Math.max(...prices) : null, inStock,
    }),
    breadcrumbLd([
      { name: tn("home"), url: `${siteUrl()}${localizedPath(locale, "/")}` },
      { name: tn("catalog"), url: `${siteUrl()}${localizedPath(locale, "/catalog")}` },
      { name, url },
    ]),
  ];
  const colors: ColorView[] = fabric.colors.map((c) => ({
    id: c.id,
    code: c.code,
    label: localized(c.name, locale),
    hex: c.hex,
    photoUrl: c.photoPath ? storageUrl(c.photoPath) : null,
    swatchUrl: c.swatchPath ? storageUrl(c.swatchPath) : null,
  }));
  const composition = fabric.composition.map((c) => `${c.pct}% ${loose(tFib)(c.fiber)}`).join(" · ");
  const stretch = loose(tStretch)(fabric.stretch) + (fabric.stretchPct ? ` (${fabric.stretchPct}%)` : "");
  const list = (values: string[], tt: unknown) => values.map((v) => (loose(tt)(v))).join(", ");

  const specs: [string, string][] = [
    [tf("composition"), composition],
    [tf("weight"), `${fabric.gsm} GSM`],
    [tf("width"), `${fabric.widthCm} cm`],
    [tf("construction"), loose(tCons)(fabric.construction)],
    [tf("structure"), loose(ts)(fabric.structure)],
    [tf("stretch"), stretch],
    ...(fabric.finish.length ? ([[tf("finish"), list(fabric.finish, tFin)]] as [string, string][]) : []),
    [tf("uses"), list(fabric.uses, tUse)],
    [tf("seasons"), list(fabric.seasons, tSeason)],
    [tf("moq"), `${fabric.moqM} m`],
  ];

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
      {structured.map((d, i) => <JsonLd key={i} data={d} />)}
      <BlobBackground />
      <nav aria-label={t("breadcrumb")} className="flex flex-wrap items-center gap-1 text-sm text-text-muted">
        <Link href="/" className="hover:text-primary">{tn("home")}</Link>
        <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
        <Link href="/catalog" className="hover:text-primary">{tn("catalog")}</Link>
        <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
        <Link href={{ pathname: "/catalog", query: { category: fabric.category.slug } }} className="hover:text-primary">
          {localized(fabric.category.name, locale)}
        </Link>
        <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
        <span aria-current="page" className="text-text">{name}</span>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <ColorStock
          fabricId={fabric.id}
          fabricName={name}
          colors={colors}
          initialAvailability={fabric.availability}
          moqM={fabric.moqM}
          lowThresholdM={settings.lowStockThresholdM}
        />

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-beige-strong" dir="ltr">{fabric.sku}</p>
          <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">{name}</h1>
          <p className="mt-3 text-text-muted">{localized(fabric.shortDescription, locale)}</p>

          {(fabric.eco.organic || fabric.eco.recycled_pct) && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-success">
              <Leaf className="size-4" aria-hidden />
              {fabric.eco.organic && <span>{t("eco.organic")}</span>}
              {!!fabric.eco.recycled_pct && <span>{t("eco.recycled", { pct: fabric.eco.recycled_pct })}</span>}
              {fabric.eco.certifications?.map((c) => (
                <span key={c} className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold" dir="ltr">{c}</span>
              ))}
            </p>
          )}

          <dl className="mt-6 divide-y divide-border rounded-md border border-border bg-surface" data-testid="spec-table">
            {specs.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                <dt className="text-text-muted">{label}</dt>
                <dd className="text-end font-medium">{value}</dd>
              </div>
            ))}
          </dl>

          <Card className="mt-6 p-5 sm:p-5">
            <h2 className="font-display text-lg font-semibold">{t("prices.title")}</h2>
            {fabric.tiers.length > 0 ? (
              <table className="mt-3 w-full text-sm" data-testid="price-tiers">
                <tbody className="divide-y divide-border">
                  {fabric.tiers.map((tier) => (
                    <tr key={tier.minM}>
                      <th scope="row" className="py-2 text-start font-normal text-text-muted">{t("prices.from", { m: tier.minM })}</th>
                      <td className="py-2 text-end font-semibold">{t("prices.perMeter", { price: formatMoney(tier.pricePerM, settings.currency, locale) })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-sm text-text-muted">{t("prices.hidden")}</p>
            )}
            <p className="mt-3 text-xs text-text-muted">{t("prices.note", { m: fabric.moqM })}</p>
          </Card>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={{ pathname: "/contact", query: { ref: fabric.sku } }}
              className={buttonStyles({ size: "lg" })}
              style={{ background: "var(--primary-gradient)" }}
            >
              {t("ask")}
            </Link>
            <Link href="/catalog" className={buttonStyles({ variant: "secondary", size: "lg" })}>
              {t("back")}
            </Link>
          </div>

          {fabric.tags.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-2" aria-label={t("tags")}>
              {fabric.tags.map((tag) => (
                <li key={tag} className="rounded-full bg-surface-muted px-3 py-1 text-xs text-text-muted" dir="ltr">{tag}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-16" aria-labelledby="similar-title" data-testid="similar">
          <h2 id="similar-title" className="font-display text-2xl font-bold">{t("similar")}</h2>
          <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((item) => (
              <li key={item.id}>
                <FabricCard item={item} locale={locale} currency={settings.currency} lowThresholdM={settings.lowStockThresholdM} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
