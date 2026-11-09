import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

/** Seeded demo users: passwords are written by `pnpm db:seed` to .seed-credentials.local.json. */
export function seededPassword(email: string): string {
  const file = join(process.cwd(), ".seed-credentials.local.json");
  const creds = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  const pw = creds[email];
  if (!pw) throw new Error(`No seeded password for ${email}. Run pnpm db:seed first.`);
  return pw;
}

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

interface MailpitMessage { ID: string; Subject: string }

/** Wait for an email sent to `to` and return the first link to the local auth server (the confirmation / magic / recovery link). */
export async function waitForAuthLink(to: string, since = 0): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    if (res.ok) {
      const { messages } = (await res.json()) as { messages: (MailpitMessage & { Created: string })[] };
      const fresh = (messages ?? []).filter((m) => new Date(m.Created).getTime() >= since);
      for (const m of fresh) {
        const detail = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string; HTML: string };
        const body = `${detail.Text}\n${detail.HTML}`.replace(/&amp;/g, "&");
        const link = /https?:\/\/[^\s"'<>)]*\/auth\/v1\/verify[^\s"'<>)]*/.exec(body);
        if (link) return link[0];
      }
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`No auth email arrived for ${to}`);
}

export async function signIn(page: Page, email: string, password: string, locale = "fr") {
  await page.goto(`/${locale}/auth/sign-in`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
}

/** Sign in and wait until the account area has loaded (so a following navigation cannot abort the sign-in). */
export async function signInOk(page: Page, email: string, password: string, locale = "fr") {
  await signIn(page, email, password, locale);
  await expect(page).toHaveURL(new RegExp(`/${locale}/account`));
}

export async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export const uniqueEmail = (tag: string) => `e2e-${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@satex.test`;

export async function expectSignedOut(page: Page) {
  await page.goto("/fr/account");
  await expect(page).toHaveURL(/\/fr\/auth\/sign-in\?next=/);
}

/**
 * Deletes test fabrics (and their colors, lots and the stock movements of those lots). Stock movements are append-only in the
 * database, so the guard is lifted for this cleanup only. `where` is a condition on the alias `f` (fabrics).
 */
export async function purgeFabrics(where: string, params: unknown[] = []) {
  await withDb(async (c) => {
    await c.query("alter table public.stock_movements disable trigger stock_movements_no_update");
    try {
      await c.query(
        `delete from public.stock_movements where lot_id in (select l.id from public.stock_lots l join public.fabric_colors fc on fc.id = l.color_id join public.fabrics f on f.id = fc.fabric_id where ${where})`,
        params,
      );
      await c.query(`delete from public.fabrics f where ${where}`, params);
    } finally {
      await c.query("alter table public.stock_movements enable trigger stock_movements_no_update");
    }
  });
}

/** Guests may start 10 matches (or photos) an hour from one address, counted in the database: several runs of the suite in an hour would hit that wall. */
export async function resetGuestRateLimits() {
  await withDb(async (c) => {
    await c.query(`delete from public.rate_limits where key like 'match:g:%' or key like 'snap:g:%'`);
  });
}
