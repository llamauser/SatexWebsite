import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toPgVector } from "@/lib/ai/embed";
import type { ResultCard } from "./card";
import type { Candidate, Spec, WizardInput } from "./schema";
import type { FetchCandidates } from "./pipeline";

/** Database access of the matching feature (service role: sessions are not exposed to the browser through row level security). */
export function candidateFetcher(sb: SupabaseClient, embedding: number[] | null): FetchCandidates {
  return async ({ spec, requiredM, excludeColorIds }) => {
    const { data, error } = await sb.rpc("match_candidates", {
      p_embedding: embedding ? toPgVector(embedding) : null,
      p_spec: spec,
      p_required_m: requiredM,
      p_fabric_limit: 40,
      p_exclude_colors: excludeColorIds,
    });
    if (error) throw new Error(`match_candidates: ${error.message}`);
    return ((data ?? []) as Candidate[]).map((c) => ({ ...c, text_sim: Number(c.text_sim) }));
  };
}

export interface OwnerRef {
  userId: string | null;
  token: string | null;
}

export async function createSession(sb: SupabaseClient, owner: OwnerRef, locale: string, input: WizardInput, mode: "wizard" | "snap" = "wizard"): Promise<string> {
  const { data, error } = await sb
    .from("match_sessions")
    .insert({ user_id: owner.userId, session_token: owner.userId ? null : owner.token, locale, mode, input })
    .select("id")
    .single();
  if (error) throw new Error(`create session: ${error.message}`);
  return data.id as string;
}

export interface IterationRecord {
  id?: string;
  n: number;
  refinements: string[];
  specs: Spec | null;
  results: ResultCard[] | null;
  latency_ms: number | null;
  llm_input_tokens: number | null;
  llm_output_tokens: number | null;
  cost_usd: number | null;
}

export async function saveIteration(sb: SupabaseClient, sessionId: string, it: Omit<IterationRecord, "id">): Promise<string> {
  const { data, error } = await sb.from("match_session_iterations").insert({ session_id: sessionId, ...it }).select("id").single();
  if (error) throw new Error(`save iteration: ${error.message}`);
  return data.id as string;
}

export async function updateIteration(sb: SupabaseClient, id: string, patch: Partial<IterationRecord>): Promise<void> {
  const { error } = await sb.from("match_session_iterations").update(patch).eq("id", id);
  if (error) throw new Error(`update iteration: ${error.message}`);
}

export interface LoadedSession {
  id: string;
  userId: string | null;
  token: string | null;
  locale: "fr" | "en" | "ar";
  input: WizardInput;
  feedback: number | null;
  createdAt: string;
  iterations: (IterationRecord & { id: string; created_at: string })[];
}

export async function loadSession(sb: SupabaseClient, id: string): Promise<LoadedSession | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: s } = await sb.from("match_sessions").select("id, user_id, session_token, locale, input, feedback, created_at").eq("id", id).maybeSingle();
  if (!s) return null;
  const { data: its } = await sb
    .from("match_session_iterations")
    .select("id, n, refinements, specs, results, latency_ms, llm_input_tokens, llm_output_tokens, cost_usd, created_at")
    .eq("session_id", id)
    .order("n");
  return {
    id: s.id, userId: s.user_id, token: s.session_token, locale: s.locale, input: s.input as WizardInput, feedback: s.feedback, createdAt: s.created_at,
    iterations: (its ?? []) as LoadedSession["iterations"],
  };
}

export const isOwner = (s: Pick<LoadedSession, "userId" | "token">, owner: OwnerRef) =>
  (s.userId !== null && s.userId === owner.userId) || (s.token !== null && s.token === owner.token);
