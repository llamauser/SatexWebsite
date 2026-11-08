import { expect, test } from "@playwright/test";
import { withDb } from "./helpers";

test.use({ locale: "fr-FR" });

const count = (page: import("@playwright/test").Page) => page.getByTestId("catalog-grid").getByRole("listitem");

test("the catalog lists the first 24 of the seeded fabrics, with a total and pagination", async ({ page }) => {
  await page.goto("/fr/catalog?in_stock=0");
  await expect(count(page)).toHaveCount(24);
  await expect(page.getByTestId("results-count")).toHaveText("80 tissus");
  const nav = page.getByRole("navigation", { name: "Pagination" });
  await expect(nav.getByRole("link", { name: "Page 4" })).toBeVisible();
  await nav.getByRole("link", { name: "Page suivante" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(count(page)).toHaveCount(24);
  await page.goto("/fr/catalog?in_stock=0&page=4");
  await expect(count(page)).toHaveCount(8); // 80 = 24 + 24 + 24 + 8
  await page.goto("/fr/catalog?in_stock=0&page=9");
  await expect(page.getByTestId("catalog-empty")).toBeVisible();
});

test("the default view only shows fabrics that are in stock", async ({ page }) => {
  await page.goto("/fr/catalog");
  const inStock = await page.getByTestId("results-count").innerText();
  await page.goto("/fr/catalog?in_stock=0");
  const all = await page.getByTestId("results-count").innerText();
  expect(Number(inStock.replace(/\D/g, ""))).toBeLessThanOrEqual(Number(all.replace(/\D/g, "")));
  expect(Number(inStock.replace(/\D/g, ""))).toBeGreaterThan(60);
});

test("category, fiber, weight and use filters narrow the results (URL driven)", async ({ page }) => {
  await page.goto("/fr/catalog?in_stock=0&category=denim");
  await expect(page.getByTestId("results-count")).toHaveText("7 tissus");

  await page.goto("/fr/catalog?in_stock=0&fiber=silk");
  await expect(page.getByTestId("results-count")).toHaveText(/^\d+ tissus?$/);
  await expect(page.getByTestId("catalog-grid").getByText(/soie/i).first()).toBeVisible();

  await page.goto("/fr/catalog?in_stock=0&gsm_min=400&gsm_max=500");
  const n = Number((await page.getByTestId("results-count").innerText()).replace(/\D/g, ""));
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(30);

  await page.goto("/fr/catalog?in_stock=0&use=upholstery");
  await expect(page.getByTestId("results-count")).toHaveText("8 tissus");

  await page.goto("/fr/catalog?in_stock=0&category=denim&structure=denim&stretch=two_way");
  await expect(page.getByTestId("results-count")).toHaveText(/^\d+ tissus?$/);
});

test("search finds the golden fabric, accents optional", async ({ page }) => {
  await page.goto("/fr/catalog?in_stock=0&q=pique");
  await expect(page.getByTestId("catalog-grid").getByRole("link", { name: /Piqué coton \/ élasthanne/ })).toBeVisible();
  await page.goto("/fr/catalog?in_stock=0&q=piqué");
  await expect(page.getByTestId("catalog-grid").getByRole("link", { name: /Piqué coton \/ élasthanne/ })).toBeVisible();
  await page.goto("/fr/catalog?in_stock=0&q=SAT-DE");
  const bySku = Number((await page.getByTestId("results-count").innerText()).replace(/\D/g, ""));
  expect(bySku).toBeGreaterThanOrEqual(7); // the 7 denim SKUs (SAT-DE-…)
  expect(bySku).toBeLessThan(15);
});

test("sorting by weight orders the grid", async ({ page }) => {
  await page.goto("/fr/catalog?in_stock=0&sort=gsm_asc");
  const first = await page.getByTestId("catalog-grid").getByRole("listitem").first().innerText();
  await page.goto("/fr/catalog?in_stock=0&sort=gsm_desc");
  const firstDesc = await page.getByTestId("catalog-grid").getByRole("listitem").first().innerText();
  const gsm = (t: string) => Number(/(\d+) GSM/.exec(t)?.[1]);
  expect(gsm(first)).toBeLessThan(gsm(firstDesc));
  expect(gsm(first)).toBeLessThanOrEqual(60);
  expect(gsm(firstDesc)).toBeGreaterThanOrEqual(480);
});

test("on the page, ticking a category filter changes the URL and the results", async ({ page, isMobile }) => {
  await page.goto("/fr/catalog?in_stock=0");
  if (isMobile) await page.getByTestId("filters-toggle").click();
  await page.locator('input[name="category"][value="denim"]').check();
  await expect(page).toHaveURL(/category=denim/);
  await expect(page.getByTestId("results-count")).toHaveText("7 tissus");
  await page.getByTestId("active-filters").getByRole("button", { name: /Denim/ }).click();
  await expect(page.getByTestId("results-count")).toHaveText("80 tissus");
});

test("fabric page: specs, colors with stock, price tiers, similar fabrics, contact link", async ({ page }) => {
  await page.goto("/fr/catalog/cotton-elastane-pique");
  await expect(page.getByRole("heading", { level: 1, name: "Piqué coton / élasthanne" })).toBeVisible();
  const specs = page.getByTestId("spec-table");
  await expect(specs).toContainText("92% Coton · 8% Élasthanne");
  await expect(specs).toContainText("240 GSM");
  await expect(specs).toContainText("150 cm");
  await expect(specs).toContainText("Stretch bi-élastique");
  await expect(specs).toContainText("Printemps-été");

  const tiers = page.getByTestId("price-tiers").getByRole("row");
  await expect(tiers).toHaveCount(3);

  const colors = page.getByTestId("color-list").getByRole("listitem");
  expect(await colors.count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId("similar").getByRole("listitem").first()).toBeVisible();

  const ask = page.getByRole("link", { name: "Demander un échantillon ou un devis" });
  await expect(ask).toHaveAttribute("href", /\/fr\/contact\?ref=SAT-KN-\d{4}$/);
  await ask.click();
  await expect(page.locator("#contact-message")).toHaveValue(/SAT-KN-\d{4}/);
});

test("fabric page in Arabic: translated specs and Latin digits", async ({ page }) => {
  await page.goto("/ar/catalog/cotton-elastane-pique");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const specs = page.getByTestId("spec-table");
  await expect(specs).toContainText("قطن");
  await expect(specs).toContainText("240 GSM");
  await expect(page.getByTestId("color-list")).not.toContainText(/[٠-٩]/);
});

test("stock shown on the fabric page updates live when staff change the stock (no reload)", async ({ page }) => {
  await page.goto("/fr/catalog/cotton-elastane-pique");
  await expect(page.getByTestId("stock-live")).toHaveAttribute("data-live", "true", { timeout: 15_000 });

  const target = await withDb(async (c) => {
    const { rows } = await c.query(
      `select c.id as color_id, c.code, l.id as lot_id, a.available_m
         from public.fabrics f join public.fabric_colors c on c.fabric_id = f.id
         join public.v_color_availability_all a on a.color_id = c.id
         join public.stock_lots l on l.color_id = c.id
        where f.slug = 'cotton-elastane-pique' and a.available_m >= 40 order by l.meters desc limit 1`,
    );
    return rows[0] as { color_id: string; code: string; lot_id: string; available_m: string } | undefined;
  });
  test.skip(!target, "no color with enough stock in the seed");

  const cell = page.getByTestId(`available-${target!.code}`);
  const before = Math.floor(Number(target!.available_m));
  // the page was generated earlier: wait until the live refresh shows the current database value
  await expect.poll(async () => Number(await cell.getAttribute("data-meters")), { timeout: 10_000 }).toBe(before);
  await withDb((c) => c.query(`select public.adjust_stock($1, -25, 'e2e live stock test')`, [target!.lot_id]));
  await expect.poll(async () => Number(await cell.getAttribute("data-meters")), { timeout: 10_000 }).toBe(before - 25);

  await withDb((c) => c.query(`select public.adjust_stock($1, 25, 'e2e live stock test (restore)')`, [target!.lot_id]));
  await expect.poll(async () => Number(await cell.getAttribute("data-meters")), { timeout: 10_000 }).toBe(before);
});
