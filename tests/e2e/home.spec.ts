import { expect, test } from "@playwright/test";

test.describe("french (default)", () => {
  test.use({ locale: "fr-FR" });

  test("/ redirects to /fr and renders hero + brand tokens", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/fr$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(
      page.getByRole("heading", { level: 1, name: "Arrêtez de deviner." }),
    ).toBeVisible();
    const bg = await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    );
    expect(bg).toBe("rgb(247, 249, 251)"); // --bg #F7F9FB
  });
});

test("Accept-Language en redirects / to /en", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", baseURL: "http://localhost:3100" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole("heading", { level: 1, name: "Stop guessing." })).toBeVisible();
  await ctx.close();
});

test("unsupported Accept-Language falls back to fr", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "de-DE", baseURL: "http://localhost:3100" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/fr$/);
  await ctx.close();
});
