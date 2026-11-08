import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CatalogFilters } from "@/components/catalog/CatalogFilters";
import { ActiveFilters, SortSelect } from "@/components/catalog/CatalogToolbar";
import { FabricCard } from "@/components/catalog/FabricCard";
import { Pagination } from "@/components/catalog/Pagination";
import { BlobBackground } from "@/components/layout/BlobBackground";
import { buttonStyles } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageCount, parseCatalogParams } from "@/lib/catalog/params";
import { getCatalogCategories, searchCatalog } from "@/lib/data/catalog";
import { localized } from "@/lib/data/format";
import { getPublicSettings } from "@/lib/data/public";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "catalog" });
  return { title: t("title"), description: t("lead") };
}

export default async function CatalogPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const filters = parseCatalogParams(await searchParams);
  const [t, result, categories, settings] = await Promise.all([
    getTranslations("catalog"),
    searchCatalog(filters),
    getCatalogCategories(),
    getPublicSettings(),
  ]);
  const pages = pageCount(result.total);
  const categoryOptions = categories.map((c) => ({ slug: c.slug, label: localized(c.name, locale) }));
  const categoryLabels = Object.fromEntries(categoryOptions.map((c) => [c.slug, c.label]));

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
      <BlobBackground />
      <header className="max-w-2xl">
        <h1 className="font-display text-4xl font-bold">{t("title")}</h1>
        <p className="mt-2 text-text-muted">{t("lead")}</p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[280px_1fr]">
        <CatalogFilters filters={filters} categories={categoryOptions} />

        <section aria-label={t("results")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-muted" role="status" aria-live="polite" data-testid="results-count">
              {result.ok ? t("count", { count: result.total }) : ""}
            </p>
            <SortSelect filters={filters} />
          </div>
          <div className="mt-3">
            <ActiveFilters filters={filters} categoryLabels={categoryLabels} />
          </div>

          {!result.ok && <div className="mt-6"><Alert kind="info">{t("unavailable")}</Alert></div>}

          {result.ok && result.items.length === 0 && (
            <div className="mt-10 rounded-md border border-dashed border-border bg-surface p-10 text-center" data-testid="catalog-empty">
              <h2 className="font-display text-xl font-semibold">{t("empty.title")}</h2>
              <p className="mt-2 text-text-muted">{filters.page > 1 && result.total > 0 ? t("empty.page") : t("empty.body")}</p>
              <Link href="/catalog" className={`${buttonStyles({ variant: "secondary" })} mt-5`}>
                {t("empty.reset")}
              </Link>
            </div>
          )}

          {result.items.length > 0 && (
            <ul className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3" data-testid="catalog-grid">
              {result.items.map((item, i) => (
                <li key={item.id}>
                  <FabricCard item={item} locale={locale} currency={settings.currency} lowThresholdM={settings.lowStockThresholdM} priority={i < 3} />
                </li>
              ))}
            </ul>
          )}

          <Pagination filters={filters} pages={pages} />
        </section>
      </div>
    </main>
  );
}
