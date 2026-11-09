import { expect, test } from "@playwright/test";

test.use({ locale: "fr-FR" });

test("the Feel tab shows the feel card and a cloth you can pull, drop on a block or a ball, and blow on", async ({ page }) => {
  test.setTimeout(150_000); // WebGL without a graphics card is slow
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });

  await page.goto("/fr/catalog/linen-plain-160");
  await page.getByRole("tab").nth(1).click(); // the second tab: feel and drape
  await expect(page.getByTestId("feel-card")).toBeVisible();

  // the worker delivered a first pose and the cloth is drawn (a worker blocked by the CSP would never get here)
  const swatch = page.getByTestId("cloth-swatch");
  await expect(swatch).toHaveAttribute("data-ready", "true", { timeout: 90_000 });
  const modes = page.locator("section[aria-label] button[aria-pressed]").filter({ hasNot: page.locator("[style]") });
  await expect(modes.first()).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(2500); // let it hang still

  // dragging the cloth changes the picture, and the pull is told
  const box = (await swatch.boundingBox())!;
  const still = await swatch.screenshot();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.8, { steps: 10 });
  await page.waitForTimeout(600);
  const pulled = await swatch.screenshot();
  await page.mouse.up();
  expect(Buffer.compare(still, pulled)).not.toBe(0);

  // each mode shows its own picture (block, ball, rod), and the page says which one is on
  const pictures: Buffer[] = [];
  for (let i = 1; i <= 3; i++) {
    await modes.nth(i).click();
    await expect(modes.nth(i)).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(3000);
    pictures.push(await swatch.screenshot());
  }
  expect(new Set(pictures.map((p) => p.toString("base64"))).size).toBe(3);

  // choosing another color recolors the cloth without building a new scene
  await page.evaluate(() => { (document.querySelector('[data-testid="cloth-swatch"] canvas') as HTMLElement & { __kept?: boolean }).__kept = true; });
  const colors = page.locator('[role="group"] button[aria-pressed]');
  if ((await colors.count()) > 1) {
    const before = await swatch.screenshot();
    await colors.nth(1).click();
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (document.querySelector('[data-testid="cloth-swatch"] canvas') as (HTMLElement & { __kept?: boolean }) | null)?.__kept)).toBe(true);
    expect(Buffer.compare(before, await swatch.screenshot())).not.toBe(0);
  }

  await expect(page.getByText(/Faites glisser le tissu/)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  expect(problems).toEqual([]);
});

test("leaving the fabric page releases the 3D context (no leak when you come back and forth)", async ({ page }) => {
  test.setTimeout(150_000);
  const warnings: string[] = [];
  page.on("console", (m) => { if (/too many active webgl contexts/i.test(m.text())) warnings.push(m.text()); });
  for (let i = 0; i < 3; i++) {
    await page.goto("/fr/catalog/linen-plain-160");
    await page.getByRole("tab").nth(1).click();
    await expect(page.getByTestId("cloth-swatch")).toHaveAttribute("data-ready", "true", { timeout: 90_000 });
    await page.getByRole("tab").nth(0).click(); // back to the details: the scene is torn down
    await expect(page.getByTestId("cloth-swatch")).toHaveCount(0);
  }
  expect(warnings).toEqual([]);
});
