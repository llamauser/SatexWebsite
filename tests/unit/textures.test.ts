import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { STRUCTURE_NAMES } from "../../scripts/seed-data/dictionaries";
import {
  BASE, heightField, normalRaw, patternFor, photoRaw, roughnessRaw, swatchRaw, toWebp,
} from "../../scripts/lib/textures";

const structures = Object.keys(STRUCTURE_NAMES);

describe("procedural textures", () => {
  it.each(structures)("%s: height field is in [0,1] and BASE-periodic (so it tiles with no seam)", (s) => {
    const f = heightField(s, 7);
    expect(f).toHaveLength(BASE * BASE);
    expect(Math.min(...f)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...f)).toBeLessThanOrEqual(1);
    // a pattern that repeats every BASE pixels has no seam when tiled
    const p = patternFor(s);
    for (let i = 0; i < 200; i++) {
      const x = (i * 37) % BASE;
      const y = (i * 91) % BASE;
      expect(p(x + BASE, y, 7)).toBeCloseTo(p(x, y, 7), 6);
      expect(p(x, y + BASE, 7)).toBeCloseTo(p(x, y, 7), 6);
    }
  });

  it("is deterministic and depends on the color", () => {
    const a = swatchRaw("twill", "#2C5AA0", 256, 3);
    const b = swatchRaw("twill", "#2C5AA0", 256, 3);
    const c = swatchRaw("twill", "#C0392B", 256, 3);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it("different structures look different", () => {
    expect(swatchRaw("jersey", "#808080", 256).equals(swatchRaw("satin", "#808080", 256))).toBe(false);
  });

  it("produces the documented image sizes as WebP", async () => {
    const photo = await sharp(await toWebp(photoRaw("jersey", "#1F3A5F", 1200, 900, 1), 1200, 900)).metadata();
    expect([photo.format, photo.width, photo.height]).toEqual(["webp", 1200, 900]);
    const swatch = await sharp(await toWebp(swatchRaw("denim", "#2B3A67", 1024, 1), 1024, 1024)).metadata();
    expect([swatch.width, swatch.height]).toEqual([1024, 1024]);
    const normal = normalRaw("pique");
    const rough = roughnessRaw("satin");
    expect(normal).toHaveLength(BASE * BASE * 3);
    expect(rough).toHaveLength(BASE * BASE * 3);
  });

  it("normal maps point mostly 'up' (blue channel high) and satin is glossier than felt", () => {
    const n = normalRaw("twill");
    let blue = 0;
    for (let i = 2; i < n.length; i += 3) blue += n[i]!;
    expect(blue / (n.length / 3)).toBeGreaterThan(150); // a flat surface would be 255
    const mean = (b: Buffer) => b.reduce((s, v) => s + v, 0) / b.length;
    expect(mean(roughnessRaw("satin"))).toBeLessThan(mean(roughnessRaw("felt")));
  });
});
