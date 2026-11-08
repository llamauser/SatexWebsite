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
const lcp = a["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node;
if (lcp) console.log(`  LCP element: ${lcp.selector} :: ${(lcp.snippet ?? "").slice(0, 120)}`);
const bootup = (a["bootup-time"]?.details?.items ?? []).slice(0, 5);
for (const b of bootup) console.log(`  JS ${Math.round(b.total)}ms (scripting ${Math.round(b.scripting)}ms) ${String(b.url).slice(-70)}`);
const big = (a["total-byte-weight"]?.details?.items ?? []).slice(0, 6);
for (const b of big) console.log(`  ${Math.round(b.totalBytes / 1024)} kB ${String(b.url).slice(-70)}`);
if (typeof score !== "number" || score < Number(min)) {
  console.error("Performance score is below the threshold.");
  process.exit(1);
}
