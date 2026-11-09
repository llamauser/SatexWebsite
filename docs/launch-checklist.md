# Launch checklist

Tick each line when it is done. Items marked **(you)** need an account, a key, a domain or a decision that only the owner can give.

## 1. Accounts and projects (you)
- [ ] Supabase **production** project created (Pro plan for daily backups). Region close to the clients.
- [ ] Vercel project connected to the GitHub repository; production branch = `main`.
- [ ] Domain bought and connected in Vercel; `NEXT_PUBLIC_SITE_URL` set to `https://<domain>`.
- [ ] Resend account, sending domain verified (SPF + DKIM).
- [ ] Anthropic API key and Voyage API key (AI search and embeddings).
- [ ] Sentry project (DSN) and an uptime monitor (Better Stack or similar) on `/` and `/api/health`.

## 2. Database
- [ ] `supabase link --project-ref <ref>` then `supabase db push` (all migrations in `supabase/migrations`).
- [ ] Auth settings: e-mail confirmation required, minimum password length 10, site URL and redirect URLs = the production domain.
- [ ] Auth hook: *Custom access token hook* = `public.custom_access_token_hook` (adds the `user_role` claim).
- [ ] Extensions enabled: pgmq, pg_cron, vector, pg_trgm, unaccent (the migrations create them; check in the dashboard).
- [ ] Cron jobs exist (`select * from cron.job`): expire-reservations, remind-reservations, expire-quotes, cleanup-expired.
- [ ] First admin: create the account by signing up, then set its role: `update public.profiles set role = 'admin' where id = '<user id>'`; sign in again.
- [ ] **Production seed = settings, categories and departments only. No demo users, no demo data.** Run the seed with `--skip-demo` and without demo users, or enter the data in the back-office / CSV import.

## 3. Vercel environment variables
Names only (values go in Vercel, never in git):
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`,
`AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `EMBED_PROVIDER=voyage`, `VOYAGE_API_KEY`,
`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`.
- [ ] Cron: Vercel Cron calls `/api/jobs/run` every minute (see `vercel.json`); `CRON_SECRET` matches.

## 4. Content (you)
- [ ] Company settings in `/admin/settings` (name, address, phone, WhatsApp, VAT, currency, notification e-mail).
- [ ] Real catalog: CSV import or the fabric form; photos per color; stock lots received.
- [ ] Legal texts (`src/content/legal.ts`) and the About page reviewed by the owner / a lawyer; Arabic texts reviewed by a native speaker.
- [ ] Quote terms (setting `quote_terms`, 3 languages) reviewed.
- [ ] Logo and brand images.

## 5. Verification on the production URL
- [ ] Sign-up, e-mail confirmation, sign-in, password reset.
- [ ] AI search returns results (check `/admin/match-logs`), and the fallback works when the key is removed.
- [ ] A test quote end to end: cart, submit, review, send (PDF opens), accept, convert, cut, deliver. E-mails arrive in the three languages.
- [ ] `/admin/settings` → "Send a test error": the error appears in Sentry.
- [ ] `/api/health` returns `{"status":"ok","db":"ok"}`; the uptime monitor is green.
- [ ] `/sitemap.xml` and `/robots.txt` load; Search Console: submit the sitemap.
- [ ] Security headers (securityheaders.com) and Lighthouse mobile ≥ 85 on home, catalog, a fabric page.
- [ ] Vercel Web Analytics shows visits.
- [ ] Backups: Supabase daily backups visible; the weekly GitHub backup workflow ran once (Actions → *Weekly database backup* → Run workflow).

## 6. Known gaps to decide on
- Admin photo uploads go straight from the browser to storage (size and type limited by the bucket); they are not re-encoded or stripped of EXIF yet.
- The quote e-mail carries a link to the PDF, not the PDF as an attachment.
- The AI search, e-mail sending and cron jobs have only been tested with fake providers; the first real run is part of section 5.
