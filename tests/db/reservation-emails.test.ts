import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { actAs, asSuper, attempt, createFabric, createUser, pool, txn } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const queued = async (c: PoolClient, template: string, id: string) =>
  (await c.query(`select message from pgmq.q_q_email where message->>'template' = $1 and message->>'id' = $2`, [template, id])).rows.map((r) => r.message as { client_id: string; attempt: number });

describe("reserve_stock queues the confirmation email", () => {
  it("one 'reservation_created' email per reservation made through the function", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 100 });
      const client = await createUser("client", c);
      await actAs(c, "client", client);
      const id = (await c.query(`select id from public.reserve_stock($1, 10)`, [f.colorId])).rows[0].id as string;
      await asSuper(c);
      const messages = await queued(c, "reservation_created", id);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ client_id: client.clientId, attempt: 1 });
    });
  });

  it("a reservation made by staff for a client queues it for that client", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 100 });
      const client = await createUser("client", c);
      const sales = await createUser("sales", c);
      await actAs(c, "sales", sales);
      const id = (await c.query(`select id from public.reserve_stock($1, 10, $2)`, [f.colorId, client.clientId])).rows[0].id as string;
      await asSuper(c);
      expect((await queued(c, "reservation_created", id)).map((m) => m.client_id)).toEqual([client.clientId]);
    });
  });

  it("a refused reservation (limit, stock, minimum) queues nothing, and rows inserted directly stay silent", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 20 });
      const client = await createUser("client", c);
      await actAs(c, "client", client);
      expect((await attempt(c, `select public.reserve_stock($1, 500)`, [f.colorId])).error).toMatch(/not enough stock/);
      expect((await attempt(c, `select public.reserve_stock($1, 0.5)`, [f.colorId])).ok).toBe(false);
      await asSuper(c);
      const before = (await c.query(`select count(*)::int as n from pgmq.q_q_email where message->>'template' = 'reservation_created' and message->>'client_id' = $1`, [client.clientId])).rows[0].n;
      expect(before).toBe(0);
      await c.query(`insert into public.stock_reservations (color_id, client_id, meters, expires_at) values ($1, $2, 5, now() + interval '1 day')`, [f.colorId, client.clientId]);
      const after = (await c.query(`select count(*)::int as n from pgmq.q_q_email where message->>'template' = 'reservation_created' and message->>'client_id' = $1`, [client.clientId])).rows[0].n;
      expect(after).toBe(0);
    });
  });
});

describe("what the reservation pages may read", () => {
  it("the reservation length and the limit are public settings; the other private settings stay private", async () => {
    await txn(async (c) => {
      await actAs(c, "guest");
      const keys = (await c.query(`select key from public.public_settings`)).rows.map((r) => r.key as string);
      expect(keys).toEqual(expect.arrayContaining(["reservation_hours", "max_active_reservations_per_client"]));
      expect(keys).not.toContain("staff_notification_email");
      expect(keys).not.toContain("quote_validity_days");
    });
  });

  it("a client sees only their own reservations", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 100 });
      const a = await createUser("client", c);
      const b = await createUser("client", c);
      await actAs(c, "client", a);
      const mine = (await c.query(`select id from public.reserve_stock($1, 10)`, [f.colorId])).rows[0].id as string;
      await actAs(c, "client", b);
      expect((await c.query(`select id from public.stock_reservations where id = $1`, [mine])).rows).toHaveLength(0);
      expect((await attempt(c, `select public.cancel_reservation($1)`, [mine])).ok).toBe(false);
    });
  });
});
