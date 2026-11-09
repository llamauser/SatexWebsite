import type { Metadata } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ShowroomView } from "@/components/showroom/ShowroomView";
import { getShowroomData } from "@/lib/data/showroom";
import { clientMessages } from "@/i18n/client-messages";
import { routing } from "@/i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "showroom" });
  return { title: t("title"), description: t("lead") };
}

export default async function ShowroomPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("showroom");
  const data = await getShowroomData();
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-display text-4xl font-bold">{t("title")}</h1>
      <p className="mt-3 max-w-2xl text-text-muted">{t("lead")}</p>
      <div className="mt-8">
        <NextIntlClientProvider messages={await clientMessages("showroom")}>
          <ShowroomView initial={data} />
        </NextIntlClientProvider>
      </div>
    </main>
  );
}
