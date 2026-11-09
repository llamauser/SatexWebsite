/**
 * The soft dark patch under a piece of furniture (the sun's shadow does not darken the floor right under an object, which makes it look as if it floated).
 * `contactShadowAlpha` is the darkness of a patch at a point of its texture: a rounded rectangle that fades out towards its outline.
 */
export const SHADOW_STRENGTH = 0.34;

/** u, v in [0, 1] across the patch; `margin` is the share of the patch taken by the fade (the object itself sits inside the rest). */
export function contactShadowAlpha(u: number, v: number, margin = 0.28): number {
  const x = Math.abs(u - 0.5) * 2, y = Math.abs(v - 0.5) * 2; // 0 in the middle, 1 at the outline
  const inner = 1 - margin;
  const radius = 0.35;
  // distance outside a rounded box of half-size `inner` (signed distance, 0 on its edge)
  const qx = Math.max(0, x - (inner - radius)), qy = Math.max(0, y - (inner - radius));
  const outside = Math.hypot(qx, qy) - radius;
  if (outside <= 0) return SHADOW_STRENGTH;
  const t = Math.min(1, outside / margin);
  const smooth = t * t * (3 - 2 * t);
  return SHADOW_STRENGTH * (1 - smooth);
}

/** Draws the patch (browser only): black with the alpha above. */
export function contactShadowCanvas(size = 96): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      image.data[o] = 12; image.data[o + 1] = 18; image.data[o + 2] = 28;
      image.data[o + 3] = Math.round(255 * contactShadowAlpha((x + 0.5) / size, (y + 0.5) / size));
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Props that stand on the floor and are big enough to need a patch; things on shelves, on seats or hanging do not get one. */
export const SHADOWED_PROPS = new Set([
  "rack_bay", "cutting_table", "pallet_load", "forklift", "desk", "meeting_table", "sofa", "armchair", "coffee_table", "cabinet", "plant_tall", "plant_wide", "plant_small",
  "chair", "hand_truck", "crate", "box", "mannequin", "screen", "person_standing", "person_walking", "person_seated", "person_holding",
]);
