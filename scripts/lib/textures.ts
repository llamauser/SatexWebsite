/**
 * Procedural fabric images for the seed (docs/12-seed-data.md §5). Deterministic, no external assets.
 * All pattern periods divide 256 (enforced by a unit test).
 * Pipeline: a tileable 256x256 height/luminance field per structure -> tinted with the color hex ->
 *   - swatch  (1024x1024, tileable, doubles as the albedo texture)
 *   - photo   (1200x900, same weave with soft lighting and a fold, used as the catalog image)
 * Normal and roughness maps depend only on the structure, so they are shared by all colors.
 */
import sharp from "sharp";
import { hashString } from "../seed-data/rng";

export const BASE = 256;
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ tileable noise
function lattice(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise on a wrapping lattice: period of `size` pixels, `cell` pixels per lattice step. */
function tileNoise(x: number, y: number, size: number, cell: number, seed: number): number {
  const g = Math.max(1, Math.round(size / cell));
  const fx = (x / size) * g;
  const fy = (y / size) * g;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = lattice(x0 % g, y0 % g, seed);
  const b = lattice((x0 + 1) % g, y0 % g, seed);
  const c = lattice(x0 % g, (y0 + 1) % g, seed);
  const d = lattice((x0 + 1) % g, (y0 + 1) % g, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

type Pattern = (x: number, y: number, seed: number) => number;

const knitLoops = (w: number, c: number): Pattern => (x, y, seed) => {
  const u = (x % w) / w;
  const v = (y % c) / c;
  const edge = Math.abs(u - 0.5) * 2; // 0 centre .. 1 edge of the wale
  const loop = Math.sin(Math.PI * clamp01(v + (1 - edge) * 0.55));
  return clamp01(0.42 + 0.4 * loop + 0.08 * (tileNoise(x, y, BASE, 4, seed) - 0.5));
};

const PATTERNS: Record<string, Pattern> = {
  jersey: knitLoops(8, 8),
  interlock: knitLoops(4, 4),
  french_terry: knitLoops(16, 16),
  rib: (x, y, seed) => {
    const wale = (x % 16) / 16;
    const ridge = Math.sin(Math.PI * wale) ** 2;
    return clamp01(0.3 + 0.55 * ridge + 0.06 * (tileNoise(x, y, BASE, 4, seed) - 0.5) + 0.05 * Math.sin(TAU * y / 8));
  },
  pique: (x, y) => clamp01(0.55 + 0.3 * Math.cos(TAU * x / 16) * Math.cos(TAU * y / 16) + 0.1 * Math.cos(TAU * (x + y) / 16)),
  mesh: (x, y) => {
    const dx = (x % 8) - 3.5;
    const dy = (y % 8) - 3.5;
    const hole = Math.hypot(dx, dy) < 2.4;
    return hole ? 0.08 : clamp01(0.7 + 0.1 * Math.sin(TAU * x / 8) * Math.sin(TAU * y / 8));
  },
  plain: (x, y) => clamp01(0.55 + 0.25 * Math.sin(TAU * x / 8) * Math.sin(TAU * y / 8) + 0.06 * Math.sin(TAU * (x + y) / 4)),
  poplin: (x, y, seed) => clamp01(0.58 + 0.12 * Math.sin(TAU * x / 4) * Math.sin(TAU * y / 4) + 0.05 * (tileNoise(x, y, BASE, 3, seed) - 0.5)),
  oxford: (x, y) => {
    const over = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
    const a = over ? Math.sin(TAU * x / 4) : Math.sin(TAU * y / 4);
    return clamp01(0.55 + 0.22 * a);
  },
  canvas: (x, y, seed) => clamp01(0.5 + 0.28 * Math.sin(TAU * x / 8) * Math.sin(TAU * y / 8) + 0.14 * (tileNoise(x, y, BASE, 2, seed) - 0.5)),
  twill: (x, y) => clamp01(0.55 + 0.3 * Math.sin(TAU * (x + y) / 8)),
  gabardine: (x, y) => clamp01(0.55 + 0.32 * Math.sin(TAU * (x + 2 * y) / 8)),
  denim: (x, y, seed) => clamp01(0.5 + 0.28 * Math.sin(TAU * (x + y) / 8) + 0.22 * (tileNoise(x, y, BASE, 2, seed) - 0.5)),
  satin: (x, y, seed) => clamp01(0.7 + 0.1 * Math.sin(TAU * (x + 3 * y) / BASE * 2) + 0.05 * Math.sin(TAU * y / 64) + 0.03 * (tileNoise(x, y, BASE, 2, seed) - 0.5)),
  velvet: (x, y, seed) => clamp01(0.58 + 0.26 * (tileNoise(x, y, BASE, 2, seed) - 0.5) + 0.12 * (tileNoise(x, y, BASE, 8, seed + 1) - 0.5)),
  fleece: (x, y, seed) => clamp01(0.6 + 0.3 * (tileNoise(x, y, BASE, 3, seed) - 0.5) + 0.1 * (tileNoise(x, y, BASE, 16, seed + 1) - 0.5)),
  felt: (x, y, seed) => clamp01(0.6 + 0.16 * (tileNoise(x, y, BASE, 2, seed) - 0.5)),
  crepe: (x, y, seed) => clamp01(0.55 + 0.3 * (tileNoise(x, y, BASE, 4, seed) - 0.5) + 0.2 * (tileNoise(x, y, BASE, 16, seed + 1) - 0.5)),
  chiffon: (x, y) => ((x % 8 === 0 || y % 8 === 0) ? 0.62 : 0.88),
  tulle: (x, y) => {
    const dx = (x % 16) - 7.5;
    const dy = (y % 16) - 7.5;
    return Math.abs(dx) + Math.abs(dy) < 8.5 && Math.abs(dx) + Math.abs(dy) > 6 ? 0.55 : 0.9;
  },
  jacquard: (x, y, seed) => {
    const lozenge = Math.abs((x % 32) - 16) + Math.abs((y % 32) - 16) < 11;
    const weave = 0.08 * Math.sin(TAU * x / 4) * Math.sin(TAU * y / 4);
    return clamp01((lozenge ? 0.78 : 0.48) + weave + 0.03 * (tileNoise(x, y, BASE, 4, seed) - 0.5));
  },
};

/** Visual sheen (0..1) per structure: drives the roughness map. */
const SHEEN: Record<string, number> = { satin: 0.9, velvet: 0.5, jacquard: 0.4, chiffon: 0.5, crepe: 0.2, denim: 0.1, felt: 0.05 };

export function patternFor(structure: string): Pattern {
  return PATTERNS[structure] ?? PATTERNS.plain!;
}

/** Tileable luminance field in [0,1], BASE x BASE (row-major, index = y*BASE + x). */
export function heightField(structure: string, seed = 1): Float32Array {
  const p = patternFor(structure);
  const out = new Float32Array(BASE * BASE);
  for (let y = 0; y < BASE; y++) for (let x = 0; x < BASE; x++) out[y * BASE + x] = p(x, y, seed);
  return out;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const shade = (c: number, l: number) => {
  const v = c * (0.55 + 0.9 * l);
  return v < 0 ? 0 : v > 255 ? 255 : v;
};

/** Raw RGB swatch (size x size), tileable: the 256 field repeated, plus a wrapping low-frequency mottling. */
export function swatchRaw(structure: string, hex: string, size = 1024, seed = 1): Buffer {
  const field = heightField(structure, seed);
  const [r, g, b] = hexToRgb(hex);
  const buf = Buffer.allocUnsafe(size * size * 3);
  let o = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = field[(y % BASE) * BASE + (x % BASE)]!;
      const mottle = 1 + 0.07 * (tileNoise(x, y, size, 256, seed + 7) - 0.5);
      buf[o++] = shade(r, l) * mottle;
      buf[o++] = shade(g, l) * mottle;
      buf[o++] = shade(b, l) * mottle;
    }
  }
  return buf;
}

/** Raw RGB catalog photo (w x h): the weave plus soft lighting, a vignette and a diagonal fold. */
export function photoRaw(structure: string, hex: string, w = 1200, h = 900, seed = 1): Buffer {
  const field = heightField(structure, seed);
  const [r, g, b] = hexToRgb(hex);
  const phase = (hashString(`${structure}${hex}${seed}`) % 628) / 100;
  const buf = Buffer.allocUnsafe(w * h * 3);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const l = field[(y % BASE) * BASE + (x % BASE)]!;
      const vignette = 1 - 0.28 * Math.hypot(u - 0.5, v - 0.5) * 1.6;
      const fold = 1 + 0.16 * Math.sin(TAU * (u * 1.2 + v * 0.55) + phase) + 0.07 * Math.sin(TAU * (u * 2.6 - v * 1.1) + phase * 1.7);
      const light = vignette * fold;
      buf[o++] = shade(r, l) * light;
      buf[o++] = shade(g, l) * light;
      buf[o++] = shade(b, l) * light;
    }
  }
  return buf;
}

/** Tangent-space normal map (RGB, BASE x BASE) from the structure's height field (Sobel, wrapping). */
export function normalRaw(structure: string, strength = 2): Buffer {
  const f = heightField(structure, 1);
  const buf = Buffer.allocUnsafe(BASE * BASE * 3);
  const at = (x: number, y: number) => f[((y + BASE) % BASE) * BASE + ((x + BASE) % BASE)]!;
  let o = 0;
  for (let y = 0; y < BASE; y++) {
    for (let x = 0; x < BASE; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      buf[o++] = Math.round((nx * 0.5 + 0.5) * 255);
      buf[o++] = Math.round((ny * 0.5 + 0.5) * 255);
      buf[o++] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  return buf;
}

/** Roughness map (grayscale as RGB, BASE x BASE): glossy structures (satin) low, matte (felt) high. */
export function roughnessRaw(structure: string): Buffer {
  const f = heightField(structure, 1);
  const sheen = SHEEN[structure] ?? 0.2;
  const buf = Buffer.allocUnsafe(BASE * BASE * 3);
  let o = 0;
  for (let i = 0; i < BASE * BASE; i++) {
    const rough = Math.min(1, Math.max(0.2, 1 - 0.6 * sheen + 0.3 * (f[i]! - 0.5)));
    const v = Math.round(rough * 255);
    buf[o++] = v; buf[o++] = v; buf[o++] = v;
  }
  return buf;
}

export async function toWebp(raw: Buffer, width: number, height: number, quality = 78): Promise<Buffer> {
  return sharp(raw, { raw: { width, height, channels: 3 } }).webp({ quality }).toBuffer();
}
