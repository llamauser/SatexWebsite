import { SpecSchema, type Spec, type WizardInput } from "./schema";

/**
 * Keyword fallback for spec extraction (docs/06-ai-matching.md §2 A): used when the model is unavailable or answers badly,
 * and by the deterministic "fake" provider. French, English and Arabic words; deliberately simple and predictable.
 */
type Entry<T extends string> = [T, RegExp];

const FIBERS: Entry<"cotton" | "polyester" | "viscose" | "linen" | "wool" | "silk" | "elastane" | "nylon" | "modal" | "acrylic">[] = [
  ["cotton", /\b(cotton|coton)\b|قطن/i],
  ["polyester", /polyest|بوليستر/i],
  ["viscose", /viscose|rayon|فيسكوز/i],
  ["linen", /\b(linen|lin)\b|كتان/i],
  ["wool", /\b(wool|laine)\b|صوف/i],
  ["silk", /\b(silk|soie)\b|حرير/i],
  ["elastane", /elast|spandex|lycra|إيلاستين/i],
  ["nylon", /nylon|polyamid|نايلون/i],
  ["modal", /\bmodal\b|مودال/i],
  ["acrylic", /acryl|أكريليك/i],
];

const STRUCTURES: Entry<"jersey" | "pique" | "rib" | "interlock" | "fleece" | "french_terry" | "mesh" | "twill" | "satin" | "denim" | "canvas" | "poplin" | "oxford" | "gabardine" | "crepe" | "chiffon" | "velvet" | "jacquard" | "tulle">[] = [
  ["jersey", /jersey|جيرسي/i],
  ["pique", /piqu[eé]|بيكيه/i],
  ["rib", /\brib\b|c[oô]tel[eé]|ريب/i],
  ["interlock", /interlock|إنترلوك/i],
  ["fleece", /fleece|molleton|فليس/i],
  ["french_terry", /french terry|فرنش تيري/i],
  ["mesh", /\bmesh\b|filet|شبك/i],
  ["twill", /twill|serg[eé]|تويل/i],
  ["satin", /satin|ساتان/i],
  ["denim", /denim|jean|دنيم|جينز/i],
  ["canvas", /canvas|toile [eé]paisse|كانفاس/i],
  ["poplin", /poplin|popeline|بوبلين/i],
  ["oxford", /oxford|أكسفورد/i],
  ["gabardine", /gabardine|جبردين/i],
  ["crepe", /cr[eê]pe|كريب/i],
  ["chiffon", /chiffon|mousseline|شيفون/i],
  ["velvet", /velvet|velours|مخمل/i],
  ["jacquard", /jacquard|جاكار/i],
  ["tulle", /tulle|تول/i],
];

const USES: Entry<"activewear" | "sportswear" | "t_shirts" | "polos" | "shirts" | "dresses" | "skirts" | "trousers" | "jeans" | "jackets" | "coats" | "suits" | "eveningwear" | "lingerie" | "swimwear" | "kidswear" | "workwear" | "uniforms" | "upholstery" | "curtains" | "bedding" | "linings">[] = [
  ["activewear", /activewear|sport|fitness|gym|running|رياض/i],
  ["t_shirts", /t-?shirt|tee\b|تي شيرت/i],
  ["polos", /\bpolos?\b|بولو/i],
  ["shirts", /\bshirts?\b|chemise|قميص|قمصان/i],
  ["dresses", /dress|robe|فستان|فساتين/i],
  ["skirts", /skirt|jupe|تنور/i],
  ["trousers", /trouser|pantalon|pants|سروال|سراويل/i],
  ["jeans", /jeans|جينز/i],
  ["jackets", /jacket|veste|blouson|سترة|سترات/i],
  ["coats", /\bcoats?\b|manteau|معطف|معاطف/i],
  ["suits", /\bsuits?\b|costume|tailleur|بدلة|بدلات/i],
  ["eveningwear", /evening|soir[eé]e|gala|cocktail|سهرة/i],
  ["lingerie", /lingerie|ملابس داخلية/i],
  ["swimwear", /swim|maillot de bain|سباحة/i],
  ["kidswear", /\bkids?\b|enfant|children|baby|b[eé]b[eé]|أطفال|طفل/i],
  ["workwear", /workwear|work wear|travail|عمل/i],
  ["uniforms", /uniform|زي موحد/i],
  ["upholstery", /upholster|ameublement|sofa|canap[eé]|fauteuil|تنجيد|أريكة/i],
  ["curtains", /curtain|rideau|ستائر|ستارة/i],
  ["bedding", /bedding|linge de lit|draps?|مفروشات/i],
  ["linings", /lining|doublure|بطانة|بطانات/i],
];

const SUMMER = /summer|\b[eé]t[eé]\b|spring|printemps|صيف|ربيع/i;
const WINTER = /winter|hiver|autumn|automne|fall\b|شتاء|خريف/i;
const LIGHT = /\b(light|lightweight|l[eé]ger|l[eé]g[eè]re)\b|خفيف/i;
const HEAVY = /\b(heavy|heavyweight|lourd|[eé]pais)\b|ثقيل|سميك/i;
const STRETCHY = /stretch|extensible|[eé]lastique|elast|مطاط/i;
const FOUR_WAY = /4[- ]?way|four[- ]?way|4 sens|quatre sens|أربعة اتجاهات/i;
const SOFT = /\b(soft|doux|douce|moelleux)\b|ناعم/i;
const SHINY = /shin|glossy|brillant|satin[eé]|لامع/i;
const BREATHABLE = /breath|respirant|aéré|aere|يتنفس/i;

// JavaScript's \b only knows ASCII letters, so "été" or "épais" would never sit on a word boundary. These patterns are
// recompiled with a Unicode-aware boundary.
const WORD = "[\\p{L}\\p{N}_]";
const BOUNDARY = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`;
const cache = new Map<RegExp, RegExp>();
function uni(re: RegExp): RegExp {
  let compiled = cache.get(re);
  if (!compiled) {
    compiled = new RegExp(re.source.replaceAll("\\b", BOUNDARY), "iu");
    cache.set(re, compiled);
  }
  return compiled;
}
const has = (re: RegExp, text: string) => uni(re).test(text);

function found<T extends string>(text: string, table: Entry<T>[]): T[] {
  return table.filter(([, re]) => has(re, text)).map(([k]) => k);
}

export function fallbackSpec(input: Pick<WizardInput, "description" | "styles" | "brand" | "priceTarget" | "audience">): Spec {
  const text = input.description;
  const fibers = found(text, FIBERS);
  const structures = found(text, STRUCTURES);
  const uses = found(text, USES);
  const seasons: ("spring_summer" | "autumn_winter")[] = [];
  if (has(SUMMER, text)) seasons.push("spring_summer");
  if (has(WINTER, text)) seasons.push("autumn_winter");

  // an explicit weight: "200 GSM", "~180 g/m2", "250 gr"
  let gsmMin: number | null = null;
  let gsmMax: number | null = null;
  const gsm = /(\d{2,4})\s*(?:gsm|g\s*\/?\s*m\s*[2²]?|gr\b|g\/m)/i.exec(text) ?? /(?:gsm|poids|weight)\D{0,6}(\d{2,4})/i.exec(text);
  if (gsm) {
    const v = Number(gsm[1]);
    gsmMin = Math.round(v * 0.85);
    gsmMax = Math.round(v * 1.15);
  } else if (has(LIGHT, text)) {
    gsmMax = 170;
  } else if (has(HEAVY, text)) {
    gsmMin = 260;
  }

  // "organic / natural / eco" style or wording favours natural fibres; "sporty" favours activewear
  const wantsNatural = input.styles.includes("eco") || has(/organic|biolog|natur|bio\b|عضوي|طبيعي/i, text);
  const fibersPreferred = fibers.filter((f) => f !== "elastane");
  if (wantsNatural && fibersPreferred.length === 0) fibersPreferred.push("cotton", "linen", "wool");
  if (input.styles.includes("luxurious") && fibersPreferred.length === 0) fibersPreferred.push("silk", "wool");
  if (input.styles.includes("sporty") && uses.length === 0) uses.push("activewear");
  if (input.audience === "kids" && !uses.includes("kidswear")) uses.push("kidswear");
  if (input.audience === "home" && uses.length === 0) uses.push("upholstery", "curtains");

  const fourWay = has(FOUR_WAY, text);
  const stretchy = has(STRETCHY, text) || fibers.includes("elastane") || uses.includes("activewear") || uses.includes("swimwear");
  const construction = has(/jersey|knit|maille|tricot|pique|piqu[eé]|interlock|fleece|molleton|تريكو|محبوك/i, text) ? "knit"
    : has(/woven|tiss[eé]|poplin|popeline|twill|serg[eé]|denim|satin|منسوج/i, text) ? "woven" : null;

  const feel: Spec["feel"] = {};
  if (has(SOFT, text)) feel.softness = 8;
  if (has(SHINY, text)) feel.sheen = 8;
  if (has(BREATHABLE, text)) feel.breathability = 8;

  const styles = input.styles.join(" ");
  return SpecSchema.parse({
    construction,
    structures,
    fibers_preferred: fibersPreferred,
    fibers_avoid: [],
    gsm_min: gsmMin,
    gsm_max: gsmMax,
    stretch: fourWay ? "four_way" : stretchy ? "two_way" : null,
    seasons,
    uses,
    feel,
    colors: [],
    budget_max_per_m: input.priceTarget,
    query_text: [text, styles].filter(Boolean).join(". "),
  });
}
