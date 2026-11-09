import { NextIntlClientProvider } from "next-intl";
import { AccountNav } from "@/components/account/AccountNav";
import { clientMessages } from "@/i18n/client-messages";
import { NOINDEX } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: NOINDEX };

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider messages={await clientMessages("account", "profile", "auth", "quotes", "reservations", "samples", "orders")}>
      <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
        <AccountNav />
        <div className="py-8">{children}</div>
      </main>
    </NextIntlClientProvider>
  );
}
