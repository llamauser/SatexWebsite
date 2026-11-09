# SATEX Commerce

Website prototype for **SATEX Commerce** (wholesale fabrics, "Vente des tissus en gros"): a catalog with live stock, an AI fabric matcher (describe a project or upload a photo), a 3D showroom, a feel card with an interactive cloth swatch, a collection planner, quotes and orders with a back office. French (default), English and Arabic (right to left).

**Stack:** Next.js 15, Supabase (Postgres, auth, storage), three.js / React Three Fiber, Ollama or Claude + Voyage for the AI.

## Run it on a Windows PC (one click)
Needs Docker Desktop, Ollama with its models, and an Internet connection the first time. Then double-click:

    START-SATEX.bat

It starts the database, prepares the settings, fills the demo data, starts the website and the background jobs, and opens http://localhost:3000. The first start takes several minutes (downloads, build, embedding of the fabrics). `STOP-SATEX.bat` stops everything.

Demo accounts (passwords in `.seed-credentials.local.json`, created by the first start): admin `admin@satex.test`, sales `sales1@satex.test`, clients `client1@satex.test` to `client5@satex.test`.

## Run it by hand or on another system
See [`docs/run-locally.md`](docs/run-locally.md). Useful commands: `pnpm dev`, `pnpm build && pnpm start`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm e2e:auth` (needs the database running).

## Documentation
[`docs/README.md`](docs/README.md) is the index of the specification (sitemap, flows, permissions, database, AI matching, showroom, cloth, i18n, design, operations). [`PLAN.md`](PLAN.md) is the one-page overview.

The 3D models of the showroom are built with Blender scripts (`scripts/showroom`, `pnpm showroom:build`); the built files are already in `public/showroom`, so Blender is only needed to change the scene.
