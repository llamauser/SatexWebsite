import { deltaE00, hexToLab, type Lab } from "@/lib/color/lab";
import type { Candidate } from "@/lib/match/schema";

export interface PaletteColor { name: string; hex: string }

export function paletteDistance(hex: string, palette: PaletteColor[]): number {
  if (!palette.length) return Number.POSITIVE_INFINITY;
  const lab = hexToLab(hex);
  return Math.min(...palette.map((color) => deltaE00(lab, hexToLab(color.hex))));
}

export function paletteBonus(candidate: Candidate, palette: PaletteColor[]): number {
  return 0.1 * Math.max(0, 1 - paletteDistance(candidate.hex, palette) / 25);
}

export function paletteCoherence(chosen: Candidate[], palette: PaletteColor[], requiredMeters: number | readonly number[] = 0) {
  const distances = chosen.map((candidate) => paletteDistance(candidate.hex, palette));
  const requiredFor = (index: number) => typeof requiredMeters === "number" ? requiredMeters : (requiredMeters[index] ?? 0);
  return {
    paletteFit: distances.length > 0 && distances.every((distance) => distance < 15),
    supplierCoverage: chosen.length > 0 && chosen.every((candidate, index) => Number(candidate.available_m) >= requiredFor(index)),
    distinctFabrics: new Set(chosen.map((candidate) => candidate.fabric_id)).size,
  };
}

export function labDistance(hex: string, lab: Lab): number {
  return deltaE00(hexToLab(hex), lab);
}
