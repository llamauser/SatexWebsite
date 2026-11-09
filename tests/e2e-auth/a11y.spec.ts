import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seededPassword, signInOk } from "./helpers";

test.use({ locale: "fr-FR" });

/** WCAG 2.1 A and AA rules, serious and critical problems only (docs/11-non-functional.md §2). */
async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

const PUBLIC = ["", "/catalog", "/catalog/linen-plain-160", "/match", "/snap", "/showroom", "/about", "/contact", "/auth/sign-in", "/auth/sign-up", "/legal/privacy"];

for (const locale of ["fr", "en", "ar"] as const) {
  test(`public pages have no serious accessibility problem (${locale})`, async ({ page }) => {
    test.setTimeout(150_000); // eleven pages per language: 35-40 s on a CI runner, which is too close to the 60 s default
    for (const path of PUBLIC) {
      await page.goto(`/${locale}${path}`);
      await page.waitForLoadState("networkidle");
      await audit(page, `/${locale}${path}`);
    }
  });
}

test("the showroom plan with a department panel open, and the cart drawer", async ({ page }) => {
  await page.addInitScript(() => { if (localStorage.getItem("satex.showroom.view") === null) localStorage.setItem("satex.showroom.view", "2d"); });
  await page.goto("/fr/showroom");
  await page.locator('[data-testid="plan-department"][data-slug="knits"]').click();
  await expect(page.getByTestId("department-panel")).toBeVisible();
  await audit(page, "showroom panel");
  await page.goto("/fr/catalog/linen-plain-160");
  await page.getByTestId("add-to-quote").click();
  await expect(page.getByTestId("cart-drawer")).toBeVisible();
  await audit(page, "cart drawer");
});

test("signed-in client and back-office pages have no serious accessibility problem", async ({ page }) => {
  test.setTimeout(180_000); // fourteen pages, each loaded and audited
  await signInOk(page, "client1@satex.test", seededPassword("client1@satex.test"));
  for (const path of ["/account", "/account/quotes", "/account/reservations", "/account/samples", "/account/orders", "/account/profile"]) {
    await page.goto(`/fr${path}`);
    await page.waitForLoadState("networkidle");
    await audit(page, `client ${path}`);
  }
  await page.context().clearCookies();
  await signInOk(page, "admin@satex.test", seededPassword("admin@satex.test"));
  for (const path of ["/admin", "/admin/quotes", "/admin/orders", "/admin/cutting", "/admin/stock", "/admin/fabrics", "/admin/settings", "/admin/departments"]) {
    await page.goto(`/fr${path}`);
    await page.waitForLoadState("networkidle");
    await audit(page, `admin ${path}`);
  }
});
