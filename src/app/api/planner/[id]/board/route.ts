import sharp from "sharp";
import { getTranslations } from "next-intl/server";
import { createServerSupabase } from "@/lib/db/server";
import { createServiceSupabase } from "@/lib/db/service";
import { renderCollectionBoardPdf } from "@/lib/planner/board-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const locales = ["fr", "en", "ar"] as const;
type Locale = typeof locales[number];
const json = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
const localized = (value: Record<string, string> | null | undefined, locale: Locale) => value?.[locale] || value?.fr || value?.en || value?.ar || "";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(404, "not_found");
  const localeParam = new URL(request.url).searchParams.get("locale") ?? "fr";
  if (!locales.includes(localeParam as Locale)) return json(400, "invalid_locale");
  const locale = localeParam as Locale;

  const auth = await (await createServerSupabase()).auth.getUser();
  if (!auth.data.user) return json(401, "unauthorized");
  const service = createServiceSupabase();
  const { data: profile } = await service.from("profiles").select("client_id, role").eq("id", auth.data.user.id).maybeSingle();
  if (!profile?.client_id || profile.role !== "client") return json(403, "forbidden");

  const { data: collection } = await service.from("collections").select("id, client_id, name, palette")
    .eq("id", id).eq("client_id", profile.client_id).maybeSingle();
  if (!collection) return json(404, "not_found");
  const { data: items, error: itemsError } = await service.from("collection_items")
    .select("id, garment_type, label, quantity_units, size_run, chosen_color_id, meters_needed, sort")
    .eq("collection_id", id).order("sort");
  if (itemsError) return json(503, "unavailable");

  const colorIds = [...new Set((items ?? []).map((item) => item.chosen_color_id).filter((value): value is string => Boolean(value)))];
  const { data: colors } = colorIds.length ? await service.from("fabric_colors").select("id, fabric_id, code, name, hex").in("id", colorIds) : { data: [] };
  const fabricIds = [...new Set((colors ?? []).map((color) => color.fabric_id))];
  const [{ data: fabrics }, { data: images }] = await Promise.all([
    fabricIds.length
      ? service.from("fabrics").select("id, sku, name, composition, gsm, width_cm").in("id", fabricIds)
      : Promise.resolve({ data: [] }),
    colorIds.length
      ? service.from("fabric_images").select("color_id, storage_path, sort").in("color_id", colorIds).eq("kind", "photo").order("sort")
      : Promise.resolve({ data: [] }),
  ]);
  const colorMap = new Map((colors ?? []).map((color) => [color.id, color]));
  const fabricMap = new Map((fabrics ?? []).map((fabric) => [fabric.id, fabric]));
  const imageMap = new Map<string, string>();
  for (const image of images ?? []) if (image.color_id && !imageMap.has(image.color_id)) imageMap.set(image.color_id, image.storage_path);
  const t = await getTranslations({ locale, namespace: "account.overview.planner" });

  const photoData = async (storagePath?: string) => {
    if (!storagePath) return undefined;
    const path = storagePath.startsWith("fabric-images/") ? storagePath.slice("fabric-images/".length) : storagePath;
    const { data, error } = await service.storage.from("fabric-images").download(path);
    if (error || !data) return undefined;
    try {
      const png = await sharp(Buffer.from(await data.arrayBuffer())).resize({ width: 500, height: 500, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      return `data:image/png;base64,${png.toString("base64")}`;
    } catch {
      return undefined;
    }
  };

  const pdfItems = await Promise.all((items ?? []).map(async (item) => {
    const color = item.chosen_color_id ? colorMap.get(item.chosen_color_id) : undefined;
    const fabric = color ? fabricMap.get(color.fabric_id) : undefined;
    if (!color || !fabric) return null;
    const composition = Array.isArray(fabric.composition) ? fabric.composition.map((part: { fiber?: string; pct?: number }) => `${part.fiber ?? ""} ${part.pct ?? 0}%`).join(", ") : "";
    const sizes = item.size_run && typeof item.size_run === "object" ? Object.entries(item.size_run as Record<string, number>).filter(([, qty]) => qty > 0).map(([size, qty]) => `${size} ${qty}`).join(", ") : "";
    let garment = item.garment_type;
    try { garment = t(`garments.${item.garment_type}` as never); } catch { /* preserve the stored type if a future garment is not translated yet */ }
    return {
      label: item.label,
      garment,
      quantity: item.quantity_units,
      sizeRun: sizes,
      meters: Number(item.meters_needed ?? 0),
      fabricName: localized(fabric.name, locale),
      sku: fabric.sku,
      colorName: localized(color.name, locale),
      colorCode: color.code,
      widthCm: fabric.width_cm,
      gsm: fabric.gsm,
      composition,
      hex: color.hex,
      photo: await photoData(imageMap.get(color.id)),
    };
  }));
  const pdf = await renderCollectionBoardPdf({
    name: collection.name,
    date: new Date().toISOString(),
    palette: Array.isArray(collection.palette) ? collection.palette as { name: string; hex: string }[] : [],
    pieces: pdfItems.filter((item): item is NonNullable<typeof item> => item !== null),
  }, {
    title: t("boardTitle"), palette: t("boardPalette"), piece: t("boardPieces"), quantity: t("boardQuantity"), sizeRun: t("boardSizeRun"),
    fabric: t("boardFabric"), meters: t("boardMeters"), width: t("boardWidth"), weight: t("boardWeight"), composition: t("boardComposition"), generated: t("boardGenerated"),
  }, locale);

  const safeName = collection.name.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "collection";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${safeName}-board.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
