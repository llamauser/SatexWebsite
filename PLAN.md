# SATEX Commerce – Website Plan

Wholesale fabric site ("Vente des tissus en gros") with AI fabric matching, real-time stock, a 3D showroom, and B2B ordering.
Source idea: the promo video and audio, see `video_audio_notes.md`.

> **This page is the overview only. The full, implementation-ready specification is in [`docs/`](docs/README.md)**: start with `docs/README.md`, then `docs/13-phase1-backlog.md`. If this page and `docs/` ever disagree, `docs/` wins.

## Decisions (validated)
| Topic | Decision |
|---|---|
| Hosting | Vercel (web) + Supabase (DB, auth, storage, realtime, queues) |
| Data | No real data yet, so we build with realistic seed data and an admin panel to load the real catalog later |
| Languages | French (default), English, Arabic (RTL) |
| Creative features | Snap & Match · Feel Card with the interactive cloth swatch · Collection Planner (baked garment drapes and the Guided Live Tour were dropped) |
| Cloth physics | Real-time interactive swatch in the browser (no garment bakes) |

## Stack
- **Frontend / API:** Next.js 15 (App Router, TypeScript, Server Actions), Tailwind, shadcn/ui
- **i18n:** next-intl, `/fr` `/en` `/ar` routes, `dir="rtl"` for Arabic, Tailwind logical properties (`ms-`, `pe-`...)
- **3D:** React Three Fiber + drei, glTF/Draco models, KTX2 textures
- **Cloth (real-time):** XPBD solver in WebGPU compute shaders, WebGL/CPU fallback for older devices
- **Supabase:**
  - Postgres + **pgvector** (text + image embeddings)
  - Auth (roles: client, sales, admin) with Row Level Security
  - Storage (fabric photos, textures, 3D models, quote PDFs)
  - Realtime (live stock)
  - Queues (pgmq) for background jobs
- **AI:**
  - Claude (`claude-sonnet-5-5`): wizard → structured specs, vision for Snap & Match, explanations, collection planning, auto-translation of catalog content
  - Multimodal embedding API (e.g. Voyage multimodal) for text + image vectors
- **Bake worker (outside Vercel):** Docker container with headless Blender on Modal / Railway / Fly.io. It pulls jobs from the Supabase queue and uploads baked glTF drapes.
- **Email:** Resend. **WhatsApp:** Business API (later).
- **Live tour (Phase 4):** LiveKit Cloud (audio/video + data channel for state sync)
- **Ops:** GitHub Actions CI, Vercel previews per branch, Sentry, Supabase backups

> Vercel serverless can't run Blender or long simulations, so the bake worker is the one extra service.

## Data model (core)
- `fabrics` – name (i18n jsonb), slug, composition, gsm, width_cm, construction (knit/woven/...), stretch_pct, finish, uses[], season[], price tiers, moq_m, eco data
- `fabric_feel` – softness, drape, stretch, sheen, breathability (0–10) + sim params: mass, stretch_compliance, bend_compliance, damping, friction (+ `measured` flag)
- `fabric_colors` – color name, hex, lab, photo, texture set (albedo, normal, roughness, tileable)
- `stock_lots` – roll id, color, meters, department, location, reserved_until
- `embeddings` – fabric/color id, kind (text/image), vector
- `drape_bakes` – fabric color × garment template → glTF url, status
- `clients`, `profiles` (role), `quotes` + `quote_lines`, `sample_requests`, `orders` + `order_lines`, `cutting_jobs`, `deliveries`
- `collections` + `collection_items` (Collection Planner)
- `tour_bookings` (Phase 4)

## AI matching pipeline
1. Wizard answers (audience, style, brand, description), or a photo → Claude returns structured specs (construction, fiber prefs, GSM range, stretch, season, use, budget)
2. Hybrid retrieval: SQL hard filters (in stock, MOQ, GSM range) + vector similarity (text and/or image)
3. Score = weighted spec fit + similarity → real match % (no fake 98%)
4. Top 3–5 results with a "why it matches" explanation, then refinement chips ("lighter", "cheaper", "more stretch")

## Cloth system (Option C)
- **Interactive swatch (real-time):** ~40×40 cloth grid, grab / shake / drop on a table / stretch. Params come from `fabric_feel`. The Feel Card radar chart is shown next to it.
- **Garment drape (baked):** templates t-shirt, dress, trousers, cushion. When a fabric is saved, one bake job per template runs on the worker, and the viewer plays the glTF with live texture swap per color.
- **Calibration:** params are estimated from GSM/composition by default. They can be overridden with measured data (drape coefficient, stretch %, bending), shown as "simulated from measured data".
- **Texture pipeline:** admin uploads a flat swatch photo → auto-crop, make tileable, generate normal/roughness maps → KTX2.

## Phases
### Phase 1 – Core site (first deliverable, hostable)
- Project setup: Next.js + Supabase + Vercel, i18n FR/EN/AR, design system based on the video (white, blue/teal, beige accents)
- Public pages: home, catalog with filters, fabric detail, about, contact
- Seed data: ~80 realistic fabrics with procedurally generated textures as placeholders
- AI Fabric Matching wizard (5 steps) + honest scoring + refinement
- Real-time stock display + 48h roll reservation
- Quotes & sample requests: client portal, statuses, PDF quote, email notifications
- Back-office: catalog/stock CRUD, quotes, orders, deliveries, cutting-job board
- 3D showroom v1: 2 floors, clickable departments → live catalog, mobile fallback
- Auth & roles, RLS, SEO, analytics, deploy

### Phase 2 – Snap & Match + Collection Planner
- Image upload → vision + image embeddings → follow-up questions → matches
- Collection Planner: line brief → per-piece fabric proposals, color harmony, stock check, one-click full quote

### Phase 3 – Feel Card + Virtual Drape
- Feel profile + radar chart
- XPBD real-time swatch (WebGPU + fallback)
- Bake worker (Blender headless) + garment templates + viewer
- Texture processing pipeline in admin

### Phase 4 – Guided Live Tour
- Booking from quote / collection, rep availability
- LiveKit call + synced showroom camera and fabric selection, desktop-first

## Running costs (estimate, early stage)
Vercel Pro ~$20/mo (needed for commercial use), Supabase Pro ~$25/mo, Claude + embeddings usage-based (low at this volume), bake worker pay-per-use (cents per bake), LiveKit usage-based, plus the domain.

## Open items
- Domain name and brand assets (logo files, fonts, colors)
- Real catalog, photos and stock (seed data until then)
- Contact details beyond the email (phone, address, WhatsApp)
- Country / currency / VAT rules for quotes
