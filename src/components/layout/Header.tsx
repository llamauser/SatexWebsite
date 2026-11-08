import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "./LanguageSwitcher";

/** Navigation links, account menu and quote cart arrive in P1-05 / P1-06. */
export function Header() {
  const t = useTranslations("common");
  return (
    <header className="border-b border-border/60 bg-surface/70 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="font-display text-lg font-bold tracking-tight">
          SA<span className="text-primary">TEX</span>
          <span className="ms-2 hidden text-xs font-medium uppercase tracking-[0.2em] text-text-muted sm:inline">
            Commerce
          </span>
          <span className="sr-only"> – {t("brandTagline")}</span>
        </Link>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
