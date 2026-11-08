#!/usr/bin/env node
/** Fails (exit 1) when a Lighthouse JSON report scores below the threshold.  node scripts/check-lighthouse.mjs report.json 0.85 */
import { readFileSync } from "node:fs";

const [file, min = "0.85"] = process.argv.slice(2);
const report = JSON.parse(readFileSync(file, "utf8"));
const score = report.categories?.performance?.score;
const a = report.audits ?? {};
const metric = (k) => a[k]?.displayValue ?? "n/a";
console.log(`Lighthouse performance: ${score === undefined ? "n/a" : Math.round(score * 100)} (min ${Math.round(Number(min) * 100)})`);
console.log(`  LCP ${metric("largest-contentful-paint")} | CLS ${metric("cumulative-layout-shift")} | TBT ${metric("total-blocking-time")} | FCP ${metric("first-contentful-paint")}`);
if (typeof score !== "number" || score < Number(min)) {
  console.error("Performance score is below the threshold.");
  process.exit(1);
}
