import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { DepartmentsAdmin } from "@/components/admin/DepartmentsAdmin";
import { routing } from "@/i18n/routing";

export default async function AdminDepartmentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <DepartmentsAdmin />;
}
