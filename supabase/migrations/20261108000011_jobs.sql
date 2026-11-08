-- P1-08: background jobs (docs/12-dev-ops.md §5): queue wrappers for the Vercel consumer, producers (triggers), email dedupe.

-- ---------------------------------------------------------------- queue wrappers
-- The pgmq schema is not exposed through the API, so the job runner (service role) talks to these thin wrappers.
create function public.job_read(p_queue text, p_vt int default 120, p_qty int default 20)
returns table (msg_id bigint, read_ct int, enqueued_at timestamptz, vt timestamptz, message jsonb)
language sql security definer set search_path = '' as $$
  select m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message from pgmq.read(p_queue, p_vt, p_qty) m
$$;

create function public.job_delete(p_queue text, p_msg_id bigint) returns boolean
language sql security definer set search_path = '' as $$ select pgmq.delete(p_queue, p_msg_id) $$;

create function public.job_archive(p_queue text, p_msg_id bigint) returns boolean
language sql security definer set search_path = '' as $$ select pgmq.archive(p_queue, p_msg_id) $$;

create function public.job_send(p_queue text, p_message jsonb, p_delay_s int default 0) returns bigint
language sql security definer set search_path = '' as $$
  select m from pgmq.send(p_queue, p_message, greatest(coalesce(p_delay_s, 0), 0)) m
$$;

create function public.job_queue_depths() returns table (queue_name text, queue_length bigint, oldest_msg_age_s int)
language sql security definer set search_path = '' as $$
  select m.queue_name, m.queue_length, m.oldest_msg_age_sec from pgmq.metrics_all() m
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.job_read(text, int, int)', 'public.job_delete(text, bigint)', 'public.job_archive(text, bigint)',
    'public.job_send(text, jsonb, int)', 'public.job_queue_depths()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- email log: one row per (template, entity, recipient)
alter table public.email_log add column dedupe_key text;
create unique index email_log_dedupe_idx on public.email_log (dedupe_key) where dedupe_key is not null;
alter table public.email_log add column subject text;
alter table public.email_log add column attempts int not null default 0;
alter table public.email_log add column sent_at timestamptz;

-- ---------------------------------------------------------------- producers: fabric changes enqueue embed / translate jobs
create function public.enqueue_fabric_jobs() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_missing boolean;
begin
  -- the text embedding is rebuilt whenever something that describes the fabric changes (the job skips unchanged content)
  perform pgmq.send('q_embed', jsonb_build_object('type', 'embed', 'id', new.id, 'attempt', 1));

  -- machine translation only when a translatable field is missing in English or Arabic
  v_missing :=
       not (new.name ? 'en') or not (new.name ? 'ar')
    or (new.short_description is not null and (not (new.short_description ? 'en') or not (new.short_description ? 'ar')))
    or (new.description is not null and (not (new.description ? 'en') or not (new.description ? 'ar')));
  if v_missing then
    perform pgmq.send('q_translate', jsonb_build_object('type', 'translate', 'id', new.id, 'attempt', 1));
  end if;
  return null;
end $$;

create trigger fabrics_enqueue_jobs
  after insert or update of name, short_description, description, structure, construction, composition, gsm, width_cm, stretch, finish, uses, seasons, tags
  on public.fabrics
  for each row execute function public.enqueue_fabric_jobs();

comment on column public.fabrics.machine_translated is
  'field name -> locales that were machine translated and not yet reviewed, e.g. {"name":["en","ar"],"description":["en"]}. The admin form clears an entry when a human edits that field.';
