/** A small height map of the weave of a fabric (bright = a thread on top), tileable, used as a bump map so the cloth catches the light like cloth. Browser only. */
export type WeaveKind = "plain" | "twill" | "satin" | "knit";

/** Which weave to show for a fabric structure of the catalog. */
export function weaveFor(structure: string, construction: string): WeaveKind {
  if (["denim", "twill", "gabardine", "canvas"].includes(structure)) return "twill";
  if (["satin", "velvet", "crepe", "chiffon"].includes(structure)) return "satin";
  if (construction === "knit" || ["jersey", "pique", "rib", "interlock", "french_terry", "fleece", "mesh"].includes(structure)) return "knit";
  return "plain";
}

const CELLS = 16; // threads per tile, each CELL px wide
const CELL = 8;

/** Height (0..1) of the weave at a point inside one thread cell (i, j): u, v in [0, 1). A thread is a rounded ridge that dips where it goes under. */
export function weaveHeight(kind: WeaveKind, i: number, j: number, u: number, v: number): number {
  const ridge = (across: number, along: number) => Math.sin(Math.PI * across) * (0.7 + 0.3 * Math.sin(Math.PI * along));
  if (kind === "knit") {
    // columns of V-shaped stitches, every other column shifted by half a stitch
    const s = (u + Math.abs(v - 0.5) * 0.9 + (i % 2) * 0.5) % 1;
    return Math.pow(Math.sin(Math.PI * s), 1.3) * (0.6 + 0.4 * Math.sin(Math.PI * v));
  }
  // which thread is on top in this cell: plain weave alternates, a 2/2 twill steps diagonally, satin floats over four threads out of five
  const warpOnTop = kind === "plain" ? (i + j) % 2 === 0 : kind === "twill" ? (i + j) % 4 < 2 : (i * 2 + j) % 5 !== 0;
  return warpOnTop ? ridge(u, v) : ridge(v, u);
}

export function weaveCanvas(kind: WeaveKind): HTMLCanvasElement {
  const size = CELLS * CELL;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = Math.max(0, Math.min(1, weaveHeight(kind, Math.floor(x / CELL), Math.floor(y / CELL), (x % CELL) / CELL, (y % CELL) / CELL)));
      const o = (y * size + x) * 4;
      image.data[o] = image.data[o + 1] = image.data[o + 2] = Math.round(h * 255);
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
