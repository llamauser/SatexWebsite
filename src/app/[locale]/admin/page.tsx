import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Dashboard } from "@/components/admin/Dashboard";
import { routing } from "@/i18n/routing";

// Access is enforced by the middleware (sales and admins).
export default async function AdminHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <p className="mb-8 mt-3 text-text-muted">{t("placeholder")}</p>
      <Dashboard />
    </div>
  );
}
