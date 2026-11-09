"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { I18nField } from "@/lib/data/format";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { addId, DEFAULT_MAX_COLORS, isOpen, parseSelection, sampleErrorCode, SAMPLE_KEY, type SampleError, type SampleStatus, type ShippingAddress } from "./rules";

export const SAMPLES_CHANGED = "satex:samples-changed";

// ------------------------------------------------------------------ the selection (browser storage)
export function readSelection(max = DEFAULT_MAX_COLORS): string[] {
  try {
    return parseSelection(localStorage.getItem(SAMPLE_KEY), max);
  } catch {
    return [];
  }
}
function writeSelection(ids: string[]) {
  try {
    if (ids.length === 0) localStorage.removeItem(SAMPLE_KEY);
    else localStorage.setItem(SAMPLE_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable (private mode): the selection just cannot be kept */
  }
  window.dispatchEvent(new Event(SAMPLES_CHANGED));
}
/** Adds a color to the selection. Returns the new selection and whether the limit stopped it. */
export function selectColor(id: string, max = DEFAULT_MAX_COLORS): { ids: string[]; full: boolean } {
  const result = addId(readSelection(max), id, max);
  if (!result.full) writeSelection(result.ids);
  return result;
}
export function unselectColor(id: string) {
  writeSelection(readSelection(100).filter((x) => x !== id));
}
export const clearSelection = () => writeSelection([]);

// ------------------------------------------------------------------ rules and data
export interface SampleRules {
  maxColors: number;
  maxOpen: number;
}
export async function loadRules(sb: SupabaseClient): Promise<SampleRules> {
  const { data } = await sb.from("public_settings").select("key, value").in("key", ["max_colors_per_sample_request", "max_open_sample_requests_per_client"]);
  const map = new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, Number(r.value)]));
  const num = (k: string, fallback: number) => (Number.isFinite(map.get(k)) ? (map.get(k) as number) : fallback);
  return { maxColors: num("max_colors_per_sample_request", DEFAULT_MAX_COLORS), maxOpen: num("max_open_sample_requests_per_client", 2) };
}

export interface SampleItem {
  colorId: string;
  colorName: I18nField;
  hex: string;
  fabricName: I18nField;
  slug: string;
}
export interface SampleRow {
  id: string;
  ref: string;
  status: SampleStatus;
  createdAt: string;
  address: Partial<ShippingAddress>;
  rejectionReason: string | null;
  carrier: string | null;
  tracking: string | null;
  items: SampleItem[];
}

type RawColor = { id: string; name: I18nField; hex: string; fabrics: { slug: string; name: I18nField } };
const toItem = (c: RawColor): SampleItem => ({ colorId: c.id, colorName: c.name, hex: c.hex, fabricName: c.fabrics.name, slug: c.fabrics.slug });

export async function loadSamples(): Promise<{ rows: SampleRow[]; rules: SampleRules } | null> {
  const sb = await loadBrowserSupabase();
  if (!sb) return null;
  const [rules, res] = await Promise.all([
    loadRules(sb),
    sb.from("sample_requests")
      .select("id, ref, status, created_at, shipping_address, rejection_reason, carrier, tracking_number, sample_request_items(fabric_colors(id, name, hex, fabrics(slug, name)))")
      .order("created_at", { ascending: false }),
  ]);
  if (res.error) return null;
  type Raw = {
    id: string; ref: string; status: SampleStatus; created_at: string; shipping_address: Partial<ShippingAddress>;
    rejection_reason: string | null; carrier: string | null; tracking_number: string | null;
    sample_request_items: { fabric_colors: RawColor | null }[];
  };
  const rows = ((res.data ?? []) as unknown as Raw[]).map((r) => ({
    id: r.id, ref: r.ref, status: r.status, createdAt: r.created_at, address: r.shipping_address ?? {}, rejectionReason: r.rejection_reason,
    carrier: r.carrier, tracking: r.tracking_number,
    items: r.sample_request_items.flatMap((i) => (i.fabric_colors ? [toItem(i.fabric_colors)] : [])),
  }));
  return { rows, rules };
}

export const countOpen = (rows: SampleRow[]) => rows.filter((r) => isOpen(r.status)).length;

/** The colors chosen so far, with their names (for the request form). */
export async function describeSelection(ids: string[]): Promise<SampleItem[]> {
  if (ids.length === 0) return [];
  const sb = await loadBrowserSupabase();
  if (!sb) return [];
  const { data } = await sb.from("fabric_colors").select("id, name, hex, fabrics(slug, name)").in("id", ids).eq("is_active", true);
  const byId = new Map(((data ?? []) as unknown as RawColor[]).map((c) => [c.id, toItem(c)]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export class SampleFailure extends Error {
  constructor(readonly code: SampleError) {
    super(code);
  }
}

export async function requestSamples(colorIds: string[], address: ShippingAddress): Promise<{ id: string; ref: string }> {
  const sb = await loadBrowserSupabase();
  if (!sb) throw new SampleFailure("error");
  const { data, error } = await sb.rpc("request_samples", { p_color_ids: colorIds, p_address: address });
  if (error) throw new SampleFailure(sampleErrorCode(error.message));
  const row = data as { id: string; ref: string };
  clearSelection();
  return { id: row.id, ref: row.ref };
}
