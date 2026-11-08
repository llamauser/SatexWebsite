# 02 – User Flows & State Machines

## F1. AI match → quote (main journey, P1)
1. Guest opens `/match`. Wizard steps: Audience → Style → Brand → Describe → Match (`06-ai-matching.md`).
2. On "Find my match", the browser POSTs to `/api/match`. A `match_sessions` row is created (owner = user or anonymous `session_token` cookie). The UI shows a "Scanning N references..." animation while streaming.
3. Redirect to `/match/[sessionId]` with 3–5 results, each with score %, explanation and spec table.
4. The user can refine (chips) → new results in the same session (`match_session_iterations`).
5. "Add to quote" on a result → asks for color + meters (default = MOQ) → line added to the quote cart.
   - Guest: the cart is kept in a cookie/localStorage and merged into the DB cart on sign-in.
6. "Submit request" in the cart → requires sign-in (sign-up inline if needed) → quote status `submitted` → email to the client (confirmation) + sales (new quote).
7. Sales reviews in `/admin/quotes/[id]` → adjusts → "Send" → PDF generated, status `sent`, email to client with a portal link.
8. Client accepts in the portal → status `accepted` → sales converts → order created (F4).

## F2. Reservation (P1)
1. Signed-in client on a fabric page clicks "Reserve 48h" on a color, enters meters (≥ MOQ, ≤ available).
2. Server checks `available_m` inside a transaction (function `reserve_stock`) → creates `stock_reservations` (status `active`, `expires_at = now() + reservation_hours`).
3. Limit: `max_active_reservations_per_client` (default 3). The UI shows a countdown in `/account/reservations`.
4. Ends by one of: client cancels → `cancelled`; expiry (pg_cron every 5 min) → `expired` + email; the reservation is attached to a quote line that becomes an order → `converted`.
5. Email 6h before expiry ("Your reservation expires soon").

## F3. Sample request (P1)
1. Client clicks "Request sample" (fabric page, match result or cart) → selects up to `max_colors_per_sample_request` (default 5) colors → confirms shipping address.
2. Status machine: `requested` → `approved` | `rejected` (reason) → `preparing` → `shipped` (tracking no.) → `delivered`.
3. Limit: `max_open_sample_requests_per_client` (default 2 open). Email on every status change.

## F4. Order lifecycle (P1)
Created **only** by sales from an `accepted` quote (button "Convert to order"). Copies lines and prices. Converts linked reservations.

```
order.status:  confirmed → in_preparation → ready → shipped → delivered
                    └──────────────┴────────────┴→ cancelled  (S/A only, before shipped)
order.payment_status: unpaid → partial → paid   (manual, independent of status)
```
- On `confirmed`: one `cutting_jobs` row per order line, status `queued`, stock reserved for the order (`stock_movements` type `allocate`).
- Order moves to `in_preparation` automatically when the first cutting job starts, and to `ready` automatically when all jobs are `ready`.
- `shipped` requires a `deliveries` row (carrier, tracking, date).
- `delivered` is set when the delivery is marked delivered.
- Cancel: releases allocations, cancels cutting jobs that are not done.

## F5. Cutting job (P1)
```
queued → cutting → ready
   └────────┴→ cancelled
```
- Moving to `cutting` requires selecting a `stock_lot` with enough meters.
- Moving to `ready` records `cut_m` (actual), decrements the lot (`stock_movements` type `cut`), and the difference vs planned is logged.

## F6. Quote state machine
```
draft (cart) → submitted → in_review → sent → accepted → converted
                               │          ├→ rejected (by client, reason optional)
                               │          └→ expired (valid_until passed, daily cron)
                               └→ cancelled (by sales, reason required)
```
- `draft` = the client's quote cart (one per client).
- `in_review` is set automatically when a sales user opens the quote.
- Sales can re-open `sent` back to `in_review` (creates a new revision, `quotes.revision += 1`, new PDF).
- Valid for `quote_validity_days` (default 15) from `sent`.

## F7. Delivery
`scheduled → in_transit → delivered`, or `failed` (reason) → can be rescheduled (new row). Email to the client on `in_transit` and `delivered`.

## F8. Account
- Sign-up creates `profiles` (role `client`) + `clients` row (company). Email confirmation is required before submitting a quote.
- Preferred language is used for all emails and PDFs.
- Delete request: sets `profiles.deletion_requested_at` and notifies admin. An admin anonymizes the profile within 30 days (orders are kept for accounting).

## F9. Admin adds a fabric (P1)
1. Fill the form (FR required, EN/AR optional) → save.
2. Jobs enqueued: `translate` (fills missing EN/AR, flags `machine_translated`), `embed` (text embedding; image embeddings per color photo).
3. Colors: upload photos (≥ 1 per color). P3 adds: texture processing + drape bakes.
4. The fabric only appears publicly when `is_active = true` AND it has ≥ 1 color AND its embeddings are ready.

## Phase 2–4 flows
See `08b-phase2-4-features.md` (Snap & Match, Collection Planner, Live Tour) and `08-cloth-system.md` (bakes).
