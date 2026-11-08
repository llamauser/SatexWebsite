# SatexWebsite

Website for **SATEX Commerce** (wholesale fabrics): AI fabric matching, live stock, 3D showroom, quotes/orders back-office, with Snap & Match, Collection Planner, Feel Card + Virtual Drape and Guided Live Tour planned in later phases.

**Stack:** Next.js 15 · Supabase · Vercel · Claude + Voyage embeddings · French / English / Arabic (RTL).

## Where to start
1. [`docs/00-setup-and-tools.md`](docs/00-setup-and-tools.md): what to install, accounts, Ollama for local AI.
2. [`docs/README.md`](docs/README.md): specification index and rules for implementers.
3. [`docs/13-phase1-backlog.md`](docs/13-phase1-backlog.md): ordered tasks for Phase 1.
4. [`PLAN.md`](PLAN.md): one-page overview. [`video_audio_notes.md`](video_audio_notes.md): notes from the original promo video.

Status: specification complete; Phase 1 task P1-01 (scaffold) done.

## Develop
```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm lint && pnpm typecheck && pnpm test
pnpm build && pnpm e2e   # first time: pnpm exec playwright install chromium
```
Node 22+ and pnpm 9 required (see `docs/00-setup-and-tools.md`). Copy `.env.example` to `.env.local` when later tasks need keys.
