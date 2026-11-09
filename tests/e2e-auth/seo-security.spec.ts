import { expect, test, type Page } from "@playwright/test";
import { seededPassword, signInOk, withDb } from "./helpers";

test.use({ locale: "fr-FR" });

const ldOf = async (page: Page) =>
  (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t) as Record<string, unknown>);

test("robots.txt keeps private areas out and points to the sitemap", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  const text = await res.text();
  for (const rule of ["Disallow: /api/", "Disallow: /*/account", "Disallow: /*/admin", "Disallow: /*/match/"]) expect(text).toContain(rule);
  expect(text).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
});

test("sitemap.xml lists every language of every public page and every active fabric, with hreflang alternates", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  const xml = await res.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  const active = await withDb(async (c) => (await c.query(`select slug from public.fabrics where is_active`)).rows.map((r) => r.slug as string));
  expect(active.length).toBeGreaterThan(5);
  for (const lang of ["fr", "en", "ar"]) {
    expect(urls.some((u) => u.endsWith(`/${lang}`))).toBe(true);
    expect(urls.some((u) => u.endsWith(`/${lang}/catalog`))).toBe(true);
    expect(urls.some((u) => u.endsWith(`/${lang}/showroom`))).toBe(true);
    for (const slug of active) expect(urls.some((u) => u.endsWith(`/${lang}/catalog/${slug}`))).toBe(true);
  }
  expect(urls.some((u) => /\/(account|admin|auth|api)/.test(u))).toBe(false);
  expect(xml).toContain('hreflang="ar"');
  expect(xml).toContain('hreflang="x-default"');
  // inactive fabrics are not listed
  const inactive = await withDb(async (c) => (await c.query(`select slug from public.fabrics where not is_active limit 1`)).rows[0]?.slug as string | undefined);
  if (inactive) expect(urls.some((u) => u.endsWith(`/catalog/${inactive}`))).toBe(false);
});

test("pages carry a canonical URL and the three language alternates", async ({ page }) => {
  for (const path of ["", "/catalog", "/showroom", "/about", "/contact", "/legal/privacy"]) {
    await page.goto(`/en${path}`);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical, path).toMatch(new RegExp(`/en${path}$`));
    const langs = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((els) => els.map((e) => e.getAttribute("hreflang")));
    expect(langs, path).toEqual(expect.arrayContaining(["fr", "en", "ar", "x-default"]));
  }
});

test("the home page describes the Organization; a fabric page describes its Product and its breadcrumb (prices only when public)", async ({ page }) => {
  await page.goto("/fr");
  const org = (await ldOf(page)).find((d) => d["@type"] === "Organization");
  expect(org).toMatchObject({ name: "SATEX Commerce", foundingDate: "1995" });

  await page.goto("/fr/catalog/linen-plain-160");
  const data = await ldOf(page);
  const product = data.find((d) => d["@type"] === "Product") as { sku: string; offers?: { priceCurrency: string; lowPrice: string } };
  expect(product.sku).toBeTruthy();
  expect(product.offers?.priceCurrency).toBe("EUR");
  expect(Number(product.offers?.lowPrice)).toBeGreaterThan(0);
  const crumbs = data.find((d) => d["@type"] === "BreadcrumbList") as { itemListElement: unknown[] };
  expect(crumbs.itemListElement).toHaveLength(3);
  // the page text and the structured data agree on the lowest price shown
  expect(await page.getByTestId("price-tiers").innerText()).toContain(Number(product.offers!.lowPrice).toFixed(2).replace(".", ","));
});

test("private areas ask search engines to stay away", async ({ page }) => {
  for (const path of ["/fr/auth/sign-in", "/fr/auth/sign-up"]) {
    await page.goto(path);
    expect(await page.locator('meta[name="robots"]').getAttribute("content"), path).toMatch(/noindex/);
  }
  await page.goto("/fr/match");
  expect(await page.locator('meta[name="robots"]').count()).toBe(0); // the wizard itself is public
  await signInOk(page, "admin@satex.test", seededPassword("admin@satex.test"));
  for (const path of ["/fr/account", "/fr/admin"]) {
    await page.goto(path);
    expect(await page.locator('meta[name="robots"]').getAttribute("content"), path).toMatch(/noindex/);
  }
});

test("security headers are sent on pages and on the API", async ({ request }) => {
  for (const path of ["/fr", "/fr/catalog", "/api/health", "/robots.txt"]) {
    const h = (await request.get(path)).headers();
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["strict-transport-security"], path).toMatch(/max-age=\d+/);
    expect(h["permissions-policy"], path).toContain("camera=()");
    const csp = h["content-security-policy"]!;
    expect(csp, path).toContain("default-src 'self'");
    expect(csp, path).toContain("frame-ancestors 'none'");
    expect(csp, path).not.toContain("unsafe-eval");
  }
});

test("no page breaks its own Content-Security-Policy (public, signed-in and admin pages, 2D and 3D)", async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  const visit = async (path: string) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    violations.push(...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).map((v) => `${path}: ${v}`));
  };
  for (const p of ["/fr", "/fr/catalog", "/fr/catalog/linen-plain-160", "/fr/match", "/fr/about", "/fr/contact", "/fr/legal/privacy", "/fr/auth/sign-in", "/ar", "/en/catalog"]) await visit(p);

  await page.addInitScript(() => localStorage.setItem("satex.showroom.view", "3d"));
  await visit("/fr/showroom");
  await page.locator('[data-testid="department-chip"][data-slug="knits"]').click();
  await page.getByTestId("floor-1").click();

  await signInOk(page, "admin@satex.test", seededPassword("admin@satex.test"));
  for (const p of ["/fr/account", "/fr/account/quotes", "/fr/admin", "/fr/admin/fabrics", "/fr/admin/quotes", "/fr/admin/cutting", "/fr/admin/stock", "/fr/admin/settings"]) await visit(p);
  expect(violations).toEqual([]);
});

test("/api/health answers for the uptime monitor", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(await res.json()).toMatchObject({ status: "ok", db: "ok" });
});

test("the monitoring test is for admins; without a DSN it says monitoring is off", async ({ page, request }) => {
  expect((await request.post("/api/admin/sentry-test")).status()).toBe(401);
  await signInOk(page, "sales1@satex.test", seededPassword("sales1@satex.test"));
  expect((await page.request.post("/api/admin/sentry-test")).status()).toBe(403);
  const admin = await page.context().browser()!.newContext({ locale: "fr-FR" });
  const adminPage = await admin.newPage();
  await signInOk(adminPage, "admin@satex.test", seededPassword("admin@satex.test"));
  await adminPage.goto("/fr/admin/settings");
  await adminPage.getByTestId("sentry-test").click();
  await expect(adminPage.getByTestId("sentry-result")).toContainText("désactivée");
  await admin.close();
});
