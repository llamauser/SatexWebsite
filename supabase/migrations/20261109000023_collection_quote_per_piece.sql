-- The planner quote should retain one quote line per collection item so sales can review each garment separately.
create or replace function public.request_collection_quote(p_collection uuid, p_message text default null) returns public.quotes
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

  insert into public.quote_lines (quote_id, color_id, meters, unit_price, sort)
  select v_q.id, i.chosen_color_id, i.meters_needed,
         coalesce(
           (select p.price_per_m from public.fabric_price_tiers p where p.fabric_id = c.fabric_id and p.min_m <= i.meters_needed order by p.min_m desc limit 1),
           (select p.price_per_m from public.fabric_price_tiers p where p.fabric_id = c.fabric_id order by p.min_m limit 1),
           0),
         i.sort
    from public.collection_items i
    join public.fabric_colors c on c.id = i.chosen_color_id
   where i.collection_id = p_collection and coalesce(i.meters_needed, 0) > 0
   order by i.sort;

  update public.collections set status = 'quoted', quote_id = v_q.id where id = p_collection;
  select * into v_q from public.quotes where id = v_q.id;
  return v_q;
end $$;
revoke all on function public.request_collection_quote(uuid, text) from public;
grant execute on function public.request_collection_quote(uuid, text) to authenticated;
