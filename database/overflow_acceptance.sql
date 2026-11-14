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
  v_event record;
  v_route_id text := p_target_route_id;
  v_bin_id bigint;
  v_max_stop_order int := 0;
  v_now timestamptz := now();
  v_bin_ids bigint[] := '{}';
  v_bins_json jsonb;
  v_i int;
  v_elem jsonb;
  v_candidate_route record;
begin
  if p_target_driver_id is null or btrim(p_target_driver_id) = '' then
    return jsonb_build_object('success', false, 'error', 'Target driver is required to accept overflow');
  end if;

  if auth.uid() is null and coalesce(current_setting('role', true), '') not in ('service_role', 'postgres') then
    return jsonb_build_object('success', false, 'error', 'Authentication required');
  end if;

  if coalesce(current_setting('role', true), '') not in ('service_role', 'postgres') then
    if not (
      public.is_admin(auth.uid())
      or public.is_dispatcher(auth.uid())
      or public.is_supervisor(auth.uid())
      or (
        public.current_profile_is_active()
        and public.current_app_role() = 'truck_driver'::text
        and exists (
          select 1
          from public.drivers d
          where d.auth_user_id = auth.uid()
            and d.id::text = p_target_driver_id
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
    return jsonb_build_object('success', false, 'error', 'Overflow event has already been accepted');
  end if;

  if v_event.status in ('declined', 'completed') then
    return jsonb_build_object('success', false, 'error', 'Overflow event cannot be accepted in current state: ' || v_event.status);
  end if;

  -- Validate provided target route is open and belongs to target driver
  if v_route_id is not null and btrim(v_route_id) <> '' then
    select id, status into v_candidate_route
    from public.routes
    where id::text = btrim(v_route_id)
      and driver_id::text = p_target_driver_id
      and status in ('active', 'pending', 'planned');

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

  -- Resolve target route if not provided or not open
  if v_route_id is null or btrim(v_route_id) = '' then
    select id, status into v_candidate_route
    from public.routes
    where driver_id::text = p_target_driver_id
      and status in ('active', 'pending', 'planned')
    order by case when status = 'active' then 1 else 2 end, created_at desc
    limit 1;

    if found then
      v_route_id := v_candidate_route.id::text;
      if v_candidate_route.status in ('pending', 'planned') then
        update public.routes
        set
          status = 'active',
          started_at = coalesce(started_at, v_now),
          assignment_updated_at = v_now
        where id = v_candidate_route.id;
      end if;
    else
      insert into public.routes (
        name,
        status,
        driver_id,
        vehicle_id,
        generated_at,
        assignment_updated_at,
        started_at
      ) values (
        'Overflow Assistance Route',
        'active',
        p_target_driver_id::bigint,
        nullif(p_target_vehicle_id, '')::bigint,
        v_now,
        v_now,
        v_now
      )
      returning id::text into v_route_id;
    end if;
  end if;

  -- Get current max stop_order on target route
  select coalesce(max(stop_order), 0) into v_max_stop_order
  from public.route_stops
  where route_id::text = v_route_id;

  -- Reassign deliveries and insert route stops
  v_bins_json := coalesce(v_event.overflow_bins, '[]'::jsonb);
  for v_i in 0 .. jsonb_array_length(v_bins_json) - 1 loop
    v_elem := v_bins_json->v_i;
    v_bin_id := (v_elem->>'bin_id')::bigint;

    if v_bin_id is not null then
      v_bin_ids := array_append(v_bin_ids, v_bin_id);

      -- Add stop to target route if not already present
      if not exists (
        select 1
        from public.route_stops
        where route_id = v_route_id::bigint
          and bin_id = v_bin_id
      ) then
        v_max_stop_order := v_max_stop_order + 1;
        insert into public.route_stops (route_id, bin_id, stop_order)
        values (v_route_id::bigint, v_bin_id, v_max_stop_order)
        on conflict do nothing;
      end if;

      -- Reassign delivery record safely without violating (route_id, bin_id) uniqueness
      if exists (
        select 1
        from public.deliveries
        where route_id = v_route_id::bigint
          and bin_id = v_bin_id
      ) then
        update public.deliveries
        set
          driver_id = p_target_driver_id::bigint,
          status = 'assigned',
          updated_at = v_now
        where route_id = v_route_id::bigint
          and bin_id = v_bin_id;

        if v_event.source_route_id is not null and btrim(v_event.source_route_id) <> '' and v_event.source_route_id <> v_route_id then
          delete from public.deliveries
          where route_id::text = v_event.source_route_id
            and bin_id = v_bin_id;
        end if;
      else
        update public.deliveries
        set
          driver_id = p_target_driver_id::bigint,
          route_id = v_route_id::bigint,
          status = 'assigned',
          updated_at = v_now
        where bin_id = v_bin_id
          and (
            (v_event.source_route_id is not null and v_event.source_route_id <> '' and route_id::text = v_event.source_route_id)
            or ((v_event.source_route_id is null or v_event.source_route_id = '') and status::text in ('overflow_uncollected', 'pending', 'assigned'))
          );

        if not found then
          insert into public.deliveries (
            route_id,
            bin_id,
            driver_id,
            status,
            updated_at
          ) values (
            v_route_id::bigint,
            v_bin_id,
            p_target_driver_id::bigint,
            'assigned',
            v_now
          )
          on conflict (route_id, bin_id) do update
          set
            driver_id = excluded.driver_id,
            status = 'assigned',
            updated_at = excluded.updated_at;
        end if;
      end if;

      -- Remove from source route stops so source truck queue is cleared
      if v_event.source_route_id is not null and v_event.source_route_id <> v_route_id then
        delete from public.route_stops
        where route_id::text = v_event.source_route_id
          and bin_id = v_bin_id;
      end if;
    end if;
  end loop;

  -- Update overflow event status
  update public.overflow_events
  set
    status = 'accepted',
    accepted_at = v_now,
    target_driver_id = p_target_driver_id,
    target_vehicle_id = coalesce(nullif(p_target_vehicle_id, ''), v_event.target_vehicle_id)
  where id = p_event_id;

  return jsonb_build_object(
    'success', true,
    'target_route_id', v_route_id,
    'bins_transferred', coalesce(array_length(v_bin_ids, 1), 0)
  );
end;
$$;

revoke all on function public.accept_overflow_event(uuid, text, text, text) from public, anon;
grant execute on function public.accept_overflow_event(uuid, text, text, text) to authenticated, service_role;
