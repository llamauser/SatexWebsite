-- P1-03 / 3: catalog (categories, fabrics, prices, colors, images, feel, embeddings).

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name jsonb not null check (name ? 'fr'),
  description jsonb,
  icon text,
  sort int not null default 0
);

create table public.fabrics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  sku text not null unique,
  name jsonb not null check (name ? 'fr'),
  short_description jsonb,
  description jsonb,
  category_id uuid not null references public.categories,
  construction fabric_construction not null,
  structure fabric_structure not null,
  composition jsonb not null check (public.composition_is_valid(composition)),
  gsm int not null check (gsm between 20 and 1200),
  width_cm int not null check (width_cm between 50 and 340),
  stretch stretch_level not null default 'none',
  stretch_pct int check (stretch_pct is null or stretch_pct between 0 and 400),
  finish text[] not null default '{}',
  uses text[] not null default '{}',
  seasons season[] not null default '{all_season}',
  tags text[] not null default '{}',
  moq_m numeric(10,2) not null default 1 check (moq_m > 0),
  base_price_per_m numeric(12,2) not null check (base_price_per_m >= 0),
  eco jsonb not null default '{}',
  is_active boolean not null default false,
  is_featured boolean not null default false,
  is_demo boolean not null default false,
  machine_translated jsonb not null default '{}',
  search_text tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fabrics_category_idx on public.fabrics (category_id);
create index fabrics_active_idx on public.fabrics (is_active, is_featured);
create index fabrics_search_idx on public.fabrics using gin (search_text);
create index fabrics_name_trgm_idx on public.fabrics using gin ((lower(name ->> 'fr')) extensions.gin_trgm_ops);
create index fabrics_uses_idx on public.fabrics using gin (uses);
create index fabrics_composition_idx on public.fabrics using gin (composition jsonb_path_ops);

-- search_text is maintained by a trigger (array_to_string is not immutable, so no generated column)
create function public.fabrics_set_search_text() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  new.search_text := to_tsvector('simple', public.immutable_unaccent(
      coalesce(new.name ->> 'fr', '') || ' ' || coalesce(new.name ->> 'en', '') || ' ' ||
      coalesce(array_to_string(new.tags, ' '), '') || ' ' || new.structure::text || ' ' || new.sku));
  return new;
end $$;
create trigger fabrics_search_text before insert or update on public.fabrics
  for each row execute function public.fabrics_set_search_text();
create trigger fabrics_updated_at before update on public.fabrics
  for each row execute function public.set_updated_at();

create table public.fabric_price_tiers (
  id uuid primary key default gen_random_uuid(),
  fabric_id uuid not null references public.fabrics on delete cascade,
  min_m numeric(10,2) not null check (min_m > 0),
  price_per_m numeric(12,2) not null check (price_per_m >= 0),
  unique (fabric_id, min_m)
);

create table public.fabric_colors (
  id uuid primary key default gen_random_uuid(),
  fabric_id uuid not null references public.fabrics on delete cascade,
  code text not null,
  name jsonb not null check (name ? 'fr'),
  hex text not null check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  lab real[],
  is_active boolean not null default true,
  sort int not null default 0,
  texture jsonb,                       -- Phase 3: {"albedo":url,"normal":url,"roughness":url,"repeat_cm":10}
  unique (fabric_id, code)
);
create index on public.fabric_colors (fabric_id);

create function public.fabric_colors_set_lab() returns trigger
language plpgsql as $$
begin
  new.lab := public.hex_to_lab(new.hex);
  return new;
end $$;
create trigger fabric_colors_lab before insert or update of hex on public.fabric_colors
  for each row execute function public.fabric_colors_set_lab();

create table public.fabric_images (
  id uuid primary key default gen_random_uuid(),
  fabric_id uuid not null references public.fabrics on delete cascade,
  color_id uuid references public.fabric_colors on delete cascade,
  storage_path text not null,
  alt jsonb,
  kind text not null default 'photo' check (kind in ('photo','macro','flat_swatch','lifestyle')),
  sort int not null default 0
);
create index on public.fabric_images (fabric_id);
create index on public.fabric_images (color_id);

create table public.fabric_feel (
  fabric_id uuid primary key references public.fabrics on delete cascade,
  softness real check (softness between 0 and 10),
  drape real check (drape between 0 and 10),
  stretch real check (stretch between 0 and 10),
  sheen real check (sheen between 0 and 10),
  breathability real check (breathability between 0 and 10),
  measured jsonb not null default '{}',
  is_measured boolean not null default false,
  sim_params jsonb,
  updated_at timestamptz not null default now()
);
create trigger fabric_feel_updated_at before update on public.fabric_feel
  for each row execute function public.set_updated_at();

create table public.embeddings (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('fabric','color_image')),
  owner_id uuid not null,
  kind text not null check (kind in ('text','image')),
  model text not null,
  embedding extensions.vector(1024) not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (owner_type, owner_id, kind)
);
create index embeddings_hnsw_idx on public.embeddings using hnsw (embedding extensions.vector_cosine_ops);
