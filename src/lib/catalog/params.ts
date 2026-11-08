/**
 * Catalog filters <-> URL query string (docs/05-commerce.md §1). Everything shareable lives in the URL.
 * Lists are comma separated (?category=denim,knits). Unknown values are dropped, defaults are omitted when serializing.
 */
export const PER_PAGE = 24;

export const CONSTRUCTIONS = ["knit", "woven", "nonwoven"] as const;
export const STRUCTURES = [
  "jersey", "pique", "rib", "interlock", "fleece", "french_terry", "mesh", "plain", "twill", "satin", "denim", "canvas",
  "poplin", "oxford", "gabardine", "crepe", "chiffon", "velvet", "jacquard", "tulle", "felt", "other",
] as const;
export const FIBERS = ["cotton", "polyester", "viscose", "linen", "wool", "silk", "elastane", "nylon", "modal", "acrylic"] as const;
export const STRETCHES = ["none", "mechanical", "two_way", "four_way"] as const;
export const USES = [
  "activewear", "sportswear", "t_shirts", "polos", "shirts", "dresses", "skirts", "trousers", "jeans", "jackets", "coats",
  "suits", "eveningwear", "lingerie", "swimwear", "kidswear", "workwear", "uniforms", "upholstery", "curtains", "bedding",
  "accessories", "linings",
] as const;
export const SEASONS = ["spring_summer", "autumn_winter", "all_season"] as const;
export const COLOR_FAMILIES = ["white", "black", "grey", "beige", "brown", "red", "orange", "yellow", "green", "blue", "purple", "pink"] as const;
export const SORTS = ["relevance", "newest", "price_asc", "price_desc", "gsm_asc", "gsm_desc"] as const;

export const GSM_MIN = 20;
export const GSM_MAX = 600;

export type Sort = (typeof SORTS)[number];
export type Season = (typeof SEASONS)[number];

export interface CatalogFilters {
  q: string;
  category: string[];
  construction: string[];
  structure: string[];
  fiber: string[];
  gsmMin: number | null;
  gsmMax: number | null;
  stretch: string[];
  use: string[];
  season: Season | null;
  color: string[];
  inStock: boolean;
  sort: Sort;
  page: number;
}

export const DEFAULT_FILTERS: CatalogFilters = {
  q: "", category: [], construction: [], structure: [], fiber: [], gsmMin: null, gsmMax: null, stretch: [], use: [],
  season: null, color: [], inStock: true, sort: "relevance", page: 1,
};

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function get(raw: RawParams, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const v = raw[key];
  return Array.isArray(v) ? v[0] : v;
}

function list(raw: RawParams, key: string, allowed?: readonly string[]): string[] {
  const value = get(raw, key);
  if (!value) return [];
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => (allowed ? allowed.includes(s) : /^[a-z0-9_-]{1,60}$/.test(s)));
  return [...new Set(items)];
}

function int(raw: RawParams, key: string, min: number, max: number): number | null {
  const v = get(raw, key);
  if (v === undefined || !/^\d{1,5}$/.test(v)) return null;
  const n = Number(v);
  return n < min ? min : n > max ? max : n;
}

export function parseCatalogParams(raw: RawParams): CatalogFilters {
  let gsmMin = int(raw, "gsm_min", GSM_MIN, GSM_MAX);
  let gsmMax = int(raw, "gsm_max", GSM_MIN, GSM_MAX);
  if (gsmMin !== null && gsmMax !== null && gsmMin > gsmMax) [gsmMin, gsmMax] = [gsmMax, gsmMin];
  const season = get(raw, "season");
  const sort = get(raw, "sort");
  const page = int(raw, "page", 1, 1000) ?? 1;
  return {
    q: (get(raw, "q") ?? "").trim().slice(0, 80),
    category: list(raw, "category"),
    construction: list(raw, "construction", CONSTRUCTIONS),
    structure: list(raw, "structure", STRUCTURES),
    fiber: list(raw, "fiber", FIBERS),
    gsmMin,
    gsmMax,
    stretch: list(raw, "stretch", STRETCHES),
    use: list(raw, "use", USES),
    season: (SEASONS as readonly string[]).includes(season ?? "") ? (season as Season) : null,
    color: list(raw, "color", COLOR_FAMILIES),
    inStock: get(raw, "in_stock") !== "0",
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as Sort) : "relevance",
    page,
  };
}

/** Query string for a set of filters; defaults are left out so URLs stay short and canonical. */
export function serializeCatalogParams(f: CatalogFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  const setList = (key: string, v: string[]) => v.length && p.set(key, v.join(","));
  setList("category", f.category);
  setList("construction", f.construction);
  setList("structure", f.structure);
  setList("fiber", f.fiber);
  if (f.gsmMin !== null) p.set("gsm_min", String(f.gsmMin));
  if (f.gsmMax !== null) p.set("gsm_max", String(f.gsmMax));
  setList("stretch", f.stretch);
  setList("use", f.use);
  if (f.season) p.set("season", f.season);
  setList("color", f.color);
  if (!f.inStock) p.set("in_stock", "0");
  if (f.sort !== "relevance") p.set("sort", f.sort);
  if (f.page > 1) p.set("page", String(f.page));
  return p;
}

/** Arguments of the SQL function catalog_search(). */
export function toRpcArgs(f: CatalogFilters, perPage = PER_PAGE) {
  const arr = (v: string[]) => (v.length ? v : null);
  return {
    p_q: f.q || null,
    p_categories: arr(f.category),
    p_constructions: arr(f.construction),
    p_structures: arr(f.structure),
    p_fibers: arr(f.fiber),
    p_gsm_min: f.gsmMin,
    p_gsm_max: f.gsmMax,
    p_stretch: arr(f.stretch),
    p_uses: arr(f.use),
    p_season: f.season,
    p_colors: arr(f.color),
    p_in_stock: f.inStock,
    p_sort: f.sort,
    p_limit: perPage,
    p_offset: (f.page - 1) * perPage,
  };
}

/** Number of active filters (the search box, sort and page do not count). */
export function activeFilterCount(f: CatalogFilters): number {
  return (
    f.category.length + f.construction.length + f.structure.length + f.fiber.length + f.stretch.length + f.use.length +
    f.color.length + (f.season ? 1 : 0) + (f.gsmMin !== null || f.gsmMax !== null ? 1 : 0) + (f.inStock ? 0 : 1)
  );
}

export function pageCount(total: number, perPage = PER_PAGE): number {
  return Math.max(1, Math.ceil(total / perPage));
}

/** "92% CO · 8% EA" */
const FIBER_CODES: Record<string, string> = {
  cotton: "CO", polyester: "PES", elastane: "EA", viscose: "CV", linen: "LI", wool: "WO", silk: "SE", modal: "MD", nylon: "PA", acrylic: "PAN",
};
export function compositionShort(composition: { fiber: string; pct: number }[]): string {
  return composition.map((c) => `${c.pct}% ${FIBER_CODES[c.fiber] ?? c.fiber.toUpperCase()}`).join(" · ");
}

export type StockLevel = "in" | "low" | "out";
/** Stock badge: out of stock below the MOQ, "low" under the shop's threshold. */
export function stockLevel(availableM: number, moqM: number, lowThresholdM: number): StockLevel {
  if (availableM < moqM) return "out";
  return availableM < lowThresholdM ? "low" : "in";
}
