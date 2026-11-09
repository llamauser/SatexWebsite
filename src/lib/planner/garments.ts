import { z } from "zod";

export const SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export type Size = (typeof SIZES)[number];

export const GarmentConsumptionSchema = z.object({
  garment_type: z.string().min(1),
  base_m_per_unit: z.coerce.number().positive(),
  ref_width_cm: z.coerce.number().positive(),
  size_factors: z.record(z.string(), z.coerce.number().positive()),
});
export type GarmentConsumption = z.infer<typeof GarmentConsumptionSchema>;

export function evenSizeRun(quantity: number, sizes: readonly Size[] = SIZES): Record<Size, number> {
  const total = Math.max(0, Math.floor(quantity));
  const base = Math.floor(total / sizes.length);
  let remainder = total % sizes.length;
  return Object.fromEntries(sizes.map((size) => [size, base + (remainder-- > 0 ? 1 : 0)])) as Record<Size, number>;
}

export const DEFAULT_GARMENT_SPECS: Record<string, { uses: string[]; query: string }> = {
  t_shirt: { uses: ["t_shirts"], query: "comfortable breathable jersey for t-shirts" },
  polo: { uses: ["polos"], query: "structured breathable polo fabric" },
  shirt: { uses: ["shirts"], query: "versatile woven shirting fabric" },
  dress_short: { uses: ["dresses"], query: "fluid fabric for short dresses" },
  dress_long: { uses: ["dresses"], query: "fluid elegant fabric for long dresses" },
  skirt: { uses: ["skirts"], query: "fluid or structured fabric for skirts" },
  trousers: { uses: ["trousers"], query: "durable fabric for trousers" },
  shorts: { uses: ["trousers"], query: "light durable fabric for shorts" },
  jeans: { uses: ["jeans"], query: "durable denim for jeans" },
  jacket: { uses: ["jackets"], query: "structured fabric for jackets" },
  coat: { uses: ["coats"], query: "warm durable fabric for coats" },
  hoodie: { uses: ["t_shirts"], query: "soft comfortable sweatshirt fabric" },
  leggings: { uses: ["activewear"], query: "stretch fabric for leggings" },
  sports_bra: { uses: ["activewear"], query: "high stretch activewear fabric" },
  swimsuit: { uses: ["swimwear"], query: "smooth high stretch swimwear fabric" },
  cushion_cover: { uses: ["upholstery"], query: "durable upholstery fabric" },
  curtain_panel: { uses: ["curtains"], query: "stable fabric for curtains" },
};
