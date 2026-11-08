-- P1-06: contact form. Messages are written ONLY through submit_contact_message(), called by the server (service role)
-- with the hashed client IP, so every submission is rate limited (5 per hour per IP) and validated.

drop policy if exists contact_insert on public.contact_messages;
revoke insert on public.contact_messages from anon;

create function public.submit_contact_message(
  p_name text, p_company text, p_email text, p_phone text, p_message text, p_locale public.locale, p_ip_key text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if coalesce(trim(p_ip_key), '') = '' then raise exception 'ip key required'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 or char_length(p_name) > 120 then raise exception 'invalid name'; end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(p_email) > 254 then raise exception 'invalid email'; end if;
  if char_length(trim(coalesce(p_message, ''))) < 10 or char_length(p_message) > 4000 then raise exception 'invalid message'; end if;
  if char_length(coalesce(p_company, '')) > 160 or char_length(coalesce(p_phone, '')) > 40 then raise exception 'field too long'; end if;

  if not public.hit_rate_limit('contact:' || p_ip_key, 5, 3600) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.contact_messages (name, company, email, phone, message, locale)
  values (trim(p_name), nullif(trim(p_company), ''), trim(p_email), nullif(trim(p_phone), ''), trim(p_message), coalesce(p_locale, 'fr'))
  returning id into v_id;

  -- the email job (P1-08) turns this into a mail to staff_notification_email
  perform pgmq.send('q_email', jsonb_build_object('type', 'q_email', 'template', 'contact_message_staff', 'id', v_id, 'attempt', 1));
  return v_id;
end $$;

revoke execute on function public.submit_contact_message(text, text, text, text, text, public.locale, text) from public, anon, authenticated;
grant execute on function public.submit_contact_message(text, text, text, text, text, public.locale, text) to service_role;
