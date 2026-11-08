import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { use } from "react";
import { BlobBackground } from "@/components/layout/BlobBackground";
import { routing } from "@/i18n/routing";

// Temporary scaffold page. The real home page is built in P1-06.
export default function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = useTranslations("home.hero");

  return (
    <>
      <BlobBackground />
      <main className="mx-auto flex min-h-[70vh] max-w-[1200px] flex-col items-center justify-center px-4 text-center">
        <h1 className="font-display text-[clamp(36px,5vw,64px)] font-bold leading-tight">
          {t("title")}
        </h1>
        <p className="mt-2 font-display text-2xl font-semibold sm:text-3xl">
          {t.rich("subtitle", {
            highlight: (chunks) => <span className="text-primary">{chunks}</span>,
          })}
        </p>
      </main>
    </>
  );
}
