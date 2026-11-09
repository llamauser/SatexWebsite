import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { QuoteDetail } from "@/components/quotes/QuoteDetail";
import { routing } from "@/i18n/routing";

export default async function QuotePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  setRequestLocale(locale);
  return <QuoteDetail id={id} />;
}
