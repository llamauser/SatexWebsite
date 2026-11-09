import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { FabricEditor } from "@/components/admin/FabricEditor";
import { routing } from "@/i18n/routing";

export default async function AdminEditFabricPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <FabricEditor id={id} />;
}
