import { expect, test, type APIRequestContext } from "@playwright/test";
import { seededPassword, signInOk, withDb } from "./helpers";

test.use({ locale: "fr-FR" });
test.describe.configure({ mode: "serial" });

const CLIENT = "client4@satex.test"; // also used by samples.spec: both clean up after themselves
const ADMIN = "admin@satex.test";
const SALES = "sales1@satex.test";
const jobs = { authorization: "Bearer e2e-cron-secret" };
const MARK = "e2e-ops";

const clientId = () => withDb(async (c) => (await c.query(`select p.client_id from public.profiles p join auth.users u on u.id = p.id where u.email = $1`, [CLIENT])).rows[0].client_id as string);
async function cleanup() {
  const id = await clientId();
  await withDb(async (c) => {
    await c.query(`delete from public.sample_requests where client_id = $1`, [id]);
    await c.query(`delete from public.contact_messages where email like $1`, [`%${MARK}%`]);
    await c.query(`update public.stock_reservations set status = 'cancelled' where client_id = $1 and status = 'active'`, [id]);
    await c.query(`update public.clients set notes_internal = null where id = $1`, [id]);
  });
}
test.beforeAll(cleanup);
test.afterAll(cleanup);
const runJobs = async (request: APIRequestContext) => expect((await request.get("/api/jobs/run", { headers: jobs })).status()).toBe(200);

test("samples: approve, prepare, ship (tracking needed) and deliver; a refusal needs a reason; the client is e-mailed at each step", async ({ page, request }) => {
  const [a, b] = await withDb(async (c) => {
    const color = (await c.query(`select c.id from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id where f.slug = 'linen-plain-160' order by c.sort limit 1`)).rows[0].id;
    const make = async () => {
      const r = (await c.query(`insert into public.sample_requests (client_id, shipping_address) values ($1, '{"line1":"1 rue A","city":"Paris","country":"FR"}') returning id, ref`, [await clientId()])).rows[0] as { id: string; ref: string };
      await c.query(`insert into public.sample_request_items (sample_request_id, color_id) values ($1, $2)`, [r.id, color]);
      return r;
    };
    return [await make(), await make()];
  });
  await signInOk(page, SALES, seededPassword(SALES));
  await page.goto("/fr/admin/samples");
  await page.getByTestId("sample-filter").selectOption("all");
  const card = (ref: string) => page.getByTestId("sample-card").filter({ hasText: ref });
  await expect(card(a!.ref)).toBeVisible();

  await card(a!.ref).getByTestId("sample-to-approved").click();
  await expect(card(a!.ref)).toHaveAttribute("data-status", "approved");
  await card(a!.ref).getByTestId("sample-to-preparing").click();
  await expect(card(a!.ref)).toHaveAttribute("data-status", "preparing");
  await card(a!.ref).getByTestId("sample-to-shipped").click();
  await expect(page.getByText("Indiquez le numéro de suivi pour expédier.")).toBeVisible();
  await card(a!.ref).getByTestId("sample-carrier").fill("Colissimo");
  await card(a!.ref).getByTestId("sample-tracking-input").fill("6A0SAMPLE");
  await card(a!.ref).getByTestId("sample-to-shipped").click();
  await expect(card(a!.ref)).toHaveAttribute("data-status", "shipped");
  await expect(card(a!.ref).getByTestId("sample-tracking")).toContainText("6A0SAMPLE");

  await card(b!.ref).getByTestId("sample-to-rejected").click();
  await expect(page.getByText("Indiquez le motif du refus.")).toBeVisible();
  await card(b!.ref).getByTestId("sample-reason").fill("Échantillon épuisé");
  await card(b!.ref).getByTestId("sample-to-rejected").click();
  await expect(page.getByTestId("sample-filter")).toBeVisible();
  await page.getByTestId("sample-filter").selectOption("rejected");
  await expect(card(b!.ref)).toContainText("Échantillon épuisé");

  await runJobs(request);
  const keys = await withDb(async (c) => (await c.query(`select dedupe_key from public.email_log where template = 'sample_status_changed' and payload->>'entityId' = any($1) order by dedupe_key`, [[a!.id, b!.id]])).rows.map((r) => (r.dedupe_key as string).split(":")[2]));
  expect(keys.sort()).toEqual(["approved", "preparing", "rejected", "shipped"]);
});

test("messages: the contact form messages can be marked as handled", async ({ page }) => {
  await withDb((c) => c.query(`insert into public.contact_messages (name, email, message) values ('Test Ops', $1, 'Bonjour, je voudrais des informations sur vos lins.')`, [`${MARK}@example.com`]));
  await signInOk(page, SALES, seededPassword(SALES));
  await page.goto("/fr/admin/messages");
  const card = page.getByTestId("message-card").filter({ hasText: `${MARK}@example.com` });
  await expect(card).toBeVisible();
  await expect(card.getByTestId("message-text")).toContainText("informations sur vos lins");
  await card.getByTestId("message-handled").click(); // the card leaves the "to handle" list as soon as it is handled
  await expect(card).toHaveCount(0); // gone from "to handle"
  await page.getByTestId("message-filter").selectOption("handled");
  await expect(page.getByTestId("message-card").filter({ hasText: `${MARK}@example.com` })).toHaveAttribute("data-handled", "true");
  expect(await withDb(async (c) => (await c.query(`select handled from public.contact_messages where email = $1`, [`${MARK}@example.com`])).rows[0].handled)).toBe(true);
});

test("clients: search, history and private notes; reservations can be released", async ({ page }) => {
  const color = await withDb(async (c) => {
    const col = (await c.query(`select c.id from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id where f.slug = 'cotton-elastane-pique' order by c.sort limit 1`)).rows[0].id;
    await c.query(`insert into public.stock_reservations (color_id, client_id, meters, expires_at) values ($1, $2, 8, now() + interval '30 hours')`, [col, await clientId()]);
    return col as string;
  });
  const before = await withDb(async (c) => Number((await c.query(`select available_m from public.v_color_availability_all where color_id = $1`, [color])).rows[0].available_m));

  await signInOk(page, ADMIN, seededPassword(ADMIN));
  await page.goto("/fr/admin/clients");
  const company = await withDb(async (c) => (await c.query(`select company_name from public.clients where id = $1`, [await clientId()])).rows[0].company_name as string);
  await page.getByTestId("client-search").fill(company);
  await expect(page.getByTestId("client-row")).toHaveCount(1);
  await page.getByTestId("client-open").click();
  await expect(page.getByTestId("client-name")).toHaveText(company);
  await page.getByTestId("client-notes").fill("Paie à 30 jours. Préfère les livraisons le matin.");
  await page.getByTestId("client-notes-save").click();
  await expect(page.getByTestId("client-notes-saved")).toBeVisible();
  expect(await withDb(async (c) => (await c.query(`select notes_internal from public.clients where id = $1`, [await clientId()])).rows[0].notes_internal)).toContain("Paie à 30 jours");

  await page.goto("/fr/admin/reservations");
  const row = page.getByTestId("reservation-row").filter({ hasText: company });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("reservation-left")).toHaveText(/^(29|30):[0-5]\d$/); // 30 h minus the seconds that passed
  await row.getByTestId("release-reservation").click();
  await expect(page.getByTestId("reservation-row").filter({ hasText: company })).toHaveCount(0);
  expect(await withDb(async (c) => Number((await c.query(`select available_m from public.v_color_availability_all where color_id = $1`, [color])).rows[0].available_m))).toBe(before + 8);
});

test("clients cannot open any of the new back-office pages", async ({ page }) => {
  await signInOk(page, CLIENT, seededPassword(CLIENT));
  for (const path of ["orders", "cutting", "deliveries", "samples", "clients", "messages", "reservations"]) {
    await page.goto(`/fr/admin/${path}`);
    await expect(page).toHaveURL(/\/fr\/forbidden$/);
  }
});
