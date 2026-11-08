import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asSuper, attempt, createFabric, createUser, pool, txn, type TestUser } from "./helpers";

let sales: TestUser, clientA: TestUser, clientB: TestUser;

beforeAll(async () => {
  [sales, clientA, clientB] = await Promise.all([createUser("sales"), createUser("client"), createUser("client")]);
});
afterAll(async () => {
  await pool.end();
});

// internal view: super-user context only (resets any role set by actAs; re-call actAs afterwards)
const available = async (c: import("pg").PoolClient, colorId: string) => {
  await asSuper(c);
  return Number((await c.query(`select available_m from public.v_color_availability_all where color_id = $1`, [colorId])).rows[0].available_m);
};

describe("stock lots and movements", () => {
  it("meters change only through movements", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 100 });
      await asSuper(c);
      const direct = await attempt(c, `update public.stock_lots set meters = 500 where color_id = $1`, [f.colorId]);
      expect(direct.ok).toBe(false);
      expect(direct.error).toMatch(/only change through stock_movements/);

      const bad = await attempt(c, `insert into public.stock_lots (color_id, lot_code, meters) values ($1, 'X-1', 10)`, [f.colorId]);
      expect(bad.ok).toBe(false);

      const lot = (await c.query(`select id from public.stock_lots where color_id = $1`, [f.colorId])).rows[0].id;
      await c.query(`select public.adjust_stock($1, -30, 'inventory correction')`, [lot]);
      expect(await available(c, f.colorId)).toBe(70);
    });
  });

  it("cannot overdraw a lot, and movements are append-only", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 20 });
      await asSuper(c);
      const lot = (await c.query(`select id from public.stock_lots where color_id = $1`, [f.colorId])).rows[0].id;
      const over = await attempt(c, `select public.adjust_stock($1, -21, 'oops')`, [lot]);
      expect(over.ok).toBe(false);
      const del = await attempt(c, `delete from public.stock_movements where lot_id = $1`, [lot]);
      expect(del.ok).toBe(false);
      expect(del.error).toMatch(/append-only/);
      const noReason = await attempt(c, `select public.adjust_stock($1, -1, '')`, [lot]);
      expect(noReason.ok).toBe(false);
    });
  });

  it("adjust_stock / receive_lot are staff only", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 10 });
      const lot = (await c.query(`select id from public.stock_lots where color_id = $1`, [f.colorId])).rows[0].id;
      await actAs(c, "client", clientA);
      expect((await attempt(c, `select public.adjust_stock($1, 5, 'x')`, [lot])).ok).toBe(false);
      expect((await attempt(c, `select public.receive_lot($1, 'L-9', 5)`, [f.colorId])).ok).toBe(false);
      await actAs(c, "sales", sales);
      expect((await attempt(c, `select public.adjust_stock($1, 5, 'recount')`, [lot])).ok).toBe(true);
    });
  });
});

describe("reservations", () => {
  it("a client can reserve; availability drops; hours come from settings", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 100 });
      await actAs(c, "client", clientA);
      const r = await c.query(`select * from public.reserve_stock($1, 30)`, [f.colorId]);
      expect(r.rows[0].status).toBe("active");
      expect(r.rows[0].client_id).toBe(clientA.clientId);
      const hours = (new Date(r.rows[0].expires_at).getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(47.9);
      expect(hours).toBeLessThan(48.1);
      expect(await available(c, f.colorId)).toBe(70);
      await actAs(c, "client", clientA);
      // the client also sees it
      expect((await c.query(`select 1 from public.stock_reservations`)).rowCount).toBe(1);
      await actAs(c, "client", clientB);
      expect((await c.query(`select 1 from public.stock_reservations`)).rowCount).toBe(0);
    });
  });

  it("rejects guests, quantities below MOQ, and quantities above availability", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 100, moq: 5 });
      await actAs(c, "guest");
      expect((await attempt(c, `select public.reserve_stock($1, 10)`, [f.colorId])).ok).toBe(false);
      await actAs(c, "client", clientA);
      const low = await attempt(c, `select public.reserve_stock($1, 4)`, [f.colorId]);
      expect(low.error).toMatch(/minimum order quantity/);
      const high = await attempt(c, `select public.reserve_stock($1, 101)`, [f.colorId]);
      expect(high.error).toMatch(/not enough stock/);
    });
  });

  it("enforces the per-client active reservation limit (3)", async () => {
    await txn(async (c) => {
      const fs = [await createFabric(c, { meters: 50 }), await createFabric(c, { meters: 50 }), await createFabric(c, { meters: 50 }), await createFabric(c, { meters: 50 })];
      const user = await createUser("client", c);
      await actAs(c, "client", user);
      for (const f of fs.slice(0, 3)) expect((await attempt(c, `select public.reserve_stock($1, 5)`, [f.colorId])).ok).toBe(true);
      const fourth = await attempt(c, `select public.reserve_stock($1, 5)`, [fs[3]!.colorId]);
      expect(fourth.error).toMatch(/limit reached/);
    });
  });

  it("owner and staff can cancel; another client cannot", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 100 });
      await actAs(c, "client", clientA);
      const id = (await c.query(`select id from public.reserve_stock($1, 10)`, [f.colorId])).rows[0].id;
      await actAs(c, "client", clientB);
      expect((await attempt(c, `select public.cancel_reservation($1)`, [id])).ok).toBe(false);
      await actAs(c, "client", clientA);
      expect((await attempt(c, `select public.cancel_reservation($1)`, [id])).ok).toBe(true);
      expect(await available(c, f.colorId)).toBe(100);
      await actAs(c, "client", clientA);
      // already cancelled
      expect((await attempt(c, `select public.cancel_reservation($1)`, [id])).error).toMatch(/not active/);
    });
  });

  it("staff can reserve on behalf of a client", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 100 });
      await actAs(c, "sales", sales);
      const r = await c.query(`select client_id from public.reserve_stock($1, 10, $2)`, [f.colorId, clientA.clientId]);
      expect(r.rows[0].client_id).toBe(clientA.clientId);
    });
  });

  it("expiry and reminders use the injected clock and enqueue emails", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 100 });
      await actAs(c, "client", clientA);
      const resId = (await c.query(`select id from public.reserve_stock($1, 10)`, [f.colorId])).rows[0].id as string;
      await asSuper(c);
      const state = async () =>
        (await c.query(`select status, reminded_at from public.stock_reservations where id = $1`, [resId])).rows[0];
      const queued = async (template: string) =>
        (
          await c.query(
            `select count(*)::int as n from pgmq.q_q_email where message->>'template' = $1 and message->>'id' = $2`,
            [template, resId],
          )
        ).rows[0].n;

      // 43h later: inside the 6h window before expiry -> reminded once (other reservations in the DB may be reminded too)
      const t43 = new Date(Date.now() + 43 * 3_600_000).toISOString();
      expect((await c.query(`select public.remind_reservations($1) as n`, [t43])).rows[0].n).toBeGreaterThanOrEqual(1);
      expect((await state()).reminded_at).not.toBeNull();
      expect(await queued("reservation_expiring")).toBe(1);
      await c.query(`select public.remind_reservations($1)`, [t43]);
      expect(await queued("reservation_expiring")).toBe(1); // never reminded twice
      await c.query(`select public.expire_reservations($1)`, [t43]);
      expect((await state()).status).toBe("active"); // not expired yet
      expect(await available(c, f.colorId)).toBe(90);

      // 49h later: expired, stock released
      const t49 = new Date(Date.now() + 49 * 3_600_000).toISOString();
      expect((await c.query(`select public.expire_reservations($1) as n`, [t49])).rows[0].n).toBeGreaterThanOrEqual(1);
      expect((await state()).status).toBe("expired");
      expect(await queued("reservation_expired")).toBe(1);
      expect(await available(c, f.colorId)).toBe(100);
    });
  });

  it("never oversells under concurrency (10 clients race for 100 m, 20 m each -> exactly 5 win)", async () => {
    const setup = await txn(async (c) => {
      const f = await createFabric(c, { meters: 100 });
      const users: TestUser[] = [];
      for (let i = 0; i < 10; i++) users.push(await createUser("client", c));
      return { f, users };
    }, true);

    const results = await Promise.all(
      setup.users.map((u) =>
        txn(async (c) => {
          await actAs(c, "client", u);
          return attempt(c, `select public.reserve_stock($1, 20)`, [setup.f.colorId]);
        }, true),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok).every((r) => /not enough stock/.test(r.error))).toBe(true);

    await txn(async (c) => {
      await asSuper(c);
      expect(await available(c, setup.f.colorId)).toBe(0);
    });
  });
});
