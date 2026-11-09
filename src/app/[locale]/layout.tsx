import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { IBM_Plex_Sans_Arabic, Inter, Poppins } from "next/font/google";
import { notFound } from "next/navigation";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { clientMessages } from "@/i18n/client-messages";
import { localeDirection, routing } from "@/i18n/routing";
import "../globals.css";
import { siteUrl } from "@/lib/seo";

// "optional": if Inter is not ready for the first paint the fallback stays for this view (metrics-matched by next/font),
// so the body text is never re-painted late by a font swap. The font is cached for the next page.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "optional" });
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-poppins",
  display: "optional", // same reason as Inter: headings are never re-painted late by a font swap
});
// Arabic font: its CSS variable class is only applied when locale === "ar".
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: t("title"), template: `%s | ${t("title")}` },
    description: t("description"),
    openGraph: { type: "website", siteName: t("title"), locale: locale === "ar" ? "ar_AR" : locale === "en" ? "en_GB" : "fr_FR" },
    twitter: { card: "summary_large_image" },
  };
}

export const revalidate = 300; // ISR: settings shown in the footer refresh every 5 minutes

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const fontClasses =
    locale === "ar"
      ? `${inter.variable} ${poppins.variable} ${plexArabic.variable}`
      : `${inter.variable} ${poppins.variable}`;

  return (
    <html lang={locale} dir={localeDirection(locale)} className={fontClasses}>
      <body>
        <NextIntlClientProvider messages={await clientMessages()}>
          <SkipLink />
          <Header />
          <div id="main-content">{children}</div>
          <Footer />
        </NextIntlClientProvider>
        {/* Vercel Web Analytics: cookieless, so no consent banner. Only on Vercel (the script is served by Vercel itself). */}
        {process.env.VERCEL ? <Analytics /> : null}
      </body>
    </html>
  );
}

async function SkipLink() {
  const t = await getTranslations("common");
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop"
    >
      {t("skipToContent")}
    </a>
  );
}
