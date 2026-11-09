"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { FeelScores } from "@/lib/cloth/feel";

function SwatchLoading() {
  const t = useTranslations("fabric.feel");
  return <p className="grid h-[330px] place-items-center rounded-xl border border-border bg-surface-muted p-6 text-center text-sm text-text-muted">{t("loading")}</p>;
}

const ClothSwatch = dynamic(() => import("./ClothSwatch").then((module) => module.ClothSwatch), {
  ssr: false,
  loading: SwatchLoading,
});

type ColorOption = { id: string; label: string; hex: string };
export function LazyClothSwatch(props: { colors: ColorOption[]; gsm: number; feel: FeelScores; stretchLimitPct: number | null }) {
  return <ClothSwatch {...props} />;
}
