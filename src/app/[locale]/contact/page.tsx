import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ContactForm } from "@/components/contact/ContactForm";
import { BlobBackground } from "@/components/layout/BlobBackground";
import { Card } from "@/components/ui/Field";
import { clientMessages } from "@/i18n/client-messages";
import { routing } from "@/i18n/routing";
import { digitsOnly } from "@/lib/data/format";
import { getPublicSettings } from "@/lib/data/public";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "contact" });
  return { title: t("title"), description: t("lead") };
}

export default async function ContactPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [t, settings] = await Promise.all([getTranslations("contact"), getPublicSettings()]);

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 lg:px-8">
      <BlobBackground />
      <header className="max-w-2xl">
        <h1 className="font-display text-4xl font-bold sm:text-5xl">{t("title")}</h1>
        <p className="mt-4 text-lg text-text-muted">{t("lead")}</p>
      </header>
      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_360px]">
        <Card>
          <NextIntlClientProvider messages={await clientMessages("contact")}>
            <ContactForm />
          </NextIntlClientProvider>
        </Card>
        <aside aria-label={t("detailsTitle")} className="space-y-4">
          <Card className="p-6 sm:p-6">
            <h2 className="font-display text-xl font-semibold">{t("detailsTitle")}</h2>
            <ul className="mt-4 space-y-3 text-sm">
              {settings.contactEmail && (
                <li className="flex gap-3">
                  <Mail className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <a href={`mailto:${settings.contactEmail}`} className="hover:text-primary" dir="ltr">
                    {settings.contactEmail}
                  </a>
                </li>
              )}
              {settings.contactPhone && (
                <li className="flex gap-3">
                  <Phone className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <a href={`tel:${digitsOnly(settings.contactPhone)}`} className="hover:text-primary" dir="ltr">
                    {settings.contactPhone}
                  </a>
                </li>
              )}
              {settings.contactAddress && (
                <li className="flex gap-3">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span>{settings.contactAddress}</span>
                </li>
              )}
              {settings.whatsapp && (
                <li className="flex gap-3">
                  <MessageCircle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <a href={`https://wa.me/${digitsOnly(settings.whatsapp)}`} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                    WhatsApp
                  </a>
                </li>
              )}
            </ul>
          </Card>
          <Card className="p-6 sm:p-6">
            <h2 className="font-display text-lg font-semibold">{t("mapTitle")}</h2>
            <p className="mt-2 text-sm text-text-muted">{t("mapPlaceholder")}</p>
          </Card>
        </aside>
      </div>
    </main>
  );
}
