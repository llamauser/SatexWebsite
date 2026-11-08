import { createHash } from "node:crypto";
import { embeddingModel, embedProvider, EMBEDDING_DIM, NotConfiguredError, ollamaUrl } from "./config";

export interface Embedding {
  vector: number[];
  model: string;
}

/** Deterministic unit vector derived from the text: used by tests and offline development ("fake" provider). */
export function fakeEmbedding(text: string, dim = EMBEDDING_DIM): number[] {
  const out: number[] = [];
  let block = 0;
  while (out.length < dim) {
    const h = createHash("sha256").update(`${block++}:${text}`).digest();
    for (let i = 0; i + 1 < h.length && out.length < dim; i += 2) out.push((h.readUInt16BE(i) / 65535) * 2 - 1);
  }
  const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
  return out.map((v) => v / norm);
}

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Embed one text document with the configured provider. */
export async function embedText(text: string, env: NodeJS.ProcessEnv = process.env): Promise<Embedding> {
  const provider = embedProvider(env);
  const model = embeddingModel(provider, env);
  let vector: number[];
  switch (provider) {
    case "fake":
      vector = fakeEmbedding(text);
      break;
    case "voyage": {
      const json = (await postJson(
        "https://api.voyageai.com/v1/multimodalembeddings",
        { inputs: [{ content: [{ type: "text", text }] }], model, input_type: "document" },
        { authorization: `Bearer ${env.VOYAGE_API_KEY}` },
      )) as { data?: { embedding: number[] }[] };
      vector = json.data?.[0]?.embedding ?? [];
      break;
    }
    case "ollama": {
      const json = (await postJson(`${ollamaUrl(env)}/api/embed`, { model, input: text }, {})) as { embeddings?: number[][] };
      vector = json.embeddings?.[0] ?? [];
      break;
    }
    default:
      throw new NotConfiguredError("the embedding provider (EMBED_PROVIDER / VOYAGE_API_KEY)");
  }
  if (vector.length !== EMBEDDING_DIM) {
    throw new Error(`embedding has ${vector.length} dimensions, the database expects ${EMBEDDING_DIM} (model ${model})`);
  }
  return { vector, model };
}

/** pgvector text format. */
export const toPgVector = (v: number[]) => `[${v.join(",")}]`;
