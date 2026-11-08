export type I18n = { fr: string; en: string; ar: string };
const t = (fr: string, en: string, ar: string): I18n => ({ fr, en, ar });

export type FabricStructure =
  | "jersey" | "pique" | "rib" | "interlock" | "fleece" | "french_terry" | "mesh" | "plain" | "twill" | "satin"
  | "denim" | "canvas" | "poplin" | "oxford" | "gabardine" | "crepe" | "chiffon" | "velvet" | "jacquard" | "tulle" | "felt" | "other";

export const STRUCTURE_NAMES: Record<string, I18n> = {
  jersey: t("Jersey", "Jersey", "جيرسي"),
  pique: t("Piqué", "Piqué", "بيكيه"),
  rib: t("Côtelé", "Rib knit", "ريب"),
  interlock: t("Interlock", "Interlock", "إنترلوك"),
  fleece: t("Molleton", "Fleece", "فليس"),
  french_terry: t("Molleton gratté", "French terry", "فرنش تيري"),
  mesh: t("Maille filet", "Mesh", "شبك"),
  plain: t("Toile", "Plain weave", "نسيج سادة"),
  twill: t("Sergé", "Twill", "تويل"),
  satin: t("Satin", "Satin", "ساتان"),
  denim: t("Denim", "Denim", "دنيم"),
  canvas: t("Toile épaisse", "Canvas", "كانفاس"),
  poplin: t("Popeline", "Poplin", "بوبلين"),
  oxford: t("Oxford", "Oxford", "أكسفورد"),
  gabardine: t("Gabardine", "Gabardine", "جبردين"),
  crepe: t("Crêpe", "Crepe", "كريب"),
  chiffon: t("Mousseline", "Chiffon", "شيفون"),
  velvet: t("Velours", "Velvet", "مخمل"),
  jacquard: t("Jacquard", "Jacquard", "جاكار"),
  tulle: t("Tulle", "Tulle", "تول"),
};

export type Fiber = "cotton" | "polyester" | "elastane" | "viscose" | "linen" | "wool" | "silk" | "modal" | "nylon" | "acrylic";

/** Adjective form of each fiber, used to build fabric names. */
export const FIBER_NAMES: Record<Fiber, I18n> = {
  cotton: t("coton", "cotton", "قطن"),
  polyester: t("polyester", "polyester", "بوليستر"),
  elastane: t("élasthanne", "elastane", "إيلاستين"),
  viscose: t("viscose", "viscose", "فيسكوز"),
  linen: t("lin", "linen", "كتان"),
  wool: t("laine", "wool", "صوف"),
  silk: t("soie", "silk", "حرير"),
  modal: t("modal", "modal", "مودال"),
  nylon: t("nylon", "nylon", "نايلون"),
  acrylic: t("acrylique", "acrylic", "أكريليك"),
};
export const ORGANIC_COTTON: I18n = t("coton biologique", "organic cotton", "قطن عضوي");
export const STRETCH_WORD: I18n = t("stretch", "stretch", "مطاطي");

/** Vocabulary of `fabrics.uses` (docs/04-database.md). */
export const USE_NAMES: Record<string, I18n> = {
  activewear: t("vêtements de sport", "activewear", "ملابس رياضية"),
  sportswear: t("sportswear", "sportswear", "ملابس رياضية يومية"),
  t_shirts: t("t-shirts", "t-shirts", "قمصان تي شيرت"),
  polos: t("polos", "polo shirts", "قمصان بولو"),
  shirts: t("chemises", "shirts", "قمصان"),
  dresses: t("robes", "dresses", "فساتين"),
  skirts: t("jupes", "skirts", "تنانير"),
  trousers: t("pantalons", "trousers", "سراويل"),
  jeans: t("jeans", "jeans", "جينز"),
  jackets: t("vestes", "jackets", "سترات"),
  coats: t("manteaux", "coats", "معاطف"),
  suits: t("costumes", "suits", "بدلات"),
  eveningwear: t("tenues de soirée", "eveningwear", "ملابس السهرة"),
  lingerie: t("lingerie", "lingerie", "ملابس داخلية"),
  swimwear: t("maillots de bain", "swimwear", "ملابس السباحة"),
  kidswear: t("vêtements enfant", "kidswear", "ملابس أطفال"),
  workwear: t("vêtements de travail", "workwear", "ملابس العمل"),
  uniforms: t("uniformes", "uniforms", "زي موحد"),
  upholstery: t("ameublement", "upholstery", "تنجيد الأثاث"),
  curtains: t("rideaux", "curtains", "ستائر"),
  bedding: t("linge de lit", "bedding", "مفروشات"),
  accessories: t("accessoires", "accessories", "إكسسوارات"),
  linings: t("doublures", "linings", "بطانات"),
};

export const SEASON_NAMES: Record<string, I18n> = {
  spring_summer: t("printemps-été", "spring-summer", "ربيع-صيف"),
  autumn_winter: t("automne-hiver", "autumn-winter", "خريف-شتاء"),
  all_season: t("toutes saisons", "all seasons", "كل المواسم"),
};

/** Color library. `key` doubles as the color code (upper-cased). */
export interface ColorDef { key: string; hex: string; name: I18n }
export const COLORS: Record<string, ColorDef> = Object.fromEntries(
  (
    [
      ["white", "#F7F7F5", t("Blanc", "White", "أبيض")],
      ["ivory", "#F3EEDC", t("Ivoire", "Ivory", "عاجي")],
      ["ecru", "#E6DCC6", t("Écru", "Ecru", "إيكرو")],
      ["black", "#1A1A1A", t("Noir", "Black", "أسود")],
      ["anthracite", "#3A3F45", t("Anthracite", "Charcoal", "فحمي")],
      ["heather", "#B3B6B9", t("Gris chiné", "Heather grey", "رمادي فاتح")],
      ["grey", "#8C9096", t("Gris", "Grey", "رمادي")],
      ["navy", "#1F3A5F", t("Bleu marine", "Navy", "كحلي")],
      ["royal", "#2C5AA0", t("Bleu roi", "Royal blue", "أزرق ملكي")],
      ["sky", "#8DB8E0", t("Bleu ciel", "Sky blue", "أزرق سماوي")],
      ["turquoise", "#2BA6A6", t("Turquoise", "Turquoise", "تركواز")],
      ["petrol", "#1F5C6B", t("Bleu pétrole", "Petrol blue", "أزرق نفطي")],
      ["forest", "#1F4D3A", t("Vert sapin", "Forest green", "أخضر غابي")],
      ["olive", "#6B6B3A", t("Vert olive", "Olive", "زيتي")],
      ["mint", "#A8D5BA", t("Vert menthe", "Mint", "نعناعي")],
      ["khaki", "#8A8456", t("Kaki", "Khaki", "كاكي")],
      ["emerald", "#0F7B5F", t("Émeraude", "Emerald", "زمردي")],
      ["red", "#C0392B", t("Rouge", "Red", "أحمر")],
      ["burgundy", "#6D1F2F", t("Bordeaux", "Burgundy", "عنابي")],
      ["ruby", "#9B111E", t("Rubis", "Ruby", "روبي")],
      ["blush", "#E8B4B8", t("Rose poudré", "Blush pink", "وردي فاتح")],
      ["fuchsia", "#C2185B", t("Fuchsia", "Fuchsia", "فوشيا")],
      ["coral", "#F2705A", t("Corail", "Coral", "مرجاني")],
      ["orange", "#E8812B", t("Orange", "Orange", "برتقالي")],
      ["terracotta", "#C8643C", t("Terracotta", "Terracotta", "تيراكوتا")],
      ["mustard", "#D4A017", t("Moutarde", "Mustard", "خردلي")],
      ["lemon", "#F2E04A", t("Citron", "Lemon", "ليموني")],
      ["beige", "#D8C3A5", t("Beige", "Beige", "بيج")],
      ["sand", "#C9B28C", t("Sable", "Sand", "رملي")],
      ["camel", "#B8864B", t("Camel", "Camel", "جملي")],
      ["brown", "#6B4226", t("Marron", "Brown", "بني")],
      ["chocolate", "#3E2723", t("Chocolat", "Chocolate", "شوكولاتة")],
      ["purple", "#6A3D9A", t("Violet", "Purple", "بنفسجي")],
      ["lavender", "#B9A7D6", t("Lavande", "Lavender", "لافندر")],
      ["indigo", "#2B3A67", t("Indigo", "Indigo", "نيلي")],
      ["washed_blue", "#5F7FA6", t("Bleu délavé", "Washed blue", "أزرق باهت")],
      ["washed_black", "#2C2C2E", t("Noir délavé", "Washed black", "أسود باهت")],
      ["champagne", "#E5D3B3", t("Champagne", "Champagne", "شامبانيا")],
      ["gold", "#C9A227", t("Or", "Gold", "ذهبي")],
      ["silver", "#C0C4C8", t("Argent", "Silver", "فضي")],
      ["sapphire", "#1B3F8B", t("Saphir", "Sapphire", "ياقوتي")],
    ] as [string, string, I18n][]
  ).map(([key, hex, name]) => [key, { key, hex, name }]),
);

export const PALETTES: Record<string, string[]> = {
  basics: ["white", "black", "navy", "heather", "grey", "red", "royal", "forest", "burgundy", "mustard", "sky", "blush"],
  bright: ["fuchsia", "coral", "orange", "turquoise", "lemon", "royal", "purple", "emerald", "red", "mint", "sky", "black"],
  sport: ["black", "anthracite", "navy", "royal", "red", "turquoise", "lemon", "orange", "white", "fuchsia", "emerald"],
  earth: ["beige", "sand", "camel", "brown", "olive", "khaki", "terracotta", "ecru", "chocolate", "forest", "mustard"],
  denim: ["indigo", "washed_blue", "washed_black", "grey", "white", "ecru", "navy", "black"],
  formal: ["black", "anthracite", "navy", "grey", "heather", "camel", "burgundy", "chocolate", "petrol", "ecru"],
  natural: ["ecru", "ivory", "white", "beige", "sand", "olive", "sky", "blush", "lavender", "heather", "khaki", "forest"],
  evening: ["black", "champagne", "gold", "silver", "ruby", "emerald", "sapphire", "burgundy", "blush", "ivory", "fuchsia"],
  upholstery: ["grey", "anthracite", "beige", "sand", "navy", "forest", "terracotta", "mustard", "petrol", "burgundy", "ecru", "olive"],
  lining: ["black", "navy", "ecru", "grey", "white", "burgundy", "beige"],
};
