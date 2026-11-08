import { expect, test } from "@playwright/test";

// These run without a database: the catalog must render its shell and degrade gracefully.
test.use({ locale: "fr-FR" });

test("the catalog page renders its filters and a friendly message when the catalog is unavailable", async ({ page }) => {
  await page.goto("/fr/catalog");
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue de tissus" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Rechercher un tissu" })).toBeVisible();
  await expect(page.getByText("Le catalogue est momentanément indisponible.")).toBeVisible();
  await expect(page.getByTestId("sort-select")).toBeVisible();
});

test("filter parameters in the URL never break the page (unknown values are ignored)", async ({ page }) => {
  const res = await page.goto("/fr/catalog?category=<script>&fiber=unobtainium&gsm_min=abc&sort=hax&page=-4&in_stock=0&structure=twill");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue de tissus" })).toBeVisible();
  // the one valid filter (structure) and the in-stock switch are reflected in the UI
  await expect(page.getByTestId("active-filters").getByRole("button", { name: /Sergé/ })).toBeVisible();
  await expect(page.getByTestId("filter-in-stock")).not.toBeChecked();
});

test("ticking a filter updates the URL and shows a removable chip", async ({ page, isMobile }) => {
  await page.goto("/fr/catalog");
  if (isMobile) await page.getByTestId("filters-toggle").click();
  await page.getByTestId("filter-in-stock").uncheck();
  await expect(page).toHaveURL(/in_stock=0/);
  await page.getByTestId("active-filters").getByRole("button", { name: /Tout le catalogue/ }).click();
  await expect(page).not.toHaveURL(/in_stock/);
});

test("typing in the search box updates the URL", async ({ page }) => {
  await page.goto("/fr/catalog");
  await page.getByRole("searchbox", { name: "Rechercher un tissu" }).fill("jersey");
  await expect(page).toHaveURL(/[?&]q=jersey/);
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Rechercher un tissu" })).toHaveValue("jersey");
});

test("the filter panel is behind a button on phones and open on desktop", async ({ page, isMobile }) => {
  await page.goto("/fr/catalog");
  const panel = page.locator("#catalog-filter-panel");
  if (isMobile) {
    await expect(panel).toBeHidden();
    await page.getByTestId("filters-toggle").click();
    await expect(panel).toBeVisible();
  } else {
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("filters-toggle")).toBeHidden();
  }
});

test("an unknown fabric is a 404, in every language", async ({ page }) => {
  for (const locale of ["fr", "en", "ar"]) {
    const res = await page.goto(`/${locale}/catalog/this-fabric-does-not-exist`);
    expect(res?.status()).toBe(404);
  }
});

test("the catalog is translated and right-to-left in Arabic", async ({ page }) => {
  await page.goto("/ar/catalog");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "كتالوج الأقمشة" })).toBeVisible();
});
