import { expect, test } from "@playwright/test";

test("home page renders the hero and brand tokens", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Stop guessing." })).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  expect(bg).toBe("rgb(247, 249, 251)"); // --bg #F7F9FB
});
