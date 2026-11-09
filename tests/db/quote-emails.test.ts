import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { actAs, asSuper, createFabric, createUser, pool, txn } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const emails = async (c: PoolClient, quoteId: string) =>
  (await c.query(`select message from pgmq.q_q_email where message->>'id' = $1 order by msg_id`, [quoteId])).rows.map((r) => r.message as { template: string; key: string; attempt: number });

async function draftWithLine(c: PoolClient) {
  const f = await createFabric(c, { meters: 100 });
  const client = await createUser("client", c);
  await asSuper(c);
  const q = (await c.query(`insert into public.quotes (client_id) values ($1) returning id`, [client.clientId])).rows[0].id as string;
  await c.query(`insert into public.quote_lines (quote_id, color_id, meters, unit_price) values ($1, $2, 5, 10)`, [q, f.colorId]);
  return { q, client };
}

describe("quote emails are queued by the status change", () => {
  it("creating a draft sends nothing; submitting sends one email to the client and one to the staff", async () => {
    await txn(async (c) => {
      const { q, client } = await draftWithLine(c);
      expect(await emails(c, q)).toEqual([]);
      await actAs(c, "client", client);
      await c.query(`select public.submit_quote($1, 'Merci de répondre vite')`, [q]);
      await asSuper(c);
      expect((await emails(c, q)).map((m) => m.template)).toEqual(["quote_submitted_client", "quote_submitted_staff"]);
    });
  });

  it("sent, accepted, rejected and expired each queue their own email; a re-sent revision gets its own key", async () => {
    await txn(async (c) => {
      const { q } = await draftWithLine(c);
      await asSuper(c);
      const set = (status: string, extra = "") => c.query(`update public.quotes set status = '${status}' ${extra} where id = $1`, [q]);
      await set("submitted");
      await set("sent", ", valid_until = current_date + 10");
      await c.query(`update public.quotes set status = 'in_review', revision = 2 where id = $1`, [q]);
      await set("sent");
      const sent = (await emails(c, q)).filter((m) => m.template === "quote_sent");
      expect(sent.map((m) => m.key)).toEqual(["1", "2"]);

      await set("accepted");
      await set("rejected");
      await set("expired");
      const all = (await emails(c, q)).map((m) => m.template);
      expect(all).toEqual(expect.arrayContaining(["quote_accepted_staff", "quote_rejected_staff", "quote_expired"]));
    });
  });

  it("statuses without an email (in review, cancelled, converted) and plain edits queue nothing", async () => {
    await txn(async (c) => {
      const { q } = await draftWithLine(c);
      await asSuper(c);
      await c.query(`update public.quotes set status = 'in_review' where id = $1`, [q]);
      await c.query(`update public.quotes set internal_notes = 'x', discount_pct = 5 where id = $1`, [q]);
      await c.query(`update public.quotes set status = 'cancelled' where id = $1`, [q]);
      expect(await emails(c, q)).toEqual([]);
    });
  });
});
