import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { deltaE00, hexToLab } from "@/lib/color/lab";
import { resetGuestRateLimits, withDb } from "./helpers";

test.use({ locale: "fr-FR" });
test.beforeAll(resetGuestRateLimits);

const solid = (hex: string, size = 600) => sharp({ create: { width: size, height: size, channels: 3, background: hex } }).png().toBuffer();

test("a photo dropped on the page finds fabrics of its color, shows the photo to its owner and keeps it private", async ({ page, browser }) => {
  await page.goto("/fr/snap");
  await expect(page.getByRole("heading", { level: 1, name: "Snap & Match" })).toBeVisible();
  await expect(page.getByTestId("snap-privacy")).toContainText("30 jours");
  await expect(page.getByTestId("snap-submit")).toHaveCount(0); // nothing to send yet

  // a drop on the zone (the real drag and drop event, with a real file)
  const png = await solid("#1F3A8A");
  const data = await page.evaluateHandle(async (bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], "navy.png", { type: "image/png" }));
    return dt;
  }, [...png]);
  await page.getByTestId("snap-drop").dispatchEvent("dragover", { dataTransfer: data });
  await expect(page.getByTestId("snap-drop")).toHaveAttribute("data-over", "true");
  await page.getByTestId("snap-drop").dispatchEvent("drop", { dataTransfer: data });
  await expect(page.getByTestId("snap-preview")).toBeVisible();
  await expect(page.getByTestId("snap-drop")).toHaveCount(0);

  await page.getByTestId("season-spring_summer").click();
  await expect(page.getByTestId("season-spring_summer")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("stretch-some").click();
  await page.getByTestId("stretch-some").click(); // pressing again clears the answer (skippable)
  await expect(page.getByTestId("stretch-some")).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("snap-submit").click();
  await expect(page).toHaveURL(/\/fr\/match\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const sessionId = page.url().split("/").pop()!;
  expect(await page.getByTestId("match-result").count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId("snap-photo")).toBeVisible(); // the owner sees the photo

  const row = await withDb(async (c) => (await c.query(
    `select s.mode, s.input->>'snapPath' as path, s.specs, i.results from public.match_sessions s join public.match_session_iterations i on i.session_id = s.id where s.id = $1`, [sessionId])).rows[0]);
  expect(row.mode).toBe("snap");
  expect(row.path).toBe(`${sessionId}.webp`);
  expect(row.specs.colors[0].hex).toMatch(/^#(1[0-9A-F]|2[0-9A-F])[0-9A-F]{2}[8-9A-F][0-9A-F]$/); // the dominant color measured on the server is the navy of the photo
  expect(row.specs.seasons).toEqual(["spring_summer"]);
  expect(row.specs.stretch).toBeNull();
  // the colors drove the ranking: most results are close to the measured dominant color (weight, structure and the rest also count, so the first one is not always the closest)
  const hexes = (row.results as { hex: string }[]).map((r) => r.hex);
  const targetHex = row.specs.colors[0].hex as string;
  const close = hexes.filter((hex) => deltaE00(hexToLab(targetHex), hexToLab(hex)) <= 8);
  expect(close.length).toBeGreaterThanOrEqual(Math.ceil(hexes.length / 2));

  const stored = await withDb(async (c) => (await c.query(`select metadata->>'mimetype' as mime from storage.objects where bucket_id = 'snap-uploads' and name = $1`, [row.path])).rows[0]);
  expect(stored.mime).toBe("image/webp");

  // anyone else with the link sees the results but not the photo
  const stranger = await browser.newContext({ locale: "fr-FR" });
  const other = await stranger.newPage();
  await other.goto(`/fr/match/${sessionId}`);
  await expect(other.getByTestId("match-results")).toBeVisible();
  await expect(other.getByTestId("snap-photo")).toHaveCount(0);
  await stranger.close();
});

test("the page refuses what is not a photo, a photo that is too big, and an unreadable image", async ({ page }) => {
  await page.goto("/fr/snap");
  await page.getByTestId("snap-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("n'est pas une photo acceptée")).toBeVisible();
  await page.getByTestId("snap-input").setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(9 * 1024 * 1024) });
  await expect(page.getByText("dépasse 8 Mo")).toBeVisible();
  await page.getByTestId("snap-input").setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("this is not really a png") });
  await expect(page.getByText("Impossible d'ouvrir cette photo")).toBeVisible();
  await expect(page.getByTestId("snap-preview")).toHaveCount(0);
});

test("the server checks the image itself, whatever the page did", async ({ request }) => {
  expect((await request.post("/api/snap", { data: { nope: true } })).status()).toBe(400);
  expect((await request.post("/api/snap", { data: { image: "data:text/html;base64,PGgxPmhpPC9oMT4=", locale: "fr" } })).status()).toBe(415);
  const fake = `data:image/png;base64,${Buffer.from("not an image at all").toString("base64")}`;
  expect((await request.post("/api/snap", { data: { image: fake, locale: "fr" } })).status()).toBe(415);
  const real = `data:image/png;base64,${(await solid("#B03030", 200)).toString("base64")}`;
  const ok = await request.post("/api/snap", { data: { image: real, locale: "en", season: "autumn_winter", stretch: "a_lot" } });
  expect(ok.status()).toBe(200);
  const events = (await ok.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string });
  expect(events.map((e) => e.type)).toContain("results");
  expect(events.at(-1)!.type).toBe("done");
});

test("the camera button, the link from the wizard and the Arabic page", async ({ page }) => {
  await page.goto("/fr/match");
  await page.getByTestId("to-snap").click();
  await expect(page).toHaveURL(/\/fr\/snap$/);
  expect(await page.getByTestId("snap-camera").getAttribute("capture")).toBe("environment");
  await page.goto("/ar/snap");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("snap-drop")).toBeVisible();
  await expect(page.getByTestId("snap-privacy")).toContainText("30");
});
