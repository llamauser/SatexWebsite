import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { actAs, asSuper, attempt, createUser, pool, txn } from "./helpers";

afterAll(async () => {
  await pool.end();
});

/** A 1024-dimension vector with a single 1 at `axis`: two different axes are orthogonal (similarity 0), the same axis is 1. */
const axis = (i: number) => `[${Array.from({ length: 1024 }, (_, k) => (k === i ? 1 : 0)).join(",")}]`;

// gsm 777 is outside the seeded catalog (20-500): a narrow weight window isolates the test fabrics from the seed
const WINDOW = { gsm_min: 760, gsm_max: 800 };

async function fixture(c: PoolClient, o: { gsm?: number; construction?: string; comp?: string; meters?: number; moq?: number; embedAxis?: number; hex?: string; price?: number } = {}) {
  await asSuper(c);
  const slug = `mc-${randomUUID().slice(0, 8)}`;
  const cat = await c.query(`insert into public.categories (slug, name) values ($1, '{"fr":"c"}') returning id`, [`cat-${slug}`]);
  const f = await c.query(
    `insert into public.fabrics (slug, sku, name, category_id, construction, structure, composition, gsm, width_cm, moq_m, base_price_per_m, is_active, uses, seasons)
     values ($1, $2, '{"fr":"Tissu match"}', $3, $4, 'jersey', $5, $6, 150, $7, 10, true, '{activewear}', '{all_season}') returning id`,
    [slug, `SKU-${slug}`, cat.rows[0].id, o.construction ?? "knit", o.comp ?? '[{"fiber":"cotton","pct":100}]', o.gsm ?? 777, o.moq ?? 2],
  );
  const id = f.rows[0].id as string;
  await c.query(`insert into public.fabric_price_tiers (fabric_id, min_m, price_per_m) values ($1, $2, $3)`, [id, o.moq ?? 2, o.price ?? 10]);
  const col = await c.query(`insert into public.fabric_colors (fabric_id, code, name, hex) values ($1, 'C1', '{"fr":"Couleur"}', $2) returning id`, [id, o.hex ?? "#1F3A5F"]);
  const colorId = col.rows[0].id as string;
  if (o.meters) await c.query(`select public.receive_lot($1, $2, $3)`, [colorId, `LOT-${slug}`, o.meters]);
  if (o.embedAxis !== undefined) {
    await c.query(`insert into public.embeddings (owner_type, owner_id, kind, model, embedding, content_hash) values ('fabric', $1, 'text', 'test', $2, 'h')`, [id, axis(o.embedAxis)]);
  }
  return { id, colorId, slug };
}

const run = async (c: PoolClient, spec: Record<string, unknown>, opts: { embedding?: string | null; required?: number; exclude?: string[]; limit?: number } = {}) => {
  await c.query("reset role"); // the function is for the server (service role); postgres stands in for it
  const { rows } = await c.query(`select * from public.match_candidates($1::extensions.vector, $2::jsonb, $3, $4, $5::uuid[])`, [
    opts.embedding ?? null, JSON.stringify({ ...WINDOW, ...spec }), opts.required ?? 0, opts.limit ?? 40, opts.exclude ?? [],
  ]);
  return rows as { color_id: string; fabric_id: string; text_sim: number; available_m: string; price: string; hex: string; lab: number[]; slug: string }[];
};

describe("match_candidates", () => {
  it("returns one row per in-stock color with price, hex, Lab and availability", async () => {
    await txn(async (c) => {
      const f = await fixture(c, { meters: 100, hex: "#C0392B", price: 12.5 });
      const rows = await run(c, {});
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ color_id: f.colorId, hex: "#C0392B", slug: f.slug });
      expect(Number(rows[0]!.available_m)).toBe(100);
      expect(Number(rows[0]!.price)).toBe(12.5);
      expect(rows[0]!.lab).toHaveLength(3);
    });
  });

  it("keeps only colors available at or above the MOQ and the required quantity", async () => {
    await txn(async (c) => {
      const enough = await fixture(c, { meters: 60, moq: 5 });
      await fixture(c, { meters: 4, moq: 5 }); // below the MOQ
      await fixture(c, { moq: 5 }); // no stock
      expect((await run(c, {})).map((r) => r.color_id)).toEqual([enough.colorId]);
      expect((await run(c, {}, { required: 50 })).map((r) => r.color_id)).toEqual([enough.colorId]);
      expect(await run(c, {}, { required: 61 })).toHaveLength(0);
    });
  });

  it("applies the hard filters: construction, fibers to avoid (5% or more), weight window (-25% / +25%)", async () => {
    await txn(async (c) => {
      const knit = await fixture(c, { meters: 50, construction: "knit" });
      const woven = await fixture(c, { meters: 50, construction: "woven" });
      expect((await run(c, { construction: "woven" })).map((r) => r.color_id)).toEqual([woven.colorId]);
      expect((await run(c, { construction: null })).map((r) => r.color_id).sort()).toEqual([knit.colorId, woven.colorId].sort());

      const wool = await fixture(c, { meters: 50, comp: '[{"fiber":"cotton","pct":92},{"fiber":"wool","pct":8}]' });
      const trace = await fixture(c, { meters: 50, comp: '[{"fiber":"cotton","pct":97},{"fiber":"wool","pct":3}]' });
      const avoided = (await run(c, { fibers_avoid: ["wool"] })).map((r) => r.color_id);
      expect(avoided).not.toContain(wool.colorId); // 8% wool is rejected
      expect(avoided).toContain(trace.colorId); // 3% is tolerated

      // window 760..800 accepts 570..1000
      const edge = await fixture(c, { meters: 50, gsm: 575 });
      const tooLight = await fixture(c, { meters: 50, gsm: 560 });
      const ids = (await run(c, {})).map((r) => r.color_id);
      expect(ids).toContain(edge.colorId);
      expect(ids).not.toContain(tooLight.colorId);
    });
  });

  it("ranks fabrics by vector similarity and reports it, missing embeddings count as 0", async () => {
    await txn(async (c) => {
      const close = await fixture(c, { meters: 50, embedAxis: 3 });
      const far = await fixture(c, { meters: 50, embedAxis: 4 });
      const none = await fixture(c, { meters: 50 });
      const rows = await run(c, {}, { embedding: axis(3) });
      expect(rows[0]!.color_id).toBe(close.colorId);
      expect(Number(rows[0]!.text_sim)).toBeCloseTo(1, 5);
      const bySim = Object.fromEntries(rows.map((r) => [r.color_id, Number(r.text_sim)]));
      expect(bySim[far.colorId]).toBeCloseTo(0, 5);
      expect(bySim[none.colorId]).toBe(0);
      // with no query vector everything is 0 and the search still works
      expect((await run(c, {}, { embedding: null })).every((r) => Number(r.text_sim) === 0)).toBe(true);
    });
  });

  it("limits the number of fabrics (not colors) and excludes the colors it is told to", async () => {
    await txn(async (c) => {
      const a = await fixture(c, { meters: 50, embedAxis: 5 });
      await fixture(c, { meters: 50, embedAxis: 6 });
      await fixture(c, { meters: 50, embedAxis: 7 });
      await c.query(`insert into public.fabric_colors (fabric_id, code, name, hex, sort) values ($1, 'C2', '{"fr":"x"}', '#808080', 2)`, [a.id]);
      await c.query(`select public.receive_lot((select id from public.fabric_colors where fabric_id = $1 and code = 'C2'), $2, 50)`, [a.id, `L2-${a.slug}`]);
      const rows = await run(c, {}, { embedding: axis(5), limit: 2 });
      expect(new Set(rows.map((r) => r.fabric_id)).size).toBe(2);
      expect(rows.filter((r) => r.fabric_id === a.id)).toHaveLength(2); // both colors of the best fabric
      const without = await run(c, {}, { embedding: axis(5), limit: 2, exclude: [a.colorId] });
      expect(without.map((r) => r.color_id)).not.toContain(a.colorId);
    });
  });

  it("ignores inactive fabrics", async () => {
    await txn(async (c) => {
      const f = await fixture(c, { meters: 50 });
      await c.query(`update public.fabrics set is_active = false where id = $1`, [f.id]);
      expect(await run(c, {})).toHaveLength(0);
    });
  });

  it("is for the server only: guests and clients cannot call it", async () => {
    await txn(async (c) => {
      const client = await createUser("client", c);
      for (const [role, user] of [["guest"], ["client", client]] as const) {
        await actAs(c, role, user);
        expect((await attempt(c, `select * from public.match_candidates(null, '{}'::jsonb, 0, 5, '{}')`)).error).toMatch(/permission denied/);
      }
    });
  });
});
