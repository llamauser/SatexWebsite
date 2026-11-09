/** Cost of one model call in USD, from per-million-token prices kept in the environment (never hard-coded). */
export function llmCostUsd(usage: { inputTokens: number; outputTokens: number }, env: NodeJS.ProcessEnv = process.env): number {
  const input = Number(env.AI_PRICE_INPUT_PER_MTOK);
  const output = Number(env.AI_PRICE_OUTPUT_PER_MTOK);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return 0;
  return Math.round(((usage.inputTokens * input + usage.outputTokens * output) / 1_000_000) * 100_000) / 100_000;
}
