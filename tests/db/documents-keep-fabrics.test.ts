import { afterAll, describe, expect, it } from "vitest";
import { actAs, asSuper, createFabric, createUser, pool, txn } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const visible = async (c: Parameters<typeof actAs>[0], table: "fabrics" | "fabric_colors", id: string) => (await c.query(`select 1 from public.${table} where id = $1`, [id])).rowCount === 1;

describe("a client keeps seeing the fabrics of their own documents", () => {
  it("a deactivated fabric stays readable through the client's quote, order, sample or reservation, and only for that client", async () => {
    await txn(async (c) => {
      const a = await createUser("client", c);
      const b = await createUser("client", c);
      const quoted = await createFabric(c, { meters: 100 });
      const sampled = await createFabric(c, { meters: 100 });
      const reserved = await createFabric(c, { meters: 100 });
      const unrelated = await createFabric(c, { meters: 100 });
      await asSuper(c);
      const q = (await c.query(`insert into public.quotes (client_id) values ($1) returning id`, [a.clientId])).rows[0].id as string;
      await c.query(`insert into public.quote_lines (quote_id, color_id, meters, unit_price) values ($1, $2, 5, 10)`, [q, quoted.colorId]);
      const s = (await c.query(`insert into public.sample_requests (client_id, shipping_address) values ($1, '{"line1":"a","city":"b","country":"c"}') returning id`, [a.clientId])).rows[0].id as string;
      await c.query(`insert into public.sample_request_items (sample_request_id, color_id) values ($1, $2)`, [s, sampled.colorId]);
      await c.query(`insert into public.stock_reservations (color_id, client_id, meters, expires_at) values ($1, $2, 5, now() + interval '1 day')`, [reserved.colorId, a.clientId]);
      await c.query(`update public.fabrics set is_active = false where id = any ($1)`, [[quoted.fabricId, sampled.fabricId, reserved.fabricId, unrelated.fabricId]]);

      await actAs(c, "client", a);
      for (const f of [quoted, sampled, reserved]) {
        expect(await visible(c, "fabrics", f.fabricId)).toBe(true);
        expect(await visible(c, "fabric_colors", f.colorId)).toBe(true);
      }
      expect(await visible(c, "fabrics", unrelated.fabricId)).toBe(false); // switched off and not theirs
      expect(await visible(c, "fabric_colors", unrelated.colorId)).toBe(false);

      await actAs(c, "client", b); // another client sees none of them
      for (const f of [quoted, sampled, reserved, unrelated]) {
        expect(await visible(c, "fabrics", f.fabricId)).toBe(false);
        expect(await visible(c, "fabric_colors", f.colorId)).toBe(false);
      }
      await actAs(c, "guest");
      expect(await visible(c, "fabrics", quoted.fabricId)).toBe(false);
    });
  });

  it("the public catalog is unchanged: active fabrics are visible to everyone, inactive ones to nobody else", async () => {
    await txn(async (c) => {
      const client = await createUser("client", c);
      const on = await createFabric(c, { active: true });
      const off = await createFabric(c, { active: false });
      for (const role of ["guest", "client"] as const) {
        if (role === "guest") await actAs(c, "guest");
        else await actAs(c, "client", client);
        expect(await visible(c, "fabrics", on.fabricId)).toBe(true);
        expect(await visible(c, "fabric_colors", on.colorId)).toBe(true);
        expect(await visible(c, "fabrics", off.fabricId)).toBe(false);
        expect(await visible(c, "fabric_colors", off.colorId)).toBe(false);
      }
    });
  });
});
