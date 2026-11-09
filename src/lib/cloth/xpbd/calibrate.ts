import type { FeelScores } from "../feel";
import { CLOTH_SIZE, type XpbdParameters } from "./solver.cpu";

/** Calibrated so that a pulled or dropped swatch settles in a swing or two instead of ringing (see tests/unit/cloth-solver.test.ts). */
const INTERNAL_DAMPING = 60;
const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

/**
 * From the feel scores and the weight of a fabric to the constants of the browser solver. The ranges are calibrated against the solver itself
 * (tests/unit/cloth-solver.test.ts measures them): how much a hanging swatch stretches under its own weight, and how far it spreads when it
 * is dropped on a sphere. Compliances are in m/N, so they only make sense next to the mass of a particle (density x cell area).
 */
export function solverParams(feel: FeelScores, gsm: number, n: number, stretchLimitPct: number | null = null): XpbdParameters {
  const cell = CLOTH_SIZE / (n - 1);
  const stretch = feel.stretch / 10;
  const drape = feel.drape / 10;
  const sheen = feel.sheen / 10;
  const stretchCompliance = 10 ** lerp(-3.0, -0.5, stretch ** 0.7);
  return {
    particleMass: (gsm / 1000) * cell * cell,
    stretchCompliance,
    shearCompliance: stretchCompliance * 3,
    bendCompliance: 10 ** lerp(-3.0, 1.5, drape ** 0.8),
    damping: lerp(2.5, 5.5, drape), // light, fluid cloth is held back by the air much more than a heavy, stiff one
    internalDamping: INTERNAL_DAMPING,
    friction: lerp(3.5, 2, sheen), // position-based Coulomb friction counts only the light pressure of a cloth lying on a surface, so the values are high; calibrated so a cloth stays on the ball and its sides hang down
    airDrag: 1,
    // the stretch of the fabric when it is known (the catalog has it), else what its stretch score suggests
    maxStrain: stretchLimitPct !== null && stretchLimitPct > 0 ? stretchLimitPct / 100 : lerp(0.04, 0.4, stretch),
  };
}
