#!/usr/bin/env node
/**
 * Prints the env vars the app needs, read from the running local Supabase (`supabase status`):
 *   node scripts/supabase-env.mjs >> $GITHUB_ENV        (CI)
 *   node scripts/supabase-env.mjs > .env.local           (local development)
 */
import { execSync } from "node:child_process";

const out = execSync("pnpm exec supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString();
const s = JSON.parse(out);
const pick = (...keys) => keys.map((k) => s[k]).find(Boolean);

const url = pick("API_URL");
const anon = pick("ANON_KEY", "PUBLISHABLE_KEY");
const service = pick("SERVICE_ROLE_KEY", "SECRET_KEY");
const db = pick("DB_URL");
if (!url || !anon) {
  console.error("Could not read API_URL / ANON_KEY from `supabase status -o json`. Is Supabase running?");
  process.exit(1);
}
console.log(`NEXT_PUBLIC_SUPABASE_URL=${url}`);
console.log(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}`);
if (service) console.log(`SUPABASE_SERVICE_ROLE_KEY=${service}`);
if (db) console.log(`DATABASE_URL=${db}`);
