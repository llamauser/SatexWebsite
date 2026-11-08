# 12 – Development, Environments, Jobs, Testing, Deployment

## 1. Tooling
Node 22 LTS, **pnpm 9**, TypeScript strict, Next.js 15 (App Router, React 19), Tailwind 4, shadcn/ui, ESLint + Prettier, Supabase CLI, Vitest, Playwright. Use the latest stable versions at start, then pin them in `package.json` (exact versions) and keep the lockfile committed.

## 2. Repository structure (single repo)
```
/
├─ src/
│  ├─ app/
│  │  ├─ [locale]/(public)/...      home, catalog, match, showroom, about, contact, legal, auth
│  │  ├─ [locale]/account/...
│  │  ├─ [locale]/admin/...
│  │  └─ api/ (match, jobs/run, quotes/[id]/pdf, health, livekit/token)
│  ├─ components/ (ui/, catalog/, match/, showroom/, feel/, admin/, layout/)
│  ├─ lib/
│  │  ├─ db/ (supabase clients: browser.ts, server.ts, service.ts[server-only], types.ts)
│  │  ├─ ai/ (claude.ts, embed.ts, cost.ts)
│  │  ├─ match/ (schema.ts, prompts.ts, score.ts, weights.ts, refine.ts, fallback.ts, pipeline.ts)
│  │  ├─ cloth/ (feel.ts, mapping.ts, xpbd/)        P3
│  │  ├─ commerce/ (pricing.ts, meterage.ts, status.ts)
│  │  ├─ jobs/ (queue.ts, handlers/{embed,translate,email}.ts)
│  │  ├─ i18n/, validation/, color/ (lab.ts, deltaE.ts, family.ts)
│  ├─ emails/ (React Email templates)
│  └─ styles/
├─ messages/ (fr.json, en.json, ar.json)
├─ content/legal/ (privacy|terms).{fr,en,ar}.md
├─ supabase/ (config.toml, migrations/, seed.sql generated, functions/ if any)
├─ scripts/ (seed.ts, generate-textures.ts, check-i18n.ts)
├─ worker/  (P3: Dockerfile, main.py, bake.py, texture.py, templates/)
├─ tests/ (unit/, e2e/, match/golden.json)
├─ public/ (brand/, showroom/preview.webp, textures/seed/)
└─ docs/ (this specification)
```

## 3. Environment variables (`.env.example`)
| Name | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Vercel | canonical URL |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | browser/server client |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel, worker | server-only |
| `DATABASE_URL` | worker, CI | direct Postgres (pgmq) |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (=`claude-sonnet-5-5`) | Vercel | AI |
| `VOYAGE_API_KEY`, `EMBEDDING_MODEL` (=`voyage-multimodal-3`), `EMBEDDING_DIM` (=1024) | Vercel | embeddings |
| `AI_PRICE_INPUT_PER_MTOK`, `AI_PRICE_OUTPUT_PER_MTOK`, `EMBED_PRICE_PER_MTOK` | Vercel | cost logging |
| `RESEND_API_KEY`, `EMAIL_FROM` | Vercel | email |
| `CRON_SECRET` | Vercel | protects `/api/jobs/run` |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Vercel, worker | errors |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Vercel (P4) | live tour |
| `IP_HASH_SALT` | Vercel | anonymous rate-limit keys |

## 4. Environments
| Env | Web | Database | Notes |
|---|---|---|---|
| local | `pnpm dev` | Supabase CLI (`supabase start`, Docker) | `pnpm db:reset` = migrations + seed |
| preview | Vercel preview per PR | Supabase **staging** project | seeded, test emails only to the team |
| production | Vercel production (`main`) | Supabase **production** project | migrations applied by CI after approval |

## 5. Background jobs
- Queues (pgmq): `q_embed`, `q_translate`, `q_email` (consumed by Vercel), `q_texture`, `q_bake` (consumed by the worker, P3).
- Message shape: `{ "type": "<queue>", "id": "<uuid of the target row>", "attempt": 1, "payload": {...} }`.
- Producers: DB triggers (fabric/color changes → embed/translate) and server actions (emails) call `pgmq.send`.
- Consumer: **Vercel Cron** `* * * * *` → `GET /api/jobs/run` with `Authorization: Bearer ${CRON_SECRET}` → reads up to 20 messages per queue (`pgmq.read`, visibility 120 s), runs handlers (time budget 50 s), `pgmq.delete` on success; on error increments attempt and re-sends with delay (30 s, 5 min, 30 min); after 3 failures → `pgmq.archive` + Sentry event.
- Per-minute cron requires Vercel Pro (already planned).

## 6. Testing
| Level | Tool | Scope |
|---|---|---|
| Unit | Vitest | pricing, meterage, scoring, refinements, color (ΔE, family), feel estimation, mapping, status transitions, i18n helpers |
| DB | Vitest + Supabase local | RLS policies (each role tries allowed/forbidden actions), stock functions (reserve concurrency: 10 parallel reservations, never oversell) |
| AI golden | Vitest | `tests/match/golden.json` (mocked LLM, real scoring) |
| E2E | Playwright (desktop + mobile, locales fr and ar) | F1 match→quote→send→accept→order; F2 reservation; F3 sample; admin cutting board; language switch + RTL screenshot; accessibility (axe) |
| Visual | Playwright screenshots | home, wizard, result card, fabric page in fr/en/ar |
CI must be green to merge. Coverage target for `src/lib/**`: 80% lines.

## 7. CI/CD (GitHub Actions)
- On PR: install → lint → typecheck → `check-i18n` → unit → start Supabase local → DB tests → build → E2E (against `next start`) → `pnpm audit --prod`.
- Vercel builds previews automatically.
- On merge to `main`: `supabase db push` to production (job requires manual approval via GitHub environment protection) → Vercel production deploy.
- Worker (P3): build Docker image on changes in `worker/` → push → deploy to Modal/Railway.

## 8. Health & monitoring
`/api/health` returns `{db:"ok", queues:{q_embed: n,...}, version}` (staff-only details). Sentry alerts on new errors; a daily admin email digest "jobs failed / AI cost yesterday".

## 9. Running costs reminder
Vercel Pro ~$20/mo · Supabase Pro ~$25/mo · Claude + Voyage usage-based · Resend free tier up to its limit · Worker pay-per-use (P3) · LiveKit usage-based (P4) · domain.
