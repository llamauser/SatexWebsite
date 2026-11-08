-- P1-03 / 7: Row Level Security on EVERY table. Spec: docs/03-permissions.md
-- Tables with no policy for a role are denied to that role (RLS default-deny).
-- The service-role key bypasses RLS and is used only by server jobs / webhooks / seed.

-- prices are public only when the setting says so (otherwise any signed-in user)
create function public.prices_visible() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.setting_bool('show_prices_public', true) or auth.uid() is not null
$$;
grant execute on function public.prices_visible() to anon, authenticated;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ================================================================ catalog
create policy categories_read   on public.categories for select using (true);
create policy categories_admin  on public.categories for all using (public.is_admin()) with check (public.is_admin());

create policy fabrics_read  on public.fabrics for select using (is_active or public.is_staff());
create policy fabrics_admin on public.fabrics for all using (public.is_admin()) with check (public.is_admin());

create policy colors_read on public.fabric_colors for select using (
  public.is_staff() or (is_active and exists (select 1 from public.fabrics f where f.id = fabric_id and f.is_active)));
create policy colors_admin on public.fabric_colors for all using (public.is_admin()) with check (public.is_admin());

create policy images_read on public.fabric_images for select using (
  public.is_staff() or exists (select 1 from public.fabrics f where f.id = fabric_id and f.is_active));
create policy images_admin on public.fabric_images for all using (public.is_admin()) with check (public.is_admin());

create policy tiers_read on public.fabric_price_tiers for select using (
  public.is_staff() or (public.prices_visible() and exists (select 1 from public.fabrics f where f.id = fabric_id and f.is_active)));
create policy tiers_admin on public.fabric_price_tiers for all using (public.is_admin()) with check (public.is_admin());

create policy feel_read on public.fabric_feel for select using (
  public.is_staff() or exists (select 1 from public.fabrics f where f.id = fabric_id and f.is_active));
create policy feel_admin on public.fabric_feel for all using (public.is_admin()) with check (public.is_admin());

-- embeddings: server-side only (service role); no policies for anon/authenticated
create policy embeddings_staff_read on public.embeddings for select using (public.is_staff());

create policy departments_read  on public.departments for select using (true);
create policy departments_admin on public.departments for all using (public.is_admin()) with check (public.is_admin());

-- ================================================================ stock
create policy lots_staff on public.stock_lots for select using (public.is_staff());
-- writes go through receive_lot() / stock_movements; direct DML only for staff on non-meter fields
create policy lots_staff_update on public.stock_lots for update using (public.is_staff()) with check (public.is_staff());
create policy movements_staff_read on public.stock_movements for select using (public.is_staff());
create policy movements_staff_insert on public.stock_movements for insert with check (public.is_staff());

create policy reservations_read on public.stock_reservations for select using (
  public.is_staff() or client_id = public.my_client_id());
-- inserts only via reserve_stock(); cancel via cancel_reservation()
create policy reservations_staff_update on public.stock_reservations for update using (public.is_staff()) with check (public.is_staff());

create policy allocations_staff on public.order_allocations for select using (public.is_staff());

-- ================================================================ customers
create policy profiles_read on public.profiles for select using (id = auth.uid() or public.is_staff());
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_update on public.profiles for update using (public.is_admin()) with check (public.is_admin());

create policy clients_read on public.clients for select using (id = public.my_client_id() or public.is_staff());
create policy clients_update on public.clients for update
  using (id = public.my_client_id() or public.is_staff()) with check (id = public.my_client_id() or public.is_staff());

create policy addresses_read   on public.addresses for select using (client_id = public.my_client_id() or public.is_staff());
create policy addresses_insert on public.addresses for insert with check (client_id = public.my_client_id() or public.is_staff());
create policy addresses_update on public.addresses for update
  using (client_id = public.my_client_id() or public.is_staff()) with check (client_id = public.my_client_id() or public.is_staff());
create policy addresses_delete on public.addresses for delete using (client_id = public.my_client_id());

-- ================================================================ quotes
create policy quotes_read on public.quotes for select using (client_id = public.my_client_id() or public.is_staff());
create policy quotes_insert_own on public.quotes for insert
  with check (client_id = public.my_client_id() and status = 'draft' and public.app_role() = 'client');
create policy quotes_update_draft on public.quotes for update
  using (client_id = public.my_client_id() and status = 'draft')
  with check (client_id = public.my_client_id() and status = 'draft');
create policy quotes_staff_update on public.quotes for update using (public.is_staff()) with check (public.is_staff());
create policy quotes_staff_insert on public.quotes for insert with check (public.is_staff());

create policy qlines_read on public.quote_lines for select using (
  public.is_staff() or exists (select 1 from public.quotes q where q.id = quote_id and q.client_id = public.my_client_id()));
create policy qlines_client_write on public.quote_lines for all
  using (exists (select 1 from public.quotes q where q.id = quote_id and q.client_id = public.my_client_id() and q.status = 'draft'))
  with check (exists (select 1 from public.quotes q where q.id = quote_id and q.client_id = public.my_client_id() and q.status = 'draft'));
create policy qlines_staff_write on public.quote_lines for all using (public.is_staff()) with check (public.is_staff());

-- ================================================================ samples
create policy samples_read on public.sample_requests for select using (client_id = public.my_client_id() or public.is_staff());
create policy samples_insert on public.sample_requests for insert
  with check (client_id = public.my_client_id() and status = 'requested' and public.app_role() = 'client');
create policy samples_staff_update on public.sample_requests for update using (public.is_staff()) with check (public.is_staff());
create policy sample_items_read on public.sample_request_items for select using (
  public.is_staff() or exists (select 1 from public.sample_requests s where s.id = sample_request_id and s.client_id = public.my_client_id()));
create policy sample_items_insert on public.sample_request_items for insert with check (
  exists (select 1 from public.sample_requests s where s.id = sample_request_id and s.client_id = public.my_client_id() and s.status = 'requested'));

-- ================================================================ orders
create policy orders_read on public.orders for select using (client_id = public.my_client_id() or public.is_staff());
create policy orders_staff_write on public.orders for all using (public.is_staff()) with check (public.is_staff());
create policy order_lines_read on public.order_lines for select using (
  public.is_staff() or exists (select 1 from public.orders o where o.id = order_id and o.client_id = public.my_client_id()));
create policy order_lines_staff_write on public.order_lines for all using (public.is_staff()) with check (public.is_staff());
create policy cutting_staff on public.cutting_jobs for all using (public.is_staff()) with check (public.is_staff());
create policy deliveries_read on public.deliveries for select using (
  public.is_staff() or exists (select 1 from public.orders o where o.id = order_id and o.client_id = public.my_client_id()));
create policy deliveries_staff_write on public.deliveries for all using (public.is_staff()) with check (public.is_staff());

-- ================================================================ AI + system
create policy match_sessions_read on public.match_sessions for select using (user_id = auth.uid() or public.is_admin());
create policy match_sessions_feedback on public.match_sessions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy match_sessions_delete on public.match_sessions for delete using (user_id = auth.uid());
-- anonymous sessions (session_token) and all inserts go through the server with the service role
create policy match_iterations_read on public.match_session_iterations for select using (
  public.is_admin() or exists (select 1 from public.match_sessions s where s.id = session_id and s.user_id = auth.uid()));

create policy notifications_read on public.notifications for select using (user_id = auth.uid());
create policy notifications_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy email_log_admin on public.email_log for select using (public.is_admin());

create policy contact_insert on public.contact_messages for insert with check (true);   -- rate-limited by the server action
create policy contact_staff_read on public.contact_messages for select using (public.is_staff());
create policy contact_staff_update on public.contact_messages for update using (public.is_staff()) with check (public.is_staff());
create policy contact_admin_delete on public.contact_messages for delete using (public.is_admin());

-- rate_limits: no policies (service role / security definer function only)

create policy settings_read on public.app_settings for select using (is_public or public.is_admin());
create policy settings_admin on public.app_settings for all using (public.is_admin()) with check (public.is_admin());

create policy audit_admin on public.audit_log for select using (public.is_admin());

-- ================================================================ views (public availability + settings)
grant select on public.v_color_availability to anon, authenticated;
grant select on public.public_settings to anon, authenticated;

-- ================================================================ table privileges: tighten defaults
-- RLS is the gate, but remove write grants from anon entirely (defense in depth)
revoke insert, update, delete, truncate on all tables in schema public from anon;
grant insert on public.contact_messages to anon;
