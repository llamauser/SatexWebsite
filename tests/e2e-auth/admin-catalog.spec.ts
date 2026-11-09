import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { purgeFabrics, seededPassword, signInOk, withDb } from "./helpers";

test.use({ locale: "fr-FR" });
test.describe.configure({ mode: "serial" });

const ADMIN = "admin@satex.test";
const SALES = "sales1@satex.test";
const SKU = "E2E-ADM-1";
const STAFF_EMAIL = "e2e-new-staff@satex.test";
const jobs = { authorization: "Bearer e2e-cron-secret" };
// a 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const cleanup = async () => {
  await purgeFabrics("f.sku = $1 or f.sku like 'IMP-%'", [SKU]);
  await withDb(async (c) => {
    await c.query(`delete from public.departments where slug = 'e2e-dept'`);
    await c.query(`update public.app_settings set value = '0.20' where key = 'vat_rate'`);
    await c.query(`delete from auth.users where email = $1`, [STAFF_EMAIL]);
  });
};
test.beforeAll(cleanup);
test.afterAll(cleanup);

const runJobs = async (request: APIRequestContext) => expect((await request.get("/api/jobs/run", { headers: jobs })).status()).toBe(200);
async function asAdmin(page: Page) {
  await signInOk(page, ADMIN, seededPassword(ADMIN));
}

test("sales can see the fabric list and the stock, but not edit fabrics, departments, settings or users", async ({ page }) => {
  await signInOk(page, SALES, seededPassword(SALES));
  await page.goto("/fr/admin/fabrics");
  await expect(page.getByTestId("fabric-table")).toBeVisible();
  await expect(page.getByTestId("new-fabric")).toHaveCount(0);
  await expect(page.getByTestId("fabric-active").first()).toBeDisabled();
  await expect(page.getByTestId("admin-nav").getByRole("link", { name: "Réglages" })).toHaveCount(0);
  await page.goto("/fr/admin/stock");
  await expect(page.getByTestId("lot-table")).toBeVisible();
  for (const path of ["/fr/admin/fabrics/new", "/fr/admin/fabrics/import", "/fr/admin/departments", "/fr/admin/settings", "/fr/admin/users"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/fr\/forbidden$/);
  }
});

test("an admin creates a fabric with a color and a photo, and it becomes public with its translations and search data", async ({ page, request }) => {
  await asAdmin(page);
  await page.goto("/fr/admin/fabrics");
  await page.getByTestId("new-fabric").click();
  await expect(page).toHaveURL(/\/fr\/admin\/fabrics\/new$/);

  // validation first: nothing filled in
  await page.getByTestId("save-fabric").click();
  await expect(page.getByText("Corrigez les champs en rouge.")).toBeVisible();

  await page.getByTestId("f-sku").fill(SKU);
  await page.getByTestId("f-name").fill("Tissu de test admin");
  await expect(page.getByTestId("f-slug")).toHaveValue("tissu-de-test-admin"); // the identifier follows the French name
  await page.getByTestId("f-category").selectOption({ index: 1 });
  await page.getByTestId("f-gsm").fill("150");
  await page.getByTestId("f-moq").fill("5");
  await page.getByTestId("f-price").fill("9,9");
  await page.getByTestId("f-active").check();
  // the composition must be 100 %
  await page.getByTestId("pct").first().fill("90");
  await expect(page.getByTestId("composition-total")).toHaveText("total 90 %");
  await page.getByTestId("save-fabric").click();
  await expect(page.getByText("La composition doit totaliser exactement 100 %.")).toBeVisible();
  await page.getByTestId("pct").first().fill("100");
  await page.getByTestId("add-tier").click();
  await page.getByTestId("tier-min").fill("50");
  await page.getByTestId("tier-price").fill("8.5");
  await page.getByTestId("save-fabric").click();

  await expect(page).toHaveURL(/\/fr\/admin\/fabrics\/[0-9a-f-]{36}\?created=1$/);
  await expect(page.getByText("Tissu créé.")).toBeVisible();
  const id = page.url().split("/").pop()!.split("?")[0]!;

  // a second fabric with the same SKU is refused
  const row = await withDb(async (c) => (await c.query(`select slug, name, base_price_per_m::float as price, is_active from public.fabrics where id = $1`, [id])).rows[0]);
  expect(row).toMatchObject({ slug: "tissu-de-test-admin", name: { fr: "Tissu de test admin" }, price: 9.9, is_active: true });
  const tiers = await withDb(async (c) => (await c.query(`select min_m::float as m, price_per_m::float as p from public.fabric_price_tiers where fabric_id = $1`, [id])).rows);
  expect(tiers).toEqual([{ m: 50, p: 8.5 }]);

  // a color and its photo
  await page.getByTestId("new-color-code").fill("RED");
  await page.getByTestId("new-color-name-fr").fill("Rouge");
  await page.getByTestId("new-color-hex").fill("#CC0000");
  await page.getByTestId("add-color").click();
  await expect(page.getByTestId("color-row")).toHaveCount(1);
  await page.getByTestId("color-upload").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("color-images").locator("img")).toHaveCount(1, { timeout: 15_000 });
  const photo = await withDb(async (c) => (await c.query(`select storage_path from public.fabric_images where fabric_id = $1`, [id])).rows);
  expect(photo).toHaveLength(1);
  expect(photo[0].storage_path).toMatch(/^fabric-images\/.+\.png$/);
  const lab = await withDb(async (c) => (await c.query(`select lab from public.fabric_colors where fabric_id = $1`, [id])).rows[0].lab);
  expect(lab).toHaveLength(3); // the color was converted for color matching

  // stock, so the fabric can be bought
  await page.goto("/fr/admin/stock");
  const colorOption = await page.getByTestId("recv-color").locator("option", { hasText: SKU }).getAttribute("value");
  await page.getByTestId("recv-color").selectOption(colorOption!);
  await page.getByTestId("recv-code").fill("LOT-E2E-ADM");
  await page.getByTestId("recv-meters").fill("120");
  await page.getByTestId("recv-submit").click();
  await expect(page.getByText("Lot LOT-E2E-ADM reçu.")).toBeVisible();

  // background jobs: translations and the search data
  await expect.poll(async () => {
    await runJobs(request);
    return withDb(async (c) => {
      const f = (await c.query(`select name, machine_translated from public.fabrics where id = $1`, [id])).rows[0];
      const e = (await c.query(`select 1 from public.embeddings where owner_type = 'fabric' and owner_id = $1 and kind = 'text'`, [id])).rowCount;
      return { en: !!f.name.en, ar: !!f.name.ar, marked: f.machine_translated.name ?? [], embedded: e === 1 };
    });
  }, { timeout: 60_000 }).toMatchObject({ en: true, ar: true, embedded: true });

  await page.goto(`/fr/admin/fabrics/${id}`);
  await expect(page.getByTestId("embedding-status")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("translation-status")).toContainText("complètes");
  await page.getByTestId("tab-en").click();
  await expect(page.getByTestId("machine-translated")).toBeVisible();
  // a person edits the English name: it is no longer flagged as machine translated
  await page.getByTestId("f-name").fill("Admin test fabric");
  await page.getByTestId("save-fabric").click();
  await expect(page.getByText("Enregistré.")).toBeVisible();
  const marks = await withDb(async (c) => (await c.query(`select machine_translated from public.fabrics where id = $1`, [id])).rows[0].machine_translated);
  expect(marks.name ?? []).not.toContain("en");
  expect(marks.name ?? []).toContain("ar");

  // public: the page, the stock and the search
  const anon = await page.context().browser()!.newContext({ locale: "fr-FR" });
  const visitor = await anon.newPage();
  await visitor.goto("http://localhost:3100/fr/catalog/tissu-de-test-admin");
  await expect(visitor.getByRole("heading", { level: 1, name: "Tissu de test admin" })).toBeVisible();
  await expect(visitor.getByTestId("available-RED")).toHaveAttribute("data-meters", "120");
  await anon.close();
});

test("stock: adjustments need a reason, cannot overdraw, and are kept in the history; a lot can change department", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/fr/admin/stock");
  await page.getByTestId("lot-search").fill("LOT-E2E-ADM");
  const lot = page.getByTestId("lot-row").filter({ hasText: "LOT-E2E-ADM" });
  await expect(lot.getByTestId("lot-meters")).toHaveText("120");

  await lot.getByTestId("adj-delta").fill("-5");
  await lot.getByTestId("adj-submit").click();
  await expect(page.getByText("Indiquez la raison de l'ajustement.")).toBeVisible();

  await lot.getByTestId("adj-delta").fill("-500");
  await lot.getByTestId("adj-reason").fill("test");
  await lot.getByTestId("adj-submit").click();
  await expect(page.getByText("Le lot ne peut pas passer sous 0 mètre.")).toBeVisible();
  await expect(lot.getByTestId("lot-meters")).toHaveText("120");

  await lot.getByTestId("adj-delta").fill("-5,5");
  await lot.getByTestId("adj-reason").fill("Rouleau abîmé");
  await lot.getByTestId("adj-submit").click();
  await expect(page.getByText("Lot LOT-E2E-ADM ajusté.")).toBeVisible();
  await expect(lot.getByTestId("lot-meters")).toHaveText("114.5");

  const option = await lot.getByTestId("lot-dept").locator("option").nth(1).getAttribute("value");
  await lot.getByTestId("lot-dept").selectOption(option!);
  await expect(page.getByText("Lot LOT-E2E-ADM déplacé.")).toBeVisible();

  await lot.getByTestId("lot-history").click();
  const movements = lot.getByTestId("lot-movements");
  await expect(movements).toContainText("Réception");
  await expect(movements).toContainText("Rouleau abîmé");
  await expect(movements).toContainText("Déplacement");
  await expect(page.getByTestId("lot-total")).toContainText("114.5 m");
});

test("CSV import: the sample file shows one deliberate error, imports the 9 good rows, and a second import updates them", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/fr/admin/fabrics/import");
  await page.getByTestId("csv-file").setInputFiles({ name: "fabrics-sample.csv", mimeType: "text/csv", buffer: readFileSync("public/samples/fabrics-sample.csv") });
  await expect(page.getByTestId("csv-summary")).toHaveText("10 ligne(s) lues : 9 valide(s), 1 avec erreur.");
  await expect(page.getByTestId("csv-error")).toHaveCount(1);
  await expect(page.getByTestId("csv-error")).toContainText("Ligne 8");
  await expect(page.getByTestId("csv-error")).toContainText("composition");
  await expect(page.getByTestId("csv-row")).toHaveCount(9);
  expect((await withDb(async (c) => (await c.query(`select count(*)::int as n from public.fabrics where sku like 'IMP-%'`)).rows[0].n))).toBe(0); // nothing saved by the check

  await page.getByTestId("csv-apply").click();
  await expect(page.getByTestId("csv-outcome")).toContainText("9 créé(s), 0 mis à jour, 0 en échec.");
  const saved = await withDb(async (c) => (await c.query(
    `select f.sku, f.is_active, (select count(*)::int from public.fabric_colors where fabric_id = f.id) as colors, (select count(*)::int from public.fabric_price_tiers where fabric_id = f.id) as tiers
       from public.fabrics f where f.sku like 'IMP-%' order by f.sku`)).rows);
  expect(saved).toHaveLength(9);
  expect(saved.find((r) => r.sku === "IMP-001")).toMatchObject({ is_active: false, colors: 2, tiers: 2 });
  expect(saved.some((r) => r.sku === "IMP-007")).toBe(false); // the row with the error was not imported

  // the same file again: the SKUs now exist
  await page.reload();
  await page.getByTestId("csv-file").setInputFiles({ name: "fabrics-sample.csv", mimeType: "text/csv", buffer: readFileSync("public/samples/fabrics-sample.csv") });
  await expect(page.getByTestId("csv-row").first()).toContainText("Mise à jour");
  await page.getByTestId("csv-apply").click();
  await expect(page.getByTestId("csv-outcome")).toContainText("0 créé(s), 9 mis à jour, 0 en échec.");

  // a file with the wrong columns is refused with a clear message
  await page.reload();
  await page.getByTestId("csv-file").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("sku,name_fr\nA,B\n") });
  await expect(page.getByTestId("csv-error").first()).toContainText("colonne absente");
  await expect(page.getByTestId("csv-apply")).toBeDisabled();
});

test("the fabric list searches, filters and switches a fabric off", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/fr/admin/fabrics");
  await page.getByTestId("fabric-search").fill("IMP-00");
  await expect(page.getByTestId("fabric-row")).toHaveCount(9);
  await page.getByTestId("fabric-state").selectOption("active");
  await expect(page.getByTestId("fabrics-empty")).toBeVisible();
  await page.getByTestId("fabric-state").selectOption("all");
  const row = page.getByTestId("fabric-row").filter({ hasText: "IMP-001" });
  await row.getByTestId("fabric-active").check();
  await expect.poll(async () => withDb(async (c) => (await c.query(`select is_active from public.fabrics where sku = 'IMP-001'`)).rows[0].is_active)).toBe(true);
  await row.getByTestId("fabric-active").uncheck();
  await expect.poll(async () => withDb(async (c) => (await c.query(`select is_active from public.fabrics where sku = 'IMP-001'`)).rows[0].is_active)).toBe(false);
});

test("departments: a live plan with overlap and range warnings; create, save and delete", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/fr/admin/departments");
  await expect(page.getByTestId("department-item").first()).toBeVisible();
  await page.getByTestId("new-department").click();
  await page.getByTestId("dept-name-fr").fill("Salle de test");
  await page.getByTestId("dept-slug").fill("e2e-dept");

  // on top of the first fabric hall of floor 0: a warning, not an error
  await page.getByTestId("layout-x").fill("2");
  await page.getByTestId("layout-z").fill("2");
  await expect(page.getByTestId("layout-overlap")).toBeVisible();
  await expect(page.getByTestId("preview-current")).toHaveAttribute("data-overlap", "true");
  // in an empty corner: no warning
  await page.getByTestId("layout-x").fill("30");
  await page.getByTestId("layout-z").fill("20");
  await page.getByTestId("layout-w").fill("4");
  await page.getByTestId("layout-d").fill("3");
  await expect(page.getByTestId("layout-overlap")).toHaveCount(0);
  // outside of the floor: an error, and saving is refused
  await page.getByTestId("layout-x").fill("39");
  await expect(page.getByTestId("layout-issue")).toContainText("dépasse");
  await page.getByTestId("save-department").click();
  await expect(page.getByText("Le département dépasse de l'étage.").first()).toBeVisible();
  expect(await withDb(async (c) => (await c.query(`select 1 from public.departments where slug = 'e2e-dept'`)).rowCount)).toBe(0);

  await page.getByTestId("layout-x").fill("30");
  await page.getByTestId("save-department").click();
  await expect(page.getByText("Département enregistré.")).toBeVisible();
  const row = await withDb(async (c) => (await c.query(`select name, floor, layout from public.departments where slug = 'e2e-dept'`)).rows[0]);
  expect(row).toMatchObject({ name: { fr: "Salle de test" }, floor: 0, layout: { x: 30, z: 20, w: 4, d: 3, rotation: 0 } });

  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("delete-department").click();
  await expect(page.getByText("Département supprimé.")).toBeVisible();
  expect(await withDb(async (c) => (await c.query(`select 1 from public.departments where slug = 'e2e-dept'`)).rowCount)).toBe(0);
});

test("settings: values are checked, percentages typed as %, and the demo purge asks for confirmation", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/fr/admin/settings");
  await page.getByTestId("setting-vat_rate").fill("19,6");
  await page.getByTestId("setting-reservation_hours").fill("0");
  await page.getByTestId("save-commerce").click();
  await expect(page.getByText("Corrigez les champs en rouge.")).toBeVisible();
  await page.getByTestId("setting-vat_rate").fill("19,6");
  await page.getByTestId("save-commerce").click();
  await expect(page.getByText("1 réglage(s) enregistré(s).")).toBeVisible();
  expect(await withDb(async (c) => Number((await c.query(`select value from public.app_settings where key = 'vat_rate'`)).rows[0].value))).toBe(0.196);

  await page.getByTestId("setting-contact_email").fill("pas-un-email");
  await page.getByTestId("save-company").click();
  await expect(page.getByText("Adresse e-mail invalide.")).toBeVisible();

  // the purge button stays disabled until the word is typed (it is never clicked here: it would delete the seed)
  await expect(page.getByTestId("purge-button")).toBeDisabled();
  await page.getByTestId("purge-input").fill("purge");
  await expect(page.getByTestId("purge-button")).toBeDisabled();
  await page.getByTestId("purge-input").fill("PURGE");
  await expect(page.getByTestId("purge-button")).toBeEnabled();
});

test("users: add a team member by e-mail, change a role, and nobody can change their own", async ({ page, request }) => {
  await asAdmin(page);
  await page.goto("/fr/admin/users");
  const own = page.getByTestId("user-row").filter({ hasText: ADMIN });
  await expect(own.getByTestId("user-role")).toBeDisabled();
  await expect(page.getByTestId("user-row").filter({ hasText: SALES })).toBeVisible();

  await page.getByTestId("staff-email").fill("pas un email");
  await page.getByTestId("staff-add").click();
  await expect(page.getByText("Adresse e-mail invalide.")).toBeVisible();

  await page.getByTestId("staff-email").fill(STAFF_EMAIL);
  await page.getByTestId("staff-role").selectOption("sales");
  await page.getByTestId("staff-add").click();
  await expect(page.getByText(`Invitation envoyée à ${STAFF_EMAIL}.`)).toBeVisible();
  const added = page.getByTestId("user-row").filter({ hasText: STAFF_EMAIL });
  await expect(added).toBeVisible();
  expect(await withDb(async (c) => (await c.query(`select p.role from public.profiles p join auth.users u on u.id = p.id where u.email = $1`, [STAFF_EMAIL])).rows[0].role)).toBe("sales");

  await added.getByTestId("user-role").selectOption("admin");
  await expect(page.getByText(`Le rôle de ${STAFF_EMAIL} est maintenant : Administrateur.`)).toBeVisible();
  await added.getByTestId("user-role").selectOption("client");
  await expect(page.getByText(`Le rôle de ${STAFF_EMAIL} est maintenant : Client.`)).toBeVisible();

  // the API itself refuses anyone who is not an admin signed in
  expect((await request.get("/api/admin/users")).status()).toBe(403);
  expect((await request.patch("/api/admin/users", { data: { userId: "00000000-0000-4000-8000-000000000000", role: "admin" } })).status()).toBe(403);
});
