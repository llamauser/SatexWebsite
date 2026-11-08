import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkMessages, flatten, placeholders, type Messages } from "../../scripts/check-i18n";

const base = (): Record<string, Messages> => ({
  fr: { a: "Bonjour {name}", b: { c: "Un <b>mot</b>" } },
  en: { a: "Hello {name}", b: { c: "A <b>word</b>" } },
  ar: { a: "مرحبا {name}", b: { c: "<b>كلمة</b>" } },
});

describe("check-i18n", () => {
  it("accepts consistent messages", () => {
    expect(checkMessages(base())).toEqual([]);
  });

  it("flags a missing key", () => {
    const m = base();
    delete (m.en as Messages).a;
    expect(checkMessages(m)).toContain("[en] missing key: a");
  });

  it("flags an extra key", () => {
    const m = base();
    (m.ar as Messages).z = "extra";
    expect(checkMessages(m)).toContain("[ar] extra key (not in fr): z");
  });

  it("flags an empty value and invalid ICU", () => {
    const m = base();
    (m.en as Messages).a = "  ";
    (m.ar as Messages).a = "مرحبا {name";
    const errors = checkMessages(m).join("\n");
    expect(errors).toContain("[en] empty value: a");
    expect(errors).toContain("[ar] invalid ICU in a");
  });

  it("flags placeholder mismatches", () => {
    const m = base();
    (m.en as Messages).a = "Hello {user}";
    expect(checkMessages(m).join("\n")).toContain("[en] placeholders differ in a");
  });

  it("helpers work", () => {
    expect(flatten({ a: { b: "x" }, c: "y" })).toEqual({ "a.b": "x", c: "y" });
    expect(placeholders("Hi {name}, <em>{count, plural, one {#} other {#}}</em>")).toEqual([
      "<em>",
      "{count}",
      "{name}",
    ]);
  });

  it("the real message files are consistent", () => {
    const load = (l: string) =>
      JSON.parse(readFileSync(join(process.cwd(), "messages", `${l}.json`), "utf8")) as Messages;
    expect(checkMessages({ fr: load("fr"), en: load("en"), ar: load("ar") })).toEqual([]);
  });
});
