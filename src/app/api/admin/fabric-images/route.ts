import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/db/server";
import { createServiceSupabase } from "@/lib/db/service";
import { ImageRejected, MAX_UPLOAD_BYTES, reencodePhoto } from "@/lib/images/reencode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const ids = z.object({ fabricId: z.string().uuid(), colorId: z.string().uuid() });

/**
 * Photo of a fabric color, uploaded by an admin. The file never goes to Storage as it came: it is decoded and re-encoded
 * (upright, no metadata, 2000 px at most, WebP) and only then stored and linked to the color.
 */
export async function POST(request: Request) {
  const sb = await createServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const service = createServiceSupabase();
  const { data: profile } = await service.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) return NextResponse.json({ error: "too_big" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const parsed = ids.safeParse({ fabricId: form?.get("fabricId"), colorId: form?.get("colorId") });
  if (!form || !(file instanceof File) || !parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { fabricId, colorId } = parsed.data;

  const { data: color } = await service.from("fabric_colors").select("id").eq("id", colorId).eq("fabric_id", fabricId).maybeSingle();
  if (!color) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let photo;
  try {
    photo = await reencodePhoto(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof ImageRejected) return NextResponse.json({ error: e.code === "size" ? "too_big" : "unsupported_image" }, { status: e.code === "size" ? 413 : 415 });
    throw e;
  }

  const path = `${fabricId}/${colorId}/${crypto.randomUUID()}.webp`;
  const up = await service.storage.from("fabric-images").upload(path, photo.data, { contentType: photo.contentType, upsert: false });
  if (up.error) return NextResponse.json({ error: "storage_failed" }, { status: 500 });
  const { count } = await service.from("fabric_images").select("id", { count: "exact", head: true }).eq("color_id", colorId);
  const { data: row, error } = await service
    .from("fabric_images")
    .insert({ fabric_id: fabricId, color_id: colorId, storage_path: `fabric-images/${path}`, kind: "photo", sort: count ?? 0 })
    .select("id")
    .single();
  if (error) {
    await service.storage.from("fabric-images").remove([path]); // do not leave a file nobody points to
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: row.id, path: `fabric-images/${path}`, width: photo.width, height: photo.height });
}
