import { expect, test, type Page } from "@playwright/test";
import { withDb } from "./helpers";

test.use({ locale: "fr-FR" });

// a browser without WebGL: the page shows a picture, and the department list and the panels work the same (and the test does not wait for 3D)
const noWebgl = (page: Page) => page.addInitScript(() => {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
    if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl") return null;
    return (original as (...a: unknown[]) => unknown).call(this, kind, ...rest) as never;
  } as never;
});
const chip = (page: Page, slug: string) => page.locator(`[data-testid="department-chip"][data-slug="${slug}"]`);

test("the list shows the 11 departments of the database, and the panels say true things", async ({ page }) => {
  await noWebgl(page);
  await page.goto("/fr/showroom");
  await expect(page.getByRole("heading", { level: 1, name: "Le showroom SATEX" })).toBeVisible();
  await expect(page.getByTestId("showroom")).toHaveAttribute("data-view", "picture");
  await expect(page.getByTestId("department-chip")).toHaveCount(11);
  await expect(page.getByTestId("panel-placeholder")).toBeVisible();

  // a fabric hall: live stock from the same data as the catalog
  await chip(page, "knits").click();
  await expect(page.getByTestId("panel-title")).toHaveText("Maille & sport");
  const expected = await withDb(async (c) =>
    (await c.query(
      `select floor(coalesce(sum(a.available_m), 0))::int as m, count(distinct f.id)::int as n
         from public.departments d join public.fabrics f on f.category_id = any (d.category_ids) and f.is_active
         left join public.fabric_colors fc on fc.fabric_id = f.id and fc.is_active left join public.v_color_availability a on a.color_id = fc.id
        where d.slug = 'knits'`)).rows[0] as { m: number; n: number });
  expect(expected.n).toBeGreaterThan(0);
  await expect(page.getByTestId("panel-fabric")).toHaveCount(Math.min(12, expected.n));
  const shown = (await page.getByTestId("panel-total").innerText()).replace(/[^\d]/g, "");
  // the page is cached for a few minutes: it may be slightly behind the database, never absurdly different
  expect(Number(shown)).toBeGreaterThanOrEqual(0);
  expect(Math.abs(Number(shown) - expected.m)).toBeLessThan(Math.max(500, expected.m * 0.25));
  const firstFabric = page.getByTestId("panel-fabric").first();
  await expect(firstFabric).toHaveAttribute("href", /\/fr\/catalog\/[a-z0-9-]+$/);
  await expect(page.getByTestId("panel-catalog")).toHaveAttribute("href", /\/fr\/catalog\?category=knits(%2C|,)technical-activewear/);
  await expect(page.getByTestId("panel-ai")).toHaveAttribute("href", /^\/fr\/match\?topic=Maille/); // the department goes with the visitor

  // cutting room and dock: public, anonymous counters
  await chip(page, "cutting").click();
  await expect(page.getByTestId("panel-counters")).toBeVisible();
  const counters = await withDb(async (c) => (await c.query(`select public.showroom_stats() as s`)).rows[0].s as { cutting_today: number; cutting_queue: number; shipped_week: number });
  // the page is cached for a few minutes, so the number may be a little behind the database: it is a whole number of the right order
  const queue = Number((await page.getByTestId("counter-cutting-queue").innerText()).trim());
  expect(Number.isInteger(queue)).toBe(true);
  expect(Math.abs(queue - counters.cutting_queue)).toBeLessThanOrEqual(Math.max(5, counters.cutting_queue));
  await chip(page, "shipping").click();
  await expect(page.getByTestId("counter-shipped")).toBeVisible();

  // the upper floor
  await chip(page, "client-suite").click();
  await expect(page.getByTestId("panel-contact")).toHaveAttribute("href", "/fr/contact");
  await page.getByTestId("panel-close").click();
  await expect(page.getByTestId("panel-placeholder")).toBeVisible();
});

test("the department list works with the keyboard", async ({ page }) => {
  await noWebgl(page);
  await page.goto("/fr/showroom");
  await chip(page, "offices").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("panel-title")).toHaveText("Bureaux");
  await expect(chip(page, "offices")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter"); // pressed again: back to no department
  await expect(page.getByTestId("panel-placeholder")).toBeVisible();
});

test("without WebGL a picture is shown, with the reason, and there is no 2D plan", async ({ page }) => {
  await noWebgl(page);
  await page.goto("/fr/showroom");
  await expect(page.getByTestId("showroom")).toHaveAttribute("data-view", "picture");
  await expect(page.getByTestId("showroom")).toHaveAttribute("data-reason", "webgl");
  await expect(page.getByTestId("fallback-note")).toContainText("ne peut pas afficher la 3D");
  await expect(page.getByTestId("scene-picture").getByRole("img")).toBeVisible();
  await expect(page.getByTestId("floor-plan")).toHaveCount(0);
  await expect(page.getByTestId("view-2d")).toHaveCount(0);
  await expect(page.getByTestId("floor-toggle")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("the 3D scene loads and follows the list and the floor buttons", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/fr/showroom");
  await expect(page.getByTestId("showroom")).toHaveAttribute("data-view", "3d", { timeout: 20_000 });
  await expect(page.getByTestId("scene").locator("canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("floor-both")).toHaveAttribute("aria-pressed", "true");

  await page.locator('[data-testid="department-chip"][data-slug="denim"]').click();
  await expect(page.getByTestId("panel-title")).toHaveText("Denim");
  await page.getByTestId("floor-0").click();
  await page.getByTestId("floor-1").click();
  await page.getByTestId("floor-both").click();
  await expect(page.getByTestId("scene").locator("canvas")).toBeVisible();

  await expect(page.getByTestId("view-2d")).toHaveCount(0); // there is no 2D view any more
  expect(errors).toEqual([]);
});

test("the showroom works in Arabic (right to left)", async ({ page }) => {
  await noWebgl(page);
  await page.goto("/ar/showroom");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "معرض ساتكس" })).toBeVisible();
  await expect(page.getByTestId("department-chip")).toHaveCount(11);
  await chip(page, "denim").click();
  await expect(page.getByTestId("panel-title")).toHaveText("دنيم");
  await expect(page.getByTestId("legend")).toContainText("طابقان");
});
