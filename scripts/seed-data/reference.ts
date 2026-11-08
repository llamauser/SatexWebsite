import type { I18n } from "./dictionaries";

const t = (fr: string, en: string, ar: string): I18n => ({ fr, en, ar });

export interface SeedCategory { slug: string; name: I18n; description: I18n; icon: string; sort: number }
export const CATEGORIES: SeedCategory[] = [
  { slug: "knits", icon: "shirt", sort: 1, name: t("Maille", "Knits", "تريكو"), description: t("Jerseys, piqués, côtelés et molletons pour le prêt-à-porter.", "Jerseys, piqués, ribs and fleeces for ready-to-wear.", "جيرسي وبيكيه وريب وفليس للملابس الجاهزة.") },
  { slug: "technical-activewear", icon: "activity", sort: 2, name: t("Technique & sport", "Technical activewear", "أقمشة رياضية تقنية"), description: t("Tissus respirants, extensibles et à séchage rapide.", "Breathable, stretchy, quick-dry fabrics.", "أقمشة تتنفس ومرنة وسريعة الجفاف.") },
  { slug: "shirting", icon: "shirt", sort: 3, name: t("Chemiserie", "Shirting", "قماش القمصان"), description: t("Popelines, oxfords et sergés pour chemises et blouses.", "Poplins, oxfords and twills for shirts and blouses.", "بوبلين وأكسفورد وتويل للقمصان والبلوزات.") },
  { slug: "suiting", icon: "briefcase", sort: 4, name: t("Costumes & tailleur", "Suiting", "أقمشة البدلات"), description: t("Gabardines, sergés et crêpes pour le tailleur.", "Gabardines, twills and crepes for tailoring.", "جبردين وتويل وكريب للخياطة الرسمية.") },
  { slug: "denim", icon: "layers", sort: 5, name: t("Denim", "Denim", "دنيم"), description: t("Denims bruts, stretch et délavés.", "Raw, stretch and washed denims.", "دنيم خام ومطاطي ومغسول.") },
  { slug: "natural-fibers", icon: "leaf", sort: 6, name: t("Fibres naturelles", "Natural fibers", "ألياف طبيعية"), description: t("Lin, soie, laine et coton biologique.", "Linen, silk, wool and organic cotton.", "كتان وحرير وصوف وقطن عضوي.") },
  { slug: "eveningwear", icon: "sparkles", sort: 7, name: t("Soirée", "Eveningwear", "أقمشة السهرة"), description: t("Satins, mousselines, velours et tulles.", "Satins, chiffons, velvets and tulles.", "ساتان وشيفون ومخمل وتول.") },
  { slug: "upholstery", icon: "sofa", sort: 8, name: t("Ameublement", "Upholstery", "أقمشة التنجيد"), description: t("Toiles, velours et jacquards pour sièges et rideaux.", "Canvases, velvets and jacquards for seating and curtains.", "كانفاس ومخمل وجاكار للمقاعد والستائر.") },
  { slug: "linings", icon: "scissors", sort: 9, name: t("Doublures", "Linings", "بطانات"), description: t("Doublures légères et antistatiques.", "Light, anti-static linings.", "بطانات خفيفة ومضادة للكهرباء الساكنة.") },
];

export interface SeedDepartment {
  slug: string; name: I18n; floor: 0 | 1;
  kind: "fabric_hall" | "cutting" | "shipping" | "studio" | "client_suite" | "office";
  layout: { x: number; z: number; w: number; d: number; rotation: number; racks: number; color: string };
  categories: string[]; sort: number;
}
const L = (x: number, z: number, w: number, d: number, racks: number, color: string) => ({ x, z, w, d, rotation: 0, racks, color });

/** docs/07-showroom-3d.md §3 */
export const DEPARTMENTS: SeedDepartment[] = [
  { slug: "natural-fibers", name: t("Fibres naturelles", "Natural fibers", "ألياف طبيعية"), floor: 0, kind: "fabric_hall", layout: L(2, 2, 8, 6, 4, "#C9B497"), categories: ["natural-fibers"], sort: 1 },
  { slug: "upholstery", name: t("Ameublement", "Upholstery", "أقمشة التنجيد"), floor: 0, kind: "fabric_hall", layout: L(12, 2, 8, 6, 4, "#8FB3DE"), categories: ["upholstery"], sort: 2 },
  { slug: "knits", name: t("Maille & sport", "Knits & activewear", "تريكو ورياضة"), floor: 0, kind: "fabric_hall", layout: L(22, 2, 8, 6, 5, "#E49A7C"), categories: ["knits", "technical-activewear"], sort: 3 },
  { slug: "shirting-suiting", name: t("Chemiserie & tailleur", "Shirting & suiting", "قمصان وبدلات"), floor: 0, kind: "fabric_hall", layout: L(2, 10, 8, 6, 4, "#6F8FB5"), categories: ["shirting", "suiting", "linings"], sort: 4 },
  { slug: "denim", name: t("Denim", "Denim", "دنيم"), floor: 0, kind: "fabric_hall", layout: L(12, 10, 8, 6, 4, "#2B3A67"), categories: ["denim"], sort: 5 },
  { slug: "eveningwear", name: t("Soirée", "Eveningwear", "السهرة"), floor: 0, kind: "fabric_hall", layout: L(22, 10, 8, 6, 4, "#9B111E"), categories: ["eveningwear"], sort: 6 },
  { slug: "cutting", name: t("Atelier de coupe", "Cutting room", "قسم القص"), floor: 0, kind: "cutting", layout: L(32, 2, 6, 8, 0, "#5E9AAE"), categories: [], sort: 7 },
  { slug: "shipping", name: t("Expédition", "Shipping", "الشحن"), floor: 0, kind: "shipping", layout: L(32, 12, 6, 8, 0, "#4F8FA3"), categories: [], sort: 8 },
  { slug: "design-studio", name: t("Studio de création", "Design studio", "استوديو التصميم"), floor: 1, kind: "studio", layout: L(2, 16, 14, 7, 0, "#D8C6A8"), categories: [], sort: 9 },
  { slug: "client-suite", name: t("Salon client", "Client suite", "جناح العملاء"), floor: 1, kind: "client_suite", layout: L(18, 16, 10, 7, 0, "#A8D5BA"), categories: [], sort: 10 },
  { slug: "offices", name: t("Bureaux", "Offices", "المكاتب"), floor: 1, kind: "office", layout: L(30, 16, 8, 7, 0, "#B3B6B9"), categories: [], sort: 11 },
];

/** Placeholder quote terms (must be reviewed by the client / a lawyer). */
export const QUOTE_TERMS: I18n = t(
  "Devis valable pour la durée indiquée. Prix hors frais de livraison. Les quantités sont sous réserve de disponibilité au moment de la confirmation. Conditions de paiement à confirmer avec votre interlocuteur commercial. (Texte provisoire à valider.)",
  "Quote valid for the period shown. Prices exclude delivery costs. Quantities are subject to availability at confirmation. Payment terms to be confirmed with your sales contact. (Provisional text, to be reviewed.)",
  "عرض السعر صالح للمدة المذكورة. الأسعار لا تشمل تكاليف التوصيل. الكميات رهن التوفر عند التأكيد. تُؤكَّد شروط الدفع مع مسؤول المبيعات. (نص مؤقت يحتاج إلى مراجعة.)",
);
