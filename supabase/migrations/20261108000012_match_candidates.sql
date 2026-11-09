-- P1-09: candidate retrieval for the AI fabric matching (docs/06-ai-matching.md §2 B).
-- Hard filters (in stock, MOQ, construction, fibers to avoid, weight window) + vector similarity. One row per in-stock color.
-- Called only by the server (service role): the scoring and the explanations happen in TypeScript.

create function public.match_candidates(
  p_embedding extensions.vector(1024),
  p_spec jsonb,
  p_required_m numeric default 0,
  p_fabric_limit int default 40,
  p_exclude_colors uuid[] default '{}'
) returns table (
  color_id uuid, fabric_id uuid, slug text, sku text, name jsonb, structure text, construction text, composition jsonb,
  gsm int, width_cm int, stretch text, uses text[], seasons text[], moq_m numeric, feel jsonb, available_m numeric,
  price numeric, text_sim double precision, hex text, lab real[], color_code text, color_name jsonb, image_path text
)
language sql stable set search_path = public, extensions as $$
  with spec as (
    select
      nullif(p_spec ->> 'construction', '') as construction,
      array(select jsonb_array_elements_text(coalesce(p_spec -> 'structures', '[]'))) as structures,
      array(select jsonb_array_elements_text(coalesce(p_spec -> 'fibers_preferred', '[]'))) as fibers_preferred,
      array(select jsonb_array_elements_text(coalesce(p_spec -> 'fibers_avoid', '[]'))) as fibers_avoid,
      array(select jsonb_array_elements_text(coalesce(p_spec -> 'uses', '[]'))) as uses,
      (p_spec ->> 'gsm_min')::numeric as gsm_min,
      (p_spec ->> 'gsm_max')::numeric as gsm_max
  ), fabrics_ranked as (
    select
      f.id,
      case when p_embedding is null or e.embedding is null then 0 else greatest(1 - (e.embedding <=> p_embedding), 0) end as sim,
      (case when s.gsm_min is null and s.gsm_max is null then 0
            when f.gsm between coalesce(s.gsm_min, 0) * 0.9 and coalesce(s.gsm_max, 100000) * 1.1 then 1 else 0 end)
      + (case when cardinality(s.structures) > 0 and f.structure::text = any (s.structures) then 1 else 0 end)
      + (case when cardinality(s.uses) > 0 and f.uses && s.uses then 1 else 0 end)
      + (case when cardinality(s.fibers_preferred) > 0 and exists (
            select 1 from jsonb_array_elements(f.composition) c where c ->> 'fiber' = any (s.fibers_preferred)) then 1 else 0 end) as fit
    from public.fabrics f
    cross join spec s
    left join public.embeddings e on e.owner_type = 'fabric' and e.owner_id = f.id and e.kind = 'text'
    where f.is_active
      and (s.construction is null or f.construction::text = s.construction)
      and (cardinality(s.fibers_avoid) = 0 or not exists (
            select 1 from jsonb_array_elements(f.composition) c where c ->> 'fiber' = any (s.fibers_avoid) and (c ->> 'pct')::numeric >= 5))
      and (s.gsm_min is null or f.gsm >= s.gsm_min * 0.75)
      and (s.gsm_max is null or f.gsm <= s.gsm_max * 1.25)
      and exists (select 1 from public.v_color_availability_all a
                   where a.fabric_id = f.id and a.available_m >= greatest(f.moq_m, coalesce(p_required_m, 0)))
    order by (0.25 * (case when p_embedding is null or e.embedding is null then 0 else greatest(1 - (e.embedding <=> p_embedding), 0) end)
              + 0.1 * (
                  (case when s.gsm_min is null and s.gsm_max is null then 0
                        when f.gsm between coalesce(s.gsm_min, 0) * 0.9 and coalesce(s.gsm_max, 100000) * 1.1 then 1 else 0 end)
                  + (case when cardinality(s.structures) > 0 and f.structure::text = any (s.structures) then 1 else 0 end)
                  + (case when cardinality(s.uses) > 0 and f.uses && s.uses then 1 else 0 end)
                  + (case when cardinality(s.fibers_preferred) > 0 and exists (
                        select 1 from jsonb_array_elements(f.composition) c where c ->> 'fiber' = any (s.fibers_preferred)) then 1 else 0 end)
                )) desc, f.sku
    limit greatest(least(coalesce(p_fabric_limit, 40), 100), 1)
  )
  select
    c.id, f.id, f.slug, f.sku, f.name, f.structure::text, f.construction::text, f.composition, f.gsm, f.width_cm, f.stretch::text,
    f.uses, f.seasons::text[], f.moq_m, to_jsonb(ff) - 'fabric_id' - 'measured' - 'is_measured' - 'sim_params' - 'updated_at',
    a.available_m,
    (select min(t.price_per_m) from public.fabric_price_tiers t where t.fabric_id = f.id),
    r.sim::double precision, c.hex, c.lab, c.code, c.name,
    (select i.storage_path from public.fabric_images i where i.color_id = c.id and i.kind = 'photo' order by i.sort limit 1)
  from fabrics_ranked r
  join public.fabrics f on f.id = r.id
  join public.fabric_colors c on c.fabric_id = f.id and c.is_active and not (c.id = any (coalesce(p_exclude_colors, '{}')))
  join public.v_color_availability_all a on a.color_id = c.id and a.available_m >= greatest(f.moq_m, coalesce(p_required_m, 0))
  left join public.fabric_feel ff on ff.fabric_id = f.id
  order by r.sim desc, f.sku, c.sort
$$;

revoke execute on function public.match_candidates(extensions.vector, jsonb, numeric, int, uuid[]) from public, anon, authenticated;
grant execute on function public.match_candidates(extensions.vector, jsonb, numeric, int, uuid[]) to service_role;
