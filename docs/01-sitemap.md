# 01 – Sitemap & Pages

All routes are prefixed with the locale: `/fr`, `/en`, `/ar` (see `09-i18n.md`). `/` redirects to the detected locale.
Roles: **G** guest, **C** client, **S** sales, **A** admin (see `03-permissions.md`). Phase in brackets.

## Global layout
- **Header:** logo → home; nav: Catalog, AI Match, Showroom, About, Contact; language switcher (FR / EN / عربي); account button (Sign in, or the avatar menu: My account, Admin if S/A, Sign out); "Request" icon with the count of quote-cart lines.
- **Footer:** contact email/phone/address from `app_settings`, links to legal pages, "Textile expert since 1995", language switcher.
- **Quote cart drawer:** accessible from every page (see `05-commerce.md` §Quote cart).

## Public pages
| Route | Roles | Phase | Content |
|---|---|---|---|
| `/` | all | P1 | Hero "Stop guessing. Let AI find your fabric in seconds." + CTA to `/match`; 3 value props (AI matching, live stock, 3D showroom); featured categories; featured fabrics (6, `is_featured`); showroom teaser (static render + CTA); "Since 1995" section; contact CTA |
| `/catalog` | all | P1 | Grid of fabrics with filters (see `05-commerce.md` §Catalog filters), sort, pagination (24/page), URL-synced filters |
| `/catalog/[slug]` | all | P1 | Fabric detail: gallery, name, tags, spec table (composition, GSM, width, construction, structure, stretch, finish, best uses, seasons), color swatches with live stock per color, price tiers, MOQ, buttons "Add to quote", "Request sample", "Reserve 48h" (C only); similar fabrics (vector, 4 items). P3 adds the "Feel & Drape" tab |
| `/match` | all | P1 | AI Fabric Matching wizard, 5 steps (see `06-ai-matching.md`) |
| `/match/[sessionId]` | all (owner or by link) | P1 | Results: top 3–5 matches, score, explanation, refinement chips, actions |
| `/showroom` | all | P1 | 3D showroom (see `07-showroom-3d.md`), with 2D fallback |
| `/about` | all | P1 | Company story, since 1995, departments, values (static i18n content) |
| `/contact` | all | P1 | Contact form (name, company, email, phone, message, consent checkbox) → `contact_messages` + email to staff; contact details; map placeholder |
| `/legal/privacy`, `/legal/terms` | all | P1 | Static legal pages (i18n markdown) |
| `/auth/sign-in` | G | P1 | Email + password, "magic link" option, link to sign-up and reset |
| `/auth/sign-up` | G | P1 | Name, company, email, password, phone (optional), preferred language, accept terms |
| `/auth/reset`, `/auth/callback` | G | P1 | Password reset and Supabase auth callback |
| `/snap` | all | P2 | Snap & Match upload page |
| `/planner`, `/planner/[id]` | C | P2 | Collection Planner |
| `/compare?ids=a,b,c` | all | P3 | Compare up to 3 fabrics: spec table + overlaid Feel Cards |
| `/tour/[bookingId]` | C, S | P4 | Live guided tour room |

## Client portal (`/account/*`, role C, S and A can also view their own)
| Route | Phase | Content |
|---|---|---|
| `/account` | P1 | Dashboard: open quotes, active reservations (with countdown), recent orders, sample requests, recent match sessions |
| `/account/quotes` | P1 | List with status filter |
| `/account/quotes/[id]` | P1 | Lines, totals, status timeline, PDF download (when `sent`), Accept / Reject buttons (when `sent` and not expired), message to sales |
| `/account/samples` | P1 | Sample requests list + status |
| `/account/orders`, `/account/orders/[id]` | P1 | Orders with status timeline, lines, delivery info, payment status |
| `/account/reservations` | P1 | Active / past reservations, cancel button |
| `/account/matches` | P1 | Saved match sessions |
| `/account/profile` | P1 | Name, company, phone, VAT/tax id, addresses (billing + shipping), preferred language, password change, delete account request |
| `/account/collections` | P2 | Collection plans |
| `/account/tours` | P4 | Booked tours |

## Back-office (`/admin/*`, roles S and A)
| Route | Roles | Phase | Content |
|---|---|---|---|
| `/admin` | S, A | P1 | KPIs: quotes to review, samples to prepare, cutting queue, deliveries today, low-stock colors (< `low_stock_threshold_m`), reservations expiring in 6h |
| `/admin/fabrics` | S (read), A | P1 | Table with search/filters, active toggle, "New fabric" |
| `/admin/fabrics/new`, `/admin/fabrics/[id]` | A | P1 | Fabric form (all fields + i18n tabs FR/EN/AR + "auto-translate missing"), feel profile fields (P1 stores them, P3 uses them), colors sub-form (name, hex, photos upload), status of embeddings/translations jobs |
| `/admin/stock` | S, A | P1 | Stock lots table per fabric color; add lot, adjust meters (with reason → `stock_movements`), move department |
| `/admin/reservations` | S, A | P1 | Active reservations, release button |
| `/admin/quotes`, `/admin/quotes/[id]` | S, A | P1 | Review queue; edit lines, unit prices, discount %, validity date, internal notes; "Send to client" (generates PDF + email); convert accepted quote to order |
| `/admin/samples` | S, A | P1 | Sample requests: approve / reject / mark shipped (tracking number) / delivered |
| `/admin/orders`, `/admin/orders/[id]` | S, A | P1 | Orders; status changes; payment status; create delivery |
| `/admin/cutting` | S, A | P1 | Kanban board: queued → cutting → ready (drag and drop), roll selection per job |
| `/admin/deliveries` | S, A | P1 | Deliveries list, schedule, carrier, tracking, status |
| `/admin/clients`, `/admin/clients/[id]` | S, A | P1 | Client list, detail (history of quotes, orders, samples, matches), internal notes |
| `/admin/departments` | A | P1 | Showroom departments (name i18n, floor, position, linked categories) |
| `/admin/messages` | S, A | P1 | Contact form messages, mark handled |
| `/admin/match-logs` | A | P1 | AI match sessions: inputs, extracted specs, results, latency, cost, user feedback |
| `/admin/users` | A | P1 | Staff users, role assignment |
| `/admin/settings` | A | P1 | `app_settings`: company info, currency, VAT, thresholds, reservation hours, quote validity days, sample limits, price visibility |
| `/admin/bakes` | A | P3 | Texture and drape bake jobs, retry |
| `/admin/cloth-lab` | A | P3 | Cloth parameter tuning page (`08-cloth-system.md` §4.6) |
| `/admin/tours` | S, A | P4 | Availability slots, bookings |

## System routes
| Route | Purpose |
|---|---|
| `/api/jobs/run` | Vercel Cron (every minute) job consumer, see `12-dev-ops.md` |
| `/api/match` | Streaming match endpoint (see `06-ai-matching.md`) |
| `/api/quotes/[id]/pdf` | Signed PDF download |
| `/api/livekit/token` | P4 |
| `/sitemap.xml`, `/robots.txt` | SEO |
| `not-found`, `error` | i18n 404 / 500 pages |
