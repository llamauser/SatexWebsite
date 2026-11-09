-- A client's own quotes, orders, samples and reservations must stay readable when a fabric is later switched off or sold out:
-- the colors and fabrics they refer to remain visible to that client (and only to them). Found by the back-office tests:
-- an order for a deactivated fabric showed no lines.
--
-- The checks are SECURITY DEFINER functions: the policies of fabrics and fabric_colors point at each other, and a function that
-- reads the tables with the owner's rights keeps them from recursing.

create function public.color_in_my_documents(p_color_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_client_id() is not null and (
    exists (select 1 from public.quote_lines l join public.quotes q on q.id = l.quote_id where l.color_id = p_color_id and q.client_id = public.my_client_id())
    or exists (select 1 from public.order_lines l join public.orders o on o.id = l.order_id where l.color_id = p_color_id and o.client_id = public.my_client_id())
    or exists (select 1 from public.sample_request_items i join public.sample_requests s on s.id = i.sample_request_id where i.color_id = p_color_id and s.client_id = public.my_client_id())
    or exists (select 1 from public.stock_reservations r where r.color_id = p_color_id and r.client_id = public.my_client_id())
  )
$$;

create function public.fabric_in_my_documents(p_fabric_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fabric_colors c where c.fabric_id = p_fabric_id and public.color_in_my_documents(c.id))
$$;

revoke all on function public.color_in_my_documents(uuid), public.fabric_in_my_documents(uuid) from public, anon;
grant execute on function public.color_in_my_documents(uuid), public.fabric_in_my_documents(uuid) to authenticated;

drop policy fabrics_read on public.fabrics;
create policy fabrics_read on public.fabrics for select using (is_active or public.is_staff() or public.fabric_in_my_documents(id));

drop policy colors_read on public.fabric_colors;
create policy colors_read on public.fabric_colors for select using (
  public.is_staff()
  or (is_active and exists (select 1 from public.fabrics f where f.id = fabric_id and f.is_active))
  or public.color_in_my_documents(id));
