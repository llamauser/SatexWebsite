import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { actAs, asSuper, attempt, createFabric, createUser, pool, txn } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const exists = async (c: PoolClient, table: string, id: string) => (await c.query(`select 1 from public.${table} where id = $1`, [id])).rowCount === 1;

describe("purge_demo_data", () => {
  it("deletes demo fabrics (with their stock history), demo clients and their accounts, and leaves real data alone", async () => {
    await txn(async (c) => {
      const demo = await createFabric(c, { meters: 40 });
      const real = await createFabric(c, { meters: 40 });
      const demoClient = await createUser("client", c);
      const realClient = await createUser("client", c);
      const admin = await createUser("admin", c);
      await asSuper(c);
      await c.query(`update public.fabrics set is_demo = true where id = $1`, [demo.fabricId]);
      await c.query(`update public.clients set is_demo = true where id = $1`, [demoClient.clientId]);
      const demoQuote = (await c.query(`insert into public.quotes (client_id, is_demo) values ($1, true) returning id`, [demoClient.clientId])).rows[0].id as string;
      await c.query(`insert into public.quote_lines (quote_id, color_id, meters, unit_price) values ($1, $2, 5, 10)`, [demoQuote, demo.colorId]);
      const realQuote = (await c.query(`insert into public.quotes (client_id) values ($1) returning id`, [realClient.clientId])).rows[0].id as string;

      await actAs(c, "admin", admin);
      const result = (await c.query(`select public.purge_demo_data() as r`)).rows[0].r as Record<string, number>;
      expect(result.fabrics).toBeGreaterThanOrEqual(1);
      expect(result.clients).toBeGreaterThanOrEqual(1);
      expect(result.quotes).toBeGreaterThanOrEqual(1);

      await asSuper(c);
      expect(await exists(c, "fabrics", demo.fabricId)).toBe(false);
      expect(await exists(c, "fabric_colors", demo.colorId)).toBe(false);
      expect((await c.query(`select 1 from public.stock_lots where color_id = $1`, [demo.colorId])).rowCount).toBe(0);
      expect(await exists(c, "quotes", demoQuote)).toBe(false);
      expect(await exists(c, "clients", demoClient.clientId)).toBe(false);
      expect((await c.query(`select 1 from auth.users where id = $1`, [demoClient.id])).rowCount).toBe(0);

      expect(await exists(c, "fabrics", real.fabricId)).toBe(true);
      expect((await c.query(`select 1 from public.stock_lots where color_id = $1`, [real.colorId])).rowCount).toBe(1);
      expect(await exists(c, "quotes", realQuote)).toBe(true);
      expect(await exists(c, "clients", realClient.clientId)).toBe(true);
      expect((await c.query(`select 1 from auth.users where id in ($1, $2)`, [realClient.id, admin.id])).rowCount).toBe(2);
      // the append-only guard on stock movements is back in place
      expect((await attempt(c, `update public.stock_movements set reason = 'x'`)).error).toMatch(/append-only/);
    });
  });

  it("keeps a demo fabric that a real quote still points at, and says so", async () => {
    await txn(async (c) => {
      const demo = await createFabric(c, { meters: 40 });
      const realClient = await createUser("client", c);
      const admin = await createUser("admin", c);
      await asSuper(c);
      await c.query(`update public.fabrics set is_demo = true where id = $1`, [demo.fabricId]);
      const q = (await c.query(`insert into public.quotes (client_id) values ($1) returning id`, [realClient.clientId])).rows[0].id as string;
      await c.query(`insert into public.quote_lines (quote_id, color_id, meters, unit_price) values ($1, $2, 5, 10)`, [q, demo.colorId]);

      await actAs(c, "admin", admin);
      const result = (await c.query(`select public.purge_demo_data() as r`)).rows[0].r as Record<string, number>;
      expect(result.fabrics_kept).toBeGreaterThanOrEqual(1);
      await asSuper(c);
      expect(await exists(c, "fabrics", demo.fabricId)).toBe(true);
      expect(await exists(c, "quotes", q)).toBe(true);
    });
  });

  it("is for admins only", async () => {
    await txn(async (c) => {
      const sales = await createUser("sales", c);
      const client = await createUser("client", c);
      await actAs(c, "sales", sales);
      expect((await attempt(c, `select public.purge_demo_data()`)).error).toMatch(/admin only/);
      await actAs(c, "client", client);
      expect((await attempt(c, `select public.purge_demo_data()`)).ok).toBe(false);
      await actAs(c, "guest");
      expect((await attempt(c, `select public.purge_demo_data()`)).ok).toBe(false);
    });
  });
});
