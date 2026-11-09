import { afterAll, describe, expect, it } from "vitest";
import { actAs, asSuper, attempt, createFabric, createUser, pool, txn } from "./helpers";

afterAll(async () => { await pool.end(); });

describe("collection planner ownership and quote handoff", () => {
  it("keeps collections and items private to the client while allowing staff reads", async () => {
    await txn(async (c) => {
      const owner = await createUser("client", c);
      const another = await createUser("client", c);
      const sales = await createUser("sales", c);
      const fabric = await createFabric(c, { meters: 100 });
      await asSuper(c);
      const id = (await c.query(`insert into public.collections (client_id, name, status) values ($1, 'Private line', 'planned') returning id`, [owner.clientId])).rows[0].id as string;
      const itemId = (await c.query(`insert into public.collection_items (collection_id, garment_type, quantity_units, chosen_color_id, meters_needed) values ($1, 't_shirt', 4, $2, 5) returning id`, [id, fabric.colorId])).rows[0].id as string;

      await actAs(c, "client", owner);
      expect((await c.query(`select id from public.collections where id = $1`, [id])).rowCount).toBe(1);
      expect((await c.query(`select id from public.collection_items where id = $1`, [itemId])).rowCount).toBe(1);
      await actAs(c, "client", another);
      expect((await c.query(`select id from public.collections where id = $1`, [id])).rowCount).toBe(0);
      expect((await c.query(`select id from public.collection_items where id = $1`, [itemId])).rowCount).toBe(0);
      expect((await attempt(c, `update public.collection_items set label = 'stolen' where id = $1`, [itemId])).ok).toBe(false);
      expect((await attempt(c, `update public.collections set name = 'stolen' where id = $1`, [id])).ok).toBe(false);
      await actAs(c, "sales", sales);
      expect((await c.query(`select id from public.collections where id = $1`, [id])).rowCount).toBe(1);
      expect((await c.query(`select id from public.collection_items where id = $1`, [itemId])).rowCount).toBe(1);
    });
  });

  it("creates a submitted quote with per-color meterage totals, queues both emails, and rejects repeat or foreign requests", async () => {
    await txn(async (c) => {
      const owner = await createUser("client", c);
      const another = await createUser("client", c);
      const fabric = await createFabric(c, { meters: 100 });
      await asSuper(c);
      const id = (await c.query(`insert into public.collections (client_id, name, status) values ($1, 'Summer line', 'planned') returning id`, [owner.clientId])).rows[0].id as string;
      await c.query(`insert into public.collection_items (collection_id, garment_type, quantity_units, chosen_color_id, meters_needed, sort) values ($1, 't_shirt', 10, $2, 6, 0), ($1, 'shirt', 2, $2, 9, 1)`, [id, fabric.colorId]);

      await actAs(c, "client", another);
      const foreign = await attempt(c, `select (public.request_collection_quote($1, 'Not mine')).id`, [id]);
      expect(foreign.ok).toBe(false);
      expect(foreign.error).toMatch(/not allowed/);
      await actAs(c, "client", owner);
      const { rows } = await c.query(`select (public.request_collection_quote($1, 'Please review this collection')).id as id`, [id]);
      const quoteId = rows[0]!.id as string;
      await asSuper(c);
      const quote = (await c.query(`select status, source, collection_id, client_message from public.quotes where id = $1`, [quoteId])).rows[0];
      expect(quote).toMatchObject({ status: "submitted", source: "planner", collection_id: id, client_message: "Please review this collection" });
      const lines = (await c.query(`select color_id, meters::float as meters, unit_price::float as unit_price from public.quote_lines where quote_id = $1`, [quoteId])).rows;
      expect(lines).toEqual([{ color_id: fabric.colorId, meters: 6, unit_price: 10 }, { color_id: fabric.colorId, meters: 9, unit_price: 10 }]);
      const emails = (await c.query(`select message->>'template' as template from pgmq.q_q_email where message->>'id' = $1 order by message->>'template'`, [quoteId])).rows.map((row) => row.template);
      expect(emails).toEqual(["quote_submitted_client", "quote_submitted_staff"]);
      expect((await c.query(`select status, quote_id from public.collections where id = $1`, [id])).rows[0]).toEqual({ status: "quoted", quote_id: quoteId });
      await actAs(c, "client", owner);
      const repeated = await attempt(c, `select public.request_collection_quote($1, null)`, [id]);
      expect(repeated.ok).toBe(false);
      expect(repeated.error).toMatch(/already has a quote/);
    });
  });
});
