import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { BlobBackground } from "@/components/layout/BlobBackground";
import { buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getPublicSettings } from "@/lib/data/public";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "about" });
  return { title: t("title"), description: t("lead") };
}

const DEPARTMENTS = ["fabricHalls", "cutting", "shipping", "studio"] as const;
const VALUES = ["service", "transparency", "availability"] as const;

// About copy is provisional (docs/12-seed-data.md): SATEX should review it. Only facts from the promo video are stated.
export default async function AboutPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [t, settings] = await Promise.all([getTranslations("about"), getPublicSettings()]);

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 lg:px-8">
      <BlobBackground />
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-beige">{t("eyebrow", { year: settings.foundedYear })}</p>
        <h1 className="mt-2 font-display text-4xl font-bold sm:text-5xl">{t("title")}</h1>
        <p className="mt-4 text-lg text-text-muted">{t("lead")}</p>
      </header>

      <section className="mt-12" aria-labelledby="story-title">
        <h2 id="story-title" className="font-display text-2xl font-bold">
          {t("story.title")}
        </h2>
        <div className="mt-3 max-w-3xl space-y-3 text-text-muted">
          <p>{t("story.p1", { year: settings.foundedYear })}</p>
          <p>{t("story.p2")}</p>
        </div>
      </section>

      <section className="mt-12" aria-labelledby="dept-title">
        <h2 id="dept-title" className="font-display text-2xl font-bold">
          {t("departments.title")}
        </h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {DEPARTMENTS.map((d) => (
            <li key={d}>
              <Card className="h-full p-5 sm:p-5">
                <h3 className="font-semibold">{t(`departments.${d}.title`)}</h3>
                <p className="mt-1 text-sm text-text-muted">{t(`departments.${d}.body`)}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12" aria-labelledby="values-title">
        <h2 id="values-title" className="font-display text-2xl font-bold">
          {t("values.title")}
        </h2>
        <ul className="mt-5 grid gap-4 md:grid-cols-3">
          {VALUES.map((v) => (
            <li key={v}>
              <Card className="h-full p-5 sm:p-5">
                <h3 className="font-semibold">{t(`values.${v}.title`)}</h3>
                <p className="mt-1 text-sm text-text-muted">{t(`values.${v}.body`)}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-12 text-center">
        <Link href="/contact" className={buttonStyles({ size: "lg" })} style={{ background: "var(--primary-gradient)" }}>
          {t("cta")}
        </Link>
      </p>
    </main>
  );
}
