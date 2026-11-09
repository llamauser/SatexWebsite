import type { GarmentConsumption, Size } from "./garments";

export function calculateMeters(
  sizeRun: Partial<Record<Size, number>>,
  garment: GarmentConsumption,
  fabricWidthCm: number,
  moqM: number,
): number {
  const consumed = Object.entries(sizeRun).reduce((sum, [size, quantity]) => {
    const factor = garment.size_factors[size] ?? 1;
    return sum + Math.max(0, Number(quantity) || 0) * garment.base_m_per_unit * factor;
  }, 0);
  const raw = consumed * (garment.ref_width_cm / Math.max(1, fabricWidthCm)) * 1.08;
  return Math.max(moqM, Math.ceil(raw * 2) / 2);
}
