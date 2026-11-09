import { getMessages } from "next-intl/server";

/**
 * Only the translation namespaces that client components actually use are sent to the browser (the rest stay on the
 * server). Every page gets the base set; sections that have client forms add theirs through a nested provider.
 */
const BASE = ["nav", "languages", "notifications", "cart", "fabric", "compare"] as const;

export async function clientMessages(...extra: string[]): Promise<Record<string, unknown>> {
  const all = (await getMessages()) as unknown as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const ns of [...BASE, ...extra]) picked[ns] = all[ns];
  return picked;
}
