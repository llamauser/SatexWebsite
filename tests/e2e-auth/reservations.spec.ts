import { expect, test, type Page } from "@playwright/test";
import { seededPassword, signInOk, withDb } from "./helpers";

test.use({ locale: "fr-FR" });
test.describe.configure({ mode: "serial" });

const EMAIL = "client3@satex.test";
const jobs = { authorization: "Bearer e2e-cron-secret" };

const clientId = () => withDb(async (c) => (await c.query(`select p.client_id from public.profiles p join auth.users u on u.id = p.id where u.email = $1`, [EMAIL])).rows[0].client_id as string);

/** Leaves the stock as it was found: other tests read the same fabrics. */
async function release() {
  const id = await clientId();
  await withDb((c) => c.query(`update public.stock_reservations set status = 'cancelled' where client_id = $1 and status = 'active'`, [id]));
}
test.beforeAll(release);
test.afterAll(release);

/** The color of a fabric with the most stock (so the test never depends on which colors the seed left low). */
const richestColor = (slug: string) =>
  withDb(async (c) =>
    (await c.query(
      `select c.id, c.code, a.available_m::float as available from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id
         join public.v_color_availability_all a on a.color_id = c.id where f.slug = $1 and c.is_active order by a.available_m desc limit 1`, [slug])).rows[0] as { id: string; code: string; available: number });

const available = (colorId: string) => withDb(async (c) => Number((await c.query(`select available_m from public.v_color_availability_all where color_id = $1`, [colorId])).rows[0].available_m));

async function openFabric(page: Page, slug: string, code: string) {
  await page.goto(`/fr/catalog/${slug}`);
  await page.locator(`[data-color="${code}"]`).click();
}

async function reserveOnPage(page: Page, slug: string, meters: string) {
  const color = await richestColor(slug);
  await openFabric(page, slug, color.code);
  await page.getByTestId("reserve-meters").fill(meters);
  await page.getByTestId("reserve-button").click();
  await expect(page.getByTestId("reserve-done")).toBeVisible();
  return color;
}

test("a visitor who is not signed in is invited to sign in to reserve", async ({ page }) => {
  await page.goto("/fr/catalog/linen-plain-160");
  await expect(page.getByTestId("reserve-box")).toBeVisible();
  await expect(page.getByTestId("reserve-signin")).toBeVisible();
  await expect(page.getByTestId("reserve-button")).toHaveCount(0);
});

test("a client reserves meters; quantities and the limit are enforced", async ({ page }) => {
  await signInOk(page, EMAIL, seededPassword(EMAIL));

  // linen: minimum 10 m
  const linen = await richestColor("linen-plain-160");
  const before = await available(linen.id);
  await openFabric(page, "linen-plain-160", linen.code);
  await expect(page.getByTestId("reserve-box")).toContainText("Réserver pour 48 h");
  await expect(page.getByTestId("reserve-slots")).toHaveText("0 réservation(s) active(s) sur 3");

  await page.getByTestId("reserve-meters").fill("4");
  await page.getByTestId("reserve-button").click();
  await expect(page.getByTestId("reserve-problem")).toContainText("Minimum");
  await page.getByTestId("reserve-meters").fill("12.3");
  await page.getByTestId("reserve-button").click();
  await expect(page.getByTestId("reserve-problem")).toContainText("0,5");
  await page.getByTestId("reserve-meters").fill(String(Math.floor(before) + 1));
  await page.getByTestId("reserve-button").click();
  await expect(page.getByTestId("reserve-problem")).toContainText("Stock insuffisant");
  expect(await available(linen.id)).toBe(before);

  await page.getByTestId("reserve-meters").fill("12");
  await page.getByTestId("reserve-button").click();
  await expect(page.getByTestId("reserve-done")).toContainText("12 m réservés");
  await expect(page.getByTestId("reserve-slots")).toHaveText("1 réservation(s) active(s) sur 3");

  const row = await withDb(async (c) =>
    (await c.query(`select status, meters::float as meters, extract(epoch from (expires_at - created_at))/3600 as hours from public.stock_reservations where color_id = $1 and client_id = $2 and status = 'active'`, [linen.id, await clientId()])).rows[0]);
  expect(row).toMatchObject({ status: "active", meters: 12 });
  expect(Math.round(row.hours)).toBe(48);
  expect(await available(linen.id)).toBe(before - 12);

  // the live stock figure on the page follows
  await expect(page.getByTestId(`available-${linen.code}`)).toHaveAttribute("data-meters", String(Math.floor(before - 12)), { timeout: 15_000 });

  // two more reservations reach the limit of 3
  await reserveOnPage(page, "cotton-elastane-pique", "5");
  await reserveOnPage(page, "breathable-poly-mesh", "5");
  await expect(page.getByTestId("reserve-limit")).toContainText("limite de 3 réservations");
  await expect(page.getByTestId("reserve-button")).toHaveCount(0);

  // another fabric: still no way to reserve
  const gab = await richestColor("wool-gabardine-260");
  await openFabric(page, "wool-gabardine-260", gab.code);
  await expect(page.getByTestId("reserve-limit")).toBeVisible();
  const count = await withDb(async (c) => (await c.query(`select count(*)::int as n from public.stock_reservations where client_id = $1 and status = 'active'`, [await clientId()])).rows[0].n);
  expect(count).toBe(3);
});

test("the database refuses a fourth reservation even if the page is bypassed", async () => {
  const refused = await withDb(async (c) => {
    try {
      await c.query("begin");
      const user = (await c.query(`select id from auth.users where email = $1`, [EMAIL])).rows[0].id;
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: "authenticated", user_role: "client" })]);
      await c.query("set local role authenticated");
      const color = (await richestColor("wool-gabardine-260")).id;
      await c.query(`select public.reserve_stock($1, 5)`, [color]);
      return "reserved";
    } catch (e) {
      return (e as Error).message;
    } finally {
      await c.query("rollback");
    }
  });
  expect(refused).toMatch(/limit reached/);
});

test("the reservations page shows countdowns; cancelling frees the stock; a reservation goes into the quote", async ({ page, request }) => {
  await signInOk(page, EMAIL, seededPassword(EMAIL));
  await page.goto("/fr/account/reservations");
  await expect(page.getByTestId("reservation-row")).toHaveCount(3);
  await expect(page.getByTestId("reservation-slots")).toHaveText("3 sur 3 réservations actives");
  await expect(page.getByTestId("reservations-full")).toBeVisible();
  for (const countdown of await page.getByTestId("reservation-countdown").all()) await expect(countdown).toHaveText(/^(47:[0-5]\d|48:00)$/);
  await expect(page.getByTestId("reservation-soon")).toHaveCount(0);

  // the three confirmation emails go out, with an in-app notification each
  expect((await request.get("/api/jobs/run", { headers: jobs })).status()).toBe(200);
  const ids = await page.getByTestId("reservation-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
  const mails = await withDb(async (c) => (await c.query(`select template, status, to_email from public.email_log where template = 'reservation_created' and payload->>'entityId' = any($1)`, [ids])).rows);
  expect(mails).toHaveLength(3);
  expect(mails.every((m) => m.status === "logged" && m.to_email === EMAIL)).toBe(true);
  const notified = await withDb(async (c) => (await c.query(`select count(*)::int as n from public.notifications n join auth.users u on u.id = n.user_id where u.email = $1 and n.type = 'reservation_created' and n.payload->>'entityId' = any($2)`, [EMAIL, ids])).rows[0].n);
  expect(notified).toBe(3);

  // the first (most recent) row goes into the quote request
  const first = page.getByTestId("reservation-row").first();
  const firstId = (await first.getAttribute("data-id"))!;
  const meters = await withDb(async (c) => Number((await c.query(`select meters from public.stock_reservations where id = $1`, [firstId])).rows[0].meters));
  await first.getByTestId("reservation-to-quote").click();
  await expect(page.getByTestId("cart-drawer")).toBeVisible();
  // the reserved meters join the line of that color in the quote cart (which may already hold some, in a database seeded with demo data)
  const firstColor = await withDb(async (c) => (await c.query(`select color_id from public.stock_reservations where id = $1`, [firstId])).rows[0].color_id as string);
  const line = page.locator(`[data-testid="cart-line"][data-color="${firstColor}"]`);
  await expect(line).toBeVisible();
  expect(Number(await line.getByTestId("cart-meters").inputValue())).toBeGreaterThanOrEqual(meters);
  await page.keyboard.press("Escape");

  // cancel the oldest: it leaves the active list, enters the history, the stock comes back
  const last = page.getByTestId("reservation-row").last();
  const lastId = (await last.getAttribute("data-id"))!;
  const colorId = await withDb(async (c) => (await c.query(`select color_id from public.stock_reservations where id = $1`, [lastId])).rows[0].color_id as string);
  const held = await available(colorId);
  await last.getByTestId("reservation-cancel").click();
  await expect(page.getByTestId("reservation-row")).toHaveCount(2);
  await expect(page.getByTestId("reservation-slots")).toHaveText("2 sur 3 réservations actives");
  await expect(page.getByTestId("reservations-full")).toHaveCount(0);
  // the history may hold other, older reservations (a database seeded with demo data): look for the cancelled one
  const cancelled = page.locator('[data-testid="reservation-past"][data-status="cancelled"]');
  await expect(cancelled.first()).toBeVisible();
  await expect(cancelled.first().getByTestId("reservation-status")).toHaveText("Annulée");
  expect(await available(colorId)).toBeGreaterThan(held);
});

test("time passes: 'expires soon' is flagged and reminded once; an expired reservation moves to the history", async ({ page, request }) => {
  const rows = await withDb(async (c) => (await c.query(`select id from public.stock_reservations where client_id = $1 and status = 'active' order by created_at`, [await clientId()])).rows.map((r) => r.id as string));
  expect(rows).toHaveLength(2);
  const [soonId, expiredId] = rows as [string, string];
  await withDb(async (c) => {
    await c.query(`update public.stock_reservations set expires_at = now() + interval '5 hours' where id = $1`, [soonId]);
    await c.query(`update public.stock_reservations set expires_at = now() - interval '1 minute' where id = $1`, [expiredId]);
    await c.query(`select public.remind_reservations()`);
    await c.query(`select public.expire_reservations()`);
  });

  await signInOk(page, EMAIL, seededPassword(EMAIL));
  await page.goto("/fr/account/reservations");
  await expect(page.getByTestId("reservation-row")).toHaveCount(1);
  await expect(page.getByTestId("reservation-row")).toHaveAttribute("data-id", soonId);
  await expect(page.getByTestId("reservation-countdown")).toHaveAttribute("data-soon", "true");
  await expect(page.getByTestId("reservation-countdown")).toHaveText(/^0[45]:[0-5]\d$/);
  await expect(page.getByTestId("reservation-soon")).toBeVisible();
  await expect(page.getByTestId("reservation-past").filter({ has: page.getByText("Expirée") })).toHaveCount(1);

  // reminder (once) and expiry emails
  expect((await request.get("/api/jobs/run", { headers: jobs })).status()).toBe(200);
  await request.get("/api/jobs/run", { headers: jobs });
  const sent = await withDb(async (c) => (await c.query(`select template, payload->>'entityId' as id from public.email_log where template in ('reservation_expiring','reservation_expired') and payload->>'entityId' = any($1) order by template`, [[soonId, expiredId]])).rows);
  expect(sent).toEqual([{ template: "reservation_expired", id: expiredId }, { template: "reservation_expiring", id: soonId }]);
});

test("the reservations page works in Arabic (right-to-left, Latin digits)", async ({ page }) => {
  await signInOk(page, EMAIL, seededPassword(EMAIL), "ar");
  await page.goto("/ar/account/reservations");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "حجوزاتي" })).toBeVisible();
  await expect(page.getByTestId("reservation-countdown")).toHaveText(/^[0-9]{2}:[0-9]{2}$/);
  await expect(page.getByTestId("reservation-slots")).not.toContainText(/[٠-٩]/);
});
