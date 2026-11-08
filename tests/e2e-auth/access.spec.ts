import { expect, test } from "@playwright/test";
import { expectSignedOut, seededPassword, signIn, signInOk } from "./helpers";

test.use({ locale: "fr-FR" });

test("a guest is sent to sign-in and returned to the page afterwards", async ({ page }) => {
  await page.goto("/fr/account/profile");
  await expect(page).toHaveURL(/\/fr\/auth\/sign-in\?next=%2Ffr%2Faccount%2Fprofile/);

  await page.locator('input[name="email"]').fill("client1@satex.test");
  await page.locator('input[name="password"]').fill(seededPassword("client1@satex.test"));
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/fr\/account\/profile$/);
  await expect(page.getByRole("heading", { level: 1, name: "Mon profil" })).toBeVisible();
});

test("wrong password shows an error and stays on the page", async ({ page }) => {
  await signIn(page, "client1@satex.test", "definitely-wrong-password");
  await expect(page.getByText("E-mail ou mot de passe incorrect.")).toBeVisible();
  await expect(page).toHaveURL(/\/fr\/auth\/sign-in/);
});

test("form validation messages are shown without calling the server", async ({ page }) => {
  await page.goto("/fr/auth/sign-in");
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByText("Ce champ est obligatoire.").first()).toBeVisible();
  await page.locator('input[name="email"]').fill("not-an-email");
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByText("Adresse e-mail invalide.")).toBeVisible();
  await page.goto("/fr/auth/sign-up");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByText("Vous devez accepter les conditions.")).toBeVisible();
});

test("a client signs in, sees their account, and signs out", async ({ page }) => {
  await signIn(page, "client1@satex.test", seededPassword("client1@satex.test"));
  await expect(page).toHaveURL(/\/fr\/account$/);
  await expect(page.getByTestId("account-greeting")).toContainText("Nour Haddad");

  await page.getByTestId("account-menu-button").click();
  await expect(page.getByTestId("account-email")).toHaveText("client1@satex.test");
  await expect(page.getByRole("menuitem", { name: "Back-office" })).toHaveCount(0); // clients never see the admin link

  await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/fr$/);
  await expectSignedOut(page);
});

test("a signed-in user is redirected away from the sign-in page", async ({ page }) => {
  await signInOk(page, "client2@satex.test", seededPassword("client2@satex.test"));
  await page.goto("/fr/auth/sign-in");
  await expect(page).toHaveURL(/\/fr\/account$/);
});

test("a client gets 'access denied' on /admin; sales staff get in", async ({ page }) => {
  await signInOk(page, "client3@satex.test", seededPassword("client3@satex.test"));
  await page.goto("/fr/admin");
  await expect(page).toHaveURL(/\/fr\/forbidden$/);
  await expect(page.getByRole("heading", { level: 1, name: "Accès refusé" })).toBeVisible();
  await page.getByTestId("account-menu-button").click();
  await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/fr$/); // wait for the sign-out navigation before signing in again

  await signInOk(page, "sales1@satex.test", seededPassword("sales1@satex.test"));
  await page.getByTestId("account-menu-button").click();
  await expect(page.getByRole("menuitem", { name: "Back-office" })).toBeVisible();
  await page.goto("/fr/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Back-office" })).toBeVisible();
});

test("admin area redirects guests to sign-in", async ({ page }) => {
  await page.goto("/en/admin");
  await expect(page).toHaveURL(/\/en\/auth\/sign-in\?next=%2Fen%2Fadmin/);
});

test("Arabic sign-in page is right-to-left and translated", async ({ page }) => {
  await page.goto("/ar/auth/sign-in");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "تسجيل الدخول" })).toBeVisible();
  await signInOk(page, "client2@satex.test", seededPassword("client2@satex.test"), "ar");
  await expect(page.getByTestId("account-greeting")).toContainText("Lina Berrada");
});
