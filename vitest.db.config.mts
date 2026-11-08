import { defineConfig } from "vitest/config";

// DB tests run against a local Supabase (`pnpm exec supabase start`, then `pnpm db:reset`).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false, // files share one database
  },
});
