import { expect, test } from "@playwright/test";
import { withDb } from "./helpers";

test.use({ locale: "fr-FR" });

test("the home page shows the 9 categories and the 6 featured fabrics from the database", async ({ page }) => {
  await page.goto("/fr");
  const categories = page.getByRole("region", { name: "Nos univers" });
  await expect(categories.getByRole("link")).toHaveCount(9);
  await expect(categories.getByRole("link", { name: "Denim" })).toHaveAttribute("href", "/fr/catalog?category=denim");

  const featured = page.getByTestId("featured-fabrics");
  await expect(featured.getByRole("listitem")).toHaveCount(6);
  await expect(featured.getByText(/À partir de/).first()).toBeVisible();
  await expect(featured.getByRole("link").first()).toHaveAttribute("href", /\/fr\/catalog\/[a-z0-9-]+$/);
});

test("the featured section is translated (Arabic names and prices with Latin digits)", async ({ page }) => {
  await page.goto("/ar");
  const featured = page.getByTestId("featured-fabrics");
  await expect(featured.getByRole("listitem")).toHaveCount(6);
  await expect(featured).toContainText("ابتداءً من");
  await expect(featured).not.toContainText(/[٠-٩]/); // no Arabic-Indic digits
});

test("a contact message is stored for staff and an email job is queued", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "fr-FR", baseURL: "http://localhost:3100", extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 250) + 1}` } });
  const page = await ctx.newPage();
  const marker = `e2e-contact-${Date.now()}`;
  await page.goto("/fr/contact");
  await page.locator('input[name="name"]').fill("Camille E2E");
  await page.locator('input[name="company"]').fill("Atelier E2E");
  await page.locator('input[name="email"]').fill("camille.e2e@example.com");
  await page.locator('textarea[name="message"]').fill(`Bonjour, ceci est un test ${marker}. Merci de me rappeler.`);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Envoyer le message" }).click();
  await expect(page.getByTestId("contact-success")).toBeVisible();

  const { stored, queued } = await withDb(async (c) => {
    const m = await c.query(`select id, name, company, email, locale, handled from public.contact_messages where message like $1`, [`%${marker}%`]);
    const q = m.rows[0] ? await c.query(`select 1 from pgmq.q_q_email where message->>'template' = 'contact_message_staff' and message->>'id' = $1`, [m.rows[0].id]) : { rowCount: 0 };
    return { stored: m.rows[0], queued: q.rowCount };
  });
  expect(stored).toMatchObject({ name: "Camille E2E", company: "Atelier E2E", email: "camille.e2e@example.com", locale: "fr", handled: false });
  expect(queued).toBe(1);
  await ctx.close();
});

test("the sixth contact message from the same address is refused", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "fr-FR", baseURL: "http://localhost:3100", extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` } });
  const page = await ctx.newPage();
  for (let i = 1; i <= 6; i++) {
    await page.goto("/fr/contact");
    await page.locator('input[name="name"]').fill("Spam Test");
    await page.locator('input[name="email"]').fill("spam@example.com");
    await page.locator('textarea[name="message"]').fill(`Message numéro ${i} pour tester la limite d'envoi.`);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Envoyer le message" }).click();
    if (i <= 5) await expect(page.getByTestId("contact-success")).toBeVisible();
  }
  await expect(page.getByText("Trop de messages envoyés.")).toBeVisible();
  await ctx.close();
});
