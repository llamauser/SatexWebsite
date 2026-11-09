import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const SECTIONS = ["fabrics", "stock", "departments", "users", "settings", "matchLogs"] as const;
const HREF = { fabrics: "/admin/fabrics", stock: "/admin/stock", departments: "/admin/departments", users: "/admin/users", settings: "/admin/settings", matchLogs: "/admin/match-logs" } as const;

// The KPI dashboard arrives with P1-15; until then this page is the entry to the sections that exist. Access is enforced by the middleware.
export default async function AdminHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <p className="mt-3 text-text-muted">{t("placeholder")}</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="admin-sections">
        {SECTIONS.map((s) => (
          <li key={s}>
            <Link href={HREF[s]} className="block rounded-md border border-border bg-surface p-5 hover:border-primary">
              <span className="font-display text-lg font-semibold">{t(`nav.${s}`)}</span>
              <span className="mt-1 block text-sm text-text-muted">{t(`home.${s}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
