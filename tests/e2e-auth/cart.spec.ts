import { expect, test, type Page } from "@playwright/test";
import { seededPassword, signInOk, withDb } from "./helpers";

test.use({ locale: "fr-FR" });
test.describe.configure({ mode: "serial" });

const EMAIL = "client5@satex.test";
const jobs = { authorization: "Bearer e2e-cron-secret" };

// the test starts from an account without a draft: a run that stopped half way (or any other test) must not change what it sees
test.beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(`delete from public.quotes q using public.profiles p, auth.users u where p.client_id = q.client_id and u.id = p.id and u.email = $1 and q.status = 'draft'`, [EMAIL]);
  });
});

const draft = () =>
  withDb(async (c) => {
    const q = (await c.query(
      `select q.id, q.status, q.client_message, q.subtotal, q.total from public.quotes q join public.profiles p on p.client_id = q.client_id join auth.users u on u.id = p.id
        where u.email = $1 and q.status = 'draft'`, [EMAIL])).rows[0];
    const lines = q ? (await c.query(`select l.meters, l.unit_price, f.slug from public.quote_lines l join public.fabric_colors c on c.id = l.color_id join public.fabrics f on f.id = c.fabric_id where l.quote_id = $1 order by l.sort`, [q.id])).rows : [];
    return { quote: q as { id: string; status: string; client_message: string | null; subtotal: string; total: string } | undefined, lines: lines as { meters: string; unit_price: string; slug: string }[] };
  });

async function addOnFabricPage(page: Page, slug: string, meters: string) {
  await page.goto(`/fr/catalog/${slug}`);
  await page.getByTestId("add-meters").fill(meters);
  await page.getByTestId("add-to-quote").click();
  await expect(page.getByTestId("cart-drawer")).toBeVisible();
}

test("a guest builds a cart, signs in, the cart follows, and the request is sent", async ({ page, request }) => {
  // --- as a guest: two fabrics, quantities checked
  await addOnFabricPage(page, "cotton-elastane-pique", "12");
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await expect(page.getByTestId("cart-signin")).toBeVisible(); // guests sign in to send
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cart-count")).toHaveText("1");

  await addOnFabricPage(page, "linen-plain-160", "20");
  await expect(page.getByTestId("cart-line")).toHaveCount(2);
  await expect(page.getByTestId("cart-total")).toContainText("€");

  const first = page.getByTestId("cart-line").first().getByTestId("cart-meters");
  await first.fill("1"); // below the minimum order
  await first.blur();
  await expect(page.getByTestId("cart-drawer").getByRole("alert")).toContainText("Minimum");
  await first.fill("12.3"); // not a multiple of 0.5
  await first.blur();
  await expect(page.getByTestId("cart-drawer").getByRole("alert")).toContainText("0,5");
  await first.fill("12.5");
  await first.blur();
  await expect(page.getByTestId("cart-drawer").getByRole("alert")).toHaveCount(0);
  await expect(first).toHaveValue("12.5");

  // the same fabric added again is added to the same line (12.5 + 5 = 17.5)
  await page.keyboard.press("Escape");
  await addOnFabricPage(page, "cotton-elastane-pique", "5");
  await expect(page.getByTestId("cart-line")).toHaveCount(2);
  await expect(page.getByTestId("cart-line").first().getByTestId("cart-meters")).toHaveValue("17.5");

  // --- sign in from the drawer: the selection is kept and merged into the account
  await page.getByTestId("cart-signin").click();
  await expect(page).toHaveURL(/\/fr\/auth\/sign-in\?next=%2Ffr%2Fcatalog%2Fcotton-elastane-pique/);
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(seededPassword(EMAIL));
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/fr\/catalog\/cotton-elastane-pique$/);
  await expect(page.getByTestId("cart-count")).toHaveText("2", { timeout: 15_000 });

  // the badge first shows the guest cart; the merge into the account finishes a moment later
  await expect.poll(async () => (await draft()).lines.length, { timeout: 15_000 }).toBe(2);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("satex.cart.v1")), { timeout: 15_000 }).toBeNull();
  const merged = await draft();
  expect(merged.quote?.status).toBe("draft");
  expect(merged.lines.map((l) => [l.slug, Number(l.meters)]).sort()).toEqual([["cotton-elastane-pique", 17.5], ["linen-plain-160", 20]]);
  expect(merged.lines.every((l) => Number(l.unit_price) > 0)).toBe(true);

  // --- send
  await page.getByTestId("cart-button").click();
  await expect(page.getByTestId("cart-line")).toHaveCount(2);
  const total = await page.getByTestId("cart-total").innerText();
  const clientMessage = `Besoin de livraison avant fin décembre. (${Date.now().toString(36)})`; // unique, so earlier runs of this test are never mistaken for this one
  await page.getByTestId("cart-message").fill(clientMessage);
  await page.getByTestId("cart-submit").click();
  await expect(page.getByTestId("cart-submitted")).toBeVisible();
  await expect(page.getByTestId("cart-count")).toHaveCount(0); // the cart is empty again

  const sent = await withDb(async (c) =>
    (await c.query(
      `select q.id, q.ref, q.status, q.client_message, q.submitted_at, q.total, (select count(*)::int from public.quote_lines where quote_id = q.id) as n
         from public.quotes q join public.profiles p on p.client_id = q.client_id join auth.users u on u.id = p.id where u.email = $1 and q.status = 'submitted' and q.client_message = $2 order by q.submitted_at desc limit 1`, [EMAIL, clientMessage])).rows[0]);
  expect(sent).toMatchObject({ status: "submitted", client_message: clientMessage, n: 2 });
  expect(sent.ref).toMatch(/^Q-\d{4}-\d{6}$/);
  expect(sent.submitted_at).not.toBeNull();
  expect((await draft()).quote).toBeUndefined(); // no draft left: a new cart starts empty

  // --- the two emails of the "submitted" event are sent by the job runner
  const run = await request.get("/api/jobs/run", { headers: jobs });
  expect(run.status()).toBe(200);
  const mails = await withDb(async (c) => (await c.query(`select template, to_email, locale, status from public.email_log where payload->>'entityId' = $1 order by template`, [sent.id])).rows);
  expect(mails.map((m) => m.template)).toEqual(["quote_submitted_client", "quote_submitted_staff"]);
  expect(mails.find((m) => m.template === "quote_submitted_client")).toMatchObject({ to_email: EMAIL, locale: "en", status: "logged" });
  expect(mails.find((m) => m.template === "quote_submitted_staff")?.to_email).toBe("Satexcommerce@ymail.com");
  const notified = await withDb(async (c) => (await c.query(`select count(*)::int as n from public.notifications n join auth.users u on u.id = n.user_id where u.email = $1 and n.type = 'quote_submitted_client' and n.payload->>'entityId' = $2`, [EMAIL, sent.id])).rows[0].n);
  expect(notified).toBe(1);

  // --- the client follows it in the account
  await page.getByRole("link", { name: "Voir ma demande" }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/account/quotes/${sent.id}$`));
  await expect(page.getByTestId("quote-ref")).toHaveText(sent.ref);
  await expect(page.getByTestId("status-pill")).toHaveAttribute("data-status", "submitted");
  await expect(page.getByTestId("quote-line")).toHaveCount(2);
  await expect(page.getByTestId("quote-total")).toHaveText(total);
  await expect(page.getByTestId("quote-timeline")).toContainText("Demande envoyée");
  await expect(page.getByTestId("decision-closed")).toContainText("étudie");
  await expect(page.getByTestId("accept-quote")).toHaveCount(0);

  await page.goto("/fr/account/quotes");
  await expect(page.getByTestId("quote-row").filter({ hasText: sent.ref })).toBeVisible();
  // the list agrees with the database for each status (the account may already have quotes, e.g. from the demo data)
  const countOf = (status: string) => withDb(async (c) => (await c.query(`select count(*)::int as n from public.quotes q join public.profiles p on p.client_id = q.client_id join auth.users u on u.id = p.id where u.email = $1 and q.status = $2`, [EMAIL, status])).rows[0].n as number);
  for (const status of ["accepted", "submitted"]) {
    const expected = await countOf(status);
    await page.getByTestId("quote-filter").selectOption(status);
    await expect(page.getByTestId("quote-row")).toHaveCount(expected);
    if (expected === 0) await expect(page.getByTestId("quotes-empty")).toBeVisible();
  }
  expect(await countOf("submitted")).toBeGreaterThanOrEqual(1);
});

test("a sent quote can be accepted; another can be declined with a reason; an expired one cannot be answered", async ({ page, request }) => {
  const setup = await withDb(async (c) => {
    const who = (await c.query(`select p.client_id from public.profiles p join auth.users u on u.id = p.id where u.email = $1`, [EMAIL])).rows[0];
    const color = (await c.query(`select c.id from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id where f.slug = 'linen-plain-160' order by c.sort limit 1`)).rows[0];
    const mk = async (status: string, validUntil: string) => {
      const q = (await c.query(`insert into public.quotes (client_id, status, valid_until, submitted_at, sent_at) values ($1, $2, $3, now(), now()) returning id, ref`, [who.client_id, status, validUntil])).rows[0];
      await c.query(`insert into public.quote_lines (quote_id, color_id, meters, unit_price) values ($1, $2, 20, 16.8)`, [q.id, color.id]);
      return q as { id: string; ref: string };
    };
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    return { accept: await mk("sent", future), reject: await mk("sent", future), expired: await mk("sent", past) };
  });
  await signInOk(page, EMAIL, seededPassword(EMAIL));

  // accept
  await page.goto(`/fr/account/quotes/${setup.accept.id}`);
  await expect(page.getByTestId("status-pill")).toHaveAttribute("data-status", "sent");
  await page.getByTestId("accept-quote").click();
  await expect(page.getByTestId("status-pill")).toHaveAttribute("data-status", "accepted", { timeout: 15_000 });
  await expect(page.getByTestId("quote-timeline")).toContainText("Accepté");
  await expect(page.getByTestId("accept-quote")).toHaveCount(0);

  // decline with a reason
  await page.goto(`/fr/account/quotes/${setup.reject.id}`);
  await page.getByTestId("reject-quote").click();
  await page.getByTestId("reject-reason").fill("Prix trop élevé pour ce projet");
  await page.getByTestId("reject-confirm").click();
  await expect(page.getByTestId("status-pill")).toHaveAttribute("data-status", "rejected", { timeout: 15_000 });
  await expect(page.getByText("Motif du refus : Prix trop élevé pour ce projet")).toBeVisible();

  // past its validity date: no buttons
  await page.goto(`/fr/account/quotes/${setup.expired.id}`);
  await expect(page.getByTestId("accept-quote")).toHaveCount(0);
  await expect(page.getByTestId("decision-closed")).toBeVisible();
  const refused = await withDb(async (c) => {
    try {
      await c.query("begin");
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: (await c.query(`select id from auth.users where email = $1`, [EMAIL])).rows[0].id, role: "authenticated", user_role: "client" })]);
      await c.query("set local role authenticated");
      await c.query(`select public.client_decide_quote($1, 'accepted')`, [setup.expired.id]);
      return "accepted";
    } catch (e) {
      return (e as Error).message;
    } finally {
      await c.query("rollback");
    }
  });
  expect(refused).toMatch(/expired/);

  // the staff emails for the two decisions
  expect((await request.get("/api/jobs/run", { headers: jobs })).status()).toBe(200);
  const staffMails = await withDb(async (c) => (await c.query(`select template, payload->>'entityId' as id from public.email_log where template in ('quote_accepted_staff','quote_rejected_staff')`)).rows);
  expect(staffMails).toEqual(expect.arrayContaining([{ template: "quote_accepted_staff", id: setup.accept.id }, { template: "quote_rejected_staff", id: setup.reject.id }]));
});

test("a signed-in client's cart is the draft quote in the database", async ({ page }) => {
  await signInOk(page, EMAIL, seededPassword(EMAIL));
  await addOnFabricPage(page, "breathable-poly-mesh", "10");
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await expect(page.getByTestId("cart-submit")).toBeVisible(); // signed in: send directly, no sign-in prompt
  let state = await draft();
  expect(state.lines.map((l) => Number(l.meters))).toEqual([10]);

  // the same color again adds to the same line, and the price follows the quantity tier (100 m and more is cheaper)
  await page.keyboard.press("Escape");
  await addOnFabricPage(page, "breathable-poly-mesh", "95");
  state = await draft();
  expect(state.lines.map((l) => Number(l.meters))).toEqual([105]);
  const bigPrice = Number(state.lines[0]!.unit_price);

  const meters = page.getByTestId("cart-meters");
  await meters.fill("10");
  await meters.blur();
  await expect.poll(async () => Number((await draft()).lines[0]?.meters)).toBe(10);
  expect(Number((await draft()).lines[0]!.unit_price)).toBeGreaterThan(bigPrice);
  expect(Number((await draft()).quote!.total)).toBeGreaterThan(0);

  await page.getByTestId("cart-remove").click();
  await expect(page.getByTestId("cart-empty")).toBeVisible();
  expect((await draft()).lines).toHaveLength(0);

  // an empty quote cannot be sent
  const refused = await withDb(async (c) => {
    try {
      const id = (await c.query(`select q.id from public.quotes q join public.profiles p on p.client_id = q.client_id join auth.users u on u.id = p.id where u.email = $1 and q.status = 'draft'`, [EMAIL])).rows[0].id;
      await c.query("begin");
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: (await c.query(`select id from auth.users where email = $1`, [EMAIL])).rows[0].id, role: "authenticated", user_role: "client" })]);
      await c.query("set local role authenticated");
      await c.query(`select public.submit_quote($1)`, [id]);
      return "sent";
    } catch (e) {
      return (e as Error).message;
    } finally {
      await c.query("rollback");
    }
  });
  expect(refused).toMatch(/no lines/);
});

test("match results have an 'add to quote' button that fills the cart", async ({ page, request }) => {
  const res = await request.post("/api/match", { headers: { "x-forwarded-for": `192.0.2.${Math.floor(Math.random() * 250)}` }, data: { input: { description: "Popeline de coton 110 GSM pour chemises" }, locale: "fr" } });
  const sessionId = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; sessionId?: string }).find((e) => e.type === "done")?.sessionId;
  await page.context().addCookies((await request.storageState()).cookies); // the results page belongs to the browser that asked
  await page.goto(`/fr/match/${sessionId}`);
  await page.getByTestId("match-result").first().getByTestId("add-to-quote").click();
  await expect(page.getByTestId("cart-drawer")).toBeVisible();
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await expect(page.getByTestId("cart-signin")).toBeVisible(); // a visitor who is not signed in
});

test("the cart, the drawer and the quotes list work in Arabic (right-to-left)", async ({ page }) => {
  await page.goto("/ar/catalog/linen-plain-160");
  await page.getByTestId("add-meters").fill("25");
  await page.getByTestId("add-to-quote").click();
  const drawer = page.getByTestId("cart-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "طلب عرض السعر" })).toBeVisible();
  await expect(drawer).not.toContainText(/[٠-٩]/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
