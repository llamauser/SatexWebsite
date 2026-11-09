"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export function FabricDetailTabs({ details, feel }: { details: ReactNode; feel: ReactNode }) {
  const t = useTranslations("fabric.tabs");
  const [active, setActive] = useState<"details" | "feel">("details");
  const id = useId();
  return <div className="mt-6">
    <div role="tablist" aria-label={t("details")} className="flex gap-1 border-b border-border">
      {(["details", "feel"] as const).map((tab) => <button key={tab} type="button" role="tab" id={`${id}-${tab}`} aria-selected={active === tab} aria-controls={`${id}-${tab}-panel`} onClick={() => setActive(tab)} className={`border-b-2 px-4 py-3 text-sm font-medium ${active === tab ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text"}`}>{t(tab)}</button>)}
    </div>
    {active === "details" && <div role="tabpanel" id={`${id}-details-panel`} aria-labelledby={`${id}-details`} className="pt-6">{details}</div>}
    {active === "feel" && <div role="tabpanel" id={`${id}-feel-panel`} aria-labelledby={`${id}-feel`} className="pt-6">{feel}</div>}
  </div>;
}
