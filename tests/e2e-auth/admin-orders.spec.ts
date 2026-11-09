import { expect, test, type APIRequestContext } from "@playwright/test";
import { purgeFabrics, seededPassword, signInOk, withDb } from "./helpers";

test.use({ locale: "fr-FR" });
test.describe.configure({ mode: "serial" });

const CLIENT = "client1@satex.test";
const ADMIN = "admin@satex.test";
const SALES = "sales1@satex.test";
const SKU = "E2E-ORD-1";
const jobs = { authorization: "Bearer e2e-cron-secret" };

const clientId = () => withDb(async (c) => (await c.query(`select p.client_id from public.profiles p join auth.users u on u.id = p.id where u.email = $1`, [CLIENT])).rows[0].client_id as string);
async function cleanup() {
  const id = await clientId();
  await withDb(async (c) => {
    await c.query(`delete from public.deliveries where order_id in (select id from public.orders where client_id = $1)`, [id]);
    await c.query(`delete from public.orders where client_id = $1`, [id]);
    await c.query(`delete from public.quotes where client_id = $1`, [id]);
  });
  await purgeFabrics("f.sku = $1", [SKU]);
}
test.beforeAll(cleanup);
test.afterAll(cleanup);

const runJobs = async (request: APIRequestContext) => expect((await request.get("/api/jobs/run", { headers: jobs })).status()).toBe(200);

/** A private (inactive) fabric with two colors and 200 m of stock each, so the tests never depend on the seeded stock. */
async function stock() {
  return withDb(async (c) => {
    const existing = (await c.query(`select id from public.fabrics where sku = $1`, [SKU])).rows[0];
    const category = (await c.query(`select id from public.categories order by sort limit 1`)).rows[0].id;
    const fabric = existing?.id ?? (await c.query(
      `insert into public.fabrics (slug, sku, name, category_id, construction, structure, composition, gsm, width_cm, moq_m, base_price_per_m, is_active)
       values ('e2e-ord-1', $1, '{"fr":"Tissu commande test"}', $2, 'woven', 'plain', '[{"fiber":"cotton","pct":100}]', 150, 150, 1, 10, false) returning id`, [SKU, category])).rows[0].id;
    const ids: string[] = [];
    for (const code of ["A", "B"]) {
      const color = existing
        ? (await c.query(`select id from public.fabric_colors where fabric_id = $1 and code = $2`, [fabric, code])).rows[0]
        : (await c.query(`insert into public.fabric_colors (fabric_id, code, name, hex) values ($1, $2, $3, '#336699') returning id`, [fabric, code, JSON.stringify({ fr: `Coloris ${code}` })])).rows[0];
      if (!existing) await c.query(`select public.receive_lot($1, $2, 200)`, [color.id, `LOT-E2E-ORD-${code}`]);
      ids.push(color.id);
    }
    return ids;
  });
}

/** A confirmed order with one 10 m line and one 15 m line (the cutting jobs are created by the database). */
async function makeOrder(colors: string[]) {
  return withDb(async (c) => {
    const client = await clientId();
    const quote = (await c.query(`insert into public.quotes (client_id, status) values ($1, 'converted') returning id`, [client])).rows[0].id;
    const o = (await c.query(`insert into public.orders (client_id, quote_id, currency, subtotal, vat_rate, total) values ($1, $2, 'EUR', 250, 0.20, 300) returning id, ref`, [client, quote])).rows[0] as { id: string; ref: string };
    for (const [i, meters] of [10, 15].entries()) {
      const line = (await c.query(`insert into public.order_lines (order_id, color_id, meters, unit_price, line_total) values ($1, $2, $3, 10, $4) returning id`, [o.id, colors[i], meters, meters * 10])).rows[0];
      await c.query(`insert into public.order_allocations (order_line_id, color_id, meters) values ($1, $2, $3)`, [line.id, colors[i], meters]);
    }
    return o;
  });
}
const orderStatus = (id: string) => withDb(async (c) => (await c.query(`select status, payment_status from public.orders where id = $1`, [id])).rows[0] as { status: string; payment_status: string });
const available = (colorId: string) => withDb(async (c) => Number((await c.query(`select available_m from public.v_color_availability_all where color_id = $1`, [colorId])).rows[0].available_m));

test("cutting board: drag a card or use its button, choose the lot, record the real meters; the order follows by itself", async ({ page, request }) => {
  const colors = await stock();
  const order = await makeOrder(colors);
  await signInOk(page, SALES, seededPassword(SALES));
  await page.goto("/fr/admin/cutting");
  const cards = page.locator(`[data-testid="cutting-card"][data-order="${order.ref}"]`);
  await expect(cards).toHaveCount(2);
  const queued = page.getByTestId("column-queued");
  await expect(queued.locator(`[data-order="${order.ref}"]`)).toHaveCount(2);

  // a card cannot jump from "waiting" to "cut"
  await cards.first().dragTo(page.getByTestId("column-ready"));
  await expect(page.getByText("Ce déplacement n'est pas possible")).toBeVisible();

  // first card: button -> dialog -> choose the lot
  const first = queued.locator(`[data-order="${order.ref}"]`).filter({ hasText: "10 m" });
  await first.getByTestId("start-cut").click();
  await expect(page.getByTestId("cut-dialog")).toBeVisible();
  await expect(page.getByTestId("lot-option").first()).toBeChecked();
  await page.getByTestId("cut-confirm").click();
  await expect(page.getByText(`Coupe démarrée pour ${order.ref}.`)).toBeVisible();
  await expect(page.getByTestId("column-cutting").locator(`[data-order="${order.ref}"]`)).toHaveCount(1);
  expect((await orderStatus(order.id)).status).toBe("in_preparation");

  // second card: drag and drop to "cutting"
  await queued.locator(`[data-order="${order.ref}"]`).first().dragTo(page.getByTestId("column-cutting"));
  await expect(page.getByTestId("cut-dialog")).toBeVisible();
  await page.getByTestId("cut-confirm").click();
  await expect(page.getByTestId("column-cutting").locator(`[data-order="${order.ref}"]`)).toHaveCount(2);

  // finishing: a wrong quantity is refused, the real one is recorded
  const cutting = page.getByTestId("column-cutting");
  await cutting.locator(`[data-order="${order.ref}"]`).filter({ hasText: "10 m" }).getByTestId("finish-cut").click();
  await expect(page.getByTestId("cut-meters")).toHaveValue("10");
  await page.getByTestId("cut-meters").fill("0");
  await page.getByTestId("cut-confirm").click();
  await expect(page.getByText("Indiquez un nombre de mètres positif.")).toBeVisible();
  await page.getByTestId("cut-meters").fill("9,5");
  await page.getByTestId("cut-confirm").click();
  await expect(page.getByTestId("column-ready").locator(`[data-order="${order.ref}"]`).getByTestId("card-meters")).toHaveText("9.5 / 10 m");
  expect((await orderStatus(order.id)).status).toBe("in_preparation"); // one cut is still going

  await cutting.locator(`[data-order="${order.ref}"]`).first().dragTo(page.getByTestId("column-ready"));
  await expect(page.getByTestId("cut-dialog")).toBeVisible();
  await page.getByTestId("cut-confirm").click();
  await expect(page.getByTestId("column-ready").locator(`[data-order="${order.ref}"]`)).toHaveCount(2);
  expect((await orderStatus(order.id)).status).toBe("ready");

  // stock follows the real cut: 200 - 9.5 and 200 - 15, nothing left allocated
  expect(await available(colors[0]!)).toBe(190.5);
  expect(await available(colors[1]!)).toBe(185);

  await runJobs(request);
  expect(await withDb(async (c) => (await c.query(`select count(*)::int as n from public.email_log where template = 'order_ready' and payload->>'entityId' = $1`, [order.id])).rows[0].n)).toBe(1);
});

test("order: payment, delivery (needs a tracking number), shipping and delivery are told to the client at each step", async ({ page, browser, request }) => {
  const [order] = await withDb(async (c) => (await c.query(`select id, ref from public.orders where client_id = $1 order by created_at limit 1`, [await clientId()])).rows as { id: string; ref: string }[]);
  await signInOk(page, ADMIN, seededPassword(ADMIN));
  await page.goto("/fr/admin/orders");
  await page.getByTestId("order-search").fill(order!.ref);
  await expect(page.getByTestId("order-row")).toHaveCount(1);
  await page.getByTestId("order-open").click();
  await expect(page.getByTestId("order-editor")).toHaveAttribute("data-status", "ready");
  await expect(page.getByTestId("order-progress")).toHaveText("2 sur 2");
  await expect(page.getByTestId("line-job").first()).toHaveAttribute("data-status", "ready");

  await page.getByTestId("order-payment").selectOption("partial");
  await expect(page.getByText("Paiement mis à jour.")).toBeVisible();
  expect((await orderStatus(order!.id)).payment_status).toBe("partial");

  // plan the delivery, try to ship without carrier and tracking
  await page.getByTestId("new-delivery-date").fill(new Date().toISOString().slice(0, 10));
  await page.getByTestId("create-delivery").click();
  const card = page.getByTestId("delivery-card");
  await expect(card).toHaveAttribute("data-status", "scheduled");
  await card.getByTestId("delivery-ship").click();
  await expect(page.getByText("Indiquez le transporteur et le numéro de suivi pour expédier.")).toBeVisible();
  await card.getByTestId("delivery-carrier").fill("Colissimo");
  await card.getByTestId("delivery-tracking").fill("6A02001TEST");
  await card.getByTestId("delivery-save").click();
  await expect.poll(async () => withDb(async (c) => (await c.query(`select tracking_number from public.deliveries where order_id = $1`, [order!.id])).rows[0]?.tracking_number)).toBe("6A02001TEST");
  await card.getByTestId("delivery-ship").click();
  await expect(page.getByTestId("order-editor")).toHaveAttribute("data-status", "shipped");
  await expect(card).toHaveAttribute("data-status", "in_transit");

  // the client sees tracking and the status on their order page
  const clientContext = await browser.newContext({ locale: "fr-FR" });
  const clientPage = await clientContext.newPage();
  await signInOk(clientPage, CLIENT, seededPassword(CLIENT));
  await clientPage.goto("/fr/account/orders");
  const listed = clientPage.getByTestId("order-row").filter({ hasText: order!.ref });
  await expect(listed.getByTestId("order-status")).toHaveText("Expédiée");
  await listed.click();
  await expect(clientPage.getByTestId("order-ref")).toHaveText(order!.ref);
  await expect(clientPage.getByTestId("delivery-tracking")).toContainText("6A02001TEST");
  await expect(clientPage.getByTestId("order-line")).toHaveCount(2);

  // deliveries page: it is open, then it is not
  await page.goto("/fr/admin/deliveries");
  await expect(page.getByTestId("delivery-row").filter({ hasText: order!.ref })).toBeVisible();
  await page.getByTestId("delivery-row").filter({ hasText: order!.ref }).getByTestId("delivery-delivered").click();
  await expect(page.getByTestId("delivery-row").filter({ hasText: order!.ref })).toHaveCount(0);
  expect((await orderStatus(order!.id)).status).toBe("delivered");

  await clientPage.reload();
  await expect(clientPage.getByTestId("order-detail")).toHaveAttribute("data-status", "delivered");
  await clientContext.close();

  await runJobs(request);
  const mails = await withDb(async (c) => (await c.query(`select template, status from public.email_log where template in ('delivery_in_transit', 'delivery_delivered') and to_email = $1 order by template`, [CLIENT])).rows);
  expect(mails).toEqual([{ template: "delivery_delivered", status: "logged" }, { template: "delivery_in_transit", status: "logged" }]);
  expect(await withDb(async (c) => (await c.query(`select count(*)::int as n from public.notifications n join auth.users u on u.id = n.user_id where u.email = $1 and n.type in ('delivery_in_transit', 'delivery_delivered')`, [CLIENT])).rows[0].n)).toBe(2);
});

test("a failed delivery sends the order back to 'ready'; cancelling an order needs a reason, frees the stock and clears the board", async ({ page }) => {
  const colors = await stock();
  const o1 = await makeOrder(colors);
  const o2 = await makeOrder(colors);
  await signInOk(page, ADMIN, seededPassword(ADMIN));

  // order 1: ready by hand, delivery, failure
  await page.goto(`/fr/admin/orders/${o1.id}`);
  await page.getByTestId("order-ready").click();
  await expect(page.getByTestId("order-editor")).toHaveAttribute("data-status", "ready");
  await page.getByTestId("create-delivery").click();
  await page.getByTestId("delivery-carrier").fill("DHL");
  await page.getByTestId("delivery-tracking").fill("DHL123");
  await page.getByTestId("delivery-save").click();
  await expect.poll(async () => withDb(async (c) => (await c.query(`select tracking_number from public.deliveries where order_id = $1`, [o1.id])).rows[0]?.tracking_number)).toBe("DHL123");
  await page.getByTestId("delivery-ship").click();
  await expect(page.getByTestId("order-editor")).toHaveAttribute("data-status", "shipped");
  await page.getByTestId("delivery-fail").click();
  await page.getByTestId("delivery-fail-confirm").click();
  await expect(page.getByText("Indiquez un motif.")).toBeVisible();
  await page.getByTestId("delivery-fail-reason").fill("Adresse introuvable");
  await page.getByTestId("delivery-fail-confirm").click();
  await expect(page.getByTestId("order-editor")).toHaveAttribute("data-status", "ready");
  await expect(page.getByTestId("delivery-failure").first()).toContainText("Adresse introuvable");
  await expect(page.getByTestId("new-delivery")).toBeVisible(); // it can be planned again

  // order 2: cancel
  const before = await available(colors[0]!);
  await page.goto(`/fr/admin/orders/${o2.id}`);
  await page.getByTestId("order-cancel").click();
  await page.getByTestId("order-cancel-confirm").click();
  await expect(page.getByText("Indiquez un motif.")).toBeVisible();
  await page.getByTestId("order-cancel-reason-input").fill("Le client a renoncé");
  await page.getByTestId("order-cancel-confirm").click();
  await expect(page.getByTestId("order-editor")).toHaveAttribute("data-status", "cancelled");
  await expect(page.getByTestId("order-cancel-reason")).toContainText("Le client a renoncé");
  expect(await available(colors[0]!)).toBe(before + 10);
  await page.goto("/fr/admin/cutting");
  await expect(page.getByTestId("cutting-card").filter({ hasText: o2.ref })).toHaveCount(0);
});

test("the dashboard numbers match the database, and the order pages work in Arabic", async ({ page }) => {
  await signInOk(page, ADMIN, seededPassword(ADMIN));
  await page.goto("/fr/admin");
  await expect(page.getByTestId("dashboard")).toBeVisible();
  const db = await withDb(async (c) => ({
    toReview: (await c.query(`select count(*)::int as n from public.quotes where status in ('submitted','in_review')`)).rows[0].n,
    cutting: (await c.query(`select count(*)::int as n from public.cutting_jobs where status in ('queued','cutting')`)).rows[0].n,
    open: (await c.query(`select count(*)::int as n from public.orders where status in ('confirmed','in_preparation','ready','shipped')`)).rows[0].n,
    messages: (await c.query(`select count(*)::int as n from public.contact_messages where not handled`)).rows[0].n,
  }));
  await expect(page.getByTestId("kpi-quotes_to_review")).toHaveAttribute("data-value", String(db.toReview));
  await expect(page.getByTestId("kpi-cutting_queue")).toHaveAttribute("data-value", String(db.cutting));
  await expect(page.getByTestId("kpi-orders_open")).toHaveAttribute("data-value", String(db.open));
  await expect(page.getByTestId("kpi-messages_unhandled")).toHaveAttribute("data-value", String(db.messages));
  await page.getByTestId("kpi-cutting_queue").click();
  await expect(page).toHaveURL(/\/fr\/admin\/cutting$/);

  await page.goto("/ar/admin/orders");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "الطلبات" })).toBeVisible();
  await page.goto("/ar/admin/cutting");
  await expect(page.getByRole("heading", { level: 1, name: "لوحة القص" })).toBeVisible();
});

test("clients see only their own orders", async ({ page }) => {
  await signInOk(page, "client2@satex.test", seededPassword("client2@satex.test"));
  const mine = await withDb(async (c) => (await c.query(`select id from public.orders where client_id = $1 limit 1`, [await clientId()])).rows[0]?.id as string | undefined);
  expect(mine).toBeTruthy();
  await page.goto(`/fr/account/orders/${mine}`);
  await expect(page.getByText("Cette commande est introuvable.")).toBeVisible();
});
