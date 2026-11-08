# 04 – Database Schema (Supabase Postgres)

Migrations live in `supabase/migrations/` (one file per logical step, timestamped). Generate TS types with `supabase gen types typescript` → `src/lib/db/types.ts`.

## Conventions
- PK `id uuid default gen_random_uuid()`; `created_at timestamptz default now()`, `updated_at timestamptz default now()` with a `set_updated_at` trigger on every table that has it.
- Translatable text = `jsonb` shaped `{"fr": "...", "en": "...", "ar": "..."}` (type alias **i18n**). `fr` is required (CHECK `(x ? 'fr')`).
- Money = `numeric(12,2)` in the currency from `app_settings.currency`. Meters = `numeric(10,2)`.
- Human-readable references: `quotes.ref` = `Q-2026-000123`, `orders.ref` = `O-...`, `sample_requests.ref` = `S-...` (from sequences).
- Extensions: `pgcrypto`, `vector`, `pg_cron`, `pgmq`, `pg_trgm`, `unaccent`.
- Demo data flag: `is_demo boolean not null default false` on `fabrics`, `clients`, `quotes`, `orders`, `sample_requests` (set by the seed; used by "Purge demo data", see `12-seed-data.md` §6). Not repeated in the table listings below.
- SQL snippets below are **specifications**, not copy-paste-ready migrations: write them out fully (e.g. the `search_text` expression and the availability view arithmetic).

## Enums
```sql
create type user_role            as enum ('client','sales','admin');
create type fabric_construction  as enum ('knit','woven','nonwoven');
create type fabric_structure     as enum ('jersey','pique','rib','interlock','fleece','french_terry','mesh','plain','twill','satin','denim','canvas','poplin','oxford','gabardine','crepe','chiffon','velvet','jacquard','tulle','felt','other');
create type stretch_level        as enum ('none','mechanical','two_way','four_way');
create type season               as enum ('spring_summer','autumn_winter','all_season');
create type reservation_status   as enum ('active','expired','cancelled','converted');
create type quote_status         as enum ('draft','submitted','in_review','sent','accepted','rejected','expired','cancelled','converted');
create type sample_status        as enum ('requested','approved','rejected','preparing','shipped','delivered');
create type order_status         as enum ('confirmed','in_preparation','ready','shipped','delivered','cancelled');
create type payment_status       as enum ('unpaid','partial','paid');
create type cutting_status       as enum ('queued','cutting','ready','cancelled');
create type delivery_status      as enum ('scheduled','in_transit','delivered','failed');
create type stock_movement_type  as enum ('receive','adjust','allocate','release','cut','transfer');
create type locale               as enum ('fr','en','ar');
create type job_status           as enum ('pending','running','done','failed');   -- for bake/texture tracking tables
```

## Catalog
```sql
categories (id, slug text unique, name i18n, description i18n, icon text, sort int default 0)
  -- seed: knits, shirting, denim, natural-fibers, upholstery, technical-activewear, suiting, eveningwear, linings

fabrics (
  id, slug text unique not null, sku text unique not null,          -- sku e.g. SAT-KN-0001
  name i18n not null, short_description i18n, description i18n,
  category_id uuid references categories not null,
  construction fabric_construction not null,
  structure fabric_structure not null,
  composition jsonb not null,           -- [{"fiber":"cotton","pct":92},{"fiber":"elastane","pct":8}]  sum = 100 (CHECK via function)
  gsm int not null check (gsm between 20 and 1200),
  width_cm int not null check (width_cm between 50 and 340),
  stretch stretch_level not null default 'none',
  stretch_pct int,                      -- max elongation %, nullable
  finish text[] default '{}',           -- e.g. {'brushed','mercerized','water_repellent','anti_pilling'}
  uses text[] not null default '{}',    -- controlled vocabulary, see below
  seasons season[] not null default '{all_season}',
  tags text[] default '{}',
  moq_m numeric(10,2) not null default 1,
  base_price_per_m numeric(12,2) not null,   -- price of tier 1
  eco jsonb default '{}',               -- {"recycled_pct":0,"organic":false,"certifications":["OEKO-TEX"]} (P2+ display)
  is_active boolean default false,
  is_featured boolean default false,
  machine_translated jsonb default '{}',  -- field -> locales machine translated and not yet reviewed, e.g. {"name":["ar"],"description":["en","ar"]}
  search_text tsvector generated always as (...) stored,   -- from name fr/en + tags + structure
  created_at, updated_at
)
-- uses vocabulary: activewear, sportswear, t_shirts, polos, shirts, dresses, skirts, trousers, jeans, jackets, coats,
-- suits, eveningwear, lingerie, swimwear, kidswear, workwear, uniforms, upholstery, curtains, bedding, accessories, linings

fabric_price_tiers (id, fabric_id fk cascade, min_m numeric not null, price_per_m numeric not null, unique(fabric_id,min_m))
  -- tier with min_m = moq_m must exist

fabric_colors (
  id, fabric_id fk cascade, code text not null,  -- e.g. 'NAVY-01'
  name i18n not null, hex text not null check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  lab real[3],                          -- computed from hex on insert/update (trigger)
  is_active boolean default true, sort int default 0,
  texture jsonb,                        -- P3: {"albedo":url,"normal":url,"roughness":url,"repeat_cm":10}
  unique(fabric_id, code)
)

fabric_images (id, fabric_id fk cascade, color_id fk null, storage_path text not null, alt i18n, kind text check (kind in ('photo','macro','flat_swatch','lifestyle')), sort int)

fabric_feel (                           -- 1:1 with fabrics; used by P1 (stored), P3 (Feel Card + physics)
  fabric_id uuid primary key references fabrics on delete cascade,
  softness real, drape real, stretch real, sheen real, breathability real,   -- 0..10, nullable = estimate
  measured jsonb default '{}',          -- {"drape_coefficient":0.42,"stretch_pct_warp":5,"stretch_pct_weft":30,"bending_uNm":12}
  is_measured boolean default false,
  sim_params jsonb,                     -- computed: see 08-cloth-system.md §2
  updated_at
)

embeddings (
  id, owner_type text check (owner_type in ('fabric','color_image')), owner_id uuid not null,
  kind text check (kind in ('text','image')), model text not null,
  embedding vector(1024) not null, content_hash text not null,   -- recompute only when hash changes
  created_at, unique(owner_type, owner_id, kind)
)
create index on embeddings using hnsw (embedding vector_cosine_ops);
```

## Stock
```sql
departments (id, slug unique, name i18n, floor smallint check (floor in (0,1)), kind text check (kind in ('fabric_hall','cutting','shipping','studio','client_suite','office')),
             layout jsonb not null,   -- {"x":..,"z":..,"w":..,"d":..,"rotation":0,"racks":4,"color":"#..."} (07-showroom-3d.md)
             category_ids uuid[] default '{}', sort int)

stock_lots (id, color_id fk not null, lot_code text unique not null, meters numeric(10,2) not null check (meters >= 0),
            department_id fk, location text, received_at date, created_at, updated_at)

stock_movements (id, lot_id fk not null, type stock_movement_type not null, meters numeric(10,2) not null,  -- signed
                 reason text, ref_table text, ref_id uuid, actor_id uuid, created_at)
  -- stock_lots.meters is updated ONLY by the trigger on stock_movements insert

stock_reservations (id, color_id fk not null, client_id fk not null, meters numeric(10,2) not null check (meters > 0),
                    status reservation_status default 'active', expires_at timestamptz not null,
                    quote_line_id uuid null, reminded_at timestamptz, created_at)

order_allocations (id, order_line_id fk, color_id fk, meters numeric, released boolean default false, created_at)

-- availability view (public)
create view v_color_availability as
select c.id as color_id, c.fabric_id,
       coalesce(sum(l.meters),0)                                         as on_hand_m,
       coalesce((select sum(meters) from stock_reservations r where r.color_id=c.id and r.status='active'),0) as reserved_m,
       coalesce((select sum(meters) from order_allocations a where a.color_id=c.id and not a.released),0)    as allocated_m,
       greatest(coalesce(sum(l.meters),0) - reserved - allocated, 0)     as available_m   -- write fully in SQL
from fabric_colors c left join stock_lots l on l.color_id = c.id group by c.id;
```

### Stock functions (security definer, validate `auth.uid()` inside)
- `reserve_stock(p_color_id uuid, p_meters numeric) returns stock_reservations`: locks the color row `for update`, checks role client, checks `available_m >= p_meters`, `p_meters >= moq`, active count < limit, inserts with `expires_at = now() + make_interval(hours => setting reservation_hours)`.
- `cancel_reservation(p_id)`, `expire_reservations()` (cron every 5 min), `remind_reservations()` (cron every 15 min, 6h before expiry → enqueue email).
- `allocate_order(p_order_id)`: for each line inserts `order_allocations`, converts linked reservations.
- `record_cut(p_job_id, p_lot_id, p_cut_m)`: inserts a `cut` movement, releases the allocation for that line, updates the job.

## Customers
```sql
profiles (id uuid primary key references auth.users on delete cascade, role user_role default 'client',
          full_name text, phone text, preferred_locale locale default 'fr', client_id uuid null,
          deletion_requested_at timestamptz, created_at, updated_at)
clients (id, company_name text not null, tax_id text, website text, country text, notes_internal text,
         assigned_sales_id uuid null references profiles, created_at, updated_at)
addresses (id, client_id fk, kind text check (kind in ('billing','shipping')), line1, line2, city, postal_code, country, is_default bool)
```
Trigger `handle_new_user` on `auth.users` insert: creates `clients` (company from metadata) and `profiles`.

## Quotes, samples, orders
```sql
quotes (id, ref text unique, client_id fk not null, created_by uuid, status quote_status default 'draft',
        revision int default 1, currency text not null, discount_pct numeric(5,2) default 0, vat_rate numeric(5,4),
        subtotal numeric(12,2), total numeric(12,2),   -- computed by function recompute_quote()
        valid_until date, client_message text, rejection_reason text, internal_notes text,
        pdf_path text, source text check (source in ('cart','match','planner','admin')) default 'cart',
        match_session_id uuid null, collection_id uuid null,
        submitted_at, sent_at, decided_at, created_at, updated_at)
  -- unique partial index: one 'draft' quote per client

quote_lines (id, quote_id fk cascade, color_id fk not null, meters numeric(10,2) not null,
             unit_price numeric(12,2) not null,     -- from tier at time of add; staff may override
             price_overridden boolean default false, line_total numeric(12,2), note text, sort int,
             reservation_id uuid null)

sample_requests (id, ref text unique, client_id fk, status sample_status default 'requested',
                 shipping_address jsonb not null, rejection_reason text, carrier text, tracking_number text,
                 created_at, updated_at)
sample_request_items (id, sample_request_id fk cascade, color_id fk)

orders (id, ref text unique, client_id fk, quote_id fk unique, status order_status default 'confirmed',
        payment_status payment_status default 'unpaid', currency, subtotal, discount_pct, vat_rate, total,
        shipping_address jsonb, billing_address jsonb, internal_notes, cancelled_reason, created_at, updated_at)
order_lines (id, order_id fk cascade, color_id fk, meters, unit_price, line_total)

cutting_jobs (id, order_line_id fk unique, status cutting_status default 'queued', lot_id fk null,
              planned_m numeric, cut_m numeric null, assigned_to uuid null, started_at, finished_at, notes, sort int)

deliveries (id, order_id fk, status delivery_status default 'scheduled', carrier text, tracking_number text,
            scheduled_date date, delivered_at timestamptz, failure_reason text, created_at, updated_at)
```

## AI
```sql
match_sessions (id, user_id uuid null, session_token text null,   -- anonymous owner via httpOnly cookie
                locale locale, mode text check (mode in ('wizard','snap','planner')) default 'wizard',
                input jsonb not null,       -- wizard answers / image path
                specs jsonb,                -- extracted spec (06-ai-matching.md §3)
                feedback smallint null,     -- -1 / +1 from user
                created_at)
match_session_iterations (id, session_id fk cascade, n int, refinements text[], specs jsonb,
                          results jsonb,    -- [{color_id,fabric_id,score,components,explanation}]
                          latency_ms int, llm_input_tokens int, llm_output_tokens int, cost_usd numeric(8,5), created_at)
snap_uploads (P2), collections / collection_items (P2), tour_slots / tour_bookings (P4): see 08b-phase2-4-features.md
bake_jobs, texture_jobs (P3): see 08-cloth-system.md
```

## System
```sql
app_settings (key text primary key, value jsonb not null, is_public boolean default false, updated_at)
  -- keys + defaults:
  -- company_name "SATEX Commerce" (public), tagline i18n (public), contact_email "Satexcommerce@ymail.com" (public),
  -- contact_phone "" (public), contact_address "" (public), whatsapp "" (public), founded_year 1995 (public),
  -- currency "EUR" (public), vat_rate 0.20 (public), show_prices_public true (public),
  -- reservation_hours 48, max_active_reservations_per_client 3, quote_validity_days 15,
  -- max_colors_per_sample_request 5, max_open_sample_requests_per_client 2, low_stock_threshold_m 50,
  -- match_rate_limit_per_hour_guest 10, match_rate_limit_per_hour_user 30, staff_notification_email "Satexcommerce@ymail.com",
  -- timezone "Europe/Paris" (public), staff_locale "fr", quote_terms i18n (placeholder text from seed)
create view public_settings as select key, value from app_settings where is_public;

notifications (id, user_id fk, type text, payload jsonb, read_at timestamptz, created_at)      -- in-app bell
email_log (id, to_email, template text, locale, payload jsonb, provider_id text, status text, error text, created_at)
contact_messages (id, name, company, email, phone, message, locale, handled boolean default false, created_at)
rate_limits (key text, window_start timestamptz, count int, primary key (key, window_start))
audit_log (id, actor_id, table_name, row_id, action, old jsonb, new jsonb, at timestamptz default now())
```

## Queues (pgmq)
`q_embed`, `q_translate`, `q_email`, `q_texture` (P3), `q_bake` (P3). Message format in `12-dev-ops.md` §Jobs.

## pg_cron schedules
| Job | Schedule |
|---|---|
| `select expire_reservations()` | `*/5 * * * *` |
| `select remind_reservations()` | `*/15 * * * *` |
| `select expire_quotes()` (sent and `valid_until < today` → `expired`) | `0 2 * * *` |
| delete `match_sessions` with no user older than 90 days; delete `snap-uploads` objects older than 30 days | `0 3 * * *` |

## Storage buckets
| Bucket | Public | Content | Limits |
|---|---|---|---|
| `fabric-images` | yes | catalog photos (`fabrics/{fabric_id}/{uuid}.webp`) | 10 MB, image/* |
| `textures` | yes | P3 texture maps, KTX2 | 20 MB |
| `models` | yes | showroom & garment glTF, bakes | 50 MB |
| `quote-pdfs` | no (signed URLs, 10 min) | `quotes/{quote_id}/r{revision}.pdf` | – |
| `snap-uploads` | no | P2 user photos, deleted after 30 days | 8 MB |
| `brand` | yes | logo, OG images | – |
