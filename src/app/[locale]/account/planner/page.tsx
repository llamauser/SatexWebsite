import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/db/server";
import { routing } from "@/i18n/routing";
import { PlannerEditor } from "@/components/planner/PlannerEditor";
import { getPublicSettings } from "@/lib/data/public";
import type { GarmentConsumption } from "@/lib/planner/garments";

export default async function PlannerPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ id?: string }> }) {
  const { locale } = await params;
  const { id } = await searchParams;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const sb = await createServerSupabase();
  const [{ data: garments }, { data: collections }, settings] = await Promise.all([
    sb.from("garment_consumption").select("garment_type, base_m_per_unit, ref_width_cm, size_factors").order("garment_type"),
    sb.from("collections").select("id, name, status, palette, updated_at, quote_id").order("updated_at", { ascending: false }),
    getPublicSettings(),
  ]);
  let initialDraft = null;
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const { data: collection } = await sb.from("collections").select("id, name, season, brief, palette, status").eq("id", id).maybeSingle();
    if (collection && collection.status !== "quoted") {
      const { data: items } = await sb.from("collection_items").select("id, garment_type, label, quantity_units, size_run, notes, chosen_color_id, alternatives, meters_needed").eq("collection_id", id).order("sort");
      initialDraft = {
        id: collection.id, name: collection.name, season: collection.season, brief: collection.brief as { audienceText?: string; styles?: string[]; budgetPerM?: number | null; description?: string },
        palette: collection.palette as { name: string; hex: string }[],
        items: (items ?? []).map((item) => ({ ...item, meters_needed: Number(item.meters_needed ?? 0), size_run: item.size_run as Record<"XS" | "S" | "M" | "L" | "XL" | "XXL", number>, alternatives: item.alternatives as never })),
      };
    }
  }
  return <PlannerEditor garments={(garments ?? []) as GarmentConsumption[]} collections={(collections ?? []).map((item) => ({ ...item, palette: item.palette as { name: string; hex: string }[] }))} initialDraft={initialDraft} currency={settings.currency} />;
}
