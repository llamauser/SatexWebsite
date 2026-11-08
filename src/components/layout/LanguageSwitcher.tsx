"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const t = useTranslations("languages");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function switchTo(next: AppLocale) {
    if (next === locale) return;
    // Keep the same path and query string, only the locale changes.
    const query = Object.fromEntries(new URLSearchParams(window.location.search));
    router.replace({ pathname, query }, { locale: next });
  }

  return (
    <nav aria-label={t("label")}>
      <ul className="flex items-center gap-1 rounded-full bg-surface-muted p-1">
        {routing.locales.map((l) => (
          <li key={l}>
            <button
              type="button"
              lang={l}
              title={t(`names.${l}`)}
              aria-current={l === locale ? "true" : undefined}
              onClick={() => switchTo(l)}
              className={cn(
                "h-8 min-w-10 rounded-full px-3 text-sm font-medium transition-colors",
                l === locale ? "bg-text text-white" : "text-text-muted hover:text-text",
              )}
            >
              {t(`short.${l}`)}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
