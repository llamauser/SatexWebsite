# 00 – Setup: Tools, Accounts, Local AI (Ollama)

For any machine (Windows, macOS or Linux). Follow this once per developer.

## 1. Required tools (Phase 1)
| Tool | Version | Why | Install |
|---|---|---|---|
| Git | latest | version control | git-scm.com |
| Node.js | 22 LTS | Next.js | nodejs.org or `nvm` / `fnm` |
| pnpm | 9.x | package manager | `corepack enable && corepack prepare pnpm@9 --activate` |
| Docker Desktop (or Docker Engine) | latest | runs the local Supabase stack | docker.com (Windows: enable WSL2) |
| Supabase CLI | latest | local DB, migrations, types | `pnpm dlx supabase` or the official installer / scoop / brew |
| GitHub CLI (`gh`) | latest | PRs from the terminal | cli.github.com (optional) |
| VS Code (or any editor) | latest | – | extensions: ESLint, Prettier, Tailwind CSS IntelliSense |
| A modern browser | Chrome/Edge | WebGPU testing for P3 | – |
Hardware: 16 GB RAM recommended (Docker + Next.js + browser). 8 GB works but is tight.

## 2. Phase 3 only (cloth + textures), not needed for Phase 1
| Tool | Version | Why |
|---|---|---|
| Blender | 4.x LTS (pin one version team-wide) | authoring the 4 garment templates; the worker uses it headless |
| Python | 3.12 | worker + texture processing (`opencv-python-headless`, `numpy`, `psycopg`) |
| KTX-Software (`toktx`) | latest | KTX2 texture compression |
| Modal CLI **or** Railway/Fly CLI | latest | deploying the worker |
Only **one** person needs Blender to author the templates; everyone else just runs the worker in Docker.

## 3. Phase 4 only
LiveKit Cloud account (no local install).

## 4. Accounts & keys (create once, share via a password manager, never via git)
| Service | Needed from | Used for |
|---|---|---|
| GitHub | P1 | repo `llamauser/SatexWebsite` (private) |
| Supabase | P1 | 2 projects: `satex-staging`, `satex-production` |
| Vercel (Pro for production) | P1 | hosting + per-minute cron |
| Anthropic API | P1 | match, explanations, translation, vision |
| Voyage AI | P1 | embeddings |
| Resend | P1 | transactional email |
| Sentry | P1 end | error tracking |
| Domain registrar | launch | domain |
| Modal (or Railway/Fly) | P3 | bake worker |
| LiveKit Cloud | P4 | live tour |

## 5. Ollama (local AI) – optional, for development
**The production system uses Claude + Voyage (see `06-ai-matching.md`).** Ollama is only for **free local development and offline testing**, so nobody burns API credits while building. It is **not** a production dependency.

Design rule for the implementer: all AI calls go through `src/lib/ai/claude.ts` and `src/lib/ai/embed.ts`. Add an env switch `AI_PROVIDER=anthropic|ollama` and `EMBED_PROVIDER=voyage|ollama` with an Ollama adapter behind the same interfaces. `OLLAMA_BASE_URL=http://localhost:11434`.

| Role | Ollama model (check the current tag with `ollama search` / the Ollama library) | Size (approx.) | Notes |
|---|---|---|---|
| Spec extraction + explanations + translation + planner (text) | a recent instruction-tuned 7–14B model with **tool/JSON support**, e.g. `qwen3` (8b or 14b) or `llama3.1:8b` | 5–9 GB | Use Ollama's structured outputs (JSON schema `format`) instead of tool calling; keep zod validation |
| Vision (Snap & Match, P2) | a vision model, e.g. `qwen2.5vl:7b` or `gemma3:12b` or `llama3.2-vision:11b` | 6–9 GB | Same `Visual` schema as `08b` |
| Text embeddings | `bge-m3` (**1024 dims**, multilingual FR/EN/AR) | ~1.2 GB | Matches `vector(1024)`, so no schema change |
| Image embeddings | **Not available through Ollama** (no CLIP-style model) | – | For dev, P2 uses a Python CLIP/SigLIP microservice in the worker (`sentence-transformers`), or falls back to "vision model describes the image → text embedding". Production stays on Voyage multimodal |

Quick start:
```bash
# install Ollama from ollama.com, then:
ollama pull bge-m3
ollama pull qwen3:8b
ollama pull qwen2.5vl:7b      # only needed from Phase 2
```
Caveats to respect:
- Embeddings from different models are **not interchangeable**. The `embeddings.model` column exists for that: re-embed everything when switching provider (`pnpm ai:reembed`). Never mix providers in one database.
- Local models are weaker, especially in Arabic. The golden test set (`06` §6) must pass with the **production** provider; with Ollama it is only a smoke test.
- Ollama needs ~8 GB free RAM/VRAM for an 8B model. If a machine is too weak, skip Ollama and use the Anthropic/Voyage keys with a small daily budget limit.

## 6. First-time setup commands (after the Phase 1 scaffold exists)
```bash
git clone https://github.com/llamauser/SatexWebsite.git
cd SatexWebsite
corepack enable && pnpm install
cp .env.example .env.local        # fill with values from the shared password manager
supabase start                    # needs Docker running
pnpm db:reset                     # migrations + seed
pnpm dev                          # http://localhost:3000
```

## 7. Team workflow (two people)
- `main` is protected: merge only through pull requests with 1 review and green CI.
- Branches: `feat/P1-07-catalog`, `fix/...`. One branch per backlog task.
- Commit style: `P1-07: catalog filters`. Never commit `.env*`, keys or `.seed-credentials.local.json`.
- Database changes only through new migration files in `supabase/migrations/` (never edit one that is already merged). Run `supabase db reset` after pulling.
- Split the work by backlog task to avoid conflicts (e.g. one person on P1-07, the other on P1-09). Tasks P1-01 to P1-03 must be done first and by **one** person.
