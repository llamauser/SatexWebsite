export type ClothMode = "hang" | "table" | "sphere" | "wind";
export interface XpbdParameters { particleMass: number; stretchCompliance: number; shearCompliance: number; bendCompliance: number; damping: number; friction: number; airDrag: number }
type Constraint = { a: number; b: number; length: number; compliance: number };

const STRIDE = 3;

/** Small-step XPBD solver for the browser worker fallback. Positions are in metres. */
export class CpuClothSolver {
  readonly n: number;
  readonly positions: Float32Array;
  private previous: Float32Array;
  private inverseMass: Float32Array;
  private constraints: Constraint[] = [];
  private pins = new Map<number, [number, number, number]>();
  private grabIndex: number | null = null;
  private grabTarget: [number, number, number] | null = null;
  private mode: ClothMode = "hang";
  private params: XpbdParameters;
  private time = 0;

  constructor(n = 30, params: XpbdParameters) {
    this.n = n;
    this.params = params;
    this.positions = new Float32Array(n * n * STRIDE);
    this.previous = new Float32Array(n * n * STRIDE);
    this.inverseMass = new Float32Array(n * n);
    this.inverseMass.fill(1 / Math.max(0.00001, params.particleMass));
    this.buildConstraints();
    this.reset("hang");
  }

  setParams(params: XpbdParameters) {
    this.params = params;
    const inv = 1 / Math.max(0.00001, params.particleMass);
    this.inverseMass.fill(inv);
    this.constraints = [];
    this.buildConstraints();
    this.applyPins();
  }

  reset(mode: ClothMode = this.mode) {
    this.mode = mode;
    this.time = 0;
    this.grabIndex = null;
    this.grabTarget = null;
    this.pins.clear();
    for (let row = 0; row < this.n; row++) {
      for (let col = 0; col < this.n; col++) {
        const index = this.index(row, col);
        const offset = index * STRIDE;
        const x = -0.2 + 0.4 * col / (this.n - 1);
        const y = mode === "hang" || mode === "wind" ? 0.55 - 0.4 * row / (this.n - 1) : 0.5;
        const z = mode === "hang" || mode === "wind" ? 0 : -0.2 + 0.4 * row / (this.n - 1);
        this.positions[offset] = x;
        this.positions[offset + 1] = y;
        this.positions[offset + 2] = z;
      }
    }
    if (mode === "hang") {
      this.pin(this.index(0, 0)); this.pin(this.index(0, this.n - 1));
    } else if (mode === "wind") {
      for (let col = 0; col < this.n; col++) this.pin(this.index(0, col));
    }
    this.previous.set(this.positions);
    this.applyPins();
  }

  grab(index: number, target: [number, number, number]) {
    if (index < 0 || index >= this.n * this.n) return;
    this.grabIndex = index;
    this.grabTarget = target;
    this.inverseMass[index] = 0;
    this.setPosition(index, target);
  }

  moveGrab(target: [number, number, number]) {
    if (this.grabIndex === null) return;
    this.grabTarget = target;
    this.setPosition(this.grabIndex, target);
  }

  release() {
    if (this.grabIndex !== null) this.inverseMass[this.grabIndex] = 1 / Math.max(0.00001, this.params.particleMass);
    this.grabIndex = null;
    this.grabTarget = null;
    this.applyPins();
  }

  step(dt = 1 / 60) {
    const frameDt = Math.max(1 / 120, Math.min(1 / 30, dt));
    const substeps = 10;
    const h = frameDt / substeps;
    for (let substep = 0; substep < substeps; substep++) {
      this.time += h;
      this.integrate(h);
      this.solve(h);
      this.collide();
      this.applyPins();
    }
    return this.positions;
  }

  get strainPct(): number {
    if (this.grabIndex === null) return 0;
    const row = Math.floor(this.grabIndex / this.n);
    const col = this.grabIndex % this.n;
    const rest = 0.4 / (this.n - 1);
    const to = (r: number, c: number) => {
      const i = this.index(r, c) * STRIDE;
      return [this.positions[i]!, this.positions[i + 1]!, this.positions[i + 2]!] as const;
    };
    let sum = 0; let count = 0;
    if (col > 0) { const p = to(row, col - 1); const q = to(row, col); sum += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / rest; count++; }
    if (col < this.n - 1) { const p = to(row, col); const q = to(row, col + 1); sum += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / rest; count++; }
    return count ? Math.max(0, (sum / count - 1) * 100) : 0;
  }

  private index(row: number, col: number) { return row * this.n + col; }
  private pin(index: number) {
    const offset = index * STRIDE;
    this.pins.set(index, [this.positions[offset]!, this.positions[offset + 1]!, this.positions[offset + 2]!]);
  }
  private setPosition(index: number, p: [number, number, number]) {
    const offset = index * STRIDE;
    this.positions.set(p, offset);
    this.previous.set(p, offset);
  }
  private applyPins() {
    for (const [index, p] of this.pins) {
      this.inverseMass[index] = 0;
      this.setPosition(index, p);
    }
    if (this.grabIndex !== null && this.grabTarget) this.setPosition(this.grabIndex, this.grabTarget);
  }
  private buildConstraints() {
    this.constraints = [];
    const add = (a: number, b: number, length: number, compliance: number) => this.constraints.push({ a, b, length, compliance });
    const spacing = 0.4 / (this.n - 1);
    for (let row = 0; row < this.n; row++) for (let col = 0; col < this.n; col++) {
      const here = this.index(row, col);
      if (col + 1 < this.n) add(here, this.index(row, col + 1), spacing, this.params.stretchCompliance);
      if (row + 1 < this.n) add(here, this.index(row + 1, col), spacing, this.params.stretchCompliance);
      if (col + 1 < this.n && row + 1 < this.n) {
        const diagonal = Math.SQRT2 * spacing;
        add(here, this.index(row + 1, col + 1), diagonal, this.params.shearCompliance);
        add(this.index(row, col + 1), this.index(row + 1, col), diagonal, this.params.shearCompliance);
      }
      if (col + 2 < this.n) add(here, this.index(row, col + 2), 2 * spacing, this.params.bendCompliance);
      if (row + 2 < this.n) add(here, this.index(row + 2, col), 2 * spacing, this.params.bendCompliance);
    }
  }
  private integrate(h: number) {
    const velocityDamping = Math.max(0, 1 - this.params.damping);
    const air = Math.max(0, 1 - this.params.airDrag);
    for (let i = 0; i < this.inverseMass.length; i++) {
      if (this.inverseMass[i] === 0) continue;
      const offset = i * STRIDE;
      const x = this.positions[offset]!; const y = this.positions[offset + 1]!; const z = this.positions[offset + 2]!;
      let wind = 0;
      if (this.mode === "wind") wind = Math.sin(this.time * 5) * (Math.sin(this.time * 1.4) > 0.7 ? 3.5 : 0.9);
      const vx = (x - this.previous[offset]!) * velocityDamping * air;
      const vy = (y - this.previous[offset + 1]!) * velocityDamping * air;
      const vz = (z - this.previous[offset + 2]!) * velocityDamping * air;
      this.previous[offset] = x; this.previous[offset + 1] = y; this.previous[offset + 2] = z;
      this.positions[offset] = x + vx + wind * h * h;
      this.positions[offset + 1] = y + vy - 9.81 * h * h;
      this.positions[offset + 2] = z + vz;
    }
  }
  private solve(h: number) {
    for (const constraint of this.constraints) {
      const oa = constraint.a * STRIDE; const ob = constraint.b * STRIDE;
      const dx = this.positions[ob]! - this.positions[oa]!;
      const dy = this.positions[ob + 1]! - this.positions[oa + 1]!;
      const dz = this.positions[ob + 2]! - this.positions[oa + 2]!;
      const length = Math.hypot(dx, dy, dz) || 1e-8;
      const wa = this.inverseMass[constraint.a]!; const wb = this.inverseMass[constraint.b]!;
      const alpha = constraint.compliance / (h * h);
      const delta = -(length - constraint.length) / (wa + wb + alpha);
      const scale = delta / length;
      this.positions[oa] = this.positions[oa]! - wa * scale * dx; this.positions[oa + 1] = this.positions[oa + 1]! - wa * scale * dy; this.positions[oa + 2] = this.positions[oa + 2]! - wa * scale * dz;
      this.positions[ob] = this.positions[ob]! + wb * scale * dx; this.positions[ob + 1] = this.positions[ob + 1]! + wb * scale * dy; this.positions[ob + 2] = this.positions[ob + 2]! + wb * scale * dz;
    }
  }
  private collide() {
    for (let i = 0; i < this.inverseMass.length; i++) {
      if (this.inverseMass[i] === 0) continue;
      const offset = i * STRIDE;
      let x = this.positions[offset]!; let y = this.positions[offset + 1]!; let z = this.positions[offset + 2]!;
      const prevOffset = offset;
      if (y < 0.004) y = 0.004;
      if (this.mode === "table" && x > -0.18 && x < 0.18 && z > -0.13 && z < 0.13 && y < 0.2) y = 0.2;
      if (this.mode === "sphere") {
        const cy = 0.18; const radius = 0.12; const dy = y - cy; const distance = Math.hypot(x, dy, z);
        if (distance < radius) { const scale = radius / Math.max(distance, 1e-6); x *= scale; y = cy + dy * scale; z *= scale; }
      }
      if (y !== this.positions[offset + 1] || x !== this.positions[offset] || z !== this.positions[offset + 2]) {
        this.positions[offset] = x; this.positions[offset + 1] = y; this.positions[offset + 2] = z;
        const mix = Math.max(0, Math.min(1, this.params.friction));
        this.previous[prevOffset] = x * mix + this.previous[prevOffset]! * (1 - mix);
        this.previous[prevOffset + 1] = y * mix + this.previous[prevOffset + 1]! * (1 - mix);
        this.previous[prevOffset + 2] = z * mix + this.previous[prevOffset + 2]! * (1 - mix);
      }
    }
  }
}
