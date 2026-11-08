import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

/** Local Supabase Postgres (supabase start). Override with DATABASE_URL in CI. */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  max: 20,
});

export type Role = "guest" | "client" | "sales" | "admin";

export interface TestUser {
  id: string;
  email: string;
  role: Role;
  clientId: string;
}

/** Run `fn` inside a transaction that is ALWAYS rolled back (unless commit = true). */
export async function txn<T>(fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query(commit ? "commit" : "rollback");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Switch the current transaction to the Postgres role + JWT claims PostgREST would use. */
export async function actAs(c: PoolClient, role: Role, user?: TestUser) {
  await c.query("reset role");
  if (role === "guest") {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: "anon" })]);
    await c.query("set local role anon");
    return;
  }
  if (!user) throw new Error("user required");
  const claims = { sub: user.id, role: "authenticated", user_role: role, email: user.email };
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await c.query("set local role authenticated");
}

export async function asSuper(c: PoolClient) {
  await c.query("reset role");
  await c.query(`select set_config('request.jwt.claims', '', true)`);
}

/** Run a statement that is expected to possibly fail, without aborting the surrounding transaction. */
export async function attempt(c: PoolClient, sql: string, params: unknown[] = []) {
  await c.query("savepoint attempt");
  try {
    const r = await c.query(sql, params);
    await c.query("release savepoint attempt");
    return { ok: true as const, rows: r.rows, rowCount: r.rowCount ?? 0, error: "" };
  } catch (e) {
    await c.query("rollback to savepoint attempt");
    return { ok: false as const, rows: [] as never[], rowCount: 0, error: (e as Error).message };
  }
}

/** Create an auth user (the on_auth_user_created trigger creates client + profile) and set its role. */
export async function createUser(
  role: Exclude<Role, "guest">,
  c?: PoolClient,
  metadata: Record<string, unknown> = {},
): Promise<TestUser> {
  const id = randomUUID();
  const email = `${role}-${id.slice(0, 8)}@satex.test`;
  const run = async (cl: PoolClient) => {
    await asSuper(cl);
    await cl.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
      id,
      email,
      JSON.stringify({ company_name: `Co ${id.slice(0, 6)}`, ...metadata }),
    ]);
    if (role !== "client") await cl.query(`update public.profiles set role = $2 where id = $1`, [id, role]);
    const { rows } = await cl.query(`select client_id from public.profiles where id = $1`, [id]);
    return { id, email, role, clientId: rows[0].client_id as string };
  };
  if (c) return run(c);
  return txn(run, true);
}

export interface TestFabric {
  fabricId: string;
  colorId: string;
  slug: string;
}

/** Active fabric with one active color, a price tier, and optionally a stock lot. Super-user context. */
export async function createFabric(
  c: PoolClient,
  opts: { meters?: number; active?: boolean; moq?: number } = {},
): Promise<TestFabric> {
  await asSuper(c);
  const slug = `fab-${randomUUID().slice(0, 8)}`;
  const cat = await c.query(
    `insert into public.categories (slug, name) values ($1, '{"fr":"Test"}') returning id`,
    [`cat-${slug}`],
  );
  const fab = await c.query(
    `insert into public.fabrics (slug, sku, name, category_id, construction, structure, composition, gsm, width_cm, moq_m, base_price_per_m, is_active)
     values ($1, $2, '{"fr":"Tissu test"}', $3, 'knit', 'pique', '[{"fiber":"cotton","pct":92},{"fiber":"elastane","pct":8}]', 240, 150, $4, 10, $5)
     returning id`,
    [slug, `SKU-${slug}`, cat.rows[0].id, opts.moq ?? 1, opts.active ?? true],
  );
  const fabricId = fab.rows[0].id as string;
  await c.query(`insert into public.fabric_price_tiers (fabric_id, min_m, price_per_m) values ($1, $2, 10)`, [
    fabricId,
    opts.moq ?? 1,
  ]);
  const col = await c.query(
    `insert into public.fabric_colors (fabric_id, code, name, hex) values ($1, 'NAVY', '{"fr":"Marine"}', '#1F3A5F') returning id`,
    [fabricId],
  );
  const colorId = col.rows[0].id as string;
  if (opts.meters) {
    await c.query(`select public.receive_lot($1, $2, $3)`, [colorId, `LOT-${slug}`, opts.meters]);
  }
  return { fabricId, colorId, slug };
}
