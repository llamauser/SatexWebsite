import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  ContactCta, FeaturedCategories, FeaturedFabrics, Hero, ShowroomTeaser, SinceSection, ValueProps,
} from "@/components/home/HomeSections";
import { BlobBackground } from "@/components/layout/BlobBackground";
import { JsonLd } from "@/components/seo/JsonLd";
import { getPublicSettings } from "@/lib/data/public";
import { routing } from "@/i18n/routing";
import { alternatesFor, localizedPath, organizationLd, siteUrl } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  return { alternates: alternatesFor(locale, "/") };
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [settings, t] = await Promise.all([getPublicSettings(), getTranslations({ locale, namespace: "metadata" })]);
  return (
    <main>
      <JsonLd data={organizationLd({
        name: settings.companyName, url: `${siteUrl()}${localizedPath(locale, "/")}`, description: t("description"), email: settings.contactEmail,
        phone: settings.contactPhone || undefined, foundedYear: settings.foundedYear,
      })} />
      <BlobBackground />
      <Hero />
      <ValueProps />
      <FeaturedCategories locale={locale} />
      <FeaturedFabrics locale={locale} />
      <ShowroomTeaser />
      <SinceSection />
      <ContactCta />
    </main>
  );
}
