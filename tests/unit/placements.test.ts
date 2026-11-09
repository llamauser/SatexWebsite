import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Layout } from "@/lib/admin/departments";
import type { ShowroomDepartment } from "@/lib/showroom/model";
import { departmentPlacements, filledSlots, rackGrid, SLOTS_PER_BAY, slotHash } from "@/lib/showroom/placements";
import spec from "@/lib/showroom/spec.json";

const layout = (l: Partial<Layout>): Layout => ({ x: 0, z: 0, w: 8, d: 6, rotation: 0, racks: 4, color: "#88AACC", ...l });
const dep = (kind: ShowroomDepartment["kind"], l: Partial<Layout> = {}, floor: 0 | 1 = 0): ShowroomDepartment => ({
  id: kind, slug: kind, name: { fr: kind, en: kind, ar: kind }, floor, kind, layout: layout(l), categorySlugs: [], fabrics: [],
});
const stock = (totalM: number, topColors = ["#112233", "#445566", "#778899"]) => ({ totalM, topColors });

/** The names of the props that public/showroom/props.glb really contains (the JSON chunk of the binary file). */
function propsInGlb(): string[] {
  const buf = readFileSync("public/showroom/props.glb");
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8")) as { nodes: { name?: string }[] };
  return json.nodes.flatMap((n) => (n.name?.startsWith("prop_") ? [n.name.slice(5)] : []));
}

describe("rack grid", () => {
  it("fits bays in rows according to the size of the hall", () => {
    expect(rackGrid(layout({ w: 8, d: 6 }))).toMatchObject({ perRow: 3, rows: 2, capacity: 6 });
    expect(rackGrid(layout({ w: 3, d: 2 }))).toMatchObject({ perRow: 1, rows: 1, capacity: 1 });
    expect(rackGrid(layout({ w: 14, d: 12 })).capacity).toBeGreaterThan(rackGrid(layout({ w: 8, d: 6 })).capacity);
  });
  it("never draws more bays than the layout asks for, nor than the hall holds", () => {
    expect(departmentPlacements(dep("fabric_hall", { racks: 2 }), stock(500)).bays).toBe(2);
    expect(departmentPlacements(dep("fabric_hall", { racks: 20 }), stock(500)).bays).toBe(6);
    expect(departmentPlacements(dep("fabric_hall", { racks: 0 }), stock(500)).bays).toBe(1);
  });
});

describe("fabric rolls follow the stock", () => {
  it("fills no slot without stock and every slot at 1,200 m or more", () => {
    const slots = 4 * SLOTS_PER_BAY;
    expect(filledSlots(0, slots)).toBe(0);
    expect(filledSlots(99, slots)).toBe(0);
    expect(filledSlots(100, slots)).toBeGreaterThan(0);
    expect(filledSlots(1200, slots)).toBe(slots);
    expect(filledSlots(50_000, slots)).toBe(slots);
  });
  it("only adds rolls when the stock grows: the rolls of a small stock are among those of a bigger one", () => {
    const d = dep("fabric_hall", { racks: 4 });
    const key = (r: { x: number; y?: number; z: number }) => `${r.x.toFixed(3)}|${(r.y ?? 0).toFixed(3)}|${r.z.toFixed(3)}`;
    let previous = new Set<string>();
    for (const m of [0, 100, 400, 800, 1200]) {
      const rolls = departmentPlacements(d, stock(m)).rolls;
      const now = new Set(rolls.map(key));
      expect([...previous].every((k) => now.has(k))).toBe(true);
      expect(rolls.length).toBeGreaterThanOrEqual(previous.size);
      previous = now;
    }
  });
  it("is the same every time (no flicker when the stock refreshes) and uses the colors in stock", () => {
    const d = dep("fabric_hall");
    const a = departmentPlacements(d, stock(600));
    expect(departmentPlacements(d, stock(600))).toEqual(a);
    expect(new Set(a.rolls.map((r) => r.color))).toEqual(new Set(["#112233", "#445566", "#778899"]));
    expect(departmentPlacements(d, stock(600, [])).rolls.every((r) => r.color === "#B8C2CC")).toBe(true);
  });
  it("puts every roll on a shelf of a bay, inside the hall", () => {
    const l = layout({ w: 8, d: 6, racks: 6 });
    const { rolls } = departmentPlacements(dep("fabric_hall", { racks: 6 }), stock(5000));
    expect(rolls.length).toBe(6 * SLOTS_PER_BAY);
    for (const r of rolls) {
      expect(Math.abs(r.x)).toBeLessThan(l.w / 2);
      expect(Math.abs(r.z)).toBeLessThan(l.d / 2);
      expect(spec.rack.levels.some((lv) => Math.abs((r.y ?? 0) - (lv + 0.02)) < 1e-9)).toBe(true);
    }
    expect(new Set(rolls.map((r) => `${r.x}|${r.y}|${r.z}`)).size).toBe(rolls.length); // no two rolls in the same slot
  });
  it("mixes slots well: the hash spreads over the whole range", () => {
    const values = Array.from({ length: 200 }, (_, i) => slotHash(i) % 1000);
    expect(Math.max(...values)).toBeGreaterThan(900);
    expect(Math.min(...values)).toBeLessThan(100);
    expect(new Set(values).size).toBeGreaterThan(150);
  });
});

describe("the other departments", () => {
  const cases: [ShowroomDepartment["kind"], Partial<Layout>, 0 | 1][] = [
    ["cutting", { w: 6, d: 8 }, 0], ["shipping", { w: 6, d: 8 }, 0], ["studio", { w: 14, d: 7 }, 1], ["client_suite", { w: 10, d: 7 }, 1], ["office", { w: 8, d: 7 }, 1],
  ];
  it.each(cases)("%s is furnished and everything stays inside its zone", (kind, l, floor) => {
    const placed = departmentPlacements(dep(kind, l, floor), null);
    expect(placed.props.length).toBeGreaterThan(3);
    expect(placed.rolls).toEqual([]);
    for (const p of placed.props) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(l.w! / 2);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(l.d! / 2);
    }
  });
  it("every prop used by any department exists in props.glb", () => {
    const available = new Set(propsInGlb());
    const used = new Set<string>();
    for (const [kind, l, floor] of cases) for (const p of departmentPlacements(dep(kind, l, floor), null).props) used.add(p.prop);
    for (const p of departmentPlacements(dep("fabric_hall", { racks: 6 }), stock(5000)).props) used.add(p.prop);
    used.add("fabric_roll");
    expect([...used].filter((n) => !available.has(n))).toEqual([]);
  });
});
