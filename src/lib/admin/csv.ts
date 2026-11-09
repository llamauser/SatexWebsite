/**
 * CSV import of fabrics (docs/12-seed-data.md §6). Pure: parsing and checking only; the page does the saving.
 *
 * Columns: sku, name_fr, name_en, name_ar, category (slug), construction, structure, composition ("cotton:92|elastane:8"),
 * gsm, width_cm, stretch, stretch_pct, finish, uses, seasons, tags (lists separated by |), moq_m, base_price_per_m,
 * is_active, colors ("code:name_fr:#hex|code2:name_fr:#hex"), price_tiers ("50:9.5|100:9"). A fabric that already exists
 * (same SKU) is updated, otherwise created.
 */
import { CONSTRUCTIONS, FIBERS, SEASONS, STRETCHES, STRUCTURES, USES } from "@/lib/catalog/params";
import { slugify } from "./fabric-form";

export const CSV_COLUMNS = [
  "sku", "name_fr", "name_en", "name_ar", "category", "construction", "structure", "composition", "gsm", "width_cm", "stretch",
  "stretch_pct", "finish", "uses", "seasons", "tags", "moq_m", "base_price_per_m", "is_active", "colors", "price_tiers",
] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];

export const TEMPLATE_CSV = `${CSV_COLUMNS.join(",")}\nDEMO-001,Jersey exemple,Example jersey,جيرسي مثال,knits,knit,jersey,cotton:100,180,160,none,,,t_shirts|dresses,all_season,basics,5,8.9,false,NAT:Naturel:#EDE6D6|BLK:Noir:#111111,50:8.5|200:8\n`;

// ------------------------------------------------------------------ parsing
/** RFC-4180 style: quoted fields, doubled quotes, commas or semicolons, CRLF, optional BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

// ------------------------------------------------------------------ checking
export type CsvIssue = "required" | "number" | "range" | "enum" | "category" | "composition" | "sum100" | "hex" | "colors" | "tiers" | "duplicateSku" | "columns" | "boolean";
export interface CsvError { line: number; field: string; issue: CsvIssue; value?: string }

export interface ImportColor { code: string; name: string; hex: string }
export interface ImportRow {
  line: number;
  action: "create" | "update";
  sku: string;
  slug: string;
  name: Record<string, string>;
  categoryId: string;
  fabric: {
    construction: string; structure: string; composition: { fiber: string; pct: number }[]; gsm: number; width_cm: number;
    stretch: string; stretch_pct: number | null; finish: string[]; uses: string[]; seasons: string[]; tags: string[];
    moq_m: number; base_price_per_m: number; is_active: boolean;
  };
  colors: ImportColor[];
  tiers: { min_m: number; price_per_m: number }[];
}
export interface CsvPlan { total: number; rows: ImportRow[]; errors: CsvError[] }

const pipe = (v: string) => v.split("|").map((x) => x.trim()).filter(Boolean);
const toNumber = (v: string) => (v.trim() === "" ? Number.NaN : Number(v.trim().replace(",", ".")));

export function checkCsv(text: string, ctx: { categories: Map<string, string>; existingSkus: Set<string> }): CsvPlan {
  const table = parseCsv(text);
  const errors: CsvError[] = [];
  const rows: ImportRow[] = [];
  if (table.length === 0) return { total: 0, rows, errors: [{ line: 1, field: "file", issue: "columns" }] };

  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const missing = CSV_COLUMNS.filter((c) => !header.includes(c) && !["name_en", "name_ar", "stretch_pct", "finish", "uses", "seasons", "tags", "colors", "price_tiers", "is_active", "stretch"].includes(c));
  if (missing.length > 0) return { total: 0, rows, errors: missing.map((m) => ({ line: 1, field: m, issue: "columns" as const })) };
  const at = (cells: string[], col: CsvColumn) => {
    const i = header.indexOf(col);
    return i === -1 ? "" : (cells[i] ?? "").trim();
  };

  const seen = new Map<string, number>();
  for (const [index, cells] of table.slice(1).entries()) {
    const line = index + 2;
    const before = errors.length;
    const bad = (field: string, issue: CsvIssue, value?: string) => errors.push({ line, field, issue, value });
    const required = (col: CsvColumn) => { const v = at(cells, col); if (v === "") bad(col, "required"); return v; };
    const choice = <T extends string>(col: CsvColumn, allowed: readonly T[], fallback?: T): T => {
      const v = at(cells, col) || fallback || "";
      if (!v) { bad(col, "required"); return allowed[0]!; }
      if (!(allowed as readonly string[]).includes(v)) { bad(col, "enum", v); return allowed[0]!; }
      return v as T;
    };
    const number = (col: CsvColumn, min: number, max: number, integer = false) => {
      const raw = at(cells, col);
      const n = toNumber(raw);
      if (raw === "") { bad(col, "required"); return 0; }
      if (!Number.isFinite(n)) { bad(col, "number", raw); return 0; }
      if (n < min || n > max || (integer && !Number.isInteger(n))) { bad(col, "range", raw); return 0; }
      return n;
    };
    const flags = <T extends string>(col: CsvColumn, allowed: readonly T[]) => {
      const out = pipe(at(cells, col));
      for (const v of out) if (!(allowed as readonly string[]).includes(v)) bad(col, "enum", v);
      return out;
    };

    const sku = required("sku");
    if (sku) {
      if (seen.has(sku.toLowerCase())) bad("sku", "duplicateSku", sku);
      seen.set(sku.toLowerCase(), line);
    }
    const nameFr = required("name_fr");
    const categorySlug = required("category");
    const categoryId = ctx.categories.get(categorySlug);
    if (categorySlug && !categoryId) bad("category", "category", categorySlug);

    const construction = choice("construction", CONSTRUCTIONS);
    const structure = choice("structure", STRUCTURES);
    const stretch = choice("stretch", STRETCHES, "none");

    // composition: fiber:pct|fiber:pct (must be known fibers, sum 100)
    const composition: { fiber: string; pct: number }[] = [];
    const compositionRaw = required("composition");
    for (const part of pipe(compositionRaw)) {
      const [fiber = "", pct = ""] = part.split(":").map((s) => s.trim());
      const n = toNumber(pct);
      if (!(FIBERS as readonly string[]).includes(fiber) || !(n > 0)) bad("composition", "composition", part);
      else composition.push({ fiber, pct: n });
    }
    if (compositionRaw && composition.length > 0 && Math.round(composition.reduce((s, c) => s + c.pct, 0) * 100) / 100 !== 100) bad("composition", "sum100", compositionRaw);

    const gsm = number("gsm", 20, 1200, true);
    const width = number("width_cm", 50, 340, true);
    const stretchPctRaw = at(cells, "stretch_pct");
    let stretchPct: number | null = null;
    if (stretchPctRaw !== "") {
      const n = toNumber(stretchPctRaw);
      if (!Number.isFinite(n)) bad("stretch_pct", "number", stretchPctRaw);
      else if (n < 0 || n > 400) bad("stretch_pct", "range", stretchPctRaw);
      else stretchPct = Math.round(n);
    }
    const moq = number("moq_m", 0.01, 100000);
    const price = number("base_price_per_m", 0, 1_000_000);

    const activeRaw = at(cells, "is_active").toLowerCase();
    if (activeRaw !== "" && !["true", "false", "1", "0", "yes", "no", "oui", "non"].includes(activeRaw)) bad("is_active", "boolean", activeRaw);

    const colors: ImportColor[] = [];
    for (const part of pipe(at(cells, "colors"))) {
      const [code = "", name = "", hex = ""] = part.split(":").map((s) => s.trim());
      if (!code || !name) bad("colors", "colors", part);
      else if (!/^#[0-9a-f]{6}$/i.test(hex)) bad("colors", "hex", part);
      else if (colors.some((c) => c.code === code)) bad("colors", "colors", part);
      else colors.push({ code, name, hex: hex.toUpperCase() });
    }
    const tiers: { min_m: number; price_per_m: number }[] = [];
    for (const part of pipe(at(cells, "price_tiers"))) {
      const [minM = "", p = ""] = part.split(":");
      const a = toNumber(minM), b = toNumber(p);
      if (!(a > 0) || !(b >= 0) || tiers.some((t) => t.min_m === a)) bad("price_tiers", "tiers", part);
      else tiers.push({ min_m: a, price_per_m: b });
    }

    const uses = flags("uses", USES);
    const seasons = flags("seasons", SEASONS);

    if (errors.length === before && categoryId) {
      rows.push({
        line, action: ctx.existingSkus.has(sku.toLowerCase()) ? "update" : "create", sku,
        slug: slugify(`${nameFr}-${sku}`),
        name: Object.fromEntries(([["fr", nameFr], ["en", at(cells, "name_en")], ["ar", at(cells, "name_ar")]] as const).filter(([, v]) => v !== "")),
        categoryId,
        fabric: {
          construction, structure, composition, gsm, width_cm: width, stretch, stretch_pct: stretchPct,
          finish: pipe(at(cells, "finish")), uses, seasons: seasons.length > 0 ? seasons : ["all_season"], tags: pipe(at(cells, "tags")),
          moq_m: moq, base_price_per_m: price, is_active: ["true", "1", "yes", "oui"].includes(activeRaw),
        },
        colors, tiers: tiers.sort((a, b) => a.min_m - b.min_m),
      });
    }
  }
  return { total: table.length - 1, rows, errors };
}
