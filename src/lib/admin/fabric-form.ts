/**
 * The fabric form of the back-office: its shape, validation (same rules as the database constraints) and the conversion
 * to and from database rows. Pure: no browser, no network, unit-tested.
 */
export const LOCALES = ["fr", "en", "ar"] as const;
export type FormLocale = (typeof LOCALES)[number];
export type L3 = Record<FormLocale, string>;
export const TEXT_FIELDS = ["name", "shortDescription", "description"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];
/** Form field -> column of the table (and key of `machine_translated`). */
export const TEXT_COLUMN: Record<TextField, "name" | "short_description" | "description"> = {
  name: "name", shortDescription: "short_description", description: "description",
};

export interface FabricForm {
  slug: string;
  sku: string;
  categoryId: string;
  name: L3;
  shortDescription: L3;
  description: L3;
  construction: string;
  structure: string;
  composition: { fiber: string; pct: string }[];
  gsm: string;
  widthCm: string;
  stretch: string;
  stretchPct: string;
  finish: string;
  uses: string[];
  seasons: string[];
  tags: string;
  moqM: string;
  basePrice: string;
  tiers: { minM: string; price: string }[];
  organic: boolean;
  recycledPct: string;
  certifications: string;
  isActive: boolean;
  isFeatured: boolean;
  feel: { softness: string; drape: string; stretch: string; sheen: string; breathability: string };
}

const blank = (): L3 => ({ fr: "", en: "", ar: "" });
export const emptyFabric = (): FabricForm => ({
  slug: "", sku: "", categoryId: "", name: blank(), shortDescription: blank(), description: blank(),
  construction: "knit", structure: "jersey", composition: [{ fiber: "cotton", pct: "100" }], gsm: "", widthCm: "150",
  stretch: "none", stretchPct: "", finish: "", uses: [], seasons: ["all_season"], tags: "", moqM: "5", basePrice: "",
  tiers: [], organic: false, recycledPct: "", certifications: "", isActive: false, isFeatured: false,
  feel: { softness: "", drape: "", stretch: "", sheen: "", breathability: "" },
});

export function slugify(text: string): string {
  return text
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v.replace(",", ".")));
export const list = (v: string) => v.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);

export const compositionTotal = (c: FabricForm["composition"]) => Math.round(c.reduce((s, r) => s + (num(r.pct) || 0), 0) * 100) / 100;

export type FabricErrors = Partial<Record<
  "slug" | "sku" | "categoryId" | "name" | "gsm" | "widthCm" | "stretchPct" | "moqM" | "basePrice" | "composition" | "tiers" | "recycledPct" | "feel",
  "required" | "invalid" | "range" | "slug" | "sum100" | "duplicate" | "fiber"
>>;

/** Mirrors the table's CHECK constraints so the form says what is wrong before the database does. */
export function validateFabric(f: FabricForm): FabricErrors {
  const e: FabricErrors = {};
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.slug)) e.slug = f.slug ? "slug" : "required";
  if (!f.sku.trim()) e.sku = "required";
  if (!f.categoryId) e.categoryId = "required";
  if (!f.name.fr.trim()) e.name = "required";

  const inRange = (v: string, min: number, max: number) => (Number.isFinite(num(v)) ? (num(v) >= min && num(v) <= max ? null : "range") : v.trim() === "" ? "required" : "invalid");
  const gsm = inRange(f.gsm, 20, 1200); if (gsm) e.gsm = gsm;
  const width = inRange(f.widthCm, 50, 340); if (width) e.widthCm = width;
  if (f.stretchPct.trim() !== "") { const s = inRange(f.stretchPct, 0, 400); if (s) e.stretchPct = s; }
  if (!(num(f.moqM) > 0)) e.moqM = f.moqM.trim() === "" ? "required" : "invalid";
  if (!(num(f.basePrice) >= 0)) e.basePrice = f.basePrice.trim() === "" ? "required" : "invalid";
  if (f.recycledPct.trim() !== "") { const r = inRange(f.recycledPct, 0, 100); if (r) e.recycledPct = r; }

  if (f.composition.length === 0 || f.composition.some((r) => !r.fiber || !(num(r.pct) > 0))) e.composition = "invalid";
  else if (new Set(f.composition.map((r) => r.fiber)).size !== f.composition.length) e.composition = "duplicate";
  else if (compositionTotal(f.composition) !== 100) e.composition = "sum100";

  const mins = f.tiers.map((t) => num(t.minM));
  if (f.tiers.some((t) => !(num(t.minM) > 0) || !(num(t.price) >= 0))) e.tiers = "invalid";
  else if (new Set(mins).size !== mins.length) e.tiers = "duplicate";

  const feelValues = Object.values(f.feel).filter((v) => v.trim() !== "");
  if (feelValues.some((v) => !(num(v) >= 0 && num(v) <= 10))) e.feel = "range";
  return e;
}
export const hasErrors = (e: FabricErrors) => Object.keys(e).length > 0;

/** An i18n object with only the filled languages (the database requires "fr"). */
export function i18nObject(v: L3): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const l of LOCALES) if (v[l].trim()) out[l] = v[l].trim();
  return Object.keys(out).length > 0 ? out : null;
}

/** The row to insert or update in `fabrics`. Call validateFabric first. */
export function toFabricRow(f: FabricForm) {
  const eco: Record<string, unknown> = {};
  if (f.organic) eco.organic = true;
  if (f.recycledPct.trim() !== "") eco.recycled_pct = num(f.recycledPct);
  const certifications = list(f.certifications);
  if (certifications.length > 0) eco.certifications = certifications;
  return {
    slug: f.slug, sku: f.sku.trim(), category_id: f.categoryId,
    name: i18nObject(f.name), short_description: i18nObject(f.shortDescription), description: i18nObject(f.description),
    construction: f.construction, structure: f.structure,
    composition: f.composition.map((r) => ({ fiber: r.fiber, pct: num(r.pct) })),
    gsm: Math.round(num(f.gsm)), width_cm: Math.round(num(f.widthCm)), stretch: f.stretch,
    stretch_pct: f.stretchPct.trim() === "" ? null : Math.round(num(f.stretchPct)),
    finish: list(f.finish), uses: f.uses, seasons: f.seasons.length > 0 ? f.seasons : ["all_season"], tags: list(f.tags),
    moq_m: num(f.moqM), base_price_per_m: num(f.basePrice), eco, is_active: f.isActive, is_featured: f.isFeatured,
  };
}

export function toTierRows(f: FabricForm) {
  return f.tiers.map((t) => ({ min_m: num(t.minM), price_per_m: num(t.price) })).sort((a, b) => a.min_m - b.min_m);
}

export function toFeelRow(f: FabricForm) {
  const v = (s: string) => (s.trim() === "" ? null : num(s));
  return { softness: v(f.feel.softness), drape: v(f.feel.drape), stretch: v(f.feel.stretch), sheen: v(f.feel.sheen), breathability: v(f.feel.breathability) };
}
export const hasFeel = (f: FabricForm) => Object.values(f.feel).some((v) => v.trim() !== "");

// ------------------------------------------------------------------ database row -> form
type Json = Record<string, string> | null | undefined;
const l3 = (j: Json): L3 => ({ fr: j?.fr ?? "", en: j?.en ?? "", ar: j?.ar ?? "" });
const str = (n: number | string | null | undefined) => (n === null || n === undefined ? "" : String(n));

export interface FabricRowIn {
  slug: string; sku: string; category_id: string; name: Json; short_description: Json; description: Json;
  construction: string; structure: string; composition: { fiber: string; pct: number }[]; gsm: number; width_cm: number;
  stretch: string; stretch_pct: number | null; finish: string[]; uses: string[]; seasons: string[]; tags: string[];
  moq_m: number | string; base_price_per_m: number | string; eco: { organic?: boolean; recycled_pct?: number; certifications?: string[] } | null;
  is_active: boolean; is_featured: boolean;
}
export function fromFabricRow(
  r: FabricRowIn,
  tiers: { min_m: number | string; price_per_m: number | string }[] = [],
  feel: Partial<Record<keyof FabricForm["feel"], number | null>> | null = null,
): FabricForm {
  return {
    slug: r.slug, sku: r.sku, categoryId: r.category_id, name: l3(r.name), shortDescription: l3(r.short_description), description: l3(r.description),
    construction: r.construction, structure: r.structure, composition: r.composition.map((c) => ({ fiber: c.fiber, pct: String(c.pct) })),
    gsm: str(r.gsm), widthCm: str(r.width_cm), stretch: r.stretch, stretchPct: str(r.stretch_pct), finish: r.finish.join(", "),
    uses: r.uses, seasons: r.seasons, tags: r.tags.join(", "), moqM: str(r.moq_m), basePrice: str(r.base_price_per_m),
    tiers: tiers.map((t) => ({ minM: str(t.min_m), price: str(t.price_per_m) })),
    organic: !!r.eco?.organic, recycledPct: str(r.eco?.recycled_pct), certifications: (r.eco?.certifications ?? []).join(", "),
    isActive: r.is_active, isFeatured: r.is_featured,
    feel: { softness: str(feel?.softness), drape: str(feel?.drape), stretch: str(feel?.stretch), sheen: str(feel?.sheen), breathability: str(feel?.breathability) },
  };
}

// ------------------------------------------------------------------ machine translation bookkeeping
export type MachineTranslated = Partial<Record<"name" | "short_description" | "description", string[]>>;

/**
 * `machine_translated` lists the languages of each text that a machine wrote and nobody has read. When a person edits a
 * text in a language, that language is no longer "machine translated".
 */
export function afterHumanEdit(current: MachineTranslated | null | undefined, before: FabricForm, after: FabricForm): MachineTranslated {
  const out: MachineTranslated = {};
  for (const field of TEXT_FIELDS) {
    const column = TEXT_COLUMN[field];
    const kept = (current?.[column] ?? []).filter((l) => !(LOCALES as readonly string[]).includes(l) || before[field][l as FormLocale] === after[field][l as FormLocale]);
    if (kept.length > 0) out[column] = kept;
  }
  return out;
}

/** Languages (en, ar) for which some text is still missing: what "auto-translate" would fill in. */
export function missingTranslations(f: FabricForm): ("en" | "ar")[] {
  return (["en", "ar"] as const).filter((l) => TEXT_FIELDS.some((t) => f[t].fr.trim() !== "" && f[t][l].trim() === ""));
}
