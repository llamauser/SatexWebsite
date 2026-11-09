/** Showroom department layouts (docs/07-showroom-3d.md §3): validation and the geometry of the 2D preview. */
export const FLOOR_W = 40; // metres, x axis
export const FLOOR_D = 24; // metres, z axis
export const KINDS = ["fabric_hall", "cutting", "shipping", "studio", "client_suite", "office"] as const;
export type DepartmentKind = (typeof KINDS)[number];

export interface Layout {
  x: number; z: number; w: number; d: number; rotation: number; racks: number; color: string;
}

export interface DepartmentRow {
  id: string;
  slug: string;
  name: Record<string, string>;
  floor: 0 | 1;
  kind: DepartmentKind;
  layout: Layout;
  category_ids: string[];
  sort: number;
}

export type LayoutIssue = "number" | "size" | "outside" | "hex" | "racks" | "rotation";

/** Returns the first problem found, or null. `layout` comes from a form (strings) or from the database. */
export function checkLayout(l: Record<keyof Layout, unknown>): LayoutIssue | null {
  const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : Number.NaN);
  const x = n(l.x), z = n(l.z), w = n(l.w), d = n(l.d), rotation = n(l.rotation), racks = n(l.racks);
  if (![x, z, w, d, rotation, racks].every(Number.isFinite)) return "number";
  if (w < 1 || d < 1 || w > FLOOR_W || d > FLOOR_D) return "size";
  if (x < 0 || z < 0 || x + w > FLOOR_W || z + d > FLOOR_D) return "outside";
  if (!Number.isInteger(racks) || racks < 0 || racks > 20) return "racks";
  if (![0, 90, 180, 270].includes(rotation)) return "rotation";
  if (typeof l.color !== "string" || !/^#[0-9a-f]{6}$/i.test(l.color)) return "hex";
  return null;
}

export function toLayout(raw: Record<keyof Layout, string | number>): Layout {
  const n = (v: string | number) => (typeof v === "number" ? v : Number(v.replace(",", ".")));
  return { x: n(raw.x), z: n(raw.z), w: n(raw.w), d: n(raw.d), rotation: n(raw.rotation), racks: Math.round(n(raw.racks)), color: String(raw.color).toUpperCase() };
}

/** Do two departments of the same floor overlap? (touching edges is fine) */
export function overlaps(a: Layout, b: Layout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
}

/** Slugs of the departments on `floor` that overlap `target` (a warning in the editor, not an error). */
export function overlapping(target: { slug: string; floor: number; layout: Layout }, all: { slug: string; floor: number; layout: Layout }[]): string[] {
  return all.filter((o) => o.slug !== target.slug && o.floor === target.floor && overlaps(target.layout, o.layout)).map((o) => o.slug);
}

/** Pixel rectangle of a department in an SVG preview of `width` px (the floor keeps its proportions). */
export function previewRect(l: Layout, width: number) {
  const k = width / FLOOR_W;
  return { x: l.x * k, y: l.z * k, w: l.w * k, h: l.d * k };
}
export const previewHeight = (width: number) => (width * FLOOR_D) / FLOOR_W;
