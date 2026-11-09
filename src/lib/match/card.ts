import type { Components, ScoredCandidate } from "./schema";

/** What is stored and shown for one result (a snapshot of the facts at match time; the fabric page has the live stock). */
export interface ResultCard {
  colorId: string;
  fabricId: string;
  slug: string;
  sku: string;
  name: { fr?: string; en?: string; ar?: string };
  colorName: { fr?: string; en?: string; ar?: string };
  colorCode: string;
  hex: string;
  pct: number;
  components: Components;
  structure: string;
  construction: string;
  gsm: number;
  widthCm: number;
  composition: { fiber: string; pct: number }[];
  stretch: string;
  uses: string[];
  seasons: string[];
  availableM: number;
  price: number | null;
  imagePath: string | null;
  explanation: string;
}

export function toResultCard(r: ScoredCandidate, explanation: string): ResultCard {
  const c = r.candidate;
  return {
    colorId: c.color_id, fabricId: c.fabric_id, slug: c.slug, sku: c.sku, name: c.name, colorName: c.color_name, colorCode: c.color_code, hex: c.hex,
    pct: r.pct, components: r.components, structure: c.structure, construction: c.construction, gsm: c.gsm, widthCm: c.width_cm,
    composition: c.composition, stretch: c.stretch, uses: c.uses, seasons: c.seasons, availableM: Math.floor(Number(c.available_m)),
    price: c.price === null ? null : Number(c.price), imagePath: c.image_path, explanation,
  };
}
