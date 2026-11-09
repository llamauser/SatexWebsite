#!/usr/bin/env node
/**
 * Fails (exit 1) when the MEDIAN performance score of several Lighthouse reports is below the threshold.
 * A single run on a shared CI machine varies by several points, so the gate uses the median of N runs.
 *   node scripts/check-lighthouse.mjs 0.85 run1.json run2.json run3.json
 */
import { readFileSync } from "node:fs";

const [min = "0.85", ...files] = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: check-lighthouse.mjs <min-score> <report.json>...");
  process.exit(2);
}

const runs = files
  .map((file) => {
    const report = JSON.parse(readFileSync(file, "utf8"));
    return { file, report, score: report.categories?.performance?.score };
  })
  .filter((r) => typeof r.score === "number")
  .sort((a, b) => a.score - b.score);

if (runs.length === 0) {
  console.error("No usable Lighthouse report.");
  process.exit(1);
}

const metric = (report, k) => report.audits?.[k]?.displayValue ?? "n/a";
for (const r of runs) {
  console.log(
    `  run ${r.file}: ${Math.round(r.score * 100)} | LCP ${metric(r.report, "largest-contentful-paint")} | TBT ${metric(r.report, "total-blocking-time")} | FCP ${metric(r.report, "first-contentful-paint")}`,
  );
}
const median = runs[Math.floor(runs.length / 2)];
console.log(`Lighthouse performance (median of ${runs.length}): ${Math.round(median.score * 100)} (min ${Math.round(Number(min) * 100)})`);

const a = median.report.audits ?? {};
const lcp = a["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node;
if (lcp) console.log(`  LCP element: ${lcp.selector} :: ${(lcp.snippet ?? "").slice(0, 120)}`);
for (const b of (a["bootup-time"]?.details?.items ?? []).slice(0, 5)) {
  console.log(`  JS ${Math.round(b.total)}ms (scripting ${Math.round(b.scripting)}ms) ${String(b.url).slice(-70)}`);
}
for (const b of (a["total-byte-weight"]?.details?.items ?? []).slice(0, 6)) {
  console.log(`  ${Math.round(b.totalBytes / 1024)} kB ${String(b.url).slice(-70)}`);
}

if (median.score < Number(min)) {
  console.error("Median performance score is below the threshold.");
  process.exit(1);
}
