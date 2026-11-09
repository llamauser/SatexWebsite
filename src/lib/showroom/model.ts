/** The showroom (docs/07-showroom-3d.md): shapes and rules shared by the server, the 3D scene and the 2D plan. Pure. */
import type { I18nField } from "@/lib/data/format";
import { FLOOR_D, FLOOR_W, type Layout } from "@/lib/admin/departments";

export { FLOOR_D, FLOOR_W };
export const FLOOR_HEIGHT = 4; // metres between the ground floor and the mezzanine

export interface ShowroomFabric {
  slug: string;
  name: I18nField;
  gsm: number;
  /** Colors with their ids, so live stock can be recomputed in the browser. */
  colors: { id: string; hex: string }[];
}
export interface ShowroomDepartment {
  id: string;
  slug: string;
  name: I18nField;
  floor: 0 | 1;
  kind: "fabric_hall" | "cutting" | "shipping" | "studio" | "client_suite" | "office";
  layout: Layout;
  categorySlugs: string[];
  fabrics: ShowroomFabric[];
}
export interface ShowroomStats { cuttingToday: number; cuttingQueue: number; shippedWeek: number }
export interface ShowroomData { departments: ShowroomDepartment[]; availability: Record<string, number>; stats: ShowroomStats }

// ------------------------------------------------------------------ stock -> what is drawn
/** One roll per 100 m of stock, at most 12 per department (docs/07 §4). */
export const MAX_ROLLS = 12;
export const rollsFor = (availableM: number) => Math.max(0, Math.min(MAX_ROLLS, Math.floor(availableM / 100)));

export interface FabricStock { slug: string; name: I18nField; gsm: number; availableM: number; dots: string[]; colorCount: number }

/** Live figures of one department: its fabrics with the meters available now, the biggest stock first. */
export function departmentStock(dep: ShowroomDepartment, availability: Record<string, number>): { totalM: number; fabrics: FabricStock[]; topColors: string[] } {
  const fabrics = dep.fabrics
    .map((f) => {
      const sorted = [...f.colors].sort((a, b) => (availability[b.id] ?? 0) - (availability[a.id] ?? 0));
      return {
        slug: f.slug, name: f.name, gsm: f.gsm,
        availableM: Math.floor(f.colors.reduce((s, c) => s + (availability[c.id] ?? 0), 0)),
        dots: sorted.filter((c) => (availability[c.id] ?? 0) > 0).slice(0, 5).map((c) => c.hex),
        colorCount: f.colors.length,
      };
    })
    .sort((a, b) => b.availableM - a.availableM);
  const topColors: string[] = [];
  for (const f of fabrics) for (const hex of f.dots) if (!topColors.includes(hex) && topColors.length < 6) topColors.push(hex);
  return { totalM: fabrics.reduce((s, f) => s + f.availableM, 0), fabrics, topColors };
}

// ------------------------------------------------------------------ floors and views
export type FloorMode = "both" | 0 | 1;
export const isVisibleFloor = (mode: FloorMode, floor: number) => mode === "both" || mode === floor;

export type ViewChoice = "auto" | "3d" | "2d";
export interface Capabilities { webgl: boolean; deviceMemoryGb: number | null; reducedMotion: boolean }

/** Why the plan is shown instead of the 3D scene, or null when 3D can be used (docs/07 §5). */
export function fallbackReason(caps: Capabilities, choice: ViewChoice): "choice" | "webgl" | "memory" | "motion" | null {
  if (choice === "2d") return "choice";
  if (!caps.webgl) return "webgl";
  if (choice === "3d") return null; // the visitor asked for 3D explicitly
  if (caps.deviceMemoryGb !== null && caps.deviceMemoryGb < 4) return "memory";
  if (caps.reducedMotion) return "motion";
  return null;
}
export const parseViewChoice = (raw: string | null | undefined): ViewChoice => (raw === "2d" || raw === "3d" ? raw : "auto");

// ------------------------------------------------------------------ geometry
export const centerOf = (l: Layout) => ({ x: l.x + l.w / 2, z: l.z + l.d / 2 });
/** Height of the floor a department stands on. */
export const floorY = (floor: number) => (floor === 1 ? FLOOR_HEIGHT : 0);

/** Isometric camera: 45 degrees around, 35 degrees down, looking at the middle of the building. */
export const CAMERA = {
  target: [FLOOR_W / 2, 0, FLOOR_D / 2] as const,
  position: [FLOOR_W / 2 + 34.8, 34.4, FLOOR_D / 2 - 34.8] as const,
  yaw: Math.atan2(34.8, -34.8), // azimuth of the camera around the target
  pitch: Math.PI / 2 - (35 * Math.PI) / 180, // angle from the vertical axis
  yawRange: (25 * Math.PI) / 180,
};

/** Zoom (pixels per metre) that fits the whole building in a canvas of this width. */
export const baseZoom = (canvasWidth: number) => Math.max(6, Math.min(26, canvasWidth / 52));

/** Keeps the panned point inside the building (with a margin). */
export function clampTarget(x: number, z: number, margin = 4) {
  return { x: Math.min(FLOOR_W + margin, Math.max(-margin, x)), z: Math.min(FLOOR_D + margin, Math.max(-margin, z)) };
}

/** The departments a panel can say something specific about. */
export const isHall = (d: ShowroomDepartment) => d.kind === "fabric_hall";
export const panelKind = (d: ShowroomDepartment): "hall" | "counters" | "tour" | "info" =>
  d.kind === "fabric_hall" ? "hall" : d.kind === "cutting" || d.kind === "shipping" ? "counters" : d.kind === "client_suite" ? "tour" : "info";

// ------------------------------------------------------------------ rows from the database
interface DepartmentRow { id: string; slug: string; name: I18nField; floor: number; kind: string; layout: Layout; category_ids: string[] }
interface FabricRow { slug: string; name: I18nField; gsm: number; category_id: string; fabric_colors: { id: string; hex: string; sort: number; is_active: boolean }[] }

export function buildDepartments(rows: DepartmentRow[], categories: { id: string; slug: string }[], fabrics: FabricRow[]): ShowroomDepartment[] {
  const slugOf = new Map(categories.map((c) => [c.id, c.slug]));
  return rows.map((r) => {
    const ids = new Set(r.category_ids);
    return {
      id: r.id, slug: r.slug, name: r.name, floor: r.floor === 1 ? 1 : 0, kind: r.kind as ShowroomDepartment["kind"], layout: r.layout,
      categorySlugs: r.category_ids.flatMap((id) => (slugOf.has(id) ? [slugOf.get(id)!] : [])),
      fabrics: fabrics.filter((f) => ids.has(f.category_id)).map((f) => ({
        slug: f.slug, name: f.name, gsm: f.gsm,
        colors: f.fabric_colors.filter((c) => c.is_active).sort((a, b) => a.sort - b.sort).map((c) => ({ id: c.id, hex: c.hex })),
      })),
    };
  });
}
