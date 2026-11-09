-- P1-10: quote status changes enqueue the transactional emails (docs/05-commerce.md §8). The templates and the sender
-- exist since P1-08; here the events are produced inside the same transaction as the status change, so none is lost.

create function public.enqueue_quote_emails() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_template text;
  v_templates text[];
begin
  if new.status is not distinct from old.status then return null; end if;

  v_templates := case new.status
    when 'submitted' then array['quote_submitted_client', 'quote_submitted_staff']
    when 'sent'      then array['quote_sent']
    when 'accepted'  then array['quote_accepted_staff']
    when 'rejected'  then array['quote_rejected_staff']
    when 'expired'   then array['quote_expired']
    else '{}'::text[]
  end;

  foreach v_template in array v_templates loop
    -- "key" separates the emails of different revisions of the same quote (a re-sent quote is a new email)
    perform pgmq.send('q_email', jsonb_build_object(
      'type', 'q_email', 'template', v_template, 'id', new.id, 'key', new.revision::text, 'attempt', 1));
  end loop;
  return null;
end $$;

create trigger quotes_enqueue_emails after update of status on public.quotes
  for each row execute function public.enqueue_quote_emails();
