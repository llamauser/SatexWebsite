"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  GSM_MAX, GSM_MIN, SORTS, type CatalogFilters as Filters, type Sort,
} from "@/lib/catalog/params";
import { loose } from "@/lib/i18n-loose";
import { useCatalogNavigation } from "./CatalogFilters";

const SORT_KEYS: Record<Sort, string> = {
  relevance: "relevance", newest: "newest", price_asc: "priceAsc", price_desc: "priceDesc", gsm_asc: "gsmAsc", gsm_desc: "gsmDesc",
};

export function SortSelect({ filters }: { filters: Filters }) {
  const t = useTranslations("catalog.sort");
  const { apply } = useCatalogNavigation(filters);
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-text-muted">{t("label")}</span>
      <select
        value={filters.sort}
        onChange={(e) => apply({ sort: e.target.value as Sort, page: 1 })}
        className="h-10 rounded-full border border-border bg-surface px-3 text-sm"
        data-testid="sort-select"
      >
        {SORTS.map((s) => (
          <option key={s} value={s}>
            {loose(t)(SORT_KEYS[s])}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One removable chip per active filter. */
export function ActiveFilters({ filters, categoryLabels }: { filters: Filters; categoryLabels: Record<string, string> }) {
  const t = useTranslations("catalog.filters");
  const tStruct = useTranslations("structures");
  const tFiber = useTranslations("fibers");
  const tCons = useTranslations("constructions");
  const tStretch = useTranslations("stretches");
  const tUse = useTranslations("uses");
  const tSeason = useTranslations("seasons");
  const tFam = useTranslations("families");
  const { apply } = useCatalogNavigation(filters);

  const chips: { key: string; label: string; remove: () => void }[] = [];
  const without = (list: string[], v: string) => list.filter((x) => x !== v);
  filters.category.forEach((v) => chips.push({ key: `category:${v}`, label: categoryLabels[v] ?? v, remove: () => apply({ category: without(filters.category, v) }) }));
  filters.construction.forEach((v) => chips.push({ key: `construction:${v}`, label: loose(tCons)(v), remove: () => apply({ construction: without(filters.construction, v) }) }));
  filters.structure.forEach((v) => chips.push({ key: `structure:${v}`, label: loose(tStruct)(v), remove: () => apply({ structure: without(filters.structure, v) }) }));
  filters.fiber.forEach((v) => chips.push({ key: `fiber:${v}`, label: loose(tFiber)(v), remove: () => apply({ fiber: without(filters.fiber, v) }) }));
  filters.stretch.forEach((v) => chips.push({ key: `stretch:${v}`, label: loose(tStretch)(v), remove: () => apply({ stretch: without(filters.stretch, v) }) }));
  filters.use.forEach((v) => chips.push({ key: `use:${v}`, label: loose(tUse)(v), remove: () => apply({ use: without(filters.use, v) }) }));
  filters.color.forEach((v) => chips.push({ key: `color:${v}`, label: loose(tFam)(v), remove: () => apply({ color: without(filters.color, v) }) }));
  if (filters.season) chips.push({ key: "season", label: loose(tSeason)(filters.season), remove: () => apply({ season: null }) });
  if (filters.gsmMin !== null || filters.gsmMax !== null) {
    chips.push({
      key: "gsm",
      label: t("gsmChip", { min: filters.gsmMin ?? GSM_MIN, max: filters.gsmMax ?? GSM_MAX }),
      remove: () => apply({ gsmMin: null, gsmMax: null }),
    });
  }
  if (!filters.inStock) chips.push({ key: "stock", label: t("showAll"), remove: () => apply({ inStock: true }) });
  if (chips.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2" aria-label={t("active")} data-testid="active-filters">
      {chips.map((c) => (
        <li key={c.key}>
          <button
            type="button"
            onClick={c.remove}
            className="flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1.5 text-sm hover:bg-border"
            aria-label={t("remove", { name: c.label })}
          >
            {c.label}
            <X className="size-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
