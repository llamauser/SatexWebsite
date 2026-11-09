-- Collection Planner (docs/08b-phase2-4-features.md §B): a client describes a whole line, the site proposes a coherent in-stock fabric plan with
-- meterage, and the client turns it into one quote.

-- ---------------------------------------------------------------- how much fabric a garment takes
create table public.garment_consumption (
  garment_type    text primary key check (garment_type ~ '^[a-z][a-z_]*$'),
  base_m_per_unit numeric(6,2) not null check (base_m_per_unit > 0),   -- metres for one piece, size M, in a fabric 150 cm wide
  ref_width_cm    int not null default 150 check (ref_width_cm > 0),
  size_factors    jsonb not null default '{"XS":0.9,"S":0.95,"M":1,"L":1.05,"XL":1.1,"XXL":1.15}'
);

insert into public.garment_consumption (garment_type, base_m_per_unit, size_factors) values
  ('t_shirt', 0.8, default), ('polo', 0.9, default), ('shirt', 1.6, default), ('dress_short', 1.8, default), ('dress_long', 2.8, default),
  ('skirt', 1.0, default), ('trousers', 1.4, default), ('jeans', 1.5, default), ('shorts', 0.8, default), ('jacket', 2.0, default),
  ('coat', 2.8, default), ('hoodie', 1.6, default), ('leggings', 0.7, default), ('sports_bra', 0.4, default), ('swimsuit', 0.5, default),
  ('cushion_cover', 0.6, '{"M":1}'), ('curtain_panel', 3.0, '{"M":1}');

alter table public.garment_consumption enable row level security;
create policy garment_consumption_read on public.garment_consumption for select using (true);
create policy garment_consumption_admin on public.garment_consumption for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- collections
create table public.collections (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 120),
  season     public.season,
  brief      jsonb not null default '{}',                 -- {audienceText, styles[], budgetPerM, description}
  palette    jsonb not null default '[]',                 -- [{name, hex}]
  status     text not null default 'draft' check (status in ('draft','planned','quoted')),
  quote_id   uuid references public.quotes on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.collections (client_id, updated_at desc);
create trigger collections_updated_at before update on public.collections for each row execute function public.set_updated_at();

create table public.collection_items (
  id             uuid primary key default gen_random_uuid(),
  collection_id  uuid not null references public.collections on delete cascade,
  garment_type   text not null references public.garment_consumption,
  label          text not null default '' check (length(label) <= 120),
  quantity_units int not null check (quantity_units between 1 and 100000),
  size_run       jsonb not null default '{}',             -- {"XS":10,"S":20,...}
  notes          text not null default '' check (length(notes) <= 500),
  spec           jsonb,                                   -- what the plan asked for (the AI's Spec)
  chosen_color_id uuid references public.fabric_colors on delete set null,
  alternatives   jsonb not null default '[]',             -- the best colors found, with what the screen needs to swap and recompute
  meters_needed  numeric(10,2) check (meters_needed >= 0),
  sort           int not null default 0
);
create index on public.collection_items (collection_id, sort);

alter table public.quotes add constraint quotes_collection_fk foreign key (collection_id) references public.collections on delete set null;

-- ---------------------------------------------------------------- who sees what: the client of a collection, and staff
create function public.collection_is_mine(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.collections c where c.id = p_id and c.client_id = public.my_client_id())
$$;
revoke all on function public.collection_is_mine(uuid) from public;
grant execute on function public.collection_is_mine(uuid) to authenticated;

alter table public.collections enable row level security;
alter table public.collection_items enable row level security;

create policy collections_read on public.collections for select using (client_id = public.my_client_id() or public.is_staff());
create policy collections_insert on public.collections for insert with check (client_id = public.my_client_id() and status = 'draft' and quote_id is null);
-- a client edits their own collection until it is quoted; the status and the quote link are only changed by the functions below
create policy collections_update on public.collections for update
  using (client_id = public.my_client_id() and status <> 'quoted')
  with check (client_id = public.my_client_id() and status in ('draft','planned') and quote_id is null);
create policy collections_delete on public.collections for delete using (client_id = public.my_client_id() and status <> 'quoted');

create policy collection_items_read on public.collection_items for select using (public.collection_is_mine(collection_id) or public.is_staff());
create policy collection_items_write on public.collection_items for all
  using (public.collection_is_mine(collection_id) and exists (select 1 from public.collections c where c.id = collection_id and c.status <> 'quoted'))
  with check (public.collection_is_mine(collection_id) and exists (select 1 from public.collections c where c.id = collection_id and c.status <> 'quoted'));

-- a client keeps seeing the fabrics of their collections (like those of their quotes) even if one is later deactivated
create or replace function public.color_in_my_documents(p_color_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_client_id() is not null and (
    exists (select 1 from public.quote_lines l join public.quotes q on q.id = l.quote_id where l.color_id = p_color_id and q.client_id = public.my_client_id())
    or exists (select 1 from public.order_lines l join public.orders o on o.id = l.order_id where l.color_id = p_color_id and o.client_id = public.my_client_id())
    or exists (select 1 from public.sample_request_items i join public.sample_requests s on s.id = i.sample_request_id where i.color_id = p_color_id and s.client_id = public.my_client_id())
    or exists (select 1 from public.stock_reservations r where r.color_id = p_color_id and r.client_id = public.my_client_id())
    or exists (select 1 from public.collection_items i join public.collections c on c.id = i.collection_id where i.chosen_color_id = p_color_id and c.client_id = public.my_client_id())
  )
$$;

-- ---------------------------------------------------------------- the collection becomes one quote
-- The unique "one draft per client" index is the reason this is one function: the quote is created already submitted, with its lines, in one
-- transaction, and it never gets in the way of the client's cart.
create function public.request_collection_quote(p_collection uuid, p_message text default null) returns public.quotes
language plpgsql security definer set search_path = '' as $$
declare
  v_col public.collections;
  v_q public.quotes;
  v_user uuid := auth.uid();
begin
  select * into v_col from public.collections where id = p_collection for update;
  if not found then raise exception 'collection not found'; end if;
  if public.app_role() <> 'client' or v_col.client_id <> public.my_client_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_col.status = 'quoted' then raise exception 'this collection already has a quote'; end if;
  if not exists (select 1 from public.collection_items where collection_id = p_collection and chosen_color_id is not null and coalesce(meters_needed, 0) > 0) then
    raise exception 'the collection has no planned piece';
  end if;

  insert into public.quotes (client_id, created_by, status, submitted_at, source, collection_id, client_message)
  values (v_col.client_id, v_user, 'submitted', now(), 'planner', p_collection, nullif(btrim(coalesce(p_message, '')), ''))
  returning * into v_q;

  -- one line per color: pieces made in the same fabric are added up (and so get the better price of the bigger quantity)
  insert into public.quote_lines (quote_id, color_id, meters, unit_price, sort)
  select v_q.id, t.color_id, t.meters,
         coalesce(
           (select p.price_per_m from public.fabric_price_tiers p where p.fabric_id = c.fabric_id and p.min_m <= t.meters order by p.min_m desc limit 1),
           (select p.price_per_m from public.fabric_price_tiers p where p.fabric_id = c.fabric_id order by p.min_m limit 1),
           0),
         t.first_sort
    from (
      select i.chosen_color_id as color_id, sum(i.meters_needed) as meters, min(i.sort) as first_sort
        from public.collection_items i
       where i.collection_id = p_collection and i.chosen_color_id is not null and coalesce(i.meters_needed, 0) > 0
       group by i.chosen_color_id) t
    join public.fabric_colors c on c.id = t.color_id;

  update public.collections set status = 'quoted', quote_id = v_q.id where id = p_collection;
  select * into v_q from public.quotes where id = v_q.id; -- totals were computed by the line triggers
  return v_q;
end $$;
revoke all on function public.request_collection_quote(uuid, text) from public;
grant execute on function public.request_collection_quote(uuid, text) to authenticated;

-- a quote created already submitted (not moved from draft) must also queue its emails
create or replace function public.enqueue_quote_emails() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_template text;
  v_templates text[];
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;

  v_templates := case new.status
    when 'submitted' then array['quote_submitted_client', 'quote_submitted_staff']
    when 'sent'      then array['quote_sent']
    when 'accepted'  then array['quote_accepted_staff']
    when 'rejected'  then array['quote_rejected_staff']
    when 'expired'   then array['quote_expired']
    else '{}'::text[]
  end;

  foreach v_template in array v_templates loop
    perform pgmq.send('q_email', jsonb_build_object(
      'type', 'q_email', 'template', v_template, 'id', new.id, 'key', new.revision::text, 'attempt', 1));
  end loop;
  return null;
end $$;

create trigger quotes_enqueue_emails_insert after insert on public.quotes
  for each row when (new.status <> 'draft') execute function public.enqueue_quote_emails();

-- the planner's quote shows in the client's list like any other, and staff see which collection it came from
create index on public.quotes (collection_id) where collection_id is not null;
