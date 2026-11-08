"use client";

import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "./LanguageSwitcher";

export const NAV_ITEMS = [
  { href: "/catalog", key: "catalog" },
  { href: "/match", key: "match" },
  { href: "/showroom", key: "showroom" },
  { href: "/about", key: "about" },
  { href: "/contact", key: "contact" },
] as const;

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop navigation (md and up). */
export function DesktopNav() {
  const t = useTranslations("nav");
  const isActive = useActive();
  return (
    <nav aria-label={t("main")} className="hidden items-center gap-1 md:flex">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(item.href) ? "page" : undefined}
          className={cn(
            "rounded-full px-3 py-2 text-sm font-medium transition-colors",
            isActive(item.href) ? "bg-surface-muted text-primary-strong" : "text-text-muted hover:text-text",
          )}
        >
          {t(item.key)}
        </Link>
      ))}
    </nav>
  );
}

/** Hamburger menu (below md): navigation links and the language switcher. */
export function MobileNav() {
  const t = useTranslations("nav");
  const isActive = useActive();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? t("closeMenu") : t("openMenu")}
        onClick={() => setOpen((v) => !v)}
        className="flex size-10 items-center justify-center rounded-full text-text hover:bg-surface-muted"
        data-testid="mobile-nav-toggle"
      >
        {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
      </button>
      {open && (
        <div
          id="mobile-nav-panel"
          className="absolute inset-x-0 top-16 z-30 border-b border-border bg-surface p-4 shadow-pop"
          data-testid="mobile-nav-panel"
        >
          <nav aria-label={t("main")} className="flex flex-col">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(
                  "rounded-sm px-3 py-3 text-base font-medium",
                  isActive(item.href) ? "bg-surface-muted text-primary-strong" : "text-text hover:bg-surface-muted",
                )}
              >
                {t(item.key)}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex justify-center border-t border-border pt-3">
            <LanguageSwitcher />
          </div>
        </div>
      )}
    </div>
  );
}
