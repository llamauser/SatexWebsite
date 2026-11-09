import { expect, test } from "@playwright/test";
import { seededPassword, signInOk, withDb } from "./helpers";

test.use({ locale: "fr-FR" });
const CLIENT = "client1@satex.test";
let collectionId: string | null = null;

test.afterAll(async () => {
  if (!collectionId) return;
  await withDb(async (c) => {
    await c.query(`delete from public.quotes where collection_id = $1`, [collectionId]);
    await c.query(`delete from public.collections where id = $1`, [collectionId]);
  });
});

test("a client builds a collection, swaps fabrics with live meterage, and requests one quote", async ({ page }) => {
  await signInOk(page, CLIENT, seededPassword(CLIENT));
  await page.goto("/fr/account/planner");
  await page.getByLabel("Nom de la collection").fill("E2E collection planner line");
  await page.getByLabel("Clientèle cible").fill("Adultes urbains");
  await page.getByLabel("Décrivez votre collection").fill("Une ligne estivale légère et respirante en coton, avec des couleurs coordonnées.");
  await page.getByLabel("Quantité").first().fill("12");
  const sizeRun = page.locator("fieldset").first();
  await sizeRun.getByLabel("XS").fill("1");
  await sizeRun.getByRole("spinbutton", { name: "L", exact: true }).fill("3");

  const buildResponse = page.waitForResponse((response) => response.url().endsWith("/api/planner/plan") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Construire le plan" }).click();
  const planResponse = await buildResponse;
  expect(planResponse.status()).toBe(200);
  const plan = await planResponse.json() as { collectionId: string; items: { id: string; alternatives: unknown[]; meters_needed: number }[] };
  collectionId = plan.collectionId;
  expect(plan.items.length).toBe(1);
  expect(plan.items[0]!.alternatives.length).toBeGreaterThan(0);
  expect(plan.items[0]!.meters_needed).toBeGreaterThan(0);
  await expect(page.getByTestId("planner-result-title")).toBeVisible();
  await expect(page.getByText(/Total\s*:/)).toBeVisible();
  const boardLink = page.getByRole("link", { name: "Télécharger le dossier de collection" }).last();
  await expect(boardLink).toBeVisible();
  const boardUrl = await boardLink.getAttribute("href");
  const boardResponse = await page.request.get(boardUrl!);
  expect(boardResponse.status()).toBe(200);
  expect(boardResponse.headers()["content-type"]).toContain("application/pdf");
  expect((await boardResponse.body()).subarray(0, 5).toString()).toBe("%PDF-");

  const choices = page.locator('[aria-label="Alternatives"]').first().getByRole("button");
  if (await choices.count() > 1) {
    const response = page.waitForResponse((value) => value.url().endsWith("/api/planner/items") && value.request().method() === "PATCH");
    await choices.nth(1).click();
    expect((await response).status()).toBe(200);
  }
  const saved = await withDb(async (c) => (await c.query(`select chosen_color_id, meters_needed::float as meters from public.collection_items where collection_id = $1`, [collectionId])).rows[0]);
  expect(saved.chosen_color_id).toBeTruthy();
  expect(saved.meters).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Demander un devis" }).click();
  await expect(page).toHaveURL(/\/fr\/account\/quotes\/[0-9a-f-]+/i);
  const quote = await withDb(async (c) => (await c.query(`select id, status, source, collection_id from public.quotes where collection_id = $1`, [collectionId])).rows[0]);
  expect(quote).toMatchObject({ status: "submitted", source: "planner", collection_id: collectionId });
  const emailCount = await withDb(async (c) => Number((await c.query(`select count(*)::int as n from pgmq.q_q_email where message->>'id' = $1 and message->>'template' like 'quote_submitted_%'`, [quote.id])).rows[0]!.n));
  expect(emailCount).toBe(2);
});
