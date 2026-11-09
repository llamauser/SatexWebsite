import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/db/env";
import { parseCatalogParams, toRpcArgs, PER_PAGE, type CatalogFilters } from "@/lib/catalog/params";
import type { I18nField } from "./format";
import { estimateFeel, type FeelProfile, type FeelScores } from "@/lib/cloth/feel";

/** Catalog data for public pages: anonymous key, row level security applies, results cached 5 minutes by Next. */
const REVALIDATE_SECONDS = 300;

let client: SupabaseClient | null | undefined;
function anon(): SupabaseClient | null {
  if (client !== undefined) return client;
  const env = supabaseEnv();
  client = env
    ? createClient(env.url, env.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (input, init) => fetch(input, { ...init, next: { revalidate: REVALIDATE_SECONDS, tags: ["catalog"] } }) },
      })
    : null;
  return client;
}

export interface CatalogColor { code: string; hex: string; name: I18nField }
export interface CatalogItem {
  id: string; slug: string; sku: string; name: I18nField; structure: string; construction: string; gsm: number; widthCm: number;
  composition: { fiber: string; pct: number }[]; stretch: string; isFeatured: boolean; fromPrice: number | null;
  inStock: boolean; availableM: number; colorCount: number; colors: CatalogColor[]; imagePath: string | null;
}
export interface CatalogResult { items: CatalogItem[]; total: number; ok: boolean }

type Row = {
  id: string; slug: string; sku: string; name: I18nField; structure: string; construction: string; gsm: number; width_cm: number;
  composition: { fiber: string; pct: number }[]; stretch: string; is_featured: boolean; from_price: string | number | null;
  in_stock: boolean; available_m: string | number; color_count: number; colors: CatalogColor[]; image_path: string | null; total_count: string | number;
};

const toItem = (r: Row): CatalogItem => ({
  id: r.id, slug: r.slug, sku: r.sku, name: r.name, structure: r.structure, construction: r.construction, gsm: r.gsm, widthCm: r.width_cm,
  composition: r.composition, stretch: r.stretch, isFeatured: r.is_featured, fromPrice: r.from_price === null ? null : Number(r.from_price),
  inStock: r.in_stock, availableM: Number(r.available_m), colorCount: r.color_count, colors: r.colors, imagePath: r.image_path,
});

export async function searchCatalog(filters: CatalogFilters, perPage = PER_PAGE): Promise<CatalogResult> {
  const sb = anon();
  if (!sb) return { items: [], total: 0, ok: false };
  try {
    const { data, error } = await sb.rpc("catalog_search", toRpcArgs(filters, perPage));
    if (error || !data) return { items: [], total: 0, ok: false };
    const rows = data as Row[];
    return { items: rows.map(toItem), total: rows.length ? Number(rows[0]!.total_count) : 0, ok: true };
  } catch {
    return { items: [], total: 0, ok: false };
  }
}

export async function getCatalogCategories(): Promise<{ slug: string; name: I18nField }[]> {
  const sb = anon();
  if (!sb) return [];
  try {
    const { data } = await sb.from("categories").select("slug, name").order("sort");
    return (data ?? []) as { slug: string; name: I18nField }[];
  } catch {
    return [];
  }
}

/** Fabrics similar to `fabric`: same category first, then closest weight, same structure preferred. */
export async function getSimilarFabrics(fabric: { id: string; categorySlug: string; gsm: number; structure: string }, limit = 4): Promise<CatalogItem[]> {
  const result = await searchCatalog({ ...parseCatalogParams({}), category: [fabric.categorySlug], inStock: true, sort: "relevance" }, 40);
  return result.items
    .filter((i) => i.id !== fabric.id)
    .sort((a, b) => {
      const score = (i: CatalogItem) => Math.abs(i.gsm - fabric.gsm) - (i.structure === fabric.structure ? 60 : 0);
      return score(a) - score(b);
    })
    .slice(0, limit);
}

// ------------------------------------------------------------------ fabric detail
export interface FabricColorDetail {
  id: string; code: string; name: I18nField; hex: string; sort: number; photoPath: string | null; swatchPath: string | null;
}
export interface FabricDetail {
  id: string; slug: string; sku: string; name: I18nField; shortDescription: I18nField; description: I18nField;
  category: { slug: string; name: I18nField };
  construction: string; structure: string; composition: { fiber: string; pct: number }[]; gsm: number; widthCm: number;
  stretch: string; stretchPct: number | null; finish: string[]; uses: string[]; seasons: string[]; tags: string[]; moqM: number;
  eco: { organic?: boolean; recycled_pct?: number; certifications?: string[] };
  feel: FeelProfile;
  colors: FabricColorDetail[]; tiers: { minM: number; pricePerM: number }[];
  availability: Record<string, number>; // color id -> available meters (initial server value, refreshed live in the browser)
}

export async function getFabricDetail(slug: string): Promise<FabricDetail | null> {
  const sb = anon();
  if (!sb || !/^[a-z0-9-]{1,120}$/.test(slug)) return null;
  try {
    const { data, error } = await sb
      .from("fabrics")
      .select(
        "id, slug, sku, name, short_description, description, construction, structure, composition, gsm, width_cm, stretch, stretch_pct, finish, uses, seasons, tags, moq_m, eco, " +
          "categories(slug, name), fabric_colors(id, code, name, hex, sort, is_active), fabric_images(color_id, storage_path, kind, sort), fabric_price_tiers(min_m, price_per_m), fabric_feel(softness, drape, stretch, sheen, breathability, measured, is_measured)",
      )
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    if (error) {
      console.error("[catalog detail] Supabase query failed", { slug, code: error.code, message: error.message });
      return null;
    }
    if (!data) return null;
    type D = {
      id: string; slug: string; sku: string; name: I18nField; short_description: I18nField; description: I18nField;
      construction: string; structure: string; composition: { fiber: string; pct: number }[]; gsm: number; width_cm: number;
      stretch: string; stretch_pct: number | null; finish: string[]; uses: string[]; seasons: string[]; tags: string[]; moq_m: string | number;
      eco: FabricDetail["eco"]; categories: { slug: string; name: I18nField };
      fabric_colors: { id: string; code: string; name: I18nField; hex: string; sort: number; is_active: boolean }[];
      fabric_images: { color_id: string | null; storage_path: string; kind: string; sort: number }[];
      fabric_price_tiers: { min_m: string | number; price_per_m: string | number }[];
      fabric_feel: { softness: number | null; drape: number | null; stretch: number | null; sheen: number | null; breathability: number | null; measured: Record<string, unknown>; is_measured: boolean }[] | { softness: number | null; drape: number | null; stretch: number | null; sheen: number | null; breathability: number | null; measured: Record<string, unknown>; is_measured: boolean } | null;
    };
    const d = data as unknown as D;
    const feelRow = Array.isArray(d.fabric_feel) ? d.fabric_feel[0] ?? null : d.fabric_feel;
    const feel = estimateFeel({
      composition: d.composition, gsm: d.gsm, structure: d.structure, construction: d.construction, stretch: d.stretch,
      stretchPct: d.stretch_pct, finish: d.finish, measured: (feelRow?.measured ?? null) as { drape_coefficient?: number; stretch_pct_warp?: number; stretch_pct_weft?: number } | null,
      existing: feelRow ? Object.fromEntries(Object.entries(feelRow).filter(([key, value]) => ["softness", "drape", "stretch", "sheen", "breathability"].includes(key) && typeof value === "number")) as Partial<FeelScores> : null,
      isMeasured: feelRow?.is_measured ?? false,
    });
    const { data: avail } = await sb.from("v_color_availability").select("color_id, available_m").eq("fabric_id", d.id);
    const imageFor = (colorId: string, kind: string) =>
      d.fabric_images.filter((i) => i.color_id === colorId && i.kind === kind).sort((a, b) => a.sort - b.sort)[0]?.storage_path ?? null;
    return {
      id: d.id, slug: d.slug, sku: d.sku, name: d.name, shortDescription: d.short_description, description: d.description,
      category: d.categories, construction: d.construction, structure: d.structure, composition: d.composition, gsm: d.gsm, widthCm: d.width_cm,
      stretch: d.stretch, stretchPct: d.stretch_pct, finish: d.finish, uses: d.uses, seasons: d.seasons, tags: d.tags, moqM: Number(d.moq_m),
      eco: d.eco ?? {},
      feel,
      colors: d.fabric_colors
        .filter((c) => c.is_active)
        .sort((a, b) => a.sort - b.sort)
        .map((c) => ({ id: c.id, code: c.code, name: c.name, hex: c.hex, sort: c.sort, photoPath: imageFor(c.id, "photo"), swatchPath: imageFor(c.id, "flat_swatch") })),
      tiers: d.fabric_price_tiers.map((t) => ({ minM: Number(t.min_m), pricePerM: Number(t.price_per_m) })).sort((a, b) => a.minM - b.minM),
      availability: Object.fromEntries(((avail ?? []) as { color_id: string; available_m: string | number }[]).map((a) => [a.color_id, Number(a.available_m)])),
    };
  } catch (error) {
    console.error("[catalog detail] Unexpected error", { slug, error });
    return null;
  }
}

/** Active fabric details for the comparison view; the URL may request at most three UUIDs. */
export async function getFabricDetailsByIds(ids: string[]): Promise<FabricDetail[]> {
  const unique = [...new Set(ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)))].slice(0, 3);
  const sb = anon();
  if (!sb || !unique.length) return [];
  try {
    const { data, error } = await sb.from("fabrics").select("id, slug").in("id", unique).eq("is_active", true);
    if (error || !data) return [];
    const byId = new Map(data.map((item) => [item.id, item.slug]));
    const details = await Promise.all(unique.map((id) => byId.has(id) ? getFabricDetail(byId.get(id)!) : null));
    return details.filter((item): item is FabricDetail => item !== null);
  } catch {
    return [];
  }
}

export async function getAllFabricSlugs(): Promise<string[]> {
  const sb = anon();
  if (!sb) return [];
  try {
    const { data } = await sb.from("fabrics").select("slug").eq("is_active", true);
    return ((data ?? []) as { slug: string }[]).map((r) => r.slug);
  } catch {
    return [];
  }
}

/** Active fabrics with their last change, for the sitemap. */
export async function getActiveFabricSlugs(): Promise<{ slug: string; updatedAt: string }[]> {
  const sb = anon();
  if (!sb) return [];
  try {
    const { data } = await sb.from("fabrics").select("slug, updated_at").eq("is_active", true).order("slug");
    return ((data ?? []) as { slug: string; updated_at: string }[]).map((r) => ({ slug: r.slug, updatedAt: r.updated_at }));
  } catch {
    return [];
  }
}
