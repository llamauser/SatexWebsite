-- P1-13: "Purge demo data" (docs/12-seed-data.md §6).
-- Deletes everything flagged is_demo = true (fabrics, clients, quotes, orders, sample requests) and what hangs from it:
-- the demo clients' accounts, reservations, deliveries, cutting jobs, stock lots with their movements, embeddings.
-- A demo fabric that real records still point at (a real quote line, order line, sample or reservation) is KEPT and reported,
-- so the purge never damages real business data. Admins only. Returns what was deleted.
create function public.purge_demo_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_demo_clients uuid[];
  v_demo_orders uuid[];
  v_demo_quotes uuid[];
  v_fabrics uuid[];
  v_kept int;
  v_out jsonb := '{}'::jsonb;
  n int;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select coalesce(array_agg(id), '{}') into v_demo_clients from public.clients where is_demo;
  select coalesce(array_agg(id), '{}') into v_demo_orders from public.orders where is_demo or client_id = any (v_demo_clients);
  select coalesce(array_agg(id), '{}') into v_demo_quotes from public.quotes where is_demo or client_id = any (v_demo_clients);

  -- orders and what hangs from them (order lines -> allocations and cutting jobs go with them)
  delete from public.deliveries where order_id = any (v_demo_orders);
  delete from public.orders where id = any (v_demo_orders);
  get diagnostics n = row_count; v_out := v_out || jsonb_build_object('orders', n);

  delete from public.stock_reservations
   where client_id = any (v_demo_clients)
      or color_id in (select c.id from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id where f.is_demo);
  get diagnostics n = row_count; v_out := v_out || jsonb_build_object('reservations', n);

  delete from public.quotes where id = any (v_demo_quotes);
  get diagnostics n = row_count; v_out := v_out || jsonb_build_object('quotes', n);

  delete from public.sample_requests where is_demo or client_id = any (v_demo_clients);
  get diagnostics n = row_count; v_out := v_out || jsonb_build_object('sample_requests', n);

  -- demo fabrics that nothing real refers to
  select coalesce(array_agg(f.id), '{}') into v_fabrics from public.fabrics f
   where f.is_demo
     and not exists (select 1 from public.fabric_colors c where c.fabric_id = f.id and (
            exists (select 1 from public.quote_lines l where l.color_id = c.id)
         or exists (select 1 from public.order_lines l where l.color_id = c.id)
         or exists (select 1 from public.sample_request_items i where i.color_id = c.id)
         or exists (select 1 from public.stock_reservations r where r.color_id = c.id)
         or exists (select 1 from public.cutting_jobs j join public.stock_lots l on l.id = j.lot_id where l.color_id = c.id)));
  select count(*) into v_kept from public.fabrics where is_demo and not (id = any (v_fabrics));
  v_out := v_out || jsonb_build_object('fabrics_kept', v_kept);

  -- stock movements are append-only: lift the guard for this one cleanup, inside this transaction
  alter table public.stock_movements disable trigger stock_movements_no_update;
  delete from public.stock_movements where lot_id in (
    select l.id from public.stock_lots l join public.fabric_colors c on c.id = l.color_id where c.fabric_id = any (v_fabrics));
  alter table public.stock_movements enable trigger stock_movements_no_update;

  delete from public.embeddings where owner_type = 'fabric' and owner_id = any (v_fabrics);
  delete from public.fabrics where id = any (v_fabrics);
  get diagnostics n = row_count; v_out := v_out || jsonb_build_object('fabrics', n);

  -- demo clients: their sign-in accounts (never staff), then the companies
  delete from auth.users where id in (select id from public.profiles where client_id = any (v_demo_clients) and role = 'client');
  get diagnostics n = row_count; v_out := v_out || jsonb_build_object('users', n);
  delete from public.clients where id = any (v_demo_clients);
  get diagnostics n = row_count; v_out := v_out || jsonb_build_object('clients', n);

  return v_out;
end $$;
revoke all on function public.purge_demo_data() from public, anon;
grant execute on function public.purge_demo_data() to authenticated;
