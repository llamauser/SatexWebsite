import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { BlobBackground } from "@/components/layout/BlobBackground";
import { buttonStyles } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export default async function ForbiddenPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("errors.forbidden");
  return (
    <>
      <BlobBackground />
      <main className="mx-auto flex min-h-[60vh] max-w-[1200px] flex-col items-center justify-center px-4 text-center">
        <h1 className="font-display text-4xl font-bold">{t("title")}</h1>
        <p className="mt-3 text-text-muted">{t("body")}</p>
        <Link href="/" className={`${buttonStyles()} mt-8`} style={{ background: "var(--primary-gradient)" }}>
          {t("cta")}
        </Link>
      </main>
    </>
  );
}
