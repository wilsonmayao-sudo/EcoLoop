-- =============================================================================
-- EcoLoop: Fix Overflow Dispatch Delivery, Driver Isolation, & Navigation Sync
-- 1. Adds overflow_events.target_route_id to link accepted dispatches directly
--    to their dedicated 'Overflow Assistance Route'.
-- 2. Adds SECURITY DEFINER helpers current_driver_id(), current_driver_vehicle_id(),
--    and get_overflow_candidate_fleet() so drivers signaling FULL can discover
--    eligible assisting trucks cleanly without weakening RLS on drivers/events.
-- 3. Tightens public.overflow_events RLS policies so drivers only see/update
--    their own source or target dispatches (strict two-driver isolation).
-- 4. Enables REPLICA IDENTITY FULL and Realtime publication coverage.
-- 5. Upgrades public.accept_overflow_event() to always use a dedicated
--    'Overflow Assistance Route' without overwriting regular collection routes.
-- =============================================================================

BEGIN;

-- 1. Link overflow_events to target_route_id and index target lookups
ALTER TABLE public.overflow_events
  ADD COLUMN IF NOT EXISTS reassignment_metadata jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.overflow_events
  ADD COLUMN IF NOT EXISTS target_route_id bigint REFERENCES public.routes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS overflow_events_target_driver_status_idx
  ON public.overflow_events (target_driver_id, status);

CREATE INDEX IF NOT EXISTS overflow_events_target_vehicle_status_idx
  ON public.overflow_events (target_vehicle_id, status);

-- 2. Helper functions for authenticated driver & effective vehicle lookup
CREATE OR REPLACE FUNCTION public.current_driver_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id
  FROM public.drivers d
  WHERE d.auth_user_id = auth.uid()
  ORDER BY d.id ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_driver_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_driver_id() TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.current_driver_vehicle_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    d.assigned_vehicle_id,
    (
      SELECT r.vehicle_id
      FROM public.routes r
      WHERE r.driver_id = d.id
        AND r.vehicle_id IS NOT NULL
        AND r.status IN ('active'::public.route_status, 'pending'::public.route_status, 'planned'::public.route_status)
      ORDER BY CASE WHEN r.status = 'active'::public.route_status THEN 1 ELSE 2 END, r.created_at DESC
      LIMIT 1
    ),
    (
      SELECT v.id
      FROM public.vehicles v
      WHERE v.driver_id IS NOT NULL
        AND btrim(v.driver_id) = d.id::text
      ORDER BY v.id ASC
      LIMIT 1
    )
  )
  FROM public.drivers d
  WHERE d.auth_user_id = auth.uid()
  ORDER BY d.id ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_driver_vehicle_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_driver_vehicle_id() TO authenticated, service_role, postgres;

-- 3. Scoped candidate fleet RPC for mobile overflow signaling
CREATE OR REPLACE FUNCTION public.get_overflow_candidate_fleet(
  p_exclude_driver_id  bigint DEFAULT NULL,
  p_exclude_vehicle_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_driver_id bigint := public.current_driver_id();
  v_drivers          jsonb := '[]'::jsonb;
  v_vehicles         jsonb := '[]'::jsonb;
  v_routes           jsonb := '[]'::jsonb;
  v_locations        jsonb := '[]'::jsonb;
  v_deliveries       jsonb := '[]'::jsonb;
  v_busy_src_veh     jsonb := '[]'::jsonb;
  v_busy_tgt_veh     jsonb := '[]'::jsonb;
  v_busy_tgt_drv     jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL AND coalesce(current_setting('role', true), '') NOT IN ('service_role', 'postgres') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  IF coalesce(current_setting('role', true), '') NOT IN ('service_role', 'postgres') THEN
    IF NOT (
      public.is_admin(auth.uid())
      OR public.is_dispatcher(auth.uid())
      OR public.is_supervisor(auth.uid())
      OR (
        public.current_profile_is_active()
        AND public.current_app_role() = 'truck_driver'::text
        AND v_caller_driver_id IS NOT NULL
      )
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not authorized to query candidate fleet');
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'name', d.name,
    'status', d.status::text,
    'assigned_vehicle_id', d.assigned_vehicle_id,
    'last_seen_at', d.last_seen_at
  )), '[]'::jsonb)
  INTO v_drivers
  FROM public.drivers d
  WHERE (p_exclude_driver_id IS NULL OR d.id <> p_exclude_driver_id)
    AND d.status::text IN ('available', 'on_route');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id,
    'plate_number', v.plate_number,
    'truck_code', v.truck_code,
    'label', coalesce(nullif(btrim(v.label), ''), nullif(btrim(v.truck_code), ''), v.plate_number),
    'status', v.status,
    'driver_id', v.driver_id,
    'route_id', v.route_id,
    'capacity_liters', v.capacity_liters,
    'capacity_kg', v.capacity_kg,
    'load_percent', v.load_percent,
    'latitude', v.latitude,
    'longitude', v.longitude,
    'last_seen_at', v.last_seen_at,
    'is_active', v.is_active
  )), '[]'::jsonb)
  INTO v_vehicles
  FROM public.vehicles v
  WHERE v.is_active IS NOT FALSE
    AND (p_exclude_vehicle_id IS NULL OR v.id <> p_exclude_vehicle_id)
    AND lower(coalesce(v.status, 'available')) NOT IN ('maintenance', 'inactive', 'offline', 'out_of_service', 'suspended');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'status', r.status::text,
    'driver_id', r.driver_id,
    'vehicle_id', r.vehicle_id,
    'optimization_method', r.optimization_method
  )), '[]'::jsonb)
  INTO v_routes
  FROM public.routes r
  WHERE r.status IN ('active'::public.route_status, 'pending'::public.route_status, 'planned'::public.route_status)
    AND (p_exclude_driver_id IS NULL OR r.driver_id IS DISTINCT FROM p_exclude_driver_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'vehicle_id', vl.vehicle_id,
    'driver_id', vl.driver_id,
    'latitude', vl.latitude,
    'longitude', vl.longitude,
    'updated_at', vl.updated_at
  )), '[]'::jsonb)
  INTO v_locations
  FROM public.vehicle_locations_latest vl;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'route_id', del.route_id,
    'driver_id', del.driver_id,
    'bin_id', del.bin_id,
    'status', del.status::text,
    'bins', CASE WHEN b.id IS NOT NULL THEN jsonb_build_object('latitude', b.latitude, 'longitude', b.longitude) ELSE NULL END
  )), '[]'::jsonb)
  INTO v_deliveries
  FROM public.deliveries del
  LEFT JOIN public.bins b ON b.id = del.bin_id
  WHERE del.status::text <> 'cancelled'
    AND (p_exclude_driver_id IS NULL OR del.driver_id IS DISTINCT FROM p_exclude_driver_id)
    AND (
      del.route_id IN (
        SELECT r2.id
        FROM public.routes r2
        WHERE r2.status IN ('active'::public.route_status, 'pending'::public.route_status, 'planned'::public.route_status)
      )
      OR del.status::text IN ('assigned', 'pending', 'in_progress')
    );

  SELECT coalesce(jsonb_agg(DISTINCT btrim(oe.source_vehicle_id)), '[]'::jsonb)
  INTO v_busy_src_veh
  FROM public.overflow_events oe
  WHERE oe.status IN ('pending', 'dispatched', 'accepted')
    AND nullif(btrim(oe.source_vehicle_id), '') IS NOT NULL;

  SELECT coalesce(jsonb_agg(DISTINCT btrim(oe.target_vehicle_id)), '[]'::jsonb)
  INTO v_busy_tgt_veh
  FROM public.overflow_events oe
  WHERE oe.status IN ('dispatched', 'accepted')
    AND nullif(btrim(oe.target_vehicle_id), '') IS NOT NULL;

  SELECT coalesce(jsonb_agg(DISTINCT btrim(oe.target_driver_id)), '[]'::jsonb)
  INTO v_busy_tgt_drv
  FROM public.overflow_events oe
  WHERE oe.status IN ('dispatched', 'accepted')
    AND nullif(btrim(oe.target_driver_id), '') IS NOT NULL;

  RETURN jsonb_build_object(
    'success', true,
    'drivers', v_drivers,
    'vehicles', v_vehicles,
    'routes', v_routes,
    'locations', v_locations,
    'deliveries', v_deliveries,
    'busy_source_vehicle_ids', v_busy_src_veh,
    'busy_target_vehicle_ids', v_busy_tgt_veh,
    'busy_target_driver_ids', v_busy_tgt_drv
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_overflow_candidate_fleet(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_overflow_candidate_fleet(bigint, bigint) TO authenticated, service_role, postgres;

-- 4. Tighten RLS policies on public.overflow_events (strict two-driver isolation)
DROP POLICY IF EXISTS "Allow read access to all users" ON public.overflow_events;
DROP POLICY IF EXISTS "Drivers and dispatchers can view overflow events" ON public.overflow_events;
DROP POLICY IF EXISTS "Drivers and dispatchers can update overflow events" ON public.overflow_events;
DROP POLICY IF EXISTS "overflow_events_read_authenticated" ON public.overflow_events;
DROP POLICY IF EXISTS "overflow_events_write_authenticated" ON public.overflow_events;
DROP POLICY IF EXISTS "overflow_events_update_authenticated" ON public.overflow_events;
DROP POLICY IF EXISTS "overflow_events_delete_staff" ON public.overflow_events;

CREATE POLICY "overflow_events_read_authenticated" ON public.overflow_events
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_dispatcher(auth.uid())
    OR public.is_supervisor(auth.uid())
    OR (
      public.current_profile_is_active()
      AND public.current_app_role() = 'truck_driver'::text
      AND public.current_driver_id() IS NOT NULL
      AND (
        btrim(coalesce(source_driver_id, '')) = public.current_driver_id()::text
        OR btrim(coalesce(target_driver_id, '')) = public.current_driver_id()::text
        OR (
          public.current_driver_vehicle_id() IS NOT NULL
          AND (
            (
              btrim(coalesce(source_driver_id, '')) = ''
              AND btrim(coalesce(source_vehicle_id, '')) = public.current_driver_vehicle_id()::text
            )
            OR (
              btrim(coalesce(target_driver_id, '')) = ''
              AND btrim(coalesce(target_vehicle_id, '')) = public.current_driver_vehicle_id()::text
            )
          )
        )
      )
    )
  );

CREATE POLICY "overflow_events_write_authenticated" ON public.overflow_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.is_dispatcher(auth.uid())
    OR public.is_supervisor(auth.uid())
    OR (
      public.current_profile_is_active()
      AND public.current_app_role() = 'truck_driver'::text
      AND public.current_driver_id() IS NOT NULL
      AND btrim(coalesce(source_driver_id, '')) = public.current_driver_id()::text
    )
  );

CREATE POLICY "overflow_events_update_authenticated" ON public.overflow_events
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_dispatcher(auth.uid())
    OR public.is_supervisor(auth.uid())
    OR (
      public.current_profile_is_active()
      AND public.current_app_role() = 'truck_driver'::text
      AND public.current_driver_id() IS NOT NULL
      AND (
        btrim(coalesce(source_driver_id, '')) = public.current_driver_id()::text
        OR btrim(coalesce(target_driver_id, '')) = public.current_driver_id()::text
        OR (
          public.current_driver_vehicle_id() IS NOT NULL
          AND btrim(coalesce(target_driver_id, '')) = ''
          AND btrim(coalesce(target_vehicle_id, '')) = public.current_driver_vehicle_id()::text
        )
      )
    )
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.is_dispatcher(auth.uid())
    OR public.is_supervisor(auth.uid())
    OR (
      public.current_profile_is_active()
      AND public.current_app_role() = 'truck_driver'::text
      AND public.current_driver_id() IS NOT NULL
      AND (
        btrim(coalesce(source_driver_id, '')) = public.current_driver_id()::text
        OR btrim(coalesce(target_driver_id, '')) = public.current_driver_id()::text
        OR (
          public.current_driver_vehicle_id() IS NOT NULL
          AND btrim(coalesce(target_driver_id, '')) = ''
          AND btrim(coalesce(target_vehicle_id, '')) = public.current_driver_vehicle_id()::text
        )
      )
    )
  );

CREATE POLICY "overflow_events_delete_staff" ON public.overflow_events
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_dispatcher(auth.uid()));

-- 5. Enable full Realtime payloads & publication coverage for overflow + route sync
ALTER TABLE public.overflow_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.overflow_events;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.routes;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.route_stops;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.deliveries;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
END $$;

-- 6. Upgrade accept_overflow_event RPC so accepted overflow creates/uses a dedicated
--    'Overflow Assistance Route' without overwriting regular collection routes
CREATE OR REPLACE FUNCTION public.accept_overflow_event (
  p_event_id          uuid,
  p_target_driver_id  text,
  p_target_vehicle_id text DEFAULT NULL::text,
  p_target_route_id   text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
  v_vehicle_bigint       bigint := NULL;
  v_route_id             text := nullif(btrim(p_target_route_id), '');
  v_target_route_bigint  bigint;
  v_source_route_bigint  bigint := NULL;
  v_source_driver_bigint bigint := NULL;
  v_profile_status       text := NULL;
  v_is_staff             boolean := false;
  v_bin_id               bigint;
  v_max_stop_order       int := 0;
  v_now                  timestamptz := now();
  v_bin_ids              bigint[] := '{}';
  v_skipped_bins         int := 0;
  v_bins_json            jsonb;
  v_i                    int;
  v_elem                 jsonb;
BEGIN
  IF v_target_driver_txt IS NULL OR v_target_driver_txt !~ '^[0-9]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Valid target driver ID is required to accept overflow');
  END IF;
  v_target_driver_bigint := v_target_driver_txt::bigint;

  IF auth.uid() IS NULL AND coalesce(current_setting('role', true), '') NOT IN ('service_role', 'postgres') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  IF coalesce(current_setting('role', true), '') IN ('service_role', 'postgres') THEN
    v_is_staff := true;
  ELSE
    v_is_staff := (
      public.is_admin(auth.uid())
      OR public.is_dispatcher(auth.uid())
      OR public.is_supervisor(auth.uid())
    );
    IF NOT (
      v_is_staff
      OR (
        public.current_profile_is_active()
        AND public.current_app_role() = 'truck_driver'::text
        AND EXISTS (
          SELECT 1
          FROM public.drivers d
          WHERE d.auth_user_id = auth.uid()
            AND d.id = v_target_driver_bigint
        )
      )
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not authorized to accept this overflow event');
    END IF;
  END IF;

  -- Lock overflow event row to prevent concurrent duplicate acceptance
  SELECT * INTO v_event
  FROM public.overflow_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Overflow event not found');
  END IF;

  IF v_event.status = 'accepted' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Overflow event has already been accepted',
      'target_route_id', CASE WHEN v_event.target_route_id IS NOT NULL THEN v_event.target_route_id::text ELSE NULL END
    );
  END IF;

  IF v_event.status IN ('declined', 'completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Overflow event cannot be accepted in current state: ' || v_event.status);
  END IF;

  IF NOT v_is_staff
     AND nullif(btrim(v_event.target_driver_id), '') IS NOT NULL
     AND btrim(v_event.target_driver_id) <> v_target_driver_txt
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'This overflow dispatch is assigned to a different driver');
  END IF;

  -- Prevent self-assignment by driver
  IF v_event.source_driver_id IS NOT NULL AND btrim(v_event.source_driver_id) = v_target_driver_txt THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source driver cannot accept their own overflow event');
  END IF;

  -- Lock target driver row & verify active eligibility
  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id = v_target_driver_bigint
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target driver not found');
  END IF;

  IF lower(coalesce(v_driver.status::text, '')) IN ('offline', 'inactive', 'suspended', 'full', 'on_break') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target driver is not available (' || coalesce(v_driver.status::text, 'unknown') || ')');
  END IF;

  SELECT up.status::text INTO v_profile_status
  FROM public.user_profiles up
  WHERE (v_driver.profile_id IS NOT NULL AND up.id = v_driver.profile_id)
     OR up.id = v_driver.auth_user_id
  LIMIT 1;

  IF v_profile_status IS NOT NULL AND lower(v_profile_status) IN ('suspended', 'inactive') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target driver account is ' || v_profile_status);
  END IF;

  -- Resolve effective vehicle (checking assigned_vehicle_id, p_target_vehicle_id, event.target_vehicle_id, open route, or vehicles.driver_id)
  v_vehicle_id_txt := coalesce(
    nullif(btrim(p_target_vehicle_id), ''),
    v_driver.assigned_vehicle_id::text,
    nullif(btrim(v_event.target_vehicle_id), ''),
    (
      SELECT r.vehicle_id::text
      FROM public.routes r
      WHERE r.driver_id = v_target_driver_bigint
        AND r.vehicle_id IS NOT NULL
        AND r.status IN ('active'::public.route_status, 'pending'::public.route_status, 'planned'::public.route_status)
      ORDER BY CASE WHEN r.status = 'active'::public.route_status THEN 1 ELSE 2 END, r.created_at DESC
      LIMIT 1
    ),
    (
      SELECT v.id::text
      FROM public.vehicles v
      WHERE v.driver_id IS NOT NULL
        AND btrim(v.driver_id) = v_target_driver_txt
      ORDER BY v.id ASC
      LIMIT 1
    )
  );

  IF v_vehicle_id_txt IS NOT NULL AND v_event.source_vehicle_id IS NOT NULL AND btrim(v_event.source_vehicle_id) = btrim(v_vehicle_id_txt) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source vehicle cannot accept its own overflow event');
  END IF;

  IF v_vehicle_id_txt IS NOT NULL AND btrim(v_vehicle_id_txt) ~ '^[0-9]+$' THEN
    v_vehicle_bigint := btrim(v_vehicle_id_txt)::bigint;

    SELECT * INTO v_vehicle
    FROM public.vehicles
    WHERE id = v_vehicle_bigint
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Target vehicle not found');
    END IF;

    IF v_vehicle.is_active IS FALSE THEN
      RETURN jsonb_build_object('success', false, 'error', 'Target vehicle is inactive');
    END IF;

    IF lower(coalesce(v_vehicle.status, '')) IN (
      'full', 'maintenance', 'inactive', 'offline', 'unloading',
      'assisting_overflow', 'out_of_service', 'suspended'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Target vehicle is unavailable (' || v_vehicle.status || ')');
    END IF;
  END IF;

  IF v_event.source_route_id IS NOT NULL AND btrim(v_event.source_route_id) ~ '^[0-9]+$' THEN
    v_source_route_bigint := btrim(v_event.source_route_id)::bigint;
  END IF;

  IF v_event.source_driver_id IS NOT NULL AND btrim(v_event.source_driver_id) ~ '^[0-9]+$' THEN
    v_source_driver_bigint := btrim(v_event.source_driver_id)::bigint;
  END IF;

  -- Dedicated Overflow Assistance Route Rule:
  -- Only reuse an explicit route if it belongs to target driver, is open, AND is already an Overflow Assistance Route.
  -- Never overwrite, discard, or append onto the back of a driver's regular collection route.
  IF v_route_id IS NOT NULL THEN
    SELECT id, status INTO v_candidate_route
    FROM public.routes
    WHERE id::text = v_route_id
      AND driver_id = v_target_driver_bigint
      AND status IN ('active'::public.route_status, 'pending'::public.route_status, 'planned'::public.route_status)
      AND (
        coalesce(optimization_method, '') IN ('overflow_reassignment', 'dynamic-reassignment+mapbox')
        OR lower(coalesce(name, '')) LIKE '%overflow%'
      )
    FOR UPDATE;

    IF NOT FOUND THEN
      v_route_id := NULL;
    ELSIF v_candidate_route.status IN ('pending'::public.route_status, 'planned'::public.route_status) THEN
      UPDATE public.routes
      SET
        status = 'active',
        started_at = coalesce(started_at, v_now),
        assignment_updated_at = v_now
      WHERE id = v_candidate_route.id;
    END IF;
  END IF;

  IF v_route_id IS NULL THEN
    IF v_source_route_bigint IS NOT NULL THEN
      SELECT area_code, scheduled_days, shift_label, waste_category, center_lat, center_lng
      INTO v_source_route
      FROM public.routes
      WHERE id = v_source_route_bigint;
    END IF;

    INSERT INTO public.routes (
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
    ) VALUES (
      'Overflow Assistance Route',
      'active',
      CASE WHEN v_source_route_bigint IS NOT NULL THEN v_source_route.area_code ELSE NULL END,
      CASE WHEN v_source_route_bigint IS NOT NULL THEN v_source_route.scheduled_days ELSE NULL END,
      CASE WHEN v_source_route_bigint IS NOT NULL THEN v_source_route.shift_label ELSE NULL END,
      CASE WHEN v_source_route_bigint IS NOT NULL THEN v_source_route.waste_category ELSE NULL END,
      CASE WHEN v_source_route_bigint IS NOT NULL THEN v_source_route.center_lat ELSE NULL END,
      CASE WHEN v_source_route_bigint IS NOT NULL THEN v_source_route.center_lng ELSE NULL END,
      v_target_driver_bigint,
      v_vehicle_bigint,
      'overflow_reassignment',
      v_now,
      v_now,
      v_now
    )
    RETURNING id::text INTO v_route_id;
  END IF;

  v_target_route_bigint := v_route_id::bigint;

  -- Preserve exact stop order computed by the Dynamic Reassignment Engine
  SELECT coalesce(max(stop_order), 0) INTO v_max_stop_order
  FROM public.route_stops
  WHERE route_id = v_target_route_bigint;

  v_bins_json := coalesce(v_event.overflow_bins, '[]'::jsonb);
  FOR v_i IN 0 .. coalesce(jsonb_array_length(v_bins_json), 0) - 1 LOOP
    v_elem := v_bins_json->v_i;
    IF (v_elem ? 'bin_id') AND coalesce(btrim(v_elem->>'bin_id'), '') ~ '^[0-9]+$' THEN
      v_bin_id := btrim(v_elem->>'bin_id')::bigint;
    ELSE
      CONTINUE;
    END IF;

    -- Skip if already completed on source route
    IF v_source_route_bigint IS NOT NULL THEN
      SELECT id INTO v_conflict_delivery
      FROM public.deliveries
      WHERE route_id = v_source_route_bigint
        AND bin_id = v_bin_id
        AND status::text = 'completed'
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        v_skipped_bins := v_skipped_bins + 1;
        CONTINUE;
      END IF;
    END IF;

    -- Skip if already claimed on a different active/open route (prevents multi-truck overlap)
    SELECT d.id INTO v_conflict_delivery
    FROM public.deliveries d
    JOIN public.routes r ON r.id = d.route_id
    WHERE d.bin_id = v_bin_id
      AND d.route_id <> v_target_route_bigint
      AND (v_source_route_bigint IS NULL OR d.route_id <> v_source_route_bigint)
      AND (
        r.status IN ('active'::public.route_status, 'pending'::public.route_status, 'planned'::public.route_status)
        OR d.status::text IN ('in_progress', 'completed')
      )
    LIMIT 1
    FOR UPDATE OF d;

    IF FOUND THEN
      v_skipped_bins := v_skipped_bins + 1;
      CONTINUE;
    END IF;

    v_bin_ids := array_append(v_bin_ids, v_bin_id);

    IF NOT EXISTS (
      SELECT 1
      FROM public.route_stops
      WHERE route_id = v_target_route_bigint
        AND bin_id = v_bin_id
    ) THEN
      v_max_stop_order := v_max_stop_order + 1;
      INSERT INTO public.route_stops (route_id, bin_id, stop_order)
      VALUES (v_target_route_bigint, v_bin_id, v_max_stop_order)
      ON CONFLICT DO NOTHING;
    END IF;

    SELECT id, driver_id INTO v_existing_delivery
    FROM public.deliveries
    WHERE route_id = v_target_route_bigint
      AND bin_id = v_bin_id
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.deliveries
      SET
        driver_id = v_target_driver_bigint,
        status = 'assigned',
        original_driver_id = coalesce(original_driver_id, v_source_driver_bigint, v_existing_delivery.driver_id),
        assisting_vehicle_id = coalesce(v_vehicle_bigint, assisting_vehicle_id),
        assistance_reason = 'overflow_reassignment',
        reassigned_at = v_now,
        updated_at = v_now
      WHERE id = v_existing_delivery.id;

      IF v_source_route_bigint IS NOT NULL AND v_source_route_bigint <> v_target_route_bigint THEN
        DELETE FROM public.deliveries
        WHERE route_id = v_source_route_bigint
          AND bin_id = v_bin_id
          AND status::text <> 'completed';
      END IF;
    ELSE
      IF v_source_route_bigint IS NOT NULL THEN
        SELECT id, driver_id INTO v_existing_delivery
        FROM public.deliveries
        WHERE route_id = v_source_route_bigint
          AND bin_id = v_bin_id
          AND status::text <> 'completed'
        LIMIT 1
        FOR UPDATE;
      ELSE
        SELECT id, driver_id INTO v_existing_delivery
        FROM public.deliveries
        WHERE bin_id = v_bin_id
          AND status::text IN ('overflow_uncollected', 'pending', 'assigned')
        ORDER BY updated_at DESC
        LIMIT 1
        FOR UPDATE;
      END IF;

      IF FOUND THEN
        UPDATE public.deliveries
        SET
          driver_id = v_target_driver_bigint,
          route_id = v_target_route_bigint,
          status = 'assigned',
          original_driver_id = coalesce(original_driver_id, v_existing_delivery.driver_id, v_source_driver_bigint),
          assisting_vehicle_id = coalesce(v_vehicle_bigint, assisting_vehicle_id),
          assistance_reason = 'overflow_reassignment',
          reassigned_at = v_now,
          updated_at = v_now
        WHERE id = v_existing_delivery.id;
      ELSE
        INSERT INTO public.deliveries (
          route_id,
          bin_id,
          driver_id,
          status,
          original_driver_id,
          assisting_vehicle_id,
          assistance_reason,
          reassigned_at,
          updated_at
        ) VALUES (
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
        ON CONFLICT (route_id, bin_id) DO UPDATE
        SET
          driver_id = excluded.driver_id,
          status = 'assigned',
          original_driver_id = coalesce(public.deliveries.original_driver_id, excluded.original_driver_id),
          assisting_vehicle_id = coalesce(excluded.assisting_vehicle_id, public.deliveries.assisting_vehicle_id),
          assistance_reason = excluded.assistance_reason,
          reassigned_at = excluded.reassigned_at,
          updated_at = excluded.updated_at;
      END IF;
    END IF;

    IF v_source_route_bigint IS NOT NULL AND v_source_route_bigint <> v_target_route_bigint THEN
      DELETE FROM public.route_stops
      WHERE route_id = v_source_route_bigint
        AND bin_id = v_bin_id;
    END IF;
  END LOOP;

  IF coalesce(jsonb_array_length(v_bins_json), 0) > 0 AND coalesce(array_length(v_bin_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'All stops in this overflow event were already completed or assigned to another active truck'
    );
  END IF;

  IF v_vehicle_bigint IS NOT NULL THEN
    UPDATE public.vehicles
    SET
      route_id = coalesce(nullif(btrim(route_id), ''), v_route_id),
      status = CASE
        WHEN lower(coalesce(status, '')) IN ('available', 'idle', 'active', '') THEN 'on_route'
        ELSE status
      END,
      updated_at = v_now
    WHERE id = v_vehicle_bigint;
  END IF;

  IF v_driver.status::text = 'available' THEN
    UPDATE public.drivers
    SET
      status = 'on_route',
      updated_at = v_now
    WHERE id = v_target_driver_bigint;
  END IF;

  UPDATE public.overflow_events
  SET
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
  WHERE id = p_event_id;

  RETURN jsonb_build_object(
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
END;
$$;

REVOKE ALL ON FUNCTION public.accept_overflow_event(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_overflow_event(uuid, text, text, text) TO authenticated, service_role, postgres;

COMMIT;
