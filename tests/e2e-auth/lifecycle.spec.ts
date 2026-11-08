import { expect, test } from "@playwright/test";
import { signIn, uniqueEmail, waitForAuthLink, withDb } from "./helpers";

test.use({ locale: "fr-FR" });
test.describe.configure({ mode: "serial" });

const email = uniqueEmail("life");
const password = "first-password-123";
const newPassword = "second-password-456";
let since = 0;

test("sign up requires email confirmation, then lands in the account", async ({ page }) => {
  since = Date.now() - 2000;
  await page.goto("/fr/auth/sign-up");
  await page.getByLabel("Nom complet").fill("Test Lifecycle");
  await page.getByLabel("Société").fill("Lifecycle SARL");
  await page.getByLabel("E-mail professionnel").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByLabel("Téléphone (facultatif)").fill("+33 1 23 45 67 89");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByRole("heading", { name: "Vérifiez votre boîte mail" })).toBeVisible();

  // not signed in yet: the account is protected until the email is confirmed
  await page.goto("/fr/account");
  await expect(page).toHaveURL(/\/fr\/auth\/sign-in/);

  await page.goto(await waitForAuthLink(email, since));
  await expect(page).toHaveURL(/\/fr\/account$/);
  await expect(page.getByTestId("account-greeting")).toContainText("Test Lifecycle");

  // profile + client rows were created by the database trigger, role is always 'client'
  const row = await withDb(async (c) =>
    (await c.query(
      `select p.role, p.phone, p.preferred_locale, c.company_name from public.profiles p
         join public.clients c on c.id = p.client_id join auth.users u on u.id = p.id where u.email = $1`, [email])).rows[0],
  );
  expect(row).toMatchObject({ role: "client", phone: "+33 1 23 45 67 89", preferred_locale: "fr", company_name: "Lifecycle SARL" });
});

test("the profile and addresses can be edited and are saved", async ({ page }) => {
  await signIn(page, email, password);
  await expect(page).toHaveURL(/\/fr\/account$/);
  await page.goto("/fr/account/profile");

  await page.getByLabel("Site web").fill("https://lifecycle.example.com");
  await page.getByLabel("Pays", { exact: true }).first().fill("France");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Modifications enregistrées.")).toBeVisible();

  const billing = page.getByTestId("address-billing");
  await billing.getByLabel("Adresse", { exact: true }).fill("12 rue des Tissus");
  await billing.getByLabel("Ville").fill("Lyon");
  await billing.getByLabel("Code postal").fill("69002");
  await billing.getByLabel("Pays").fill("France");
  await billing.getByRole("button", { name: "Enregistrer l'adresse" }).click();
  await expect(billing.getByText("Adresse enregistrée.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Site web")).toHaveValue("https://lifecycle.example.com");
  await expect(page.getByTestId("address-billing").getByLabel("Ville")).toHaveValue("Lyon");

  // invalid input is rejected client-side
  await page.getByLabel("Site web").fill("not a url");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Adresse web invalide (https://…).")).toBeVisible();
});

test("the profile page only ever shows the signed-in user's own data", async ({ page }) => {
  await signIn(page, email, password);
  await page.goto("/fr/account/profile");
  await expect(page.getByLabel("E-mail", { exact: true })).toHaveValue(email);
  await expect(page.getByLabel("Nom de la société")).toHaveValue("Lifecycle SARL");
});

test("password reset by email, then sign in with the new password", async ({ page }) => {
  since = Date.now() - 2000;
  await page.goto("/fr/auth/reset");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Envoyer le lien" }).click();
  await expect(page.getByText("Si un compte existe pour cette adresse")).toBeVisible();

  await page.goto(await waitForAuthLink(email, since));
  await expect(page).toHaveURL(/\/fr\/auth\/reset\?step=new/);
  await page.locator('input[name="password"]').fill("short");
  await page.locator('input[name="confirm"]').fill("short");
  await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
  await expect(page.getByText("Au moins 10 caractères.").last()).toBeVisible();

  await page.locator('input[name="password"]').fill(newPassword);
  await page.locator('input[name="confirm"]').fill(newPassword);
  await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
  await expect(page.getByText("Mot de passe mis à jour.")).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, email, password);
  await expect(page.getByRole("alert")).toContainText("incorrect"); // old password no longer works
  await signIn(page, email, newPassword);
  await expect(page).toHaveURL(/\/fr\/account$/);
});

test("magic link sign-in", async ({ page }) => {
  since = Date.now() - 2000;
  await page.context().clearCookies();
  await page.goto("/fr/auth/sign-in");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un lien de connexion par e-mail" }).click();
  await expect(page.getByText(`un lien de connexion vient d'être envoyé`)).toBeVisible();
  await page.goto(await waitForAuthLink(email, since));
  await expect(page).toHaveURL(/\/fr\/account$/);
  await expect(page.getByTestId("account-greeting")).toContainText("Test Lifecycle");
});

test("change password from the profile page", async ({ page }) => {
  await signIn(page, email, newPassword);
  await page.goto("/fr/account/profile");
  const form = page.getByTestId("password-form");
  await form.locator('input[name="password"]').fill("third-password-789");
  await form.locator('input[name="confirm"]').fill("third-password-789");
  await form.getByRole("button", { name: "Mettre à jour" }).click();
  await expect(form.getByText("Mot de passe mis à jour.")).toBeVisible();
});

test("account deletion can be requested and cancelled", async ({ page }) => {
  await signIn(page, email, "third-password-789");
  await page.goto("/fr/account/profile");
  await page.getByTestId("deletion-request").click();
  await page.getByTestId("deletion-confirm").click();
  await expect(page.getByText("Demande de suppression enregistrée.")).toBeVisible();
  const pending = await withDb(async (c) =>
    (await c.query(`select p.deletion_requested_at from public.profiles p join auth.users u on u.id = p.id where u.email = $1`, [email])).rows[0].deletion_requested_at);
  expect(pending).not.toBeNull();

  await page.goto("/fr/account");
  await expect(page.getByText("Votre demande de suppression de compte est en cours de traitement.")).toBeVisible();

  await page.goto("/fr/account/profile");
  await page.getByTestId("deletion-cancel").click();
  await expect(page.getByTestId("deletion-request")).toBeVisible();
});
