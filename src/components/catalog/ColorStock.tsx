"use client";

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { formatNumber } from "@/lib/data/format";
import { stockLevel } from "@/lib/catalog/params";
import { cn } from "@/lib/utils";

export interface ColorView {
  id: string;
  code: string;
  label: string;
  hex: string;
  photoUrl: string | null;
  swatchUrl: string | null;
}

const badge = {
  in: "bg-success/10 text-success",
  low: "bg-warning/15 text-warning",
  out: "bg-surface-muted text-text-muted",
} as const;

/**
 * Gallery + colors + live stock for one fabric. The stock figures come from the public availability view; a tiny
 * broadcast message ("something changed") triggers a refresh within ~1 s, with a 60 s poll as a safety net.
 */
export function ColorStock({
  fabricId, fabricName, colors, initialAvailability, moqM, lowThresholdM,
}: {
  fabricId: string;
  fabricName: string;
  colors: ColorView[];
  initialAvailability: Record<string, number>;
  moqM: number;
  lowThresholdM: number;
}) {
  const t = useTranslations("fabric.stock");
  const locale = useLocale();
  const [selected, setSelected] = useState(colors[0]?.id ?? "");
  const [availability, setAvailability] = useState(initialAvailability);
  const [live, setLive] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const supabase = await loadBrowserSupabase();
      if (!supabase || cancelled) return;
      const refresh = async () => {
        const { data } = await supabase.from("v_color_availability").select("color_id, available_m").eq("fabric_id", fabricId);
        if (!cancelled && data) {
          setAvailability(Object.fromEntries((data as { color_id: string; available_m: string | number }[]).map((r) => [r.color_id, Number(r.available_m)])));
        }
      };
      const channel = supabase
        .channel(`fabric:${fabricId}`)
        .on("broadcast", { event: "stock" }, () => {
          if (debounce.current) clearTimeout(debounce.current);
          debounce.current = setTimeout(() => void refresh(), 250);
        })
        .subscribe((status) => {
          if (!cancelled) setLive(status === "SUBSCRIBED");
        });
      const poll = setInterval(() => void refresh(), 60_000);
      void refresh(); // pick up changes that happened between page generation and now
      cleanup = () => {
        clearInterval(poll);
        if (debounce.current) clearTimeout(debounce.current);
        void supabase.removeChannel(channel);
      };
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [fabricId]);

  const current = colors.find((c) => c.id === selected) ?? colors[0];
  const src = current?.photoUrl ?? current?.swatchUrl ?? null;
  const unoptimized = !!src && /^https?:\/\/(127\.0\.0\.1|localhost)/.test(src);

  return (
    <div>
      <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-surface-muted" data-testid="gallery-main">
        {src ? (
          <Image src={src} alt={`${fabricName} – ${current?.label ?? ""}`} fill priority sizes="(min-width: 1024px) 560px, 100vw" unoptimized={unoptimized} className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center" style={{ background: current?.hex }} aria-hidden />
        )}
      </div>

      <h2 className="mt-6 font-display text-xl font-semibold">{t("title")}</h2>
      <p className="mt-1 text-xs text-text-muted" data-testid="stock-live" data-live={live}>
        <span className={cn("me-1.5 inline-block size-2 rounded-full", live ? "bg-success" : "bg-border")} aria-hidden />
        {live ? t("live") : t("static")}
      </p>

      <ul className="mt-3 divide-y divide-border rounded-md border border-border bg-surface" data-testid="color-list">
        {colors.map((c) => {
          const available = availability[c.id] ?? 0;
          const level = stockLevel(available, moqM, lowThresholdM);
          const on = c.id === selected;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setSelected(c.id)}
                aria-pressed={on}
                data-color={c.code}
                className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-start", on && "bg-surface-muted")}
              >
                <span className="size-6 shrink-0 rounded-full border border-border" style={{ background: c.hex }} aria-hidden />
                <span className="flex-1 text-sm font-medium">{c.label}</span>
                <span className="text-sm tabular-nums text-text-muted" data-testid={`available-${c.code}`} data-meters={Math.floor(available)}>
                  {level === "out" ? "" : t("meters", { m: formatNumber(Math.floor(available), locale) })}
                </span>
                <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", badge[level])}>{t(level)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
