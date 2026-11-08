import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { digitsOnly } from "@/lib/data/format";
import { getPublicSettings } from "@/lib/data/public";

/** Contact details come from app_settings (editable in the back-office); empty ones are simply not shown. */
export async function Footer() {
  const [t, tn, settings] = await Promise.all([getTranslations("footer"), getTranslations("nav"), getPublicSettings()]);
  const links = [
    { href: "/catalog", label: tn("catalog") },
    { href: "/match", label: tn("match") },
    { href: "/showroom", label: tn("showroom") },
    { href: "/about", label: tn("about") },
    { href: "/contact", label: tn("contact") },
  ] as const;

  return (
    <footer className="mt-16 border-t border-border/60 bg-surface/80">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-4 lg:px-8">
        <div className="md:col-span-1">
          <p className="font-display text-lg font-bold">
            SA<span className="text-primary">TEX</span> <span className="text-xs font-medium uppercase tracking-[0.2em] text-text-muted">Commerce</span>
          </p>
          <p className="mt-2 text-sm text-text-muted">{t("tagline")}</p>
          <p className="mt-1 text-sm font-medium text-primary-strong">{t("since", { year: settings.foundedYear })}</p>
        </div>

        <nav aria-label={t("linksTitle")}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">{t("linksTitle")}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-primary">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label={t("legalTitle")}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">{t("legalTitle")}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href="/legal/privacy" className="hover:text-primary">
                {t("privacy")}
              </Link>
            </li>
            <li>
              <Link href="/legal/terms" className="hover:text-primary">
                {t("terms")}
              </Link>
            </li>
          </ul>
        </nav>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">{t("contactTitle")}</h2>
          <ul className="mt-3 space-y-2 text-sm" data-testid="footer-contact">
            {settings.contactEmail && (
              <li>
                <a href={`mailto:${settings.contactEmail}`} className="hover:text-primary" dir="ltr">
                  {settings.contactEmail}
                </a>
              </li>
            )}
            {settings.contactPhone && (
              <li>
                <a href={`tel:${digitsOnly(settings.contactPhone)}`} className="hover:text-primary" dir="ltr">
                  {settings.contactPhone}
                </a>
              </li>
            )}
            {settings.contactAddress && <li className="text-text-muted">{settings.contactAddress}</li>}
            {settings.whatsapp && (
              <li>
                <a href={`https://wa.me/${digitsOnly(settings.whatsapp)}`} className="hover:text-primary" target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              </li>
            )}
          </ul>
        </div>
      </div>
      <div className="border-t border-border/60">
        <p className="mx-auto max-w-[1200px] px-4 py-4 text-xs text-text-muted sm:px-6 lg:px-8">
          © {new Date().getFullYear()} {settings.companyName}. {t("rights")}
        </p>
      </div>
    </footer>
  );
}
