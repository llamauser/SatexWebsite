import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AccountOverview } from "@/components/account/AccountOverview";
import { routing } from "@/i18n/routing";

// Quotes, reservations, orders and matches are added to this dashboard by P1-10 .. P1-15.
export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <AccountOverview />;
}
