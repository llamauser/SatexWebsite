import type { SupabaseClient } from "@supabase/supabase-js";
import { embeddingModel, embedProvider } from "@/lib/ai/config";
import { embedText, toPgVector } from "@/lib/ai/embed";
import { buildFabricDoc, contentHash, type FabricForEmbedding } from "@/lib/ai/fabric-doc";
import type { JobPayload } from "../runner";

/** Rebuild the text embedding of one fabric. Skips when the document (and model) did not change. */
export async function handleEmbed(message: JobPayload, sb: SupabaseClient, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const id = String(message.id ?? "");
  if (!id) throw new Error("embed job without a fabric id");

  const { data: fabric, error } = await sb
    .from("fabrics")
    .select("name, short_description, structure, construction, composition, gsm, width_cm, stretch, finish, uses, seasons, fabric_feel(softness, drape, stretch, sheen, breathability)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`load fabric: ${error.message}`);
  if (!fabric) return; // deleted meanwhile: nothing to do

  const feel = Array.isArray(fabric.fabric_feel) ? fabric.fabric_feel[0] : fabric.fabric_feel;
  const doc = buildFabricDoc({ ...(fabric as unknown as FabricForEmbedding), feel: feel ?? null });
  const hash = contentHash(doc);
  const model = embeddingModel(embedProvider(env), env);

  const { data: existing } = await sb
    .from("embeddings")
    .select("content_hash, model")
    .eq("owner_type", "fabric")
    .eq("owner_id", id)
    .eq("kind", "text")
    .maybeSingle();
  if (existing && existing.content_hash === hash && existing.model === model) return;

  const { vector, model: usedModel } = await embedText(doc, env);
  const { error: upsertError } = await sb
    .from("embeddings")
    .upsert(
      { owner_type: "fabric", owner_id: id, kind: "text", model: usedModel, embedding: toPgVector(vector), content_hash: hash },
      { onConflict: "owner_type,owner_id,kind" },
    );
  if (upsertError) throw new Error(`save embedding: ${upsertError.message}`);
}
