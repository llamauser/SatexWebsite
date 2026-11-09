import { describe, expect, it } from "vitest";
import {
  buildDepartments, CAMERA, baseZoom, centerOf, clampTarget, departmentStock, fallbackReason, FLOOR_D, FLOOR_W, floorY, isVisibleFloor, MAX_ROLLS, panelKind,
  parseViewChoice, rollsFor, type ShowroomDepartment,
} from "@/lib/showroom/model";

const layout = { x: 2, z: 2, w: 8, d: 6, rotation: 0, racks: 4, color: "#C9B497" };
const dep = (over: Partial<ShowroomDepartment> = {}): ShowroomDepartment => ({
  id: "d1", slug: "natural-fibers", name: { fr: "Fibres naturelles" }, floor: 0, kind: "fabric_hall", layout, categorySlugs: ["natural-fibers"],
  fabrics: [
    { slug: "linen", name: { fr: "Lin" }, gsm: 160, colors: [{ id: "c1", hex: "#D8C7A3" }, { id: "c2", hex: "#6B7A4B" }, { id: "c3", hex: "#111111" }] },
    { slug: "silk", name: { fr: "Soie" }, gsm: 90, colors: [{ id: "c4", hex: "#F5EFE0" }] },
  ], ...over,
});

describe("rolls drawn for the stock", () => {
  it("one roll per 100 m, none below 100 m, never more than 12", () => {
    expect([0, 99, 100, 250, 1199, 1200, 99_999].map(rollsFor)).toEqual([0, 0, 1, 2, 11, 12, MAX_ROLLS]);
    expect(rollsFor(-5)).toBe(0);
  });
});

describe("live stock of a department", () => {
  it("adds up the meters of every color, biggest stock first, whole meters", () => {
    const s = departmentStock(dep(), { c1: 120.9, c2: 30, c3: 0, c4: 400 });
    expect(s.totalM).toBe(120 + 30 + 400);
    expect(s.fabrics.map((f) => [f.slug, f.availableM])).toEqual([["silk", 400], ["linen", 150]]);
    expect(s.fabrics[1]!.dots).toEqual(["#D8C7A3", "#6B7A4B"]); // colors with stock only, the biggest first
    expect(s.fabrics[1]!.colorCount).toBe(3);
  });
  it("the rack colors are the colors that are really in stock", () => {
    expect(departmentStock(dep(), { c1: 5, c4: 400 }).topColors).toEqual(["#F5EFE0", "#D8C7A3"]);
    expect(departmentStock(dep(), {}).topColors).toEqual([]);
    expect(departmentStock(dep(), {}).totalM).toBe(0);
  });
});

describe("which view is used", () => {
  const ok = { webgl: true, deviceMemoryGb: 8, reducedMotion: false };
  it("3D when the device can, 2D when it cannot or when asked", () => {
    expect(fallbackReason(ok, "auto")).toBeNull();
    expect(fallbackReason({ ...ok, webgl: false }, "auto")).toBe("webgl");
    expect(fallbackReason({ ...ok, webgl: false }, "3d")).toBe("webgl"); // nothing can be done without WebGL
    expect(fallbackReason({ ...ok, deviceMemoryGb: 2 }, "auto")).toBe("memory");
    expect(fallbackReason({ ...ok, reducedMotion: true }, "auto")).toBe("motion");
    expect(fallbackReason(ok, "2d")).toBe("choice");
  });
  it("a visitor who explicitly asks for 3D gets it on a small or calm device", () => {
    expect(fallbackReason({ ...ok, deviceMemoryGb: 2, reducedMotion: true }, "3d")).toBeNull();
    expect(fallbackReason({ ...ok, deviceMemoryGb: null }, "auto")).toBeNull(); // unknown memory: assume fine
  });
  it("reads the stored choice safely", () => {
    expect([parseViewChoice("2d"), parseViewChoice("3d"), parseViewChoice("x"), parseViewChoice(null), parseViewChoice(undefined)]).toEqual(["2d", "3d", "auto", "auto", "auto"]);
  });
});

describe("floors", () => {
  it("both shows everything, a floor shows only itself", () => {
    expect([isVisibleFloor("both", 0), isVisibleFloor("both", 1), isVisibleFloor(0, 0), isVisibleFloor(0, 1), isVisibleFloor(1, 0), isVisibleFloor(1, 1)]).toEqual([true, true, true, false, false, true]);
    expect([floorY(0), floorY(1)]).toEqual([0, 4]);
  });
});

describe("camera and panning", () => {
  it("looks at the middle of the building from the isometric angle", () => {
    expect(CAMERA.target).toEqual([FLOOR_W / 2, 0, FLOOR_D / 2]);
    const [dx, dy, dz] = [CAMERA.position[0] - CAMERA.target[0], CAMERA.position[1], CAMERA.position[2] - CAMERA.target[2]];
    expect(Math.round((Math.atan2(dx, dz) * 180) / Math.PI)).toBe(135); // 45 degrees around
    expect(Math.round((Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI)).toBe(35); // 35 degrees down
    expect(CAMERA.yawRange).toBeCloseTo((25 * Math.PI) / 180, 6);
  });
  it("panning stays inside the building plus a margin", () => {
    expect(clampTarget(20, 12)).toEqual({ x: 20, z: 12 });
    expect(clampTarget(-50, 99)).toEqual({ x: -4, z: FLOOR_D + 4 });
    expect(clampTarget(80, -9, 2)).toEqual({ x: FLOOR_W + 2, z: -2 });
  });
  it("zoom fits the canvas width, within sane limits", () => {
    expect(baseZoom(1040)).toBe(20);
    expect(baseZoom(100)).toBe(6);
    expect(baseZoom(5000)).toBe(26);
  });
  it("the middle of a zone", () => {
    expect(centerOf(layout)).toEqual({ x: 6, z: 5 });
  });
});

describe("what a department panel shows", () => {
  it("halls show stock, cutting and shipping show counters, the client suite a call to action", () => {
    expect(["fabric_hall", "cutting", "shipping", "client_suite", "studio", "office"].map((kind) => panelKind(dep({ kind: kind as ShowroomDepartment["kind"] })))).toEqual(["hall", "counters", "counters", "tour", "info", "info"]);
  });
});

describe("departments from database rows", () => {
  it("links each department to the fabrics of its categories, and drops inactive colors", () => {
    const rows = [
      { id: "d1", slug: "natural-fibers", name: { fr: "N" }, floor: 0, kind: "fabric_hall", layout, category_ids: ["k1"] },
      { id: "d2", slug: "offices", name: { fr: "B" }, floor: 1, kind: "office", layout, category_ids: [] },
    ];
    const fabrics = [
      { slug: "linen", name: { fr: "Lin" }, gsm: 160, category_id: "k1", fabric_colors: [{ id: "a", hex: "#111111", sort: 2, is_active: true }, { id: "b", hex: "#222222", sort: 1, is_active: true }, { id: "c", hex: "#333333", sort: 0, is_active: false }] },
      { slug: "denim", name: { fr: "D" }, gsm: 400, category_id: "k2", fabric_colors: [] },
    ];
    const out = buildDepartments(rows, [{ id: "k1", slug: "natural-fibers" }, { id: "k2", slug: "denim" }], fabrics);
    expect(out.map((d) => [d.slug, d.floor, d.categorySlugs, d.fabrics.map((f) => f.slug)])).toEqual([["natural-fibers", 0, ["natural-fibers"], ["linen"]], ["offices", 1, [], []]]);
    expect(out[0]!.fabrics[0]!.colors.map((c) => c.id)).toEqual(["b", "a"]);
  });
});
