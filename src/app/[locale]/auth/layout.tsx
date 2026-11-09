import { NextIntlClientProvider } from "next-intl";
import { clientMessages } from "@/i18n/client-messages";
import { NOINDEX } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: NOINDEX };

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider messages={await clientMessages("auth")}>{children}</NextIntlClientProvider>;
}
