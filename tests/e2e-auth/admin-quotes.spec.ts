import { expect, test, type APIRequestContext } from "@playwright/test";
import { seededPassword, signInOk, withDb } from "./helpers";

test.use({ locale: "fr-FR" });
test.describe.configure({ mode: "serial" });

const CLIENT = "client1@satex.test";
const ADMIN = "admin@satex.test";
const SALES = "sales1@satex.test";
const jobs = { authorization: "Bearer e2e-cron-secret" };

const clientId = () => withDb(async (c) => (await c.query(`select p.client_id from public.profiles p join auth.users u on u.id = p.id where u.email = $1`, [CLIENT])).rows[0].client_id as string);
async function cleanup() {
  const id = await clientId();
  await withDb(async (c) => {
    await c.query(`delete from public.deliveries where order_id in (select id from public.orders where client_id = $1)`, [id]);
    await c.query(`delete from public.orders where client_id = $1`, [id]);
    await c.query(`delete from public.quotes where client_id = $1`, [id]);
  });
}
test.beforeAll(cleanup);
test.afterAll(cleanup);

const runJobs = async (request: APIRequestContext) => expect((await request.get("/api/jobs/run", { headers: jobs })).status()).toBe(200);

/** A submitted quote for the test client with one line per slug. */
async function submittedQuote(slugs: string[], message: string | null) {
  return withDb(async (c) => {
    const q = (await c.query(`insert into public.quotes (client_id, status, submitted_at, client_message) values ($1, 'submitted', now(), $2) returning id, ref`, [await clientId(), message])).rows[0] as { id: string; ref: string };
    const skus: string[] = [];
    for (const [i, slug] of slugs.entries()) {
      const color = (await c.query(`select c.id, f.sku from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id where f.slug = $1 order by c.sort limit 1`, [slug])).rows[0];
      await c.query(`insert into public.quote_lines (quote_id, color_id, meters, unit_price, sort) values ($1, $2, $3, 10, $4)`, [q.id, color.id, 10 + i * 10, i]);
      skus.push(color.sku);
    }
    return { ...q, skus };
  });
}
const row = (id: string) => withDb(async (c) => (await c.query(`select status, revision, pdf_path, discount_pct::float as discount, valid_until::text as valid_until, internal_notes, subtotal::float as subtotal, total::float as total from public.quotes where id = $1`, [id])).rows[0]);

test("sales and admins see the queue and the editor; the quote moves to 'in review' when opened", async ({ page }) => {
  const q = await submittedQuote(["linen-plain-160", "cotton-elastane-pique"], "Livraison avant fin décembre.");
  await signInOk(page, SALES, seededPassword(SALES));
  await page.goto("/fr/admin/quotes");
  await expect(page.getByTestId("quotes-todo")).toContainText("demande(s) à traiter");
  const listed = page.getByTestId("quote-row").filter({ hasText: q.ref });
  await expect(listed).toBeVisible();
  await expect(listed.getByTestId("status-pill")).toHaveAttribute("data-status", "submitted");
  await page.getByTestId("quote-search").fill(q.ref);
  await expect(page.getByTestId("quote-row")).toHaveCount(1);

  await listed.getByTestId("quote-open").click();
  await expect(page.getByTestId("quote-editor")).toHaveAttribute("data-status", "in_review");
  await expect(page.getByTestId("quote-client-message")).toContainText("Livraison avant fin décembre.");
  await expect(page.getByTestId("quote-line")).toHaveCount(2);
  expect((await row(q.id)).status).toBe("in_review");
  await expect(page.getByTestId("send-quote")).toBeVisible();
  await cleanup();
});

test("review: change quantities and prices, add and remove a line, set a discount and a validity date; totals stay exact", async ({ page }) => {
  const q = await submittedQuote(["linen-plain-160", "cotton-elastane-pique"], null);
  await signInOk(page, ADMIN, seededPassword(ADMIN));
  await page.goto(`/fr/admin/quotes/${q.id}`);
  await expect(page.getByTestId("quote-editor")).toHaveAttribute("data-status", "in_review");

  const first = page.locator(`[data-testid="quote-line"][data-sku="${q.skus[0]}"]`);
  await first.getByTestId("line-meters").fill("20");
  await first.getByTestId("line-price").fill("12,5");
  await expect(first.getByTestId("line-overridden")).toBeVisible(); // a price different from the price list is flagged
  await expect(first.getByTestId("line-total")).toContainText("250,00");

  // remove the second line, add a third color
  await page.locator(`[data-testid="quote-line"][data-sku="${q.skus[1]}"]`).getByTestId("line-remove").click();
  await expect(page.getByTestId("quote-line")).toHaveCount(1);
  const mesh = await withDb(async (c) => (await c.query(`select c.id, f.sku from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id where f.slug = 'breathable-poly-mesh' order by c.sort limit 1`)).rows[0]);
  await page.getByTestId("add-color").selectOption(mesh.id);
  await page.getByTestId("add-meters").fill("30");
  await page.getByTestId("add-line-button").click();
  await expect(page.getByTestId("quote-line")).toHaveCount(2);
  const added = page.locator(`[data-testid="quote-line"][data-sku="${mesh.sku}"]`);
  await added.getByTestId("line-price").fill("7");
  await expect(added.getByTestId("line-total")).toContainText("210,00");

  await page.getByTestId("quote-discount").fill("10");
  await page.getByTestId("quote-notes").fill("Client fidèle : remise accordée.");
  const until = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  await page.getByTestId("quote-valid-until").fill(until);
  // 250 + 210 = 460 ; 460 x 0.9 x 1.2 = 496.80
  await expect(page.getByTestId("total-subtotal")).toContainText("460,00");
  await expect(page.getByTestId("total-total")).toContainText("496,80");

  await page.getByTestId("save-quote").click();
  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();
  expect(await row(q.id)).toMatchObject({ status: "in_review", discount: 10, valid_until: until, internal_notes: "Client fidèle : remise accordée.", subtotal: 460, total: 496.8 });
  const lines = await withDb(async (c) => (await c.query(`select f.sku, l.meters::float as m, l.unit_price::float as p, l.price_overridden as o from public.quote_lines l join public.fabric_colors fc on fc.id = l.color_id join public.fabrics f on f.id = fc.fabric_id where l.quote_id = $1 order by l.sort`, [q.id])).rows);
  expect(lines).toEqual([{ sku: q.skus[0], m: 20, p: 12.5, o: true }, { sku: mesh.sku, m: 30, p: 7, o: true }]);

  // invalid input is refused before anything is written
  await page.locator(`[data-testid="quote-line"][data-sku="${mesh.sku}"]`).getByTestId("line-meters").fill("0");
  await page.getByTestId("save-quote").click();
  await expect(page.getByText("Chaque ligne doit avoir des mètres positifs")).toBeVisible();
  await page.getByTestId("quote-discount").fill("150");
  await expect(page.getByText("La remise doit être comprise entre 0 et 100 %.")).toBeVisible();
  await cleanup();
});

test("send: PDF stored, status 'sent', e-mail and notification; the client downloads the PDF and accepts; sales convert to an order", async ({ page, browser, request }) => {
  const q = await submittedQuote(["linen-plain-160", "cotton-elastane-pique"], null);
  await signInOk(page, ADMIN, seededPassword(ADMIN));
  await page.goto(`/fr/admin/quotes/${q.id}`);
  await expect(page.getByTestId("quote-editor")).toHaveAttribute("data-status", "in_review");
  await page.getByTestId("send-quote").click();
  await expect(page.getByText("Devis envoyé au client avec son PDF.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("quote-editor")).toHaveAttribute("data-status", "sent");
  const sent = await row(q.id);
  expect(sent).toMatchObject({ status: "sent", pdf_path: `quotes/${q.id}/r1.pdf` });
  expect(sent.valid_until).toBeTruthy();
  const stored = await withDb(async (c) => (await c.query(`select metadata->>'mimetype' as mime, (metadata->>'size')::int as size from storage.objects where bucket_id = 'quote-pdfs' and name = $1`, [sent.pdf_path])).rows[0]);
  expect(stored.mime).toBe("application/pdf");
  expect(stored.size).toBeGreaterThan(5_000);

  // no more editing, but the PDF can be opened
  await expect(page.getByTestId("send-quote")).toHaveCount(0);
  await expect(page.getByTestId("line-meters")).toHaveCount(0);
  // the button opens a signed link in a new tab (a headless browser downloads a PDF instead of showing it): read the request itself
  const opened = page.context().waitForEvent("request", (r) => r.url().includes("/object/sign/quote-pdfs/") && r.url().includes("token="));
  await page.getByTestId("download-pdf").click();
  const pdf = await request.get((await opened).url());
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // the client is told (e-mail + bell), reads the PDF, accepts
  await runJobs(request);
  const mail = await withDb(async (c) => (await c.query(`select to_email, status from public.email_log where template = 'quote_sent' and payload->>'entityId' = $1`, [q.id])).rows);
  expect(mail).toEqual([{ to_email: CLIENT, status: "logged" }]);
  expect(await withDb(async (c) => (await c.query(`select count(*)::int as n from public.notifications n join auth.users u on u.id = n.user_id where u.email = $1 and n.type = 'quote_sent' and n.payload->>'entityId' = $2`, [CLIENT, q.id])).rows[0].n)).toBe(1);

  const clientContext = await browser.newContext({ locale: "fr-FR" });
  const clientPage = await clientContext.newPage();
  await signInOk(clientPage, CLIENT, seededPassword(CLIENT));
  await clientPage.goto(`/fr/account/quotes/${q.id}`);
  await expect(clientPage.getByTestId("client-download-pdf")).toBeVisible();
  await clientPage.getByTestId("accept-quote").click();
  await expect(clientPage.getByTestId("status-pill")).toHaveAttribute("data-status", "accepted", { timeout: 15_000 });
  await clientContext.close();

  // sales are told by e-mail, then convert
  await runJobs(request);
  expect(await withDb(async (c) => (await c.query(`select count(*)::int as n from public.email_log where template = 'quote_accepted_staff' and payload->>'entityId' = $1`, [q.id])).rows[0].n)).toBe(1);
  await page.reload();
  await expect(page.getByTestId("quote-editor")).toHaveAttribute("data-status", "accepted");
  await page.getByTestId("convert-quote").click();
  await expect(page.getByTestId("order-created")).toContainText(/Commande O-\d{4}-\d{6} créée/);
  await expect(page.getByTestId("quote-editor")).toHaveAttribute("data-status", "converted");

  const order = await withDb(async (c) => {
    const o = (await c.query(`select id, ref, status, total::float as total from public.orders where quote_id = $1`, [q.id])).rows[0];
    const lines = (await c.query(`select count(*)::int as n from public.order_lines where order_id = $1`, [o.id])).rows[0].n;
    const cutting = (await c.query(`select count(*)::int as n from public.cutting_jobs cj join public.order_lines ol on ol.id = cj.order_line_id where ol.order_id = $1 and cj.status = 'queued'`, [o.id])).rows[0].n;
    const allocated = (await c.query(`select count(*)::int as n from public.order_allocations a join public.order_lines ol on ol.id = a.order_line_id where ol.order_id = $1 and not a.released`, [o.id])).rows[0].n;
    return { ...o, lines, cutting, allocated };
  });
  expect(order).toMatchObject({ status: "confirmed", lines: 2, cutting: 2, allocated: 2 });
  expect(order.total).toBe((await row(q.id)).total);
  await runJobs(request);
  expect(await withDb(async (c) => (await c.query(`select count(*)::int as n from public.email_log where template = 'order_confirmed' and payload->>'entityId' = $1`, [order.id])).rows[0].n)).toBe(1);
});

test("a sent quote can be reopened as a new revision; cancelling needs a reason, which the client sees", async ({ page, browser }) => {
  const q = await submittedQuote(["linen-plain-160"], null);
  await signInOk(page, ADMIN, seededPassword(ADMIN));
  await page.goto(`/fr/admin/quotes/${q.id}`);
  await page.getByTestId("send-quote").click();
  await expect(page.getByTestId("quote-editor")).toHaveAttribute("data-status", "sent", { timeout: 30_000 });

  await page.getByTestId("reopen-quote").click();
  await expect(page.getByTestId("quote-editor")).toHaveAttribute("data-status", "in_review");
  await expect(page.getByText("révision 2")).toBeVisible();
  await expect(page.getByTestId("download-pdf")).toHaveCount(0); // the old PDF no longer applies
  expect(await row(q.id)).toMatchObject({ status: "in_review", revision: 2, pdf_path: null });

  await page.getByTestId("send-quote").click();
  await expect(page.getByTestId("quote-editor")).toHaveAttribute("data-status", "sent", { timeout: 30_000 });
  expect((await row(q.id)).pdf_path).toBe(`quotes/${q.id}/r2.pdf`);

  await page.getByTestId("cancel-quote").click();
  await page.getByTestId("cancel-confirm").click();
  await expect(page.getByText("Indiquez un motif.")).toBeVisible();
  await page.getByTestId("cancel-reason").fill("Article retiré de la collection");
  await page.getByTestId("cancel-confirm").click();
  await expect(page.getByTestId("quote-editor")).toHaveAttribute("data-status", "cancelled");
  await expect(page.getByTestId("quote-reason")).toContainText("Article retiré de la collection");
  await expect(page.getByTestId("cancel-quote")).toHaveCount(0);

  const clientContext = await browser.newContext({ locale: "fr-FR" });
  const clientPage = await clientContext.newPage();
  await signInOk(clientPage, CLIENT, seededPassword(CLIENT));
  await clientPage.goto(`/fr/account/quotes/${q.id}`);
  await expect(clientPage.getByTestId("status-pill")).toHaveAttribute("data-status", "cancelled");
  await expect(clientPage.getByTestId("accept-quote")).toHaveCount(0);
  await clientContext.close();
});

test("clients cannot reach the quote back-office, and the quote queue works in Arabic", async ({ page }) => {
  await signInOk(page, CLIENT, seededPassword(CLIENT));
  await page.goto("/fr/admin/quotes");
  await expect(page).toHaveURL(/\/fr\/forbidden$/);
  const res = await page.request.post("/api/admin/quotes/00000000-0000-4000-8000-000000000000/send", { data: {} });
  expect(res.status()).toBe(403);

  const staff = await page.context().browser()!.newContext({ locale: "ar" });
  const staffPage = await staff.newPage();
  await signInOk(staffPage, ADMIN, seededPassword(ADMIN), "ar");
  await staffPage.goto("/ar/admin/quotes");
  await expect(staffPage.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(staffPage.getByRole("heading", { level: 1, name: "عروض الأسعار" })).toBeVisible();
  await staff.close();
});
