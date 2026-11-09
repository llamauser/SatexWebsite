"use client";

import { useLocale, useTranslations } from "next-intl";
import type { FeelProfile, FeelScores } from "@/lib/cloth/feel";

const AXES = ["softness", "drape", "stretch", "sheen", "breathability"] as const;
type Axis = (typeof AXES)[number];
const clamp = (value: number) => Math.max(0, Math.min(10, value));
const point = (index: number, value: number, count: number, cx: number, cy: number, radius: number) => {
  const angle = -Math.PI / 2 + index * (2 * Math.PI / count);
  const r = radius * clamp(value) / 10;
  return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
};

function Radar({ scores, mini, rtl }: { scores: FeelScores; mini: boolean; rtl: boolean }) {
  const t = useTranslations("fabric.feel");
  const axes = (rtl ? [...AXES].reverse() : [...AXES]) as Axis[];
  const cx = 120; const cy = 112; const radius = mini ? 48 : 72;
  const polygon = axes.map((axis, index) => point(index, scores[axis], axes.length, cx, cy, radius)).join(" ");
  return <svg viewBox="0 0 240 224" role="img" aria-label={t("radarLabel")} className={mini ? "size-16 shrink-0" : "mx-auto w-full max-w-[340px]"}>
    {[2.5, 5, 7.5, 10].map((level) => <g key={level}><polygon points={axes.map((_, index) => point(index, level, axes.length, cx, cy, radius)).join(" ")} fill="none" stroke="currentColor" strokeOpacity={0.16} strokeWidth="1" />{!mini && <text x={cx + 3} y={cy - radius * level / 10 - 2} className="fill-current text-[7px] opacity-60">{level}</text>}</g>)}
    {axes.map((axis, index) => {
      const angle = -Math.PI / 2 + index * (2 * Math.PI / axes.length);
      const edgeX = cx + Math.cos(angle) * radius;
      const edgeY = cy + Math.sin(angle) * radius;
      const labelX = cx + Math.cos(angle) * (radius + 19);
      const labelY = cy + Math.sin(angle) * (radius + 19) + 3;
      const anchor = Math.cos(angle) < -0.2 ? "end" : Math.cos(angle) > 0.2 ? "start" : "middle";
      return <g key={axis}><line x1={cx} y1={cy} x2={edgeX} y2={edgeY} stroke="currentColor" strokeOpacity={0.14} />{!mini && <text x={labelX} y={labelY} textAnchor={anchor} className="fill-current text-[9px] font-medium">{t(`axes.${axis}`)}</text>}</g>;
    })}
    <polygon points={polygon} fill="var(--primary)" fillOpacity="0.2" stroke="var(--primary)" strokeWidth="2" />
  </svg>;
}

export function MiniFeelCard({ scores, className = "" }: { scores: FeelScores; className?: string }) {
  const locale = useLocale();
  return <span className={className} dir={locale === "ar" ? "rtl" : "ltr"}><Radar scores={scores} mini rtl={locale === "ar"} /></span>;
}

export function FeelCard({ profile }: { profile: FeelProfile }) {
  const t = useTranslations("fabric.feel");
  const locale = useLocale();
  const isMeasured = profile.source === "measured";
  const band = (value: number) => value < 3 ? "0" : value < 6 ? "3" : value < 8 ? "6" : "8";
  return <section className="rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="feel-card-title" data-testid="feel-card">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="feel-card-title" className="font-display text-xl font-semibold">{t("title")}</h2><p className="mt-1 text-sm text-text-muted">{t("intro")}</p></div><span className="rounded-full bg-surface-muted px-3 py-1 text-sm font-semibold" title={isMeasured ? t("measuredHint") : t("estimatedHint")}>{isMeasured ? t("measured") : t("estimated")}</span></div>
    <div className="mt-4 grid items-center gap-5 md:grid-cols-[minmax(220px,340px)_1fr]">
      <Radar scores={profile} mini={false} rtl={locale === "ar"} />
      <ul className="space-y-2">{AXES.map((axis) => <li key={axis} className="flex items-start justify-between gap-4 border-b border-border pb-2 text-sm"><span><span className="font-medium">{t(`axes.${axis}`)}</span><span className="ms-2 text-text-muted">{t(`lines.${axis}.${band(profile[axis])}`)}</span></span><span className="shrink-0 font-semibold tabular-nums" dir="ltr">{profile[axis].toFixed(1)}</span></li>)}</ul>
    </div>
  </section>;
}
