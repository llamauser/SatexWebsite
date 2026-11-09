import { createTranslator } from "next-intl";
import ar from "../../../messages/ar.json";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import type { ScoredCandidate, Spec } from "./schema";

const MESSAGES = { fr, en, ar } as const;
type Locale = "fr" | "en" | "ar";
type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * Sentence built from the score components (docs/06-ai-matching.md §2 D fallback). Used when no model is available and
 * as the first display before the model's explanation arrives.
 */
export function templateExplanation(r: ScoredCandidate, spec: Spec, locale: Locale): string {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "match.explain" } as never) as unknown as T;
  const c = r.candidate;
  const parts = [
    t("intro", {
      name: c.name[locale] || c.name.fr || c.sku,
      color: c.color_name[locale] || c.color_name.fr || c.color_code,
      gsm: c.gsm,
      composition: c.composition.map((x) => `${x.pct}% ${x.fiber}`).join(", "),
    }),
  ];
  const k = r.components;
  if (k.gsm !== null && k.gsm >= 0.9) parts.push(t("fit.gsm"));
  if (k.stretch !== null && k.stretch >= 0.9) parts.push(t("fit.stretch"));
  if (k.use_season !== null && k.use_season >= 0.9) parts.push(t("fit.use"));
  if (k.fiber !== null && k.fiber >= 0.8) parts.push(t("fit.fiber"));
  if (k.color !== null && k.color >= 0.8) parts.push(t("fit.color"));
  const caveats: string[] = [];
  if (k.gsm !== null && k.gsm < 0.5) caveats.push(t("caveat.gsm"));
  if (k.stretch !== null && k.stretch < 0.5) caveats.push(t("caveat.stretch"));
  if (k.use_season !== null && k.use_season < 0.5) caveats.push(t("caveat.use"));
  if (k.budget < 1) caveats.push(t("caveat.price"));
  if (caveats[0]) parts.push(caveats[0]);
  void spec;
  return parts.join(" ");
}
