import { createHash } from "node:crypto";

export interface FabricForEmbedding {
  name: { fr?: string; en?: string } | null;
  short_description?: { fr?: string; en?: string } | null;
  structure: string;
  construction: string;
  composition: { fiber: string; pct: number }[];
  gsm: number;
  width_cm: number;
  stretch: string;
  finish?: string[] | null;
  uses?: string[] | null;
  seasons?: string[] | null;
  feel?: { softness?: number | null; drape?: number | null; stretch?: number | null; sheen?: number | null; breathability?: number | null } | null;
}

const words = (v: string) => v.replaceAll("_", " ");

/**
 * The English text that represents a fabric in vector search (docs/06-ai-matching.md §4). English keeps the vector space
 * consistent for French, English and Arabic briefs.
 */
export function buildFabricDoc(f: FabricForEmbedding): string {
  const name = f.name?.en || f.name?.fr || "";
  const composition = f.composition.map((c) => `${c.pct}% ${c.fiber}`).join(", ");
  const parts = [
    `${name}.`,
    `${words(f.structure)} ${f.construction}, ${f.gsm} GSM, ${f.width_cm} cm wide, composition ${composition}, stretch ${words(f.stretch)}${f.finish?.length ? `, finishes ${f.finish.map(words).join(", ")}` : ""}.`,
  ];
  if (f.uses?.length) parts.push(`Best for ${f.uses.map(words).join(", ")}.`);
  if (f.seasons?.length) parts.push(`Seasons ${f.seasons.map(words).join(", ")}.`);
  const short = f.short_description?.en || f.short_description?.fr;
  if (short) parts.push(`${short}`);
  if (f.feel) {
    const feel = Object.entries(f.feel).filter(([, v]) => typeof v === "number").map(([k, v]) => `${k} ${v}/10`);
    if (feel.length) parts.push(`Feel: ${feel.join(", ")}.`);
  }
  return parts.join(" ");
}

export const contentHash = (text: string) => createHash("sha256").update(text).digest("hex");
