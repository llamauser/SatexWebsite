-- P1-16: the 3D showroom shows a few public, anonymous counters for the cutting room and the shipping dock
-- (docs/07-showroom-3d.md §4). Only counts leave the database: no order, client or product information.
create function public.showroom_stats() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'cutting_today', (select count(*) from public.cutting_jobs where status = 'ready' and finished_at >= date_trunc('day', now())),
    'cutting_queue', (select count(*) from public.cutting_jobs where status in ('queued', 'cutting')),
    'shipped_week',  (select count(*) from public.deliveries where status in ('in_transit', 'delivered') and updated_at >= now() - interval '7 days')
  )
$$;
revoke all on function public.showroom_stats() from public;
grant execute on function public.showroom_stats() to anon, authenticated;
