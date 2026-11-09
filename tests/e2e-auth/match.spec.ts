import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { seededPassword, signInOk, withDb } from "./helpers";

test.use({ locale: "fr-FR" });
test.describe.configure({ mode: "serial" });

interface Card {
  colorId: string; sku: string; slug: string; pct: number; structure: string; gsm: number; stretch: string; uses: string[];
  composition: { fiber: string; pct: number }[]; explanation: string; availableM: number;
}
interface Event { type: string; sessionId?: string; results?: Card[]; stage?: string; code?: string }

let ipCounter = 0;

async function match(api: APIRequestContext, description: string, extra: Record<string, unknown> = {}, locale = "fr", ip = `10.${ipCounter++ % 250}.${Date.now() % 250}.${Math.floor(Math.random() * 250)}`) {
  const { sessionId, refinements, input, ...rest } = extra as { sessionId?: string; refinements?: string[]; input?: Record<string, unknown> };
  const res = await api.post("/api/match", {
    headers: { "x-forwarded-for": ip },
    data: { input: { description, ...(input ?? {}), ...rest }, locale, sessionId, refinements },
  });
  const text = await res.text();
  const events = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Event);
  return { status: res.status(), events, results: events.find((e) => e.type === "results")?.results ?? [], sessionId: events.find((e) => e.type === "done")?.sessionId, ip };
}

test("the API streams progress, results and a final 'done' event, and saves the session", async ({ request }) => {
  const r = await match(request, "Jersey respirant pour une collection de sport d'été, environ 200 GSM.");
  expect(r.status).toBe(200);
  expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(["progress", "results", "done"]));
  expect(r.events.filter((e) => e.type === "progress").map((e) => e.stage)).toEqual(expect.arrayContaining(["understanding", "searching", "ranking"]));
  expect(r.results.length).toBeGreaterThanOrEqual(3);
  expect(r.results.length).toBeLessThanOrEqual(5);
  const pcts = r.results.map((c) => c.pct);
  expect(pcts).toEqual([...pcts].sort((a, b) => b - a)); // best first
  expect(pcts.every((p) => p > 0 && p <= 99)).toBe(true);
  for (const c of r.results) expect(c.explanation.length).toBeGreaterThan(20);
  expect(new Set(r.results.map((c) => c.slug)).size).toBeGreaterThanOrEqual(3); // variety

  const row = await withDb(async (c) => (await c.query(
    `select s.input, s.specs, s.user_id, s.session_token, i.n, jsonb_array_length(i.results) as n_results, i.latency_ms
       from public.match_sessions s join public.match_session_iterations i on i.session_id = s.id where s.id = $1`, [r.sessionId])).rows[0]);
  expect(row.input.description).toContain("Jersey respirant");
  expect(row.specs).toMatchObject({ construction: "knit", structures: ["jersey"], uses: ["activewear"], gsm_min: 170, gsm_max: 230 });
  expect(row).toMatchObject({ n: 1, user_id: null });
  expect(row.session_token).toMatch(/^[0-9a-f-]{36}$/);
  expect(row.n_results).toBe(r.results.length);
  expect(row.latency_ms).toBeGreaterThanOrEqual(0);
});

test("a vague or invalid request is refused with a clear error", async ({ request }) => {
  const bad = await request.post("/api/match", { data: { input: { description: "short" }, locale: "fr" } });
  expect(bad.status()).toBe(400);
  const worse = await request.post("/api/match", { data: { nonsense: true } });
  expect(worse.status()).toBe(400);
});

test("a visitor can ask at most 10 times an hour; the 11th is refused with 429", async () => {
  const api = await pwRequest.newContext({ baseURL: "http://localhost:3100" });
  const ip = `198.51.100.${Math.floor(Math.random() * 250)}`;
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) statuses.push((await match(api, `Popeline de coton pour chemises numéro ${i}`, {}, "fr", ip)).status);
  expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
  expect(statuses[10]).toBe(429);
  await api.dispose();
});

test("refinements work on the owner's session only, and are cumulative", async ({ request }) => {
  const first = await match(request, "Jersey de coton pour t-shirts d'été, 180 GSM");
  const id = first.sessionId!;
  const lighter = await match(request, "Jersey de coton pour t-shirts d'été, 180 GSM", { sessionId: id, refinements: ["lighter"] });
  expect(lighter.status).toBe(200);
  expect(lighter.sessionId).toBe(id);
  const both = await match(request, "Jersey de coton pour t-shirts d'été, 180 GSM", { sessionId: id, refinements: ["lighter", "other_colors"] });
  const shownBefore = new Set(lighter.results.map((c) => c.colorId));
  expect(both.results.some((c) => shownBefore.has(c.colorId))).toBe(false); // "other colors" never repeats what was shown

  const rows = await withDb(async (c) => (await c.query(`select n, refinements, specs from public.match_session_iterations where session_id = $1 order by n`, [id])).rows);
  expect(rows.map((r) => r.n)).toEqual([1, 2, 3]);
  expect(rows[1].refinements).toEqual(["lighter"]);
  expect(rows[1].specs).toMatchObject({ gsm_min: 122, gsm_max: 166 }); // 180 GSM +/-15% = 153–207, lighter = x 0.8
  expect(rows[2].refinements).toEqual(["lighter", "other_colors"]);

  // somebody else (no cookie) cannot refine it
  const stranger = await pwRequest.newContext({ baseURL: "http://localhost:3100" });
  const denied = await match(stranger, "Jersey de coton pour t-shirts d'été, 180 GSM", { sessionId: id, refinements: ["cheaper"] });
  expect(denied.status).toBe(403);
  await stranger.dispose();
});

/** 15 briefs in 3 languages. Each is satisfied when one of the first 3 results has the expected property. */
const GOLDEN: [string, (c: Card) => boolean][] = [
  ["Breathable jersey for a summer activewear line, ~200 GSM.", (c) => c.structure === "jersey" && c.uses.includes("activewear") && c.gsm >= 150 && c.gsm <= 260],
  ["Denim stretch 400 GSM pour des jeans", (c) => c.structure === "denim" && c.gsm >= 300 && c.gsm <= 500],
  ["Lin léger pour chemises d'été", (c) => c.composition.some((f) => f.fiber === "linen" && f.pct >= 50)],
  ["Satin de soie pour robe de soirée", (c) => c.structure === "satin"],
  ["Gabardine en laine pour costume d'hiver", (c) => c.composition.some((f) => f.fiber === "wool" && f.pct >= 50)],
  ["Velours pour un canapé, ameublement", (c) => c.structure === "velvet" && c.uses.includes("upholstery")],
  ["قماش قطن ناعم للأطفال", (c) => c.uses.includes("kidswear")],
  ["Polo piqué coton pour l'été", (c) => c.structure === "pique"],
  ["Doublure légère pour une veste", (c) => c.uses.includes("linings")],
  ["Mesh polyester respirant pour le sport, 140 GSM", (c) => c.structure === "mesh"],
  ["Molleton gratté pour sweat d'hiver, 300 GSM", (c) => ["fleece", "french_terry"].includes(c.structure)],
  ["Mousseline légère pour robe de soirée", (c) => c.structure === "chiffon"],
  ["Popeline de coton 110 GSM pour chemises", (c) => c.structure === "poplin" && c.gsm >= 90 && c.gsm <= 140],
  ["Toile épaisse canvas pour sacs", (c) => c.structure === "canvas"],
  ["Heavy linen curtains for a home project", (c) => c.uses.includes("curtains")],
];

test("golden set: the expected kind of fabric is in the top 3 for at least 12 of 15 briefs", async ({ request }) => {
  let hits = 0;
  const misses: string[] = [];
  for (const [brief, expected] of GOLDEN) {
    const r = await match(request, brief);
    if (r.status === 200 && r.results.slice(0, 3).some(expected)) hits++;
    else misses.push(`${brief} -> ${r.results.slice(0, 3).map((c) => `${c.structure}/${c.gsm}`).join(", ")}`);
  }
  expect(hits, `misses:\n${misses.join("\n")}`).toBeGreaterThanOrEqual(12);
});

test("the wizard: 5 steps, scanning screen, then the results page", async ({ page }) => {
  await page.goto("/fr/match");
  await expect(page.getByTestId("wizard-question")).toHaveText("Pour qui créez-vous ?");
  await expect(page.getByTestId("wizard-next")).toBeDisabled(); // nothing chosen yet
  await page.getByTestId("chip-women").click();
  await page.getByTestId("wizard-next").click();

  await expect(page.getByTestId("wizard-question")).toHaveText("Quel style visez-vous pour votre création ?");
  await page.getByTestId("chip-sporty").click();
  await page.getByTestId("chip-technical").click();
  await page.getByTestId("wizard-next").click();

  await page.getByTestId("chip-performance").click();
  await page.getByTestId("wizard-next").click();

  await expect(page.getByTestId("wizard-question")).toHaveText("Décrivez votre projet textile");
  await page.getByTestId("wizard-description").fill("court");
  await expect(page.getByTestId("wizard-next")).toBeDisabled(); // 10 characters needed
  await page.getByTestId("wizard-description").fill("Jersey respirant pour une collection de sport d'été, environ 200 GSM.");
  await page.getByTestId("wizard-next").click();

  await expect(page.getByTestId("wizard-question")).toHaveText("Tout est prêt");
  await page.getByTestId("wizard-back").click(); // the answers survive going back
  await expect(page.getByTestId("wizard-description")).toHaveValue(/Jersey respirant/);
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("wizard-submit").click();

  await expect(page).toHaveURL(/\/fr\/match\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Nos meilleures propositions" })).toBeVisible();
  const cards = page.getByTestId("match-result");
  expect(await cards.count()).toBeGreaterThanOrEqual(3);
  await expect(cards.first().getByTestId("match-pct")).toHaveText(/\d+ % de correspondance/);
  await expect(cards.first().getByTestId("match-explanation")).not.toBeEmpty();
  await expect(page.getByTestId("spec-chips")).toContainText("170–230 g/m²");
  await expect(cards.first().getByRole("link", { name: "Demander un échantillon ou un devis" })).toHaveAttribute("href", /\/fr\/contact\?ref=SAT-/);
  await expect(cards.first().getByRole("link", { name: "Voir le tissu" })).toHaveAttribute("href", /\/fr\/catalog\//);
});

test("refine with a chip, vote, and share the link", async ({ page, browser }) => {
  // start from a session created through the page so the browser owns it
  await page.goto("/fr/match");
  await page.evaluate(() => sessionStorage.setItem("satex.match.v1", JSON.stringify({ step: 4, audience: "women", audienceText: "", styles: ["sporty"], brand: ["performance"], priceTarget: "", description: "Jersey de coton pour t-shirts d'été, 180 GSM", requiredM: "" })));
  await page.reload();
  await page.getByTestId("wizard-submit").click();
  await expect(page).toHaveURL(/\/fr\/match\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const url = page.url();
  await expect(page.getByTestId("spec-chips")).toContainText("153–207 g/m²");

  await page.getByTestId("refine-lighter").click();
  await expect(page.getByTestId("refine-lighter")).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  await expect(page.getByTestId("spec-chips")).toContainText("122–166 g/m²"); // 153–207 x 0.8
  await page.getByTestId("refine-lighter").click(); // click again: the chip is removed
  await expect(page.getByTestId("refine-lighter")).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });
  await expect(page.getByTestId("spec-chips")).toContainText("153–207 g/m²");

  await page.getByTestId("feedback-up").click();
  await expect(page.getByTestId("feedback")).toContainText("Merci pour votre retour");
  const feedback = await withDb(async (c) => (await c.query(`select feedback from public.match_sessions where id = $1`, [url.split("/").pop()])).rows[0].feedback);
  expect(feedback).toBe(1);

  // anyone with the link sees the results, but cannot refine or vote
  const other = await browser.newContext({ locale: "fr-FR" });
  const shared = await other.newPage();
  await shared.goto(url);
  await expect(shared.getByTestId("match-results")).toBeVisible();
  await expect(shared.getByTestId("refinements")).toHaveCount(0);
  await expect(shared.getByTestId("feedback")).toHaveCount(0);
  await other.close();
});

test("the results page works in Arabic (right-to-left, Latin digits)", async ({ request, page }) => {
  const r = await match(request, "قماش قطن ناعم للأطفال", {}, "ar");
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(`/ar/match/${r.sessionId}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "أفضل اقتراحاتنا" })).toBeVisible();
  await expect(page.getByTestId("match-pct").first()).toHaveText(/^تطابق \d+٪$|^تطابق \d+%$/);
  await expect(page.getByTestId("match-results")).not.toContainText(/[٠-٩]/);
});

test("an unknown session is a 404", async ({ page }) => {
  expect((await page.goto("/fr/match/00000000-0000-4000-8000-000000000000"))?.status()).toBe(404);
});

test("the AI log is for admins only and lists the searches", async ({ page }) => {
  await signInOk(page, "sales1@satex.test", seededPassword("sales1@satex.test"));
  await page.goto("/fr/admin/match-logs");
  await expect(page).toHaveURL(/\/fr\/forbidden$/);
  await page.getByTestId("account-menu-button").click();
  await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/fr$/);

  await signInOk(page, "admin@satex.test", seededPassword("admin@satex.test"));
  await page.goto("/fr/admin/match-logs");
  await expect(page.getByRole("heading", { level: 1, name: "Journal de la recherche IA" })).toBeVisible();
  expect(await page.getByTestId("match-log-table").locator("tbody tr").count()).toBeGreaterThan(5);
  await expect(page.getByTestId("match-log-table")).toContainText("Jersey respirant");
});

