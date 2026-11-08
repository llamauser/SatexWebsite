import { NextIntlClientProvider } from "next-intl";
import { clientMessages } from "@/i18n/client-messages";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider messages={await clientMessages("auth")}>{children}</NextIntlClientProvider>;
}
