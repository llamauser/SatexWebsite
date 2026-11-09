import "server-only";
import { claudeModel, llmProvider, ollamaUrl } from "@/lib/ai/config";
import type { DominantColor } from "./colors";
import { neutralVisual, parseVisual, VISUAL_PROMPT, VISUAL_TOOL_SCHEMA, type Visual } from "./visual";

export interface VisionResult {
  visual: Visual;
  source: "vision" | "fallback";
  usage: { inputTokens: number; outputTokens: number };
}
const NO_USAGE = { inputTokens: 0, outputTokens: 0 };

/** Local model (development): qwen2.5vl through Ollama, JSON mode. */
async function ollamaVision(jpeg: Buffer, env: NodeJS.ProcessEnv): Promise<Visual | null> {
  const res = await fetch(`${ollamaUrl(env)}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: env.OLLAMA_VISION_MODEL || "qwen2.5vl:7b", stream: false, format: "json", options: { temperature: 0 },
      messages: [{ role: "user", content: VISUAL_PROMPT, images: [jpeg.toString("base64")] }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`ollama responded ${res.status}`);
  return parseVisual(((await res.json()) as { message?: { content?: string } }).message?.content ?? "");
}

/** Production: Claude with the image and a forced tool call. */
async function claudeVision(jpeg: Buffer, env: NodeJS.ProcessEnv): Promise<{ visual: Visual | null; usage: VisionResult["usage"] }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: claudeModel(env), max_tokens: 700, temperature: 0,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } }, { type: "text", text: VISUAL_PROMPT }] }],
      tools: [{ name: "submit_visual", description: "Report what the photo shows.", input_schema: VISUAL_TOOL_SCHEMA }],
      tool_choice: { type: "tool", name: "submit_visual" },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`anthropic responded ${res.status}`);
  const json = (await res.json()) as { content?: { type: string; input?: unknown }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  return { visual: parseVisual(json.content?.find((c) => c.type === "tool_use")?.input), usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 } };
}

/**
 * Step 3 of Snap & Match. Never throws: with no model configured, or when the model fails or answers nonsense, the reading is
 * "a fabric of these colors" and the match still works from the colors (it is said so in `source`).
 */
export async function analyzePhoto(jpeg: Buffer, colors: DominantColor[], env: NodeJS.ProcessEnv = process.env): Promise<VisionResult> {
  const fallback = (): VisionResult => ({ visual: neutralVisual(colors), source: "fallback", usage: NO_USAGE });
  const provider = llmProvider(env);
  if (provider === "fake" || provider === "none") return fallback();
  try {
    if (provider === "ollama") {
      const visual = await ollamaVision(jpeg, env);
      return visual ? { visual, source: "vision", usage: NO_USAGE } : fallback();
    }
    const { visual, usage } = await claudeVision(jpeg, env);
    return visual ? { visual, source: "vision", usage } : fallback();
  } catch (error) {
    console.error(JSON.stringify({ event: "snap.vision.error", error: error instanceof Error ? error.message : String(error) }));
    return fallback();
  }
}
