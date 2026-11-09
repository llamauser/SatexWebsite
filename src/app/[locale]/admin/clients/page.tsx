import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ClientsAdmin } from "@/components/admin/ClientsAdmin";
import { routing } from "@/i18n/routing";

export default async function AdminClientsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <ClientsAdmin />;
}
