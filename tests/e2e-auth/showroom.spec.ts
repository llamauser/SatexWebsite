import { expect, test, type Page } from "@playwright/test";
import { withDb } from "./helpers";

test.use({ locale: "fr-FR" });

// only the first visit is forced: a later choice made on the page (and kept in the browser) must survive a reload
const prefer = (page: Page, view: "2d" | "3d") => page.addInitScript((v) => { if (localStorage.getItem("satex.showroom.view") === null) localStorage.setItem("satex.showroom.view", v); }, view);

test("the plan shows the 11 departments of the database, floor by floor, and the panels say true things", async ({ page }) => {
  await prefer(page, "2d");
  await page.goto("/fr/showroom");
  await expect(page.getByRole("heading", { level: 1, name: "Le showroom SATEX" })).toBeVisible();
  await expect(page.getByTestId("showroom")).toHaveAttribute("data-view", "2d");
  await expect(page.getByTestId("department-chip")).toHaveCount(11);
  await expect(page.getByTestId("plan-department")).toHaveCount(8); // ground floor: 6 fabric halls, cutting, shipping
  await expect(page.getByTestId("panel-placeholder")).toBeVisible();

  // a fabric hall: live stock from the same data as the catalog
  await page.locator('[data-testid="plan-department"][data-slug="knits"]').click();
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
  await expect(page.getByTestId("panel-ai")).toHaveAttribute("href", "/fr/match");

  // cutting room and dock: public, anonymous counters
  await page.locator('[data-testid="plan-department"][data-slug="cutting"]').click();
  await expect(page.getByTestId("panel-counters")).toBeVisible();
  const counters = await withDb(async (c) => (await c.query(`select public.showroom_stats() as s`)).rows[0].s as { cutting_today: number; cutting_queue: number; shipped_week: number });
  await expect(page.getByTestId("counter-cutting-queue")).toHaveText(String(counters.cutting_queue));
  await page.locator('[data-testid="plan-department"][data-slug="shipping"]').click();
  await expect(page.getByTestId("counter-shipped")).toBeVisible();

  // the upper floor
  await page.getByTestId("floor-1").click();
  await expect(page.getByTestId("plan-department")).toHaveCount(3);
  await page.locator('[data-testid="plan-department"][data-slug="client-suite"]').click();
  await expect(page.getByTestId("panel-contact")).toHaveAttribute("href", "/fr/contact");
  await page.getByTestId("panel-close").click();
  await expect(page.getByTestId("panel-placeholder")).toBeVisible();
});

test("the department list works with the keyboard and switches floors by itself", async ({ page }) => {
  await prefer(page, "2d");
  await page.goto("/fr/showroom");
  const chip = page.locator('[data-testid="department-chip"][data-slug="offices"]');
  await chip.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("panel-title")).toHaveText("Bureaux");
  await expect(page.getByTestId("showroom")).toHaveAttribute("data-view", "2d");
  await expect(page.getByTestId("floor-plan")).toHaveAttribute("data-floor", "1"); // the plan followed the choice
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-testid="plan-department"][data-slug="offices"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("panel-title")).toHaveText("Bureaux");
});

test("without WebGL the plan is shown, with the reason", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl") return null;
      return (original as (...a: unknown[]) => unknown).call(this, kind, ...rest) as never;
    } as never;
  });
  await prefer(page, "3d"); // even when 3D was chosen before
  await page.goto("/fr/showroom");
  await expect(page.getByTestId("showroom")).toHaveAttribute("data-view", "2d");
  await expect(page.getByTestId("showroom")).toHaveAttribute("data-reason", "webgl");
  await expect(page.getByTestId("fallback-note")).toContainText("ne peut pas afficher la 3D");
  await expect(page.getByTestId("floor-plan")).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("the 3D scene loads, follows the list, and the 2D choice is remembered", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await prefer(page, "3d");
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

  // 2D on demand, remembered for the next visit
  await page.getByTestId("view-2d").click();
  await expect(page.getByTestId("showroom")).toHaveAttribute("data-view", "2d");
  expect(await page.evaluate(() => localStorage.getItem("satex.showroom.view"))).toBe("2d");
  await page.reload();
  await expect(page.getByTestId("showroom")).toHaveAttribute("data-view", "2d");
  expect(errors).toEqual([]);
});

test("the showroom works in Arabic (right to left)", async ({ page }) => {
  await prefer(page, "2d");
  await page.goto("/ar/showroom");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "معرض ساتكس" })).toBeVisible();
  await expect(page.getByTestId("department-chip")).toHaveCount(11);
  await page.locator('[data-testid="plan-department"][data-slug="denim"]').click();
  await expect(page.getByTestId("panel-title")).toHaveText("دنيم");
  await expect(page.getByTestId("legend")).toContainText("طابقان");
});
