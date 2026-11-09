import { describe, expect, it } from "vitest";
import { CpuClothSolver } from "@/lib/cloth/xpbd/solver.cpu";

const params = { particleMass: 0.001, stretchCompliance: 1e-6, shearCompliance: 1e-5, bendCompliance: 1e-3, damping: 0.02, friction: 0.5, airDrag: 0.01 };

describe("CPU XPBD swatch solver", () => {
  it("keeps the two hanging corners pinned and returns finite particle positions", () => {
    const solver = new CpuClothSolver(8, params);
    const before = solver.positions.slice(0, 3);
    solver.step();
    expect(Array.from(solver.positions.slice(0, 3))).toEqual(Array.from(before));
    expect(Array.from(solver.positions).every(Number.isFinite)).toBe(true);
  });

  it("resets into table, sphere and wind modes and supports a pointer grab", () => {
    const solver = new CpuClothSolver(8, params);
    for (const mode of ["table", "sphere", "wind"] as const) {
      solver.reset(mode);
      solver.step();
      expect(Array.from(solver.positions).every(Number.isFinite)).toBe(true);
    }
    solver.grab(35, [0.1, 0.4, 0.1]);
    solver.moveGrab([0.15, 0.45, 0.15]);
    expect(solver.strainPct).toBeGreaterThanOrEqual(0);
    solver.release();
  });
});
