import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { actAs, asSuper, attempt, createFabric, createUser, pool, txn } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const ADDRESS = { recipient: "Atelier Lina", line1: "10 rue des Tissus", city: "Lyon", postal_code: "69001", country: "FR" };

const colors = async (c: PoolClient, n: number) => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push((await createFabric(c, { meters: 50 })).colorId);
  return out;
};
const request = (c: PoolClient, ids: string[], address: unknown = ADDRESS) => attempt(c, `select id from public.request_samples($1::uuid[], $2::jsonb)`, [ids, JSON.stringify(address)]);
const queued = async (c: PoolClient, template: string, id: string) =>
  (await c.query(`select message from pgmq.q_q_email where message->>'template' = $1 and message->>'id' = $2 order by msg_id`, [template, id])).rows.map((r) => r.message as { key?: string });

describe("request_samples", () => {
  it("creates the request with its colors and the cleaned address, and tells the staff", async () => {
    await txn(async (c) => {
      const ids = await colors(c, 3);
      const client = await createUser("client", c);
      await actAs(c, "client", client);
      const r = await c.query(
        `select * from public.request_samples($1::uuid[], $2::jsonb)`,
        [[...ids, ids[0]], JSON.stringify({ ...ADDRESS, line2: "  ", evil: "<script>", phone: " 0612345678 " })], // a duplicate color, an unknown key, blanks
      );
      const req = r.rows[0];
      expect(req).toMatchObject({ client_id: client.clientId, status: "requested" });
      expect(req.ref).toMatch(/^S-\d{4}-\d{6}$/);
      expect(req.shipping_address).toEqual({ ...ADDRESS, phone: "0612345678" }); // blank dropped, unknown key dropped, trimmed
      const items = (await c.query(`select color_id from public.sample_request_items where sample_request_id = $1`, [req.id])).rows.map((x) => x.color_id);
      expect(items.sort()).toEqual([...ids].sort()); // the duplicate was merged
      await asSuper(c);
      expect(await queued(c, "sample_requested_staff", req.id)).toHaveLength(1);
      expect(await queued(c, "sample_status_changed", req.id)).toHaveLength(0); // nothing for the client yet
    });
  });

  it("refuses an empty choice, too many colors, unknown or inactive colors", async () => {
    await txn(async (c) => {
      const ids = await colors(c, 6);
      const inactive = (await createFabric(c, { meters: 50, active: false })).colorId;
      const client = await createUser("client", c);
      await actAs(c, "client", client);
      expect((await request(c, [])).error).toMatch(/at least one color/);
      expect((await request(c, ids)).error).toMatch(/too many colors \(maximum 5\)/);
      expect((await request(c, [ids[0]!, inactive])).error).toMatch(/inactive color/);
      expect((await request(c, [ids[0]!, "00000000-0000-4000-8000-000000000000"])).error).toMatch(/inactive color/);
      expect((await request(c, ids.slice(0, 5))).ok).toBe(true); // exactly the maximum is fine
    });
  });

  it("needs a street, a city and a country, and sane lengths", async () => {
    await txn(async (c) => {
      const [id] = await colors(c, 1);
      const client = await createUser("client", c);
      await actAs(c, "client", client);
      for (const bad of [{}, { ...ADDRESS, line1: " " }, { ...ADDRESS, city: "" }, { ...ADDRESS, country: null }]) {
        expect((await request(c, [id!], bad)).error).toMatch(/shipping address is required/);
      }
      expect((await request(c, [id!], { ...ADDRESS, line1: "x".repeat(201) })).error).toMatch(/too long/);
      expect((await request(c, [id!], ADDRESS)).ok).toBe(true);
    });
  });

  it("allows 2 open requests; delivered and rejected ones free a place", async () => {
    await txn(async (c) => {
      const [a, b, d, e] = await colors(c, 4);
      const client = await createUser("client", c);
      const sales = await createUser("sales", c);
      await actAs(c, "client", client);
      const first = (await c.query(`select id from public.request_samples($1::uuid[], $2::jsonb)`, [[a], JSON.stringify(ADDRESS)])).rows[0].id as string;
      const second = (await c.query(`select id from public.request_samples($1::uuid[], $2::jsonb)`, [[b], JSON.stringify(ADDRESS)])).rows[0].id as string;
      expect((await request(c, [d!])).error).toMatch(/open sample request limit/);

      await actAs(c, "sales", sales);
      await c.query(`update public.sample_requests set status = 'rejected', rejection_reason = 'Out of samples' where id = $1`, [first]);
      await actAs(c, "client", client);
      expect((await request(c, [d!])).ok).toBe(true); // a rejected request no longer counts
      expect((await request(c, [e!])).error).toMatch(/open sample request limit/);

      await actAs(c, "sales", sales);
      for (const [status, extra] of [["approved", ""], ["preparing", ""], ["shipped", ", tracking_number = '6A001'"], ["delivered", ""]] as const) {
        await c.query(`update public.sample_requests set status = '${status}' ${extra} where id = $1`, [second]);
      }
      await actAs(c, "client", client);
      expect((await request(c, [e!])).ok).toBe(true);
    });
  });

  it("one client's limit does not depend on another's", async () => {
    await txn(async (c) => {
      const ids = await colors(c, 3);
      const a = await createUser("client", c);
      const b = await createUser("client", c);
      await actAs(c, "client", a);
      expect((await request(c, [ids[0]!])).ok).toBe(true);
      expect((await request(c, [ids[1]!])).ok).toBe(true);
      expect((await request(c, [ids[2]!])).ok).toBe(false);
      await actAs(c, "client", b);
      expect((await request(c, [ids[2]!])).ok).toBe(true);
    });
  });

  it("is for signed-in clients only, and the table cannot be written directly", async () => {
    await txn(async (c) => {
      const [id] = await colors(c, 1);
      const client = await createUser("client", c);
      const sales = await createUser("sales", c);
      await actAs(c, "guest");
      expect((await request(c, [id!])).ok).toBe(false);
      await actAs(c, "sales", sales);
      expect((await request(c, [id!])).error).toMatch(/sign in to request samples/);
      await actAs(c, "client", client);
      const direct = await attempt(c, `insert into public.sample_requests (client_id, shipping_address) values ($1, '{}')`, [client.clientId]);
      expect(direct.ok).toBe(false); // the limits live in request_samples(): no way around it
    });
  });

  it("a client sees only their own requests and colors", async () => {
    await txn(async (c) => {
      const [id] = await colors(c, 1);
      const a = await createUser("client", c);
      const b = await createUser("client", c);
      await actAs(c, "client", a);
      const mine = (await c.query(`select id from public.request_samples($1::uuid[], $2::jsonb)`, [[id], JSON.stringify(ADDRESS)])).rows[0].id as string;
      expect((await c.query(`select id from public.sample_requests where id = $1`, [mine])).rows).toHaveLength(1);
      await actAs(c, "client", b);
      expect((await c.query(`select id from public.sample_requests where id = $1`, [mine])).rows).toHaveLength(0);
      expect((await c.query(`select id from public.sample_request_items where sample_request_id = $1`, [mine])).rows).toHaveLength(0);
    });
  });
});

describe("the status flow", () => {
  async function newRequest(c: PoolClient) {
    const [id] = await colors(c, 1);
    const client = await createUser("client", c);
    const sales = await createUser("sales", c);
    await actAs(c, "client", client);
    const req = (await c.query(`select id from public.request_samples($1::uuid[], $2::jsonb)`, [[id], JSON.stringify(ADDRESS)])).rows[0].id as string;
    await actAs(c, "sales", sales);
    return { req, client, sales };
  }
  const setStatus = (c: PoolClient, id: string, status: string, extra = "") => attempt(c, `update public.sample_requests set status = '${status}' ${extra} where id = $1`, [id]);

  it("goes forward one step at a time; each change queues one email for the client", async () => {
    await txn(async (c) => {
      const { req } = await newRequest(c);
      expect((await setStatus(c, req, "approved")).ok).toBe(true);
      expect((await setStatus(c, req, "preparing")).ok).toBe(true);
      expect((await setStatus(c, req, "shipped", ", tracking_number = '6A02001', carrier = 'Colissimo'")).ok).toBe(true);
      expect((await setStatus(c, req, "delivered")).ok).toBe(true);
      await asSuper(c);
      expect((await queued(c, "sample_status_changed", req)).map((m) => m.key)).toEqual(["approved", "preparing", "shipped", "delivered"]);
    });
  });

  it("refuses to skip a step, go back, or leave a final status", async () => {
    await txn(async (c) => {
      const { req } = await newRequest(c);
      expect((await setStatus(c, req, "shipped", ", tracking_number = 'X1'")).error).toMatch(/cannot go from requested to shipped/);
      expect((await setStatus(c, req, "delivered")).ok).toBe(false);
      await setStatus(c, req, "approved");
      expect((await setStatus(c, req, "requested")).ok).toBe(false);
      expect((await setStatus(c, req, "rejected", ", rejection_reason = 'too late'")).ok).toBe(false); // rejection is only possible at the start
      await setStatus(c, req, "preparing");
      await setStatus(c, req, "shipped", ", tracking_number = 'X1'");
      await setStatus(c, req, "delivered");
      expect((await setStatus(c, req, "preparing")).ok).toBe(false);
    });
  });

  it("a rejection needs a reason and a shipment needs a tracking number", async () => {
    await txn(async (c) => {
      const a = await newRequest(c);
      expect((await setStatus(c, a.req, "rejected")).error).toMatch(/reason is required/);
      expect((await setStatus(c, a.req, "rejected", ", rejection_reason = '   '")).ok).toBe(false);
      expect((await setStatus(c, a.req, "rejected", ", rejection_reason = 'No stock left'")).ok).toBe(true);

      const b = await newRequest(c);
      await setStatus(c, b.req, "approved");
      await setStatus(c, b.req, "preparing");
      expect((await setStatus(c, b.req, "shipped")).error).toMatch(/tracking number is required/);
      expect((await setStatus(c, b.req, "shipped", ", tracking_number = ' '")).ok).toBe(false);
      expect((await setStatus(c, b.req, "shipped", ", tracking_number = '6A02001'")).ok).toBe(true);
    });
  });

  it("only staff change a status; editing a note queues nothing; the address is frozen once processed", async () => {
    await txn(async (c) => {
      const { req, client, sales } = await newRequest(c);
      await actAs(c, "client", client);
      const own = await attempt(c, `update public.sample_requests set status = 'approved' where id = $1`, [req]);
      expect(own.ok === false || (await c.query(`select status from public.sample_requests where id = $1`, [req])).rows[0].status === "requested").toBe(true);

      await actAs(c, "sales", sales);
      await c.query(`update public.sample_requests set carrier = 'Colissimo' where id = $1`, [req]);
      await asSuper(c);
      expect(await queued(c, "sample_status_changed", req)).toHaveLength(0);

      await actAs(c, "sales", sales);
      await setStatus(c, req, "approved");
      const moved = await attempt(c, `update public.sample_requests set shipping_address = '{"line1":"x","city":"y","country":"z"}' where id = $1`, [req]);
      expect(moved.error).toMatch(/cannot change once the request is processed/);
    });
  });

  it("the number of colors and the open limit are public settings; other private settings stay private", async () => {
    await txn(async (c) => {
      await actAs(c, "guest");
      const keys = (await c.query(`select key from public.public_settings`)).rows.map((r) => r.key as string);
      expect(keys).toEqual(expect.arrayContaining(["max_colors_per_sample_request", "max_open_sample_requests_per_client"]));
      expect(keys).not.toContain("staff_notification_email");
    });
  });
});
