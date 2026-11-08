import { expect, test } from "@playwright/test";

test.use({ locale: "fr-FR" });

test("switching to Arabic flips to RTL, uses the Arabic font, and is remembered", async ({
  page,
}, testInfo) => {
  await page.goto("/fr");
  await page.getByRole("button", { name: "عربي" }).click();
  await expect(page).toHaveURL(/\/ar$/);

  const html = page.locator("html");
  await expect(html).toHaveAttribute("lang", "ar");
  await expect(html).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "توقّف عن التخمين." })).toBeVisible();

  const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(font).toContain("IBM Plex Sans Arabic");

  await page.screenshot({
    path: testInfo.outputPath(`home-ar-${testInfo.project.name}.png`),
    fullPage: true,
  });

  // NEXT_LOCALE cookie is remembered: "/" now goes to /ar
  await page.goto("/");
  await expect(page).toHaveURL(/\/ar$/);
});

test("switcher keeps the path and the query string", async ({ page }) => {
  await page.goto("/fr/does-not-exist?foo=1&bar=2");
  await expect(page.getByRole("heading", { level: 1, name: "Page introuvable" })).toBeVisible();

  await page.getByRole("button", { name: "EN" }).click();
  await expect(page).toHaveURL(/\/en\/does-not-exist\?foo=1&bar=2$/);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});

test("unknown locale prefix is not found", async ({ page }) => {
  const res = await page.goto("/xx/anything");
  // "xx" is not a locale, so it is treated as a path under the default locale and 404s
  expect(res?.status()).toBe(404);
});
