# 11 – Non-functional Requirements

## 1. Performance (measured on Vercel production, mobile "Slow 4G" Lighthouse profile unless stated)
| Metric | Target |
|---|---|
| LCP public pages (home, catalog, fabric) | < 2.5 s |
| CLS | < 0.1 |
| INP | < 200 ms |
| Lighthouse Performance (mobile) | ≥ 85 home/catalog/fabric |
| First-load JS (public pages, excluding 3D) | < 200 kB gzip |
| AI match p50 / p95 (first results) | < 6 s / < 12 s |
| Catalog query p95 (DB) | < 150 ms |
- Public catalog/fabric pages use ISR (`revalidate: 300`) + on-demand `revalidateTag('fabric:{id}')` when admin saves. Stock numbers are fetched client-side (live), so they are never stale in cached HTML.
- 3D and cloth code is lazy-loaded and never in the main bundle.

## 2. Accessibility
- WCAG 2.1 AA: contrast ≥ 4.5:1 text (tokens are chosen for this, verify), focus rings visible, all interactive elements reachable by keyboard, labels on all inputs, `aria-live` for match progress and toasts.
- The 3D showroom and cloth canvas have accessible HTML equivalents (department list, Feel Card text).
- `axe` checks in Playwright on key pages (zero serious/critical violations).

## 3. Browser & device support
- Last 2 versions of Chrome, Edge, Firefox, Safari (macOS + iOS), Samsung Internet. Min viewport 360 px.
- WebGPU used when available; WebGL 2 fallback for 3D; 2D fallback when WebGL is missing (see `07`, `08`).

## 4. SEO
- SSR/ISR for public pages; `generateMetadata` per page with localized title/description; Open Graph image per fabric (first photo) and a default brand OG image.
- `sitemap.xml` (all locales, all active fabrics), `robots.txt` (disallow `/account`, `/admin`, `/api`, `/match/*` results).
- JSON-LD: `Organization` (home), `Product` with `offers` (fabric pages, only when prices are public), `BreadcrumbList`.
- Canonical URLs + hreflang (see `09-i18n.md`).

## 5. Security
- Supabase RLS on every table (`03-permissions.md`); service-role key only in server code marked `server-only`.
- Input validation with **zod** on every server action/route (shared schemas in `src/lib/validation/`).
- Rate limits (table `rate_limits`, function `hit_rate_limit(key, limit, window_seconds)`): match, snap, contact form (5/h/IP), sign-up (10/h/IP), quote submit (20/h/user).
- Uploads: MIME sniffing (`file-type`), size limits per bucket, re-encode images with `sharp`, strip EXIF, random file names.
- Headers (in `next.config.ts`): CSP (self + Supabase + Vercel + LiveKit in P4; `img-src` incl. storage domain; no `unsafe-eval`), HSTS, X-Content-Type-Options, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy (camera only on `/snap` and `/tour/*`).
- Auth: Supabase email confirmation required; password min 10 chars; magic link; session refresh via `@supabase/ssr`.
- Secrets only in Vercel/Supabase env, never committed; `.env.example` lists names only.
- LLM safety: user text is passed as data inside JSON; prompts instruct the model to ignore instructions in the brief; outputs are validated by schema, so the model can't trigger actions.
- Dependency audit in CI (`pnpm audit --prod`, fail on high).

## 6. Privacy & legal
- Personal data: profiles, addresses, contact messages, match briefs, snap photos.
- Retention: anonymous match sessions 90 days; snap photos 30 days; contact messages 2 years; orders/quotes kept for accounting (10 years) with the client anonymized on deletion.
- Analytics: **Vercel Web Analytics** (cookieless) → no consent banner needed for analytics. Only essential cookies (auth, locale, anonymous match token). If marketing pixels are added later, a consent banner becomes required.
- Privacy policy and terms: placeholder texts in 3 languages (`content/legal/`) marked "to be reviewed by a lawyer" (the applicable law depends on the country, an open item).
- Data export on request: admin action "Export client data" (JSON).

## 7. Reliability
- Supabase Pro daily backups (7-day retention); weekly `pg_dump` via GitHub Action to a private storage bucket as a second copy.
- Jobs are idempotent (safe to re-run); failed jobs retried up to 3× with backoff, then visible in admin.
- AI failure never blocks the commerce flow: fallback parser and template explanations (`06`).
- Error tracking: Sentry (Next.js client + server + worker), with PII scrubbing.
- Uptime check (Better Stack or similar free tier) on `/` and `/api/health`.
