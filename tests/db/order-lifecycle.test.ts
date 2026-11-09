import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { actAs, asSuper, attempt, createFabric, createUser, pool, txn } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const queued = async (c: PoolClient, template: string, id: string) =>
  (await c.query(`select message->>'key' as key from pgmq.q_q_email where message->>'template' = $1 and message->>'id' = $2 order by msg_id`, [template, id])).rows.map((r) => r.key as string | null);

/** An order of two lines (10 m and 15 m) made from an accepted quote, with 100 m of stock behind each line. */
async function order(c: PoolClient) {
  const client = await createUser("client", c);
  const sales = await createUser("sales", c);
  const f1 = await createFabric(c, { meters: 100 });
  const f2 = await createFabric(c, { meters: 100 });
  await asSuper(c);
  const q = (await c.query(`insert into public.quotes (client_id, status) values ($1, 'accepted') returning id`, [client.clientId])).rows[0].id as string;
  await c.query(`insert into public.quote_lines (quote_id, color_id, meters, unit_price, sort) values ($1, $2, 10, 5, 0), ($1, $3, 15, 6, 1)`, [q, f1.colorId, f2.colorId]);
  await actAs(c, "sales", sales);
  const o = (await c.query(`select * from public.convert_quote_to_order($1)`, [q])).rows[0] as { id: string; client_id: string };
  await asSuper(c);
  const jobs = (await c.query(`select cj.id, cj.planned_m::float as planned, ol.color_id from public.cutting_jobs cj join public.order_lines ol on ol.id = cj.order_line_id where ol.order_id = $1 order by cj.planned_m`, [o.id])).rows as { id: string; planned: number; color_id: string }[];
  const lots = (await c.query(`select id, color_id from public.stock_lots where color_id = any ($1)`, [[f1.colorId, f2.colorId]])).rows as { id: string; color_id: string }[];
  return { o, client, sales, jobs, lots, f1, f2 };
}
const orderRow = async (c: PoolClient, id: string) => (await c.query(`select status, cancelled_reason from public.orders where id = $1`, [id])).rows[0] as { status: string; cancelled_reason: string | null };
const available = async (c: PoolClient, colorId: string) => Number((await c.query(`select available_m from public.v_color_availability_all where color_id = $1`, [colorId])).rows[0].available_m);

describe("cutting moves the order forward by itself", () => {
  it("first cut -> in preparation; all cuts done -> ready (one e-mail); the lot and the allocation follow the real cut", async () => {
    await txn(async (c) => {
      const { o, sales, jobs, lots } = await order(c);
      await actAs(c, "sales", sales);
      const lotFor = (colorId: string) => lots.find((l) => l.color_id === colorId)!.id;

      await c.query(`select public.start_cut($1, $2)`, [jobs[0]!.id, lotFor(jobs[0]!.color_id)]);
      expect((await orderRow(c, o.id)).status).toBe("in_preparation");
      await c.query(`select public.record_cut($1, 10.5)`, [jobs[0]!.id]); // 0.5 m more than planned
      expect((await orderRow(c, o.id)).status).toBe("in_preparation"); // one job is still waiting

      await c.query(`select public.start_cut($1, $2)`, [jobs[1]!.id, lotFor(jobs[1]!.color_id)]);
      await c.query(`select public.record_cut($1, 15)`, [jobs[1]!.id]);
      expect((await orderRow(c, o.id)).status).toBe("ready");
      await asSuper(c);
      expect(await queued(c, "order_ready", o.id)).toHaveLength(1);
      // 100 - 10.5 on hand, nothing allocated any more
      expect(await available(c, jobs[0]!.color_id)).toBe(89.5);
      expect(Number((await c.query(`select cut_m from public.cutting_jobs where id = $1`, [jobs[0]!.id])).rows[0].cut_m)).toBe(10.5);
    });
  });

  it("a lot that is too small cannot be used", async () => {
    await txn(async (c) => {
      const { sales, jobs, lots, f1 } = await order(c);
      await asSuper(c);
      await c.query(`select public.adjust_stock($1, -95, 'test')`, [lots.find((l) => l.color_id === f1.colorId)!.id]);
      await actAs(c, "sales", sales);
      const job = jobs.find((j) => j.color_id === f1.colorId)!;
      expect((await attempt(c, `select public.start_cut($1, $2)`, [job.id, lots.find((l) => l.color_id === f1.colorId)!.id])).error).toMatch(/not enough meters/);
    });
  });
});

describe("set_order_status", () => {
  it("start, ready, and the limits of both", async () => {
    await txn(async (c) => {
      const { o, sales } = await order(c);
      await actAs(c, "sales", sales);
      expect((await attempt(c, `select public.set_order_status($1, 'shipped')`, [o.id])).error).toMatch(/cannot go from confirmed to shipped/);
      expect((await attempt(c, `select public.set_order_status($1, 'delivered')`, [o.id])).ok).toBe(false);
      await c.query(`select public.set_order_status($1, 'in_preparation')`, [o.id]);
      expect((await attempt(c, `select public.set_order_status($1, 'in_preparation')`, [o.id])).ok).toBe(false);
      await c.query(`select public.set_order_status($1, 'ready')`, [o.id]);
      expect((await orderRow(c, o.id)).status).toBe("ready");
      await asSuper(c);
      expect(await queued(c, "order_ready", o.id)).toHaveLength(1);
    });
  });

  it("cancelling needs a reason, gives the stock back, stops the unfinished cuts and the open delivery", async () => {
    await txn(async (c) => {
      const { o, sales, jobs, f1, f2 } = await order(c);
      await asSuper(c);
      expect([await available(c, f1.colorId), await available(c, f2.colorId)]).toEqual([90, 85]); // held for the order
      await actAs(c, "sales", sales);
      expect((await attempt(c, `select public.set_order_status($1, 'cancelled')`, [o.id])).error).toMatch(/reason is required/);
      expect((await attempt(c, `select public.set_order_status($1, 'cancelled', '  ')`, [o.id])).ok).toBe(false);
      const r = (await c.query(`select * from public.set_order_status($1, 'cancelled', 'Client a renoncé')`, [o.id])).rows[0];
      expect(r).toMatchObject({ status: "cancelled", cancelled_reason: "Client a renoncé" });
      await asSuper(c);
      expect([await available(c, f1.colorId), await available(c, f2.colorId)]).toEqual([100, 100]);
      const states = (await c.query(`select status from public.cutting_jobs where id = any ($1)`, [jobs.map((j) => j.id)])).rows.map((x) => x.status);
      expect(states).toEqual(["cancelled", "cancelled"]);
      await actAs(c, "sales", sales);
      expect((await attempt(c, `select public.set_order_status($1, 'cancelled', 'again')`, [o.id])).error).toMatch(/cannot be cancelled once/);
    });
  });
});

describe("deliveries", () => {
  async function readyOrder(c: PoolClient) {
    const s = await order(c);
    await actAs(c, "sales", s.sales);
    await c.query(`select public.set_order_status($1, 'ready')`, [s.o.id]);
    return s;
  }
  const delivery = async (c: PoolClient, id: string) => (await c.query(`select status, carrier, tracking_number, delivered_at, failure_reason from public.deliveries where id = $1`, [id])).rows[0];

  it("only a ready order gets a delivery, and only one open delivery at a time", async () => {
    await txn(async (c) => {
      const s = await order(c);
      await actAs(c, "sales", s.sales);
      expect((await attempt(c, `select public.create_delivery($1, 'Colissimo', 'X1', current_date)`, [s.o.id])).error).toMatch(/only be created for a ready order/);
      await c.query(`select public.set_order_status($1, 'ready')`, [s.o.id]);
      expect((await attempt(c, `select public.create_delivery($1)`, [s.o.id])).ok).toBe(true);
      expect((await attempt(c, `select public.create_delivery($1)`, [s.o.id])).error).toMatch(/already has an open delivery/);
    });
  });

  it("scheduled -> in transit -> delivered carries the order along and e-mails the client at each step", async () => {
    await txn(async (c) => {
      const s = await readyOrder(c);
      const d = (await c.query(`select id from public.create_delivery($1, null, null, current_date + 2)`, [s.o.id])).rows[0].id as string;
      expect((await attempt(c, `select public.set_delivery_status($1, 'in_transit')`, [d])).error).toMatch(/carrier and a tracking number/);
      await c.query(`update public.deliveries set carrier = 'Colissimo', tracking_number = '6A02001' where id = $1`, [d]);
      expect((await attempt(c, `select public.set_delivery_status($1, 'delivered')`, [d])).error).toMatch(/cannot go from scheduled to delivered/);

      await c.query(`select public.set_delivery_status($1, 'in_transit')`, [d]);
      expect((await orderRow(c, s.o.id)).status).toBe("shipped");
      await c.query(`select public.set_delivery_status($1, 'delivered')`, [d]);
      expect((await orderRow(c, s.o.id)).status).toBe("delivered");
      expect((await delivery(c, d)).delivered_at).not.toBeNull();
      expect((await attempt(c, `select public.set_delivery_status($1, 'failed', 'x')`, [d])).ok).toBe(false); // final

      await asSuper(c);
      expect(await queued(c, "delivery_in_transit", d)).toEqual(["in_transit"]);
      expect(await queued(c, "delivery_delivered", d)).toEqual(["delivered"]);
    });
  });

  it("a failed delivery needs a reason, sends the order back to 'ready', and can be scheduled again", async () => {
    await txn(async (c) => {
      const s = await readyOrder(c);
      const d = (await c.query(`select id from public.create_delivery($1, 'Colissimo', 'T1', null)`, [s.o.id])).rows[0].id as string;
      await c.query(`select public.set_delivery_status($1, 'in_transit')`, [d]);
      expect((await attempt(c, `select public.set_delivery_status($1, 'failed')`, [d])).error).toMatch(/reason is required/);
      await c.query(`select public.set_delivery_status($1, 'failed', 'Adresse introuvable')`, [d]);
      expect(await delivery(c, d)).toMatchObject({ status: "failed", failure_reason: "Adresse introuvable" });
      expect((await orderRow(c, s.o.id)).status).toBe("ready");
      expect((await attempt(c, `select public.create_delivery($1, 'Colissimo', 'T2', current_date + 1)`, [s.o.id])).ok).toBe(true);
    });
  });
});

describe("access and dashboard", () => {
  it("clients cannot use any of these functions", async () => {
    await txn(async (c) => {
      const { o, client } = await order(c);
      await actAs(c, "client", client);
      for (const sql of [`select public.set_order_status($1, 'ready')`, `select public.create_delivery($1)`, `select public.admin_dashboard()`]) {
        expect((await attempt(c, sql, [sql.includes("dashboard") ? [] : o.id].flat())).ok).toBe(false);
      }
    });
  });

  it("the dashboard counts what waits for sales", async () => {
    await txn(async (c) => {
      await asSuper(c);
      const sales = await createUser("sales", c);
      const client = await createUser("client", c);
      await actAs(c, "sales", sales);
      const before = (await c.query(`select public.admin_dashboard() as k`)).rows[0].k as Record<string, number | string>;
      await asSuper(c);
      await c.query(`insert into public.quotes (client_id, status) values ($1, 'submitted'), ($1, 'in_review'), ($1, 'accepted')`, [client.clientId]);
      await c.query(`insert into public.contact_messages (name, email, message) values ('Ana', 'ana@example.com', 'Hello, a question please')`);
      await c.query(`insert into public.sample_requests (client_id, shipping_address) values ($1, '{"line1":"a","city":"b","country":"c"}')`, [client.clientId]);
      const color = (await createFabric(c, { meters: 100 })).colorId;
      await c.query(`insert into public.stock_reservations (color_id, client_id, meters, expires_at) values ($1, $2, 5, now() + interval '2 hours'), ($1, $2, 5, now() + interval '3 days')`, [color, client.clientId]);
      await actAs(c, "sales", sales);
      const after = (await c.query(`select public.admin_dashboard() as k`)).rows[0].k as Record<string, number | string>;
      const delta = (k: string) => Number(after[k]) - Number(before[k]);
      expect(delta("quotes_to_review")).toBe(2);
      expect(delta("quotes_to_convert")).toBe(1);
      expect(delta("messages_unhandled")).toBe(1);
      expect(delta("samples_to_prepare")).toBe(1);
      expect(delta("reservations_expiring")).toBe(1); // only the one that ends within 6 hours
    });
  });
});
