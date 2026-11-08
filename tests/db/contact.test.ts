import { afterAll, describe, expect, it } from "vitest";
import { actAs, asSuper, attempt, createUser, pool, txn } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const call = (ip: string, overrides: Partial<Record<"name" | "email" | "message" | "company" | "phone", string | null>> = {}): [string, unknown[]] => {
  const v = { name: "Nour Haddad", email: "nour@example.com", message: "Bonjour, je cherche un jersey coton 180 GSM.", company: "Atelier Nour", phone: "+33 1 23 45 67 89", ...overrides };
  return [`select public.submit_contact_message($1, $2, $3, $4, $5, 'fr', $6) as id`, [v.name, v.company, v.email, v.phone, v.message, ip]];
};

describe("submit_contact_message", () => {
  it("stores the message and enqueues an email job for staff", async () => {
    await txn(async (c) => {
      await asSuper(c);
      const ip = `ip-${Math.random()}`;
      const { rows } = await c.query(...call(ip));
      const id = rows[0].id as string;
      const stored = (await c.query(`select name, company, email, phone, locale, handled from public.contact_messages where id = $1`, [id])).rows[0];
      expect(stored).toMatchObject({ name: "Nour Haddad", company: "Atelier Nour", email: "nour@example.com", locale: "fr", handled: false });
      const job = await c.query(`select message from pgmq.q_q_email where message->>'template' = 'contact_message_staff' and message->>'id' = $1`, [id]);
      expect(job.rowCount).toBe(1);
    });
  });

  it("trims input and stores empty optional fields as null", async () => {
    await txn(async (c) => {
      await asSuper(c);
      const { rows } = await c.query(...call(`ip-${Math.random()}`, { name: "  Ana  ", company: "  ", phone: "" }));
      const stored = (await c.query(`select name, company, phone from public.contact_messages where id = $1`, [rows[0].id])).rows[0];
      expect(stored).toEqual({ name: "Ana", company: null, phone: null });
    });
  });

  it("rejects invalid input", async () => {
    await txn(async (c) => {
      await asSuper(c);
      const ip = `ip-${Math.random()}`;
      expect((await attempt(c, ...call(ip, { name: "A" }))).error).toMatch(/invalid name/);
      expect((await attempt(c, ...call(ip, { email: "not-an-email" }))).error).toMatch(/invalid email/);
      expect((await attempt(c, ...call(ip, { message: "short" }))).error).toMatch(/invalid message/);
      expect((await attempt(c, ...call(ip, { message: "x".repeat(4001) }))).error).toMatch(/invalid message/);
      expect((await attempt(c, `select public.submit_contact_message('Ana', null, 'a@b.co', null, 'a long enough message', 'fr', '')`)).error).toMatch(/ip key/);
    });
  });

  it("allows 5 messages per hour per IP, then rate limits; another IP is unaffected", async () => {
    const ip = `ip-limit-${Math.random()}`;
    const results: string[] = [];
    for (let i = 0; i < 6; i++) {
      // every call is its own transaction: a rejected call must not hide earlier successes
      results.push(await txn(async (c) => {
        await asSuper(c);
        const r = await attempt(c, ...call(ip));
        return r.ok ? "ok" : r.error;
      }, true));
    }
    expect(results.slice(0, 5)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(results[5]).toMatch(/rate_limited/);

    const other = await txn(async (c) => {
      await asSuper(c);
      return (await attempt(c, ...call(`ip-other-${Math.random()}`))).ok;
    }, true);
    expect(other).toBe(true);
  });

  it("is not callable by the browser roles (only the server with the service role)", async () => {
    await txn(async (c) => {
      const client = await createUser("client", c);
      await actAs(c, "guest");
      expect((await attempt(c, ...call("x"))).error).toMatch(/permission denied/);
      await actAs(c, "client", client);
      expect((await attempt(c, ...call("x"))).error).toMatch(/permission denied/);
    });
  });
});
