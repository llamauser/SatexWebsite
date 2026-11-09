import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { LegalPage } from "@/components/layout/LegalPage";
import { LEGAL } from "@/content/legal";
import { routing } from "@/i18n/routing";
import { alternatesFor } from "@/lib/seo";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  return { title: LEGAL.privacy[locale].title, alternates: alternatesFor(locale, "/legal/privacy") };
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <LegalPage doc="privacy" locale={locale} />;
}
