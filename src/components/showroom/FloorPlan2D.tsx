"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { localized } from "@/lib/data/format";
import { FLOOR_D, FLOOR_W, type ShowroomDepartment } from "@/lib/showroom/model";
import { cn } from "@/lib/utils";

/** The same layouts as the 3D scene, flat: always works (no WebGL, low memory, reduced motion). One floor at a time. */
export function FloorPlan2D({ departments, floor, selected, onSelect }: { departments: ShowroomDepartment[]; floor: 0 | 1; selected: string | null; onSelect: (slug: string) => void }) {
  const t = useTranslations("showroom");
  const locale = useLocale();
  const [hover, setHover] = useState<string | null>(null);
  const shown = departments.filter((d) => d.floor === floor);
  return (
    <svg viewBox={`-1 -1 ${FLOOR_W + 2} ${FLOOR_D + 2}`} className="h-auto w-full rounded-md border border-border bg-[#E9EEF3]" role="group" aria-label={t("planLabel", { floor })} data-testid="floor-plan" data-floor={floor}>
      <rect x="0" y="0" width={FLOOR_W} height={FLOOR_D} fill="#F7F9FB" stroke="#B7C0CC" strokeWidth="0.3" rx="0.4" />
      {shown.map((d) => {
        const on = selected === d.slug;
        const l = d.layout;
        return (
          <g key={d.id} role="button" tabIndex={0} aria-pressed={on} aria-label={localized(d.name, locale)} data-testid="plan-department" data-slug={d.slug}
            onClick={() => onSelect(d.slug)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(d.slug))}
            onMouseEnter={() => setHover(d.slug)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(d.slug)} onBlur={() => setHover(null)} className="cursor-pointer outline-none">
            <rect x={l.x} y={l.z} width={l.w} height={l.d} rx="0.5" fill={l.color} fillOpacity={on || hover === d.slug ? 0.95 : 0.6} stroke={on ? "#1F6FEB" : hover === d.slug ? "#1B2430" : "#7A8594"} strokeWidth={on ? 0.45 : 0.2} />
            <text x={l.x + l.w / 2} y={l.z + l.d / 2} textAnchor="middle" dominantBaseline="middle" fontSize={l.w < 7 ? 0.95 : 1.15} fontWeight="600" fill="#1B2430" className={cn("pointer-events-none select-none")}>
              {localized(d.name, locale)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
