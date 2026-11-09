import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { FabricsAdmin } from "@/components/admin/FabricsAdmin";
import { routing } from "@/i18n/routing";

export default async function AdminFabricsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <FabricsAdmin />;
}
