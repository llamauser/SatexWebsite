import { afterAll, describe, expect, it } from "vitest";
import { actAs, pool, txn } from "./helpers";

/** These tests describe the seeded database; they are skipped on a database that was never seeded. */
const seeded = Number((await pool.query(`select count(*)::int as n from public.fabrics where is_demo`)).rows[0].n) > 0;
const d = describe.skipIf(!seeded);

afterAll(async () => {
  await pool.end();
});

const one = async <T = Record<string, unknown>>(sql: string): Promise<T> => (await pool.query(sql)).rows[0] as T;
const count = async (sql: string) => Number((await one<{ n: string }>(sql)).n);
const demoColors = () =>
  count(`select count(*) as n from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id where f.is_demo`);

d("seeded catalog", () => {
  it("has 80 fabrics with the required category counts (so a second seed run created no duplicates)", async () => {
    expect(await count(`select count(*) as n from public.fabrics where is_demo`)).toBe(80);
    const { rows } = await pool.query(
      `select c.slug, count(*)::int as n from public.fabrics f join public.categories c on c.id = f.category_id where f.is_demo group by c.slug`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.slug, r.n]))).toEqual({
      knits: 14, "technical-activewear": 10, shirting: 10, suiting: 8, denim: 7,
      "natural-fibers": 10, eveningwear: 9, upholstery: 8, linings: 4,
    });
    expect(await count(`select count(*) as n from public.categories where slug in ('knits','technical-activewear','shirting','suiting','denim','natural-fibers','eveningwear','upholstery','linings')`)).toBe(9);
    expect(await count(`select count(*) as n from public.departments`)).toBe(11);
  });

  it("has the golden fabrics, searchable text and Lab colors", async () => {
    const { rows } = await pool.query(
      `select slug from public.fabrics where is_demo and slug in ('cotton-elastane-pique','breathable-poly-mesh','organic-cotton-jersey-180','stretch-denim-12oz','linen-plain-160','silk-satin-90','wool-gabardine-260','velvet-upholstery-480')`,
    );
    expect(rows).toHaveLength(8);
    expect(await count(`select count(*) as n from public.fabrics where is_demo and search_text is null`)).toBe(0);
    expect(await count(`select count(*) as n from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id where f.is_demo and c.lab is null`)).toBe(0);
    expect(await demoColors()).toBeGreaterThan(340);
    expect(await count(`select count(*) as n from public.fabric_price_tiers t join public.fabrics f on f.id = t.fabric_id where f.is_demo`)).toBe(240);
  });

  it("every color has a photo, a flat swatch and texture paths, and the files exist in storage", async () => {
    const colors = await demoColors();
    expect(await count(`select count(*) as n from public.fabric_images i join public.fabrics f on f.id = i.fabric_id where f.is_demo and i.kind = 'photo'`)).toBe(colors);
    expect(await count(`select count(*) as n from public.fabric_images i join public.fabrics f on f.id = i.fabric_id where f.is_demo and i.kind = 'flat_swatch'`)).toBe(colors);
    expect(await count(`select count(*) as n from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id where f.is_demo and c.texture is null`)).toBe(0);
    expect(await count(`select count(*) as n from storage.objects where bucket_id = 'fabric-images' and name like 'fabrics/%-photo.webp'`)).toBe(colors);
    expect(await count(`select count(*) as n from storage.objects where bucket_id = 'textures' and name like '%/albedo.webp'`)).toBe(colors);
  });

  it("stock is realistic: ~10% out of stock, ~10% low stock, department assigned", async () => {
    const { n, out, low } = await one<{ n: string; out: string; low: string }>(
      `select count(*) as n,
              count(*) filter (where on_hand_m = 0) as out,
              count(*) filter (where on_hand_m > 0 and on_hand_m < 50) as low
         from public.v_color_availability_all a join public.fabrics f on f.id = a.fabric_id where f.is_demo`,
    );
    expect(Number(out) / Number(n)).toBeGreaterThan(0.04);
    expect(Number(out) / Number(n)).toBeLessThan(0.2);
    expect(Number(low) / Number(n)).toBeGreaterThan(0.04);
    expect(await count(`select count(*) as n from public.stock_lots l join public.fabric_colors c on c.id = l.color_id join public.fabrics f on f.id = c.fabric_id where f.is_demo and l.department_id is null`)).toBe(0);
    // every lot's meters equals the sum of its movements
    expect(
      await count(`select count(*) as n from public.stock_lots l where l.lot_code like 'L-SAT-%' and l.meters <> (select coalesce(sum(m.meters),0) from public.stock_movements m where m.lot_id = l.id and m.type in ('receive','adjust','cut'))`),
    ).toBe(0);
  });
});

d("seeded users and demo operations", () => {
  it("has 8 users with the right roles and confirmed emails", async () => {
    const { rows } = await pool.query(
      `select p.role, count(*)::int as n from public.profiles p join auth.users u on u.id = p.id
        where u.email in ('admin@satex.test','sales1@satex.test','sales2@satex.test','client1@satex.test','client2@satex.test','client3@satex.test','client4@satex.test','client5@satex.test') and u.email_confirmed_at is not null group by p.role`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.role, r.n]))).toEqual({ admin: 1, sales: 2, client: 5 });
  });

  it("has quotes in every status, 6 orders in every state with cutting jobs and deliveries, samples and reservations", async () => {
    const { rows } = await pool.query(`select status, count(*)::int as n from public.quotes where is_demo group by status`);
    const q = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    expect(q).toMatchObject({ draft: 1, sent: 1, submitted: 1, in_review: 1, rejected: 1, expired: 1, accepted: 1, converted: 6 });
    expect(await count(`select count(*) as n from public.quotes where is_demo`)).toBe(13);

    const orders = (await pool.query(`select status from public.orders where is_demo order by status`)).rows.map((r) => r.status);
    expect(orders.sort()).toEqual(["cancelled", "confirmed", "delivered", "in_preparation", "ready", "shipped"]);
    expect(await count(`select count(*) as n from public.cutting_jobs cj join public.order_lines ol on ol.id = cj.order_line_id join public.orders o on o.id = ol.order_id where o.is_demo`)).toBeGreaterThanOrEqual(6);
    expect(await count(`select count(*) as n from public.cutting_jobs cj join public.order_lines ol on ol.id = cj.order_line_id join public.orders o on o.id = ol.order_id where o.is_demo and cj.status = 'ready'`)).toBeGreaterThan(0);
    expect(await count(`select count(*) as n from public.deliveries d join public.orders o on o.id = d.order_id where o.is_demo`)).toBe(2);
    expect(await count(`select count(*) as n from public.sample_requests where is_demo`)).toBe(4);
    expect(await count(`select count(*) as n from public.stock_reservations r join public.clients c on c.id = r.client_id where c.is_demo and r.status = 'active'`)).toBe(3);
    expect(await count(`select count(*) as n from public.addresses a join public.clients c on c.id = a.client_id where c.is_demo`)).toBe(10);
  });

  it("order totals are consistent with their quotes", async () => {
    expect(
      await count(`select count(*) as n from public.orders o join public.quotes q on q.id = o.quote_id where o.total <> q.total or o.subtotal <> q.subtotal`),
    ).toBe(0);
  });
});

d("seeded data through row level security", () => {
  it("a guest sees all 80 active fabrics and their stock, but no stock lots", async () => {
    await txn(async (c) => {
      await actAs(c, "guest");
      expect((await c.query(`select count(*)::int as n from public.fabrics where is_demo`)).rows[0].n).toBe(80);
      expect((await c.query(`select count(*)::int as n from public.v_color_availability a join public.fabrics f on f.id = a.fabric_id where f.is_demo and a.available_m > 0`)).rows[0].n).toBeGreaterThan(300);
      expect((await c.query(`select count(*)::int as n from public.stock_lots`)).rows[0].n).toBe(0);
      expect((await c.query(`select count(*)::int as n from public.fabric_price_tiers t join public.fabrics f on f.id = t.fabric_id where f.is_demo`)).rows[0].n).toBe(240);
    });
  });
});
