-- Tables created after 20261108000007 inherit Supabase's default grants (every privilege to anon and authenticated). Row level security does not
-- cover TRUNCATE (nor REFERENCES or TRIGGER), so the new planner tables must not keep them: give each table only what it is used for.

revoke all on public.garment_consumption, public.collections, public.collection_items from anon, authenticated;

-- how much fabric a garment takes: read by signed-in clients (the planner), edited by admins (RLS: garment_consumption_admin)
grant select, insert, update, delete on public.garment_consumption to authenticated;

-- collections are read by their client and by staff; every change goes through the planner API or request_collection_quote()
grant select on public.collections, public.collection_items to authenticated;
