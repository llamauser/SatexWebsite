/**
 * Small-step XPBD cloth (Macklin et al.) for the fabric swatch of the product page. Runs in a Web Worker (no WebAssembly, no shared memory: the site's
 * Content-Security-Policy forbids the first and the page is not cross-origin isolated for the second). Everything is in metres and kilograms.
 *
 * A swatch of CLOTH_SIZE x CLOTH_SIZE metres is a grid of n x n particles joined by structural, shear and bending distance constraints. The
 * constraints are split into colour groups whose members share no particle: inside a group the order is irrelevant, so the result has no
 * directional bias (a plain row-by-row sweep makes the edges ragged and the cloth creep to one side).
 */
export type ClothMode = "hang" | "table" | "sphere" | "wind";
export interface XpbdParameters {
  /** Mass of one particle (kg): density x cell area. */
  particleMass: number;
  /** Compliance (m/N = 1 / spring stiffness) of the structural, shear and bending constraints. */
  stretchCompliance: number;
  shearCompliance: number;
  bendCompliance: number;
  /** Energy loss of the whole cloth as it moves, 1/s. */
  damping: number;
  /** Damping of the motion of a particle relative to its neighbours, 1/s: it takes the vibration out without slowing the fall of the cloth. */
  internalDamping?: number;
  /** Coulomb friction against the floor and the objects (0 = ice, 1 = rubber). */
  friction: number;
  /** Strength of the air: drag, and the force of the wind on the surface. */
  airDrag: number;
  /** How far the fabric can stretch (a fraction, 0.15 = 15 %) before it stiffens sharply, like cloth whose threads have straightened out. */
  maxStrain?: number;
}

export const CLOTH_SIZE = 0.4;
/** Height of the top edge of a hanging swatch, and how far the two pinned corners are brought in from the ends of the edge. */
export const HANG_HEIGHT = 0.58;
export const HANG_INSET = 0.035;
/** A block on the floor the cloth is dropped on (square, centred). */
export const TABLE = { half: 0.13, height: 0.16 };
/** A ball on the floor (a drape tester). */
export const SPHERE = { radius: 0.11 };
const THICKNESS = 0.005; // the cloth keeps this far from a surface
const GRAVITY = 9.81;
const SUBSTEPS = 30;
const ITERATIONS = 1;
/**
 * A constraint corrects at most this share of its error in one pass: the compliance of a constraint never goes below `(1 / share - 1) x (wa + wb)`.
 * Without it a very light fabric (large inverse mass) is so stiff that one pass cannot converge and the cloth jitters for ever.
 */
const MAX_CORRECTION = 0.7;
const FLOOR = 1 / MAX_CORRECTION - 1;
/** The pointer holds the cloth like a hand: a spring to the pointer with a limited grip, spread over a fingertip (the grabbed particle and its eight neighbours). */
const GRAB_STIFFNESS = 60; // N/m
const STRIDE = 3;

interface Group { a: Int32Array; b: Int32Array; rest: Float64Array; kind: 0 | 1 }
/** Bending: a particle and its four neighbours on the grid (left, right, up, down). Centres of one group are far enough apart not to share a neighbour. */
interface Stencils { c: Int32Array; l: Int32Array; r: Int32Array; u: Int32Array; d: Int32Array }

/** A small deterministic noise, so every reset starts the same way. */
const noise = (i: number) => {
  let x = Math.imul(i + 1, 0x9e3779b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967295 - 0.5; // -0.5 .. 0.5
};

export class CpuClothSolver {
  readonly n: number;
  /** Positions of the particles, x y z per particle, row by row (what the renderer reads). */
  readonly positions: Float32Array;
  private pos: Float64Array;
  private prev: Float64Array;
  private vel: Float64Array;
  private invMass: Float64Array;
  private normals: Float64Array;
  private scratch: Float64Array;
  private groups: Group[] = [];
  private structural: Group[] = [];
  private bending: Stencils[] = [];
  private bendingReversed: Stencils[] = [];
  private groupsReversed: Group[] = [];
  private pins = new Map<number, [number, number, number]>();
  private grabIndex: number | null = null;
  private grabTarget: [number, number, number] | null = null;
  private mode: ClothMode = "hang";
  private params: XpbdParameters;
  private time = 0;
  private flip = false;

  constructor(n = 30, params: XpbdParameters) {
    this.n = n;
    this.params = params;
    const count = n * n;
    this.positions = new Float32Array(count * STRIDE);
    this.pos = new Float64Array(count * STRIDE);
    this.prev = new Float64Array(count * STRIDE);
    this.vel = new Float64Array(count * STRIDE);
    this.normals = new Float64Array(count * STRIDE);
    this.scratch = new Float64Array(count * STRIDE);
    this.invMass = new Float64Array(count);
    this.buildConstraints();
    this.reset("hang");
  }

  setParams(params: XpbdParameters) {
    this.params = params;
    this.refreshMass();
  }

  reset(mode: ClothMode = this.mode) {
    this.mode = mode;
    this.time = 0;
    this.grabIndex = null;
    this.grabTarget = null;
    this.pins.clear();
    const n = this.n;
    const side = CLOTH_SIZE;
    const horizontal = mode === "table" || mode === "sphere";
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const i = row * n + col;
        const u = col / (n - 1) - 0.5;
        const v = row / (n - 1) - 0.5;
        const o = i * STRIDE;
        // a tiny irregularity: a sheet that is perfectly flat has no reason to fold
        const bump = noise(i) * 0.003;
        if (horizontal) {
          this.pos[o] = u * side;
          // dropped on a ball, the sheet is held a little domed (its edges already bent down): a flat stiff plate on a small ball is balanced on a point and tips over at the slightest unevenness
          const dome = mode === "sphere" ? 1.6 * ((u * side) ** 2 + (v * side) ** 2) : 0;
          this.pos[o + 1] = (mode === "table" ? TABLE.height + 0.16 : SPHERE.radius * 2 + 0.1) - dome + bump;
          this.pos[o + 2] = v * side;
        } else {
          this.pos[o] = u * side;
          this.pos[o + 1] = HANG_HEIGHT - (row / (n - 1)) * side;
          this.pos[o + 2] = bump;
        }
      }
    }
    this.vel.fill(0);
    this.prev.set(this.pos);
    if (mode === "hang") {
      // two corners of the top edge, a little closer than the width of the cloth: the slack between them is what makes it fold
      this.pin(0, [-side / 2 + HANG_INSET, HANG_HEIGHT, 0]);
      this.pin(n - 1, [side / 2 - HANG_INSET, HANG_HEIGHT, 0]);
    } else if (mode === "wind") {
      for (let col = 0; col < n; col++) this.pin(col, [this.pos[col * STRIDE]!, HANG_HEIGHT, 0]);
    }
    this.refreshMass();
    this.publish();
  }

  grab(index: number, target: [number, number, number]) {
    if (index < 0 || index >= this.n * this.n) return;
    // a pinned corner cannot be moved: take the particle next to it
    const n = this.n;
    let grabbed = index;
    if (this.pins.has(grabbed)) grabbed = grabbed + (Math.floor(grabbed / n) < n - 1 ? n : -n) + (grabbed % n < n / 2 ? 1 : -1);
    this.grabIndex = grabbed;
    this.grabTarget = target;
  }

  moveGrab(target: [number, number, number]) {
    if (this.grabIndex !== null) this.grabTarget = target;
  }

  release() {
    this.grabIndex = null;
    this.grabTarget = null;
  }

  step(dt = 1 / 60) {
    const frameDt = Math.max(1 / 120, Math.min(1 / 30, dt));
    const h = frameDt / SUBSTEPS;
    if (this.mode === "wind") this.computeNormals();
    for (let s = 0; s < SUBSTEPS; s++) {
      this.time += h;
      this.applyGrab(h);
      this.integrate(h);
      for (let it = 0; it < ITERATIONS; it++) this.solve(h);
      this.collide();
      this.settleVelocities(h);
    }
    this.publish();
    return this.positions;
  }

  /** How much the cloth is stretched, in %: under the pointer when it is pulled, else the most stretched tenth of the threads. */
  get strainPct(): number {
    if (this.grabIndex !== null) {
      const g = this.grabIndex;
      let worst = 0;
      for (const group of this.structural) {
        for (let k = 0; k < group.a.length; k++) {
          if (group.a[k] !== g && group.b[k] !== g) continue;
          worst = Math.max(worst, this.edgeLength(group.a[k]!, group.b[k]!) / group.rest[k]! - 1);
        }
      }
      return Math.max(0, worst * 100);
    }
    const strains: number[] = [];
    for (const group of this.structural) for (let k = 0; k < group.a.length; k++) strains.push(this.edgeLength(group.a[k]!, group.b[k]!) / group.rest[k]! - 1);
    strains.sort((x, y) => y - x);
    const top = strains.slice(0, Math.max(1, Math.floor(strains.length / 10)));
    return Math.max(0, (top.reduce((s, v) => s + v, 0) / top.length) * 100);
  }

  /** Kinetic energy per particle (J), to know when the cloth has come to rest. */
  get motion(): number {
    let e = 0;
    for (let i = 0; i < this.vel.length; i += STRIDE) e += this.vel[i]! ** 2 + this.vel[i + 1]! ** 2 + this.vel[i + 2]! ** 2;
    return (0.5 * this.params.particleMass * e) / (this.n * this.n);
  }

  // ------------------------------------------------------------------ set-up
  private pin(index: number, at: [number, number, number]) {
    this.pins.set(index, at);
  }

  private refreshMass() {
    const inv = 1 / Math.max(1e-9, this.params.particleMass);
    this.invMass.fill(inv);
    for (const [index, at] of this.pins) {
      this.invMass[index] = 0;
      this.setPoint(index, at);
    }
  }

  private setPoint(index: number, p: readonly [number, number, number]) {
    const o = index * STRIDE;
    this.pos[o] = p[0]; this.pos[o + 1] = p[1]; this.pos[o + 2] = p[2];
    this.prev[o] = p[0]; this.prev[o + 1] = p[1]; this.prev[o + 2] = p[2];
    this.vel[o] = 0; this.vel[o + 1] = 0; this.vel[o + 2] = 0;
  }

  private buildConstraints() {
    const n = this.n;
    const s = CLOTH_SIZE / (n - 1);
    const make = (pairs: [number, number, number][], rest: number, kind: 0 | 1): Group[] => {
      // one group per colour: members of a group never share a particle
      const byColour = new Map<number, [number, number][]>();
      for (const [a, b, colour] of pairs) byColour.set(colour, [...(byColour.get(colour) ?? []), [a, b]]);
      return [...byColour.values()].map((list) => ({ a: Int32Array.from(list.map((p) => p[0])), b: Int32Array.from(list.map((p) => p[1])), rest: Float64Array.from(list.map(() => rest)), kind }));
    };
    const idx = (r: number, c: number) => r * n + c;
    const h: [number, number, number][] = [], v: [number, number, number][] = [];
    const d1: [number, number, number][] = [], d2: [number, number, number][] = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (c + 1 < n) h.push([idx(r, c), idx(r, c + 1), c % 2]);
        if (r + 1 < n) v.push([idx(r, c), idx(r + 1, c), r % 2]);
        if (c + 1 < n && r + 1 < n) {
          d1.push([idx(r, c), idx(r + 1, c + 1), (r % 2) * 2 + (c % 2)]);
          d2.push([idx(r, c + 1), idx(r + 1, c), (r % 2) * 2 + (c % 2)]);
        }
      }
    }
    this.structural = [...make(h, s, 0), ...make(v, s, 0)];
    this.groups = [...this.structural, ...make(d1, s * Math.SQRT2, 1), ...make(d2, s * Math.SQRT2, 1)];

    const colours: number[][][] = Array.from({ length: 9 }, () => [[], [], [], [], []]);
    for (let r = 1; r < n - 1; r++) {
      for (let c = 1; c < n - 1; c++) {
        const group = colours[(r % 3) * 3 + (c % 3)]!;
        group[0]!.push(idx(r, c)); group[1]!.push(idx(r, c - 1)); group[2]!.push(idx(r, c + 1)); group[3]!.push(idx(r - 1, c)); group[4]!.push(idx(r + 1, c));
      }
    }
    this.groupsReversed = [...this.groups].reverse();
    this.bending = colours.map(([c, l, r, u, d]) => ({ c: Int32Array.from(c!), l: Int32Array.from(l!), r: Int32Array.from(r!), u: Int32Array.from(u!), d: Int32Array.from(d!) }));
    this.bendingReversed = [...this.bending].reverse();
  }

  // ------------------------------------------------------------------ one substep
  private integrate(h: number) {
    const { damping, airDrag, particleMass } = this.params;
    const keep = Math.exp(-damping * h);
    const wind = this.mode === "wind" ? this.windAt(this.time) : null;
    const cell = (CLOTH_SIZE / (this.n - 1)) ** 2;
    for (let i = 0; i < this.invMass.length; i++) {
      if (this.invMass[i] === 0) continue;
      const o = i * STRIDE;
      let ax = 0, ay = -GRAVITY, az = 0;
      if (wind) {
        // the push of the air on a piece of cloth of this size: it grows with how much the surface faces the (relative) wind
        const nx = this.normals[o]!, ny = this.normals[o + 1]!, nz = this.normals[o + 2]!;
        const rx = wind[0] - this.vel[o]!, ry = wind[1] - this.vel[o + 1]!, rz = wind[2] - this.vel[o + 2]!;
        const facing = nx * rx + ny * ry + nz * rz;
        const force = 0.72 * airDrag * cell * facing * Math.abs(facing);
        ax += (force * nx) / particleMass; ay += (force * ny) / particleMass; az += (force * nz) / particleMass;
      }
      this.prev[o] = this.pos[o]!; this.prev[o + 1] = this.pos[o + 1]!; this.prev[o + 2] = this.pos[o + 2]!;
      const vx = (this.vel[o]! + ax * h) * keep, vy = (this.vel[o + 1]! + ay * h) * keep, vz = (this.vel[o + 2]! + az * h) * keep;
      this.pos[o] = this.pos[o]! + (vx * h); this.pos[o + 1] = this.pos[o + 1]! + (vy * h); this.pos[o + 2] = this.pos[o + 2]! + (vz * h);
    }
  }

  /** The pull of the pointer, as a push on the velocity of the fingertip particles (the constraints then carry it through the cloth). */
  private applyGrab(h: number) {
    if (this.grabIndex === null || !this.grabTarget) return;
    const n = this.n, g = this.grabIndex, o = g * STRIDE;
    const dx = this.grabTarget[0] - this.pos[o]!, dy = this.grabTarget[1] - this.pos[o + 1]!, dz = this.grabTarget[2] - this.pos[o + 2]!;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < 1e-9) return;
    // the grip adapts to the swatch: about eight times its weight
    const weight = this.params.particleMass * n * n * GRAVITY;
    const force = Math.min(GRAB_STIFFNESS * distance, Math.max(1, Math.min(8, 8 * weight)));
    const fx = (dx / distance) * force, fy = (dy / distance) * force, fz = (dz / distance) * force;
    const row = Math.floor(g / n), col = g % n;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = row + dr, c = col + dc;
        if (r < 0 || r >= n || c < 0 || c >= n) continue;
        const i = r * n + c;
        if (this.invMass[i] === 0) continue;
        const share = (dr === 0 ? 2 : 1) * (dc === 0 ? 2 : 1) / 16; // 4/16 centre, 2/16 sides, 1/16 corners
        const k = this.invMass[i]! * share * h;
        this.vel[i * STRIDE] = this.vel[i * STRIDE]! + fx * k; this.vel[i * STRIDE + 1] = this.vel[i * STRIDE + 1]! + fy * k; this.vel[i * STRIDE + 2] = this.vel[i * STRIDE + 2]! + fz * k;
      }
    }
  }

  /** Gusts: a steady breeze from the left and in front, with slow swells and quick flutters. */
  private windAt(t: number): [number, number, number] {
    const strength = 2.6 + 1.6 * Math.sin(t * 1.7) + 0.9 * Math.sin(t * 4.3 + 1.2) + 0.5 * Math.sin(t * 9.1);
    return [strength * 0.9, 0.05 * strength, strength * 0.6];
  }

  private solve(h: number) {
    const { stretchCompliance, shearCompliance, bendCompliance } = this.params;
    const alphas: [number, number] = [stretchCompliance / (h * h), shearCompliance / (h * h)];
    const bendAlpha = bendCompliance / (h * h);
    const maxStrain = this.params.maxStrain ?? 0.5;
    this.flip = !this.flip; // the order of the groups alternates, so no group is always the last word
    const order = this.flip ? this.groups : this.groupsReversed;
    const p = this.pos, w = this.invMass;
    for (const group of order) {
      const alpha = alphas[group.kind];
      for (let k = 0; k < group.a.length; k++) {
        const a = group.a[k]!, b = group.b[k]!;
        const oa = a * STRIDE, ob = b * STRIDE;
        const dx = p[ob]! - p[oa]!, dy = p[ob + 1]! - p[oa + 1]!, dz = p[ob + 2]! - p[oa + 2]!;
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (length < 1e-9) continue;
        const wa = w[a]!, wb = w[b]!;
        let compliance = alpha;
        if (group.kind === 0) {
          const strain = length / group.rest[k]! - 1;
          if (strain > maxStrain) compliance = alpha / Math.pow(strain / maxStrain, 3); // the threads are straight: it does not give any more
        }
        const effective = Math.max(compliance, FLOOR * (wa + wb));
        const lambda = -(length - group.rest[k]!) / (wa + wb + effective);
        const s = lambda / length;
        p[oa] = p[oa]! - (wa * s * dx); p[oa + 1] = p[oa + 1]! - (wa * s * dy); p[oa + 2] = p[oa + 2]! - (wa * s * dz);
        p[ob] = p[ob]! + (wb * s * dx); p[ob + 1] = p[ob + 1]! + (wb * s * dy); p[ob + 2] = p[ob + 2]! + (wb * s * dz);
      }
    }
    this.solveBending(bendAlpha);
  }

  /**
   * Bending resists curvature: the distance of a particle from the plane of its four neighbours (measured along the local normal) is a length that
   * is zero for a flat sheet and grows in proportion to how much the cloth is curved there. (A distance between particles two apart, the usual
   * shortcut, changes with the square of the angle: it has no stiffness near flat, so every fabric would droop alike.)
   */
  private solveBending(alpha: number) {
    const p = this.pos, w = this.invMass;
    const order = this.flip ? this.bending : this.bendingReversed;
    for (const g of order) {
      for (let k = 0; k < g.c.length; k++) {
        const c = g.c[k]! * STRIDE, l = g.l[k]! * STRIDE, r = g.r[k]! * STRIDE, u = g.u[k]! * STRIDE, d = g.d[k]! * STRIDE;
        const tx = p[r]! - p[l]!, ty = p[r + 1]! - p[l + 1]!, tz = p[r + 2]! - p[l + 2]!;
        const sx = p[d]! - p[u]!, sy = p[d + 1]! - p[u + 1]!, sz = p[d + 2]! - p[u + 2]!;
        let nx = ty * sz - tz * sy, ny = tz * sx - tx * sz, nz = tx * sy - ty * sx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len < 1e-12) continue;
        nx /= len; ny /= len; nz /= len;
        const mx = (p[l]! + p[r]! + p[u]! + p[d]!) / 4, my = (p[l + 1]! + p[r + 1]! + p[u + 1]! + p[d + 1]!) / 4, mz = (p[l + 2]! + p[r + 2]! + p[u + 2]! + p[d + 2]!) / 4;
        const constraint = (p[c]! - mx) * nx + (p[c + 1]! - my) * ny + (p[c + 2]! - mz) * nz;
        const wc = w[g.c[k]!]!, wl = w[g.l[k]!]!, wr = w[g.r[k]!]!, wu = w[g.u[k]!]!, wd = w[g.d[k]!]!;
        const weights = wc + (wl + wr + wu + wd) / 16;
        const lambda = -constraint / (weights + Math.max(alpha, FLOOR * weights));
        p[c] = p[c]! + (wc * lambda * nx); p[c + 1] = p[c + 1]! + (wc * lambda * ny); p[c + 2] = p[c + 2]! + (wc * lambda * nz);
        const fl = (-wl * lambda) / 4, fr = (-wr * lambda) / 4, fu = (-wu * lambda) / 4, fd = (-wd * lambda) / 4;
        p[l] = p[l]! + fl * nx; p[l + 1] = p[l + 1]! + fl * ny; p[l + 2] = p[l + 2]! + fl * nz;
        p[r] = p[r]! + fr * nx; p[r + 1] = p[r + 1]! + fr * ny; p[r + 2] = p[r + 2]! + fr * nz;
        p[u] = p[u]! + fu * nx; p[u + 1] = p[u + 1]! + fu * ny; p[u + 2] = p[u + 2]! + fu * nz;
        p[d] = p[d]! + fd * nx; p[d + 1] = p[d + 1]! + fd * ny; p[d + 2] = p[d + 2]! + fd * nz;
      }
    }
  }

  /** The floor and the object of the mode: push a particle out, and hold back its sliding along the surface (friction). */
  private collide() {
    const mu = this.params.friction;
    const p = this.pos, q = this.prev;
    const contact = (o: number, nx: number, ny: number, nz: number, depth: number) => {
      p[o] = p[o]! + nx * depth; p[o + 1] = p[o + 1]! + ny * depth; p[o + 2] = p[o + 2]! + nz * depth;
      // the particle was moved out of the surface: the velocity that follows must not carry that push (it would bounce)
      const dx = p[o]! - q[o]!, dy = p[o + 1]! - q[o + 1]!, dz = p[o + 2]! - q[o + 2]!;
      const dn = dx * nx + dy * ny + dz * nz;
      const tx = dx - dn * nx, ty = dy - dn * ny, tz = dz - dn * nz;
      // Coulomb friction: the sliding along the surface is held back by at most mu x how hard the cloth was pressing (the depth it had to be pushed out).
      // A cloth lying on a surface presses very little, so it slides off a ball; a fixed share of the sliding, taken at every one of the many substeps, would glue it.
      const slide = Math.sqrt(tx * tx + ty * ty + tz * tz);
      const keep = slide > 1e-12 ? Math.max(0, slide - mu * depth) / slide : 0;
      q[o] = p[o]! - tx * keep; q[o + 1] = p[o + 1]! - ty * keep; q[o + 2] = p[o + 2]! - tz * keep;
    };
    const box = TABLE.half + THICKNESS;
    const top = TABLE.height + THICKNESS;
    const ball = SPHERE.radius + THICKNESS;
    for (let i = 0; i < this.invMass.length; i++) {
      if (this.invMass[i] === 0) continue;
      const o = i * STRIDE;
      if (p[o + 1]! < THICKNESS) contact(o, 0, 1, 0, THICKNESS - p[o + 1]!);
      if (this.mode === "table") {
        const x = p[o]!, y = p[o + 1]!, z = p[o + 2]!;
        if (Math.abs(x) < box && Math.abs(z) < box && y < top) {
          // out through the nearest face of the block
          const up = top - y, px = box - x, nx = box + x, pz = box - z, nz = box + z;
          const least = Math.min(up, px, nx, pz, nz);
          if (least === up) contact(o, 0, 1, 0, up);
          else if (least === px) contact(o, 1, 0, 0, px);
          else if (least === nx) contact(o, -1, 0, 0, nx);
          else if (least === pz) contact(o, 0, 0, 1, pz);
          else contact(o, 0, 0, -1, nz);
        }
      } else if (this.mode === "sphere") {
        const x = p[o]!, y = p[o + 1]! - SPHERE.radius, z = p[o + 2]!;
        const distance = Math.sqrt(x * x + y * y + z * z);
        if (distance < ball && distance > 1e-9) contact(o, x / distance, y / distance, z / distance, ball - distance);
      }
    }
  }

  private settleVelocities(h: number) {
    for (let i = 0; i < this.pos.length; i++) this.vel[i] = (this.pos[i]! - this.prev[i]!) / h;
    const rate = this.params.internalDamping ?? 0;
    if (rate <= 0) return;
    // each particle gives up a share of its motion relative to the mean of its neighbours: the cloth as a whole keeps moving, the vibration goes
    const beta = 1 - Math.exp(-rate * h);
    const n = this.n, v = this.vel, out = this.scratch;
    for (let r = 0; r < n; r++) {
      const r0 = Math.max(0, r - 1) * n, r1 = Math.min(n - 1, r + 1) * n, rr = r * n;
      for (let c = 0; c < n; c++) {
        const i = (rr + c) * STRIDE;
        if (this.invMass[rr + c] === 0) { out[i] = v[i]!; out[i + 1] = v[i + 1]!; out[i + 2] = v[i + 2]!; continue; }
        const l = (rr + Math.max(0, c - 1)) * STRIDE, rt = (rr + Math.min(n - 1, c + 1)) * STRIDE, u = (r0 + c) * STRIDE, d = (r1 + c) * STRIDE;
        for (let k = 0; k < 3; k++) out[i + k] = v[i + k]! + beta * ((v[l + k]! + v[rt + k]! + v[u + k]! + v[d + k]!) / 4 - v[i + k]!);
      }
    }
    v.set(out);
  }

  private computeNormals() {
    const n = this.n, p = this.pos;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c, o = i * STRIDE;
        const c0 = Math.max(0, c - 1) + r * n, c1 = Math.min(n - 1, c + 1) + r * n, r0 = c + Math.max(0, r - 1) * n, r1 = c + Math.min(n - 1, r + 1) * n;
        const ux = p[c1 * STRIDE]! - p[c0 * STRIDE]!, uy = p[c1 * STRIDE + 1]! - p[c0 * STRIDE + 1]!, uz = p[c1 * STRIDE + 2]! - p[c0 * STRIDE + 2]!;
        const vx = p[r1 * STRIDE]! - p[r0 * STRIDE]!, vy = p[r1 * STRIDE + 1]! - p[r0 * STRIDE + 1]!, vz = p[r1 * STRIDE + 2]! - p[r0 * STRIDE + 2]!;
        // columns run to the right and rows run down the cloth: u x v points towards the viewer for a hanging sheet
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        this.normals[o] = nx / len; this.normals[o + 1] = ny / len; this.normals[o + 2] = nz / len;
      }
    }
  }

  private edgeLength(a: number, b: number) {
    const oa = a * STRIDE, ob = b * STRIDE;
    const dx = this.pos[ob]! - this.pos[oa]!, dy = this.pos[ob + 1]! - this.pos[oa + 1]!, dz = this.pos[ob + 2]! - this.pos[oa + 2]!;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private publish() {
    for (let i = 0; i < this.pos.length; i++) this.positions[i] = this.pos[i]!;
  }
}
