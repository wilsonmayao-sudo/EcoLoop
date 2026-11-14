-- Migration: Transactional Overflow Acceptance RPC and GPS route_id compatibility
-- Apply in the Supabase SQL editor.

-- 1. Support text/UUID route identifiers in GPS tracking tables
do $$
begin
  alter table public.vehicle_locations_latest drop constraint if exists vehicle_locations_latest_route_id_fkey;
  alter table public.vehicle_locations_latest alter column route_id type text using route_id::text;
exception when others then null;
end $$;

do $$
begin
  alter table public.vehicle_gps_logs drop constraint if exists vehicle_gps_logs_route_id_fkey;
  alter table public.vehicle_gps_logs alter column route_id type text using route_id::text;
exception when others then null;
end $$;

-- 2. Transactional RPC function for atomic overflow acceptance
create or replace function public.accept_overflow_event(
  p_event_id uuid,
  p_target_driver_id text,
  p_target_vehicle_id text default null,
  p_target_route_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event                record;
  v_driver               record;
  v_vehicle              record;
  v_source_route         record;
  v_candidate_route      record;
  v_existing_delivery    record;
  v_conflict_delivery    record;
  v_target_driver_txt    text := nullif(btrim(p_target_driver_id), '');
  v_target_driver_bigint bigint;
  v_vehicle_id_txt       text;
  v_vehicle_bigint       bigint := null;
  v_route_id             text := nullif(btrim(p_target_route_id), '');
  v_target_route_bigint  bigint;
  v_source_route_bigint  bigint := null;
  v_source_driver_bigint bigint := null;
  v_profile_status       text := null;
  v_is_staff             boolean := false;
  v_bin_id               bigint;
  v_max_stop_order       int := 0;
  v_now                  timestamptz := now();
  v_bin_ids              bigint[] := '{}';
  v_skipped_bins         int := 0;
  v_bins_json            jsonb;
  v_i                    int;
  v_elem                 jsonb;
begin
  if v_target_driver_txt is null or v_target_driver_txt !~ '^[0-9]+$' then
    return jsonb_build_object('success', false, 'error', 'Valid target driver ID is required to accept overflow');
  end if;
  v_target_driver_bigint := v_target_driver_txt::bigint;

  if auth.uid() is null and coalesce(current_setting('role', true), '') not in ('service_role', 'postgres') then
    return jsonb_build_object('success', false, 'error', 'Authentication required');
  end if;

  if coalesce(current_setting('role', true), '') in ('service_role', 'postgres') then
    v_is_staff := true;
  else
    v_is_staff := (
      public.is_admin(auth.uid())
      or public.is_dispatcher(auth.uid())
      or public.is_supervisor(auth.uid())
    );
    if not (
      v_is_staff
      or (
        public.current_profile_is_active()
        and public.current_app_role() = 'truck_driver'::text
        and exists (
          select 1
          from public.drivers d
          where d.auth_user_id = auth.uid()
            and d.id = v_target_driver_bigint
        )
      )
    ) then
      return jsonb_build_object('success', false, 'error', 'Not authorized to accept this overflow event');
    end if;
  end if;

  -- Lock overflow event row for update to prevent concurrent duplicate acceptance
  select * into v_event
  from public.overflow_events
  where id = p_event_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Overflow event not found');
  end if;

  if v_event.status = 'accepted' then
    return jsonb_build_object(
      'success', false,
      'error', 'Overflow event has already been accepted',
      'target_route_id', case when v_event.target_route_id is not null then v_event.target_route_id::text else null end
    );
  end if;

  if v_event.status in ('declined', 'completed') then
    return jsonb_build_object('success', false, 'error', 'Overflow event cannot be accepted in current state: ' || v_event.status);
  end if;

  if not v_is_staff
     and nullif(btrim(v_event.target_driver_id), '') is not null
     and btrim(v_event.target_driver_id) <> v_target_driver_txt
  then
    return jsonb_build_object('success', false, 'error', 'This overflow dispatch is assigned to a different driver');
  end if;

  if v_event.source_driver_id is not null and btrim(v_event.source_driver_id) = v_target_driver_txt then
    return jsonb_build_object('success', false, 'error', 'Source driver cannot accept their own overflow event');
  end if;

  -- Lock target driver row & verify eligibility
  select * into v_driver
  from public.drivers
  where id = v_target_driver_bigint
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Target driver not found');
  end if;

  if lower(coalesce(v_driver.status::text, '')) in ('offline', 'inactive', 'suspended', 'full', 'on_break') then
    return jsonb_build_object('success', false, 'error', 'Target driver is not available (' || coalesce(v_driver.status::text, 'unknown') || ')');
  end if;

  select up.status::text into v_profile_status
  from public.user_profiles up
  where (v_driver.profile_id is not null and up.id = v_driver.profile_id)
     or up.id = v_driver.auth_user_id
  limit 1;

  if v_profile_status is not null and lower(v_profile_status) in ('suspended', 'inactive') then
    return jsonb_build_object('success', false, 'error', 'Target driver account is ' || v_profile_status);
  end if;

  -- Resolve & lock target vehicle row (falling back to open routes / vehicles.driver_id)
  v_vehicle_id_txt := coalesce(
    nullif(btrim(p_target_vehicle_id), ''),
    v_driver.assigned_vehicle_id::text,
    nullif(btrim(v_event.target_vehicle_id), ''),
    (
      select r.vehicle_id::text
      from public.routes r
      where r.driver_id = v_target_driver_bigint
        and r.vehicle_id is not null
        and r.status in ('active'::public.route_status, 'pending'::public.route_status, 'planned'::public.route_status)
      order by case when r.status = 'active'::public.route_status then 1 else 2 end, r.created_at desc
      limit 1
    ),
    (
      select v.id::text
      from public.vehicles v
      where v.driver_id is not null
        and btrim(v.driver_id) = v_target_driver_txt
      order by v.id asc
      limit 1
    )
  );

  if v_vehicle_id_txt is not null and v_event.source_vehicle_id is not null and btrim(v_event.source_vehicle_id) = btrim(v_vehicle_id_txt) then
    return jsonb_build_object('success', false, 'error', 'Source vehicle cannot accept its own overflow event');
  end if;

  if v_vehicle_id_txt is not null and btrim(v_vehicle_id_txt) ~ '^[0-9]+$' then
    v_vehicle_bigint := btrim(v_vehicle_id_txt)::bigint;

    select * into v_vehicle
    from public.vehicles
    where id = v_vehicle_bigint
    for update;

    if not found then
      return jsonb_build_object('success', false, 'error', 'Target vehicle not found');
    end if;

    if v_vehicle.is_active is false then
      return jsonb_build_object('success', false, 'error', 'Target vehicle is inactive');
    end if;

    if lower(coalesce(v_vehicle.status, '')) in (
      'full', 'maintenance', 'inactive', 'offline', 'unloading',
      'assisting_overflow', 'out_of_service', 'suspended'
    ) then
      return jsonb_build_object('success', false, 'error', 'Target vehicle is unavailable (' || v_vehicle.status || ')');
    end if;
  end if;

  if v_event.source_route_id is not null and btrim(v_event.source_route_id) ~ '^[0-9]+$' then
    v_source_route_bigint := btrim(v_event.source_route_id)::bigint;
  end if;

  if v_event.source_driver_id is not null and btrim(v_event.source_driver_id) ~ '^[0-9]+$' then
    v_source_driver_bigint := btrim(v_event.source_driver_id)::bigint;
  end if;

  -- Dedicated Overflow Assistance Route Rule: only reuse an open Overflow Assistance Route;
  -- never append overflow stops onto the back of a driver's regular collection route.
  if v_route_id is not null then
    select id, status into v_candidate_route
    from public.routes
    where id::text = v_route_id
      and driver_id = v_target_driver_bigint
      and status in ('active', 'pending', 'planned')
      and (
        coalesce(optimization_method, '') in ('overflow_reassignment', 'dynamic-reassignment+mapbox')
        or lower(coalesce(name, '')) like '%overflow%'
      )
    for update;

    if not found then
      v_route_id := null;
    elsif v_candidate_route.status in ('pending', 'planned') then
      update public.routes
      set
        status = 'active',
        started_at = coalesce(started_at, v_now),
        assignment_updated_at = v_now
      where id = v_candidate_route.id;
    end if;
  end if;

  if v_route_id is null then
    if v_source_route_bigint is not null then
      select area_code, scheduled_days, shift_label, waste_category, center_lat, center_lng
      into v_source_route
      from public.routes
      where id = v_source_route_bigint;
    end if;

    insert into public.routes (
      name,
      status,
      area_code,
      scheduled_days,
      shift_label,
      waste_category,
      center_lat,
      center_lng,
      driver_id,
      vehicle_id,
      optimization_method,
      generated_at,
      assignment_updated_at,
      started_at
    ) values (
      'Overflow Assistance Route',
      'active',
      case when v_source_route_bigint is not null then v_source_route.area_code else null end,
      case when v_source_route_bigint is not null then v_source_route.scheduled_days else null end,
      case when v_source_route_bigint is not null then v_source_route.shift_label else null end,
      case when v_source_route_bigint is not null then v_source_route.waste_category else null end,
      case when v_source_route_bigint is not null then v_source_route.center_lat else null end,
      case when v_source_route_bigint is not null then v_source_route.center_lng else null end,
      v_target_driver_bigint,
      v_vehicle_bigint,
      'overflow_reassignment',
      v_now,
      v_now,
      v_now
    )
    returning id::text into v_route_id;
  end if;

  v_target_route_bigint := v_route_id::bigint;

  -- Get current max stop_order on target route
  select coalesce(max(stop_order), 0) into v_max_stop_order
  from public.route_stops
  where route_id = v_target_route_bigint;

  -- Lock & reassign deliveries and insert route stops safely without double-assignment
  v_bins_json := coalesce(v_event.overflow_bins, '[]'::jsonb);
  for v_i in 0 .. coalesce(jsonb_array_length(v_bins_json), 0) - 1 loop
    v_elem := v_bins_json->v_i;
    if (v_elem ? 'bin_id') and coalesce(btrim(v_elem->>'bin_id'), '') ~ '^[0-9]+$' then
      v_bin_id := btrim(v_elem->>'bin_id')::bigint;
    else
      continue;
    end if;

    if v_source_route_bigint is not null then
      select id into v_conflict_delivery
      from public.deliveries
      where route_id = v_source_route_bigint
        and bin_id = v_bin_id
        and status::text = 'completed'
      limit 1
      for update;

      if found then
        v_skipped_bins := v_skipped_bins + 1;
        continue;
      end if;
    end if;

    select d.id into v_conflict_delivery
    from public.deliveries d
    join public.routes r on r.id = d.route_id
    where d.bin_id = v_bin_id
      and d.route_id <> v_target_route_bigint
      and (v_source_route_bigint is null or d.route_id <> v_source_route_bigint)
      and (r.status in ('active', 'pending', 'planned') or d.status::text in ('in_progress', 'completed'))
    limit 1
    for update of d;

    if found then
      v_skipped_bins := v_skipped_bins + 1;
      continue;
    end if;

    v_bin_ids := array_append(v_bin_ids, v_bin_id);

    if not exists (
      select 1
      from public.route_stops
      where route_id = v_target_route_bigint
        and bin_id = v_bin_id
    ) then
      v_max_stop_order := v_max_stop_order + 1;
      insert into public.route_stops (route_id, bin_id, stop_order)
      values (v_target_route_bigint, v_bin_id, v_max_stop_order)
      on conflict do nothing;
    end if;

    select id, driver_id into v_existing_delivery
    from public.deliveries
    where route_id = v_target_route_bigint
      and bin_id = v_bin_id
    limit 1
    for update;

    if found then
      update public.deliveries
      set
        driver_id = v_target_driver_bigint,
        status = 'assigned',
        original_driver_id = coalesce(original_driver_id, v_source_driver_bigint, v_existing_delivery.driver_id),
        assisting_vehicle_id = coalesce(v_vehicle_bigint, assisting_vehicle_id),
        assistance_reason = 'overflow_reassignment',
        reassigned_at = v_now,
        updated_at = v_now
      where id = v_existing_delivery.id;

      if v_source_route_bigint is not null and v_source_route_bigint <> v_target_route_bigint then
        delete from public.deliveries
        where route_id = v_source_route_bigint
          and bin_id = v_bin_id
          and status::text <> 'completed';
      end if;
    else
      if v_source_route_bigint is not null then
        select id, driver_id into v_existing_delivery
        from public.deliveries
        where route_id = v_source_route_bigint
          and bin_id = v_bin_id
          and status::text <> 'completed'
        limit 1
        for update;
      else
        select id, driver_id into v_existing_delivery
        from public.deliveries
        where bin_id = v_bin_id
          and status::text in ('overflow_uncollected', 'pending', 'assigned')
        order by updated_at desc
        limit 1
        for update;
      end if;

      if found then
        update public.deliveries
        set
          driver_id = v_target_driver_bigint,
          route_id = v_target_route_bigint,
          status = 'assigned',
          original_driver_id = coalesce(original_driver_id, v_existing_delivery.driver_id, v_source_driver_bigint),
          assisting_vehicle_id = coalesce(v_vehicle_bigint, assisting_vehicle_id),
          assistance_reason = 'overflow_reassignment',
          reassigned_at = v_now,
          updated_at = v_now
        where id = v_existing_delivery.id;
      else
        insert into public.deliveries (
          route_id,
          bin_id,
          driver_id,
          status,
          original_driver_id,
          assisting_vehicle_id,
          assistance_reason,
          reassigned_at,
          updated_at
        ) values (
          v_target_route_bigint,
          v_bin_id,
          v_target_driver_bigint,
          'assigned',
          v_source_driver_bigint,
          v_vehicle_bigint,
          'overflow_reassignment',
          v_now,
          v_now
        )
        on conflict (route_id, bin_id) do update
        set
          driver_id = excluded.driver_id,
          status = 'assigned',
          original_driver_id = coalesce(public.deliveries.original_driver_id, excluded.original_driver_id),
          assisting_vehicle_id = coalesce(excluded.assisting_vehicle_id, public.deliveries.assisting_vehicle_id),
          assistance_reason = excluded.assistance_reason,
          reassigned_at = excluded.reassigned_at,
          updated_at = excluded.updated_at;
      end if;
    end if;

    if v_source_route_bigint is not null and v_source_route_bigint <> v_target_route_bigint then
      delete from public.route_stops
      where route_id = v_source_route_bigint
        and bin_id = v_bin_id;
    end if;
  end loop;

  if coalesce(jsonb_array_length(v_bins_json), 0) > 0 and coalesce(array_length(v_bin_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'success', false,
      'error', 'All stops in this overflow event were already completed or assigned to another active truck'
    );
  end if;

  if v_vehicle_bigint is not null then
    update public.vehicles
    set
      route_id = coalesce(nullif(btrim(route_id), ''), v_route_id),
      status = case
        when lower(coalesce(status, '')) in ('available', 'idle', 'active', '') then 'on_route'
        else status
      end,
      updated_at = v_now
    where id = v_vehicle_bigint;
  end if;

  if v_driver.status::text = 'available' then
    update public.drivers
    set
      status = 'on_route',
      updated_at = v_now
    where id = v_target_driver_bigint;
  end if;

  -- Update overflow event status
  update public.overflow_events
  set
    status = 'accepted',
    accepted_at = v_now,
    target_driver_id = v_target_driver_txt,
    target_vehicle_id = coalesce(nullif(btrim(v_vehicle_id_txt), ''), v_event.target_vehicle_id),
    target_route_id = v_target_route_bigint,
    reassignment_metadata = coalesce(reassignment_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'target_route_id', v_target_route_bigint,
        'target_driver_id', v_target_driver_txt,
        'target_vehicle_id', coalesce(nullif(btrim(v_vehicle_id_txt), ''), v_event.target_vehicle_id),
        'accepted_at', v_now
      )
  where id = p_event_id;

  return jsonb_build_object(
    'success', true,
    'ok', true,
    'event_id', p_event_id,
    'target_route_id', v_route_id,
    'route_id', v_route_id,
    'assigned_bin_ids', to_jsonb(v_bin_ids),
    'accepted_at', v_now,
    'bins_transferred', coalesce(array_length(v_bin_ids, 1), 0),
    'bins_skipped', v_skipped_bins
  );
end;
$$;

revoke all on function public.accept_overflow_event(uuid, text, text, text) from public, anon;
grant execute on function public.accept_overflow_event(uuid, text, text, text) to authenticated, service_role, postgres;
