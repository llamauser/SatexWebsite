import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { seededPassword, signInOk, withDb } from "./helpers";

test.use({ locale: "fr-FR" });
test.describe.configure({ mode: "serial" });

const headers = { authorization: "Bearer e2e-cron-secret" };
const runJobs = async (request: APIRequestContext) => {
  const res = await request.get("/api/jobs/run", { headers });
  expect(res.status()).toBe(200);
  return (await res.json()) as { processed: number; succeeded: number; retried: number; archived: number; skipped: number };
};

test("the job endpoint refuses callers without the cron secret", async ({ request }) => {
  expect((await request.get("/api/jobs/run")).status()).toBe(401);
  expect((await request.get("/api/jobs/run", { headers: { authorization: "Bearer nope" } })).status()).toBe(401);
  expect((await request.get("/api/jobs/run", { headers: { authorization: "Bearer e2e-cron-secre" } })).status()).toBe(401);
});

test("the seeded fabrics get a text embedding of the right size, once", async ({ request }) => {
  await runJobs(request);
  await runJobs(request); // translation jobs may enqueue follow-up embeddings
  const rows = await withDb(async (c) =>
    (await c.query(
      `select count(*)::int as n, count(distinct model)::int as models, min(vector_dims(embedding))::int as dims, max(vector_dims(embedding))::int as dims_max
         from public.embeddings e join public.fabrics f on f.id = e.owner_id where e.owner_type = 'fabric' and e.kind = 'text' and f.is_demo`)).rows[0],
  );
  expect(rows.n).toBe(80);
  expect(rows).toMatchObject({ models: 1, dims: 1024, dims_max: 1024 });

  // nothing left to do: unchanged fabrics are skipped, not re-embedded
  const again = await runJobs(request);
  expect(again.retried + again.archived).toBe(0);
});

test("saving a fabric with French text only produces the English and Arabic text and an embedding", async ({ request }) => {
  const slug = `e2e-job-${randomUUID().slice(0, 8)}`;
  const id = await withDb(async (c) => {
    const cat = await c.query(`select id from public.categories where slug = 'knits'`);
    const f = await c.query(
      `insert into public.fabrics (slug, sku, name, short_description, category_id, construction, structure, composition, gsm, width_cm, base_price_per_m)
       values ($1, $2, $3, $4, $5, 'knit', 'jersey', '[{"fiber":"cotton","pct":100}]', 170, 150, 9) returning id`,
      [slug, `E2E-${slug}`, JSON.stringify({ fr: "Jersey de test", en: "Hand written English name" }), JSON.stringify({ fr: "Un jersey de test." }), cat.rows[0].id],
    );
    return f.rows[0].id as string;
  });

  await runJobs(request);
  await runJobs(request);

  const row = await withDb(async (c) =>
    (await c.query(
      `select name, short_description, machine_translated, (select content_hash from public.embeddings where owner_id = f.id and kind = 'text') as hash
         from public.fabrics f where id = $1`, [id])).rows[0],
  );
  // a human-written translation is never overwritten; only the gaps are filled
  expect(row.name).toEqual({ fr: "Jersey de test", en: "Hand written English name", ar: "[ar] Jersey de test" });
  expect(row.short_description).toEqual({ fr: "Un jersey de test.", en: "[en] Un jersey de test.", ar: "[ar] Un jersey de test." });
  expect(row.machine_translated).toEqual({ name: ["ar"], short_description: ["en", "ar"] });
  expect(row.hash).toMatch(/^[0-9a-f]{64}$/);

  // the embedding was rebuilt after the translation changed the text, and is stable now
  const hash1 = row.hash;
  await runJobs(request);
  const hash2 = await withDb(async (c) => (await c.query(`select content_hash from public.embeddings where owner_id = $1`, [id])).rows[0].content_hash);
  expect(hash2).toBe(hash1);
});

test("a contact message emails the staff address, in French, exactly once", async ({ request }) => {
  const marker = `job-${randomUUID().slice(0, 8)}`;
  const contactId = await withDb(async (c) =>
    (await c.query(`select public.submit_contact_message('Camille Jobs', 'Atelier Jobs', 'camille.jobs@example.com', null, $1, 'fr', $2) as id`,
      [`Bonjour, message de test ${marker} pour les jobs.`, `ip-${marker}`])).rows[0].id as string,
  );
  await runJobs(request);

  const rows = await withDb(async (c) => (await c.query(`select * from public.email_log where template = 'contact_message_staff' and payload->>'entityId' = $1`, [contactId])).rows);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ to_email: "Satexcommerce@ymail.com", locale: "fr", status: "logged", subject: "Nouveau message de contact — Camille Jobs" });
  expect(rows[0].payload.html).toContain(marker);
  expect(rows[0].payload.html).toContain(`href="http://localhost:3100/fr/admin/messages"`);

  // the same event delivered again (a retry, a duplicate message) never sends a second email
  await withDb((c) => c.query(`select pgmq.send('q_email', jsonb_build_object('type','q_email','template','contact_message_staff','id',$1::text,'attempt',1))`, [contactId]));
  await runJobs(request);
  const again = await withDb(async (c) => (await c.query(`select count(*)::int as n from public.email_log where template = 'contact_message_staff' and payload->>'entityId' = $1`, [contactId])).rows[0].n);
  expect(again).toBe(1);
});

test("a client is emailed in their own language and gets an in-app notification", async ({ request }) => {
  // client2 (Lina Berrada) prefers Arabic
  const { reservationId, userId } = await withDb(async (c) => {
    const who = (await c.query(`select u.id as user_id, p.client_id from auth.users u join public.profiles p on p.id = u.id where u.email = 'client2@satex.test'`)).rows[0];
    const color = (await c.query(`select c.id from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id where f.slug = 'cotton-elastane-pique' order by c.sort limit 1`)).rows[0];
    const res = await c.query(`insert into public.stock_reservations (color_id, client_id, meters, expires_at) values ($1, $2, 12, now() - interval '1 minute') returning id`, [color.id, who.client_id]);
    await c.query(`select public.expire_reservations()`);
    return { reservationId: res.rows[0].id as string, userId: who.user_id as string };
  });
  await runJobs(request);

  const { mail, notifications } = await withDb(async (c) => ({
    mail: (await c.query(`select * from public.email_log where template = 'reservation_expired' and payload->>'entityId' = $1`, [reservationId])).rows,
    notifications: (await c.query(`select type, payload, read_at from public.notifications where user_id = $1 and payload->>'entityId' = $2`, [userId, reservationId])).rows,
  }));
  expect(mail).toHaveLength(1);
  expect(mail[0]).toMatchObject({ to_email: "client2@satex.test", locale: "ar", status: "logged" });
  expect(mail[0].subject).toMatch(/[؀-ۿ]/);
  expect(mail[0].payload.html).toContain('dir="rtl"');
  expect(mail[0].payload.html).toContain("مرحبًا Lina Berrada");
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toMatchObject({ type: "reservation_expired", read_at: null });
});

test("a job that keeps failing is retried and finally archived (with the error kept)", async ({ request }) => {
  const poison = `poison-${randomUUID().slice(0, 8)}`;
  await withDb((c) => c.query(`select pgmq.send('q_email', jsonb_build_object('type','q_email','template',$1::text,'id','x','attempt',1))`, [poison]));
  const summary = await runJobs(request);
  expect(summary.retried).toBeGreaterThanOrEqual(2); // attempt 1 -> 2 -> 3
  expect(summary.archived).toBeGreaterThanOrEqual(1);

  const { archived, live } = await withDb(async (c) => ({
    archived: (await c.query(`select message from pgmq.a_q_email where message->>'template' = $1`, [poison])).rows,
    live: (await c.query(`select count(*)::int as n from pgmq.q_q_email where message->>'template' = $1`, [poison])).rows[0].n,
  }));
  expect(live).toBe(0);
  expect(archived).toHaveLength(1);
  expect(archived[0].message).toMatchObject({ attempt: 3 });
  expect(archived[0].message.lastError).toContain(`unknown email template "${poison}"`);
});

test("the notification bell shows unread notifications and marks them read", async ({ page }) => {
  await signInOk(page, "client2@satex.test", seededPassword("client2@satex.test"));
  const bell = page.getByTestId("bell-button");
  await expect(bell).toBeVisible();
  await expect(page.getByTestId("bell-count")).toBeVisible();

  await bell.click();
  const panel = page.getByTestId("bell-panel");
  await expect(panel.getByTestId("bell-item").first()).toContainText("Réservation expirée");
  expect(await panel.getByTestId("bell-item").and(page.locator('[data-read="false"]')).count()).toBeGreaterThan(0);

  await page.getByTestId("bell-mark-all").click();
  await expect(page.getByTestId("bell-count")).toHaveCount(0);
  // the page updates at once and saves in the background: wait for the database
  await expect.poll(async () => withDb(async (c) =>
    (await c.query(`select count(*)::int as n from public.notifications n join auth.users u on u.id = n.user_id where u.email = 'client2@satex.test' and n.read_at is null`)).rows[0].n)).toBe(0);
});

test("guests do not see the bell", async ({ page }) => {
  await page.goto("/fr");
  await expect(page.getByTestId("bell-button")).toHaveCount(0);
});
