/**
 * Seed script (docs/12-seed-data.md). Idempotent: safe to re-run.
 *
 *   pnpm db:seed                      everything (local / staging)
 *   pnpm db:seed --reference-only     settings + categories + departments only (production)
 *   flags: --skip-images --skip-users --skip-demo --force-images
 *
 * Env: DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read from `supabase status` when local),
 *      SEED_ENV = local | staging | production (required when the target is not localhost).
 * The 80 fabrics, colors and generated images are demo data (is_demo = true) and can be purged later.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { photoRaw, normalRaw, roughnessRaw, swatchRaw, toWebp } from "./lib/textures";
import { CATEGORIES, DEPARTMENTS, QUOTE_TERMS } from "./seed-data/reference";
import { buildFabrics, type SeedFabric } from "./seed-data/fabrics";
import { hashString, int, rng } from "./seed-data/rng";

const args = new Set(process.argv.slice(2));
const flag = (n: string) => args.has(`--${n}`);

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(SUPABASE_URL);
const SEED_ENV = process.env.SEED_ENV ?? (isLocal ? "local" : "");

function log(msg: string) {
  console.log(`[seed] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[seed] ERROR: ${msg}`);
  process.exit(1);
}

function serviceKey(): string {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (isLocal) {
    try {
      const out = execSync("pnpm exec supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString();
      const key = (JSON.parse(out) as Record<string, string>).SERVICE_ROLE_KEY;
      if (key) return key;
    } catch {
      /* fall through */
    }
  }
  return fail("SUPABASE_SERVICE_ROLE_KEY is not set (and could not be read from `supabase status`).");
}

// ------------------------------------------------------------------ reference data
async function seedReference(db: Client): Promise<{ categoryIds: Map<string, string> }> {
  await db.query(
    `insert into public.app_settings (key, value, is_public) values ('quote_terms', $1, false)
     on conflict (key) do nothing`,
    [JSON.stringify(QUOTE_TERMS)],
  );
  const categoryIds = new Map<string, string>();
  for (const c of CATEGORIES) {
    const { rows } = await db.query(
      `insert into public.categories (slug, name, description, icon, sort) values ($1, $2, $3, $4, $5)
       on conflict (slug) do update set name = excluded.name, description = excluded.description, icon = excluded.icon, sort = excluded.sort
       returning id`,
      [c.slug, JSON.stringify(c.name), JSON.stringify(c.description), c.icon, c.sort],
    );
    categoryIds.set(c.slug, rows[0].id);
  }
  for (const d of DEPARTMENTS) {
    await db.query(
      `insert into public.departments (slug, name, floor, kind, layout, category_ids, sort) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (slug) do update set name = excluded.name, floor = excluded.floor, kind = excluded.kind,
         layout = excluded.layout, category_ids = excluded.category_ids, sort = excluded.sort`,
      [d.slug, JSON.stringify(d.name), d.floor, d.kind, JSON.stringify(d.layout), d.categories.map((s) => categoryIds.get(s)!), d.sort],
    );
  }
  log(`reference data: ${CATEGORIES.length} categories, ${DEPARTMENTS.length} departments, quote terms`);
  return { categoryIds };
}

// ------------------------------------------------------------------ fabrics, colors, tiers
interface ColorRef { id: string; fabricId: string; code: string; hex: string; fabric: SeedFabric }

async function seedFabrics(db: Client, categoryIds: Map<string, string>): Promise<ColorRef[]> {
  const fabrics = buildFabrics();
  const colors: ColorRef[] = [];
  await db.query("begin");
  try {
    for (const f of fabrics) {
      const { rows } = await db.query(
        `insert into public.fabrics (slug, sku, name, short_description, description, category_id, construction, structure,
           composition, gsm, width_cm, stretch, stretch_pct, finish, uses, seasons, tags, moq_m, base_price_per_m, eco,
           is_active, is_featured, is_demo)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true,$21,true)
         on conflict (slug) do update set sku = excluded.sku, name = excluded.name, short_description = excluded.short_description,
           description = excluded.description, category_id = excluded.category_id, construction = excluded.construction,
           structure = excluded.structure, composition = excluded.composition, gsm = excluded.gsm, width_cm = excluded.width_cm,
           stretch = excluded.stretch, stretch_pct = excluded.stretch_pct, finish = excluded.finish, uses = excluded.uses,
           seasons = excluded.seasons, tags = excluded.tags, moq_m = excluded.moq_m, base_price_per_m = excluded.base_price_per_m,
           eco = excluded.eco, is_active = true, is_featured = excluded.is_featured
         returning id`,
        [
          f.slug, f.sku, JSON.stringify(f.name), JSON.stringify(f.shortDescription), JSON.stringify(f.description),
          categoryIds.get(f.categorySlug), f.construction, f.structure, JSON.stringify(f.composition), f.gsm, f.widthCm,
          f.stretch, f.stretchPct, f.finish, f.uses, f.seasons, f.tags, f.moqM, f.basePrice, JSON.stringify(f.eco), f.isFeatured,
        ],
      );
      const fabricId: string = rows[0].id;
      for (const t of f.tiers) {
        await db.query(
          `insert into public.fabric_price_tiers (fabric_id, min_m, price_per_m) values ($1, $2, $3)
           on conflict (fabric_id, min_m) do update set price_per_m = excluded.price_per_m`,
          [fabricId, t.minM, t.pricePerM],
        );
      }
      for (const c of f.colors) {
        const res = await db.query(
          `insert into public.fabric_colors (fabric_id, code, name, hex, sort) values ($1, $2, $3, $4, $5)
           on conflict (fabric_id, code) do update set name = excluded.name, hex = excluded.hex, sort = excluded.sort
           returning id`,
          [fabricId, c.code, JSON.stringify(c.name), c.hex, c.sort],
        );
        colors.push({ id: res.rows[0].id, fabricId, code: c.code, hex: c.hex, fabric: f });
      }
    }
    await db.query("commit");
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
  log(`fabrics: ${fabrics.length}, colors: ${colors.length}`);
  return colors;
}

// ------------------------------------------------------------------ stock
const DEPT_FOR_CATEGORY: Record<string, string> = {
  "natural-fibers": "natural-fibers", upholstery: "upholstery", knits: "knits", "technical-activewear": "knits",
  shirting: "shirting-suiting", suiting: "shirting-suiting", linings: "shirting-suiting", denim: "denim", eveningwear: "eveningwear",
};

async function seedStock(db: Client, colors: ColorRef[]) {
  const depts = new Map((await db.query(`select id, slug from public.departments`)).rows.map((r) => [r.slug as string, r.id as string]));
  let created = 0;
  let outOfStock = 0;
  for (const c of colors) {
    const existing = await db.query(`select 1 from public.stock_lots where color_id = $1 limit 1`, [c.id]);
    if (existing.rowCount) continue;
    const r = rng(`stock:${c.fabric.slug}:${c.code}`);
    const roll = r();
    if (roll < 0.1) { outOfStock++; continue; }                       // ~10% out of stock
    const total = roll < 0.2 ? int(r, 5, 45) : int(r, 60, 800);       // ~10% low stock (< 50 m)
    const lots = roll < 0.2 ? 1 : int(r, 1, 4);
    const weights = Array.from({ length: lots }, () => 0.3 + r());
    const wSum = weights.reduce((a, b) => a + b, 0);
    const dept = depts.get(DEPT_FOR_CATEGORY[c.fabric.categorySlug] ?? "");
    for (let i = 0; i < lots; i++) {
      const meters = Math.max(1, Math.round((total * weights[i]!) / wSum));
      await db.query(`select public.receive_lot($1, $2, $3, $4, $5)`, [
        c.id, `L-${c.fabric.sku}-${c.code}-${i + 1}`, meters, dept ?? null, `Rack ${String.fromCharCode(65 + int(r, 0, 7))}${int(r, 1, 12)}`,
      ]);
      created++;
    }
  }
  log(`stock: ${created} lots created, ${outOfStock} colors left out of stock`);
}

// ------------------------------------------------------------------ images (storage)
async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

async function upload(sb: SupabaseClient, bucket: string, path: string, body: Buffer) {
  const { error } = await sb.storage.from(bucket).upload(path, body, { contentType: "image/webp", upsert: true });
  if (error) throw new Error(`upload ${bucket}/${path}: ${error.message}`);
}

async function seedImages(db: Client, sb: SupabaseClient, colors: ColorRef[]) {
  // shared maps per structure (normal + roughness)
  const structures = [...new Set(colors.map((c) => c.fabric.structure))];
  for (const s of structures) {
    await upload(sb, "textures", `structures/${s}/normal.webp`, await toWebp(normalRaw(s), 256, 256, 85));
    await upload(sb, "textures", `structures/${s}/roughness.webp`, await toWebp(roughnessRaw(s), 256, 256, 85));
  }
  const done = new Set(
    flag("force-images") ? [] : (await db.query(`select color_id from public.fabric_images where kind = 'flat_swatch'`)).rows.map((r) => r.color_id as string),
  );
  const todo = colors.filter((c) => !done.has(c.id));
  let n = 0;
  await pool(todo, 6, async (c) => {
    const seed = hashString(`${c.fabric.slug}:${c.code}`) % 1000;
    const photo = await toWebp(photoRaw(c.fabric.structure, c.hex, 1200, 900, seed), 1200, 900, 78);
    const swatch = await toWebp(swatchRaw(c.fabric.structure, c.hex, 1024, seed), 1024, 1024, 80);
    const photoPath = `fabrics/${c.fabricId}/${c.id}-photo.webp`;
    const swatchPath = `${c.id}/albedo.webp`;
    await upload(sb, "fabric-images", photoPath, photo);
    await upload(sb, "textures", swatchPath, swatch);
    const alt = JSON.stringify({ fr: "Illustration", en: "Illustration", ar: "توضيحية" });
    await db.query(`delete from public.fabric_images where color_id = $1`, [c.id]);
    await db.query(
      `insert into public.fabric_images (fabric_id, color_id, storage_path, alt, kind, sort) values
         ($1, $2, $3, $4, 'photo', 0), ($1, $2, $5, $4, 'flat_swatch', 1)`,
      [c.fabricId, c.id, `fabric-images/${photoPath}`, alt, `textures/${swatchPath}`],
    );
    await db.query(`update public.fabric_colors set texture = $2 where id = $1`, [
      c.id,
      JSON.stringify({
        albedo: `textures/${swatchPath}`,
        normal: `textures/structures/${c.fabric.structure}/normal.webp`,
        roughness: `textures/structures/${c.fabric.structure}/roughness.webp`,
        repeat_cm: 10,
      }),
    ]);
    if (++n % 50 === 0) log(`images: ${n}/${todo.length}`);
  });
  log(`images: ${todo.length} colors processed (${colors.length - todo.length} already present)`);
}

// ------------------------------------------------------------------ users
const CREDS_FILE = join(process.cwd(), ".seed-credentials.local.json");
const USERS = [
  { email: "admin@satex.test", role: "admin", company: "SATEX Commerce", name: "Admin SATEX", locale: "fr" },
  { email: "sales1@satex.test", role: "sales", company: "SATEX Commerce", name: "Commercial 1", locale: "fr" },
  { email: "sales2@satex.test", role: "sales", company: "SATEX Commerce", name: "Commercial 2", locale: "ar" },
  { email: "client1@satex.test", role: "client", company: "Atelier Nour", name: "Nour Haddad", locale: "fr" },
  { email: "client2@satex.test", role: "client", company: "Maison Lina", name: "Lina Berrada", locale: "ar" },
  { email: "client3@satex.test", role: "client", company: "SportLab", name: "Sam Carter", locale: "en" },
  { email: "client4@satex.test", role: "client", company: "Kids&Co", name: "Camille Roux", locale: "fr" },
  { email: "client5@satex.test", role: "client", company: "Hôtel Design", name: "Youssef Alami", locale: "en" },
] as const;

async function seedUsers(db: Client, sb: SupabaseClient): Promise<Map<string, { id: string; clientId: string }>> {
  const creds: Record<string, string> = existsSync(CREDS_FILE) ? JSON.parse(readFileSync(CREDS_FILE, "utf8")) : {};
  const out = new Map<string, { id: string; clientId: string }>();
  for (const u of USERS) {
    const password = creds[u.email] ?? randomBytes(12).toString("base64url");
    const meta = { company_name: u.company, full_name: u.name, preferred_locale: u.locale };
    let id: string | undefined;
    const created = await sb.auth.admin.createUser({ email: u.email, password, email_confirm: true, user_metadata: meta });
    if (created.data.user) {
      id = created.data.user.id;
      creds[u.email] = password;
    } else {
      const { rows } = await db.query(`select id from auth.users where email = $1`, [u.email]);
      id = rows[0]?.id;
      if (!id) throw new Error(`cannot create or find ${u.email}: ${created.error?.message}`);
      if (!creds[u.email]) {
        const upd = await sb.auth.admin.updateUserById(id, { password });  // password unknown: reset and record it
        if (upd.error) throw upd.error;
        creds[u.email] = password;
      }
    }
    await db.query(`update public.profiles set role = $2 where id = $1`, [id, u.role]);
    await db.query(`update public.clients set is_demo = true where id = (select client_id from public.profiles where id = $1)`, [id]);
    const { rows } = await db.query(`select client_id from public.profiles where id = $1`, [id]);
    out.set(u.email, { id: id!, clientId: rows[0].client_id });
  }
  writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2));
  log(`users: ${USERS.length} (passwords in .seed-credentials.local.json, git-ignored)`);
  return out;
}

// ------------------------------------------------------------------ demo operations
const CITIES = [["Paris", "75011"], ["Lyon", "69002"], ["Marseille", "13001"], ["Lille", "59000"], ["Bordeaux", "33000"]] as const;

async function seedDemo(db: Client, users: Map<string, { id: string; clientId: string }>) {
  const existing = await db.query(`select 1 from public.quotes where is_demo limit 1`);
  if (existing.rowCount) { log("demo operations already present, skipped"); return; }

  const clients = [1, 2, 3, 4, 5].map((i) => ({ ...users.get(`client${i}@satex.test`)!, n: i }));
  const r = rng("demo-ops");
  const addr = (i: number) => ({ line1: `${10 + i * 7} rue des Tissus`, city: CITIES[i - 1]![0], postal_code: CITIES[i - 1]![1], country: "FR" });

  for (const c of clients) {
    for (const kind of ["billing", "shipping"]) {
      await db.query(
        `insert into public.addresses (client_id, kind, line1, city, postal_code, country, is_default) values ($1,$2,$3,$4,$5,$6,true)`,
        [c.clientId, kind, addr(c.n).line1, addr(c.n).city, addr(c.n).postal_code, addr(c.n).country],
      );
    }
  }

  // colors that have one lot with plenty of meters (usable for orders / cutting)
  const stocked = (
    await db.query(
      `select c.id as color_id, f.moq_m, f.base_price_per_m, max(l.meters) as best
         from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id join public.stock_lots l on l.color_id = c.id
        where f.is_demo group by c.id, f.moq_m, f.base_price_per_m having max(l.meters) >= 150 order by c.id`,
    )
  ).rows as { color_id: string; moq_m: string; base_price_per_m: string; best: string }[];
  if (stocked.length < 20) fail("not enough stocked colors to build demo operations");
  const pick = () => stocked[int(r, 0, stocked.length - 1)]!;

  const mkQuote = async (clientId: string, status: string, lines: number, extra: Record<string, unknown> = {}) => {
    const { rows } = await db.query(
      `insert into public.quotes (client_id, status, is_demo, valid_until, submitted_at, sent_at, decided_at, rejection_reason, discount_pct, client_message, source)
       values ($1,$2,true,$3,$4,$5,$6,$7,$8,$9,'cart') returning id`,
      [
        clientId, status, extra.validUntil ?? null, extra.submittedAt ?? null, extra.sentAt ?? null, extra.decidedAt ?? null,
        extra.reason ?? null, extra.discount ?? 0, extra.message ?? null,
      ],
    );
    const id: string = rows[0].id;
    for (let i = 0; i < lines; i++) {
      const p = pick();
      const meters = Math.max(Number(p.moq_m), Math.round(int(r, 10, 80) / 5) * 5);
      await db.query(`insert into public.quote_lines (quote_id, color_id, meters, unit_price, sort) values ($1,$2,$3,$4,$5)`,
        [id, p.color_id, meters, p.base_price_per_m, i]);
    }
    return id;
  };
  const day = 86_400_000;
  const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);
  const ago = (d: number) => new Date(Date.now() - d * day).toISOString();

  await mkQuote(clients[0]!.clientId, "draft", 2);
  await mkQuote(clients[0]!.clientId, "sent", 3, { validUntil: iso(12), sentAt: ago(3), submittedAt: ago(5), discount: 5 });
  await mkQuote(clients[1]!.clientId, "submitted", 2, { submittedAt: ago(1), message: "Besoin urgent pour la collection été." });
  await mkQuote(clients[2]!.clientId, "in_review", 4, { submittedAt: ago(2) });
  await mkQuote(clients[3]!.clientId, "rejected", 2, { validUntil: iso(5), sentAt: ago(9), submittedAt: ago(11), decidedAt: ago(6), reason: "Prix trop élevé" });
  await mkQuote(clients[4]!.clientId, "sent", 2, { validUntil: iso(-3), sentAt: ago(20), submittedAt: ago(22) });
  await mkQuote(clients[1]!.clientId, "accepted", 2, { validUntil: iso(8), sentAt: ago(6), submittedAt: ago(8), decidedAt: ago(1) });
  await db.query(`select public.expire_quotes()`);

  // six orders in every state
  const flows = ["confirmed", "in_preparation", "ready", "shipped", "delivered", "cancelled"] as const;
  for (let i = 0; i < flows.length; i++) {
    const flow = flows[i]!;
    const client = clients[i % clients.length]!;
    const qid = await mkQuote(client.clientId, "converted", 1 + (i % 2), { validUntil: iso(10), sentAt: ago(15), submittedAt: ago(17), decidedAt: ago(14) });
    const q = (await db.query(`select * from public.quotes where id = $1`, [qid])).rows[0];
    const o = (
      await db.query(
        `insert into public.orders (client_id, quote_id, status, payment_status, currency, subtotal, discount_pct, vat_rate, total,
            shipping_address, billing_address, is_demo, cancelled_reason)
         values ($1,$2,'confirmed',$3,$4,$5,$6,$7,$8,$9,$9,true,$10) returning id`,
        [
          client.clientId, qid, flow === "delivered" ? "paid" : i % 2 ? "partial" : "unpaid", q.currency, q.subtotal, q.discount_pct,
          q.vat_rate, q.total, JSON.stringify(addr(client.n)), flow === "cancelled" ? "Annulée à la demande du client" : null,
        ],
      )
    ).rows[0];
    const lines = (await db.query(`select * from public.quote_lines where quote_id = $1`, [qid])).rows;
    for (const l of lines) {
      await db.query(`insert into public.order_lines (order_id, color_id, meters, unit_price, line_total) values ($1,$2,$3,$4,$5)`,
        [o.id, l.color_id, l.meters, l.unit_price, l.line_total]);
    }
    if (flow === "cancelled") {
      await db.query(`update public.cutting_jobs set status = 'cancelled' where order_line_id in (select id from public.order_lines where order_id = $1)`, [o.id]);
      await db.query(`update public.orders set status = 'cancelled' where id = $1`, [o.id]);
      continue;
    }
    await db.query(`select public.allocate_order($1)`, [o.id]);
    const jobs = (await db.query(
      `select cj.id, cj.planned_m, ol.color_id from public.cutting_jobs cj join public.order_lines ol on ol.id = cj.order_line_id where ol.order_id = $1`, [o.id])).rows;
    for (const [k, j] of jobs.entries()) {
      if (flow === "confirmed") continue;                    // confirmed: allocated, nothing cut yet
      if (flow === "in_preparation" && k > 0) continue;      // in preparation: only the first line is being cut
      const lot = (await db.query(`select id from public.stock_lots where color_id = $1 and meters >= $2 order by meters desc limit 1`, [j.color_id, j.planned_m])).rows[0];
      if (!lot) continue;
      await db.query(`select public.start_cut($1, $2)`, [j.id, lot.id]);
      if (flow === "ready" || flow === "shipped" || flow === "delivered") {
        await db.query(`select public.record_cut($1, $2)`, [j.id, Number(j.planned_m) - (k % 2 ? 0.5 : 0)]);
      }
    }
    if (flow === "shipped" || flow === "delivered") {
      await db.query(`update public.orders set status = $2 where id = $1`, [o.id, flow]);
      await db.query(
        `insert into public.deliveries (order_id, status, carrier, tracking_number, scheduled_date, delivered_at) values ($1,$2,'DHL',$3,$4,$5)`,
        [o.id, flow === "shipped" ? "in_transit" : "delivered", `JD0146${1000 + i}`, iso(-2), flow === "delivered" ? ago(1) : null],
      );
    }
  }

  // sample requests
  const sampleStatuses = ["requested", "approved", "shipped", "delivered"] as const;
  for (const [i, status] of sampleStatuses.entries()) {
    const c = clients[i]!;
    const s = (
      await db.query(
        `insert into public.sample_requests (client_id, status, shipping_address, carrier, tracking_number, is_demo)
         values ($1,$2,$3,$4,$5,true) returning id`,
        [c.clientId, status, JSON.stringify(addr(c.n)), status === "shipped" || status === "delivered" ? "Colissimo" : null,
         status === "shipped" || status === "delivered" ? `6A0${2000 + i}` : null],
      )
    ).rows[0];
    for (let k = 0; k < 2 + (i % 2); k++) {
      await db.query(`insert into public.sample_request_items (sample_request_id, color_id) values ($1,$2)`, [s.id, pick().color_id]);
    }
  }

  // a few active reservations
  for (const [i, hours] of [20, 40, 46].entries()) {
    const p = pick();
    await db.query(
      `insert into public.stock_reservations (color_id, client_id, meters, expires_at) values ($1,$2,$3, now() + make_interval(hours => $4))`,
      [p.color_id, clients[[0, 2, 3][i]!]!.clientId, Math.max(Number(p.moq_m), 10), hours],
    );
  }
  log("demo operations: quotes in every status, 6 orders (cutting + deliveries), 4 sample requests, 3 reservations");
}

// ------------------------------------------------------------------ main
async function main() {
  if (!isLocal && !SEED_ENV) {
    fail(`target ${SUPABASE_URL} is not localhost: set SEED_ENV=staging or SEED_ENV=production explicitly.`);
  }
  const referenceOnly = flag("reference-only") || SEED_ENV === "production";
  log(`env=${SEED_ENV || "local"}${referenceOnly ? " (reference data only)" : ""}`);

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const { categoryIds } = await seedReference(db);
    if (referenceOnly) return;

    const colors = await seedFabrics(db, categoryIds);
    await seedStock(db, colors);

    const needsApi = !flag("skip-images") || !flag("skip-users");
    const sb = needsApi
      ? createClient(SUPABASE_URL, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
      : undefined;

    if (!flag("skip-images") && sb) await seedImages(db, sb, colors);
    if (!flag("skip-users") && sb) {
      const users = await seedUsers(db, sb);
      if (!flag("skip-demo")) await seedDemo(db, users);
    }
    log("done");
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
