import {
  COLORS, FIBER_NAMES, ORGANIC_COTTON, PALETTES, SEASON_NAMES, STRETCH_WORD, STRUCTURE_NAMES, USE_NAMES,
  type Fiber, type I18n,
} from "./dictionaries";
import { int, rng, shuffled } from "./rng";

export type Stretch = "none" | "mechanical" | "two_way" | "four_way";
export type Season = "spring_summer" | "autumn_winter" | "all_season";

export interface SeedColor { code: string; key: string; name: I18n; hex: string; sort: number }
export interface SeedFabric {
  slug: string; sku: string; name: I18n; shortDescription: I18n; description: I18n;
  categorySlug: string; construction: "knit" | "woven" | "nonwoven"; structure: string;
  composition: { fiber: Fiber; pct: number }[];
  gsm: number; widthCm: number; stretch: Stretch; stretchPct: number | null;
  finish: string[]; uses: string[]; seasons: Season[]; tags: string[];
  moqM: number; basePrice: number; eco: Record<string, unknown>; isFeatured: boolean;
  tiers: { minM: number; pricePerM: number }[]; colors: SeedColor[]; palette: string;
}

const FIBER_CODES: Record<string, Fiber> = {
  co: "cotton", pe: "polyester", ea: "elastane", vi: "viscose", li: "linen", wo: "wool", si: "silk", mo: "modal", ny: "nylon", ac: "acrylic",
};
const STRETCH_MAP = { n: "none", m: "mechanical", t: "two_way", f: "four_way" } as const;
const SEASON_MAP = { ss: ["spring_summer"], aw: ["autumn_winter"], all: ["all_season"] } as const;
const CAT_CODE: Record<string, string> = {
  knits: "KN", "technical-activewear": "TA", shirting: "SH", suiting: "SU", denim: "DE",
  "natural-fibers": "NF", eveningwear: "EV", upholstery: "UP", linings: "LI",
};

interface Row {
  cat: string; st: string; cons: "knit" | "woven"; comp: string; gsm: number; w: number;
  str: keyof typeof STRETCH_MAP; pct?: number; fin?: string[]; uses: string; se: keyof typeof SEASON_MAP;
  moq: number; price: number; pal: string;
  slug?: string; name?: I18n; org?: boolean; rec?: number; feat?: boolean;
}
const r = (cat: string, st: string, cons: "knit" | "woven", comp: string, gsm: number, w: number,
  str: keyof typeof STRETCH_MAP, uses: string, se: keyof typeof SEASON_MAP, moq: number, price: number, pal: string,
  extra: Partial<Row> = {}): Row => ({ cat, st, cons, comp, gsm, w, str, uses, se, moq, price, pal, ...extra });

const ROWS: Row[] = [
  // ---- knits (14)
  r("knits","jersey","knit","co100",180,160,"n","t_shirts,kidswear,dresses","all",5,9.5,"basics",{ slug:"organic-cotton-jersey-180", org:true, feat:true, pct:0 }),
  r("knits","jersey","knit","co95 ea5",160,165,"t","t_shirts,dresses,kidswear","ss",5,8.9,"basics",{ pct:40 }),
  r("knits","jersey","knit","co60 pe40",150,160,"n","t_shirts,workwear","ss",10,6.4,"basics"),
  r("knits","jersey","knit","vi95 ea5",190,160,"t","dresses,skirts,t_shirts","all",5,10.8,"bright",{ pct:35 }),
  r("knits","jersey","knit","mo48 co48 ea4",170,165,"t","t_shirts,lingerie,dresses","all",5,12.5,"natural",{ pct:30 }),
  r("knits","rib","knit","co95 ea5",220,70,"t","t_shirts,dresses,accessories","all",5,9.2,"basics",{ pct:60, fin:["mercerized"] }),
  r("knits","rib","knit","co100",280,60,"m","accessories,jackets","aw",5,8.1,"earth",{ pct:25 }),
  r("knits","interlock","knit","co100",200,170,"n","kidswear,t_shirts,polos","all",5,9.9,"basics",{ fin:["mercerized"] }),
  r("knits","interlock","knit","co65 pe35",230,165,"n","workwear,polos,uniforms","all",10,7.3,"basics"),
  r("knits","french_terry","knit","co80 pe20",280,180,"n","sportswear,kidswear,jackets","all",10,11.2,"earth",{ fin:["brushed"] }),
  r("knits","fleece","knit","pe100",300,165,"n","sportswear,jackets,coats","aw",10,8.7,"basics",{ fin:["brushed","anti_pilling"], rec:100 }),
  r("knits","pique","knit","co92 ea8",240,150,"t","activewear,polos,t_shirts","ss",5,13.4,"basics",{ slug:"cotton-elastane-pique", name:{ fr:"Piqué coton / élasthanne", en:"Cotton / Elastane Piqué", ar:"بيكيه قطن / إيلاستين" }, pct:35, feat:true }),
  r("knits","pique","knit","co100",210,160,"n","polos,uniforms,t_shirts","ss",10,9.6,"basics"),
  r("knits","fleece","knit","co80 pe20",320,170,"n","sportswear,jackets","aw",10,12.9,"earth",{ fin:["brushed"] }),
  // ---- technical-activewear (10)
  r("technical-activewear","mesh","knit","pe100",140,150,"m","activewear,sportswear,linings","ss",5,6.9,"sport",{ slug:"breathable-poly-mesh", feat:true, pct:20, rec:30 }),
  r("technical-activewear","jersey","knit","pe88 ea12",200,155,"f","activewear,swimwear,lingerie","all",5,12.2,"sport",{ pct:80 }),
  r("technical-activewear","jersey","knit","ny80 ea20",220,150,"f","activewear,swimwear","all",5,16.5,"sport",{ pct:100 }),
  r("technical-activewear","interlock","knit","pe92 ea8",180,155,"t","activewear,sportswear","ss",5,11.4,"sport",{ pct:45 }),
  r("technical-activewear","mesh","knit","pe100",110,150,"m","activewear,linings,accessories","ss",5,5.9,"sport"),
  r("technical-activewear","jersey","knit","pe100",150,160,"m","activewear,t_shirts,workwear","ss",5,7.2,"sport",{ fin:["quick_dry"] }),
  r("technical-activewear","jersey","knit","pe85 ea15",260,150,"f","activewear,swimwear","all",5,17.8,"sport",{ pct:90 }),
  r("technical-activewear","mesh","knit","pe90 ea10",130,150,"f","activewear,lingerie","ss",5,10.6,"sport",{ pct:70 }),
  r("technical-activewear","jersey","knit","pe95 ea5",170,160,"t","activewear,sportswear","all",5,9.4,"sport",{ pct:40, fin:["quick_dry"] }),
  r("technical-activewear","interlock","knit","co50 pe42 ea8",210,155,"t","activewear,polos","all",5,11.9,"sport",{ pct:45 }),
  // ---- shirting (10)
  r("shirting","poplin","woven","co100",110,150,"n","shirts,dresses,kidswear","ss",10,7.8,"basics",{ fin:["mercerized"] }),
  r("shirting","poplin","woven","co80 pe20",105,150,"n","shirts,uniforms,workwear","all",10,5.9,"basics",{ fin:["easy_care"] }),
  r("shirting","oxford","woven","co100",135,150,"n","shirts,uniforms","all",10,8.6,"basics"),
  r("shirting","oxford","woven","co100",150,150,"n","shirts,workwear,jackets","aw",10,9.4,"formal"),
  r("shirting","twill","woven","co100",140,150,"n","shirts,dresses,trousers","all",10,9.9,"basics"),
  r("shirting","poplin","woven","co97 ea3",120,145,"t","shirts,dresses","all",10,10.5,"basics",{ pct:20 }),
  r("shirting","plain","woven","li100",140,145,"n","shirts,dresses,trousers","ss",10,14.8,"natural"),
  r("shirting","poplin","woven","vi100",95,140,"n","shirts,dresses,skirts","ss",10,8.3,"bright"),
  r("shirting","twill","woven","co65 pe35",160,150,"n","workwear,uniforms,shirts","all",20,6.1,"formal"),
  r("shirting","plain","woven","co100",80,150,"n","shirts,dresses,kidswear","ss",10,6.7,"natural"),
  // ---- suiting (8)
  r("suiting","gabardine","woven","wo100",260,150,"n","suits,trousers,coats","aw",5,28.5,"formal",{ slug:"wool-gabardine-260", feat:true }),
  r("suiting","twill","woven","wo70 pe30",280,150,"n","suits,coats,skirts","aw",5,19.9,"formal"),
  r("suiting","gabardine","woven","pe68 vi30 ea2",240,150,"m","suits,trousers,uniforms","all",10,11.4,"formal",{ pct:8 }),
  r("suiting","crepe","woven","pe72 vi24 ea4",230,148,"t","suits,dresses,trousers","all",10,12.7,"formal",{ pct:15 }),
  r("suiting","twill","woven","pe65 vi32 ea3",250,148,"m","suits,trousers,skirts","all",10,10.9,"formal",{ pct:10 }),
  r("suiting","gabardine","woven","wo55 pe45",250,150,"n","suits,trousers,jackets","aw",5,16.8,"formal"),
  r("suiting","plain","woven","li55 vi45",200,145,"n","suits,jackets,trousers","ss",10,15.9,"natural"),
  r("suiting","twill","woven","wo98 ea2",300,150,"m","suits,coats,jackets","aw",5,32.4,"formal",{ pct:6 }),
  // ---- denim (7)
  r("denim","denim","woven","co100",340,150,"n","jeans,jackets,workwear","all",20,10.4,"denim"),
  r("denim","denim","woven","co98 ea2",400,150,"t","jeans,jackets","all",20,12.8,"denim",{ slug:"stretch-denim-12oz", pct:18, feat:true }),
  r("denim","denim","woven","co100",450,150,"n","jeans,workwear,upholstery","aw",20,13.6,"denim"),
  r("denim","denim","woven","co90 pe8 ea2",280,148,"t","jeans,shirts,skirts","ss",20,9.8,"denim",{ pct:15 }),
  r("denim","plain","woven","co100",150,145,"n","shirts,dresses,kidswear","ss",20,7.9,"denim"),
  r("denim","denim","woven","co95 ea5",320,150,"f","jeans,skirts","all",20,11.7,"denim",{ pct:25 }),
  r("denim","denim","woven","co100",380,150,"n","jeans,jackets,accessories","all",20,11.9,"denim",{ fin:["washed"] }),
  // ---- natural-fibers (10)
  r("natural-fibers","plain","woven","li100",160,145,"n","shirts,dresses,trousers","ss",10,16.8,"natural",{ slug:"linen-plain-160", feat:true }),
  r("natural-fibers","plain","woven","li100",200,145,"n","trousers,jackets,curtains","all",10,19.2,"natural"),
  r("natural-fibers","plain","woven","li55 co45",180,148,"n","shirts,dresses,bedding","ss",10,12.4,"natural"),
  r("natural-fibers","satin","woven","si100",90,140,"n","eveningwear,lingerie,dresses","all",5,38.9,"evening",{ slug:"silk-satin-90", feat:true }),
  r("natural-fibers","plain","woven","wo100",200,150,"n","skirts,dresses,jackets","aw",5,24.6,"formal"),
  r("natural-fibers","twill","woven","wo100",260,150,"n","coats,jackets,trousers","aw",5,29.9,"earth"),
  r("natural-fibers","plain","woven","co100",120,150,"n","shirts,kidswear,bedding","ss",10,8.9,"natural",{ org:true }),
  r("natural-fibers","canvas","woven","co100",300,150,"n","jackets,accessories,workwear","all",10,11.8,"earth",{ org:true }),
  r("natural-fibers","twill","woven","li100",240,145,"n","trousers,jackets,upholstery","all",10,21.3,"natural"),
  r("natural-fibers","plain","woven","mo100",110,140,"n","shirts,lingerie,dresses","ss",10,13.7,"natural"),
  // ---- eveningwear (9)
  r("eveningwear","satin","woven","pe100",110,145,"n","eveningwear,dresses,linings","all",10,7.6,"evening"),
  r("eveningwear","satin","woven","pe90 ea10",140,145,"t","eveningwear,dresses,skirts","all",10,10.2,"evening",{ pct:30 }),
  r("eveningwear","chiffon","woven","pe100",40,145,"n","eveningwear,dresses,accessories","ss",10,5.4,"evening"),
  r("eveningwear","chiffon","woven","si100",35,140,"n","eveningwear,dresses","ss",5,33.5,"evening"),
  r("eveningwear","crepe","woven","pe100",130,145,"n","eveningwear,dresses,trousers","all",10,8.8,"evening"),
  r("eveningwear","velvet","knit","pe92 ea8",220,150,"t","eveningwear,dresses,accessories","aw",5,14.9,"evening",{ pct:35 }),
  r("eveningwear","velvet","woven","vi80 si20",250,140,"n","eveningwear,jackets,accessories","aw",5,36.4,"evening"),
  r("eveningwear","tulle","woven","ny100",25,150,"n","eveningwear,dresses,accessories","ss",10,4.9,"evening"),
  r("eveningwear","jacquard","woven","pe70 vi30",180,145,"n","eveningwear,dresses,jackets","all",10,14.2,"evening"),
  // ---- upholstery (8)
  r("upholstery","canvas","woven","co100",400,150,"n","upholstery,curtains,accessories","all",10,12.6,"upholstery"),
  r("upholstery","canvas","woven","co60 li40",380,145,"n","upholstery,curtains","all",10,15.4,"upholstery"),
  r("upholstery","velvet","woven","pe100",480,140,"n","upholstery,curtains","aw",10,17.9,"upholstery",{ slug:"velvet-upholstery-480", feat:true }),
  r("upholstery","velvet","woven","pe100",400,140,"n","upholstery,curtains,accessories","aw",10,14.8,"upholstery"),
  r("upholstery","jacquard","woven","pe100",420,140,"n","upholstery,curtains","all",10,19.7,"upholstery"),
  r("upholstery","jacquard","woven","co50 pe50",500,140,"n","upholstery,curtains","all",10,21.9,"upholstery"),
  r("upholstery","canvas","woven","li100",350,145,"n","upholstery,curtains,bedding","all",10,18.3,"upholstery"),
  r("upholstery","plain","woven","pe100",300,150,"n","upholstery,accessories","all",10,10.9,"upholstery",{ fin:["water_repellent"] }),
  // ---- linings (4)
  r("linings","plain","woven","vi100",80,140,"n","linings,jackets,suits","all",20,5.2,"lining",{ fin:["anti_static"] }),
  r("linings","twill","woven","pe100",75,145,"n","linings,jackets,coats","all",20,3.9,"lining"),
  r("linings","plain","woven","pe100",60,145,"n","linings,skirts,dresses","all",20,3.2,"lining",{ fin:["anti_static"] }),
  r("linings","satin","woven","pe100",65,145,"n","linings,coats,eveningwear","all",20,3.7,"lining"),
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function parseComp(code: string): { fiber: Fiber; pct: number }[] {
  return code.split(" ").map((p) => ({ fiber: FIBER_CODES[p.slice(0, 2)]!, pct: Number(p.slice(2)) }));
}

function fiberLabel(comp: { fiber: Fiber; pct: number }[], organic: boolean): I18n {
  const main = comp.filter((c) => c.fiber !== "elastane").sort((a, b) => b.pct - a.pct);
  const parts = main.length > 1 && main[1]!.pct >= 20 ? main.slice(0, 2) : main.slice(0, 1);
  const name = (f: Fiber): I18n => (f === "cotton" && organic ? ORGANIC_COTTON : FIBER_NAMES[f]);
  return {
    fr: parts.map((p) => name(p.fiber).fr).join("-"),
    en: parts.map((p) => name(p.fiber).en).join("-"),
    ar: parts.map((p) => name(p.fiber).ar).join("-"),
  };
}

function useList(codes: string[], lang: keyof I18n, n = 2): string {
  const names = codes.slice(0, n).map((c) => USE_NAMES[c]![lang]);
  const and = { fr: " et ", en: " and ", ar: " و" }[lang];
  return names.join(and);
}

export function buildFabrics(): SeedFabric[] {
  const used = new Set<string>();
  return ROWS.map((row, index) => {
    const comp = parseComp(row.comp);
    const sum = comp.reduce((s, c) => s + c.pct, 0);
    if (sum !== 100) throw new Error(`Composition of row ${index + 1} (${row.comp}) sums to ${sum}`);
    const elastane = comp.find((c) => c.fiber === "elastane")?.pct ?? 0;
    const stretchy = elastane >= 3 && row.str !== "n";
    const struct = STRUCTURE_NAMES[row.st]!;
    const fiber = fiberLabel(comp, !!row.org);
    const base: I18n = {
      fr: `${struct.fr} ${fiber.fr}${stretchy ? ` ${STRETCH_WORD.fr}` : ""} ${row.gsm}`,
      en: `${stretchy ? "Stretch " : ""}${fiber.en} ${struct.en.toLowerCase()} ${row.gsm}`,
      ar: `${struct.ar} ${fiber.ar}${stretchy ? ` ${STRETCH_WORD.ar}` : ""} ${row.gsm}`,
    };
    const name = row.name ?? { ...base, en: cap(base.en) };

    let slug = row.slug ?? slugify(base.en);
    if (used.has(slug)) {
      let n = 2;
      while (used.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    used.add(slug);

    const uses = row.uses.split(",");
    const seasons = [...SEASON_MAP[row.se]] as Season[];
    const compText = (lang: keyof I18n) =>
      comp.map((c) => `${c.pct}% ${FIBER_NAMES[c.fiber][lang]}`).join(" · ");
    const finishText = row.fin?.length ? row.fin.join(", ") : "";

    const shortDescription: I18n = {
      fr: `${struct.fr}, ${compText("fr")}. ${row.gsm} g/m², largeur ${row.w} cm. Idéal pour ${useList(uses, "fr")}.`,
      en: `${struct.en}, ${compText("en")}. ${row.gsm} GSM, ${row.w} cm wide. Ideal for ${useList(uses, "en")}.`,
      ar: `${struct.ar}، ${compText("ar")}. ${row.gsm} غ/م²، العرض ${row.w} سم. مثالي لـ${useList(uses, "ar")}.`,
    };
    const season = SEASON_NAMES[seasons[0]!]!;
    const description: I18n = {
      fr: `${shortDescription.fr} Saison : ${season.fr}.${finishText ? ` Finitions : ${finishText}.` : ""} Données de démonstration.`,
      en: `${shortDescription.en} Season: ${season.en}.${finishText ? ` Finishes: ${finishText}.` : ""} Demo data.`,
      ar: `${shortDescription.ar} الموسم: ${season.ar}. بيانات تجريبية.`,
    };

    const sku = `SAT-${CAT_CODE[row.cat]}-${String(index + 1).padStart(4, "0")}`;
    const rand = rng(`colors:${slug}`);
    const palette = PALETTES[row.pal]!;
    const n = Math.min(3 + int(rand, 0, 5), palette.length);
    const colors: SeedColor[] = shuffled(palette, rand)
      .slice(0, n)
      .map((key, i) => ({ code: key.toUpperCase(), key, name: COLORS[key]!.name, hex: COLORS[key]!.hex, sort: i }));

    const round = (v: number) => Math.round(v * 100) / 100;
    const eco: Record<string, unknown> = {};
    if (row.org) Object.assign(eco, { organic: true, certifications: ["GOTS"], recycled_pct: 0 });
    if (row.rec) Object.assign(eco, { recycled_pct: row.rec, certifications: ["GRS"] });

    return {
      slug, sku, name, shortDescription, description,
      categorySlug: row.cat, construction: row.cons, structure: row.st, composition: comp,
      gsm: row.gsm, widthCm: row.w, stretch: STRETCH_MAP[row.str], stretchPct: row.pct ?? null,
      finish: row.fin ?? [], uses, seasons,
      tags: [row.cat, row.st, fiber.en, ...uses.slice(0, 2)],
      moqM: row.moq, basePrice: row.price, eco, isFeatured: !!row.feat,
      tiers: [
        { minM: row.moq, pricePerM: row.price },
        { minM: 100, pricePerM: round(row.price * 0.92) },
        { minM: 500, pricePerM: round(row.price * 0.85) },
      ],
      colors, palette: row.pal,
    };
  });
}
