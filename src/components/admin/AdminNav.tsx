"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useStaffRole } from "./useRole";

const ITEMS = [
  { href: "/admin", key: "dashboard", exact: true, adminOnly: false },
  { href: "/admin/fabrics", key: "fabrics", exact: false, adminOnly: false },
  { href: "/admin/stock", key: "stock", exact: false, adminOnly: false },
  { href: "/admin/departments", key: "departments", exact: false, adminOnly: true },
  { href: "/admin/users", key: "users", exact: false, adminOnly: true },
  { href: "/admin/settings", key: "settings", exact: false, adminOnly: true },
  { href: "/admin/match-logs", key: "matchLogs", exact: false, adminOnly: true },
] as const;

export function AdminNav() {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  const role = useStaffRole();
  return (
    <nav aria-label={t("label")} className="flex gap-1 overflow-x-auto border-b border-border" data-testid="admin-nav">
      {ITEMS.filter((i) => !i.adminOnly || role === "admin").map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href} href={item.href} aria-current={active ? "page" : undefined}
            className={cn("whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium", active ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text")}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
