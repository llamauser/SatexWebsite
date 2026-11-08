import { describe, expect, it } from "vitest";
import { embedProvider, EMBEDDING_DIM, llmProvider, NotConfiguredError } from "../../src/lib/ai/config";
import { embedText, fakeEmbedding, toPgVector } from "../../src/lib/ai/embed";
import { buildFabricDoc, contentHash } from "../../src/lib/ai/fabric-doc";
import { parseTranslationReply, TRANSLATE_PROMPT_V1, translateFields } from "../../src/lib/ai/translate";
import { missingTranslations } from "../../src/lib/jobs/handlers/translate";
import { emailProvider } from "../../src/emails/send";

describe("provider selection", () => {
  it("picks providers from the environment and reports 'none' when a key is missing", () => {
    expect(llmProvider({ AI_PROVIDER: "fake" } as never)).toBe("fake");
    expect(llmProvider({ AI_PROVIDER: "ollama" } as never)).toBe("ollama");
    expect(llmProvider({} as never)).toBe("none");
    expect(llmProvider({ ANTHROPIC_API_KEY: "k" } as never)).toBe("anthropic");
    expect(embedProvider({ EMBED_PROVIDER: "fake" } as never)).toBe("fake");
    expect(embedProvider({} as never)).toBe("none");
    expect(embedProvider({ VOYAGE_API_KEY: "k" } as never)).toBe("voyage");
    expect(emailProvider({} as never)).toBe("log");
    expect(emailProvider({ RESEND_API_KEY: "k" } as never)).toBe("resend");
    expect(emailProvider({ RESEND_API_KEY: "k", EMAIL_PROVIDER: "log" } as never)).toBe("log");
  });
});

describe("embeddings", () => {
  it("the fake embedding is deterministic, has the database dimension and unit length", () => {
    const a = fakeEmbedding("jersey coton 180");
    expect(a).toHaveLength(EMBEDDING_DIM);
    expect(a).toEqual(fakeEmbedding("jersey coton 180"));
    expect(a).not.toEqual(fakeEmbedding("lin 160"));
    expect(Math.sqrt(a.reduce((s, v) => s + v * v, 0))).toBeCloseTo(1, 6);
  });
  it("embedText works with the fake provider and refuses when nothing is configured", async () => {
    const r = await embedText("hello", { EMBED_PROVIDER: "fake" } as never);
    expect(r.model).toBe("fake-1024");
    expect(r.vector).toHaveLength(EMBEDDING_DIM);
    await expect(embedText("hello", {} as never)).rejects.toBeInstanceOf(NotConfiguredError);
  });
  it("formats pgvector literals", () => {
    expect(toPgVector([1, 0.5, -2])).toBe("[1,0.5,-2]");
  });
});

describe("fabric document", () => {
  const fabric = {
    name: { fr: "Piqué coton / élasthanne", en: "Cotton / Elastane Piqué" }, short_description: { fr: "Piqué stretch", en: "Stretch piqué" },
    structure: "pique", construction: "knit", composition: [{ fiber: "cotton", pct: 92 }, { fiber: "elastane", pct: 8 }],
    gsm: 240, width_cm: 150, stretch: "two_way", finish: ["anti_pilling"], uses: ["activewear", "polos"], seasons: ["spring_summer"],
  };
  it("describes the fabric in English with its key facts", () => {
    const doc = buildFabricDoc(fabric);
    expect(doc).toContain("Cotton / Elastane Piqué.");
    expect(doc).toContain("pique knit, 240 GSM, 150 cm wide, composition 92% cotton, 8% elastane, stretch two way, finishes anti pilling.");
    expect(doc).toContain("Best for activewear, polos.");
    expect(doc).toContain("Seasons spring summer.");
    expect(doc).toContain("Stretch piqué");
  });
  it("includes the feel profile when there is one, falls back to French, and hashes stably", () => {
    expect(buildFabricDoc({ ...fabric, name: { fr: "Seulement français" }, feel: { softness: 7, drape: 4, sheen: null } })).toMatch(/^Seulement français\..*Feel: softness 7\/10, drape 4\/10\.$/);
    expect(contentHash(buildFabricDoc(fabric))).toBe(contentHash(buildFabricDoc({ ...fabric })));
    expect(contentHash(buildFabricDoc(fabric))).not.toBe(contentHash(buildFabricDoc({ ...fabric, gsm: 241 })));
  });
});

describe("translation", () => {
  it("parses a model reply, tolerating code fences and a preamble", () => {
    expect(parseTranslationReply('```json\n{"name":"Cotton piqué","description":"Soft"}\n```', ["name", "description"])).toEqual({ name: "Cotton piqué", description: "Soft" });
    expect(parseTranslationReply('Sure! {"name":" Linen "}', ["name"])).toEqual({ name: "Linen" });
  });
  it("rejects replies with missing or empty keys, or no JSON", () => {
    expect(() => parseTranslationReply('{"name":"x"}', ["name", "description"])).toThrow(/missing "description"/);
    expect(() => parseTranslationReply('{"name":"  "}', ["name"])).toThrow();
    expect(() => parseTranslationReply("no json here", ["name"])).toThrow(/no JSON/);
    expect(() => parseTranslationReply('{"name": 3}', ["name"])).toThrow();
  });
  it("the prompt names the target language and the output format", () => {
    expect(TRANSLATE_PROMPT_V1("ar")).toContain("Arabic");
    expect(TRANSLATE_PROMPT_V1("en")).toContain("ONLY a JSON object");
  });
  it("the fake provider prefixes the target language", async () => {
    expect(await translateFields({ name: "Lin" }, "en", { AI_PROVIDER: "fake" } as never)).toEqual({ name: "[en] Lin" });
    expect(await translateFields({}, "ar", { AI_PROVIDER: "fake" } as never)).toEqual({});
    await expect(translateFields({ name: "Lin" }, "en", {} as never)).rejects.toBeInstanceOf(NotConfiguredError);
  });
  it("finds the missing English / Arabic fields that have a French source", () => {
    expect(
      missingTranslations({ name: { fr: "A", en: "A" }, short_description: { fr: "B" }, description: null }),
    ).toEqual([{ field: "name", locale: "ar" }, { field: "short_description", locale: "en" }, { field: "short_description", locale: "ar" }]);
    expect(missingTranslations({ name: { fr: "A", en: "a", ar: "ا" }, short_description: null, description: { fr: "  " } })).toEqual([]);
  });
});
