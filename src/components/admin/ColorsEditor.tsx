"use client";

import { Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Input } from "@/components/ui/Field";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { LOCALES, type L3 } from "@/lib/admin/fabric-form";
import { Check } from "./ui";

interface ColorRow { id: string; code: string; name: L3; hex: string; is_active: boolean; sort: number }
interface ImageRow { id: string; color_id: string | null; storage_path: string }
type DraftColor = { code: string; name: L3; hex: string };
const blankDraft = (): DraftColor => ({ code: "", name: { fr: "", en: "", ar: "" }, hex: "#CCCCCC" });
const toL3 = (j: Record<string, string> | null): L3 => ({ fr: j?.fr ?? "", en: j?.en ?? "", ar: j?.ar ?? "" });
const i18n = (v: L3) => Object.fromEntries(LOCALES.filter((l) => v[l].trim()).map((l) => [l, v[l].trim()]));

/** Colors of a saved fabric: add, rename, recolor, switch off, and upload photos. (Colors are never deleted: they hold stock history.) */
export function ColorsEditor({ fabricId }: { fabricId: string }) {
  const t = useTranslations("admin.colors");
  const [colors, setColors] = useState<ColorRow[] | null>(null);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [draft, setDraft] = useState<DraftColor>(blankDraft());
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = await loadBrowserSupabase();
    if (!sb) return;
    const [c, i] = await Promise.all([
      sb.from("fabric_colors").select("id, code, name, hex, is_active, sort").eq("fabric_id", fabricId).order("sort").order("code"),
      sb.from("fabric_images").select("id, color_id, storage_path").eq("fabric_id", fabricId).order("sort"),
    ]);
    setColors(((c.data ?? []) as unknown as (Omit<ColorRow, "name"> & { name: Record<string, string> })[]).map((r) => ({ ...r, name: toL3(r.name) })));
    setImages((i.data ?? []) as ImageRow[]);
  }, [fabricId]);
  useEffect(() => { void load(); }, [load]);

  const setColor = (id: string, patch: Partial<ColorRow>) => setColors((cs) => (cs ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const fail = (text: string) => setMessage({ kind: "error", text });

  async function add() {
    setMessage(null);
    if (!draft.code.trim() || !draft.name.fr.trim()) return fail(t("required"));
    if (!/^#[0-9a-f]{6}$/i.test(draft.hex)) return fail(t("hex"));
    setBusy("new");
    const sb = await loadBrowserSupabase();
    const { error } = await sb!.from("fabric_colors").insert({ fabric_id: fabricId, code: draft.code.trim(), name: i18n(draft.name), hex: draft.hex.toUpperCase(), sort: (colors?.length ?? 0) });
    setBusy(null);
    if (error) return fail(error.code === "23505" ? t("duplicate") : t("saveError"));
    setDraft(blankDraft());
    setMessage({ kind: "success", text: t("added") });
    await load();
  }

  async function save(c: ColorRow) {
    setMessage(null);
    if (!c.name.fr.trim()) return fail(t("required"));
    if (!/^#[0-9a-f]{6}$/i.test(c.hex)) return fail(t("hex"));
    setBusy(c.id);
    const sb = await loadBrowserSupabase();
    const { error } = await sb!.from("fabric_colors").update({ name: i18n(c.name), hex: c.hex.toUpperCase(), is_active: c.is_active }).eq("id", c.id);
    setBusy(null);
    if (error) return fail(t("saveError"));
    setMessage({ kind: "success", text: t("saved", { code: c.code }) });
    await load();
  }

  async function upload(c: ColorRow, file: File) {
    setMessage(null);
    setBusy(c.id);
    // the server decodes and re-encodes the photo (upright, no EXIF/GPS, 2000 px, WebP) before it is stored
    const form = new FormData();
    form.set("fabricId", fabricId);
    form.set("colorId", c.id);
    form.set("file", file);
    const res = await fetch("/api/admin/fabric-images", { method: "POST", body: form }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return fail(t("uploadError"));
    setMessage({ kind: "success", text: t("uploaded") });
    await load();
  }

  async function removeImage(img: ImageRow) {
    setBusy(img.id);
    const sb = await loadBrowserSupabase();
    const [bucket, ...rest] = img.storage_path.split("/");
    if (bucket) await sb!.storage.from(bucket).remove([rest.join("/")]);
    await sb!.from("fabric_images").delete().eq("id", img.id);
    setBusy(null);
    await load();
  }

  const url = (path: string) => {
    const [bucket, ...rest] = path.split("/");
    return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${bucket}/${rest.join("/")}`;
  };

  return (
    <div className="space-y-4" data-testid="colors-editor">
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      {colors === null && <p className="text-text-muted">{t("loading")}</p>}
      {colors?.length === 0 && <p className="text-sm text-text-muted" data-testid="no-colors">{t("none")}</p>}
      <ul className="space-y-4">
        {colors?.map((c) => (
          <li key={c.id} className="rounded-md border border-border p-4" data-testid="color-row" data-code={c.code}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="size-8 rounded-full border border-border" style={{ background: c.hex }} aria-hidden />
              <strong dir="ltr" className="min-w-16">{c.code}</strong>
              <Check label={t("active")} checked={c.is_active} onChange={(e) => setColor(c.id, { is_active: e.target.checked })} />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              {LOCALES.map((l) => (
                <Input key={l} label={`${t("name")} (${l.toUpperCase()})`} value={c.name[l]} dir={l === "ar" ? "rtl" : "ltr"} onChange={(e) => setColor(c.id, { name: { ...c.name, [l]: e.target.value } })} data-testid={`color-name-${l}`} />
              ))}
              <Input label={t("hex")} value={c.hex} dir="ltr" onChange={(e) => setColor(c.id, { hex: e.target.value })} data-testid="color-hex" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" loading={busy === c.id} onClick={() => void save(c)} data-testid="color-save">{t("save")}</Button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-surface-muted">
                <Upload className="size-4" aria-hidden />
                {t("upload")}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" data-testid="color-upload" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(c, f); e.target.value = ""; }} />
              </label>
            </div>
            <ul className="mt-3 flex flex-wrap gap-3" data-testid="color-images">
              {images.filter((i) => i.color_id === c.id).map((img) => (
                <li key={img.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url(img.storage_path)} alt={`${c.code}`} className="size-24 rounded-sm border border-border object-cover" />
                  <button type="button" onClick={() => void removeImage(img)} disabled={busy === img.id} aria-label={t("removeImage")} className="absolute end-1 top-1 rounded-full bg-surface/90 p-1 text-danger shadow-card">
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <div className="rounded-md border border-dashed border-border p-4" data-testid="new-color">
        <h3 className="font-medium">{t("addTitle")}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          <Input label={t("code")} value={draft.code} dir="ltr" onChange={(e) => setDraft({ ...draft, code: e.target.value })} data-testid="new-color-code" />
          {LOCALES.map((l) => (
            <Input key={l} label={`${t("name")} (${l.toUpperCase()})`} value={draft.name[l]} dir={l === "ar" ? "rtl" : "ltr"} onChange={(e) => setDraft({ ...draft, name: { ...draft.name, [l]: e.target.value } })} data-testid={`new-color-name-${l}`} />
          ))}
          <Input label={t("hex")} value={draft.hex} dir="ltr" onChange={(e) => setDraft({ ...draft, hex: e.target.value })} data-testid="new-color-hex" />
        </div>
        <div className="mt-3"><Button type="button" loading={busy === "new"} onClick={() => void add()} data-testid="add-color">{t("add")}</Button></div>
      </div>
    </div>
  );
}
