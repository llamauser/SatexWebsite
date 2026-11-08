# 03 – Roles, Permissions & Row Level Security

## Roles
Stored in `profiles.role` (enum `user_role`): `client`, `sales`, `admin`. Guests are unauthenticated.
The role is copied into the JWT via a Supabase **custom access token hook** (`auth.jwt() ->> 'user_role'`), so RLS policies don't need joins.
The helper SQL function `public.app_role()` returns that claim (default `'guest'`). (Do not name it `current_role`: that is a reserved SQL keyword.)

## Permission matrix
✓ = yes, own = only their own rows, – = no

| Action | Guest | Client | Sales | Admin |
|---|---|---|---|---|
| Browse catalog, fabric pages, showroom | ✓ | ✓ | ✓ | ✓ |
| Run AI match / Snap & Match | ✓ (rate-limited) | ✓ | ✓ | ✓ |
| See price tiers | if `show_prices_public` | ✓ | ✓ | ✓ |
| Quote cart | local only | own | – | – |
| Submit quote, accept/reject | – | own | – | – |
| Reserve stock | – | own | on behalf of client | on behalf of client |
| Request samples | – | own | – | – |
| View orders, deliveries | – | own | all | all |
| Review/edit/send quotes, convert to order | – | – | ✓ | ✓ |
| Manage samples, orders, cutting jobs, deliveries | – | – | ✓ | ✓ |
| View clients | – | own profile | all | all |
| Stock lots: view / adjust | – | – (sees aggregated available meters only) | ✓ / ✓ | ✓ / ✓ |
| Create/edit fabrics, colors, departments | – | – | – (read only) | ✓ |
| Settings, staff users, match logs, bake jobs | – | – | – | ✓ |
| Collection planner (P2) | – | own | view all | view all |
| Book live tour (P4) | – | own | manage | manage |

## RLS rules (all tables have RLS enabled, no exceptions)
Write the policies exactly with these semantics. `is_staff()` = role in (`sales`,`admin`).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `fabrics`, `fabric_colors`, `fabric_images`, `departments`, `categories` | public where `is_active` (or staff: all) | admin | admin | admin |
| `fabric_price_tiers` | public if setting `show_prices_public`, else authenticated | admin | admin | admin |
| `stock_lots`, `stock_movements` | staff | staff | staff | – (never delete; use movements) |
| `v_color_availability` (view) | public | – | – | – |
| `stock_reservations` | own or staff | via `reserve_stock()` RPC only | own (cancel) or staff | – |
| `profiles` | own or staff | trigger on sign-up | own (non-role fields) / admin (role) | – |
| `clients`, `addresses` | own or staff | own | own or staff | own (addresses) |
| `quotes`, `quote_lines` | own or staff | own (status `draft`) | own while `draft`; client can only set `accepted`/`rejected` via RPC; staff all | own `draft` lines |
| `sample_requests`, `sample_request_items` | own or staff | own | staff (status) | – |
| `orders`, `order_lines`, `deliveries` | own or staff | staff | staff | – |
| `cutting_jobs` | staff | staff (trigger) | staff | – |
| `match_sessions`, `match_results` | own (user_id or session_token) or admin | via server only (service role) | own (feedback field) | own |
| `contact_messages` | staff | anyone (via server action with rate limit) | staff | admin |
| `notifications` | own | server only | own (read_at) | – |
| `app_settings` | public (only the keys listed in `public_settings` view) / admin all | admin | admin | – |
| `audit_log` | admin | server/trigger only | – | – |
| `snap_uploads` (P2) | own (via session) or admin | server only | – | server (cron) |
| `collections`, `collection_items` (P2) | own or staff | own | own | own (`draft`) |
| `garment_consumption` (P2) | public | admin | admin | admin |
| `bake_jobs`, `texture_jobs` (P3) | admin | server/trigger only | server/worker | – |
| `tour_slots` (P4) | authenticated (only unbooked future slots) / staff all | staff | staff | staff (unbooked) |
| `tour_bookings` (P4) | own or staff | own (via `book_slot()` RPC) | own (cancel ≥ 2 h before) / staff | – |

**Server-side rule:** the Next.js server uses the **user's session client** for everything that the user does, so RLS applies. The **service-role client** is used only in: `/api/jobs/run`, `/api/match` (to write logs), webhooks, and the seed script. Never import the service-role client into a file that can reach the browser bundle (`server-only` package).

## Audit log
Triggers on `quotes`, `orders`, `cutting_jobs`, `stock_movements`, `profiles.role`, `app_settings` write to `audit_log(actor_id, table_name, row_id, action, old, new, at)`.
