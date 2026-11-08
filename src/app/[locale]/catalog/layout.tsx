import { NextIntlClientProvider } from "next-intl";
import { clientMessages } from "@/i18n/client-messages";

// Client components of the catalog (filters, sort, live stock) need these namespaces; nothing else is sent to the browser.
export default async function CatalogLayout({ children }: { children: React.ReactNode }) {
  const messages = await clientMessages("catalog", "structures", "fibers", "constructions", "stretches", "seasons", "uses", "families", "fabric");
  return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>;
}
