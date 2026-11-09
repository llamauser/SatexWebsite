"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const STORAGE_KEY = "satex.compare.fabricIds";
const validId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);

export function AddToCompare({ fabricId, slug, className = "" }: { fabricId: string; slug: string; className?: string }) {
  const t = useTranslations("compare");
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    const read = () => {
      try { const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); setIds(Array.isArray(raw) ? [...new Set(raw.filter(validId))].slice(0, 3) : []); } catch { setIds([]); }
    };
    read();
    window.addEventListener("storage", read);
    window.addEventListener("satex-compare-change", read);
    return () => { window.removeEventListener("storage", read); window.removeEventListener("satex-compare-change", read); };
  }, []);
  const selected = ids.includes(fabricId);
  const toggle = () => {
    const next = selected ? ids.filter((id) => id !== fabricId) : ids.length < 3 ? [...ids, fabricId] : ids;
    setIds(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("satex-compare-change"));
  };
  return <div className={`flex flex-wrap items-center gap-2 ${className}`}>
    <button type="button" onClick={toggle} aria-pressed={selected} disabled={!selected && ids.length >= 3} className="rounded border border-border px-3 py-1.5 text-sm font-medium text-primary disabled:opacity-50" data-testid={`compare-${slug}`}>
      {selected ? t("remove") : ids.length >= 3 ? t("limit") : t("add")}
    </button>
    {ids.length > 0 && <Link href={{ pathname: "/compare", query: { ids: ids.join(",") } }} className="text-sm font-medium text-primary hover:underline">{t("view", { count: ids.length })}</Link>}
  </div>;
}
