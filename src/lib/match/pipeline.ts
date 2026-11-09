import { pickTop, scoreCandidate, type Weights } from "./score";
import type { Candidate, ScoredCandidate, Spec } from "./schema";

/**
 * Retrieval + ranking (steps B and C of docs/06-ai-matching.md §2). The database does the hard filtering; the scoring is
 * TypeScript so the weights are easy to tune and test. `fetchCandidates` is injected so the logic can be tested without a database.
 */
export interface FetchArgs {
  spec: Spec;
  requiredM: number;
  excludeColorIds: string[];
}
export type FetchCandidates = (args: FetchArgs) => Promise<Candidate[]>;

export type Relaxation = "gsm" | "construction" | "fibers_avoid";

export interface RankOutcome {
  results: ScoredCandidate[];
  relaxed: Relaxation[];
  /** In-stock colors that were scored. */
  scanned: number;
}

const distinctFabrics = (c: Candidate[]) => new Set(c.map((x) => x.fabric_id)).size;

/** Fewer than 3 fabrics found: relax, in order, the weight window, the construction, the fibers to avoid (and tell the user). */
export async function retrieveAndRank(spec: Spec, fetchCandidates: FetchCandidates, opts: { requiredM?: number; excludeColorIds?: string[]; limit?: number; weights?: Weights } = {}): Promise<RankOutcome> {
  const base = { requiredM: opts.requiredM ?? 0, excludeColorIds: opts.excludeColorIds ?? [] };
  const filter: Spec = structuredClone(spec);
  const relaxed: Relaxation[] = [];
  let candidates = await fetchCandidates({ ...base, spec: structuredClone(filter) });

  const steps: [Relaxation, (s: Spec) => boolean][] = [
    ["gsm", (s) => { const had = s.gsm_min !== null || s.gsm_max !== null; s.gsm_min = null; s.gsm_max = null; return had; }],
    ["construction", (s) => { const had = s.construction !== null; s.construction = null; return had; }],
    ["fibers_avoid", (s) => { const had = s.fibers_avoid.length > 0; s.fibers_avoid = []; return had; }],
  ];
  for (const [name, relax] of steps) {
    if (distinctFabrics(candidates) >= 3) break;
    if (!relax(filter)) continue;
    relaxed.push(name);
    candidates = await fetchCandidates({ ...base, spec: structuredClone(filter) });
  }
  // scoring always uses the ORIGINAL spec, so relaxed matches honestly score lower
  const scored = candidates.map((c) => scoreCandidate(spec, c, opts.weights));
  return { results: pickTop(scored, opts.limit ?? 5), relaxed, scanned: candidates.length };
}
