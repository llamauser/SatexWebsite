import { z } from "zod";
import { createServerSupabase } from "@/lib/db/server";
import { createServiceSupabase } from "@/lib/db/service";
import { calculateMeters } from "@/lib/planner/meterage";
import { SIZES } from "@/lib/planner/garments";

const Body = z.object({
  collectionId: z.uuid(),
  itemId: z.uuid(),
  colorId: z.uuid(),
  sizeRun: z.record(z.enum(SIZES), z.number().int().min(0)),
});
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function PATCH(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_request" });
  const { data: auth } = await (await createServerSupabase()).auth.getUser();
  if (!auth.user) return json(401, { error: "unauthorized" });
  const service = createServiceSupabase();
  const { data: profile } = await service.from("profiles").select("client_id, role").eq("id", auth.user.id).maybeSingle();
  if (profile?.role !== "client" || !profile.client_id) return json(403, { error: "forbidden" });

  const { data: item } = await service.from("collection_items")
    .select("id, garment_type, quantity_units, alternatives, collections!inner(id, client_id, status)")
    .eq("id", parsed.data.itemId).eq("collection_id", parsed.data.collectionId).maybeSingle();
  const collection = Array.isArray(item?.collections) ? item.collections[0] : item?.collections;
  if (!item || !collection || collection.client_id !== profile.client_id) return json(404, { error: "not_found" });
  if (collection.status === "quoted") return json(409, { error: "already_quoted" });
  const alternatives = Array.isArray(item.alternatives) ? item.alternatives as { colorId?: string }[] : [];
  if (!alternatives.some((alternative) => alternative.colorId === parsed.data.colorId)) return json(400, { error: "invalid_choice" });
  const total = Object.values(parsed.data.sizeRun).reduce((sum, quantity) => sum + quantity, 0);
  if (total !== item.quantity_units) return json(400, { error: "size_run_mismatch" });

  const [{ data: garment }, { data: color }] = await Promise.all([
    service.from("garment_consumption").select("garment_type, base_m_per_unit, ref_width_cm, size_factors").eq("garment_type", item.garment_type).single(),
    service.from("fabric_colors").select("id, fabric_id, fabrics!inner(width_cm, moq_m)").eq("id", parsed.data.colorId).single(),
  ]);
  if (!garment || !color) return json(404, { error: "not_found" });
  const fabric = Array.isArray(color.fabrics) ? color.fabrics[0] : color.fabrics;
  if (!fabric) return json(404, { error: "not_found" });
  const meters = calculateMeters(parsed.data.sizeRun, garment, fabric.width_cm, Number(fabric.moq_m));
  const { error } = await service.from("collection_items").update({ chosen_color_id: color.id, size_run: parsed.data.sizeRun, meters_needed: meters }).eq("id", item.id);
  if (error) return json(503, { error: "save_failed" });
  return json(200, { metersNeeded: meters, colorId: color.id });
}
