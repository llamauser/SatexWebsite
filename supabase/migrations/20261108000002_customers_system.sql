-- P1-03 / 2: customers (clients, profiles, addresses), app settings, role helpers.

-- ---------------------------------------------------------------- clients / profiles
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  tax_id text,
  website text,
  country text,
  notes_internal text,
  assigned_sales_id uuid,                       -- FK to profiles added below
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  role user_role not null default 'client',
  full_name text,
  phone text,
  preferred_locale locale not null default 'fr',
  client_id uuid references public.clients on delete set null,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clients
  add constraint clients_assigned_sales_fk foreign key (assigned_sales_id) references public.profiles (id) on delete set null;
create index on public.profiles (client_id);
create index on public.profiles (role);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients on delete cascade,
  kind text not null check (kind in ('billing','shipping')),
  line1 text not null,
  line2 text,
  city text not null,
  postal_code text,
  country text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.addresses (client_id);

-- ---------------------------------------------------------------- role helpers (read the JWT claim set by the access-token hook)
create function public.app_role() returns text
language sql stable as $$
  select coalesce(nullif(auth.jwt() ->> 'user_role', ''), 'guest')
$$;

create function public.is_staff() returns boolean
language sql stable as $$ select public.app_role() in ('sales','admin') $$;

create function public.is_admin() returns boolean
language sql stable as $$ select public.app_role() = 'admin' $$;

-- client_id of the signed-in user (security definer so policies on `profiles` cannot recurse)
create function public.my_client_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select client_id from public.profiles where id = auth.uid()
$$;

-- ---------------------------------------------------------------- sign-up: create client + profile (role is ALWAYS 'client')
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_client_id uuid;
  v_locale public.locale;
begin
  insert into public.clients (company_name)
  values (coalesce(nullif(trim(new.raw_user_meta_data ->> 'company_name'), ''), split_part(new.email, '@', 1), 'Client'))
  returning id into v_client_id;

  v_locale := case when new.raw_user_meta_data ->> 'preferred_locale' in ('fr','en','ar')
                   then (new.raw_user_meta_data ->> 'preferred_locale')::public.locale else 'fr' end;

  insert into public.profiles (id, role, full_name, phone, preferred_locale, client_id)
  values (new.id, 'client', nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
          nullif(trim(new.raw_user_meta_data ->> 'phone'), ''), v_locale, v_client_id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- users cannot promote themselves or re-point their client
create function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- auth.uid() is null for service role / migrations / SQL console: allowed
  if auth.uid() is not null and not (coalesce(auth.jwt() ->> 'user_role', '') = 'admin') then
    if new.role is distinct from old.role then
      raise exception 'only an admin can change a role' using errcode = '42501';
    end if;
    if new.client_id is distinct from old.client_id then
      raise exception 'client_id cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------- custom access token hook: puts profiles.role in the JWT as `user_role`
create function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable as $$
declare
  v_role public.user_role;
  v_claims jsonb := event -> 'claims';
begin
  select role into v_role from public.profiles where id = (event ->> 'user_id')::uuid;
  v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(coalesce(v_role::text, 'client')));
  return jsonb_set(event, '{claims}', v_claims);
end $$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on public.profiles to supabase_auth_admin;
create policy "auth admin reads profiles for the token hook" on public.profiles
  for select to supabase_auth_admin using (true);

-- ---------------------------------------------------------------- app settings
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

create view public.public_settings as
  select key, value from public.app_settings where is_public;

create function public.setting_text(p_key text, p_default text default null) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select value #>> '{}' from public.app_settings where key = p_key), p_default)
$$;
create function public.setting_numeric(p_key text, p_default numeric default null) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = p_key), p_default)
$$;
create function public.setting_bool(p_key text, p_default boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = p_key), p_default)
$$;

insert into public.app_settings (key, value, is_public) values
  ('company_name',        '"SATEX Commerce"', true),
  ('tagline',             '{"fr":"Vente des tissus en gros","en":"Wholesale fabrics","ar":"بيع الأقمشة بالجملة"}', true),
  ('contact_email',       '"Satexcommerce@ymail.com"', true),
  ('contact_phone',       '""', true),
  ('contact_address',     '""', true),
  ('whatsapp',            '""', true),
  ('founded_year',        '1995', true),
  ('currency',            '"EUR"', true),
  ('vat_rate',            '0.20', true),
  ('show_prices_public',  'true', true),
  ('timezone',            '"Europe/Paris"', true),
  ('reservation_hours',   '48', false),
  ('max_active_reservations_per_client', '3', false),
  ('quote_validity_days', '15', false),
  ('max_colors_per_sample_request', '5', false),
  ('max_open_sample_requests_per_client', '2', false),
  ('low_stock_threshold_m', '50', false),
  ('match_rate_limit_per_hour_guest', '10', false),
  ('match_rate_limit_per_hour_user', '30', false),
  ('staff_notification_email', '"Satexcommerce@ymail.com"', false),
  ('staff_locale',        '"fr"', false)
on conflict (key) do nothing;
-- quote_terms (i18n) is added by the seed script.
