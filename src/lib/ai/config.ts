/**
 * AI provider selection (docs/00-setup-and-tools.md §5). All AI calls go through src/lib/ai/*, so a provider can be swapped
 * without touching callers.
 *   AI_PROVIDER    = anthropic | ollama | fake      (text generation: translation, later match explanations)
 *   EMBED_PROVIDER = voyage | ollama | fake         (embeddings)
 * "none" means "not configured": jobs that need AI are skipped (they can be re-run later), nothing crashes.
 */
export type LlmProvider = "anthropic" | "ollama" | "fake" | "none";
export type EmbedProvider = "voyage" | "ollama" | "fake" | "none";

export const EMBEDDING_DIM = 1024;

export function llmProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const wanted = (env.AI_PROVIDER ?? "anthropic").toLowerCase();
  if (wanted === "fake") return "fake";
  if (wanted === "ollama") return "ollama";
  return env.ANTHROPIC_API_KEY ? "anthropic" : "none";
}

export function embedProvider(env: NodeJS.ProcessEnv = process.env): EmbedProvider {
  const wanted = (env.EMBED_PROVIDER ?? "voyage").toLowerCase();
  if (wanted === "fake") return "fake";
  if (wanted === "ollama") return "ollama";
  return env.VOYAGE_API_KEY ? "voyage" : "none";
}

export const claudeModel = (env: NodeJS.ProcessEnv = process.env) => env.CLAUDE_MODEL || "claude-sonnet-5-5";
export const embeddingModel = (provider: EmbedProvider, env: NodeJS.ProcessEnv = process.env) =>
  env.EMBEDDING_MODEL || (provider === "ollama" ? "bge-m3" : provider === "fake" ? "fake-1024" : "voyage-multimodal-3");
export const ollamaUrl = (env: NodeJS.ProcessEnv = process.env) => env.OLLAMA_BASE_URL || "http://localhost:11434";

/** Thrown by a job when the service it needs is not configured. The runner skips (does not retry) such jobs. */
export class NotConfiguredError extends Error {
  constructor(what: string) {
    super(`${what} is not configured`);
    this.name = "NotConfiguredError";
  }
}
