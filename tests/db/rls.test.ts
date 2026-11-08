import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asSuper, attempt, createFabric, createUser, pool, txn, type TestUser } from "./helpers";

let admin: TestUser, sales: TestUser, clientA: TestUser, clientB: TestUser;

beforeAll(async () => {
  [admin, sales, clientA, clientB] = await Promise.all([
    createUser("admin"),
    createUser("sales"),
    createUser("client"),
    createUser("client"),
  ]);
});
afterAll(async () => {
  await pool.end();
});

describe("RLS safety net", () => {
  it("every table in public has RLS enabled", async () => {
    const { rows } = await pool.query(
      `select tablename from pg_tables where schemaname = 'public' and not rowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("anon has no write privilege on any table (contact messages go through submit_contact_message)", async () => {
    const { rows } = await pool.query(
      `select table_name, privilege_type from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`,
    );
    expect(rows).toEqual([]);
  });
});

describe("sign-up and roles", () => {
  it("creates a client + profile with role 'client', ignoring a role passed in metadata", async () => {
    const u = await createUser("client", undefined, { role: "admin", full_name: "Mallory" });
    const { rows } = await pool.query(
      `select p.role, p.full_name, c.company_name from public.profiles p join public.clients c on c.id = p.client_id where p.id = $1`,
      [u.id],
    );
    expect(rows[0].role).toBe("client");
    expect(rows[0].full_name).toBe("Mallory");
  });

  it("a client cannot promote themselves; an admin can", async () => {
    await txn(async (c) => {
      await actAs(c, "client", clientA);
      const r = await attempt(c, `update public.profiles set role = 'admin' where id = $1`, [clientA.id]);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/only an admin/);

      await actAs(c, "admin", admin);
      const ok = await attempt(c, `update public.profiles set role = 'sales' where id = $1`, [clientB.id]);
      expect(ok.ok).toBe(true);
      await asSuper(c);
      const log = await c.query(`select 1 from public.audit_log where table_name = 'profiles' and row_id = $1`, [clientB.id]);
      expect(log.rowCount).toBe(1);
    });
  });

  it("the access-token hook injects user_role into the JWT claims", async () => {
    const { rows } = await pool.query(`select public.custom_access_token_hook($1::jsonb) as r`, [
      JSON.stringify({ user_id: sales.id, claims: { sub: sales.id } }),
    ]);
    expect(rows[0].r.claims.user_role).toBe("sales");
  });
});

describe("catalog visibility", () => {
  it("guests only see active fabrics, colors and availability; staff see everything", async () => {
    await txn(async (c) => {
      const active = await createFabric(c, { meters: 100 });
      const hidden = await createFabric(c, { active: false });
      await actAs(c, "guest");
      const f = await c.query(`select id from public.fabrics where id in ($1, $2)`, [active.fabricId, hidden.fabricId]);
      expect(f.rows.map((r) => r.id)).toEqual([active.fabricId]);
      const av = await c.query(`select available_m from public.v_color_availability where color_id = $1`, [active.colorId]);
      expect(Number(av.rows[0].available_m)).toBe(100);
      const hiddenAv = await c.query(`select 1 from public.v_color_availability where color_id = $1`, [hidden.colorId]);
      expect(hiddenAv.rowCount).toBe(0);

      await actAs(c, "sales", sales);
      const all = await c.query(`select id from public.fabrics where id in ($1, $2)`, [active.fabricId, hidden.fabricId]);
      expect(all.rowCount).toBe(2);
    });
  });

  it("price tiers are hidden from guests when show_prices_public is false", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 10 });
      await c.query(`update public.app_settings set value = 'false' where key = 'show_prices_public'`);
      await actAs(c, "guest");
      expect((await c.query(`select 1 from public.fabric_price_tiers where fabric_id = $1`, [f.fabricId])).rowCount).toBe(0);
      await actAs(c, "client", clientA);
      expect((await c.query(`select 1 from public.fabric_price_tiers where fabric_id = $1`, [f.fabricId])).rowCount).toBe(1);
    });
  });

  it("only admins can write the catalog and settings", async () => {
    await txn(async (c) => {
      const f = await createFabric(c);
      for (const [role, user] of [["guest"], ["client", clientA], ["sales", sales]] as const) {
        await actAs(c, role, user);
        const upd = await attempt(c, `update public.fabrics set is_featured = true where id = $1`, [f.fabricId]);
        expect(upd.ok && upd.rowCount === 0 || !upd.ok).toBe(true);
        const set = await attempt(c, `update public.app_settings set value = '99' where key = 'low_stock_threshold_m'`);
        expect(set.ok && set.rowCount === 0 || !set.ok).toBe(true);
        const ins = await attempt(c, `insert into public.categories (slug, name) values ('x-${role}', '{"fr":"x"}')`);
        expect(ins.ok).toBe(false);
      }
      await actAs(c, "admin", admin);
      const ok = await attempt(c, `update public.app_settings set value = '99' where key = 'low_stock_threshold_m'`);
      expect(ok.rowCount).toBe(1);
    });
  });

  it("private settings are not readable by guests, public ones are", async () => {
    await txn(async (c) => {
      await actAs(c, "guest");
      const r = await c.query(`select key from public.app_settings`);
      const keys = r.rows.map((x) => x.key);
      expect(keys).toContain("currency");
      expect(keys).not.toContain("staff_notification_email");
      const rpc = await attempt(c, `select public.setting_text('staff_notification_email')`);
      expect(rpc.ok).toBe(false);
    });
  });
});

describe("stock and customer data isolation", () => {
  it("only staff can read stock lots and movements", async () => {
    await txn(async (c) => {
      await createFabric(c, { meters: 50 });
      for (const [role, user] of [["guest"], ["client", clientA]] as const) {
        await actAs(c, role, user);
        expect((await c.query(`select 1 from public.stock_lots`)).rowCount).toBe(0);
        expect((await c.query(`select 1 from public.stock_movements`)).rowCount).toBe(0);
      }
      await actAs(c, "sales", sales);
      expect((await c.query(`select 1 from public.stock_lots`)).rowCount).toBeGreaterThan(0);
    });
  });

  it("clients only see their own profile, quotes and orders; staff see all", async () => {
    await txn(async (c) => {
      await asSuper(c);
      await c.query(`insert into public.quotes (client_id) values ($1), ($2)`, [clientA.clientId, clientB.clientId]);

      await actAs(c, "client", clientA);
      expect((await c.query(`select id from public.profiles`)).rows.map((r) => r.id)).toEqual([clientA.id]);
      const q = await c.query(`select client_id from public.quotes`);
      expect(q.rows.every((r) => r.client_id === clientA.clientId)).toBe(true);
      expect((await c.query(`select 1 from public.clients`)).rowCount).toBe(1);

      await actAs(c, "sales", sales);
      expect((await c.query(`select 1 from public.quotes where client_id in ($1, $2)`, [clientA.clientId, clientB.clientId])).rowCount).toBe(2);

      await actAs(c, "guest");
      expect((await c.query(`select 1 from public.quotes`)).rowCount).toBe(0);
      expect((await c.query(`select 1 from public.profiles`)).rowCount).toBe(0);
    });
  });

  it("nobody can insert contact messages directly; staff can read and handle them", async () => {
    await txn(async (c) => {
      await asSuper(c);
      await c.query(`select public.submit_contact_message('Ana', null, 'ana@example.com', null, 'Hello, I need fabric samples please', 'fr', 'rls-test-ip')`);
      for (const [role, user] of [["guest"], ["client", clientA]] as const) {
        await actAs(c, role, user);
        const ins = await attempt(c, `insert into public.contact_messages (name, email, message) values ('A','a@b.c','hi')`);
        expect(ins.ok).toBe(false);
        expect((await c.query(`select 1 from public.contact_messages`)).rowCount).toBe(0);
      }
      await actAs(c, "sales", sales);
      expect((await c.query(`select 1 from public.contact_messages`)).rowCount).toBeGreaterThan(0);
    });
  });

  it("rate_limits and embeddings are not accessible to clients", async () => {
    await txn(async (c) => {
      await actAs(c, "client", clientA);
      expect((await c.query(`select 1 from public.rate_limits`)).rowCount).toBe(0);
      expect((await c.query(`select 1 from public.embeddings`)).rowCount).toBe(0);
      const fn = await attempt(c, `select public.hit_rate_limit('k', 1, 60)`);
      expect(fn.ok).toBe(false);
    });
  });
});
