import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkCsv, parseCsv, TEMPLATE_CSV } from "@/lib/admin/csv";
import { checkLayout, overlapping, overlaps, previewRect, toLayout } from "@/lib/admin/departments";
import {
  afterHumanEdit, compositionTotal, emptyFabric, fromFabricRow, missingTranslations, slugify, toFabricRow, toFeelRow, toTierRows, validateFabric,
  type FabricForm,
} from "@/lib/admin/fabric-form";
import { coerceSetting, defOf, displayValue, SETTINGS } from "@/lib/admin/settings";
import { guard } from "@/lib/auth/guard";

const valid = (): FabricForm => ({
  ...emptyFabric(), slug: "jersey-bio", sku: "JB-1", categoryId: "cat-1", name: { fr: "Jersey bio", en: "", ar: "" },
  gsm: "160", composition: [{ fiber: "cotton", pct: "92" }, { fiber: "elastane", pct: "8" }], basePrice: "8.5",
});

describe("slugify", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("Piqué coton / élasthanne 240")).toBe("pique-coton-elasthanne-240");
    expect(slugify("  --Lin  ")).toBe("lin");
    expect(slugify("قماش")).toBe("");
  });
});

describe("fabric form validation", () => {
  it("accepts a complete fabric", () => {
    expect(validateFabric(valid())).toEqual({});
  });
  it("reports what the database would refuse", () => {
    const e = validateFabric({ ...valid(), slug: "Bad Slug", sku: " ", categoryId: "", name: { fr: " ", en: "x", ar: "" }, gsm: "5", widthCm: "400", moqM: "0", basePrice: "-1" });
    expect(e).toMatchObject({ slug: "slug", sku: "required", categoryId: "required", name: "required", gsm: "range", widthCm: "range", moqM: "invalid", basePrice: "invalid" });
  });
  it("needs a composition of known fibers that sums to exactly 100", () => {
    expect(validateFabric({ ...valid(), composition: [{ fiber: "cotton", pct: "90" }] }).composition).toBe("sum100");
    expect(validateFabric({ ...valid(), composition: [{ fiber: "cotton", pct: "50" }, { fiber: "cotton", pct: "50" }] }).composition).toBe("duplicate");
    expect(validateFabric({ ...valid(), composition: [] }).composition).toBe("invalid");
    expect(validateFabric({ ...valid(), composition: [{ fiber: "cotton", pct: "33.3" }, { fiber: "linen", pct: "66.7" }] }).composition).toBeUndefined();
    expect(compositionTotal([{ fiber: "a", pct: "0.1" }, { fiber: "b", pct: "0.2" }])).toBe(0.3);
  });
  it("checks price tiers and feel values", () => {
    expect(validateFabric({ ...valid(), tiers: [{ minM: "50", price: "8" }, { minM: "50", price: "7" }] }).tiers).toBe("duplicate");
    expect(validateFabric({ ...valid(), tiers: [{ minM: "0", price: "8" }] }).tiers).toBe("invalid");
    expect(validateFabric({ ...valid(), tiers: [{ minM: "100", price: "7" }, { minM: "50", price: "8" }] }).tiers).toBeUndefined();
    expect(validateFabric({ ...valid(), feel: { ...valid().feel, softness: "11" } }).feel).toBe("range");
    expect(validateFabric({ ...valid(), feel: { ...valid().feel, softness: "7,5" } }).feel).toBeUndefined();
  });
  it("accepts decimal commas", () => {
    expect(validateFabric({ ...valid(), basePrice: "8,5", moqM: "2,5" })).toEqual({});
  });
});

describe("form <-> database row", () => {
  it("builds the row: only filled languages, lists split, numbers parsed", () => {
    const row = toFabricRow({ ...valid(), name: { fr: " Jersey bio ", en: "Organic jersey", ar: "" }, finish: "brossé, lavé", tags: "bio;basics", uses: ["t_shirts"], organic: true, recycledPct: "30", certifications: "GOTS, OEKO-TEX" });
    expect(row.name).toEqual({ fr: "Jersey bio", en: "Organic jersey" });
    expect(row.short_description).toBeNull();
    expect(row.composition).toEqual([{ fiber: "cotton", pct: 92 }, { fiber: "elastane", pct: 8 }]);
    expect(row).toMatchObject({ gsm: 160, width_cm: 150, finish: ["brossé", "lavé"], tags: ["bio", "basics"], moq_m: 5, base_price_per_m: 8.5, stretch_pct: null, is_active: false });
    expect(row.eco).toEqual({ organic: true, recycled_pct: 30, certifications: ["GOTS", "OEKO-TEX"] });
  });
  it("round-trips through a database row", () => {
    const form = { ...valid(), tiers: [{ minM: "50", price: "8" }], feel: { softness: "7", drape: "", stretch: "", sheen: "", breathability: "" }, seasons: ["spring_summer"], uses: ["polos"], isActive: true };
    const row = { ...toFabricRow(form), category_id: "cat-1" } as unknown as Parameters<typeof fromFabricRow>[0];
    const back = fromFabricRow(row, toTierRows(form), { softness: 7, drape: null });
    expect(back).toEqual({ ...form, stretchPct: "", finish: "", tags: "", certifications: "", recycledPct: "" });
  });
  it("sorts tiers and turns blank feel values into nulls", () => {
    expect(toTierRows({ ...valid(), tiers: [{ minM: "100", price: "7" }, { minM: "50", price: "8" }] }).map((t) => t.min_m)).toEqual([50, 100]);
    expect(toFeelRow(valid())).toEqual({ softness: null, drape: null, stretch: null, sheen: null, breathability: null });
  });
});

describe("machine translation bookkeeping", () => {
  const before = { ...valid(), name: { fr: "Jersey", en: "Jersey", ar: "جيرسي" }, description: { fr: "Doux", en: "Soft", ar: "ناعم" } };
  const marks = { name: ["en", "ar"], description: ["en"] };
  it("keeps the marks when nothing was edited", () => {
    expect(afterHumanEdit(marks, before, before)).toEqual(marks);
  });
  it("clears the mark of a language a person edited, and only that one", () => {
    const after = { ...before, name: { ...before.name, en: "Organic jersey" } };
    expect(afterHumanEdit(marks, before, after)).toEqual({ name: ["ar"], description: ["en"] });
  });
  it("editing the French source does not clear anything", () => {
    const after = { ...before, name: { ...before.name, fr: "Jersey bio" } };
    expect(afterHumanEdit(marks, before, after)).toEqual(marks);
  });
  it("handles missing marks", () => {
    expect(afterHumanEdit(null, before, before)).toEqual({});
  });
  it("lists the languages that still lack a text", () => {
    expect(missingTranslations(valid())).toEqual(["en", "ar"]);
    expect(missingTranslations({ ...valid(), name: { fr: "J", en: "J", ar: "ج" } })).toEqual([]);
    expect(missingTranslations({ ...valid(), name: { fr: "J", en: "J", ar: "ج" }, description: { fr: "d", en: "", ar: "د" } })).toEqual(["en"]);
  });
});

describe("CSV parsing", () => {
  it("handles quotes, doubled quotes, semicolons, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,,3\r\n')).toEqual([["a", "b", "c"], ["1", "x, y", 'say "hi"'], ["2", "", "3"]]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("")).toEqual([]);
  });
});

describe("CSV import check", () => {
  const categories = new Map([["knits", "k"], ["shirting", "s"], ["natural-fibers", "n"], ["technical-activewear", "t"], ["denim", "d"], ["eveningwear", "e"], ["suiting", "u"], ["upholstery", "up"], ["linings", "l"]]);
  const sample = readFileSync("public/samples/fabrics-sample.csv", "utf8");

  it("the 10-row sample passes with exactly one deliberate error, reported on its line", () => {
    const plan = checkCsv(sample, { categories, existingSkus: new Set() });
    expect(plan.total).toBe(10);
    expect(plan.rows).toHaveLength(9);
    expect(plan.errors).toEqual([{ line: 8, field: "composition", issue: "sum100", value: "silk:90" }]);
    expect(plan.rows.every((r) => r.action === "create")).toBe(true);
    const first = plan.rows[0]!;
    expect(first).toMatchObject({ sku: "IMP-001", categoryId: "k", name: { fr: "Jersey coton bio 160", en: "Organic cotton jersey 160", ar: "جيرسي قطن عضوي 160" } });
    expect(first.colors).toEqual([{ code: "NAT", name: "Naturel", hex: "#EDE6D6" }, { code: "BLK", name: "Noir", hex: "#111111" }]);
    expect(first.tiers).toEqual([{ min_m: 50, price_per_m: 7.9 }, { min_m: 200, price_per_m: 7.4 }]);
    expect(first.fabric).toMatchObject({ gsm: 160, composition: [{ fiber: "cotton", pct: 100 }], uses: ["t_shirts", "kidswear"], is_active: false });
  });
  it("an existing SKU is an update", () => {
    const plan = checkCsv(sample, { categories, existingSkus: new Set(["imp-002"]) });
    expect(plan.rows.find((r) => r.sku === "IMP-002")?.action).toBe("update");
  });
  it("reports every kind of problem with its line and column", () => {
    const header = "sku,name_fr,category,construction,structure,composition,gsm,width_cm,moq_m,base_price_per_m,uses,colors,price_tiers,is_active\n";
    const bad = (cells: string) => checkCsv(header + cells, { categories, existingSkus: new Set() }).errors.map((e) => `${e.field}:${e.issue}`);
    const ok = "A1,Nom,knits,knit,jersey,cotton:100,160,150,5,8,t_shirts,N:Nom:#FFFFFF,50:7,true";
    expect(bad(ok)).toEqual([]);
    expect(bad(ok.replace("knits", "nope"))).toEqual(["category:category"]);
    expect(bad(ok.replace(",knit,", ",weave,"))).toEqual(["construction:enum"]);
    expect(bad(ok.replace("cotton:100", "cotton:60|wool:30"))).toEqual(["composition:sum100"]);
    expect(bad(ok.replace("cotton:100", "paper:100"))).toEqual(["composition:composition"]);
    expect(bad(ok.replace(",160,150,", ",5,150,"))).toEqual(["gsm:range"]);
    expect(bad(ok.replace(",160,150,", ",abc,150,"))).toEqual(["gsm:number"]);
    expect(bad(ok.replace(",8,t_shirts", ",,t_shirts"))).toEqual(["base_price_per_m:required"]);
    expect(bad(ok.replace("t_shirts", "t_shirts|capes"))).toEqual(["uses:enum"]);
    expect(bad(ok.replace("#FFFFFF", "white"))).toEqual(["colors:hex"]);
    expect(bad(ok.replace("50:7", "50:7|50:6"))).toEqual(["price_tiers:tiers"]);
    expect(bad(ok.replace(",true", ",maybe"))).toEqual(["is_active:boolean"]);
    expect(bad(`${ok}\n${ok}`)).toEqual(["sku:duplicateSku"]);
  });
  it("refuses a file without the required columns, or an empty one", () => {
    expect(checkCsv("sku,name_fr\nA,B", { categories, existingSkus: new Set() }).errors.map((e) => e.field)).toContain("category");
    expect(checkCsv("", { categories, existingSkus: new Set() }).errors).toHaveLength(1);
  });
  it("the downloadable template is itself a valid file", () => {
    const plan = checkCsv(TEMPLATE_CSV, { categories, existingSkus: new Set() });
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toHaveLength(1);
  });
});

describe("department layouts", () => {
  const ok = { x: 2, z: 2, w: 8, d: 6, rotation: 0, racks: 4, color: "#C9B497" };
  it("accepts a layout inside the floor", () => {
    expect(checkLayout(ok)).toBeNull();
    expect(checkLayout({ ...ok, x: "2,5", w: "8" })).toBeNull();
  });
  it("names the first problem", () => {
    expect(checkLayout({ ...ok, x: "a" })).toBe("number");
    expect(checkLayout({ ...ok, w: 0 })).toBe("size");
    expect(checkLayout({ ...ok, x: 35 })).toBe("outside");
    expect(checkLayout({ ...ok, z: 20 })).toBe("outside");
    expect(checkLayout({ ...ok, racks: 2.5 })).toBe("racks");
    expect(checkLayout({ ...ok, rotation: 45 })).toBe("rotation");
    expect(checkLayout({ ...ok, color: "red" })).toBe("hex");
  });
  it("detects overlaps but not touching edges, and only on the same floor", () => {
    expect(overlaps(ok, { ...ok, x: 9 })).toBe(true);
    expect(overlaps(ok, { ...ok, x: 10 })).toBe(false);
    const all = [{ slug: "a", floor: 0, layout: ok }, { slug: "b", floor: 0, layout: { ...ok, x: 5 } }, { slug: "c", floor: 1, layout: ok }, { slug: "d", floor: 0, layout: { ...ok, x: 30 } }];
    expect(overlapping(all[0]!, all)).toEqual(["b"]);
  });
  it("scales the preview and converts form strings", () => {
    expect(previewRect(ok, 400)).toEqual({ x: 20, y: 20, w: 80, h: 60 });
    expect(toLayout({ x: "2,5", z: "2", w: "8", d: "6", rotation: "90", racks: "4.4", color: "#c9b497" })).toEqual({ x: 2.5, z: 2, w: 8, d: 6, rotation: 90, racks: 4, color: "#C9B497" });
  });
});

describe("settings", () => {
  it("every setting seeded by the database has a definition", () => {
    const seeded = ["company_name", "tagline", "contact_email", "contact_phone", "contact_address", "whatsapp", "founded_year", "currency", "vat_rate", "show_prices_public", "timezone", "reservation_hours", "max_active_reservations_per_client", "quote_validity_days", "max_colors_per_sample_request", "max_open_sample_requests_per_client", "low_stock_threshold_m", "match_rate_limit_per_hour_guest", "match_rate_limit_per_hour_user", "staff_notification_email", "staff_locale"];
    expect(SETTINGS.map((s) => s.key).sort()).toEqual([...seeded].sort());
  });
  it("numbers: integers and ranges", () => {
    const d = defOf("reservation_hours")!;
    expect(coerceSetting(d, "48")).toEqual({ ok: true, value: 48 });
    expect(coerceSetting(d, "0")).toEqual({ ok: false, issue: "range" });
    expect(coerceSetting(d, "1.5")).toEqual({ ok: false, issue: "integer" });
    expect(coerceSetting(d, "")).toEqual({ ok: false, issue: "required" });
    expect(coerceSetting(d, "abc")).toEqual({ ok: false, issue: "number" });
  });
  it("a percentage is typed as 20 and stored as 0.2", () => {
    const d = defOf("vat_rate")!;
    expect(coerceSetting(d, "20")).toEqual({ ok: true, value: 0.2 });
    expect(coerceSetting(d, "19,6")).toEqual({ ok: true, value: 0.196 });
    expect(coerceSetting(d, "120")).toEqual({ ok: false, issue: "range" });
    expect(displayValue(d, 0.2)).toBe("20");
  });
  it("emails, locales, currencies, booleans and translated texts", () => {
    expect(coerceSetting(defOf("contact_email")!, "x@y.tn")).toEqual({ ok: true, value: "x@y.tn" });
    expect(coerceSetting(defOf("contact_email")!, "nope")).toEqual({ ok: false, issue: "email" });
    expect(coerceSetting(defOf("staff_locale")!, "de")).toEqual({ ok: false, issue: "locale" });
    expect(coerceSetting(defOf("currency")!, "TND")).toEqual({ ok: true, value: "TND" });
    expect(coerceSetting(defOf("currency")!, "XXX")).toEqual({ ok: false, issue: "currency" });
    expect(coerceSetting(defOf("show_prices_public")!, false)).toEqual({ ok: true, value: false });
    expect(coerceSetting(defOf("tagline")!, { fr: " Tissus ", en: "", ar: "أقمشة" })).toEqual({ ok: true, value: { fr: "Tissus", ar: "أقمشة" } });
    expect(coerceSetting(defOf("tagline")!, { fr: "", en: "x" })).toEqual({ ok: false, issue: "i18n" });
    expect(coerceSetting(defOf("company_name")!, " ")).toEqual({ ok: false, issue: "required" });
  });
});

describe("back-office access", () => {
  it("sales can look at fabrics and stock; creating and editing fabrics, departments, users and settings are admin-only", () => {
    for (const rest of ["/admin", "/admin/fabrics", "/admin/stock", "/admin/quotes", "/admin/samples"]) expect(guard(rest, "sales")).toBe("allow");
    for (const rest of ["/admin/fabrics/new", "/admin/fabrics/import", "/admin/fabrics/abc-123", "/admin/departments", "/admin/users", "/admin/settings", "/admin/match-logs"]) {
      expect(guard(rest, "sales")).toBe("forbidden");
      expect(guard(rest, "admin")).toBe("allow");
      expect(guard(rest, "client")).toBe("forbidden");
      expect(guard(rest, null)).toBe("sign-in");
    }
  });
});
