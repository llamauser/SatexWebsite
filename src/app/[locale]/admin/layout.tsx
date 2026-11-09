import { NextIntlClientProvider } from "next-intl";
import { AdminNav } from "@/components/admin/AdminNav";
import { clientMessages } from "@/i18n/client-messages";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider messages={await clientMessages("admin", "quotes", "structures", "fibers", "constructions", "stretches", "seasons", "uses")}>
      <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
        <AdminNav />
        <div className="py-8">{children}</div>
      </main>
    </NextIntlClientProvider>
  );
}
