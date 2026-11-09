# 13 – Phase 1 Backlog (ordered)

Do the tasks **in order**. Each task: read its referenced docs, implement, add tests, make the acceptance criteria pass, then `pnpm lint && pnpm typecheck && pnpm test`. One commit (or PR) per task, message `P1-xx: <title>`.

---
### P1-01 Project scaffold
Refs: `12-dev-ops.md` §1–3, `10-design-system.md` §1–2.
- Next.js 15 + TS strict + Tailwind 4 + shadcn/ui + ESLint/Prettier + Vitest + Playwright, pnpm, folder structure as specified, `.env.example`, `README` with setup steps.
- Tokens + fonts, `BlobBackground`, base layout (header/footer placeholders).
**Done when:** `pnpm dev` shows a page with tokens/fonts applied; lint, typecheck and an example unit + e2e test pass in CI (GitHub Action created).

### P1-02 i18n + RTL foundation
Refs: `09-i18n.md`.
- next-intl with `/fr` `/en` `/ar`, middleware detection, switcher, `dir="rtl"`, Arabic font, `check-i18n` script in CI, ESLint rule against physical direction classes.
**Done when:** switching language keeps the path; Arabic renders RTL (Playwright screenshot); CI fails if a key is missing in one locale.

### P1-03 Supabase setup + schema
Refs: `04-database.md`, `03-permissions.md`.
- Supabase local, all P1 migrations (enums, tables, views, functions, triggers, buckets, pg_cron, pgmq), custom access token hook, RLS policies, generated types. Do **not** create P2–P4 tables now; they get their own migrations in their phase.
**Done when:** `pnpm db:reset` succeeds; RLS test suite proves each role's allowed/forbidden actions from the matrix; `reserve_stock` concurrency test never oversells.

### P1-04 Seed data + procedural textures
Refs: `12-seed-data.md`.
**Done when:** `pnpm db:seed` creates 80 fabrics (exact category counts), ~400 colors with generated images in storage, stock, users, demo quotes/orders; re-running is idempotent; golden fabrics exist.

### P1-05 Auth & account basics
Refs: `01-sitemap.md` (auth, `/account/profile`), `02-user-flows.md` F8.
- Sign-up/in/out, magic link, reset, email confirmation, profile + addresses, preferred language, role-aware header, route protection (`/account` clients+, `/admin` staff).
**Done when:** E2E: sign up → confirm (local Inbucket) → edit profile; a client gets 403/redirect on `/admin`.

### P1-06 Layout, home, about, contact, legal
Refs: `01-sitemap.md`, `10-design-system.md` §7.
- Header, footer (settings-driven contact info), home sections, about, contact form (rate-limited → `contact_messages` + staff email job), legal pages.
**Done when:** Lighthouse mobile ≥ 85 on home; contact form stores the message and enqueues an email; all 3 locales.

### P1-07 Catalog & fabric detail
Refs: `05-commerce.md` §1–2.
- `/catalog` with all filters/sort/pagination (URL synced), fabric cards, `/catalog/[slug]` with gallery, specs, colors + live stock (Realtime), price tiers, similar fabrics, ISR + revalidation.
**Done when:** each filter is covered by a test; stock changes in admin appear on the fabric page within 2 s without reload.

### P1-08 Background jobs runner + emails
Refs: `12-dev-ops.md` §5, `05-commerce.md` §8.
- `/api/jobs/run`, pgmq helpers, retry/backoff, handlers `embed`, `translate`, `email`; Resend + React Email templates for all P1 events (3 locales); `email_log`; in-app `notifications` + bell.
**Done when:** saving a fabric produces embeddings and missing translations; each email template renders in fr/en/ar (snapshot tests); a failing handler is retried then archived.

### P1-09 AI matching
Refs: `06-ai-matching.md` (all).
- Wizard UI, `/api/match` streaming pipeline, spec extraction, retrieval SQL, scoring, explanations, results page, refinements, feedback, rate limits, fallback, cost logging, admin match logs.
**Done when:** golden test ≥ 12/15; the video brief ("Breathable jersey for a summer activewear line, ~200 GSM") returns `cotton-elastane-pique` or `organic-cotton-jersey-180` in the top 3; p50 < 6 s on staging; works in all 3 languages.

### P1-10 Quote cart & client quotes
Refs: `05-commerce.md` §2–3, `02-user-flows.md` F1, F6.
- Cart drawer (guest localStorage → merge on sign-in), add from fabric page and match results, submit, `/account/quotes` list/detail, accept/reject RPCs.
**Done when:** E2E: guest adds 2 lines → signs in → cart merged → submits → status `submitted`, emails enqueued.

### P1-11 Reservations
Refs: `02-user-flows.md` F2, `04-database.md` stock functions.
**Done when:** reserve/cancel works with countdown; limit enforced; cron expiry and reminder emails verified in a DB test (time travel via function parameter).

### P1-12 Sample requests
Refs: `02-user-flows.md` F3.
**Done when:** client requests up to 5 colors; limits enforced; staff status changes send emails.

### P1-13 Admin: fabrics, colors, stock, departments, settings, users, CSV import
Refs: `01-sitemap.md` admin, `12-seed-data.md` §6.
- Fabric form with i18n tabs + auto-translate, color sub-form + photo upload, stock lots + movements, departments editor (JSON layout with live 2D preview), settings, staff users, CSV import with dry-run, "Purge demo data".
**Done when:** an admin can create a fabric end-to-end and see it public after embeddings are ready; CSV import of a 10-row sample file passes with 1 deliberate error reported.

### P1-14 Admin: quote review, PDF, convert to order
Refs: `05-commerce.md` §5–6, `02-user-flows.md` F4, F6.
**Done when:** E2E full F1: client submits → sales edits price + discount → sends (PDF in client locale, Arabic RTL correct) → client accepts → sales converts → order `confirmed` with cutting jobs `queued` and allocations.

### P1-15 Admin: orders, cutting board, deliveries, clients, dashboard, messages
Refs: `02-user-flows.md` F4, F5, F7, `05-commerce.md` §7.
**Done when:** cutting board drag-drop with lot selection and actual meters; order status auto-advances; delivery statuses email the client; dashboard KPIs match seed data.

### P1-16 3D showroom (no 2D view)
Refs: `07-showroom-3d.md`.
**Done when:** 11 departments rendered from DB layouts; click → live panel; floor toggle; the picture replaces the scene when WebGL is disabled; performance budget met on a mid laptop.

### P1-17 SEO, security headers, analytics, monitoring
Refs: `11-non-functional.md` §4–7.
**Done when:** sitemap/robots/JSON-LD/hreflang validated; CSP without violations on all pages; Sentry receives a test error; `/api/health` works; Vercel Analytics on.

### P1-18 Hardening & launch
- Full E2E + axe pass in fr/en/ar on desktop + mobile; Lighthouse targets; backup GitHub Action; production Supabase + Vercel projects; env vars set; domain connected (when available); production seed = settings, categories, departments only (**no demo users**; demo fabrics only if the client asks for it with `is_demo = true`).
**Done when:** production URL live; checklist in `docs/launch-checklist.md` (create it in this task) fully ticked.

---
## Phase 2–4 (high level, to be detailed into backlogs at the start of each phase)
- **P2:** Snap & Match, Collection Planner (+ collection board PDF), compare tray — `08b-phase2-4-features.md` §A–B.
- **P3:** Feel Card, `/compare`, cloth lab, XPBD swatch (GPU + CPU), garment templates (asset task), worker (texture + bake), drape viewer — `08-cloth-system.md`.
- **P4:** Tour slots/bookings, LiveKit room, sync protocol, reminders — `08b-phase2-4-features.md` §C.
