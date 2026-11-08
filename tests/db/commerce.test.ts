import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asSuper, attempt, createFabric, createUser, pool, txn, type TestUser } from "./helpers";

let sales: TestUser, clientA: TestUser, clientB: TestUser;

beforeAll(async () => {
  [sales, clientA, clientB] = await Promise.all([createUser("sales"), createUser("client"), createUser("client")]);
});
afterAll(async () => {
  await pool.end();
});

describe("quotes", () => {
  it("computes line totals, subtotal, discount and VAT from settings", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 500 });
      await actAs(c, "client", clientA);
      const q = await c.query(`insert into public.quotes (client_id) values ($1) returning id, ref, currency, vat_rate`, [clientA.clientId]);
      expect(q.rows[0].ref).toMatch(/^Q-\d{4}-\d{6}$/);
      expect(q.rows[0].currency).toBe("EUR");
      expect(Number(q.rows[0].vat_rate)).toBe(0.2);
      const id = q.rows[0].id;
      await c.query(`insert into public.quote_lines (quote_id, color_id, meters, unit_price) values ($1, $2, 12.5, 10.10), ($1, $2, 7, 3)`, [id, f.colorId]);
      const t = (await c.query(`select subtotal, total from public.quotes where id = $1`, [id])).rows[0];
      expect(Number(t.subtotal)).toBe(147.25); // 126.25 + 21
      expect(Number(t.total)).toBe(176.7); // 147.25 * 1.2

      await asSuper(c);
      await c.query(`update public.quotes set discount_pct = 10 where id = $1`, [id]);
      const t2 = (await c.query(`select total from public.quotes where id = $1`, [id])).rows[0];
      expect(Number(t2.total)).toBe(159.03); // 147.25 * 0.9 * 1.2
    });
  });

  it("allows only one draft per client", async () => {
    await txn(async (c) => {
      const u = await createUser("client", c);
      await actAs(c, "client", u);
      await c.query(`insert into public.quotes (client_id) values ($1)`, [u.clientId]);
      const dup = await attempt(c, `insert into public.quotes (client_id) values ($1)`, [u.clientId]);
      expect(dup.ok).toBe(false);
    });
  });

  it("client flow: draft -> submit_quote; cannot self-set status; cannot touch another client's quote", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 100 });
      const u = await createUser("client", c);
      await actAs(c, "client", u);
      const id = (await c.query(`insert into public.quotes (client_id) values ($1) returning id`, [u.clientId])).rows[0].id;

      const empty = await attempt(c, `select public.submit_quote($1)`, [id]);
      expect(empty.error).toMatch(/no lines/);

      await c.query(`insert into public.quote_lines (quote_id, color_id, meters, unit_price) values ($1, $2, 5, 10)`, [id, f.colorId]);
      const sneaky = await attempt(c, `update public.quotes set status = 'accepted' where id = $1`, [id]);
      expect(sneaky.ok).toBe(false); // WITH CHECK requires status = 'draft'

      const sub = await c.query(`select status, submitted_at from public.quotes where id = (select (public.submit_quote($1)).id)`, [id]);
      expect(sub.rows[0].status).toBe("submitted");
      expect(sub.rows[0].submitted_at).not.toBeNull();

      // once submitted the client can no longer edit lines
      const edit = await attempt(c, `update public.quote_lines set meters = 500 where quote_id = $1`, [id]);
      expect(edit.rowCount).toBe(0);

      await actAs(c, "client", clientB);
      expect((await attempt(c, `select public.submit_quote($1)`, [id])).ok).toBe(false);
    });
  });

  it("a client can accept or reject only a 'sent', unexpired quote that is theirs", async () => {
    await txn(async (c) => {
      const u = await createUser("client", c);
      await asSuper(c);
      const mk = async (status: string, validUntil: string | null) =>
        (await c.query(`insert into public.quotes (client_id, status, valid_until) values ($1, $2, $3) returning id`, [u.clientId, status, validUntil])).rows[0].id as string;
      // only one draft allowed; these are non-draft
      const sent = await mk("sent", "2999-01-01");
      const expired = await mk("sent", "2000-01-01");
      const inReview = await mk("in_review", null);

      await actAs(c, "client", u);
      expect((await attempt(c, `select public.client_decide_quote($1, 'accepted')`, [inReview])).error).toMatch(/only a sent quote/);
      expect((await attempt(c, `select public.client_decide_quote($1, 'accepted')`, [expired])).error).toMatch(/expired/);
      expect((await attempt(c, `select public.client_decide_quote($1, 'maybe')`, [sent])).ok).toBe(false);

      await actAs(c, "client", clientB);
      expect((await attempt(c, `select public.client_decide_quote($1, 'accepted')`, [sent])).ok).toBe(false);

      await actAs(c, "client", u);
      const direct = await attempt(c, `update public.quotes set status = 'accepted' where id = $1`, [sent]);
      expect(direct.rowCount).toBe(0); // RLS hides non-draft rows from the client UPDATE policy

      const ok = await c.query(`select status, decided_at from public.client_decide_quote($1, 'rejected', 'too expensive')`, [sent]);
      expect(ok.rows[0].status).toBe("rejected");
      expect(ok.rows[0].decided_at).not.toBeNull();
    });
  });

  it("expire_quotes marks overdue sent quotes as expired", async () => {
    await txn(async (c) => {
      const u = await createUser("client", c);
      await asSuper(c);
      const id = (await c.query(`insert into public.quotes (client_id, status, valid_until) values ($1, 'sent', '2020-01-01') returning id`, [u.clientId])).rows[0].id;
      await c.query(`select public.expire_quotes()`);
      expect((await c.query(`select status from public.quotes where id = $1`, [id])).rows[0].status).toBe("expired");
    });
  });
});

describe("order -> cutting -> stock", () => {
  it("creates a cutting job per line, then start_cut / record_cut consume the lot and advance the order", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 100 });
      const u = await createUser("client", c);
      await asSuper(c);
      const quote = (await c.query(`insert into public.quotes (client_id, status) values ($1, 'accepted') returning id`, [u.clientId])).rows[0].id;
      const order = (
        await c.query(
          `insert into public.orders (client_id, quote_id, currency, subtotal, vat_rate, total) values ($1, $2, 'EUR', 400, 0.2, 480) returning id, ref`,
          [u.clientId, quote],
        )
      ).rows[0];
      expect(order.ref).toMatch(/^O-\d{4}-\d{6}$/);
      const line = (await c.query(`insert into public.order_lines (order_id, color_id, meters, unit_price, line_total) values ($1, $2, 40, 10, 400) returning id`, [order.id, f.colorId])).rows[0].id;
      await c.query(`select public.allocate_order($1)`, [order.id]);

      // 100 on hand - 40 allocated
      expect(Number((await c.query(`select available_m from public.v_color_availability_all where color_id = $1`, [f.colorId])).rows[0].available_m)).toBe(60);

      const job = (await c.query(`select id, status, planned_m from public.cutting_jobs where order_line_id = $1`, [line])).rows[0];
      expect(job.status).toBe("queued");
      expect(Number(job.planned_m)).toBe(40);

      await actAs(c, "sales", sales);
      const lot = (await c.query(`select id from public.stock_lots where color_id = $1`, [f.colorId])).rows[0].id;
      await c.query(`select public.start_cut($1, $2)`, [job.id, lot]);
      expect((await c.query(`select status from public.orders where id = $1`, [order.id])).rows[0].status).toBe("in_preparation");

      await c.query(`select public.record_cut($1, 39.5)`, [job.id]);
      expect((await c.query(`select status, cut_m from public.cutting_jobs where id = $1`, [job.id])).rows[0]).toMatchObject({ status: "ready", cut_m: "39.50" });
      expect((await c.query(`select status from public.orders where id = $1`, [order.id])).rows[0].status).toBe("ready");

      // lot reduced by what was actually cut, allocation released -> available = 60.5
      expect(Number((await c.query(`select meters from public.stock_lots where id = $1`, [lot])).rows[0].meters)).toBe(60.5);
      expect(Number((await c.query(`select available_m from public.v_color_availability_all where color_id = $1`, [f.colorId])).rows[0].available_m)).toBe(60.5);
    });
  });

  it("start_cut rejects a lot of another color or with too few meters; clients cannot run it", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 10 });
      const other = await createFabric(c, { meters: 500 });
      const u = await createUser("client", c);
      await asSuper(c);
      const quote = (await c.query(`insert into public.quotes (client_id, status) values ($1, 'accepted') returning id`, [u.clientId])).rows[0].id;
      const orderId = (await c.query(`insert into public.orders (client_id, quote_id, currency, subtotal, vat_rate, total) values ($1, $2, 'EUR', 1, 0.2, 1.2) returning id`, [u.clientId, quote])).rows[0].id;
      const line = (await c.query(`insert into public.order_lines (order_id, color_id, meters, unit_price, line_total) values ($1, $2, 40, 1, 40) returning id`, [orderId, f.colorId])).rows[0].id;
      const job = (await c.query(`select id from public.cutting_jobs where order_line_id = $1`, [line])).rows[0].id;
      const smallLot = (await c.query(`select id from public.stock_lots where color_id = $1`, [f.colorId])).rows[0].id;
      const otherLot = (await c.query(`select id from public.stock_lots where color_id = $1`, [other.colorId])).rows[0].id;

      await actAs(c, "client", u);
      expect((await attempt(c, `select public.start_cut($1, $2)`, [job, smallLot])).ok).toBe(false);

      await actAs(c, "sales", sales);
      expect((await attempt(c, `select public.start_cut($1, $2)`, [job, otherLot])).error).toMatch(/does not match/);
      expect((await attempt(c, `select public.start_cut($1, $2)`, [job, smallLot])).error).toMatch(/not enough meters/);
    });
  });
});
