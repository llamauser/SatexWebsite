"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeJwtPayload } from "@/lib/auth/guard";
import type { I18nField } from "@/lib/data/format";
import { hasAuthCookie, loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { LOCAL_CART_KEY, mergeLines, parseLocalCart, roundToStep, unitPriceFor, type LocalLine, type PriceTier } from "./pricing";

/**
 * The quote cart. A signed-in client's cart IS their draft quote in the database (quotes + quote_lines, protected by row
 * level security). A guest's cart lives in localStorage and is merged into the draft quote right after sign-in.
 */
export interface CartLine {
  /** Database line id (client cart) or the color id (guest cart). */
  key: string;
  colorId: string;
  meters: number;
  unitPrice: number | null;
  sku: string;
  slug: string;
  fabricName: I18nField;
  colorName: I18nField;
  hex: string;
  moqM: number;
  tiers: PriceTier[];
  availableM: number | null;
}
export type CartMode = "guest" | "client";
export interface CartState {
  mode: CartMode;
  quoteId: string | null;
  lines: CartLine[];
  currency: string;
  vatRate: number;
  /** Totals computed by the database for a client cart; null for a guest cart (the UI estimates). */
  serverTotals: { subtotal: number; total: number } | null;
}

export const CART_CHANGED = "satex:cart-changed";
export const CART_OPEN = "satex:cart-open";
export const notifyCartChanged = () => window.dispatchEvent(new Event(CART_CHANGED));
export const openCart = () => window.dispatchEvent(new Event(CART_OPEN));

// ------------------------------------------------------------------ guest storage
export function readGuestLines(): LocalLine[] {
  try {
    return parseLocalCart(localStorage.getItem(LOCAL_CART_KEY));
  } catch {
    return [];
  }
}
function writeGuestLines(lines: LocalLine[]) {
  try {
    if (lines.length === 0) localStorage.removeItem(LOCAL_CART_KEY);
    else localStorage.setItem(LOCAL_CART_KEY, JSON.stringify(lines));
  } catch {
    /* storage unavailable (private mode): the cart just cannot be kept */
  }
}
export const guestCount = () => readGuestLines().length;

// ------------------------------------------------------------------ who is using the cart
export async function cartMode(sb: SupabaseClient | null): Promise<CartMode> {
  if (!sb || !hasAuthCookie()) return "guest";
  const { data } = await sb.auth.getSession();
  const role = data.session ? decodeJwtPayload(data.session.access_token)?.user_role : null;
  return role === "client" ? "client" : "guest"; // staff cannot own a draft quote: they browse as guests
}

// ------------------------------------------------------------------ colors -> display data
type ColorInfo = Omit<CartLine, "key" | "meters" | "unitPrice">;

export async function describeColors(sb: SupabaseClient, ids: string[]): Promise<Map<string, ColorInfo>> {
  const out = new Map<string, ColorInfo>();
  if (ids.length === 0) return out;
  const [{ data: colors }, { data: availability }] = await Promise.all([
    sb.from("fabric_colors").select("id, name, hex, fabrics(slug, sku, name, moq_m, fabric_price_tiers(min_m, price_per_m))").in("id", ids),
    sb.from("v_color_availability").select("color_id, available_m").in("color_id", ids),
  ]);
  const stock = new Map(((availability ?? []) as { color_id: string; available_m: string | number }[]).map((a) => [a.color_id, Number(a.available_m)]));
  type Row = { id: string; name: I18nField; hex: string; fabrics: { slug: string; sku: string; name: I18nField; moq_m: string | number; fabric_price_tiers: { min_m: string | number; price_per_m: string | number }[] } };
  for (const c of (colors ?? []) as unknown as Row[]) {
    out.set(c.id, {
      colorId: c.id, sku: c.fabrics.sku, slug: c.fabrics.slug, fabricName: c.fabrics.name, colorName: c.name, hex: c.hex, moqM: Number(c.fabrics.moq_m),
      tiers: c.fabrics.fabric_price_tiers.map((t) => ({ minM: Number(t.min_m), pricePerM: Number(t.price_per_m) })).sort((a, b) => a.minM - b.minM),
      availableM: stock.get(c.id) ?? null,
    });
  }
  return out;
}

async function settings(sb: SupabaseClient): Promise<{ currency: string; vatRate: number }> {
  const { data } = await sb.from("public_settings").select("key, value").in("key", ["currency", "vat_rate"]);
  const map = new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  return { currency: typeof map.get("currency") === "string" ? (map.get("currency") as string) : "EUR", vatRate: typeof map.get("vat_rate") === "number" ? (map.get("vat_rate") as number) : 0.2 };
}

// ------------------------------------------------------------------ the draft quote of a client
async function draftQuoteId(sb: SupabaseClient, create: boolean): Promise<string | null> {
  const { data } = await sb.from("quotes").select("id").eq("status", "draft").maybeSingle();
  if (data) return data.id as string;
  if (!create) return null;
  const { data: auth } = await sb.auth.getUser();
  const { data: profile } = await sb.from("profiles").select("client_id").eq("id", auth.user?.id ?? "").single();
  if (!profile?.client_id) throw new Error("no client profile");
  const { data: created, error } = await sb.from("quotes").insert({ client_id: profile.client_id, created_by: auth.user?.id, source: "cart" }).select("id").single();
  if (error) throw new Error(error.message);
  return created.id as string;
}

// ------------------------------------------------------------------ reading the cart
export async function loadCart(): Promise<CartState> {
  const sb = await loadBrowserSupabase();
  const empty: CartState = { mode: "guest", quoteId: null, lines: [], currency: "EUR", vatRate: 0.2, serverTotals: null };
  if (!sb) return empty;
  const mode = await cartMode(sb);
  const conf = await settings(sb);

  if (mode === "guest") {
    const local = readGuestLines();
    const info = await describeColors(sb, local.map((l) => l.colorId));
    const lines = local.flatMap((l) => {
      const c = info.get(l.colorId);
      return c ? [{ ...c, key: l.colorId, meters: l.meters, unitPrice: unitPriceFor(c.tiers, l.meters) }] : [];
    });
    return { mode, quoteId: null, lines, ...conf, serverTotals: null };
  }

  const { data: quote } = await sb.from("quotes").select("id, subtotal, total, currency, vat_rate, quote_lines(id, color_id, meters, unit_price, sort)").eq("status", "draft").maybeSingle();
  if (!quote) return { ...empty, mode, ...conf };
  const rows = ((quote.quote_lines ?? []) as { id: string; color_id: string; meters: string | number; unit_price: string | number; sort: number }[]).sort((a, b) => a.sort - b.sort);
  const info = await describeColors(sb, rows.map((r) => r.color_id));
  const lines = rows.flatMap((r) => {
    const c = info.get(r.color_id);
    return c ? [{ ...c, key: r.id, meters: Number(r.meters), unitPrice: Number(r.unit_price) }] : [];
  });
  return {
    mode, quoteId: quote.id, lines, currency: quote.currency ?? conf.currency, vatRate: Number(quote.vat_rate ?? conf.vatRate),
    serverTotals: { subtotal: Number(quote.subtotal), total: Number(quote.total) },
  };
}

/** Number of lines shown on the cart button. Cheap for guests (no network). */
export async function cartCount(): Promise<number> {
  if (!hasAuthCookie()) return guestCount();
  const sb = await loadBrowserSupabase();
  if (!sb || (await cartMode(sb)) === "guest") return guestCount();
  const { data } = await sb.from("quotes").select("quote_lines(id)").eq("status", "draft").maybeSingle();
  return ((data?.quote_lines ?? []) as unknown[]).length;
}

// ------------------------------------------------------------------ changing the cart
/** Add meters of a color (summing with an existing line). Returns the quantity now in the cart. */
export async function addToCart(colorId: string, meters: number): Promise<number> {
  const sb = await loadBrowserSupabase();
  const qty = roundToStep(meters);
  if (!sb || (await cartMode(sb)) === "guest") {
    const merged = mergeLines(readGuestLines(), [{ colorId, meters: qty }]);
    writeGuestLines(merged);
    notifyCartChanged();
    return merged.find((l) => l.colorId === colorId)?.meters ?? qty;
  }
  const quoteId = (await draftQuoteId(sb, true))!;
  const info = (await describeColors(sb, [colorId])).get(colorId);
  if (!info) throw new Error("unknown color");
  const { data: existing } = await sb.from("quote_lines").select("id, meters").eq("quote_id", quoteId).eq("color_id", colorId).maybeSingle();
  const total = Number(existing?.meters ?? 0) + qty;
  const unit = unitPriceFor(info.tiers, total) ?? unitPriceFor(info.tiers, info.moqM) ?? 0;
  if (existing) {
    const { error } = await sb.from("quote_lines").update({ meters: total, unit_price: unit }).eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { count } = await sb.from("quote_lines").select("id", { count: "exact", head: true }).eq("quote_id", quoteId);
    const { error } = await sb.from("quote_lines").insert({ quote_id: quoteId, color_id: colorId, meters: total, unit_price: unit, sort: count ?? 0 });
    if (error) throw new Error(error.message);
  }
  notifyCartChanged();
  return total;
}

export async function setLineMeters(state: CartState, line: CartLine, meters: number): Promise<void> {
  const qty = roundToStep(meters);
  if (state.mode === "guest") {
    writeGuestLines(readGuestLines().map((l) => (l.colorId === line.colorId ? { ...l, meters: qty } : l)));
  } else {
    const sb = (await loadBrowserSupabase())!;
    const unit = unitPriceFor(line.tiers, qty) ?? line.unitPrice ?? 0;
    const { error } = await sb.from("quote_lines").update({ meters: qty, unit_price: unit }).eq("id", line.key);
    if (error) throw new Error(error.message);
  }
  notifyCartChanged();
}

export async function removeLine(state: CartState, line: CartLine): Promise<void> {
  if (state.mode === "guest") {
    writeGuestLines(readGuestLines().filter((l) => l.colorId !== line.colorId));
  } else {
    const sb = (await loadBrowserSupabase())!;
    const { error } = await sb.from("quote_lines").delete().eq("id", line.key);
    if (error) throw new Error(error.message);
  }
  notifyCartChanged();
}

/** Right after sign-in: move the guest cart into the client's draft quote (summing the same colors). */
export async function mergeGuestCartIntoAccount(): Promise<number> {
  const local = readGuestLines();
  if (local.length === 0) return 0;
  const sb = await loadBrowserSupabase();
  if (!sb || (await cartMode(sb)) !== "client") return 0;
  for (const line of local) await addToCart(line.colorId, line.meters);
  writeGuestLines([]);
  notifyCartChanged();
  return local.length;
}

/** Submit the draft quote. The database function checks the owner, the status and that there is at least one line. */
export async function submitCart(quoteId: string, message: string): Promise<void> {
  const sb = await loadBrowserSupabase();
  if (!sb) throw new Error("unavailable");
  const { error } = await sb.rpc("submit_quote", { p_id: quoteId, p_message: message.trim() || null });
  if (error) throw new Error(error.message);
  notifyCartChanged();
}
