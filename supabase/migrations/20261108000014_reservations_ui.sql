-- P1-11 reservations: what the pages need to know, and the "reservation created" email.

-- The reservation length and the per-client limit are shown to signed-in clients ("2 of 3 reservations used", "held for
-- 48 h"). They are not secrets, so the public settings view exposes them.
update public.app_settings set is_public = true
 where key in ('reservation_hours', 'max_active_reservations_per_client');

-- reserve_stock() is unchanged except for the last step: it queues the confirmation email (client + in-app notification).
-- Only reservations made through this function send it: demo seed rows and expiry tests insert rows directly and stay silent.
create or replace function public.reserve_stock(p_color_id uuid, p_meters numeric, p_client_id uuid default null)
returns public.stock_reservations
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid;
  v_moq numeric;
  v_available numeric;
  v_active int;
  v_res public.stock_reservations;
begin
  if public.app_role() = 'client' then
    v_client := public.my_client_id();
  elsif public.is_staff() then
    v_client := p_client_id;
  else
    raise exception 'sign in to reserve stock' using errcode = '42501';
  end if;
  if v_client is null then raise exception 'client required'; end if;
  if p_meters is null or p_meters <= 0 then raise exception 'meters must be positive'; end if;

  -- serialize reservations per color: prevents overselling under concurrency
  perform 1 from public.fabric_colors where id = p_color_id and is_active for update;
  if not found then raise exception 'unknown or inactive color'; end if;

  select f.moq_m into v_moq from public.fabrics f join public.fabric_colors c on c.fabric_id = f.id
   where c.id = p_color_id and f.is_active;
  if v_moq is null then raise exception 'fabric is not available'; end if;
  if p_meters < v_moq then raise exception 'below the minimum order quantity (% m)', v_moq; end if;

  select count(*) into v_active from public.stock_reservations where client_id = v_client and status = 'active';
  if v_active >= public.setting_numeric('max_active_reservations_per_client', 3) then
    raise exception 'reservation limit reached';
  end if;

  select available_m into v_available from public.v_color_availability_all where color_id = p_color_id;
  if coalesce(v_available, 0) < p_meters then
    raise exception 'not enough stock available (% m left)', coalesce(v_available, 0);
  end if;

  insert into public.stock_reservations (color_id, client_id, meters, expires_at)
  values (p_color_id, v_client, p_meters,
          now() + make_interval(hours => public.setting_numeric('reservation_hours', 48)::int))
  returning * into v_res;

  perform pgmq.send('q_email', jsonb_build_object(
    'type', 'q_email', 'template', 'reservation_created', 'id', v_res.id, 'client_id', v_res.client_id, 'attempt', 1));
  return v_res;
end $$;
