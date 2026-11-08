import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/db/env";
import type { I18nField } from "./format";

/**
 * Read-only data for public pages, fetched with the anonymous key (row level security applies) and cached by Next for
 * 5 minutes. Every function falls back to safe defaults when the database is unreachable or not configured, so the
 * public site still builds and renders without a backend.
 */
const REVALIDATE_SECONDS = 300;

let client: SupabaseClient | null | undefined;
function anon(): SupabaseClient | null {
  if (client !== undefined) return client;
  const env = supabaseEnv();
  client = env
    ? createClient(env.url, env.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, init) => fetch(input, { ...init, next: { revalidate: REVALIDATE_SECONDS, tags: ["public-data"] } }),
        },
      })
    : null;
  return client;
}

// ------------------------------------------------------------------ settings
export interface PublicSettings {
  companyName: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  whatsapp: string;
  foundedYear: number;
  currency: string;
  showPricesPublic: boolean;
  lowStockThresholdM: number;
}

export const DEFAULT_SETTINGS: PublicSettings = {
  companyName: "SATEX Commerce",
  contactEmail: "Satexcommerce@ymail.com",
  contactPhone: "",
  contactAddress: "",
  whatsapp: "",
  foundedYear: 1995,
  currency: "EUR",
  showPricesPublic: true,
  lowStockThresholdM: 50,
};

export async function getPublicSettings(): Promise<PublicSettings> {
  const sb = anon();
  if (!sb) return DEFAULT_SETTINGS;
  try {
    const { data, error } = await sb.from("public_settings").select("key, value");
    if (error || !data) return DEFAULT_SETTINGS;
    const map = new Map<string, unknown>(data.map((r: { key: string; value: unknown }) => [r.key, r.value]));
    const str = (k: string, d: string) => (typeof map.get(k) === "string" ? (map.get(k) as string) : d);
    const num = (k: string, d: number) => (typeof map.get(k) === "number" ? (map.get(k) as number) : d);
    const bool = (k: string, d: boolean) => (typeof map.get(k) === "boolean" ? (map.get(k) as boolean) : d);
    return {
      companyName: str("company_name", DEFAULT_SETTINGS.companyName),
      contactEmail: str("contact_email", DEFAULT_SETTINGS.contactEmail),
      contactPhone: str("contact_phone", ""),
      contactAddress: str("contact_address", ""),
      whatsapp: str("whatsapp", ""),
      foundedYear: num("founded_year", DEFAULT_SETTINGS.foundedYear),
      currency: str("currency", DEFAULT_SETTINGS.currency),
      showPricesPublic: bool("show_prices_public", true),
      lowStockThresholdM: num("low_stock_threshold_m", DEFAULT_SETTINGS.lowStockThresholdM),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// ------------------------------------------------------------------ catalog teasers
export interface CategoryCard {
  slug: string;
  name: I18nField;
  description: I18nField;
  icon: string | null;
}

export async function getCategories(): Promise<CategoryCard[]> {
  const sb = anon();
  if (!sb) return [];
  try {
    const { data } = await sb.from("categories").select("slug, name, description, icon").order("sort");
    return (data ?? []) as CategoryCard[];
  } catch {
    return [];
  }
}

export interface FeaturedFabric {
  slug: string;
  name: I18nField;
  structure: string;
  gsm: number;
  widthCm: number;
  composition: { fiber: string; pct: number }[];
  fromPrice: number | null;
  imagePath: string | null;
}

export async function getFeaturedFabrics(limit = 6): Promise<FeaturedFabric[]> {
  const sb = anon();
  if (!sb) return [];
  try {
    const { data } = await sb
      .from("fabrics")
      .select("slug, name, structure, gsm, width_cm, composition, fabric_price_tiers(price_per_m), fabric_images(storage_path, kind, sort)")
      .eq("is_active", true)
      .eq("is_featured", true)
      .order("sku")
      .limit(limit);
    type Row = {
      slug: string; name: I18nField; structure: string; gsm: number; width_cm: number;
      composition: { fiber: string; pct: number }[];
      fabric_price_tiers: { price_per_m: number }[]; fabric_images: { storage_path: string; kind: string; sort: number }[];
    };
    return ((data ?? []) as Row[]).map((r) => {
      const photos = r.fabric_images.filter((i) => i.kind === "photo").sort((a, b) => a.sort - b.sort);
      const prices = r.fabric_price_tiers.map((t) => Number(t.price_per_m));
      return {
        slug: r.slug, name: r.name, structure: r.structure, gsm: r.gsm, widthCm: r.width_cm, composition: r.composition,
        fromPrice: prices.length ? Math.min(...prices) : null, // tiers are hidden by RLS when prices are not public
        imagePath: photos[0]?.storage_path ?? null,
      };
    });
  } catch {
    return [];
  }
}

/** Public URL of a storage object stored as "bucket/path". */
export function storageUrl(path: string): string | null {
  const env = supabaseEnv();
  return env ? `${env.url}/storage/v1/object/public/${path}` : null;
}
