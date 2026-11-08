-- P1-03 / 5: AI match logs, notifications, email log, contact messages, rate limits, audit log.

create table public.match_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  session_token text,                            -- anonymous owner token (httpOnly cookie); resolved server-side
  locale locale not null default 'fr',
  mode text not null default 'wizard' check (mode in ('wizard','snap','planner')),
  input jsonb not null,
  specs jsonb,
  feedback smallint check (feedback in (-1, 1)),
  created_at timestamptz not null default now()
);
create index on public.match_sessions (user_id);
create index on public.match_sessions (session_token) where session_token is not null;
create index on public.match_sessions (created_at);

create table public.match_session_iterations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.match_sessions on delete cascade,
  n int not null,
  refinements text[] not null default '{}',
  specs jsonb,
  results jsonb,
  latency_ms int,
  llm_input_tokens int,
  llm_output_tokens int,
  cost_usd numeric(8,5),
  created_at timestamptz not null default now(),
  unique (session_id, n)
);

alter table public.quotes
  add constraint quotes_match_session_fk foreign key (match_session_id) references public.match_sessions (id) on delete set null;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  template text not null,
  locale locale,
  payload jsonb,
  provider_id text,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now()
);

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text not null,
  phone text,
  message text not null,
  locale locale not null default 'fr',
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  table_name text not null,
  row_id text,
  action text not null,
  old jsonb,
  new jsonb,
  at timestamptz not null default now()
);
create index on public.audit_log (table_name, at desc);

-- rate limiter: returns true when the call is allowed
create function public.hit_rate_limit(p_key text, p_limit int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into public.rate_limits as r (key, window_start, count) values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end $$;
revoke execute on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;

-- generic audit trigger (actor = auth.uid(), null for service role)
create function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (actor_id, table_name, row_id, action, old, new)
  values (
    auth.uid(), tg_table_name,
    coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
             (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'key'),
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_quotes after insert or update or delete on public.quotes for each row execute function public.audit_trigger();
create trigger audit_orders after insert or update or delete on public.orders for each row execute function public.audit_trigger();
create trigger audit_cutting_jobs after insert or update or delete on public.cutting_jobs for each row execute function public.audit_trigger();
create trigger audit_stock_movements after insert on public.stock_movements for each row execute function public.audit_trigger();
create trigger audit_app_settings after insert or update or delete on public.app_settings for each row execute function public.audit_trigger();
create trigger audit_profile_role after update on public.profiles for each row
  when (old.role is distinct from new.role) execute function public.audit_trigger();
