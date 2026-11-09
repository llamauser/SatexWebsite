import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/db/env";
import { buildDepartments, type ShowroomData } from "@/lib/showroom/model";

/** Everything the showroom draws, read with the anonymous key (public data only) and cached for 5 minutes like the other public pages. */
let client: SupabaseClient | null | undefined;
function anon(): SupabaseClient | null {
  if (client !== undefined) return client;
  const env = supabaseEnv();
  client = env
    ? createClient(env.url, env.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (input, init) => fetch(input, { ...init, next: { revalidate: 300, tags: ["public-data"] } }) },
      })
    : null;
  return client;
}

const EMPTY: ShowroomData = { departments: [], availability: {}, stats: { cuttingToday: 0, cuttingQueue: 0, shippedWeek: 0 } };

export async function getShowroomData(): Promise<ShowroomData> {
  const sb = anon();
  if (!sb) return EMPTY;
  try {
    const [deps, cats, fabrics, avail, stats] = await Promise.all([
      sb.from("departments").select("id, slug, name, floor, kind, layout, category_ids").order("floor").order("sort"),
      sb.from("categories").select("id, slug"),
      sb.from("fabrics").select("slug, name, gsm, category_id, fabric_colors(id, hex, sort, is_active)").eq("is_active", true),
      sb.from("v_color_availability").select("color_id, available_m"),
      sb.rpc("showroom_stats"),
    ]);
    if (deps.error || !deps.data) return EMPTY;
    const s = (stats.data ?? {}) as { cutting_today?: number; cutting_queue?: number; shipped_week?: number };
    return {
      departments: buildDepartments(deps.data as never, (cats.data ?? []) as never, (fabrics.data ?? []) as never),
      availability: Object.fromEntries(((avail.data ?? []) as { color_id: string; available_m: string | number }[]).map((a) => [a.color_id, Number(a.available_m)])),
      stats: { cuttingToday: Number(s.cutting_today ?? 0), cuttingQueue: Number(s.cutting_queue ?? 0), shippedWeek: Number(s.shipped_week ?? 0) },
    };
  } catch {
    return EMPTY;
  }
}
