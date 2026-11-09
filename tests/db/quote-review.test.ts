import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { actAs, asSuper, attempt, createFabric, createUser, pool, txn } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const queued = async (c: PoolClient, template: string, id: string) =>
  (await c.query(`select message from pgmq.q_q_email where message->>'template' = $1 and message->>'id' = $2`, [template, id])).rows.length;

async function submitted(c: PoolClient, lines = 2) {
  const client = await createUser("client", c);
  const sales = await createUser("sales", c);
  const fabrics = [];
  for (let i = 0; i < lines; i++) fabrics.push(await createFabric(c, { meters: 100 }));
  await asSuper(c);
  await c.query(`insert into public.addresses (client_id, kind, line1, city, country, is_default) values ($1, 'shipping', '1 rue A', 'Lyon', 'FR', true), ($1, 'billing', '2 rue B', 'Paris', 'FR', true)`, [client.clientId]);
  const q = (await c.query(`insert into public.quotes (client_id, status, submitted_at, discount_pct) values ($1, 'submitted', now(), 10) returning id`, [client.clientId])).rows[0].id as string;
  for (const [i, f] of fabrics.entries()) await c.query(`insert into public.quote_lines (quote_id, color_id, meters, unit_price, sort) values ($1, $2, $3, 12.5, $4)`, [q, f.colorId, 10 + i * 5, i]);
  return { q, client, sales, fabrics };
}
const status = async (c: PoolClient, q: string) => (await c.query(`select status, revision, pdf_path, sent_at, valid_until from public.quotes where id = $1`, [q])).rows[0];

describe("quote review", () => {
  it("opening a submitted quote puts it in review; opening it again changes nothing", async () => {
    await txn(async (c) => {
      const { q, sales } = await submitted(c);
      await actAs(c, "sales", sales);
      await c.query(`select public.open_quote_for_review($1)`, [q]);
      expect((await status(c, q)).status).toBe("in_review");
      await c.query(`select public.open_quote_for_review($1)`, [q]);
      expect((await status(c, q)).status).toBe("in_review");
    });
  });

  it("sending: needs a quote in review with lines, defaults the validity, stores the PDF path and queues the email", async () => {
    await txn(async (c) => {
      const { q, sales } = await submitted(c);
      await actAs(c, "sales", sales);
      expect((await attempt(c, `select public.send_quote($1, current_date - 1)`, [q])).error).toMatch(/in the past/);
      const sent = (await c.query(`select * from public.send_quote($1, null, $2)`, [q, `quotes/${q}/r1.pdf`])).rows[0];
      expect(sent).toMatchObject({ status: "sent", pdf_path: `quotes/${q}/r1.pdf` });
      expect(sent.sent_at).not.toBeNull();
      const days = Math.round((new Date(sent.valid_until).getTime() - Date.now()) / 86_400_000);
      expect(days).toBeGreaterThanOrEqual(14);
      expect(days).toBeLessThanOrEqual(15);
      await asSuper(c);
      expect(await queued(c, "quote_sent", q)).toBe(1);
      await actAs(c, "sales", sales);
      expect((await attempt(c, `select public.send_quote($1)`, [q])).error).toMatch(/only a quote in review/); // already sent
    });
  });

  it("an empty quote cannot be sent", async () => {
    await txn(async (c) => {
      const { q, sales } = await submitted(c);
      await asSuper(c);
      await c.query(`delete from public.quote_lines where quote_id = $1`, [q]);
      await actAs(c, "sales", sales);
      expect((await attempt(c, `select public.send_quote($1)`, [q])).error).toMatch(/no lines/);
    });
  });

  it("totals follow the lines and the discount (round(subtotal x (1 - d) x (1 + VAT), 2))", async () => {
    await txn(async (c) => {
      const { q } = await submitted(c);
      await asSuper(c);
      const r = (await c.query(`select subtotal::float as s, total::float as t, vat_rate::float as v from public.quotes where id = $1`, [q])).rows[0];
      expect(r.s).toBe(10 * 12.5 + 15 * 12.5); // 312.5
      expect(r.t).toBe(Math.round(312.5 * 0.9 * (1 + r.v) * 100) / 100);
    });
  });

  it("sales can cancel with a reason; a client cannot use these functions", async () => {
    await txn(async (c) => {
      const { q, client, sales } = await submitted(c);
      await actAs(c, "client", client);
      for (const sql of [`select public.open_quote_for_review($1)`, `select public.send_quote($1)`, `select public.reopen_quote($1)`, `select public.convert_quote_to_order($1)`]) {
        expect((await attempt(c, sql, [q])).ok).toBe(false);
      }
      expect((await attempt(c, `select public.cancel_quote($1, 'x')`, [q])).ok).toBe(false);
      await actAs(c, "sales", sales);
      expect((await attempt(c, `select public.cancel_quote($1, '  ')`, [q])).error).toMatch(/reason is required/);
      const r = (await c.query(`select * from public.cancel_quote($1, 'Produit arrêté')`, [q])).rows[0];
      expect(r).toMatchObject({ status: "cancelled", rejection_reason: "Produit arrêté" });
      expect((await attempt(c, `select public.cancel_quote($1, 'again')`, [q])).error).toMatch(/can no longer be cancelled/);
    });
  });

  it("a sent quote can be reopened as a new revision; the old PDF is dropped and a re-send is a new email", async () => {
    await txn(async (c) => {
      const { q, sales } = await submitted(c);
      await actAs(c, "sales", sales);
      await c.query(`select public.send_quote($1, null, $2)`, [q, `quotes/${q}/r1.pdf`]);
      expect((await attempt(c, `select public.reopen_quote($1)`, [q])).ok).toBe(true);
      expect(await status(c, q)).toMatchObject({ status: "in_review", revision: 2, pdf_path: null, sent_at: null });
      await c.query(`select public.send_quote($1, null, $2)`, [q, `quotes/${q}/r2.pdf`]);
      await asSuper(c);
      const keys = (await c.query(`select message->>'key' as key from pgmq.q_q_email where message->>'template' = 'quote_sent' and message->>'id' = $1 order by msg_id`, [q])).rows.map((r) => r.key);
      expect(keys).toEqual(["1", "2"]);
      await actAs(c, "sales", sales);
      expect((await attempt(c, `select public.reopen_quote($1)`, [q])).ok).toBe(true);
      expect((await attempt(c, `select public.reopen_quote($1)`, [q])).error).toMatch(/only a sent quote/);
    });
  });
});

describe("convert_quote_to_order", () => {
  async function accepted(c: PoolClient) {
    const s = await submitted(c, 3);
    await actAs(c, "sales", s.sales);
    await c.query(`select public.send_quote($1, null, null)`, [s.q]);
    await asSuper(c);
    await c.query(`update public.quotes set status = 'accepted', decided_at = now() where id = $1`, [s.q]);
    return s;
  }

  it("copies the lines and prices, allocates the stock, queues the cutting jobs and the email, and closes the quote", async () => {
    await txn(async (c) => {
      const { q, client, sales, fabrics } = await accepted(c);
      await asSuper(c);
      await c.query(`insert into public.stock_reservations (color_id, client_id, meters, expires_at) values ($1, $2, 5, now() + interval '1 day')`, [fabrics[0]!.colorId, client.clientId]);
      const availableBefore = Number((await c.query(`select available_m from public.v_color_availability_all where color_id = $1`, [fabrics[1]!.colorId])).rows[0].available_m);

      await actAs(c, "sales", sales);
      const order = (await c.query(`select * from public.convert_quote_to_order($1)`, [q])).rows[0];
      expect(order).toMatchObject({ client_id: client.clientId, quote_id: q, status: "confirmed", payment_status: "unpaid", currency: "EUR" });
      expect(order.ref).toMatch(/^O-\d{4}-\d{6}$/);
      expect(order.shipping_address).toMatchObject({ line1: "1 rue A", city: "Lyon", country: "FR" });
      expect(order.billing_address).toMatchObject({ line1: "2 rue B" });

      await asSuper(c);
      const original = (await c.query(`select subtotal::float as s, total::float as t, discount_pct::float as d, status from public.quotes where id = $1`, [q])).rows[0];
      expect(original.status).toBe("converted");
      expect({ s: Number(order.subtotal), t: Number(order.total), d: Number(order.discount_pct) }).toEqual({ s: original.s, t: original.t, d: original.d });

      const lines = (await c.query(`select meters::float as m, unit_price::float as p, line_total::float as lt from public.order_lines where order_id = $1 order by meters`, [order.id])).rows;
      expect(lines).toEqual([{ m: 10, p: 12.5, lt: 125 }, { m: 15, p: 12.5, lt: 187.5 }, { m: 20, p: 12.5, lt: 250 }]);
      const jobs = (await c.query(`select cj.status, cj.planned_m::float as planned from public.cutting_jobs cj join public.order_lines ol on ol.id = cj.order_line_id where ol.order_id = $1 order by cj.planned_m`, [order.id])).rows;
      expect(jobs).toEqual([{ status: "queued", planned: 10 }, { status: "queued", planned: 15 }, { status: "queued", planned: 20 }]);
      expect((await c.query(`select count(*)::int as n from public.order_allocations a join public.order_lines ol on ol.id = a.order_line_id where ol.order_id = $1 and not a.released`, [order.id])).rows[0].n).toBe(3);

      // the stock is now held for the order, the matching reservation is converted
      const availableAfter = Number((await c.query(`select available_m from public.v_color_availability_all where color_id = $1`, [fabrics[1]!.colorId])).rows[0].available_m);
      expect(availableAfter).toBe(availableBefore - 15);
      expect((await c.query(`select status from public.stock_reservations where client_id = $1 and color_id = $2`, [client.clientId, fabrics[0]!.colorId])).rows[0].status).toBe("converted");
      expect(await queued(c, "order_confirmed", order.id)).toBe(1);
    });
  });

  it("only an accepted quote converts, and only once", async () => {
    await txn(async (c) => {
      const s = await submitted(c);
      await actAs(c, "sales", s.sales);
      expect((await attempt(c, `select public.convert_quote_to_order($1)`, [s.q])).error).toMatch(/only an accepted quote/);
      await asSuper(c);
      await c.query(`update public.quotes set status = 'accepted' where id = $1`, [s.q]);
      await actAs(c, "sales", s.sales);
      expect((await attempt(c, `select public.convert_quote_to_order($1)`, [s.q])).ok).toBe(true);
      expect((await attempt(c, `select public.convert_quote_to_order($1)`, [s.q])).error).toMatch(/only an accepted quote/);
    });
  });
});
