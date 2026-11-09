import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AccountMenu } from "./AccountMenu";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { DesktopNav, MobileNav } from "./MainNav";
import { CartButton } from "./CartButton";
import { LazyBell } from "./LazyBell";

/** The quote cart icon arrives with P1-10. */
export function Header() {
  const t = useTranslations("common");
  return (
    <header className="relative z-20 border-b border-border/60 bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0 font-display text-lg font-bold tracking-tight">
          SA<span className="text-primary">TEX</span>
          <span className="ms-2 hidden text-xs font-medium uppercase tracking-[0.2em] text-text-muted lg:inline">Commerce</span>
          <span className="sr-only"> – {t("brandTagline")}</span>
        </Link>
        <DesktopNav />
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden md:block">
            <LanguageSwitcher />
          </div>
          <CartButton />
          <LazyBell />
          <AccountMenu />
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
