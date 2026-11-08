/**
 * Verifies messages/{fr,en,ar}.json (docs/09-i18n.md §1):
 *  - same set of keys in every locale (French is the reference)
 *  - no empty strings
 *  - valid ICU syntax
 *  - same placeholder names ({name}, <tag>) as French
 * Run: pnpm i18n:check
 */
import { IntlMessageFormat } from "intl-messageformat";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type Messages = { [key: string]: string | Messages };

const LOCALES = ["fr", "en", "ar"] as const;
const REFERENCE = "fr";

export function flatten(obj: Messages, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** Placeholder names: {name} arguments and <tag> rich-text tags. */
export function placeholders(message: string): string[] {
  const names = new Set<string>();
  for (const m of message.matchAll(/\{\s*([A-Za-z_]\w*)/g)) names.add(`{${m[1]}}`);
  for (const m of message.matchAll(/<\/?([A-Za-z]\w*)\s*>/g)) names.add(`<${m[1]}>`);
  return [...names].sort();
}

export function checkMessages(all: Record<string, Messages>): string[] {
  const errors: string[] = [];
  const flat = Object.fromEntries(Object.entries(all).map(([l, m]) => [l, flatten(m)]));
  const ref = flat[REFERENCE];
  if (!ref) return [`Missing reference locale "${REFERENCE}"`];

  for (const locale of Object.keys(flat)) {
    const msgs = flat[locale]!;
    for (const key of Object.keys(ref)) {
      if (!(key in msgs)) errors.push(`[${locale}] missing key: ${key}`);
    }
    for (const key of Object.keys(msgs)) {
      if (!(key in ref)) errors.push(`[${locale}] extra key (not in ${REFERENCE}): ${key}`);
    }
    for (const [key, value] of Object.entries(msgs)) {
      if (value.trim() === "") {
        errors.push(`[${locale}] empty value: ${key}`);
        continue;
      }
      try {
        new IntlMessageFormat(value, locale);
      } catch (e) {
        errors.push(`[${locale}] invalid ICU in ${key}: ${(e as Error).message}`);
        continue;
      }
      const refValue = ref[key];
      if (refValue !== undefined && locale !== REFERENCE) {
        const a = placeholders(refValue).join(",");
        const b = placeholders(value).join(",");
        if (a !== b) errors.push(`[${locale}] placeholders differ in ${key}: fr=[${a}] ${locale}=[${b}]`);
      }
    }
  }
  return errors;
}

function main() {
  const dir = join(process.cwd(), "messages");
  const all: Record<string, Messages> = {};
  for (const l of LOCALES) all[l] = JSON.parse(readFileSync(join(dir, `${l}.json`), "utf8"));
  const errors = checkMessages(all);
  if (errors.length) {
    console.error(errors.join("\n"));
    console.error(`\ni18n check failed: ${errors.length} problem(s).`);
    process.exit(1);
  }
  console.log(`i18n check passed (${LOCALES.join(", ")}; ${Object.keys(flatten(all.fr!)).length} keys).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
