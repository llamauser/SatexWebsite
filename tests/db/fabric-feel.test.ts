import { afterAll, describe, expect, it } from "vitest";
import { asSuper, createFabric, pool, txn } from "./helpers";

afterAll(async () => { await pool.end(); });

describe("fabric feel profile triggers", () => {
  it("estimates profile scores and stores versioned browser and Blender parameters", async () => {
    await txn(async (c) => {
      const fabric = await createFabric(c);
      const read = async () => (await c.query(`select ff.softness, ff.drape, ff.stretch, ff.sheen, ff.breathability, ff.is_measured,
        ff.sim_params->>'version' as version, ff.sim_params->'xpbd' as xpbd, ff.sim_params->'blender' as blender
        from public.fabric_feel ff where ff.fabric_id = $1`, [fabric.fabricId])).rows[0];
      const initial = await read();
      expect(initial).toMatchObject({ is_measured: false, version: "1" });
      expect(Number(initial.softness)).toBeGreaterThanOrEqual(0);
      expect(Number(initial.softness)).toBeLessThanOrEqual(10);
      expect(Number(initial.drape)).toBeGreaterThan(0);
      expect(Number(initial.stretch)).toBeGreaterThan(0);
      expect(initial.xpbd).toMatchObject({ stretchCompliance: expect.any(Number), particleMass: expect.any(Number), airDrag: expect.any(Number) });
      expect(initial.blender).toMatchObject({ quality: 10, bendingStiffness: expect.any(Number), selfCollision: true });

      await asSuper(c);
      await c.query(`update public.fabrics set gsm = 400, composition = '[{"fiber":"silk","pct":100}]', structure = 'satin', construction = 'woven', stretch = 'four_way', stretch_pct = 30, finish = array['mercerized'] where id = $1`, [fabric.fabricId]);
      const updated = await read();
      expect(Number(updated.sheen)).toBe(10);
      expect(Number(updated.breathability)).toBeLessThan(Number(initial.breathability));
      expect(updated.xpbd).not.toEqual(initial.xpbd);

      await c.query(`update public.fabric_feel set is_measured = true, softness = 6, drape = 4, stretch = 3, sheen = 2, breathability = 7 where fabric_id = $1`, [fabric.fabricId]);
      await c.query(`update public.fabrics set gsm = 420 where id = $1`, [fabric.fabricId]);
      const measured = await read();
      expect(measured).toMatchObject({ is_measured: true, softness: 6, drape: 4, stretch: 3, sheen: 2, breathability: 7 });
      expect(measured.xpbd).not.toEqual(updated.xpbd);
    });
  });
});
