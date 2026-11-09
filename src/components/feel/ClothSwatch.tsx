"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { FeelScores } from "@/lib/cloth/feel";
import type { ClothMode } from "@/lib/cloth/xpbd/solver.cpu";
import { ClothScene } from "./cloth-scene";

type ColorOption = { id: string; label: string; hex: string };
const MODES: ClothMode[] = ["hang", "table", "sphere", "wind"];

/** The interactive fabric swatch: a real-time cloth simulation of this fabric (its weight, stretch, drape and sheen), that you can pull, drop on a block or a ball, and blow on. */
export function ClothSwatch({ colors, gsm, feel, stretchLimitPct, structure, construction }: {
  colors: ColorOption[]; gsm: number; feel: FeelScores; stretchLimitPct: number | null; structure: string; construction: string;
}) {
  const t = useTranslations("fabric.feel");
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ClothScene | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<ClothMode>("hang");
  const [strain, setStrain] = useState(0);
  const [colorId, setColorId] = useState(colors[0]?.id ?? "");
  const selected = colors.find((color) => color.id === colorId) ?? colors[0];
  const colorRef = useRef(selected?.hex ?? "#557d86");
  const modeRef = useRef(mode);

  // one scene per fabric (the feel and weight shape the cloth); the color and the mode are changed on the live scene
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    try {
      const scene = new ClothScene(host, { feel, gsm, structure, construction, stretchLimitPct, color: colorRef.current, onStrain: setStrain, onReady: () => setReady(true) });
      sceneRef.current = scene;
      scene.setMode(modeRef.current);
      setSupported(true);
      return () => { scene.dispose(); sceneRef.current = null; setReady(false); };
    } catch {
      setSupported(false);
    }
  }, [feel, gsm, structure, construction, stretchLimitPct]);

  useEffect(() => {
    if (!selected) return;
    colorRef.current = selected.hex;
    sceneRef.current?.setColor(selected.hex);
  }, [selected]);

  const choose = (value: ClothMode) => {
    modeRef.current = value;
    setMode(value);
    setStrain(0);
    sceneRef.current?.setMode(value);
  };

  return (
    <section className="space-y-3" aria-label={t("swatchTitle")}>
      <div className="flex flex-wrap items-center gap-2">
        {MODES.map((value) => (
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => choose(value)}
            className={`rounded-full border px-3 py-1.5 text-sm ${mode === value ? "border-primary bg-primary/10" : "border-border"}`}>
            {t(`modes.${value}`)}
          </button>
        ))}
        <button type="button" onClick={() => sceneRef.current?.reset()} className="ms-auto text-sm text-primary hover:underline">{t("modes.reset")}</button>
      </div>
      {colors.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("color")}>
          {colors.map((color) => (
            <button key={color.id} type="button" title={color.label} aria-label={color.label} aria-pressed={color.id === colorId} onClick={() => setColorId(color.id)}
              className={`size-7 rounded-full border-2 ${color.id === colorId ? "border-text" : "border-border"}`} style={{ backgroundColor: color.hex }} />
          ))}
        </div>
      )}
      <div
        ref={hostRef} role="img" aria-label={t("swatchTitle")} data-testid="cloth-swatch" data-ready={ready}
        className="relative h-[380px] touch-none overflow-hidden rounded-xl border border-border bg-[#eef1f3]"
        onPointerDown={(event) => {
          if (sceneRef.current?.pointerDown(event.clientX, event.clientY)) { event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.style.cursor = "grabbing"; }
        }}
        onPointerMove={(event) => {
          const scene = sceneRef.current;
          if (!scene) return;
          scene.pointerMove(event.clientX, event.clientY);
          if (event.buttons === 0) event.currentTarget.style.cursor = scene.hover(event.clientX, event.clientY) ? "grab" : "";
        }}
        onPointerUp={(event) => { sceneRef.current?.pointerUp(); event.currentTarget.style.cursor = ""; }}
        onPointerCancel={() => sceneRef.current?.pointerUp()}
      >
        {(supported !== true || !ready) && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-[#eef1f3] p-6 text-center text-sm text-text-muted">
            {supported === false ? t("unsupported") : t("loading")}
          </div>
        )}
      </div>
      <p className="text-sm text-text-muted">
        {mode === "hang" ? t("strain", { value: strain.toFixed(0), limit: stretchLimitPct === null ? "—" : `${stretchLimitPct}%` })
          : mode === "wind" ? t("windSummary", { gsm, air: feel.breathability.toFixed(1) })
          : t("drapeSummary", { drape: feel.drape.toFixed(1) })}
      </p>
      <p className="text-xs text-text-muted">{t("hint")}</p>
    </section>
  );
}
