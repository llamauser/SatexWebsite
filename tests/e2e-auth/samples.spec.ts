import { expect, test, type Page } from "@playwright/test";
import { seededPassword, signInOk, withDb } from "./helpers";

test.use({ locale: "fr-FR" });
test.describe.configure({ mode: "serial" });

const EMAIL = "client4@satex.test";
const jobs = { authorization: "Bearer e2e-cron-secret" };

const clientId = () => withDb(async (c) => (await c.query(`select p.client_id from public.profiles p join auth.users u on u.id = p.id where u.email = $1`, [EMAIL])).rows[0].client_id as string);
const cleanup = async () => {
  const id = await clientId();
  await withDb((c) => c.query(`delete from public.sample_requests where client_id = $1`, [id]));
};
test.beforeAll(cleanup);
test.afterAll(cleanup);

const requests = async () =>
  withDb(async (c) =>
    (await c.query(
      `select s.id, s.ref, s.status, s.shipping_address, s.carrier, s.tracking_number, (select count(*)::int from public.sample_request_items i where i.sample_request_id = s.id) as n
         from public.sample_requests s where s.client_id = $1 order by s.created_at`, [await clientId()])).rows as {
      id: string; ref: string; status: string; shipping_address: Record<string, string>; carrier: string | null; tracking_number: string | null; n: number;
    }[]);

const staffSets = (id: string, status: string, extra = "") => withDb((c) => c.query(`update public.sample_requests set status = '${status}' ${extra} where id = $1`, [id]));
const runJobs = async (request: import("@playwright/test").APIRequestContext) => expect((await request.get("/api/jobs/run", { headers: jobs })).status()).toBe(200);

async function addFromFabric(page: Page, slug: string) {
  await page.goto(`/fr/catalog/${slug}`);
  await page.getByTestId("request-sample").click();
}

test("a visitor is sent to sign in and comes back to the form with the color kept", async ({ page }) => {
  await page.goto("/fr/catalog/linen-plain-160");
  await page.getByTestId("request-sample").click();
  await expect(page).toHaveURL(/\/fr\/auth\/sign-in\?next=%2Ffr%2Faccount%2Fsamples%2Fnew/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("satex.samples.v1") ?? "[]").length)).toBe(1);

  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(seededPassword(EMAIL));
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/fr\/account\/samples\/new$/);
  await expect(page.getByTestId("sample-color")).toHaveCount(1);
  await expect(page.getByTestId("sample-count")).toHaveText("1 sur 5 coloris");
});

test("the request: colors from several fabrics, an address prefilled from the account, required fields", async ({ page, request }) => {
  await signInOk(page, EMAIL, seededPassword(EMAIL));
  await addFromFabric(page, "linen-plain-160");
  await expect(page).toHaveURL(/\/fr\/account\/samples\/new$/);
  await addFromFabric(page, "cotton-elastane-pique");
  await addFromFabric(page, "breathable-poly-mesh");
  await expect(page.getByTestId("sample-color")).toHaveCount(3);
  await expect(page.getByTestId("sample-count")).toHaveText("3 sur 5 coloris");

  // the same color twice is one color; removing works
  await addFromFabric(page, "breathable-poly-mesh");
  await expect(page.getByTestId("sample-color")).toHaveCount(3);
  await page.getByTestId("sample-remove").first().click();
  await expect(page.getByTestId("sample-color")).toHaveCount(2);

  // the address comes from the account (seeded shipping address)
  await expect(page.getByTestId("sample-line1")).not.toHaveValue("");
  await expect(page.getByTestId("sample-city")).not.toHaveValue("");

  // a missing required field blocks the request
  await page.getByTestId("sample-line1").fill("");
  await page.getByTestId("sample-submit").click();
  await expect(page.getByText("Ce champ est obligatoire.")).toBeVisible();
  expect(await requests()).toHaveLength(0);

  await page.getByTestId("sample-line1").fill("12 avenue des Soieries");
  await page.getByTestId("sample-line2").fill("Bâtiment B");
  await page.getByTestId("sample-submit").click();
  await expect(page.getByTestId("sample-submitted")).toBeVisible();

  const [row] = await requests();
  expect(row).toMatchObject({ status: "requested", n: 2 });
  expect(row!.ref).toMatch(/^S-\d{4}-\d{6}$/);
  expect(row!.shipping_address).toMatchObject({ line1: "12 avenue des Soieries", line2: "Bâtiment B" });
  await expect(page.getByTestId("sample-submitted")).toContainText(row!.ref);
  expect(await page.evaluate(() => localStorage.getItem("satex.samples.v1"))).toBeNull(); // the selection is emptied

  // the staff is told; the client is told at each later step
  await runJobs(request);
  const staffMail = await withDb(async (c) => (await c.query(`select to_email, status from public.email_log where template = 'sample_requested_staff' and payload->>'entityId' = $1`, [row!.id])).rows);
  expect(staffMail).toEqual([{ to_email: "Satexcommerce@ymail.com", status: "logged" }]);
});

test("the list shows the progress, the tracking number and the reason of a refusal; each step sends an email", async ({ page, request }) => {
  const [first] = await requests();
  await signInOk(page, EMAIL, seededPassword(EMAIL));
  await page.goto("/fr/account/samples");
  await expect(page.getByTestId("samples-open")).toHaveText("1 demande(s) en cours sur 2");
  const row = page.getByTestId("sample-row").filter({ hasText: first!.ref });
  await expect(row.getByTestId("sample-status")).toHaveText("Demandée");
  await expect(row.getByTestId("sample-progress")).toBeVisible();

  await staffSets(first!.id, "approved");
  await staffSets(first!.id, "preparing");
  await staffSets(first!.id, "shipped", ", carrier = 'Colissimo', tracking_number = '6A02001'");
  await runJobs(request);
  await page.reload();
  await expect(row.getByTestId("sample-status")).toHaveText("Expédiée");
  await expect(row.getByTestId("sample-tracking")).toContainText("Colissimo");
  await expect(row.getByTestId("sample-tracking")).toContainText("6A02001");

  const mails = await withDb(async (c) => (await c.query(`select dedupe_key, status, to_email from public.email_log where template = 'sample_status_changed' and payload->>'entityId' = $1 order by dedupe_key`, [first!.id])).rows);
  expect(mails.map((m) => m.dedupe_key.split(":")[2])).toEqual(["approved", "preparing", "shipped"]);
  expect(mails.every((m) => m.status === "logged" && m.to_email === EMAIL)).toBe(true);
  const notified = await withDb(async (c) => (await c.query(`select count(*)::int as n from public.notifications n join auth.users u on u.id = n.user_id where u.email = $1 and n.type = 'sample_status_changed' and n.payload->>'entityId' = $2`, [EMAIL, first!.id])).rows[0].n);
  expect(notified).toBe(3);

  await page.getByTestId("sample-filter").selectOption("delivered");
  await expect(page.getByTestId("samples-empty")).toBeVisible();
  await page.getByTestId("sample-filter").selectOption("all");
  await expect(page.getByTestId("sample-row")).toHaveCount(1);
});

test("at most 2 requests in progress: the form says so; a delivered or declined one frees a place", async ({ page }) => {
  const [first] = await requests();
  // a second open request, made behind the scenes
  const second = await withDb(async (c) => {
    const color = (await c.query(`select c.id from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id where f.slug = 'silk-satin-90' order by c.sort limit 1`)).rows[0];
    const r = (await c.query(`insert into public.sample_requests (client_id, shipping_address) values ($1, '{"line1":"1 rue A","city":"Paris","country":"FR"}') returning id, ref`, [await clientId()])).rows[0];
    await c.query(`insert into public.sample_request_items (sample_request_id, color_id) values ($1, $2)`, [r.id, color.id]);
    return r as { id: string; ref: string };
  });

  await signInOk(page, EMAIL, seededPassword(EMAIL));
  await addFromFabric(page, "wool-gabardine-260");
  await expect(page.getByTestId("sample-open-limit")).toContainText("2 demandes");
  await expect(page.getByTestId("sample-submit")).toBeDisabled();

  // the database refuses it too, even if the page is bypassed
  const refused = await withDb(async (c) => {
    try {
      await c.query("begin");
      const user = (await c.query(`select id from auth.users where email = $1`, [EMAIL])).rows[0].id;
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: "authenticated", user_role: "client" })]);
      await c.query("set local role authenticated");
      const color = (await c.query(`select c.id from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id where f.slug = 'wool-gabardine-260' limit 1`)).rows[0].id;
      await c.query(`select public.request_samples($1::uuid[], '{"line1":"a","city":"b","country":"c"}')`, [[color]]);
      return "created";
    } catch (e) {
      return (e as Error).message;
    } finally {
      await c.query("rollback");
    }
  });
  expect(refused).toMatch(/open sample request limit/);

  // the first one is delivered: a place is free again
  await staffSets(first!.id, "delivered");
  await page.reload();
  await expect(page.getByTestId("sample-open-limit")).toHaveCount(0);
  await expect(page.getByTestId("sample-submit")).toBeEnabled();

  // the second one is declined with a reason: the client sees it
  await staffSets(second.id, "rejected", ", rejection_reason = 'Échantillon épuisé'");
  await page.goto("/fr/account/samples");
  const row = page.getByTestId("sample-row").filter({ hasText: second.ref });
  await expect(row.getByTestId("sample-status")).toHaveText("Refusée");
  await expect(row.getByTestId("sample-reason")).toContainText("Échantillon épuisé");
  await expect(page.getByTestId("samples-open")).toHaveText("0 demande(s) en cours sur 2");
});

test("the samples page works in Arabic (right-to-left, Latin digits)", async ({ page }) => {
  await signInOk(page, EMAIL, seededPassword(EMAIL), "ar");
  await page.goto("/ar/account/samples");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "عيناتي" })).toBeVisible();
  await expect(page.getByTestId("samples-open")).not.toContainText(/[٠-٩]/);
  await expect(page.getByTestId("sample-row").first().getByTestId("sample-status")).toBeVisible();
});
