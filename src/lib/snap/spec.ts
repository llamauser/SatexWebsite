import type { Spec } from "@/lib/match/schema";
import { emptySpec } from "@/lib/match/schema";
import type { DominantColor } from "./colors";
import type { Visual } from "./visual";

/** The two optional questions after a photo (a photo cannot show weight, season or stretch). Skipped = null. */
export type SeasonAnswer = "spring_summer" | "autumn_winter" | "all_season" | null;
export type StretchAnswer = "none" | "some" | "a_lot" | null;
export interface SnapAnswers { season: SeasonAnswer; stretch: StretchAnswer }

const STRETCH: Record<Exclude<StretchAnswer, null>, Spec["stretch"]> = { none: "none", some: "mechanical", a_lot: "four_way" };

/** The search specification built from what the photo shows plus the answers (docs/08b §A step 5). */
export function specFromVisual(v: Visual, colors: DominantColor[], answers: SnapAnswers): Spec {
  const spec = emptySpec();
  spec.construction = v.construction_guess;
  spec.structures = v.structure_guess ? [v.structure_guess] : [];
  spec.uses = v.likely_uses;
  spec.seasons = answers.season ? [answers.season] : [];
  spec.stretch = answers.stretch ? STRETCH[answers.stretch] : null;
  spec.colors = colors.map((c) => ({ name: c.hex, hex: c.hex }));
  spec.feel = { sheen: Math.round(v.sheen) };
  const words = [v.garment_guess, v.pattern !== "solid" ? v.pattern : null, v.texture !== "smooth" ? v.texture : null, v.structure_guess, v.notes].filter(Boolean);
  spec.query_text = words.join(". ");
  return spec;
}

/** Text shown with the results in place of the written brief. At least 10 characters (the stored brief must be valid). */
export function describeVisual(v: Visual, colors: DominantColor[]): string {
  const text = [v.garment_guess, v.notes].filter(Boolean).join(" · ") || "Photo";
  const hexes = colors.map((c) => c.hex).join(" ");
  return `${text}${hexes ? ` (${hexes})` : ""}`.slice(0, 600).padEnd(10, ".");
}
