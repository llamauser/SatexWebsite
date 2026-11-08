import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { pageWindow } from "@/lib/catalog/pagination";
import { serializeCatalogParams, type CatalogFilters } from "@/lib/catalog/params";
import { cn } from "@/lib/utils";

export async function Pagination({ filters, pages }: { filters: CatalogFilters; pages: number }) {
  const t = await getTranslations("catalog.pagination");
  if (pages <= 1) return null;
  const href = (page: number) => ({
    pathname: "/catalog" as const,
    query: Object.fromEntries(serializeCatalogParams({ ...filters, page })),
  });
  const base = "flex size-10 items-center justify-center rounded-full text-sm font-medium";
  return (
    <nav aria-label={t("label")} className="mt-10 flex flex-wrap items-center justify-center gap-1">
      {filters.page > 1 && (
        <Link href={href(filters.page - 1)} aria-label={t("prev")} className={cn(base, "border border-border hover:bg-surface-muted")}>
          <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
        </Link>
      )}
      {pageWindow(filters.page, pages).map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="px-1 text-text-muted" aria-hidden>
            …
          </span>
        ) : (
          <Link
            key={p}
            href={href(p)}
            aria-current={p === filters.page ? "page" : undefined}
            aria-label={t("page", { page: p })}
            className={cn(base, p === filters.page ? "bg-text text-white" : "border border-border hover:bg-surface-muted")}
          >
            {p}
          </Link>
        ),
      )}
      {filters.page < pages && (
        <Link href={href(filters.page + 1)} aria-label={t("next")} className={cn(base, "border border-border hover:bg-surface-muted")}>
          <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </Link>
      )}
    </nav>
  );
}
