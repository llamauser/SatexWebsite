"use client";

import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { localized } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { fallbackReason, type Capabilities, type FloorMode, type ShowroomData } from "@/lib/showroom/model";
import { cn } from "@/lib/utils";
import { DepartmentPanel } from "./DepartmentPanel";

const Scene3D = dynamic(() => import("./Scene3D"), {
  ssr: false,
  // a picture of the finished scene while the 3D code arrives
  loading: () => (
    <div className="relative flex h-full items-center justify-center text-text-muted" role="status">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/showroom/preview.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
      <span className="relative rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-slate-700 shadow">…</span>
    </div>
  ),
});

/** If the 3D scene fails (no GPU, lost context), the picture takes over instead of an empty page. */
class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function ShowroomView({ initial }: { initial: ShowroomData }) {
  const t = useTranslations("showroom");
  const locale = useLocale();
  const [data, setData] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [floor, setFloor] = useState<FloorMode>("both");
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [crashed, setCrashed] = useState(false);

  useEffect(() => {
    let webgl = false;
    try {
      const canvas = document.createElement("canvas");
      webgl = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch { /* no WebGL */ }
    setCaps({ webgl });
  }, []);

  // live stock: the figures are refreshed from the public availability view
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      const sb = await loadBrowserSupabase();
      if (!sb || stopped) return;
      const { data: rows } = await sb.from("v_color_availability").select("color_id, available_m");
      if (rows && !stopped) setData((d) => ({ ...d, availability: Object.fromEntries((rows as { color_id: string; available_m: string | number }[]).map((r) => [r.color_id, Number(r.available_m)])) }));
    };
    const id = setInterval(() => void refresh(), 30_000);
    return () => { stopped = true; clearInterval(id); };
  }, []);

  const reason = caps ? (crashed ? "crashed" : fallbackReason(caps)) : "pending";
  const show3D = reason === null;
  const labels = useMemo(() => ({ ...Object.fromEntries(data.departments.map((d) => [d.slug, localized(d.name, locale)])) }), [data.departments, locale]);
  const current = data.departments.find((d) => d.slug === selected) ?? null;

  const select = (slug: string | null) => {
    setSelected(slug);
    const dep = data.departments.find((d) => d.slug === slug);
    if (dep && floor !== "both" && floor !== dep.floor) setFloor(dep.floor);
  };
  const floors: { value: FloorMode; label: string }[] = [{ value: "both", label: t("floors.both") }, { value: 0, label: t("floors.ground") }, { value: 1, label: t("floors.upper") }];

  return (
    <div data-testid="showroom" data-view={show3D ? "3d" : "picture"} data-reason={reason ?? "none"}>
      {show3D && (
        <div role="group" aria-label={t("floors.label")} className="inline-flex rounded-full border border-border bg-surface p-1" data-testid="floor-toggle">
          {floors.map((f) => (
            <button key={String(f.value)} type="button" aria-pressed={floor === f.value} onClick={() => setFloor(f.value)} data-testid={`floor-${f.value}`}
              className={cn("rounded-full px-4 py-1.5 text-sm font-medium", floor === f.value ? "bg-primary text-white" : "text-text-muted hover:text-text")}>{f.label}</button>
          ))}
        </div>
      )}
      {!show3D && reason !== "pending" && <p className="mt-3 text-sm text-text-muted" role="status" data-testid="fallback-note">{loose(t)(`fallback.${reason}`)}</p>}

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          <div className="relative">
            {show3D ? (
              <div className="relative h-[460px] overflow-hidden rounded-md border border-border sm:h-[560px]" data-testid="scene">
                <SceneBoundary onError={() => setCrashed(true)}>
                  <Scene3D data={data} selected={selected} hovered={hovered} floor={floor} ariaLabel={t("sceneLabel")} onSelect={(slug) => select(slug)} onHover={setHovered} />
                </SceneBoundary>
                {(hovered ?? selected) && labels[(hovered ?? selected)!] && (
                  <div className="pointer-events-none absolute start-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full bg-text px-4 py-1.5 text-sm font-semibold text-white shadow-card rtl:translate-x-1/2" data-testid="scene-label">{labels[(hovered ?? selected)!]}</div>
                )}
              </div>
            ) : (
              // no 3D here (no WebGL, or the scene crashed): a picture of the showroom; the list and the panels below work the same
              <div className="relative h-[320px] overflow-hidden rounded-md border border-border sm:h-[460px]" data-testid="scene-picture">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/showroom/preview.webp" alt={t("pictureAlt")} className="h-full w-full object-cover" />
              </div>
            )}
            <div className="pointer-events-none absolute bottom-3 start-3 rounded-md bg-surface/90 px-3 py-2 text-xs shadow-card" data-testid="legend">
              <p className="font-semibold tracking-widest text-text-muted">{t("legend.title")}</p>
              <p><span className="font-bold" dir="ltr">00</span> {t("legend.f0")}</p>
              <p><span className="font-bold" dir="ltr">01</span> {t("legend.f1")}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-text-muted">{t("hint")}</p>

          <nav aria-label={t("list.label")} className="mt-4" data-testid="department-list">
            <ul className="flex flex-wrap gap-2">
              {data.departments.map((d) => (
                <li key={d.id}>
                  <button type="button" aria-pressed={selected === d.slug} onClick={() => select(selected === d.slug ? null : d.slug)} onMouseEnter={() => setHovered(d.slug)} onMouseLeave={() => setHovered(null)} data-testid="department-chip" data-slug={d.slug}
                    className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm", selected === d.slug ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface hover:bg-surface-muted")}>
                    <span className="size-3 rounded-full border border-border" style={{ background: d.layout.color }} aria-hidden />
                    {localized(d.name, locale)}<span className="text-xs text-text-muted">· {d.floor === 0 ? "00" : "01"}</span>
                  </button>
                </li>
              ))}
            </ul>
            {data.departments.length === 0 && <p className="text-text-muted" data-testid="no-departments">{t("empty")}</p>}
          </nav>
        </div>

        <div>
          {current ? <DepartmentPanel department={current} data={data} onClose={() => select(null)} /> : (
            <div className="rounded-md border border-dashed border-border bg-surface p-6 text-sm text-text-muted" data-testid="panel-placeholder">{t("panel.placeholder")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
