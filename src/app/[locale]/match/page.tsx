import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { MatchWizard } from "@/components/match/MatchWizard";
import { BlobBackground } from "@/components/layout/BlobBackground";
import { routing } from "@/i18n/routing";
import { alternatesFor } from "@/lib/seo";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "match.wizard" });
  return { title: t("title"), description: t("lead"), alternates: alternatesFor(locale, "/match") };
}

export default async function MatchPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("match.wizard");
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
      <BlobBackground />
      <header className="mx-auto mb-8 max-w-2xl text-center">
        <h1 className="font-display text-4xl font-bold">{t("title")}</h1>
        <p className="mt-2 text-text-muted">{t("lead")}</p>
      </header>
      <MatchWizard />
    </main>
  );
}
