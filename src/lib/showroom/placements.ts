/** What stands inside each department of the 3D showroom (docs/07-showroom-3d.md): pure, from the layout and the live stock. */
import type { Layout } from "@/lib/admin/departments";
import spec from "./spec.json";
import { MAX_ROLLS, rollsFor, type ShowroomDepartment } from "./model";

/** One object of the prop library (public/showroom/props.glb) standing in a department. Coordinates are local: origin = the middle of the zone, x right, z away from the visitor. */
export interface Placement {
  prop: string;
  x: number;
  z: number;
  /** Height of the object's base above the floor (a roll on a shelf, a pillow on a sofa...). */
  y?: number;
  /** Rotation about the vertical axis in radians. Props face +z; `Math.PI` makes them face the visitor. */
  ry?: number;
  s?: number | [number, number, number];
  color?: string;
}
export interface Placements { props: Placement[]; rolls: Placement[]; bays: number; slots: number }

const RACK = spec.rack;
const PERMUTE_SEED = 0x9e3779b9;
/** A stable pseudo-random number per slot: the same slots fill first however many rolls there are, so more stock only adds rolls. */
export function slotHash(n: number): number {
  let x = Math.imul(n ^ PERMUTE_SEED, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** How many rack bays fit in a zone of this size, in rows of `perRow`. */
export function rackGrid(l: Layout): { perRow: number; rows: number; pitch: number; rowPitch: number; capacity: number } {
  const perRow = Math.max(1, Math.floor((l.w - 0.4) / (RACK.bayW + 0.1)));
  const rowPitch = RACK.bayD + 1.7; // a rack plus an aisle
  const rows = Math.max(1, Math.floor((l.d - 0.6) / rowPitch));
  return { perRow, rows, pitch: (l.w - 0.4) / perRow, rowPitch, capacity: perRow * rows };
}

export const SLOTS_PER_BAY = RACK.levels.length * RACK.roll.xs.length * RACK.roll.zs.length;

/** The number of rolls drawn for `totalM` metres of stock, as a share of all the slots (1 roll per 100 m up to MAX_ROLLS is a full rack). */
export function filledSlots(totalM: number, slots: number): number {
  const rolls = rollsFor(totalM);
  return rolls === 0 ? 0 : Math.min(slots, Math.ceil((slots * rolls) / MAX_ROLLS));
}

function hall(l: Layout, totalM: number, colors: string[]): Placements {
  const g = rackGrid(l);
  const bays = Math.min(Math.max(1, l.racks), g.capacity);
  const sx = Math.min(1, (g.pitch - 0.1) / RACK.bayW);
  const props: Placement[] = [];
  const slotsAt: { x: number; y: number; z: number }[] = [];
  const rowsUsed = Math.ceil(bays / g.perRow);
  for (let b = 0; b < bays; b++) {
    const row = Math.floor(b / g.perRow);
    const inRow = Math.min(g.perRow, bays - row * g.perRow);
    const col = b % g.perRow;
    const x = (col - (inRow - 1) / 2) * g.pitch;
    const z = (row - (rowsUsed - 1) / 2) * g.rowPitch;
    props.push({ prop: "rack_bay", x, z, s: [sx, 1, 1] });
    for (const level of RACK.levels) for (const rx of RACK.roll.xs) for (const rz of RACK.roll.zs) slotsAt.push({ x: x + rx * sx, y: level + 0.02, z: z + rz });
  }
  const filled = filledSlots(totalM, slotsAt.length);
  const order = slotsAt.map((_, i) => i).sort((a, b) => slotHash(a) - slotHash(b)).slice(0, filled);
  const palette = colors.length > 0 ? colors : ["#B8C2CC"];
  const rolls = order.map((i, k) => ({ prop: "fabric_roll", ...slotsAt[i]!, color: palette[k % palette.length]! }));

  // the room around the racks: a pallet and a hand truck, when there is space for them
  const usedDepth = (rowsUsed - 1) * g.rowPitch + RACK.bayD;
  if (l.d - usedDepth >= 2.4) {
    props.push({ prop: "pallet_load", x: l.w / 2 - 1.1, z: l.d / 2 - 0.8, ry: 0.15 }, { prop: "hand_truck", x: -l.w / 2 + 0.8, z: -(l.d / 2 - 0.7), ry: Math.PI * 0.8 });
  }
  return { props, rolls, bays, slots: slotsAt.length };
}

const crates = (x: number, z: number): Placement[] => [
  { prop: "crate", x, z, s: 1.3 }, { prop: "crate", x: x + 0.5, z: z + 0.05, s: 1.3, ry: 0.2 }, { prop: "crate", x: x + 0.2, z: z + 0.02, y: 0.34, s: 1.3, ry: -0.1 },
];

function others(dep: ShowroomDepartment): Placement[] {
  const l = dep.layout;
  switch (dep.kind) {
    case "cutting":
      return [
        { prop: "cutting_table", x: 0, z: -l.d / 4, s: Math.min(1, (l.w - 0.8) / 4) }, { prop: "cutting_table", x: 0, z: l.d / 4, s: Math.min(1, (l.w - 0.8) / 4) },
        { prop: "hand_truck", x: -l.w / 2 + 0.7, z: l.d / 2 - 0.7, ry: Math.PI * 0.9 }, ...crates(l.w / 2 - 1.2, l.d / 2 - 0.8),
        { prop: "box", x: -l.w / 2 + 0.8, z: -l.d / 2 + 0.7, s: 1.2 },
      ];
    case "shipping":
      return [
        { prop: "pallet_load", x: -1.3, z: -l.d / 4, ry: 0.1 }, { prop: "pallet_load", x: 0.9, z: -l.d / 4 + 0.1, ry: -0.08 }, { prop: "pallet_load", x: -1.2, z: -l.d / 4 + 1.4, ry: 0.05 },
        { prop: "forklift", x: 0.6, z: l.d / 4 + 0.6, ry: Math.PI * 0.92 }, { prop: "hand_truck", x: l.w / 2 - 0.7, z: -l.d / 2 + 0.8, ry: Math.PI },
        ...crates(-l.w / 2 + 0.9, l.d / 2 - 0.9),
      ];
    case "studio":
      return [
        { prop: "cutting_table", x: -l.w / 4, z: -0.6, s: 0.85 }, { prop: "cutting_table", x: l.w / 4, z: -0.6, s: 0.85 },
        { prop: "mannequin", x: -l.w / 4 - 1, z: l.d / 2 - 1.1, ry: Math.PI }, { prop: "mannequin", x: -l.w / 4 + 0.4, z: l.d / 2 - 1.1, ry: Math.PI }, { prop: "mannequin", x: l.w / 4 + 0.6, z: l.d / 2 - 1.1, ry: Math.PI },
        { prop: "rack_bay", x: l.w / 2 - 1.8, z: l.d / 2 - 0.9, s: [0.9, 1, 1] }, { prop: "plant_wide", x: -l.w / 2 + 0.8, z: l.d / 2 - 0.8, s: 1.2 },
      ];
    case "client_suite": {
      const lx = Math.min(2.8, l.w / 2 - 2);
      return [
        { prop: "sofa", x: lx, z: 1.8, ry: Math.PI, s: 1.15 }, { prop: "coffee_table", x: lx, z: 0.1, ry: Math.PI / 2, s: 1.1 },
        { prop: "armchair", x: lx - 1.9, z: 0.1, ry: Math.PI / 2 }, { prop: "armchair", x: lx + 1.9, z: 0.1, ry: -Math.PI / 2 },
        { prop: "pillows", x: lx - 0.2, z: 1.85, y: 0.38, s: 0.6, ry: Math.PI },
        { prop: "meeting_table", x: -lx, z: 0 },
        ...[-0.8, 0, 0.8].flatMap((dx): Placement[] => [{ prop: "chair", x: -lx + dx, z: -1.05, ry: 0 }, { prop: "chair", x: -lx + dx, z: 1.05, ry: Math.PI }]),
        { prop: "screen", x: -lx, z: l.d / 2 - 0.5, ry: Math.PI }, { prop: "plant_tall", x: l.w / 2 - 0.7, z: l.d / 2 - 0.7 },
      ];
    }
    case "office":
      return [
        ...[-l.w / 4, l.w / 4].flatMap((x): Placement[] => [
          { prop: "desk", x, z: -1.5 }, { prop: "chair", x, z: -2.3, ry: 0 }, { prop: "desk", x, z: 1.3 }, { prop: "chair", x, z: 0.5, ry: 0 },
        ]),
        { prop: "cabinet", x: 0, z: l.d / 2 - 0.4, ry: Math.PI, s: 0.9 }, { prop: "plant_tall", x: -l.w / 2 + 0.6, z: l.d / 2 - 0.8 }, { prop: "desk_lamp", x: -l.w / 4 + 0.5, y: 0.76, z: 1.55, ry: Math.PI },
      ];
    default:
      return [];
  }
}

/** Everything standing in a department. `stock` is only used by fabric halls (their racks fill up with the fabrics' colors). */
export function departmentPlacements(dep: ShowroomDepartment, stock: { totalM: number; topColors: string[] } | null): Placements {
  if (dep.kind === "fabric_hall") return hall(dep.layout, stock?.totalM ?? 0, stock?.topColors ?? []);
  return { props: others(dep), rolls: [], bays: 0, slots: 0 };
}
