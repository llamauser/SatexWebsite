/**
 * Dominant colors of a photo (Snap & Match, docs/08b-phase2-4-features.md §A). Pure: takes RGB(A) pixels, returns up to `max`
 * colors with their share of the image. Pixels are grouped into coarse color cells; cells that are close to a bigger one are
 * merged into it, so a shaded blue fabric gives one blue, not five.
 */
export interface DominantColor { hex: string; share: number }

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0").toUpperCase();
export const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** `channels` is 3 (RGB) or 4 (RGBA: transparent pixels are ignored). */
export function dominantColors(pixels: ArrayLike<number>, channels: 3 | 4 = 4, max = 3): DominantColor[] {
  const cells = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let i = 0; i + channels <= pixels.length; i += channels) {
    if (channels === 4 && pixels[i + 3]! < 128) continue;
    const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4); // 16 levels per channel
    const cell = cells.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    cell.n++; cell.r += r; cell.g += g; cell.b += b;
    cells.set(key, cell);
    total++;
  }
  if (total === 0) return [];

  const sorted = [...cells.values()].sort((a, b) => b.n - a.n).map((c) => ({ n: c.n, r: c.r / c.n, g: c.g / c.n, b: c.b / c.n }));
  const merged: typeof sorted = [];
  for (const c of sorted) {
    const near = merged.find((m) => Math.hypot(m.r - c.r, m.g - c.g, m.b - c.b) < 48);
    if (near) {
      const n = near.n + c.n;
      near.r = (near.r * near.n + c.r * c.n) / n; near.g = (near.g * near.n + c.g * c.n) / n; near.b = (near.b * near.n + c.b * c.n) / n; near.n = n;
    } else merged.push({ ...c });
  }
  return merged.sort((a, b) => b.n - a.n).slice(0, max).map((c) => ({ hex: toHex(c.r, c.g, c.b), share: Math.round((c.n / total) * 100) / 100 }));
}
