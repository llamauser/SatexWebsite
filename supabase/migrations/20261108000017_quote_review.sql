-- P1-14: what sales do with a quote (docs/02-user-flows.md F6, docs/05-commerce.md §6).
-- Each step is a function that checks the current status, so the state machine cannot be skipped from the back-office.
-- (Plain UPDATEs stay possible for staff through RLS; the functions are the supported path.)

-- Opening a submitted quote puts it in review ("someone is working on it").
create function public.open_quote_for_review(p_id uuid) returns public.quotes
language plpgsql security definer set search_path = '' as $$
declare v_q public.quotes;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select * into v_q from public.quotes where id = p_id for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.status = 'submitted' then
    update public.quotes set status = 'in_review' where id = p_id returning * into v_q;
  end if;
  return v_q;
end $$;

-- Send the reviewed quote to the client. The PDF has been stored by the server before this call.
create function public.send_quote(p_id uuid, p_valid_until date default null, p_pdf_path text default null) returns public.quotes
language plpgsql security definer set search_path = '' as $$
declare
  v_q public.quotes;
  v_until date;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select * into v_q from public.quotes where id = p_id for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.status not in ('submitted', 'in_review') then raise exception 'only a quote in review can be sent'; end if;
  if not exists (select 1 from public.quote_lines where quote_id = p_id) then raise exception 'the quote has no lines'; end if;
  v_until := coalesce(p_valid_until, v_q.valid_until, current_date + public.setting_numeric('quote_validity_days', 15)::int);
  if v_until < current_date then raise exception 'the validity date is in the past'; end if;
  update public.quotes set status = 'sent', sent_at = now(), valid_until = v_until, pdf_path = coalesce(p_pdf_path, pdf_path)
   where id = p_id returning * into v_q;
  return v_q;
end $$;

-- Sales withdraw a quote that was not accepted yet. The reason is shown to the client.
create function public.cancel_quote(p_id uuid, p_reason text) returns public.quotes
language plpgsql security definer set search_path = '' as $$
declare v_q public.quotes;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into v_q from public.quotes where id = p_id for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.status not in ('submitted', 'in_review', 'sent') then raise exception 'this quote can no longer be cancelled'; end if;
  update public.quotes set status = 'cancelled', rejection_reason = trim(p_reason), decided_at = now()
   where id = p_id returning * into v_q;
  return v_q;
end $$;

-- A sent quote that must change goes back to review as a new revision (the client can no longer accept the old one).
create function public.reopen_quote(p_id uuid) returns public.quotes
language plpgsql security definer set search_path = '' as $$
declare v_q public.quotes;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select * into v_q from public.quotes where id = p_id for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.status <> 'sent' then raise exception 'only a sent quote can be reopened'; end if;
  update public.quotes set status = 'in_review', revision = revision + 1, sent_at = null, pdf_path = null
   where id = p_id returning * into v_q;
  return v_q;
end $$;

-- The accepted quote becomes an order: lines and prices are copied, the stock is allocated, the cutting jobs are created
-- (by the trigger on order_lines), the client's matching reservations are converted, and the client is told.
create function public.convert_quote_to_order(p_id uuid) returns public.orders
language plpgsql security definer set search_path = '' as $$
declare
  v_q public.quotes;
  v_order public.orders;
  v_ship jsonb;
  v_bill jsonb;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select * into v_q from public.quotes where id = p_id for update;
  if not found then raise exception 'quote not found'; end if;
  if v_q.status <> 'accepted' then raise exception 'only an accepted quote can become an order'; end if;
  if not exists (select 1 from public.quote_lines where quote_id = p_id) then raise exception 'the quote has no lines'; end if;

  select to_jsonb(a) - 'id' - 'client_id' - 'kind' - 'is_default' - 'created_at' - 'updated_at' into v_ship
    from public.addresses a where a.client_id = v_q.client_id and a.kind = 'shipping' order by a.is_default desc, a.created_at limit 1;
  select to_jsonb(a) - 'id' - 'client_id' - 'kind' - 'is_default' - 'created_at' - 'updated_at' into v_bill
    from public.addresses a where a.client_id = v_q.client_id and a.kind = 'billing' order by a.is_default desc, a.created_at limit 1;

  insert into public.orders (client_id, quote_id, currency, subtotal, discount_pct, vat_rate, total, shipping_address, billing_address, is_demo)
  values (v_q.client_id, v_q.id, v_q.currency, v_q.subtotal, v_q.discount_pct, v_q.vat_rate, v_q.total, v_ship, coalesce(v_bill, v_ship), v_q.is_demo)
  returning * into v_order;

  insert into public.order_lines (order_id, color_id, meters, unit_price, line_total)
  select v_order.id, l.color_id, l.meters, l.unit_price, l.line_total from public.quote_lines l where l.quote_id = p_id order by l.sort;

  perform public.allocate_order(v_order.id);
  update public.quotes set status = 'converted' where id = p_id;

  perform pgmq.send('q_email', jsonb_build_object('type', 'q_email', 'template', 'order_confirmed', 'id', v_order.id, 'client_id', v_order.client_id, 'attempt', 1));
  return v_order;
end $$;

revoke all on function public.open_quote_for_review(uuid), public.send_quote(uuid, date, text), public.cancel_quote(uuid, text),
  public.reopen_quote(uuid), public.convert_quote_to_order(uuid) from public, anon;
grant execute on function public.open_quote_for_review(uuid), public.send_quote(uuid, date, text), public.cancel_quote(uuid, text),
  public.reopen_quote(uuid), public.convert_quote_to_order(uuid) to authenticated;
