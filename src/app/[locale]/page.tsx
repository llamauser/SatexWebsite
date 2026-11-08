import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  ContactCta, FeaturedCategories, FeaturedFabrics, Hero, ShowroomTeaser, SinceSection, ValueProps,
} from "@/components/home/HomeSections";
import { BlobBackground } from "@/components/layout/BlobBackground";
import { routing } from "@/i18n/routing";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <main>
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
