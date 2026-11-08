import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { actAs, asSuper, attempt, createFabric, createUser, pool, txn } from "./helpers";

afterAll(async () => {
  await pool.end();
});

describe("color_family", () => {
  const fixtures: [string, string][] = [
    ["#FFFFFF", "white"], ["#F7F7F5", "white"], ["#000000", "black"], ["#1A1A1A", "black"], ["#2C2C2E", "black"],
    ["#808080", "grey"], ["#8C9096", "grey"], ["#B3B6B9", "grey"], ["#3A3F45", "grey"],
    ["#FF0000", "red"], ["#C0392B", "red"], ["#6D1F2F", "red"], ["#9B111E", "red"],
    ["#E8B4B8", "pink"], ["#FFC0CB", "pink"], ["#C2185B", "pink"], ["#FF00FF", "pink"],
    ["#E8812B", "orange"], ["#FFA500", "orange"], ["#D4A017", "yellow"], ["#FFFF00", "yellow"], ["#F2E04A", "yellow"],
    ["#D8C3A5", "beige"], ["#C9B28C", "beige"], ["#E5D3B3", "beige"], ["#B8864B", "brown"], ["#6B4226", "brown"], ["#8B4513", "brown"], ["#3E2723", "brown"],
    ["#6B6B3A", "green"], ["#1F4D3A", "green"], ["#A8D5BA", "green"], ["#00FF00", "green"], ["#0F7B5F", "green"],
    ["#1F3A5F", "blue"], ["#2C5AA0", "blue"], ["#8DB8E0", "blue"], ["#2BA6A6", "blue"], ["#0000FF", "blue"],
    ["#6A3D9A", "purple"], ["#B9A7D6", "purple"], ["#8000FF", "purple"],
  ];
  it.each(fixtures)("%s is %s", async (hex, family) => {
    const { rows } = await pool.query(`select public.color_family(public.hex_to_lab($1)) as f`, [hex]);
    expect(rows[0].f).toBe(family);
  });

  it("is stored on fabric colors (and follows hex changes)", async () => {
    await txn(async (c) => {
      const f = await createFabric(c);
      expect((await c.query(`select family from public.fabric_colors where id = $1`, [f.colorId])).rows[0].family).toBe("blue"); // #1F3A5F
      await c.query(`update public.fabric_colors set hex = '#C0392B' where id = $1`, [f.colorId]);
      expect((await c.query(`select family from public.fabric_colors where id = $1`, [f.colorId])).rows[0].family).toBe("red");
    });
  });
});

/** A fabric with a unique search token so tests can isolate it from the seeded catalog. */
async function fixture(c: PoolClient, token: string, opts: { meters?: number; gsm?: number; structure?: string; comp?: string; stretch?: string; uses?: string[]; seasons?: string[]; hex?: string; price?: number; category?: string; featured?: boolean; active?: boolean } = {}) {
  await asSuper(c);
  const slug = `cat-${token}-${randomUUID().slice(0, 6)}`;
  const cat = await c.query(`insert into public.categories (slug, name) values ($1, '{"fr":"Cat test"}') on conflict (slug) do update set slug = excluded.slug returning id`, [opts.category ?? `cat-${token}`]);
  const f = await c.query(
    `insert into public.fabrics (slug, sku, name, category_id, construction, structure, composition, gsm, width_cm, stretch, uses, seasons, moq_m, base_price_per_m, is_active, is_featured)
     values ($1, $2, $3, $4, 'knit', $5, $6, $7, 150, $8, $9, $10, 2, 10, $11, $12) returning id`,
    [slug, `SKU-${slug}`, JSON.stringify({ fr: `Tissu ${token}`, en: `Fabric ${token}` }), cat.rows[0].id, opts.structure ?? "jersey",
     opts.comp ?? '[{"fiber":"cotton","pct":100}]', opts.gsm ?? 180, opts.stretch ?? "none", opts.uses ?? ["t_shirts"], opts.seasons ?? ["all_season"],
     opts.active ?? true, opts.featured ?? false],
  );
  await c.query(`insert into public.fabric_price_tiers (fabric_id, min_m, price_per_m) values ($1, 2, $2)`, [f.rows[0].id, opts.price ?? 10]);
  const col = await c.query(`insert into public.fabric_colors (fabric_id, code, name, hex) values ($1, 'C1', '{"fr":"Couleur"}', $2) returning id`, [f.rows[0].id, opts.hex ?? "#1F3A5F"]);
  if (opts.meters) await c.query(`select public.receive_lot($1, $2, $3)`, [col.rows[0].id, `LOT-${slug}`, opts.meters]);
  return { id: f.rows[0].id as string, slug, colorId: col.rows[0].id as string };
}

const search = async (c: PoolClient, args: Record<string, unknown>) => {
  const p = { p_q: null, p_categories: null, p_constructions: null, p_structures: null, p_fibers: null, p_gsm_min: null, p_gsm_max: null, p_stretch: null, p_uses: null, p_season: null, p_colors: null, p_in_stock: false, p_sort: "relevance", p_limit: 24, p_offset: 0, ...args };
  const keys = Object.keys(p);
  const { rows } = await c.query(`select * from public.catalog_search(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, keys.map((k) => (p as Record<string, unknown>)[k]));
  return rows as { slug: string; total_count: string; in_stock: boolean; from_price: string | null; available_m: string; color_count: number; colors: unknown[] }[];
};

describe("catalog_search", () => {
  it("finds by text, with prefix match, accents ignored, case ignored", async () => {
    await txn(async (c) => {
      const token = `zz${randomUUID().slice(0, 6)}`;
      const a = await fixture(c, token);
      await actAs(c, "guest");
      expect((await search(c, { p_q: token })).map((r) => r.slug)).toEqual([a.slug]);
      expect((await search(c, { p_q: token.toUpperCase() })).map((r) => r.slug)).toEqual([a.slug]);
      expect((await search(c, { p_q: token.slice(0, 5) })).map((r) => r.slug)).toContain(a.slug); // prefix
      expect(await search(c, { p_q: `${token}-nope-nothing` })).toHaveLength(0);
    });
  });

  it("filters by structure, fiber, weight, stretch, use, season and color", async () => {
    await txn(async (c) => {
      const token = `zz${randomUUID().slice(0, 6)}`;
      const pique = await fixture(c, token, { structure: "pique", comp: '[{"fiber":"cotton","pct":92},{"fiber":"elastane","pct":8}]', gsm: 240, stretch: "two_way", uses: ["activewear", "polos"], seasons: ["spring_summer"], hex: "#C0392B" });
      const linen = await fixture(c, token, { structure: "plain", comp: '[{"fiber":"linen","pct":100}]', gsm: 160, uses: ["shirts"], seasons: ["all_season"], hex: "#D8C3A5" });
      await actAs(c, "guest");
      const slugs = async (args: Record<string, unknown>) => (await search(c, { p_q: token, ...args })).map((r) => r.slug).sort();
      expect(await slugs({})).toEqual([linen.slug, pique.slug].sort());
      expect(await slugs({ p_structures: ["pique"] })).toEqual([pique.slug]);
      expect(await slugs({ p_fibers: ["elastane"] })).toEqual([pique.slug]);
      expect(await slugs({ p_fibers: ["linen", "elastane"] })).toEqual([linen.slug, pique.slug].sort());
      expect(await slugs({ p_gsm_min: 200 })).toEqual([pique.slug]);
      expect(await slugs({ p_gsm_max: 170 })).toEqual([linen.slug]);
      expect(await slugs({ p_gsm_min: 150, p_gsm_max: 170 })).toEqual([linen.slug]);
      expect(await slugs({ p_stretch: ["two_way", "four_way"] })).toEqual([pique.slug]);
      expect(await slugs({ p_uses: ["polos", "dresses"] })).toEqual([pique.slug]);
      expect(await slugs({ p_colors: ["red"] })).toEqual([pique.slug]);
      expect(await slugs({ p_colors: ["beige"] })).toEqual([linen.slug]);
      expect(await slugs({ p_colors: ["green"] })).toEqual([]);
      expect(await slugs({ p_constructions: ["woven"] })).toEqual([]);
      expect(await slugs({ p_categories: [`cat-${token}`] })).toEqual([linen.slug, pique.slug].sort());
      // season: spring-summer shows spring-summer fabrics AND all-season ones; all_season only the all-season ones
      expect(await slugs({ p_season: "spring_summer" })).toEqual([linen.slug, pique.slug].sort());
      expect(await slugs({ p_season: "autumn_winter" })).toEqual([linen.slug]);
      expect(await slugs({ p_season: "all_season" })).toEqual([linen.slug]);
    });
  });

  it("in_stock keeps only fabrics with a color available at or above the MOQ, and reservations reduce it", async () => {
    await txn(async (c) => {
      const token = `zz${randomUUID().slice(0, 6)}`;
      const stocked = await fixture(c, token, { meters: 100 });
      const tiny = await fixture(c, token, { meters: 1 }); // MOQ is 2 m
      const empty = await fixture(c, token);
      await actAs(c, "guest");
      const slugs = async (inStock: boolean) => (await search(c, { p_q: token, p_in_stock: inStock })).map((r) => r.slug).sort();
      expect(await slugs(true)).toEqual([stocked.slug]);
      expect(await slugs(false)).toEqual([empty.slug, stocked.slug, tiny.slug].sort());
      const row = (await search(c, { p_q: token, p_in_stock: true }))[0]!;
      expect(row.in_stock).toBe(true);
      expect(Number(row.available_m)).toBe(100);
      // a big reservation takes the stock below the MOQ
      const client = await createUser("client", c);
      await asSuper(c);
      await c.query(`insert into public.stock_reservations (color_id, client_id, meters, expires_at) values ($1, $2, 99, now() + interval '1 day')`, [stocked.colorId, client.clientId]);
      await actAs(c, "guest");
      expect(await slugs(true)).toEqual([]);
    });
  });

  it("sorts by price and weight, and paginates with a stable total", async () => {
    await txn(async (c) => {
      const token = `zz${randomUUID().slice(0, 6)}`;
      const cheap = await fixture(c, token, { price: 5, gsm: 300 });
      const mid = await fixture(c, token, { price: 8, gsm: 200 });
      const dear = await fixture(c, token, { price: 20, gsm: 100 });
      await actAs(c, "guest");
      const order = async (sort: string) => (await search(c, { p_q: token, p_sort: sort })).map((r) => r.slug);
      expect(await order("price_asc")).toEqual([cheap.slug, mid.slug, dear.slug]);
      expect(await order("price_desc")).toEqual([dear.slug, mid.slug, cheap.slug]);
      expect(await order("gsm_asc")).toEqual([dear.slug, mid.slug, cheap.slug]);
      expect(await order("gsm_desc")).toEqual([cheap.slug, mid.slug, dear.slug]);
      const page1 = await search(c, { p_q: token, p_sort: "price_asc", p_limit: 2, p_offset: 0 });
      const page2 = await search(c, { p_q: token, p_sort: "price_asc", p_limit: 2, p_offset: 2 });
      expect(page1.map((r) => r.slug)).toEqual([cheap.slug, mid.slug]);
      expect(page2.map((r) => r.slug)).toEqual([dear.slug]);
      expect(Number(page1[0]!.total_count)).toBe(3);
      expect(Number(page2[0]!.total_count)).toBe(3);
    });
  });

  it("hides inactive fabrics and (when prices are not public) hides prices from guests only", async () => {
    await txn(async (c) => {
      const token = `zz${randomUUID().slice(0, 6)}`;
      await fixture(c, token, { active: false });
      const live = await fixture(c, token, { price: 12 });
      await actAs(c, "guest");
      expect((await search(c, { p_q: token })).map((r) => r.slug)).toEqual([live.slug]);
      expect(Number((await search(c, { p_q: token }))[0]!.from_price)).toBe(12);

      await asSuper(c);
      await c.query(`update public.app_settings set value = 'false' where key = 'show_prices_public'`);
      await actAs(c, "guest");
      expect((await search(c, { p_q: token }))[0]!.from_price).toBeNull();
      const client = await createUser("client", c);
      await actAs(c, "client", client);
      expect(Number((await search(c, { p_q: token }))[0]!.from_price)).toBe(12);
    });
  });

  it("returns color previews (max 6) and the color count", async () => {
    await txn(async (c) => {
      const token = `zz${randomUUID().slice(0, 6)}`;
      const f = await fixture(c, token);
      for (let i = 2; i <= 8; i++) await c.query(`insert into public.fabric_colors (fabric_id, code, name, hex, sort) values ($1, $2, '{"fr":"x"}', '#808080', $3)`, [f.id, `C${i}`, i]);
      await actAs(c, "guest");
      const row = (await search(c, { p_q: token }))[0]!;
      expect(row.color_count).toBe(8);
      expect(row.colors).toHaveLength(6);
    });
  });

  it("works on the seeded catalog when it exists (default view)", async () => {
    const seeded = Number((await pool.query(`select count(*)::int as n from public.fabrics where is_demo`)).rows[0].n);
    if (seeded === 0) return;
    await txn(async (c) => {
      await actAs(c, "guest");
      const rows = await search(c, { p_in_stock: false });
      expect(rows).toHaveLength(24);
      expect(Number(rows[0]!.total_count)).toBeGreaterThanOrEqual(80);
      const denim = await search(c, { p_categories: ["denim"], p_in_stock: false, p_limit: 50 });
      expect(denim.length).toBe(7);
    });
  });

  it("is callable by guests but the internal availability view is not", async () => {
    await txn(async (c) => {
      await actAs(c, "guest");
      expect((await attempt(c, `select * from public.catalog_search()`)).ok).toBe(true);
      expect((await attempt(c, `select * from public.v_color_availability_all`)).error).toMatch(/permission denied/);
    });
  });
});

describe("stock change broadcast", () => {
  it("never blocks a stock operation, whether or not Realtime is available", async () => {
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 50 });
      const lot = (await c.query(`select id from public.stock_lots where color_id = $1`, [f.colorId])).rows[0].id;
      expect((await attempt(c, `select public.adjust_stock($1, -10, 'test')`, [lot])).ok).toBe(true);
      const client = await createUser("client", c);
      await actAs(c, "client", client);
      expect((await attempt(c, `select public.reserve_stock($1, 5)`, [f.colorId])).ok).toBe(true);
    });
  });

  it("writes a message on the fabric channel topic (when Realtime is installed)", async () => {
    const exists = (await pool.query(`select to_regclass('realtime.messages') as t`)).rows[0].t;
    if (!exists) return;
    await txn(async (c) => {
      const f = await createFabric(c, { meters: 50 });
      await asSuper(c);
      const lot = (await c.query(`select id from public.stock_lots where color_id = $1`, [f.colorId])).rows[0].id;
      await c.query(`select public.adjust_stock($1, -10, 'broadcast test')`, [lot]);
      const { rows } = await c.query(`select count(*)::int as n from realtime.messages where topic = $1 and event = 'stock'`, [`fabric:${f.fabricId}`]);
      expect(rows[0].n).toBeGreaterThanOrEqual(2); // the receipt and the adjustment
    });
  });
});
