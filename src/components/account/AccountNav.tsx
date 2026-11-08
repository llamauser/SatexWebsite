"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/account", key: "overview", exact: true },
  { href: "/account/profile", key: "profile", exact: false },
] as const;

export function AccountNav() {
  const t = useTranslations("account.nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="flex gap-1 overflow-x-auto border-b border-border">
      {ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium",
              active ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text",
            )}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
