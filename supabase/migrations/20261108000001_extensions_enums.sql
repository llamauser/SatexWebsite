-- P1-03 / 1: extensions, enums, generic helpers.  Spec: docs/04-database.md

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pgmq;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------- enums
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
create type job_status           as enum ('pending','running','done','failed');

-- ---------------------------------------------------------------- generic helpers
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- unaccent() is not immutable; this wrapper is safe for our use (static dictionary)
create function public.immutable_unaccent(p_text text) returns text
language sql immutable parallel safe strict
set search_path = extensions, pg_catalog
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, p_text) $$;

-- composition = [{"fiber":"cotton","pct":92},{"fiber":"elastane","pct":8}], must sum to 100
create function public.composition_is_valid(c jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(c) = 'array'
     and jsonb_array_length(c) > 0
     and (select coalesce(sum((e ->> 'pct')::numeric), 0) from jsonb_array_elements(c) e) = 100
$$;

-- hex "#RRGGBB" -> CIELAB (D65) as real[3]
create function public.hex_to_lab(p_hex text) returns real[]
language plpgsql immutable as $$
declare
  r double precision; g double precision; b double precision;
  x double precision; y double precision; z double precision;
  fx double precision; fy double precision; fz double precision;
begin
  r := (('x' || substr(p_hex, 2, 2))::bit(8)::int) / 255.0;
  g := (('x' || substr(p_hex, 4, 2))::bit(8)::int) / 255.0;
  b := (('x' || substr(p_hex, 6, 2))::bit(8)::int) / 255.0;
  r := case when r <= 0.04045 then r / 12.92 else power((r + 0.055) / 1.055, 2.4) end;
  g := case when g <= 0.04045 then g / 12.92 else power((g + 0.055) / 1.055, 2.4) end;
  b := case when b <= 0.04045 then b / 12.92 else power((b + 0.055) / 1.055, 2.4) end;
  x := (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  y := (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / 1.0;
  z := (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  fx := case when x > 0.008856 then cbrt(x) else 7.787 * x + 16.0 / 116 end;
  fy := case when y > 0.008856 then cbrt(y) else 7.787 * y + 16.0 / 116 end;
  fz := case when z > 0.008856 then cbrt(z) else 7.787 * z + 16.0 / 116 end;
  return array[(116 * fy - 16)::real, (500 * (fx - fy))::real, (200 * (fy - fz))::real];
end $$;
