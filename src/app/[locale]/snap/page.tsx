import type { Metadata } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { BlobBackground } from "@/components/layout/BlobBackground";
import { SnapUploader } from "@/components/snap/SnapUploader";
import { clientMessages } from "@/i18n/client-messages";
import { routing } from "@/i18n/routing";
import { alternatesFor } from "@/lib/seo";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "snap" });
  return { title: t("title"), description: t("lead"), alternates: alternatesFor(locale, "/snap") };
}

export default async function SnapPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("snap");
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
      <BlobBackground />
      <header className="mx-auto mb-8 max-w-2xl text-center">
        <h1 className="font-display text-4xl font-bold">{t("title")}</h1>
        <p className="mt-2 text-text-muted">{t("lead")}</p>
      </header>
      <NextIntlClientProvider messages={await clientMessages("snap")}>
        <SnapUploader />
      </NextIntlClientProvider>
    </main>
  );
}
