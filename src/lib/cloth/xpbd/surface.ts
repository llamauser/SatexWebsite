/**
 * The simulation has 30 x 30 particles: drawn as they are, the cloth is a faceted sheet with a jagged outline. The renderer draws a finer grid whose
 * points lie on a smooth (Catmull-Rom) surface through the particles, so folds are round and the edge is a clean curve.
 */
export interface SmoothGrid {
  /** Points per side of the drawn grid. */
  readonly size: number;
  /** Fills `out` (3 floats per drawn point) from the particle positions. */
  evaluate(particles: Float32Array, out: Float32Array): void;
  /** Triangle indices of the drawn grid. */
  readonly indices: Uint32Array;
  /** Texture coordinates (0..1 across the cloth, one per drawn point). */
  readonly uvs: Float32Array;
}

const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/** `n` particles per side, `factor` drawn points for each gap between two particles. */
export function smoothGrid(n: number, factor: number): SmoothGrid {
  const size = (n - 1) * factor + 1;
  // for each drawn index: the particle cell it falls in and the position inside it
  const cell = new Int32Array(size), frac = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const g = i / factor;
    cell[i] = Math.min(n - 2, Math.floor(g));
    frac[i] = g - cell[i]!;
  }
  const clamp = (i: number) => Math.max(0, Math.min(n - 1, i));
  const evaluate = (particles: Float32Array, out: Float32Array) => {
    const columns = new Float64Array(4 * 3);
    for (let r = 0; r < size; r++) {
      const r1 = cell[r]!;
      const tr = frac[r]!;
      for (let c = 0; c < size; c++) {
        const c1 = cell[c]!, tc = frac[c]!;
        for (let k = 0; k < 4; k++) {
          const row = clamp(r1 - 1 + k);
          const base = row * n;
          for (let a = 0; a < 3; a++) {
            columns[k * 3 + a] = catmull(particles[(base + clamp(c1 - 1)) * 3 + a]!, particles[(base + c1) * 3 + a]!, particles[(base + clamp(c1 + 1)) * 3 + a]!, particles[(base + clamp(c1 + 2)) * 3 + a]!, tc);
          }
        }
        const o = (r * size + c) * 3;
        for (let a = 0; a < 3; a++) out[o + a] = catmull(columns[a]!, columns[3 + a]!, columns[6 + a]!, columns[9 + a]!, tr);
      }
    }
  };
  const indices = new Uint32Array((size - 1) * (size - 1) * 6);
  let k = 0;
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const a = r * size + c, b = a + size;
      indices[k++] = a; indices[k++] = b; indices[k++] = a + 1;
      indices[k++] = a + 1; indices[k++] = b; indices[k++] = b + 1;
    }
  }
  const uvs = new Float32Array(size * size * 2);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) { uvs[(r * size + c) * 2] = c / (size - 1); uvs[(r * size + c) * 2 + 1] = 1 - r / (size - 1); }
  return { size, evaluate, indices, uvs };
}
