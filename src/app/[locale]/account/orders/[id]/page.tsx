import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { OrderDetail } from "@/components/orders/OrderDetail";
import { routing } from "@/i18n/routing";

export default async function AccountOrderPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <OrderDetail id={id} />;
}
