-- P1-12 sample requests (docs/02-user-flows.md F3):
--  * a client asks for up to N colors with ONE function that enforces the limits (no direct inserts any more)
--  * staff move a request through requested -> approved | rejected -> preparing -> shipped -> delivered; the order is
--    enforced by a trigger, a rejection needs a reason and a shipment needs a tracking number
--  * every status change queues an email to the client; a new request queues one to the staff

-- The pages show the limits ("2 of 5 colors"), so these two settings become public.
update public.app_settings set is_public = true
 where key in ('max_colors_per_sample_request', 'max_open_sample_requests_per_client');

-- Requests are created through request_samples() only: it is the one place where the limits are checked.
drop policy samples_insert on public.sample_requests;
drop policy sample_items_insert on public.sample_request_items;

create function public.request_samples(p_color_ids uuid[], p_address jsonb)
returns public.sample_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid;
  v_ids uuid[];
  v_max_colors int := public.setting_numeric('max_colors_per_sample_request', 5)::int;
  v_max_open int := public.setting_numeric('max_open_sample_requests_per_client', 2)::int;
  v_address jsonb;
  v_open int;
  v_req public.sample_requests;
  v_id uuid;
begin
  if public.app_role() <> 'client' then
    raise exception 'sign in to request samples' using errcode = '42501';
  end if;
  v_client := public.my_client_id();
  if v_client is null then raise exception 'client required'; end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_color_ids, '{}')) as x;
  if cardinality(v_ids) = 0 then raise exception 'choose at least one color'; end if;
  if cardinality(v_ids) > v_max_colors then raise exception 'too many colors (maximum %)', v_max_colors; end if;

  if (select count(*) from public.fabric_colors c join public.fabrics f on f.id = c.fabric_id
       where c.id = any (v_ids) and c.is_active and f.is_active) <> cardinality(v_ids) then
    raise exception 'unknown or inactive color';
  end if;

  -- only known keys are kept, whatever the caller sends
  v_address := jsonb_strip_nulls(jsonb_build_object(
    'recipient',   nullif(trim(coalesce(p_address ->> 'recipient', '')), ''),
    'line1',       nullif(trim(coalesce(p_address ->> 'line1', '')), ''),
    'line2',       nullif(trim(coalesce(p_address ->> 'line2', '')), ''),
    'city',        nullif(trim(coalesce(p_address ->> 'city', '')), ''),
    'postal_code', nullif(trim(coalesce(p_address ->> 'postal_code', '')), ''),
    'country',     nullif(trim(coalesce(p_address ->> 'country', '')), ''),
    'phone',       nullif(trim(coalesce(p_address ->> 'phone', '')), '')));
  if not (v_address ? 'line1' and v_address ? 'city' and v_address ? 'country') then
    raise exception 'a shipping address is required (street, city, country)';
  end if;
  if exists (select 1 from jsonb_each_text(v_address) where char_length(value) > 200) then
    raise exception 'address field too long';
  end if;

  -- serialize one client's requests so two quick clicks cannot both pass the limit
  perform 1 from public.clients where id = v_client for update;
  select count(*) into v_open from public.sample_requests
   where client_id = v_client and status in ('requested', 'approved', 'preparing', 'shipped');
  if v_open >= v_max_open then raise exception 'open sample request limit reached'; end if;

  insert into public.sample_requests (client_id, shipping_address) values (v_client, v_address) returning * into v_req;
  foreach v_id in array v_ids loop
    insert into public.sample_request_items (sample_request_id, color_id) values (v_req.id, v_id);
  end loop;

  perform pgmq.send('q_email', jsonb_build_object(
    'type', 'q_email', 'template', 'sample_requested_staff', 'id', v_req.id, 'client_id', v_client, 'attempt', 1));
  return v_req;
end $$;
revoke all on function public.request_samples(uuid[], jsonb) from public, anon;
grant execute on function public.request_samples(uuid[], jsonb) to authenticated;

-- The status order. Anything else (skipping a step, going back, leaving a final status) is refused.
create function public.sample_requests_before_update() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not (
         (old.status = 'requested' and new.status in ('approved', 'rejected'))
      or (old.status = 'approved'  and new.status = 'preparing')
      or (old.status = 'preparing' and new.status = 'shipped')
      or (old.status = 'shipped'   and new.status = 'delivered')) then
      raise exception 'a sample request cannot go from % to %', old.status, new.status;
    end if;
    if new.status = 'rejected' and coalesce(trim(new.rejection_reason), '') = '' then
      raise exception 'a reason is required to reject a sample request';
    end if;
    if new.status = 'shipped' and coalesce(trim(new.tracking_number), '') = '' then
      raise exception 'a tracking number is required to ship a sample request';
    end if;
  end if;
  if new.client_id <> old.client_id
     or (new.shipping_address is distinct from old.shipping_address and old.status <> 'requested') then
    raise exception 'the client and the address cannot change once the request is processed';
  end if;
  return new;
end $$;
create trigger sample_requests_status_guard before update on public.sample_requests
  for each row execute function public.sample_requests_before_update();

create function public.enqueue_sample_emails() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from old.status then return null; end if;
  -- "key" = the new status: each status is announced once, and a retry never sends it twice
  perform pgmq.send('q_email', jsonb_build_object(
    'type', 'q_email', 'template', 'sample_status_changed', 'id', new.id, 'key', new.status::text, 'attempt', 1));
  return null;
end $$;
create trigger sample_requests_enqueue_emails after update of status on public.sample_requests
  for each row execute function public.enqueue_sample_emails();
