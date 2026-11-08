-- P1-03 / 6: business functions (stock, reservations, quotes, cutting), refs, queues, cron.
-- All SECURITY DEFINER functions validate auth.uid()/app_role() themselves.

-- ---------------------------------------------------------------- human-readable references
create function public.set_ref() returns trigger
language plpgsql as $$
declare
  v_prefix text := tg_argv[0];
  v_seq text := tg_argv[1];
begin
  if new.ref is null then
    new.ref := v_prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(nextval(v_seq::regclass)::text, 6, '0');
  end if;
  return new;
end $$;
create trigger quotes_ref before insert on public.quotes for each row execute function public.set_ref('Q', 'public.quote_ref_seq');
create trigger orders_ref before insert on public.orders for each row execute function public.set_ref('O', 'public.order_ref_seq');
create trigger sample_requests_ref before insert on public.sample_requests for each row execute function public.set_ref('S', 'public.sample_ref_seq');

-- ---------------------------------------------------------------- queues
select pgmq.create('q_embed');
select pgmq.create('q_translate');
select pgmq.create('q_email');

-- ---------------------------------------------------------------- stock: receive a lot
create function public.receive_lot(
  p_color_id uuid, p_lot_code text, p_meters numeric,
  p_department_id uuid default null, p_location text default null
) returns public.stock_lots
language plpgsql security definer set search_path = '' as $$
declare
  v_lot public.stock_lots;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_meters <= 0 then raise exception 'meters must be positive'; end if;
  insert into public.stock_lots (color_id, lot_code, meters, department_id, location, received_at)
  values (p_color_id, p_lot_code, 0, p_department_id, p_location, current_date)
  returning * into v_lot;
  insert into public.stock_movements (lot_id, type, meters, reason, actor_id)
  values (v_lot.id, 'receive', p_meters, 'initial receipt', auth.uid());
  select * into v_lot from public.stock_lots where id = v_lot.id;
  return v_lot;
end $$;

create function public.adjust_stock(p_lot_id uuid, p_delta numeric, p_reason text) returns public.stock_lots
language plpgsql security definer set search_path = '' as $$
declare
  v_lot public.stock_lots;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  insert into public.stock_movements (lot_id, type, meters, reason, actor_id)
  values (p_lot_id, 'adjust', p_delta, p_reason, auth.uid());
  select * into v_lot from public.stock_lots where id = p_lot_id;
  return v_lot;
end $$;

-- ---------------------------------------------------------------- reservations
create function public.reserve_stock(p_color_id uuid, p_meters numeric, p_client_id uuid default null)
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
  return v_res;
end $$;

create function public.cancel_reservation(p_id uuid) returns public.stock_reservations
language plpgsql security definer set search_path = '' as $$
declare
  v_res public.stock_reservations;
begin
  select * into v_res from public.stock_reservations where id = p_id for update;
  if not found then raise exception 'reservation not found'; end if;
  if not (public.is_staff() or (public.app_role() = 'client' and v_res.client_id = public.my_client_id())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_res.status <> 'active' then raise exception 'reservation is not active'; end if;
  update public.stock_reservations set status = 'cancelled' where id = p_id returning * into v_res;
  return v_res;
end $$;

-- p_now is injectable so tests (and replays) do not depend on the wall clock
create function public.expire_reservations(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.stock_reservations;
  v_n int := 0;
begin
  for v_row in
    update public.stock_reservations set status = 'expired'
     where status = 'active' and expires_at <= p_now returning *
  loop
    perform pgmq.send('q_email', jsonb_build_object(
      'type', 'q_email', 'template', 'reservation_expired', 'id', v_row.id, 'client_id', v_row.client_id, 'attempt', 1));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create function public.remind_reservations(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.stock_reservations;
  v_n int := 0;
begin
  for v_row in
    update public.stock_reservations set reminded_at = p_now
     where status = 'active' and reminded_at is null
       and expires_at > p_now and expires_at <= p_now + interval '6 hours' returning *
  loop
    perform pgmq.send('q_email', jsonb_build_object(
      'type', 'q_email', 'template', 'reservation_expiring', 'id', v_row.id, 'client_id', v_row.client_id, 'attempt', 1));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------- quotes
create function public.quotes_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.currency := coalesce(new.currency, public.setting_text('currency', 'EUR'));
    new.vat_rate := coalesce(new.vat_rate, public.setting_numeric('vat_rate', 0.20));
  else
    new.subtotal := coalesce((select sum(line_total) from public.quote_lines where quote_id = new.id), 0);
    new.total := round(new.subtotal * (1 - new.discount_pct / 100) * (1 + new.vat_rate), 2);
  end if;
  return new;
end $$;
create trigger quotes_before_write before insert or update on public.quotes
  for each row execute function public.quotes_before_write();

create function public.quote_lines_before_write() returns trigger
language plpgsql as $$
begin
  new.line_total := round(new.meters * new.unit_price, 2);
  return new;
end $$;
create trigger quote_lines_before_write before insert or update on public.quote_lines
  for each row execute function public.quote_lines_before_write();

-- touching the quote re-runs its BEFORE UPDATE trigger, which recomputes totals
create function public.quote_lines_recompute() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.quotes set updated_at = now() where id = coalesce(new.quote_id, old.quote_id);
  return null;
end $$;
create trigger quote_lines_recompute after insert or update or delete on public.quote_lines
  for each row execute function public.quote_lines_recompute();

create function public.submit_quote(p_id uuid, p_message text default null) returns public.quotes
language plpgsql security definer set search_path = '' as $$
declare
  v_q public.quotes;
begin
  select * into v_q from public.quotes where id = p_id for update;
  if not found then raise exception 'quote not found'; end if;
  if public.app_role() <> 'client' or v_q.client_id <> public.my_client_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_q.status <> 'draft' then raise exception 'only a draft can be submitted'; end if;
  if not exists (select 1 from public.quote_lines where quote_id = p_id) then
    raise exception 'the quote has no lines';
  end if;
  update public.quotes
     set status = 'submitted', submitted_at = now(), client_message = coalesce(p_message, client_message)
   where id = p_id returning * into v_q;
  return v_q;
end $$;

create function public.client_decide_quote(p_id uuid, p_decision text, p_reason text default null)
returns public.quotes
language plpgsql security definer set search_path = '' as $$
declare
  v_q public.quotes;
begin
  if p_decision not in ('accepted','rejected') then raise exception 'decision must be accepted or rejected'; end if;
  select * into v_q from public.quotes where id = p_id for update;
  if not found then raise exception 'quote not found'; end if;
  if public.app_role() <> 'client' or v_q.client_id <> public.my_client_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_q.status <> 'sent' then raise exception 'only a sent quote can be decided'; end if;
  if v_q.valid_until is not null and v_q.valid_until < current_date then
    raise exception 'this quote has expired';
  end if;
  update public.quotes
     set status = p_decision::public.quote_status, decided_at = now(),
         rejection_reason = case when p_decision = 'rejected' then p_reason else null end
   where id = p_id returning * into v_q;
  return v_q;
end $$;

create function public.expire_quotes(p_today date default current_date) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update public.quotes set status = 'expired'
   where status = 'sent' and valid_until is not null and valid_until < p_today;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------- orders: allocations, cutting
create function public.create_cutting_job() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.cutting_jobs (order_line_id, planned_m) values (new.id, new.meters);
  return new;
end $$;
create trigger order_lines_cutting_job after insert on public.order_lines
  for each row execute function public.create_cutting_job();

-- allocate stock for every line of an order and convert the client's matching reservations
create function public.allocate_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_line public.order_lines;
  v_client uuid;
begin
  if not public.is_staff() and auth.uid() is not null then
    raise exception 'staff only' using errcode = '42501';
  end if;
  select client_id into v_client from public.orders where id = p_order_id;
  for v_line in select * from public.order_lines where order_id = p_order_id loop
    insert into public.order_allocations (order_line_id, color_id, meters)
    values (v_line.id, v_line.color_id, v_line.meters);
    update public.stock_reservations set status = 'converted'
     where client_id = v_client and color_id = v_line.color_id and status = 'active';
  end loop;
end $$;

create function public.refresh_order_progress(p_order_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_open int; v_ready int; v_started int;
begin
  select count(*) filter (where cj.status in ('queued','cutting')),
         count(*) filter (where cj.status = 'ready'),
         count(*) filter (where cj.status in ('cutting','ready'))
    into v_open, v_ready, v_started
    from public.cutting_jobs cj join public.order_lines ol on ol.id = cj.order_line_id
   where ol.order_id = p_order_id and cj.status <> 'cancelled';
  if v_open = 0 and v_ready > 0 then
    update public.orders set status = 'ready' where id = p_order_id and status in ('confirmed','in_preparation');
  elsif v_started > 0 then
    update public.orders set status = 'in_preparation' where id = p_order_id and status = 'confirmed';
  end if;
end $$;

create function public.start_cut(p_job_id uuid, p_lot_id uuid) returns public.cutting_jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.cutting_jobs; v_line public.order_lines; v_lot public.stock_lots;
begin
  if not public.is_staff() and auth.uid() is not null then raise exception 'staff only' using errcode = '42501'; end if;
  select * into v_job from public.cutting_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status <> 'queued' then raise exception 'only a queued job can start'; end if;
  select * into v_line from public.order_lines where id = v_job.order_line_id;
  select * into v_lot from public.stock_lots where id = p_lot_id for update;
  if not found or v_lot.color_id <> v_line.color_id then raise exception 'lot does not match the ordered color'; end if;
  if v_lot.meters < v_job.planned_m then raise exception 'lot has not enough meters (% m)', v_lot.meters; end if;
  update public.cutting_jobs set status = 'cutting', lot_id = p_lot_id, started_at = now()
   where id = p_job_id returning * into v_job;
  perform public.refresh_order_progress(v_line.order_id);
  return v_job;
end $$;

create function public.record_cut(p_job_id uuid, p_cut_m numeric, p_lot_id uuid default null)
returns public.cutting_jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.cutting_jobs; v_line public.order_lines; v_lot uuid;
begin
  if not public.is_staff() and auth.uid() is not null then raise exception 'staff only' using errcode = '42501'; end if;
  if p_cut_m is null or p_cut_m <= 0 then raise exception 'cut meters must be positive'; end if;
  select * into v_job from public.cutting_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status <> 'cutting' then raise exception 'only a job in cutting can be completed'; end if;
  v_lot := coalesce(p_lot_id, v_job.lot_id);
  if v_lot is null then raise exception 'no lot selected'; end if;
  select * into v_line from public.order_lines where id = v_job.order_line_id;

  insert into public.stock_movements (lot_id, type, meters, reason, ref_table, ref_id, actor_id)
  values (v_lot, 'cut', -p_cut_m, 'cutting job', 'cutting_jobs', p_job_id, auth.uid());
  -- the allocation for this line is consumed by the physical cut
  update public.order_allocations set released = true where order_line_id = v_line.id and not released;

  update public.cutting_jobs set status = 'ready', lot_id = v_lot, cut_m = p_cut_m, finished_at = now()
   where id = p_job_id returning * into v_job;
  perform public.refresh_order_progress(v_line.order_id);
  return v_job;
end $$;

-- ---------------------------------------------------------------- housekeeping
create function public.cleanup_expired_data() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.match_sessions where user_id is null and created_at < now() - interval '90 days';
  delete from public.rate_limits where window_start < now() - interval '2 days';
end $$;

-- ---------------------------------------------------------------- execute grants: nothing callable by default
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.app_role(), public.is_staff(), public.is_admin(), public.my_client_id(),
  public.hex_to_lab(text), public.composition_is_valid(jsonb), public.immutable_unaccent(text)
  to anon, authenticated;
grant execute on function
  public.reserve_stock(uuid, numeric, uuid), public.cancel_reservation(uuid),
  public.submit_quote(uuid, text), public.client_decide_quote(uuid, text, text)
  to authenticated;
grant execute on function
  public.receive_lot(uuid, text, numeric, uuid, text), public.adjust_stock(uuid, numeric, text),
  public.allocate_order(uuid), public.start_cut(uuid, uuid), public.record_cut(uuid, numeric, uuid)
  to authenticated;           -- each checks is_staff() itself
-- cron / service role only: expire_reservations, remind_reservations, expire_quotes, cleanup_expired_data, hit_rate_limit

-- ---------------------------------------------------------------- pg_cron schedules (docs/04-database.md)
select cron.schedule('expire-reservations', '*/5 * * * *', $$select public.expire_reservations()$$);
select cron.schedule('remind-reservations', '*/15 * * * *', $$select public.remind_reservations()$$);
select cron.schedule('expire-quotes',       '0 2 * * *',    $$select public.expire_quotes()$$);
select cron.schedule('cleanup-expired',     '0 3 * * *',    $$select public.cleanup_expired_data()$$);
