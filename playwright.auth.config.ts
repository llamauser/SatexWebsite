import { defineConfig, devices } from "@playwright/test";

/**
 * Auth end-to-end tests: need a seeded local Supabase (supabase start, db:seed) and NEXT_PUBLIC_SUPABASE_* env at BUILD time.
 *   node scripts/supabase-env.mjs > .env.local && pnpm build && pnpm e2e:auth
 * The app runs with fake AI/email providers so the background jobs (embeddings, translation, email) are deterministic.
 */
const port = 3100;

export default defineConfig({
  testDir: "./tests/e2e-auth",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-auth" }]] : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next start -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
      AI_PROVIDER: "fake",
      EMBED_PROVIDER: "fake",
      EMAIL_PROVIDER: "log",
      CRON_SECRET: "e2e-cron-secret",
      JOB_RETRY_DELAYS_S: "0,0",
    },
  },
});
