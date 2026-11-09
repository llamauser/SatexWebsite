import type { FeelScores } from "./feel";

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

export interface PhysicsParams {
  xpbd: { particleMass: number; stretchCompliance: number; shearCompliance: number; bendCompliance: number; damping: number; friction: number; airDrag: number };
  blender: { quality: number; massPerVertex: number; tensionStiffness: number; compressionStiffness: number; shearStiffness: number; bendingStiffness: number; tensionDamping: number; airDamping: number; selfCollision: boolean; selfCollisionDistance: number; selfCollisionFriction: number; collisionDistance: number };
  version: 1;
}

export function mapFeelToPhysics(feel: FeelScores, gsm: number, options: { gridSize?: number; avgVertexArea?: number } = {}): PhysicsParams {
  const n = options.gridSize ?? 30;
  const density = gsm / 1000;
  const stretchCompliance = 10 ** lerp(-8, -5, feel.stretch / 10);
  const tensionStiffness = lerp(40, 5, feel.stretch / 10);
  return {
    xpbd: {
      particleMass: density * (0.4 / Math.max(1, n - 1)) ** 2,
      stretchCompliance,
      shearCompliance: 10 * stretchCompliance,
      bendCompliance: 10 ** lerp(-5, -1, feel.drape / 10),
      damping: lerp(0.02, 0.005, feel.drape / 10),
      friction: lerp(0.6, 0.3, feel.sheen / 10),
      airDrag: 0.02 * Math.max(0.1, Math.min(1, 1 - gsm / 600)),
    },
    blender: {
      quality: 10,
      massPerVertex: density * (options.avgVertexArea ?? 0.00004),
      tensionStiffness,
      compressionStiffness: tensionStiffness,
      shearStiffness: tensionStiffness / 3,
      bendingStiffness: 10 ** lerp(1.7, -1.3, feel.drape / 10),
      tensionDamping: 5,
      airDamping: Math.max(0.5, 1 + 2 * (1 - gsm / 600)),
      selfCollision: true,
      selfCollisionDistance: 0.003,
      selfCollisionFriction: lerp(0.6, 0.3, feel.sheen / 10) * 10,
      collisionDistance: 0.005,
    },
    version: 1,
  };
}
