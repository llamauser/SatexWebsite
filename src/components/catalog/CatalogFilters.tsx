"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import {
  activeFilterCount, COLOR_FAMILIES, CONSTRUCTIONS, FIBERS, GSM_MAX, GSM_MIN, SEASONS, serializeCatalogParams, STRETCHES, STRUCTURES, USES,
  type CatalogFilters as Filters,
} from "@/lib/catalog/params";
import { loose } from "@/lib/i18n-loose";
import { cn } from "@/lib/utils";

const FAMILY_HEX: Record<string, string> = {
  white: "#F7F7F5", black: "#1A1A1A", grey: "#8C9096", beige: "#D8C3A5", brown: "#6B4226", red: "#C0392B",
  orange: "#E8812B", yellow: "#D4A017", green: "#1F7A4D", blue: "#2C5AA0", purple: "#6A3D9A", pink: "#E8B4B8",
};

/** Updates the URL (the single source of truth for the catalog); the server page re-renders with the new filters. */
export function useCatalogNavigation(filters: Filters) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const apply = (patch: Partial<Filters>) => {
    const next = { ...filters, page: 1, ...patch };
    startTransition(() => {
      router.replace({ pathname: "/catalog", query: Object.fromEntries(serializeCatalogParams(next)) }, { scroll: false });
    });
  };
  return { apply, pending };
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Group({ title, children, defaultOpen = false, count = 0 }: { title: string; children: React.ReactNode; defaultOpen?: boolean; count?: number }) {
  return (
    <details open={defaultOpen || count > 0} className="group border-b border-border py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
        <span>
          {title}
          {count > 0 && <span className="ms-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary-strong">{count}</span>}
        </span>
        <span className="text-text-muted transition group-open:rotate-45" aria-hidden>
          +
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function Checks({ options, selected, onToggle, name }: { options: { value: string; label: string }[]; selected: string[]; onToggle: (v: string) => void; name: string }) {
  return (
    <ul className="space-y-1.5">
      {options.map((o) => (
        <li key={o.value}>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={name}
              value={o.value}
              checked={selected.includes(o.value)}
              onChange={() => onToggle(o.value)}
              className="size-4 accent-[var(--primary)]"
            />
            {o.label}
          </label>
        </li>
      ))}
    </ul>
  );
}

export function CatalogFilters({ filters, categories }: { filters: Filters; categories: { slug: string; label: string }[] }) {
  const t = useTranslations("catalog.filters");
  const { apply, pending } = useCatalogNavigation(filters);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(filters.q);
  const [gsmMin, setGsmMin] = useState(filters.gsmMin?.toString() ?? "");
  const [gsmMax, setGsmMax] = useState(filters.gsmMax?.toString() ?? "");
  const count = activeFilterCount(filters);

  // keep the inputs in sync when the URL changes (reset, chip removal, back button)
  useEffect(() => setQ(filters.q), [filters.q]);
  useEffect(() => setGsmMin(filters.gsmMin?.toString() ?? ""), [filters.gsmMin]);
  useEffect(() => setGsmMax(filters.gsmMax?.toString() ?? ""), [filters.gsmMax]);

  // search as you type, after a short pause
  useEffect(() => {
    if (q.trim() === filters.q) return;
    const id = setTimeout(() => apply({ q: q.trim() }), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const commitGsm = () => {
    const toNum = (v: string) => (/^\d{1,3}$/.test(v) ? Math.min(GSM_MAX, Math.max(GSM_MIN, Number(v))) : null);
    const a = toNum(gsmMin);
    const b = toNum(gsmMax);
    if (a === filters.gsmMin && b === filters.gsmMax) return;
    apply({ gsmMin: a, gsmMax: b });
  };

  const tStruct = useTranslations("structures");
  const tFiber = useTranslations("fibers");
  const tCons = useTranslations("constructions");
  const tStretch = useTranslations("stretches");
  const tUse = useTranslations("uses");
  const tSeason = useTranslations("seasons");
  const tFam = useTranslations("families");
  const mk = (tt: unknown, values: readonly string[]) => values.map((v) => ({ value: v, label: loose(tt)(v) }));

  return (
    <aside aria-label={t("title")} className="lg:sticky lg:top-4 lg:self-start" aria-busy={pending}>
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="catalog-search">
          {t("search")}
        </label>
        <input
          id="catalog-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-11 w-full rounded-full border border-border bg-surface px-4 text-base focus:border-primary"
        />
        <Button
          type="button"
          variant="secondary"
          className="shrink-0 lg:hidden"
          aria-expanded={open}
          aria-controls="catalog-filter-panel"
          onClick={() => setOpen((v) => !v)}
          data-testid="filters-toggle"
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          {t("title")}
          {count > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-white">{count}</span>}
        </Button>
      </div>

      <div id="catalog-filter-panel" className={cn("mt-4 rounded-md border border-border bg-surface p-4", open ? "block" : "hidden lg:block")}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">{t("title")}</h2>
          {count > 0 && (
            <button
              type="button"
              className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              onClick={() => apply({ ...resetFilters(), q: filters.q, sort: filters.sort })}
              data-testid="filters-reset"
            >
              <X className="size-3.5" aria-hidden />
              {t("reset")}
            </button>
          )}
        </div>

        <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 border-b border-border pb-3 text-sm font-semibold">
          {t("inStock")}
          <input
            type="checkbox"
            checked={filters.inStock}
            onChange={(e) => apply({ inStock: e.target.checked })}
            className="size-5 accent-[var(--primary)]"
            data-testid="filter-in-stock"
          />
        </label>

        {categories.length > 0 && (
          <Group title={t("category")} defaultOpen count={filters.category.length}>
            <Checks name="category" options={categories.map((c) => ({ value: c.slug, label: c.label }))} selected={filters.category} onToggle={(v) => apply({ category: toggle(filters.category, v) })} />
          </Group>
        )}
        <Group title={t("construction")} count={filters.construction.length}>
          <Checks name="construction" options={mk(tCons, CONSTRUCTIONS)} selected={filters.construction} onToggle={(v) => apply({ construction: toggle(filters.construction, v) })} />
        </Group>
        <Group title={t("structure")} count={filters.structure.length}>
          <Checks name="structure" options={mk(tStruct, STRUCTURES.filter((s) => s !== "other"))} selected={filters.structure} onToggle={(v) => apply({ structure: toggle(filters.structure, v) })} />
        </Group>
        <Group title={t("fiber")} count={filters.fiber.length}>
          <Checks name="fiber" options={mk(tFiber, FIBERS)} selected={filters.fiber} onToggle={(v) => apply({ fiber: toggle(filters.fiber, v) })} />
        </Group>
        <Group title={t("gsm")} count={filters.gsmMin !== null || filters.gsmMax !== null ? 1 : 0}>
          <div className="flex items-center gap-2 text-sm">
            <input
              type="number" inputMode="numeric" min={GSM_MIN} max={GSM_MAX} placeholder={String(GSM_MIN)} aria-label={t("gsmMin")} value={gsmMin}
              onChange={(e) => setGsmMin(e.target.value)} onBlur={commitGsm} onKeyDown={(e) => e.key === "Enter" && commitGsm()}
              className="h-10 w-full rounded-sm border border-border bg-surface px-2"
            />
            <span aria-hidden>–</span>
            <input
              type="number" inputMode="numeric" min={GSM_MIN} max={GSM_MAX} placeholder={String(GSM_MAX)} aria-label={t("gsmMax")} value={gsmMax}
              onChange={(e) => setGsmMax(e.target.value)} onBlur={commitGsm} onKeyDown={(e) => e.key === "Enter" && commitGsm()}
              className="h-10 w-full rounded-sm border border-border bg-surface px-2"
            />
          </div>
        </Group>
        <Group title={t("stretch")} count={filters.stretch.length}>
          <Checks name="stretch" options={mk(tStretch, STRETCHES)} selected={filters.stretch} onToggle={(v) => apply({ stretch: toggle(filters.stretch, v) })} />
        </Group>
        <Group title={t("use")} count={filters.use.length}>
          <Checks name="use" options={mk(tUse, USES)} selected={filters.use} onToggle={(v) => apply({ use: toggle(filters.use, v) })} />
        </Group>
        <Group title={t("season")} count={filters.season ? 1 : 0}>
          <ul className="space-y-1.5">
            {SEASONS.map((s) => (
              <li key={s}>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name="season" checked={filters.season === s} onChange={() => apply({ season: s })} className="size-4 accent-[var(--primary)]" />
                  {tSeason(s)}
                </label>
              </li>
            ))}
            {filters.season && (
              <li>
                <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => apply({ season: null })}>
                  {t("clearSeason")}
                </button>
              </li>
            )}
          </ul>
        </Group>
        <Group title={t("color")} count={filters.color.length}>
          <ul className="flex flex-wrap gap-2">
            {COLOR_FAMILIES.map((c) => {
              const on = filters.color.includes(c);
              return (
                <li key={c}>
                  <button
                    type="button"
                    aria-pressed={on}
                    title={tFam(c)}
                    aria-label={tFam(c)}
                    onClick={() => apply({ color: toggle(filters.color, c) })}
                    className={cn("size-8 rounded-full border-2", on ? "border-primary ring-2 ring-primary/30" : "border-border")}
                    style={{ background: FAMILY_HEX[c] }}
                  />
                </li>
              );
            })}
          </ul>
        </Group>
      </div>
    </aside>
  );
}

function resetFilters(): Partial<Filters> {
  return {
    category: [], construction: [], structure: [], fiber: [], gsmMin: null, gsmMax: null, stretch: [], use: [], season: null, color: [], inStock: true,
  };
}
