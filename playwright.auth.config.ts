import { defineConfig, devices } from "@playwright/test";

/**
 * Auth end-to-end tests: need a seeded local Supabase (supabase start, db:seed) and NEXT_PUBLIC_SUPABASE_* env at BUILD time.
 *   node scripts/supabase-env.mjs > .env.local && pnpm build && pnpm e2e:auth
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
  },
});
