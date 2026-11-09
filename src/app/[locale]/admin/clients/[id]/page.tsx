import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ClientDetail } from "@/components/admin/ClientsAdmin";
import { routing } from "@/i18n/routing";

export default async function AdminClientPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <ClientDetail id={id} />;
}
