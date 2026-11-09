-- P1-15: orders, deliveries and the dashboard (docs/02-user-flows.md F4, F5, F7).
-- Orders are created from accepted quotes (P1-14). Cutting jobs move the order forward by themselves (refresh_order_progress);
-- the functions below cover the rest: cancelling, deliveries (which carry the order to "shipped" and "delivered"), and the KPIs.

-- ---------------------------------------------------------------- orders
-- Manual steps: start preparing, mark ready (when the automatic rule has not done it), cancel before shipping.
-- "shipped" and "delivered" come only from the delivery (see set_delivery_status).
create function public.set_order_status(p_id uuid, p_status public.order_status, p_reason text default null) returns public.orders
language plpgsql security definer set search_path = '' as $$
declare v_o public.orders;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select * into v_o from public.orders where id = p_id for update;
  if not found then raise exception 'order not found'; end if;

  if p_status = 'cancelled' then
    if v_o.status not in ('confirmed', 'in_preparation', 'ready') then raise exception 'an order cannot be cancelled once it is shipped'; end if;
    if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
    -- give the stock back and stop the cutting jobs that are not done
    update public.order_allocations set released = true
     where not released and order_line_id in (select id from public.order_lines where order_id = p_id);
    update public.cutting_jobs set status = 'cancelled'
     where status in ('queued', 'cutting') and order_line_id in (select id from public.order_lines where order_id = p_id);
    update public.deliveries set status = 'failed', failure_reason = 'order cancelled'
     where order_id = p_id and status in ('scheduled', 'in_transit');
    update public.orders set status = 'cancelled', cancelled_reason = trim(p_reason) where id = p_id returning * into v_o;
  elsif p_status = 'in_preparation' and v_o.status = 'confirmed' then
    update public.orders set status = 'in_preparation' where id = p_id returning * into v_o;
  elsif p_status = 'ready' and v_o.status in ('confirmed', 'in_preparation') then
    update public.orders set status = 'ready' where id = p_id returning * into v_o;
  else
    raise exception 'an order cannot go from % to %', v_o.status, p_status;
  end if;
  return v_o;
end $$;

-- the client is told when the order is ready
create function public.enqueue_order_emails() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status = 'ready' then
    perform pgmq.send('q_email', jsonb_build_object('type', 'q_email', 'template', 'order_ready', 'id', new.id, 'client_id', new.client_id, 'attempt', 1));
  end if;
  return null;
end $$;
create trigger orders_enqueue_emails after update of status on public.orders
  for each row execute function public.enqueue_order_emails();

-- ---------------------------------------------------------------- deliveries
create function public.create_delivery(p_order_id uuid, p_carrier text default null, p_tracking text default null, p_date date default null)
returns public.deliveries
language plpgsql security definer set search_path = '' as $$
declare
  v_o public.orders;
  v_d public.deliveries;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_o.status <> 'ready' then raise exception 'a delivery can only be created for a ready order'; end if;
  if exists (select 1 from public.deliveries where order_id = p_order_id and status in ('scheduled', 'in_transit')) then
    raise exception 'this order already has an open delivery';
  end if;
  insert into public.deliveries (order_id, carrier, tracking_number, scheduled_date)
  values (p_order_id, nullif(trim(p_carrier), ''), nullif(trim(p_tracking), ''), p_date) returning * into v_d;
  return v_d;
end $$;

-- scheduled -> in_transit (order: shipped, needs carrier + tracking) -> delivered (order: delivered); failed needs a reason
create function public.set_delivery_status(p_id uuid, p_status public.delivery_status, p_reason text default null) returns public.deliveries
language plpgsql security definer set search_path = '' as $$
declare v_d public.deliveries;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select * into v_d from public.deliveries where id = p_id for update;
  if not found then raise exception 'delivery not found'; end if;

  if p_status = 'in_transit' and v_d.status = 'scheduled' then
    if coalesce(trim(v_d.carrier), '') = '' or coalesce(trim(v_d.tracking_number), '') = '' then
      raise exception 'a carrier and a tracking number are required to ship';
    end if;
    update public.deliveries set status = 'in_transit' where id = p_id returning * into v_d;
    update public.orders set status = 'shipped' where id = v_d.order_id and status = 'ready';
  elsif p_status = 'delivered' and v_d.status = 'in_transit' then
    update public.deliveries set status = 'delivered', delivered_at = now() where id = p_id returning * into v_d;
    update public.orders set status = 'delivered' where id = v_d.order_id and status = 'shipped';
  elsif p_status = 'failed' and v_d.status in ('scheduled', 'in_transit') then
    if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
    update public.deliveries set status = 'failed', failure_reason = trim(p_reason) where id = p_id returning * into v_d;
    update public.orders set status = 'ready' where id = v_d.order_id and status = 'shipped';   -- it can be scheduled again
  else
    raise exception 'a delivery cannot go from % to %', v_d.status, p_status;
  end if;
  return v_d;
end $$;

create function public.enqueue_delivery_emails() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status in ('in_transit', 'delivered') then
    perform pgmq.send('q_email', jsonb_build_object(
      'type', 'q_email', 'template', case new.status when 'in_transit' then 'delivery_in_transit' else 'delivery_delivered' end,
      'id', new.id, 'key', new.status::text, 'attempt', 1));
  end if;
  return null;
end $$;
create trigger deliveries_enqueue_emails after update of status on public.deliveries
  for each row execute function public.enqueue_delivery_emails();

-- ---------------------------------------------------------------- dashboard
create function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_low numeric := public.setting_numeric('low_stock_threshold_m', 50);
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'quotes_to_review', (select count(*) from public.quotes where status in ('submitted', 'in_review')),
    'quotes_to_convert', (select count(*) from public.quotes where status = 'accepted'),
    'samples_to_prepare', (select count(*) from public.sample_requests where status in ('requested', 'approved', 'preparing')),
    'cutting_queue', (select count(*) from public.cutting_jobs where status in ('queued', 'cutting')),
    'orders_open', (select count(*) from public.orders where status in ('confirmed', 'in_preparation', 'ready', 'shipped')),
    'deliveries_today', (select count(*) from public.deliveries where scheduled_date = current_date and status in ('scheduled', 'in_transit')),
    'low_stock_colors', (select count(*) from public.v_color_availability a
                          join public.fabric_colors c on c.id = a.color_id
                          join public.fabrics f on f.id = c.fabric_id
                         where f.is_active and c.is_active and a.available_m < v_low),
    'reservations_expiring', (select count(*) from public.stock_reservations where status = 'active' and expires_at <= now() + interval '6 hours'),
    'messages_unhandled', (select count(*) from public.contact_messages where not handled),
    'quotes_value_open', (select coalesce(sum(total), 0) from public.quotes where status = 'sent')
  );
end $$;

revoke all on function public.set_order_status(uuid, public.order_status, text), public.create_delivery(uuid, text, text, date),
  public.set_delivery_status(uuid, public.delivery_status, text), public.admin_dashboard() from public, anon;
grant execute on function public.set_order_status(uuid, public.order_status, text), public.create_delivery(uuid, text, text, date),
  public.set_delivery_status(uuid, public.delivery_status, text), public.admin_dashboard() to authenticated;
