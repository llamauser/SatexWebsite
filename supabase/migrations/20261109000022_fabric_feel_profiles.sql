-- Estimated customer-facing feel scores and versioned simulation parameters.
create or replace function public.stretch_feel_score(p_pct double precision) returns double precision
language sql immutable set search_path = '' as $$
  select case
    when greatest(0, least(60, p_pct)) <= 5 then greatest(0, least(60, p_pct)) * 0.4
    when greatest(0, least(60, p_pct)) <= 15 then 2 + (greatest(0, least(60, p_pct)) - 5) * 0.3
    when greatest(0, least(60, p_pct)) <= 30 then 5 + (greatest(0, least(60, p_pct)) - 15) / 15 * 2.5
    else 7.5 + (greatest(0, least(60, p_pct)) - 30) / 30 * 2.5
  end
$$;

create or replace function public.map_fabric_feel_params(
  p_fabric_id uuid, p_softness double precision, p_drape double precision,
  p_stretch double precision, p_sheen double precision
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_gsm double precision;
  v_rho double precision;
  v_stretch double precision := greatest(0, least(1, coalesce(p_stretch, 5) / 10));
  v_drape double precision := greatest(0, least(1, coalesce(p_drape, 5) / 10));
  v_sheen double precision := greatest(0, least(1, coalesce(p_sheen, 5) / 10));
  v_alpha_s double precision;
  v_tension double precision;
begin
  select f.gsm into v_gsm from public.fabrics f where f.id = p_fabric_id;
  if not found then return null; end if;
  v_rho := v_gsm / 1000.0;
  v_alpha_s := power(10.0, -8.0 + 3.0 * v_stretch);
  v_tension := 40.0 - 35.0 * v_stretch;
  return jsonb_build_object(
    'version', 1,
    'xpbd', jsonb_build_object(
      'particleMass', v_rho * power(0.4 / 29.0, 2),
      'stretchCompliance', v_alpha_s,
      'shearCompliance', 10 * v_alpha_s,
      'bendCompliance', power(10.0, -5.0 + 4.0 * v_drape),
      'damping', 0.02 - 0.015 * v_drape,
      'friction', 0.6 - 0.3 * v_sheen,
      'airDrag', 0.02 * greatest(0.1, least(1.0, 1.0 - v_gsm / 600.0))
    ),
    'blender', jsonb_build_object(
      'quality', 10,
      'massPerVertex', v_rho * 0.00004,
      'tensionStiffness', v_tension,
      'compressionStiffness', v_tension,
      'shearStiffness', v_tension / 3.0,
      'bendingStiffness', power(10.0, 1.7 - 3.0 * v_drape),
      'tensionDamping', 5,
      'airDamping', greatest(0.5, 1.0 + 2.0 * (1.0 - v_gsm / 600.0)),
      'selfCollision', true,
      'selfCollisionDistance', 0.003,
      'selfCollisionFriction', (0.6 - 0.3 * v_sheen) * 10,
      'collisionDistance', 0.005
    )
  );
end $$;

create or replace function public.refresh_fabric_feel_profile(p_fabric_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_f public.fabrics;
  v_current public.fabric_feel;
  v_part record;
  v_fiber text;
  v_pct double precision;
  v_total double precision := 0;
  v_soft_avg double precision := 0;
  v_breath_avg double precision := 0;
  v_sheen_avg double precision := 0;
  v_viscose_share double precision := 0;
  v_silk_share double precision := 0;
  v_modal_share double precision := 0;
  v_linen_share double precision := 0;
  v_elastane_pct double precision := 0;
  v_soft double precision;
  v_breath double precision;
  v_sheen double precision;
  v_drape double precision;
  v_stretch double precision;
  v_stretch_pct double precision;
  v_drape_coeff double precision;
  v_warp double precision;
  v_weft double precision;
  v_source jsonb;
begin
  select * into v_f from public.fabrics where id = p_fabric_id;
  if not found then return; end if;
  select * into v_current from public.fabric_feel where fabric_id = p_fabric_id;
  v_source := coalesce(v_current.measured, '{}'::jsonb);

  for v_part in select value from jsonb_array_elements(coalesce(v_f.composition, '[]'::jsonb)) loop
    v_fiber := coalesce(v_part.value ->> 'fiber', 'other');
    v_pct := greatest(0, coalesce((v_part.value ->> 'pct')::double precision, 0));
    v_total := v_total + v_pct;
    v_soft_avg := v_soft_avg + v_pct * case v_fiber
      when 'cotton' then 7 when 'linen' then 4 when 'wool' then 6 when 'silk' then 9 when 'viscose' then 8
      when 'modal' then 9 when 'polyester' then 5 when 'nylon' then 5 when 'elastane' then 6 when 'acrylic' then 6 else 5 end;
    v_breath_avg := v_breath_avg + v_pct * case v_fiber
      when 'cotton' then 8 when 'linen' then 10 when 'wool' then 7 when 'silk' then 8 when 'viscose' then 8
      when 'modal' then 8 when 'polyester' then 3 when 'nylon' then 3 when 'elastane' then 3 when 'acrylic' then 4 else 5 end;
    v_sheen_avg := v_sheen_avg + v_pct * case v_fiber
      when 'cotton' then 2 when 'linen' then 3 when 'wool' then 2 when 'silk' then 9 when 'viscose' then 6
      when 'modal' then 5 when 'polyester' then 5 when 'nylon' then 6 when 'elastane' then 4 when 'acrylic' then 3 else 3 end;
    if v_fiber = 'viscose' then v_viscose_share := v_viscose_share + v_pct; end if;
    if v_fiber = 'silk' then v_silk_share := v_silk_share + v_pct; end if;
    if v_fiber = 'modal' then v_modal_share := v_modal_share + v_pct; end if;
    if v_fiber = 'linen' then v_linen_share := v_linen_share + v_pct; end if;
    if v_fiber = 'elastane' then v_elastane_pct := v_elastane_pct + v_pct; end if;
  end loop;
  if v_total <= 0 then v_total := 100; v_soft_avg := 500; v_breath_avg := 500; v_sheen_avg := 300; end if;

  v_soft := v_soft_avg / v_total
    + case when v_f.finish && array['brushed','peached'] then 1.5 else 0 end
    + case when 'mercerized' = any(v_f.finish) then 0.5 else 0 end
    - case when v_f.structure::text in ('denim','canvas') then 2 else 0 end
    - case when v_f.gsm > 300 then 1 else 0 end;
  v_breath := v_breath_avg / v_total - greatest(0, (v_f.gsm - 150) / 50.0)
    + case when v_f.structure::text = 'mesh' then 2 else 0 end
    - case when v_f.finish && array['water_repellent','coated'] then 1 else 0 end;
  v_sheen := v_sheen_avg / v_total
    + case when v_f.structure::text = 'satin' then 3 else 0 end
    + case when v_f.structure::text = 'velvet' then 2 else 0 end
    + case when 'mercerized' = any(v_f.finish) then 1 else 0 end
    - case when v_f.structure::text in ('crepe','denim','canvas','fleece') then 1 else 0 end;
  v_drape := 10 - (v_f.gsm - 60) / 40.0
    + case when v_f.construction::text = 'knit' then 1 else 0 end
    + case when v_f.structure::text in ('chiffon','crepe','satin') then 1.5 else 0 end
    + case when v_f.structure::text = 'jersey' then 1 else 0 end
    - case when v_f.structure::text in ('denim','canvas','gabardine') then 2 else 0 end
    - case when v_f.structure::text = 'felt' then 3 else 0 end
    + 2 * (v_viscose_share + v_silk_share + v_modal_share) / v_total
    - v_linen_share / v_total;

  v_drape_coeff := nullif(v_source ->> 'drape_coefficient', '')::double precision;
  if v_drape_coeff is not null then v_drape := 10 * (0.95 - greatest(0, least(1, v_drape_coeff))) / 0.65; end if;
  v_warp := nullif(v_source ->> 'stretch_pct_warp', '')::double precision;
  v_weft := nullif(v_source ->> 'stretch_pct_weft', '')::double precision;
  v_stretch_pct := greatest(coalesce(v_warp, -1), coalesce(v_weft, -1));
  if v_stretch_pct < 0 then v_stretch_pct := v_f.stretch_pct; end if;
  v_stretch := case when v_stretch_pct is not null then public.stretch_feel_score(v_stretch_pct)
    else case v_f.stretch::text when 'none' then 0 when 'mechanical' then 2 when 'two_way' then 6 when 'four_way' then 8.5 else 0 end end
    + 0.2 * v_elastane_pct;

  if coalesce(v_current.is_measured, false) then
    v_soft := coalesce(v_current.softness, v_soft);
    v_drape := coalesce(v_current.drape, v_drape);
    v_stretch := coalesce(v_current.stretch, v_stretch);
    v_sheen := coalesce(v_current.sheen, v_sheen);
    v_breath := coalesce(v_current.breathability, v_breath);
  end if;

  insert into public.fabric_feel (fabric_id, softness, drape, stretch, sheen, breathability, measured, is_measured)
  values (p_fabric_id,
    round(greatest(0, least(10, v_soft)) * 2) / 2,
    round(greatest(0, least(10, v_drape)) * 2) / 2,
    round(greatest(0, least(10, v_stretch)) * 2) / 2,
    round(greatest(0, least(10, v_sheen)) * 2) / 2,
    round(greatest(0, least(10, v_breath)) * 2) / 2,
    v_source, coalesce(v_current.is_measured, false))
  on conflict (fabric_id) do update set
    softness = excluded.softness, drape = excluded.drape, stretch = excluded.stretch,
    sheen = excluded.sheen, breathability = excluded.breathability;
end $$;

create or replace function public.fabric_feel_map_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.fabric_feel set sim_params = public.map_fabric_feel_params(new.fabric_id, new.softness, new.drape, new.stretch, new.sheen)
   where fabric_id = new.fabric_id;
  return null;
end $$;

create or replace function public.refresh_fabric_feel_profile_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.refresh_fabric_feel_profile(new.id);
  return null;
end $$;

create trigger fabrics_refresh_feel after insert or update of composition, gsm, structure, construction, stretch, stretch_pct, finish
  on public.fabrics for each row execute function public.refresh_fabric_feel_profile_trigger();

create trigger fabric_feel_refresh_sim_params after insert or update of softness, drape, stretch, sheen, breathability
  on public.fabric_feel for each row execute function public.fabric_feel_map_trigger();

-- Backfill current fabrics; existing measured values remain intact.
do $$
declare v_id uuid;
begin
  for v_id in select id from public.fabrics loop
    perform public.refresh_fabric_feel_profile(v_id);
  end loop;
end $$;

revoke all on function public.map_fabric_feel_params(uuid, double precision, double precision, double precision, double precision),
  public.refresh_fabric_feel_profile(uuid), public.fabric_feel_map_trigger(), public.refresh_fabric_feel_profile_trigger()
  from public, anon, authenticated;
