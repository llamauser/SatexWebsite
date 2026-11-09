"use client";

import { Camera, ImagePlus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, type DragEvent } from "react";
import { Alert } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Link, useRouter } from "@/i18n/navigation";
import { loose } from "@/lib/i18n-loose";
import { cn } from "@/lib/utils";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SIDE = 1280;
const SEASONS = ["spring_summer", "autumn_winter", "all_season"] as const;
const STRETCHES = ["none", "some", "a_lot"] as const;
type Stage = "understanding" | "searching" | "ranking" | "explaining";
type ErrorCode = "type" | "size" | "read" | "notTextile" | "rate" | "unsupported" | "server";

/** Shrinks the photo in the browser (a phone photo is several MB) and re-encodes it as JPEG, which also drops its metadata. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function SnapUploader() {
  const t = useTranslations("snap");
  const locale = useLocale();
  const router = useRouter();
  const [photo, setPhoto] = useState<{ url: string; data: string } | null>(null);
  const [season, setSeason] = useState<(typeof SEASONS)[number] | null>(null);
  const [stretch, setStretch] = useState<(typeof STRETCHES)[number] | null>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [running, setRunning] = useState<Stage | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  async function take(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) return setError("type");
    if (file.size > MAX_BYTES) return setError("size");
    setBusy(true);
    try {
      const data = await shrink(file);
      setPhoto((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { url: URL.createObjectURL(file), data };
      });
    } catch {
      setError("read"); // for example a HEIC photo in a browser that cannot open it
    } finally {
      setBusy(false);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer.files[0]);
  };

  async function submit() {
    if (!photo) return;
    setError(null);
    setRunning("understanding");
    try {
      const res = await fetch("/api/snap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: photo.data, locale, season, stretch }) });
      if (res.status === 429) throw new Error("rate");
      if (res.status === 415) throw new Error("unsupported");
      if (!res.ok || !res.body) throw new Error("server");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sessionId: string | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as { type: string; stage?: Stage; code?: string; sessionId?: string };
          if (event.type === "progress" && event.stage) setRunning(event.stage);
          if (event.type === "error") throw new Error(event.code === "not_textile" ? "notTextile" : "server");
          if (event.type === "done" && event.sessionId) sessionId = event.sessionId;
        }
      }
      if (!sessionId) throw new Error("server");
      router.push(`/match/${sessionId}`);
    } catch (e) {
      setRunning(null);
      const code = (e as Error).message;
      setError((["rate", "unsupported", "notTextile"] as string[]).includes(code) ? (code as ErrorCode) : "server");
    }
  }

  if (running) {
    return (
      <div className="mx-auto max-w-xl rounded-md border border-border bg-surface p-8 text-center shadow-card" data-testid="snap-running" role="status" aria-live="polite">
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt="" className="mx-auto size-32 rounded-md border border-border object-cover" />
        )}
        <p className="mt-6 font-display text-xl font-semibold">{loose(t)(`stage.${running}`)}</p>
        <p className="mt-1 text-sm text-text-muted">{t("running")}</p>
      </div>
    );
  }

  const chip = (selected: boolean) => cn("rounded-full border px-4 py-2 text-sm font-medium", selected ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface hover:bg-surface-muted");

  return (
    <div className="mx-auto max-w-2xl space-y-6" data-testid="snap">
      {!photo ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop} data-testid="snap-drop" data-over={over}
          className={cn("rounded-lg border-2 border-dashed p-10 text-center transition-colors", over ? "border-primary bg-primary/5" : "border-border bg-surface")}
        >
          <ImagePlus className="mx-auto size-10 text-primary" aria-hidden />
          <p className="mt-3 font-display text-xl font-semibold">{t("drop")}</p>
          <p className="mt-1 text-sm text-text-muted">{t("formats")}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Button type="button" onClick={() => fileInput.current?.click()} loading={busy} data-testid="snap-choose">{t("choose")}</Button>
            <Button type="button" variant="secondary" onClick={() => cameraInput.current?.click()} data-testid="snap-camera-button"><Camera className="size-4" aria-hidden />{t("camera")}</Button>
          </div>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="sr-only" tabIndex={-1} aria-label={t("choose")} data-testid="snap-input" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label={t("camera")} data-testid="snap-camera" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="relative mx-auto w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={t("previewAlt")} className="max-h-80 rounded-md border border-border object-contain" data-testid="snap-preview" />
            <button type="button" onClick={() => setPhoto(null)} aria-label={t("remove")} className="absolute end-2 top-2 rounded-full bg-surface/90 p-2 shadow-card" data-testid="snap-remove"><X className="size-4" aria-hidden /></button>
          </div>
        </div>
      )}

      {error && <Alert>{loose(t)(`error.${error}`)}</Alert>}

      {photo && (
        <section className="space-y-5 rounded-lg border border-border bg-surface p-5" aria-labelledby="snap-questions">
          <div>
            <h2 id="snap-questions" className="font-display text-xl font-semibold">{t("questions")}</h2>
            <p className="text-sm text-text-muted">{t("questionsHint")}</p>
          </div>
          <fieldset>
            <legend className="text-sm font-medium">{t("season.label")}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {SEASONS.map((s) => <button key={s} type="button" aria-pressed={season === s} onClick={() => setSeason(season === s ? null : s)} className={chip(season === s)} data-testid={`season-${s}`}>{loose(t)(`season.${s}`)}</button>)}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium">{t("stretch.label")}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {STRETCHES.map((s) => <button key={s} type="button" aria-pressed={stretch === s} onClick={() => setStretch(stretch === s ? null : s)} className={chip(stretch === s)} data-testid={`stretch-${s}`}>{loose(t)(`stretch.${s}`)}</button>)}
            </div>
          </fieldset>
          <Button type="button" onClick={() => void submit()} data-testid="snap-submit">{t("submit")}</Button>
        </section>
      )}

      <p className="text-center text-xs text-text-muted" data-testid="snap-privacy">{t("privacy")}</p>
      <p className="text-center text-sm"><Link href="/match" className="text-primary hover:underline">{t("toWizard")}</Link></p>
    </div>
  );
}
