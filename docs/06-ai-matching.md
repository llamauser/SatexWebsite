# 06 – AI Fabric Matching (Phase 1)

Goal: from a designer's answers, return the 3–5 best **in-stock** fabric colors with an honest score and a short explanation, in the user's language, in under 6 seconds (p50).

## 1. Wizard UI (`/match`)
Layout from the video: left sidebar with steps + progress bar ("40% complete"), right panel with the question. Back/Next buttons, keyboard accessible, answers kept in `sessionStorage` (`satex.match.v1`) so a refresh doesn't lose them.

| # | Step | Question (i18n key) | Input |
|---|---|---|---|
| 1 | Audience | "Who are you designing for?" | single choice chips: women, men, kids, unisex, home/interior, workwear + free text (optional) |
| 2 | Style | "What style are you aiming for in your design?" | multi chips (max 3): minimal, innovative, sporty, classic, luxurious, casual, romantic, streetwear, eco/natural, technical |
| 3 | Brand | "What brand feel are you after?" | multi chips (max 3): premium, accessible, sustainable, bold, heritage, playful, performance + optional price target per meter (number) |
| 4 | Describe | "Describe your textile project" (hint "Garment type · season · usage · target weight (GSM)") | textarea, 10–600 chars, required. Placeholder example: "Breathable jersey for a summer activewear line, ~200 GSM." |
| 5 | Match | Summary of answers + "Find my match" button | |

Optional: required meters (number, default empty) shown on step 5.

## 2. Pipeline (`POST /api/match`, Node runtime, streams NDJSON)
```
input → [rate limit] → (A) spec extraction (Claude) → (B) retrieval (SQL + pgvector) → (C) scoring → (D) explanations (Claude) → persist → stream
```
Stream events (one JSON per line): `{"type":"progress","stage":"understanding|searching|ranking|explaining","scanned":N}`, `{"type":"results","sessionId":...,"results":[...]}`, `{"type":"explanations","items":[{colorId,text}]}`, `{"type":"error","code":...}`.
The UI shows results as soon as `results` arrives and fills in explanations after.

Rate limit: `match_rate_limit_per_hour_guest` per IP hash / `..._user` per user (table `rate_limits`). Exceeded → HTTP 429 + i18n message.

### (A) Spec extraction
- Model `claude-sonnet-5-5`, temperature 0, max_tokens 800, **tool use with a forced tool** `submit_spec` whose input schema is below (guarantees valid JSON). Validate with zod again; on failure retry once, then fall back to keyword heuristics (`src/lib/match/fallback.ts`).
- System prompt (keep in `src/lib/match/prompts.ts`, versioned `SPEC_PROMPT_V1`):
```
You are a senior textile sourcing expert for SATEX, a wholesale fabric supplier.
Convert the designer's brief into a precise technical fabric specification.
Rules:
- Infer realistic values from garment type, season and use (e.g. summer activewear jersey → knit, 150–220 GSM, two_way or four_way stretch, cotton/polyester/elastane).
- If the user gives a GSM, center the range on it with ±15%.
- Only use the enum values provided. Use null when you cannot infer something.
- fibers_avoid only when the brief implies it (e.g. "vegan" → avoid wool, silk).
- query_text: one English sentence describing the ideal fabric, used for semantic search.
- The brief may be in French, English or Arabic.
```
- User message: JSON of the wizard answers.
- `submit_spec` schema (TS, zod in `src/lib/match/schema.ts`):
```ts
type Spec = {
  construction: 'knit'|'woven'|'nonwoven'|null;
  structures: FabricStructure[];          // preferred, may be empty
  fibers_preferred: Fiber[];              // may be empty
  fibers_avoid: Fiber[];
  gsm_min: number|null; gsm_max: number|null;
  stretch: 'none'|'mechanical'|'two_way'|'four_way'|null;   // minimum required
  seasons: ('spring_summer'|'autumn_winter'|'all_season')[];
  uses: Use[];                            // vocabulary from 04-database.md
  feel: { softness?: number; drape?: number; sheen?: number; breathability?: number }; // 0–10 targets
  colors: { name: string; hex: string }[]; // only if mentioned
  budget_max_per_m: number|null;
  query_text: string;
}
```

### (B) Retrieval
1. Embed `query_text` (Voyage multimodal, input_type `query`) → vector q.
2. SQL function `match_candidates(q vector, spec jsonb, limit int default 60)`:
   - hard filters: `fabrics.is_active`, color `is_active`, `available_m >= greatest(moq_m, coalesce(required_m,0))`, `construction = spec.construction` when not null, no fiber from `fibers_avoid` with pct ≥ 5, gsm within `[gsm_min*0.75, gsm_max*1.25]` when set.
   - returns one row per **color** with fabric fields, `available_m`, `text_sim = 1 - (fabric text embedding <=> q)`.
   - order by text_sim desc, limit 60.
3. If < 3 candidates: relax in order (drop gsm filter → drop construction → drop fibers_avoid) and record `relaxed: [...]` in results (shown to the user as "We widened your search: ...").

### (C) Scoring (pure TS function `scoreCandidate(spec, c)` in `src/lib/match/score.ts`, unit-tested)
All components are in [0,1]. Missing spec field → component weight is redistributed proportionally to the others.

| Component | Weight | Formula |
|---|---|---|
| semantic | 0.25 | `clamp((text_sim - 0.2) / 0.6, 0, 1)` |
| gsm | 0.20 | 1 if within [min,max]; else `max(0, 1 - dist/(0.5*mid))` where dist = distance to the nearest bound, mid = (min+max)/2 |
| fiber | 0.15 | `Σ pct of preferred fibers / 100`, plus 0.2 bonus if the top fiber is preferred, capped at 1; 0.5 if no preference |
| stretch | 0.10 | order none<mechanical<two_way<four_way; ≥ required → 1; one level below → 0.4; else 0 |
| use_season | 0.10 | 0.6·(1 if any use overlaps else 0) + 0.4·(1 if season overlaps or all_season) |
| structure | 0.08 | 1 if structure in spec.structures, 0.5 if the list is empty, else 0 |
| feel | 0.07 | `1 - mean(|target - fabric_feel|)/10` over the given targets; 0.5 if no targets or no feel |
| color | 0.05 | if spec.colors: `max(0, 1 - minΔE00/40)`, else 0.5 |
| budget | (multiplier) | if budget set and price > budget: × `max(0.6, 1 - (price-budget)/budget)` |

`score = Σ w·c` → displayed `match_pct = round(min(score, 0.99) * 100)`.
Diversity: keep max 2 colors per fabric in the top list and prefer different fabrics; return the top 5 (min 3 when available). Each result includes `components` (for admin debug and the "why" chips).

### (D) Explanations
One Claude call for all results (`claude-sonnet-5-5`, max_tokens 700, tool `submit_explanations` → `[{colorId, text}]`), in the session locale, ≤ 220 characters each, factual, mentions 2–3 concrete specs and one honest caveat if a component < 0.5. Prompt `EXPLAIN_PROMPT_V1` receives the spec + each result's specs and components. If it fails, show template explanations built from components (i18n strings).

### Persist
`match_sessions` + `match_session_iterations` (latency, tokens, cost). Cost formula is in `src/lib/ai/cost.ts` using the per-token prices in env `AI_PRICE_*` (never hard-code prices).

## 3. Results page (`/match/[sessionId]`)
- Header: "Your match", a summary of the extracted spec as chips (editable: clicking a chip lets the user change it → re-run without step A).
- Result card (video design): image, "{pct}% match" badge, fabric name, tagline (best uses), spec table (Composition, Weight, Width, Best for), color swatch + available meters, explanation, buttons **Request a sample**, **Get a quote** (adds to cart with meters = max(moq, required_m)), "View fabric".
- Refinement chips (deterministic, no step A): **Lighter** (gsm range × 0.8), **Heavier** (× 1.2), **Cheaper** (budget = 0.8 × median price of the current results), **More stretch** (stretch +1 level), **Softer** (feel.softness = max(current,7)+1), **More natural fibers** (fibers_preferred = cotton, linen, wool, silk, viscose, modal; avoid polyester), **Other colors** (exclude current color ids). Each creates a new iteration.
- Feedback: thumbs up/down → `match_sessions.feedback`.
- Empty state: "No fabric in stock fits this brief" + CTA contact sales with the brief prefilled.

## 4. Embeddings
- Provider: Voyage AI `voyage-multimodal-3` (1024 dims), env `VOYAGE_API_KEY`, `EMBEDDING_MODEL`. Wrap in `src/lib/ai/embed.ts` so the provider can be changed.
- **Fabric text document** (English, built by `buildFabricDoc(fabric)`): `"{name.en||name.fr}. {structure} {construction}, {gsm} GSM, {width} cm wide, composition {..}, stretch {..}, finishes {..}. Best for {uses}. Seasons {..}. {short_description.en}. Feel: softness x/10, drape y/10..."`.
- **Image embeddings**: one per color using the first photo (`owner_type='color_image'`), used by Snap & Match (P2) and "similar fabrics".
- `content_hash` = sha256 of the document/image path; the `embed` job skips if unchanged.

## 5. Admin match logs (`/admin/match-logs`)
Table: date, locale, mode, brief excerpt, top result + pct, feedback, latency, cost. Detail: full input, spec JSON, all iterations with components. Used to tune weights (weights live in `src/lib/match/weights.ts` as one exported constant).

## 6. Tests
- Unit: scoring components (table-driven), refinement transforms, fallback parser, color ΔE.
- Golden set: 15 briefs in `tests/match/golden.json` with expected top fabric ids from the seed; CI asserts the expected fabric is in the top 3 for ≥ 12/15 (LLM calls mocked with recorded specs).
