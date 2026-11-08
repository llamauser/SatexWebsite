import { z } from "zod";
import { claudeModel, llmProvider, NotConfiguredError, ollamaUrl } from "./config";

export type TargetLocale = "en" | "ar";
const LANGUAGE_NAME: Record<TargetLocale, string> = { en: "English", ar: "Arabic" };

/** docs/09-i18n.md §4 (TRANSLATE_PROMPT_V1) */
export const TRANSLATE_PROMPT_V1 = (target: TargetLocale) =>
  `You translate wholesale textile catalog content from French to ${LANGUAGE_NAME[target]}.
Keep technical terms accurate (GSM, jersey, piqué, twill, gabardine...), keep brand names and SKUs unchanged, keep numbers and units as they are (Latin digits).
The user message is a JSON object whose values are French texts. Reply with ONLY a JSON object that has exactly the same keys and the ${LANGUAGE_NAME[target]} translations as values. No commentary, no code fences.`;

/** Extract the first JSON object from a model reply (tolerates code fences and a short preamble). */
export function parseTranslationReply(reply: string, keys: string[]): Record<string, string> {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("translation reply has no JSON object");
  const parsed = z.record(z.string(), z.string()).parse(JSON.parse(reply.slice(start, end + 1)));
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = parsed[k];
    if (typeof v !== "string" || v.trim() === "") throw new Error(`translation reply is missing "${k}"`);
    out[k] = v.trim();
  }
  return out;
}

async function callLlm(system: string, user: string, env: NodeJS.ProcessEnv): Promise<string> {
  const provider = llmProvider(env);
  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: claudeModel(env), max_tokens: 2000, temperature: 0, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`anthropic responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    return json.content?.filter((c) => c.type === "text").map((c) => c.text).join("") ?? "";
  }
  if (provider === "ollama") {
    const res = await fetch(`${ollamaUrl(env)}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: env.OLLAMA_CHAT_MODEL || "qwen3:8b", stream: false, format: "json", messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`ollama responded ${res.status}`);
    return ((await res.json()) as { message?: { content?: string } }).message?.content ?? "";
  }
  throw new NotConfiguredError("the text-generation provider (AI_PROVIDER / ANTHROPIC_API_KEY)");
}

/** Translate French fields to `target`. The "fake" provider prefixes the text so tests can recognise it. */
export async function translateFields(fields: Record<string, string>, target: TargetLocale, env: NodeJS.ProcessEnv = process.env): Promise<Record<string, string>> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return {};
  if (llmProvider(env) === "fake") return Object.fromEntries(keys.map((k) => [k, `[${target}] ${fields[k]}`]));
  const reply = await callLlm(TRANSLATE_PROMPT_V1(target), JSON.stringify(fields), env);
  return parseTranslationReply(reply, keys);
}
