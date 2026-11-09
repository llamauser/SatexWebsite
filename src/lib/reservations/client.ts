"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { I18nField } from "@/lib/data/format";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { reserveErrorCode, type ReserveError } from "./rules";

export interface ReservationRules {
  hours: number;
  max: number;
}

export interface ReservationRow {
  id: string;
  colorId: string;
  meters: number;
  status: "active" | "expired" | "cancelled" | "converted";
  expiresAt: string;
  createdAt: string;
  colorName: I18nField;
  hex: string;
  fabricName: I18nField;
  slug: string;
  moqM: number;
}

export class ReserveFailure extends Error {
  constructor(readonly code: ReserveError) {
    super(code);
  }
}

/** Reservation length and per-client limit (public settings). */
export async function loadRules(sb: SupabaseClient): Promise<ReservationRules> {
  const { data } = await sb.from("public_settings").select("key, value").in("key", ["reservation_hours", "max_active_reservations_per_client"]);
  const map = new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, Number(r.value)]));
  const num = (k: string, fallback: number) => (Number.isFinite(map.get(k)) ? (map.get(k) as number) : fallback);
  return { hours: num("reservation_hours", 48), max: num("max_active_reservations_per_client", 3) };
}

export async function countActive(sb: SupabaseClient): Promise<number> {
  const { count } = await sb.from("stock_reservations").select("id", { count: "exact", head: true }).eq("status", "active");
  return count ?? 0;
}

export async function loadReservations(): Promise<{ rows: ReservationRow[]; rules: ReservationRules } | null> {
  const sb = await loadBrowserSupabase();
  if (!sb) return null;
  const [rules, res] = await Promise.all([
    loadRules(sb),
    sb.from("stock_reservations")
      .select("id, color_id, meters, status, expires_at, created_at, fabric_colors(name, hex, fabrics(slug, name, moq_m))")
      .order("created_at", { ascending: false }),
  ]);
  if (res.error) return null;
  type Raw = { id: string; color_id: string; meters: string | number; status: ReservationRow["status"]; expires_at: string; created_at: string; fabric_colors: { name: I18nField; hex: string; fabrics: { slug: string; name: I18nField; moq_m: string | number } } | null };
  const rows = ((res.data ?? []) as unknown as Raw[]).flatMap((r) =>
    r.fabric_colors
      ? [{
          id: r.id, colorId: r.color_id, meters: Number(r.meters), status: r.status, expiresAt: r.expires_at, createdAt: r.created_at,
          colorName: r.fabric_colors.name, hex: r.fabric_colors.hex, fabricName: r.fabric_colors.fabrics.name, slug: r.fabric_colors.fabrics.slug, moqM: Number(r.fabric_colors.fabrics.moq_m),
        }]
      : [],
  );
  return { rows, rules };
}

export async function reserve(colorId: string, meters: number): Promise<{ id: string; expiresAt: string }> {
  const sb = await loadBrowserSupabase();
  if (!sb) throw new ReserveFailure("error");
  const { data, error } = await sb.rpc("reserve_stock", { p_color_id: colorId, p_meters: meters });
  if (error) throw new ReserveFailure(reserveErrorCode(error.message));
  const row = data as { id: string; expires_at: string };
  return { id: row.id, expiresAt: row.expires_at };
}

export async function cancelReservation(id: string): Promise<void> {
  const sb = await loadBrowserSupabase();
  if (!sb) throw new Error("unavailable");
  const { error } = await sb.rpc("cancel_reservation", { p_id: id });
  if (error) throw new Error(error.message);
}
