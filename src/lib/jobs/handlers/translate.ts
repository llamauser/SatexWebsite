import type { SupabaseClient } from "@supabase/supabase-js";
import { llmProvider, NotConfiguredError } from "@/lib/ai/config";
import { translateFields, type TargetLocale } from "@/lib/ai/translate";
import type { JobPayload } from "../runner";

const FIELDS = ["name", "short_description", "description"] as const;
type Field = (typeof FIELDS)[number];
type I18n = { fr?: string; en?: string; ar?: string };
const TARGETS: TargetLocale[] = ["en", "ar"];

interface Row {
  name: I18n | null;
  short_description: I18n | null;
  description: I18n | null;
  machine_translated: Record<string, string[]> | null;
}

/** Which (field, locale) pairs are empty but have a French source. */
export function missingTranslations(row: Pick<Row, Field>): { field: Field; locale: TargetLocale }[] {
  const out: { field: Field; locale: TargetLocale }[] = [];
  for (const field of FIELDS) {
    const value = row[field];
    if (!value?.fr?.trim()) continue;
    for (const locale of TARGETS) if (!value[locale]?.trim()) out.push({ field, locale });
  }
  return out;
}

/**
 * Fill the missing English / Arabic fields of a fabric from the French text, and remember which fields are machine
 * translated (docs/09-i18n.md §4). Human-written translations are never overwritten.
 */
export async function handleTranslate(message: JobPayload, sb: SupabaseClient, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const id = String(message.id ?? "");
  if (!id) throw new Error("translate job without a fabric id");
  const select = "name, short_description, description, machine_translated";

  const load = async (): Promise<Row | null> => {
    const { data, error } = await sb.from("fabrics").select(select).eq("id", id).maybeSingle();
    if (error) throw new Error(`load fabric: ${error.message}`);
    return data as Row | null;
  };

  const first = await load();
  if (!first) return;
  const wanted = missingTranslations(first);
  if (wanted.length === 0) return;
  if (llmProvider(env) === "none") throw new NotConfiguredError("the text-generation provider");

  const results: { field: Field; locale: TargetLocale; text: string }[] = [];
  for (const locale of TARGETS) {
    const fields = Object.fromEntries(wanted.filter((w) => w.locale === locale).map((w) => [w.field, first[w.field]!.fr!]));
    if (Object.keys(fields).length === 0) continue;
    const translated = await translateFields(fields, locale, env);
    for (const [field, text] of Object.entries(translated)) results.push({ field: field as Field, locale, text });
  }

  // re-read: an editor may have written a translation while the model was working; never overwrite it
  const fresh = (await load()) ?? first;
  const patch: Partial<Record<Field, I18n>> & { machine_translated?: Record<string, string[]> } = {};
  const flags: Record<string, string[]> = { ...(fresh.machine_translated ?? {}) };
  for (const { field, locale, text } of results) {
    if (fresh[field]?.[locale]?.trim()) continue;
    patch[field] = { ...(patch[field] ?? fresh[field] ?? {}), [locale]: text };
    flags[field] = [...new Set([...(flags[field] ?? []), locale])];
  }
  if (Object.keys(patch).length === 0) return;
  patch.machine_translated = flags;

  const { error } = await sb.from("fabrics").update(patch).eq("id", id);
  if (error) throw new Error(`save translations: ${error.message}`);
}
