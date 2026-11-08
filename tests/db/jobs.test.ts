import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { actAs, asSuper, attempt, createFabric, createUser, pool, txn } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const jobsFor = async (c: PoolClient, queue: "q_embed" | "q_translate", fabricId: string) =>
  (await c.query(`select message from pgmq.q_${queue} where message->>'id' = $1 order by msg_id`, [fabricId])).rows.map((r) => r.message);

async function newFabric(c: PoolClient, name: Record<string, string>, extra: { short?: Record<string, string> | null } = {}) {
  await asSuper(c);
  const cat = await c.query(`insert into public.categories (slug, name) values ($1, '{"fr":"Cat"}') returning id`, [`cat-${randomUUID().slice(0, 8)}`]);
  const slug = `job-${randomUUID().slice(0, 8)}`;
  const f = await c.query(
    `insert into public.fabrics (slug, sku, name, short_description, category_id, construction, structure, composition, gsm, width_cm, base_price_per_m)
     values ($1, $2, $3, $4, $5, 'knit', 'jersey', '[{"fiber":"cotton","pct":100}]', 180, 150, 10) returning id`,
    [slug, `SKU-${slug}`, JSON.stringify(name), extra.short === undefined ? null : JSON.stringify(extra.short), cat.rows[0].id],
  );
  return f.rows[0].id as string;
}

describe("fabric job producers", () => {
  it("a fabric with only French text enqueues an embedding and a translation job", async () => {
    await txn(async (c) => {
      const id = await newFabric(c, { fr: "Jersey coton" });
      expect(await jobsFor(c, "q_embed", id)).toEqual([{ type: "embed", id, attempt: 1 }]);
      expect(await jobsFor(c, "q_translate", id)).toEqual([{ type: "translate", id, attempt: 1 }]);
    });
  });

  it("a fabric that is already translated only enqueues the embedding", async () => {
    await txn(async (c) => {
      const id = await newFabric(c, { fr: "Jersey", en: "Jersey", ar: "جيرسي" });
      expect(await jobsFor(c, "q_embed", id)).toHaveLength(1);
      expect(await jobsFor(c, "q_translate", id)).toHaveLength(0);
    });
  });

  it("a missing translation of an optional description also triggers translation", async () => {
    await txn(async (c) => {
      const id = await newFabric(c, { fr: "A", en: "A", ar: "ا" }, { short: { fr: "Texte court" } });
      expect(await jobsFor(c, "q_translate", id)).toHaveLength(1);
    });
  });

  it("editing a describing field re-enqueues the embedding; an unrelated edit does not", async () => {
    await txn(async (c) => {
      const id = await newFabric(c, { fr: "A", en: "A", ar: "ا" });
      await asSuper(c);
      await c.query(`update public.fabrics set gsm = 200 where id = $1`, [id]);
      expect(await jobsFor(c, "q_embed", id)).toHaveLength(2);
      await c.query(`update public.fabrics set is_featured = true, moq_m = 3 where id = $1`, [id]);
      expect(await jobsFor(c, "q_embed", id)).toHaveLength(2);
    });
  });
});

describe("queue wrappers (service role only)", () => {
  it("send, read with a lease, delete and archive work on any queue", async () => {
    await txn(async (c) => {
      await asSuper(c);
      const queue = `q_t_${randomUUID().slice(0, 8)}`;
      await c.query(`select pgmq.create($1)`, [queue]);
      const a = (await c.query(`select public.job_send($1, '{"n":1}'::jsonb, 0) as id`, [queue])).rows[0].id;
      await c.query(`select public.job_send($1, '{"n":2}'::jsonb, 0)`, [queue]);

      const first = (await c.query(`select * from public.job_read($1, 60, 1)`, [queue])).rows;
      expect(first).toHaveLength(1);
      expect(first[0].message).toEqual({ n: 1 });
      expect(Number(first[0].msg_id)).toBe(Number(a));
      // leased messages are invisible to the next read
      const second = (await c.query(`select * from public.job_read($1, 60, 5)`, [queue])).rows;
      expect(second.map((r) => r.message)).toEqual([{ n: 2 }]);
      expect((await c.query(`select * from public.job_read($1, 60, 5)`, [queue])).rowCount).toBe(0);

      expect((await c.query(`select public.job_delete($1, $2) as ok`, [queue, first[0].msg_id])).rows[0].ok).toBe(true);
      expect((await c.query(`select public.job_archive($1, $2) as ok`, [queue, second[0].msg_id])).rows[0].ok).toBe(true);
      expect((await c.query(`select count(*)::int as n from pgmq.a_${queue}`)).rows[0].n).toBe(1);
      expect((await c.query(`select count(*)::int as n from pgmq.q_${queue}`)).rows[0].n).toBe(0);
    });
  });

  it("a delayed message is not visible until the delay has passed", async () => {
    await txn(async (c) => {
      await asSuper(c);
      const queue = `q_t_${randomUUID().slice(0, 8)}`;
      await c.query(`select pgmq.create($1)`, [queue]);
      await c.query(`select public.job_send($1, '{"late":true}'::jsonb, 300)`, [queue]);
      expect((await c.query(`select * from public.job_read($1, 60, 5)`, [queue])).rowCount).toBe(0);
    });
  });

  it("browser roles cannot call them", async () => {
    await txn(async (c) => {
      const client = await createUser("client", c);
      for (const [role, user] of [["guest"], ["client", client]] as const) {
        await actAs(c, role, user);
        for (const sql of [
          `select * from public.job_read('q_email', 60, 1)`,
          `select public.job_send('q_email', '{}'::jsonb, 0)`,
          `select public.job_delete('q_email', 1)`,
          `select public.job_archive('q_email', 1)`,
          `select * from public.job_queue_depths()`,
        ]) {
          expect((await attempt(c, sql)).error).toMatch(/permission denied/);
        }
      }
    });
  });

  it("job_queue_depths reports the three consumed queues", async () => {
    await txn(async (c) => {
      await asSuper(c);
      const names = (await c.query(`select queue_name from public.job_queue_depths()`)).rows.map((r) => r.queue_name);
      expect(names).toEqual(expect.arrayContaining(["q_embed", "q_translate", "q_email"]));
    });
  });
});

describe("email log", () => {
  it("dedupe_key is unique, so a retry can never send the same email twice", async () => {
    await txn(async (c) => {
      await asSuper(c);
      const key = `test:${randomUUID()}`;
      await c.query(`insert into public.email_log (to_email, template, dedupe_key) values ('a@b.co', 't', $1)`, [key]);
      expect((await attempt(c, `insert into public.email_log (to_email, template, dedupe_key) values ('a@b.co', 't', $1)`, [key])).error).toMatch(/duplicate key/);
      // rows without a key (older entries) are unconstrained
      expect((await attempt(c, `insert into public.email_log (to_email, template) values ('a@b.co', 't'), ('a@b.co', 't')`)).ok).toBe(true);
    });
  });

  it("only admins can read the email log", async () => {
    await txn(async (c) => {
      await asSuper(c);
      await c.query(`insert into public.email_log (to_email, template) values ('x@y.co', 't')`);
      const client = await createUser("client", c);
      const admin = await createUser("admin", c);
      await actAs(c, "client", client);
      expect((await c.query(`select 1 from public.email_log`)).rowCount).toBe(0);
      await actAs(c, "admin", admin);
      expect((await c.query(`select 1 from public.email_log`)).rowCount).toBeGreaterThan(0);
    });
  });
});

describe("existing producers still enqueue emails", () => {
  it("expire_reservations and the contact form send events the email handler understands", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 100 });
      const client = await createUser("client", c);
      await asSuper(c);
      const res = await c.query(`insert into public.stock_reservations (color_id, client_id, meters, expires_at) values ($1, $2, 10, now() - interval '1 hour') returning id`, [f.colorId, client.clientId]);
      await c.query(`select public.expire_reservations()`);
      const job = await c.query(`select message from pgmq.q_q_email where message->>'id' = $1`, [res.rows[0].id]);
      expect(job.rows[0].message).toMatchObject({ template: "reservation_expired", id: res.rows[0].id, attempt: 1 });
    });
  });
});
