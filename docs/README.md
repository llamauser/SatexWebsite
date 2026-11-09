# SATEX Commerce – Project Specification

This folder is the **single source of truth** for building the SATEX Commerce website.
`../PLAN.md` is the one-page overview. These documents hold the detail.

## Instructions for the implementing model / developer
1. **Read in this order:** this README → `13-phase1-backlog.md` → the docs each task references.
2. **Do not invent.** If something is not specified, use the default stated in the docs. If there is none, add a `TODO(spec):` comment and pick the simplest option. Never silently change a validated decision (see below).
3. **Names are contracts.** Table names, column names, enum values, route paths, queue names and env var names in these docs must be used exactly as written.
4. **Phase discipline.** Build only the current phase. Later-phase tables/routes may be stubbed, but not implemented.
5. **Every task ends with its acceptance criteria passing** (see backlog) plus `pnpm lint && pnpm typecheck && pnpm test`.
6. **All user-facing strings go through i18n** (`09-i18n.md`). No hard-coded French/English text in components.

## Validated decisions (do not change)
| Topic | Decision |
|---|---|
| Hosting | Vercel (Next.js app) + Supabase (Postgres, Auth, Storage, Realtime, Queues, Cron) |
| Extra service | One Docker worker (Python + headless Blender) on Modal/Railway/Fly.io for texture processing and drape bakes (Phase 3) |
| Data | No real data. Build with seed data (`12-seed-data.md`) and an admin panel to load the real catalog later |
| Languages | French (default), English, Arabic (RTL) |
| Creative features | Snap & Match (P2), Collection Planner (P2), Feel Card + Virtual Drape (P3), Guided Live Tour (P4) |
| Cloth physics | Option C: real-time XPBD swatch in browser + pre-baked garment drapes on worker |
| AI | Claude `claude-sonnet-5-5` (reasoning, vision, explanations, translation) + Voyage multimodal embeddings |

## Document map
| File | Content |
|---|---|
| `00-setup-and-tools.md` | Tools to install, accounts, optional Ollama local models, team workflow |
| `01-sitemap.md` | Every route and what each page shows, per role |
| `02-user-flows.md` | Step-by-step journeys and state machines |
| `03-permissions.md` | Roles, permission matrix, Row Level Security policies |
| `04-database.md` | Full schema: tables, columns, enums, indexes, functions, storage buckets |
| `05-commerce.md` | Catalog, stock, reservations, quotes, samples, orders, cutting jobs, deliveries, PDFs, notifications |
| `06-ai-matching.md` | Matching wizard, AI pipeline, prompts, JSON schemas, scoring formulas, refinement |
| `07-showroom-3d.md` | 3D showroom (Phase 1) |
| `08-cloth-system.md` | Feel Card, feel→physics formulas, XPBD swatch, bake worker, texture pipeline (Phase 3) |
| `08b-phase2-4-features.md` | Snap & Match, Collection Planner, Guided Live Tour specs |
| `09-i18n.md` | Locales, RTL, translation workflow, formatting |
| `10-design-system.md` | Colors, typography, components, layout, motion |
| `11-non-functional.md` | Performance, accessibility, SEO, browser support, security, privacy |
| `12-dev-ops.md` | Repo structure, env vars, environments, jobs, testing, CI/CD, monitoring |
| `12-seed-data.md` | Seed catalog, users, procedural placeholder textures |
| `13-phase1-backlog.md` | Ordered Phase 1 tasks with acceptance criteria |
| `launch-checklist.md` | Created during task P1-18 |

## Open items (use the default until confirmed)
| Item | Default to use |
|---|---|
| Country / currency / VAT | `app_settings.currency = 'EUR'`, `vat_rate = 0.20`, all configurable in admin settings. No hard-coded currency anywhere |
| Domain | `satex-commerce.example`, configured through `NEXT_PUBLIC_SITE_URL` |
| Brand assets | Recreate the logo as SVG placeholder (blue ribbon "S" + "SATEX COMMERCE" + tagline "Vente des tissus en gros") in `public/brand/` |
| Contact details | Email `Satexcommerce@ymail.com` (from the video). Phone, address and WhatsApp are empty settings fields |
| Online payment | **None in Phase 1.** Orders are paid offline (bank transfer / on delivery), and staff mark payment status manually |
| Founding year | 1995 (from the video) |

## Glossary
| Term | Meaning |
|---|---|
| GSM | Grams per square meter, the fabric weight |
| Width | Usable fabric width in cm (typ. 140–160) |
| MOQ | Minimum order quantity, in meters |
| Roll / lot | A physical roll of one fabric color, tracked in `stock_lots` |
| Construction | Knit, woven or non-woven |
| Composition | Fiber percentages, e.g. 92% cotton / 8% elastane |
| Piqué, jersey, twill, satin, denim... | Fabric structures (`fabric_structure` enum) |
| Drape | How fluidly fabric falls; high drape = fluid |
| Feel profile | 5 scores 0–10: softness, drape, stretch, sheen, breathability |
| XPBD | Extended Position-Based Dynamics, the cloth simulation method |
| Bake | Offline cloth simulation of a garment, saved as a 3D model |
| Match session | One run of the AI wizard, with its inputs and results |
| Cutting job | Instruction to cut X meters from a roll for an order line |
| ΔE (CIEDE2000) | Perceptual color difference; < 5 is a close match |
