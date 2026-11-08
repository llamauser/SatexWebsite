import { useTranslations } from "next-intl";

/** Contact info from app_settings and legal links arrive in P1-06. */
export function Footer() {
  const t = useTranslations("footer");
  return (
    <footer className="border-t border-border/60 bg-surface/70">
      <div className="mx-auto max-w-[1200px] px-4 py-8 text-sm text-text-muted sm:px-6 lg:px-8">
        SATEX Commerce · {t("since")}
      </div>
    </footer>
  );
}
