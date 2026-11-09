-- Collection changes go through the authenticated planner API, which validates size runs, palette choices and meterage.
-- Keep RLS SELECT access for the account screen, and prevent clients from changing quote inputs directly through PostgREST.
revoke insert, update, delete on public.collections, public.collection_items from anon, authenticated;
grant select on public.collections, public.collection_items to authenticated;
