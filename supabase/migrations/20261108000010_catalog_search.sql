-- P1-07: catalog. color families, catalog_search(), live stock broadcast, public low-stock threshold.
-- Spec: docs/05-commerce.md §1.

-- ---------------------------------------------------------------- color families (docs/05-commerce.md: white, black, grey, beige, brown, red, orange, yellow, green, blue, purple, pink)
-- Rules on CIELAB lightness L, chroma c = sqrt(a^2 + b^2) and hue angle h in degrees. Evaluated top to bottom.
create function public.color_family(p_lab real[]) returns text
language plpgsql immutable parallel safe as $$
declare
  l double precision := p_lab[1];
  c double precision := sqrt(p_lab[2] ^ 2 + p_lab[3] ^ 2);
  h double precision := degrees(atan2(p_lab[3], p_lab[2]));
begin
  if h < 0 then h := h + 360; end if;
  if l > 90 and c < 8 then return 'white'; end if;
  if l < 20 and c < 10 then return 'black'; end if;
  if c < 8 then return 'grey'; end if;
  if h >= 325 or h < 12 or (h < 50 and l > 70 and c < 40) then return 'pink'; end if;
  if h >= 30 and h < 80 and l < 50 and c < 55 then return 'brown'; end if;      -- dark, muted oranges
  if h >= 50 and h < 110 and c < 25 and l >= 60 then return 'beige'; end if;    -- light, muted yellows/oranges
  if h < 50 then return 'red'; end if;
  if h < 80 then return case when l < 65 and c < 45 then 'brown' else 'orange' end; end if;
  if h < 110 then return case when l < 55 then 'green' else 'yellow' end; end if;  -- dark yellows read as olive
  if h < 185 then return 'green'; end if;
  if h < 300 or (h < 309 and c > 100) then return 'blue'; end if;               -- pure sRGB blue has h = 306
  return 'purple';
end $$;

alter table public.fabric_colors add column family text;
create index fabric_colors_family_idx on public.fabric_colors (family) where is_active;

create or replace function public.fabric_colors_set_lab() returns trigger
language plpgsql as $$
begin
  new.lab := public.hex_to_lab(new.hex);
  new.family := public.color_family(new.lab);
  return new;
end $$;

update public.fabric_colors set hex = hex;  -- fires the trigger for existing rows

-- ---------------------------------------------------------------- catalog search
create function public.catalog_search(
  p_q text default null,
  p_categories text[] default null,
  p_constructions text[] default null,
  p_structures text[] default null,
  p_fibers text[] default null,
  p_gsm_min int default null,
  p_gsm_max int default null,
  p_stretch text[] default null,
  p_uses text[] default null,
  p_season text default null,
  p_colors text[] default null,
  p_in_stock boolean default true,
  p_sort text default 'relevance',
  p_limit int default 24,
  p_offset int default 0
) returns table (
  id uuid, slug text, sku text, name jsonb, structure text, construction text, gsm int, width_cm int,
  composition jsonb, stretch text, is_featured boolean, from_price numeric, in_stock boolean, available_m numeric,
  color_count int, colors jsonb, image_path text, total_count bigint
)
language sql stable set search_path = public, extensions as $$
  with q as (
    select
      nullif(trim(p_q), '') as raw,
      -- prefix match on every word: "piq" finds "piqué"
      case when nullif(trim(p_q), '') is null then null else
        nullif(array_to_string(array(
          select w || ':*' from unnest(regexp_split_to_array(regexp_replace(lower(public.immutable_unaccent(trim(p_q))), '[^a-z0-9 ]', ' ', 'g'), '\s+')) w where w <> ''
        ), ' & '), '')
      end as prefix_query
  ), found as (
    select
      f.*,
      cat.slug as category_slug,
      (select min(t.price_per_m) from public.fabric_price_tiers t where t.fabric_id = f.id) as min_price,
      (select coalesce(sum(a.available_m), 0) from public.v_color_availability a where a.fabric_id = f.id) as avail_total,
      exists (select 1 from public.v_color_availability a where a.fabric_id = f.id and a.available_m >= f.moq_m) as has_stock,
      case when q.prefix_query is null then 0
           else coalesce(ts_rank(f.search_text, to_tsquery('simple', q.prefix_query)), 0) + similarity(lower(f.name ->> 'fr'), lower(q.raw)) end as rank
    from public.fabrics f
    join public.categories cat on cat.id = f.category_id
    cross join q
    where f.is_active
      and (q.raw is null
           or (q.prefix_query is not null and f.search_text @@ to_tsquery('simple', q.prefix_query))
           or similarity(lower(f.name ->> 'fr'), lower(q.raw)) > 0.3
           or f.name::text ilike '%' || replace(replace(q.raw, '%', ''), '_', ' ') || '%'
           or f.sku ilike q.raw || '%')
      and (p_categories is null or cat.slug = any (p_categories))
      and (p_constructions is null or f.construction::text = any (p_constructions))
      and (p_structures is null or f.structure::text = any (p_structures))
      and (p_fibers is null or exists (
            select 1 from jsonb_array_elements(f.composition) e
             where e ->> 'fiber' = any (p_fibers) and (e ->> 'pct')::numeric >= 1))
      and (p_gsm_min is null or f.gsm >= p_gsm_min)
      and (p_gsm_max is null or f.gsm <= p_gsm_max)
      and (p_stretch is null or f.stretch::text = any (p_stretch))
      and (p_uses is null or f.uses && p_uses)
      and (p_season is null
           or (p_season = 'all_season' and f.seasons && array['all_season']::public.season[])
           or (p_season in ('spring_summer', 'autumn_winter') and f.seasons && array[p_season::public.season, 'all_season'::public.season]))
      and (p_colors is null or exists (
            select 1 from public.fabric_colors fc where fc.fabric_id = f.id and fc.is_active and fc.family = any (p_colors)))
      and (p_in_stock is not true or exists (
            select 1 from public.v_color_availability a where a.fabric_id = f.id and a.available_m >= f.moq_m))
  )
  select
    f.id, f.slug, f.sku, f.name, f.structure::text, f.construction::text, f.gsm, f.width_cm, f.composition,
    f.stretch::text, f.is_featured, f.min_price, f.has_stock, f.avail_total,
    (select count(*)::int from public.fabric_colors fc where fc.fabric_id = f.id and fc.is_active),
    (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'hex', x.hex, 'name', x.name) order by x.sort), '[]'::jsonb)
       from (select fc.code, fc.hex, fc.name, fc.sort from public.fabric_colors fc
              where fc.fabric_id = f.id and fc.is_active order by fc.sort limit 6) x),
    (select i.storage_path from public.fabric_images i where i.fabric_id = f.id and i.kind = 'photo' order by i.sort, i.id limit 1),
    count(*) over ()
  from found f
  order by
    case when p_sort = 'price_asc' then f.min_price end asc nulls last,
    case when p_sort = 'price_desc' then f.min_price end desc nulls last,
    case when p_sort = 'gsm_asc' then f.gsm end asc,
    case when p_sort = 'gsm_desc' then f.gsm end desc,
    case when p_sort = 'newest' then f.created_at end desc,
    case when p_sort = 'relevance' then f.rank end desc,
    f.is_featured desc,
    f.sku asc
  limit greatest(least(coalesce(p_limit, 24), 100), 1)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke execute on function public.catalog_search(text, text[], text[], text[], text[], int, int, text[], text[], text, text[], boolean, text, int, int) from public;
grant execute on function public.catalog_search(text, text[], text[], text[], text[], int, int, text[], text[], text, text[], boolean, text, int, int) to anon, authenticated;

-- ---------------------------------------------------------------- live stock: broadcast a tiny "something changed" message
-- Public visitors cannot read stock_lots (staff only), so they cannot use postgres_changes. Instead a trigger broadcasts the
-- fabric id on a public Realtime channel and the page re-reads the public availability view. No stock figure is in the message.
create function public.broadcast_stock_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_color uuid;
  v_fabric uuid;
begin
  if tg_table_name = 'stock_movements' then
    select l.color_id into v_color from public.stock_lots l where l.id = new.lot_id;
  else
    v_color := new.color_id;
  end if;
  select c.fabric_id into v_fabric from public.fabric_colors c where c.id = v_color;
  if v_fabric is not null then
    begin
      perform realtime.send(jsonb_build_object('color_id', v_color), 'stock', 'fabric:' || v_fabric::text, false);
    exception when others then
      null; -- a broadcast problem must never block a stock operation
    end;
  end if;
  return null;
end $$;

create trigger stock_movements_broadcast after insert on public.stock_movements
  for each row execute function public.broadcast_stock_change();
create trigger stock_reservations_broadcast after insert or update of status, meters on public.stock_reservations
  for each row execute function public.broadcast_stock_change();
create trigger order_allocations_broadcast after insert or update of released on public.order_allocations
  for each row execute function public.broadcast_stock_change();

-- the low-stock threshold is not sensitive: pages use it to label "Low stock"
update public.app_settings set is_public = true where key = 'low_stock_threshold_m';
