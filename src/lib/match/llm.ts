import { claudeModel, llmProvider, ollamaUrl } from "@/lib/ai/config";
import { EXPLAIN_PROMPT_V1, EXPLAIN_TOOL_SCHEMA, SPEC_PROMPT_V1 } from "./prompts";
import { fallbackSpec } from "./fallback";
import { SPEC_TOOL_SCHEMA, SpecSchema, type ScoredCandidate, type Spec, type WizardInput } from "./schema";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}
export interface SpecResult {
  spec: Spec;
  source: "llm" | "fallback";
  usage: Usage;
}
export type Locale = "fr" | "en" | "ar";

const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

/** Forced tool call on the Anthropic Messages API: the reply is guaranteed to be a JSON object for `tool`. */
async function callTool(opts: { system: string; user: string; tool: string; description: string; schema: object; maxTokens: number; env: NodeJS.ProcessEnv }): Promise<{ input: unknown; usage: Usage }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": opts.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: claudeModel(opts.env),
      max_tokens: opts.maxTokens,
      temperature: 0,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      tools: [{ name: opts.tool, description: opts.description, input_schema: opts.schema }],
      tool_choice: { type: "tool", name: opts.tool },
    }),
  });
  if (!res.ok) throw new Error(`anthropic responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { content?: { type: string; input?: unknown }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const block = json.content?.find((c) => c.type === "tool_use");
  if (!block) throw new Error("the model did not call the tool");
  return { input: block.input, usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 } };
}

/** JSON-mode request to a local Ollama model (development). */
async function callOllamaJson(system: string, user: string, env: NodeJS.ProcessEnv): Promise<unknown> {
  const res = await fetch(`${ollamaUrl(env)}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: env.OLLAMA_CHAT_MODEL || "qwen3:8b", stream: false, format: "json", options: { temperature: 0 }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`ollama responded ${res.status}`);
  const content = ((await res.json()) as { message?: { content?: string } }).message?.content ?? "{}";
  return JSON.parse(content);
}

/** Step A. Never throws: any problem with the model falls back to the keyword parser. */
export async function extractSpec(input: WizardInput, env: NodeJS.ProcessEnv = process.env): Promise<SpecResult> {
  const fallback = (): SpecResult => ({ spec: fallbackSpec(input), source: "fallback", usage: NO_USAGE });
  const provider = llmProvider(env);
  if (provider === "fake" || provider === "none") return fallback();

  const user = JSON.stringify({ audience: input.audience, audience_text: input.audienceText, styles: input.styles, brand_feel: input.brand, price_target_per_m: input.priceTarget, brief: input.description });
  const attempt = async (): Promise<SpecResult> => {
    if (provider === "anthropic") {
      const { input: raw, usage } = await callTool({ system: SPEC_PROMPT_V1, user, tool: "submit_spec", description: "Submit the technical fabric specification.", schema: SPEC_TOOL_SCHEMA, maxTokens: 800, env });
      return { spec: SpecSchema.parse(raw), source: "llm", usage };
    }
    const raw = await callOllamaJson(`${SPEC_PROMPT_V1}\nReply with a JSON object using exactly these keys: ${Object.keys(SPEC_TOOL_SCHEMA.properties).join(", ")}.`, user, env);
    return { spec: SpecSchema.parse(raw), source: "llm", usage: NO_USAGE };
  };
  try {
    return await attempt();
  } catch {
    try {
      return await attempt(); // one retry, then the keyword fallback
    } catch {
      return fallback();
    }
  }
}

/** Facts given to the explanation model (no scores, no ids other than colorId). */
export function explanationFacts(results: ScoredCandidate[], locale: Locale) {
  return results.map((r) => ({
    colorId: r.candidate.color_id,
    fabric: r.candidate.name[locale] || r.candidate.name.fr,
    color: r.candidate.color_name[locale] || r.candidate.color_name.fr,
    structure: r.candidate.structure,
    gsm: r.candidate.gsm,
    width_cm: r.candidate.width_cm,
    composition: r.candidate.composition.map((c) => `${c.pct}% ${c.fiber}`).join(", "),
    stretch: r.candidate.stretch,
    uses: r.candidate.uses,
    seasons: r.candidate.seasons,
    weak_points: Object.entries(r.components).filter(([k, v]) => k !== "budget" && typeof v === "number" && v < 0.5).map(([k]) => k),
  }));
}

/** Step D. Returns colorId -> text, or null when the model cannot be used (the caller then uses the template sentences). */
export async function explainResults(results: ScoredCandidate[], spec: Spec, locale: Locale, env: NodeJS.ProcessEnv = process.env): Promise<{ texts: Record<string, string>; usage: Usage } | null> {
  const provider = llmProvider(env);
  if (provider !== "anthropic" && provider !== "ollama") return null;
  const user = JSON.stringify({ brief: spec.query_text, wanted: { gsm: [spec.gsm_min, spec.gsm_max], stretch: spec.stretch, uses: spec.uses, fibers: spec.fibers_preferred }, candidates: explanationFacts(results, locale) });
  try {
    let items: unknown;
    let usage = NO_USAGE;
    if (provider === "anthropic") {
      const r = await callTool({ system: EXPLAIN_PROMPT_V1(locale), user, tool: "submit_explanations", description: "Submit one explanation per candidate.", schema: EXPLAIN_TOOL_SCHEMA, maxTokens: 900, env });
      items = (r.input as { items?: unknown }).items;
      usage = r.usage;
    } else {
      items = ((await callOllamaJson(`${EXPLAIN_PROMPT_V1(locale)}\nReply with {"items":[{"colorId":"...","text":"..."}]}.`, user, env)) as { items?: unknown }).items;
    }
    const texts: Record<string, string> = {};
    const known = new Set(results.map((r) => r.candidate.color_id));
    for (const item of Array.isArray(items) ? items : []) {
      const { colorId, text } = item as { colorId?: unknown; text?: unknown };
      if (typeof colorId === "string" && known.has(colorId) && typeof text === "string" && text.trim()) texts[colorId] = text.trim().slice(0, 260);
    }
    return Object.keys(texts).length > 0 ? { texts, usage } : null;
  } catch {
    return null;
  }
}
