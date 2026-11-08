-- P1-03 / 4: departments, stock, quotes, samples, orders, cutting, deliveries.

-- ---------------------------------------------------------------- departments
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name jsonb not null check (name ? 'fr'),
  floor smallint not null check (floor in (0,1)),
  kind text not null check (kind in ('fabric_hall','cutting','shipping','studio','client_suite','office')),
  layout jsonb not null,
  category_ids uuid[] not null default '{}',
  sort int not null default 0
);

-- ---------------------------------------------------------------- stock
create table public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  color_id uuid not null references public.fabric_colors on delete cascade,
  lot_code text not null unique,
  meters numeric(10,2) not null default 0 check (meters >= 0),
  department_id uuid references public.departments on delete set null,
  location text,
  received_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.stock_lots (color_id);
create trigger stock_lots_updated_at before update on public.stock_lots
  for each row execute function public.set_updated_at();

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.stock_lots,
  type stock_movement_type not null,
  meters numeric(10,2) not null,                 -- signed
  reason text,
  ref_table text,
  ref_id uuid,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index on public.stock_movements (lot_id, created_at);

-- stock_lots.meters changes ONLY through stock_movements:
--   receive / adjust / cut change the on-hand meters (signed delta);
--   allocate / release / transfer are log-only (allocations live in order_allocations).
create function public.stock_lots_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.meters <> 0 then
      raise exception 'insert stock lots with 0 meters, then use receive_lot() / stock movements' using errcode = '42501';
    end if;
  elsif new.meters is distinct from old.meters and pg_trigger_depth() < 2 then
    raise exception 'stock_lots.meters can only change through stock_movements' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger stock_lots_guard before insert or update on public.stock_lots
  for each row execute function public.stock_lots_guard();

create function public.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.type in ('receive','adjust','cut') then
    update public.stock_lots set meters = meters + new.meters where id = new.lot_id;  -- CHECK (meters >= 0) rejects overdraw
  end if;
  return new;
end $$;
create trigger stock_movements_apply after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

create function public.stock_movements_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'stock movements are append-only' using errcode = '42501';
end $$;
create trigger stock_movements_no_update before update or delete on public.stock_movements
  for each row execute function public.stock_movements_immutable();

-- ---------------------------------------------------------------- quotes (before reservations: reservations point at quote lines)
create sequence public.quote_ref_seq;
create sequence public.order_ref_seq;
create sequence public.sample_ref_seq;

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  client_id uuid not null references public.clients,
  created_by uuid references auth.users on delete set null,
  status quote_status not null default 'draft',
  revision int not null default 1,
  currency text,
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  vat_rate numeric(5,4),
  subtotal numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  valid_until date,
  client_message text,
  rejection_reason text,
  internal_notes text,
  pdf_path text,
  source text not null default 'cart' check (source in ('cart','match','planner','admin')),
  match_session_id uuid,                         -- FK added once match_sessions exists
  collection_id uuid,                            -- FK added in Phase 2 (collections table)
  is_demo boolean not null default false,
  submitted_at timestamptz,
  sent_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index quotes_one_draft_per_client on public.quotes (client_id) where status = 'draft';
create index on public.quotes (client_id, status);
create index on public.quotes (status, created_at);

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes on delete cascade,
  color_id uuid not null references public.fabric_colors,
  meters numeric(10,2) not null check (meters > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  price_overridden boolean not null default false,
  line_total numeric(12,2) not null default 0,
  note text,
  sort int not null default 0,
  reservation_id uuid
);
create index on public.quote_lines (quote_id);
create index on public.quote_lines (color_id);

-- reservations
create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  color_id uuid not null references public.fabric_colors on delete cascade,
  client_id uuid not null references public.clients,
  meters numeric(10,2) not null check (meters > 0),
  status reservation_status not null default 'active',
  expires_at timestamptz not null,
  quote_line_id uuid references public.quote_lines on delete set null,
  reminded_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.stock_reservations (color_id) where status = 'active';
create index on public.stock_reservations (client_id, status);
create index on public.stock_reservations (expires_at) where status = 'active';
alter table public.quote_lines
  add constraint quote_lines_reservation_fk foreign key (reservation_id) references public.stock_reservations (id) on delete set null;

-- ---------------------------------------------------------------- samples
create table public.sample_requests (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  client_id uuid not null references public.clients,
  status sample_status not null default 'requested',
  shipping_address jsonb not null,
  rejection_reason text,
  carrier text,
  tracking_number text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.sample_requests (client_id, status);

create table public.sample_request_items (
  id uuid primary key default gen_random_uuid(),
  sample_request_id uuid not null references public.sample_requests on delete cascade,
  color_id uuid not null references public.fabric_colors
);
create index on public.sample_request_items (sample_request_id);

-- ---------------------------------------------------------------- orders
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  client_id uuid not null references public.clients,
  quote_id uuid not null unique references public.quotes,
  status order_status not null default 'confirmed',
  payment_status payment_status not null default 'unpaid',
  currency text not null,
  subtotal numeric(12,2) not null,
  discount_pct numeric(5,2) not null default 0,
  vat_rate numeric(5,4) not null,
  total numeric(12,2) not null,
  shipping_address jsonb,
  billing_address jsonb,
  internal_notes text,
  cancelled_reason text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.orders (client_id, status);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders on delete cascade,
  color_id uuid not null references public.fabric_colors,
  meters numeric(10,2) not null check (meters > 0),
  unit_price numeric(12,2) not null,
  line_total numeric(12,2) not null
);
create index on public.order_lines (order_id);

create table public.order_allocations (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null references public.order_lines on delete cascade,
  color_id uuid not null references public.fabric_colors,
  meters numeric(10,2) not null check (meters > 0),
  released boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.order_allocations (color_id) where not released;

create table public.cutting_jobs (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null unique references public.order_lines on delete cascade,
  status cutting_status not null default 'queued',
  lot_id uuid references public.stock_lots,
  planned_m numeric(10,2) not null,
  cut_m numeric(10,2),
  assigned_to uuid references public.profiles on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  notes text,
  sort int not null default 0
);
create index on public.cutting_jobs (status, sort);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders,
  status delivery_status not null default 'scheduled',
  carrier text,
  tracking_number text,
  scheduled_date date,
  delivered_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.deliveries (order_id);

-- updated_at triggers
create trigger clients_updated_at before update on public.clients for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger addresses_updated_at before update on public.addresses for each row execute function public.set_updated_at();
create trigger quotes_updated_at before update on public.quotes for each row execute function public.set_updated_at();
create trigger sample_requests_updated_at before update on public.sample_requests for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger deliveries_updated_at before update on public.deliveries for each row execute function public.set_updated_at();
create trigger app_settings_updated_at before update on public.app_settings for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- availability view (public, runs with owner rights)
create view public.v_color_availability as
select
  c.id as color_id,
  c.fabric_id,
  coalesce(l.on_hand, 0)::numeric(12,2)   as on_hand_m,
  coalesce(r.reserved, 0)::numeric(12,2)  as reserved_m,
  coalesce(a.allocated, 0)::numeric(12,2) as allocated_m,
  greatest(coalesce(l.on_hand, 0) - coalesce(r.reserved, 0) - coalesce(a.allocated, 0), 0)::numeric(12,2) as available_m
from public.fabric_colors c
join public.fabrics f on f.id = c.fabric_id and f.is_active and c.is_active
left join (select color_id, sum(meters) as on_hand from public.stock_lots group by color_id) l on l.color_id = c.id
left join (select color_id, sum(meters) as reserved from public.stock_reservations where status = 'active' group by color_id) r on r.color_id = c.id
left join (select color_id, sum(meters) as allocated from public.order_allocations where not released group by color_id) a on a.color_id = c.id;

-- internal version without the "active" filter, for server-side functions
create view public.v_color_availability_all as
select
  c.id as color_id,
  c.fabric_id,
  coalesce(l.on_hand, 0)::numeric(12,2)   as on_hand_m,
  coalesce(r.reserved, 0)::numeric(12,2)  as reserved_m,
  coalesce(a.allocated, 0)::numeric(12,2) as allocated_m,
  greatest(coalesce(l.on_hand, 0) - coalesce(r.reserved, 0) - coalesce(a.allocated, 0), 0)::numeric(12,2) as available_m
from public.fabric_colors c
left join (select color_id, sum(meters) as on_hand from public.stock_lots group by color_id) l on l.color_id = c.id
left join (select color_id, sum(meters) as reserved from public.stock_reservations where status = 'active' group by color_id) r on r.color_id = c.id
left join (select color_id, sum(meters) as allocated from public.order_allocations where not released group by color_id) a on a.color_id = c.id;
revoke all on public.v_color_availability_all from anon, authenticated;
