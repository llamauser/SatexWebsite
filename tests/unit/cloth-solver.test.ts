import { describe, expect, it } from "vitest";
import type { FeelScores } from "@/lib/cloth/feel";
import { solverParams } from "@/lib/cloth/xpbd/calibrate";
import { CLOTH_SIZE, CpuClothSolver, HANG_HEIGHT, HANG_INSET, SPHERE, TABLE, type ClothMode } from "@/lib/cloth/xpbd/solver.cpu";
import { smoothGrid } from "@/lib/cloth/xpbd/surface";
import { weaveFor, weaveHeight, type WeaveKind } from "@/lib/cloth/xpbd/weave";

const N = 30;
const feel = (stretch: number, drape: number, sheen = 3): FeelScores => ({ softness: 5, drape, stretch, sheen, breathability: 5 });
/** Real fabrics of the catalog, from stiff to fluid: [feel scores, weight g/m2, stretch limit %]. */
const FABRICS = {
  denim: [feel(1.5, 2, 2), 380, 4],
  linen: [feel(0, 4), 160, 2],
  jersey: [feel(6, 7, 2), 180, 20],
  satin4way: [feel(8.5, 8, 8), 120, 35],
  chiffon: [feel(0, 10, 5), 40, 2],
} as const;
type Name = keyof typeof FABRICS;
const make = (name: Name, n = N) => {
  const [f, gsm, limit] = FABRICS[name];
  return new CpuClothSolver(n, solverParams(f, gsm, n, limit));
};
const run = (solver: CpuClothSolver, seconds: number) => { for (let i = 0; i < seconds * 60; i++) solver.step(1 / 60); return solver; };
const point = (solver: CpuClothSolver, row: number, col: number) => { const o = (row * solver.n + col) * 3; return [solver.positions[o]!, solver.positions[o + 1]!, solver.positions[o + 2]!] as const; };
const settled = (mode: ClothMode, name: Name, seconds = 3) => { const s = make(name); s.reset(mode); return run(s, seconds); };

/** Area of the shadow of the cloth on the floor relative to the cloth, minus the ball: the drape coefficient of a Cusick drape tester (stiff = near 1, fluid = low). */
function drapeCoefficient(solver: CpuClothSolver) {
  const pts: [number, number][] = [];
  for (let i = 0; i < solver.positions.length; i += 3) pts.push([solver.positions[i]!, solver.positions[i + 2]!]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop(); upper.push(p); }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let area = 0;
  for (let i = 0; i < hull.length; i++) { const [x1, y1] = hull[i]!, [x2, y2] = hull[(i + 1) % hull.length]!; area += x1 * y2 - x2 * y1; }
  const support = Math.PI * SPHERE.radius ** 2;
  return (Math.abs(area) / 2 - support) / (CLOTH_SIZE ** 2 - support);
}

describe("cloth solver: stability", () => {
  it.each(["denim", "satin4way", "chiffon"] as Name[])("%s stays finite, comes to rest and never goes through the floor in every mode", (name) => {
    for (const mode of ["hang", "table", "sphere"] as const) {
      const solver = settled(mode, name, 2.5);
      expect(Array.from(solver.positions).every(Number.isFinite)).toBe(true);
      expect(solver.motion).toBeLessThan(1e-5); // kinetic energy per particle, in joules: at rest
      expect(Math.min(...Array.from(solver.positions).filter((_, i) => i % 3 === 1))).toBeGreaterThanOrEqual(0);
    }
  }, 60_000);

  it("keeps the two pinned corners of a hanging swatch exactly where they were put", () => {
    const solver = run(make("jersey"), 2);
    // (the positions handed to the renderer are 32-bit floats)
    const near = (got: readonly number[], want: number[]) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 5));
    near(point(solver, 0, 0), [-CLOTH_SIZE / 2 + HANG_INSET, HANG_HEIGHT, 0]);
    near(point(solver, 0, N - 1), [CLOTH_SIZE / 2 - HANG_INSET, HANG_HEIGHT, 0]);
  });

  it("starts the same way every time (nothing random)", () => {
    const a = run(make("linen"), 1), b = run(make("linen"), 1);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });
});

describe("cloth solver: the fabric makes the difference", () => {
  it("a hanging swatch stretches by its own weight in proportion to the stretch of the fabric", () => {
    const strain = (name: Name) => run(make(name), 3).strainPct;
    const denim = strain("denim"), jersey = strain("jersey"), satin = strain("satin4way");
    expect(denim).toBeLessThan(5);
    expect(jersey).toBeGreaterThan(denim);
    expect(satin).toBeGreaterThan(jersey);
    expect(satin).toBeGreaterThan(8);
  }, 60_000);

  it("dropped on a ball, a stiff fabric stays spread out and a fluid one clings to it (drape coefficient)", () => {
    const dc = (name: Name) => drapeCoefficient(settled("sphere", name, 3));
    expect(dc("denim")).toBeGreaterThan(0.4);
    expect(dc("chiffon")).toBeLessThan(0.3);
    expect(dc("denim") - dc("chiffon")).toBeGreaterThan(0.2);
  }, 60_000);

  it("over the edge of a block, a stiff fabric sticks out and a fluid one hangs down", () => {
    const edgeHeight = (name: Name) => point(settled("table", name, 3), 0, N >> 1)[1];
    expect(edgeHeight("denim") - edgeHeight("chiffon")).toBeGreaterThan(0.02);
    expect(edgeHeight("chiffon")).toBeLessThan(TABLE.height - 0.04);
  }, 60_000);

  it("never goes into the ball or the block", () => {
    const ball = settled("sphere", "satin4way", 3);
    let deepest = 0;
    for (let i = 0; i < ball.positions.length; i += 3) deepest = Math.max(deepest, SPHERE.radius - Math.hypot(ball.positions[i]!, ball.positions[i + 1]! - SPHERE.radius, ball.positions[i + 2]!));
    expect(deepest).toBeLessThan(0.003);
    const block = settled("table", "jersey", 3);
    for (let i = 0; i < block.positions.length; i += 3) {
      const inside = Math.abs(block.positions[i]!) < TABLE.half - 0.004 && Math.abs(block.positions[i + 2]!) < TABLE.half - 0.004 && block.positions[i + 1]! < TABLE.height - 0.004;
      expect(inside).toBe(false);
    }
  }, 60_000);

  it("the wind blows a lighter fabric about more than a heavy one, and keeps the top edge on its rod", () => {
    const sway = (name: Name) => { const s = make(name); s.reset("wind"); run(s, 4); return Math.max(...Array.from(s.positions).filter((_, i) => i % 3 === 2).map(Math.abs)); };
    const light = sway("chiffon"), heavy = sway("denim");
    expect(light).toBeGreaterThan(0.05);
    expect(light).toBeGreaterThan(heavy);
    const s = make("linen"); s.reset("wind"); run(s, 2);
    for (let c = 0; c < N; c++) expect(point(s, 0, c)[1]).toBeCloseTo(HANG_HEIGHT, 5);
  }, 60_000);
});

/** Excursions beyond `tolerance` on alternating sides of the final value, and the time (s) after which the signal stays within it. */
function swings(signal: number[], tolerance: number) {
  const last = signal.at(-1)!;
  let side = 0, count = 0, settled = 0;
  signal.forEach((v, i) => {
    const d = v - last;
    if (Math.abs(d) <= tolerance) return;
    settled = i + 1;
    if (Math.sign(d) !== side) { if (side !== 0) count++; side = Math.sign(d); }
  });
  return { count, settled: settled / 60 };
}

describe("cloth solver: calm, not jiggly", () => {
  it.each(["denim", "jersey", "chiffon"] as Name[])("%s settles in a swing or two after being pulled and let go", (name) => {
    const s = run(make(name), 2);
    const mid = (N >> 1) * N + (N >> 1), o = mid * 3;
    const start = [s.positions[o]!, s.positions[o + 1]!, s.positions[o + 2]!] as const;
    s.grab(mid, [...start]);
    for (let i = 1; i <= 45; i++) { s.moveGrab([start[0] + (0.15 * i) / 45, start[1] - (0.05 * i) / 45, start[2] + (0.2 * i) / 45]); s.step(1 / 60); }
    s.release();
    const z: number[] = [];
    for (let i = 0; i < 300; i++) { s.step(1 / 60); z.push(s.positions[o + 2]!); }
    const { count, settled } = swings(z, 0.005);
    expect(count).toBeLessThanOrEqual(3);
    expect(settled).toBeLessThan(3);
  }, 60_000);

  it.each(["denim", "linen", "satin4way"] as Name[])("%s dropped on the block lands and stays (no bouncing)", (name) => {
    const s = make(name); s.reset("table");
    const y: number[] = [];
    for (let i = 0; i < 240; i++) { s.step(1 / 60); y.push(s.positions[(N * N - 1) * 3 + 1]!); }
    const { count, settled } = swings(y, 0.005);
    expect(count).toBeLessThanOrEqual(5);
    expect(settled).toBeLessThan(1.5);
  }, 60_000);

  it.each(["denim", "linen", "jersey", "chiffon"] as Name[])("%s stays on top of the ball and its sides fall down around it", (name) => {
    const s = settled("sphere", name, 4);
    let cx = 0, cz = 0, n = 0, top = 0;
    for (let i = 0; i < s.positions.length; i += 3) { cx += s.positions[i]!; cz += s.positions[i + 2]!; n++; top = Math.max(top, s.positions[i + 1]!); }
    expect(Math.hypot(cx / n, cz / n)).toBeLessThan(0.04); // it did not slide off
    expect(top).toBeLessThan(SPHERE.radius * 2 + 0.03); // lying on the ball, not held up in a tent
    for (const corner of [0, N - 1, N * (N - 1), N * N - 1]) expect(s.positions[corner * 3 + 1]).toBeLessThan(0.1); // the corners hang down to the floor around it
  }, 60_000);
});

describe("cloth solver: the hand", () => {
  it("follows the pointer, never stretches the fabric far beyond its limit, and lets go", () => {
    for (const [name, limit] of [["jersey", 20], ["satin4way", 35]] as const) {
      const s = run(make(name), 2);
      const mid = (N >> 1) * N + (N >> 1), o = mid * 3;
      const start = [s.positions[o]!, s.positions[o + 1]!, s.positions[o + 2]!] as const;
      s.grab(mid, [...start]);
      const target = [start[0] + 0.2, start[1] - 0.08, 0.2] as const;
      for (let i = 1; i <= 60; i++) { s.moveGrab([start[0] + ((target[0] - start[0]) * i) / 60, start[1] + ((target[1] - start[1]) * i) / 60, start[2] + ((target[2] - start[2]) * i) / 60]); s.step(1 / 60); }
      const before = Math.hypot(target[0] - start[0], target[1] - start[1], target[2] - start[2]);
      const gap = Math.hypot(s.positions[o]! - target[0], s.positions[o + 1]! - target[1], s.positions[o + 2]! - target[2]);
      expect(gap).toBeLessThan(before * 0.6); // it came along
      expect(s.strainPct).toBeLessThan(limit * 2); // the threads straighten out: no more rubber
      expect(Array.from(s.positions).every(Number.isFinite)).toBe(true);
      s.release();
      run(s, 2);
      expect(s.motion).toBeLessThan(1e-5);
      expect(s.strainPct).toBeLessThan(limit * 0.9); // back to rest
    }
  }, 60_000);

  it("grabbing a pinned corner takes the particle next to it instead of doing nothing", () => {
    const s = run(make("jersey"), 1);
    const corner = point(s, 0, 0);
    s.grab(0, [corner[0] - 0.1, corner[1] - 0.1, 0.1]);
    const next = point(s, 1, 1);
    run(s, 0.5);
    expect(Array.from(point(s, 0, 0))).toEqual(Array.from(corner)); // the pin held
    expect(Math.hypot(...point(s, 1, 1).map((v, i) => v - next[i]!) as [number, number, number])).toBeGreaterThan(0.002); // the neighbour moved
  });
});

describe("smooth surface", () => {
  it("draws a finer grid through the particles, with the right numbers of points and triangles", () => {
    const grid = smoothGrid(6, 3);
    expect(grid.size).toBe(16);
    expect(grid.indices.length).toBe(15 * 15 * 6);
    expect(grid.uvs.length).toBe(16 * 16 * 2);
    expect(Math.max(...Array.from(grid.indices))).toBe(16 * 16 - 1);
    expect([grid.uvs[0], grid.uvs[1]]).toEqual([0, 1]); // top left
    expect([grid.uvs.at(-2), grid.uvs.at(-1)]).toEqual([1, 0]); // bottom right
  });

  it("passes through every particle and stays on a flat sheet when the particles are flat", () => {
    const n = 6, factor = 3, grid = smoothGrid(n, factor);
    const particles = new Float32Array(n * n * 3);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const o = (r * n + c) * 3; particles[o] = c * 0.1; particles[o + 1] = 1 - r * 0.1; particles[o + 2] = 0.5; }
    const out = new Float32Array(grid.size * grid.size * 3);
    grid.evaluate(particles, out);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const o = (r * factor * grid.size + c * factor) * 3, p = (r * n + c) * 3;
      expect([out[o], out[o + 1], out[o + 2]].map((v) => Number(v!.toFixed(5)))).toEqual([particles[p], particles[p + 1], particles[p + 2]].map((v) => Number(v!.toFixed(5))));
    }
    for (let i = 2; i < out.length; i += 3) expect(out[i]).toBeCloseTo(0.5, 5);
  });

  it("rounds a corner instead of cutting it (the drawn points are curved, not the polyline of the particles)", () => {
    const n = 5, grid = smoothGrid(n, 4);
    const particles = new Float32Array(n * n * 3);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const o = (r * n + c) * 3; particles[o] = c; particles[o + 1] = c === 2 ? 1 : 0; particles[o + 2] = r; }
    const out = new Float32Array(grid.size * grid.size * 3);
    grid.evaluate(particles, out);
    const middle = (grid.size >> 1) * grid.size; // a row, first column
    const heights = Array.from({ length: grid.size }, (_, c) => out[(middle + c) * 3 + 1]!);
    const peak = Math.max(...heights);
    expect(peak).toBeGreaterThan(0.99);
    expect(heights.filter((h) => h > 0.05 && h < 0.95).length).toBeGreaterThan(4); // a smooth rise, not a step
  });
});

describe("weave", () => {
  it("picks a weave from the structure of the fabric", () => {
    expect(weaveFor("denim", "woven")).toBe("twill");
    expect(weaveFor("gabardine", "woven")).toBe("twill");
    expect(weaveFor("satin", "woven")).toBe("satin");
    expect(weaveFor("jersey", "knit")).toBe("knit");
    expect(weaveFor("rib", "knit")).toBe("knit");
    expect(weaveFor("poplin", "woven")).toBe("plain");
    expect(weaveFor("other", "nonwoven")).toBe("plain");
  });

  it("is a height between 0 and 1 everywhere, and the weaves are not the same picture", () => {
    const kinds: WeaveKind[] = ["plain", "twill", "satin", "knit"];
    const picture = (kind: WeaveKind) => Array.from({ length: 16 * 16 }, (_, k) => { const x = (k % 16) * 4 + 1, y = Math.floor(k / 16) * 4 + 1; return weaveHeight(kind, Math.floor(x / 8), Math.floor(y / 8), (x % 8) / 8, (y % 8) / 8); });
    const pictures = kinds.map(picture);
    for (const p of pictures) { expect(Math.min(...p)).toBeGreaterThanOrEqual(0); expect(Math.max(...p)).toBeLessThanOrEqual(1); expect(Math.max(...p) - Math.min(...p)).toBeGreaterThan(0.4); }
    for (let a = 0; a < kinds.length; a++) for (let b = a + 1; b < kinds.length; b++) expect(pictures[a]).not.toEqual(pictures[b]);
  });
});
