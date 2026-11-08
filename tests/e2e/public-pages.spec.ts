import { expect, test } from "@playwright/test";

test.use({ locale: "fr-FR" });

test.describe("home page", () => {
  test("shows the hero, the three value propositions, the showroom teaser and the contact call to action", async ({ page }) => {
    await page.goto("/fr");
    await expect(page.getByRole("heading", { level: 1, name: "Arrêtez de deviner." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Lancer la recherche" })).toHaveAttribute("href", "/fr/match");
    await expect(page.getByRole("link", { name: "Explorer le catalogue" })).toHaveAttribute("href", "/fr/catalog");
    for (const title of ["Recherche par IA", "Stock en temps réel", "Showroom 3D"]) {
      await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Entrez dans le showroom SATEX en 3D" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Expert textile depuis 1995/ }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Demandez un échantillon ou un devis" })).toBeVisible();
  });

  test("the call-to-action buttons lead to working pages", async ({ page }) => {
    await page.goto("/fr");
    await page.getByRole("link", { name: "Lancer la recherche" }).click();
    await expect(page).toHaveURL(/\/fr\/match$/);
    await expect(page.getByRole("heading", { level: 1, name: "Recherche IA" })).toBeVisible();
    await page.goto("/fr");
    await page.getByRole("link", { name: "Nous contacter" }).click();
    await expect(page).toHaveURL(/\/fr\/contact$/);
  });
});

test.describe("navigation and footer", () => {
  test("every header link opens a page (no dead links)", async ({ page, isMobile }) => {
    for (const [label, path] of [["Catalogue", "catalog"], ["Recherche IA", "match"], ["Showroom", "showroom"], ["À propos", "about"], ["Contact", "contact"]] as const) {
      await page.goto("/fr");
      if (isMobile) await page.getByTestId("mobile-nav-toggle").click();
      const nav = page.getByRole("navigation", { name: "Navigation principale" }).filter({ visible: true });
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/fr/${path}$`));
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      const res = await page.request.get(`/fr/${path}`);
      expect(res.status()).toBe(200);
    }
  });

  test("the footer shows the default contact email, legal links and the since line", async ({ page }) => {
    await page.goto("/fr/about");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "Satexcommerce@ymail.com" })).toHaveAttribute("href", "mailto:Satexcommerce@ymail.com");
    await expect(footer.getByRole("link", { name: "Politique de confidentialité" })).toHaveAttribute("href", "/fr/legal/privacy");
    await expect(footer.getByRole("link", { name: "Conditions d'utilisation" })).toHaveAttribute("href", "/fr/legal/terms");
    await expect(footer.getByText("Expert textile depuis 1995")).toBeVisible();
    // empty phone / address / WhatsApp settings are simply not shown
    await expect(footer.getByText("WhatsApp")).toHaveCount(0);
  });

  test("the mobile menu opens, lists the links, closes with Escape", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile only");
    await page.goto("/fr");
    await expect(page.getByTestId("mobile-nav-panel")).toHaveCount(0);
    await page.getByTestId("mobile-nav-toggle").click();
    await expect(page.getByTestId("mobile-nav-panel").getByRole("link")).toHaveCount(5);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mobile-nav-panel")).toHaveCount(0);
  });
});

test.describe("about, legal and contact pages exist in every language", () => {
  for (const [locale, about, privacy, contact] of [
    ["fr", "SATEX Commerce, votre partenaire tissus", "Politique de confidentialité", "Contactez-nous"],
    ["en", "SATEX Commerce, your fabric partner", "Privacy policy", "Contact us"],
    ["ar", "SATEX Commerce، شريكك في الأقمشة", "سياسة الخصوصية", "اتصل بنا"],
  ] as const) {
    test(`/${locale}`, async ({ page }) => {
      await page.goto(`/${locale}/about`);
      await expect(page.getByRole("heading", { level: 1, name: about })).toBeVisible();
      await page.goto(`/${locale}/legal/privacy`);
      await expect(page.getByRole("heading", { level: 1, name: privacy })).toBeVisible();
      await expect(page.getByRole("note")).toBeVisible(); // the "provisional text" notice
      await page.goto(`/${locale}/legal/terms`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.goto(`/${locale}/contact`);
      await expect(page.getByRole("heading", { level: 1, name: contact })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    });
  }
});

test.describe("contact form validation (server action, no database needed)", () => {
  test("shows a message for each invalid field and does not send", async ({ page }) => {
    await page.goto("/fr/contact");
    await page.getByRole("button", { name: "Envoyer le message" }).click();
    await expect(page.getByText("Indiquez votre nom.")).toBeVisible();
    await expect(page.getByText("Ce champ est obligatoire.")).toBeVisible();
    await expect(page.getByText("Votre message est trop court (10 caractères minimum).")).toBeVisible();
    await expect(page.getByText("Vous devez accepter pour envoyer le message.")).toBeVisible();
    await expect(page.getByTestId("contact-success")).toHaveCount(0);
  });

  test("a bot that fills the honeypot field is silently accepted but nothing is sent", async ({ page }) => {
    await page.goto("/fr/contact");
    await page.locator('input[name="website"]').evaluate((el: HTMLInputElement) => (el.value = "http://spam.example"));
    await page.getByRole("button", { name: "Envoyer le message" }).click();
    await expect(page.getByTestId("contact-success")).toBeVisible();
  });
});
