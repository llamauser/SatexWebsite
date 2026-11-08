import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";

// Placeholder: the real dashboard and back-office pages arrive in P1-13 / P1-15. Access is enforced by the middleware.
export default async function AdminHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <p className="mt-3 text-text-muted">{t("placeholder")}</p>
    </main>
  );
}
