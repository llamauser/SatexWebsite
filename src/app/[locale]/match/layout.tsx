import { NextIntlClientProvider } from "next-intl";
import { clientMessages } from "@/i18n/client-messages";

export default async function MatchLayout({ children }: { children: React.ReactNode }) {
  const messages = await clientMessages("match", "structures", "fibers", "constructions", "stretches", "uses");
  return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>;
}
