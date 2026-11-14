-- =============================================================================
-- EcoLoop: Dynamic Overflow Reassignment Schema & Transactional RPC Upgrade
-- Adds vehicles.load_percent and overflow_events.reassignment_metadata if missing,
-- and strengthens public.accept_overflow_event with row-level locks, self-assignment
-- rejection, driver/vehicle/account validation, stop conflict prevention, and audit columns.
-- =============================================================================

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS load_percent integer DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.vehicles'::regclass
      AND conname = 'vehicles_load_percent_check'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_load_percent_check
      CHECK (load_percent >= 0 AND load_percent <= 100);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.overflow_events
  ADD COLUMN IF NOT EXISTS reassignment_metadata jsonb DEFAULT '{}'::jsonb;

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

  IF coalesce(current_setting('role', true), '') NOT IN ('service_role', 'postgres') THEN
    IF NOT (
      public.is_admin(auth.uid())
      OR public.is_dispatcher(auth.uid())
      OR public.is_supervisor(auth.uid())
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

  -- 1. Lock overflow event row to prevent concurrent duplicate acceptance
  SELECT * INTO v_event
  FROM public.overflow_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Overflow event not found');
  END IF;

  IF v_event.status = 'accepted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Overflow event has already been accepted');
  END IF;

  IF v_event.status IN ('declined', 'completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Overflow event cannot be accepted in current state: ' || v_event.status);
  END IF;

  -- 2. Prevent self-assignment by driver
  IF v_event.source_driver_id IS NOT NULL AND btrim(v_event.source_driver_id) = v_target_driver_txt THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source driver cannot accept their own overflow event');
  END IF;

  -- 3. Lock target driver row & verify active eligibility
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

  -- 4. Resolve and lock target vehicle row & verify operational status
  v_vehicle_id_txt := coalesce(
    nullif(btrim(p_target_vehicle_id), ''),
    v_driver.assigned_vehicle_id::text,
    nullif(btrim(v_event.target_vehicle_id), '')
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

  -- 5. Resolve or create target route (locking target route row)
  IF v_route_id IS NOT NULL THEN
    SELECT id, status INTO v_candidate_route
    FROM public.routes
    WHERE id::text = v_route_id
      AND driver_id = v_target_driver_bigint
      AND status IN ('active', 'pending', 'planned')
    FOR UPDATE;

    IF NOT FOUND THEN
      v_route_id := NULL;
    ELSIF v_candidate_route.status IN ('pending', 'planned') THEN
      UPDATE public.routes
      SET
        status = 'active',
        started_at = coalesce(started_at, v_now),
        assignment_updated_at = v_now
      WHERE id = v_candidate_route.id;
    END IF;
  END IF;

  IF v_route_id IS NULL THEN
    SELECT id, status INTO v_candidate_route
    FROM public.routes
    WHERE driver_id = v_target_driver_bigint
      AND status IN ('active', 'pending', 'planned')
    ORDER BY CASE WHEN status = 'active' THEN 1 ELSE 2 END, created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      v_route_id := v_candidate_route.id::text;
      IF v_candidate_route.status IN ('pending', 'planned') THEN
        UPDATE public.routes
        SET
          status = 'active',
          started_at = coalesce(started_at, v_now),
          assignment_updated_at = v_now
        WHERE id = v_candidate_route.id;
      END IF;
    ELSE
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
        v_now,
        v_now,
        v_now
      )
      RETURNING id::text INTO v_route_id;
    END IF;
  END IF;

  v_target_route_bigint := v_route_id::bigint;

  -- Get current max stop_order on target route
  SELECT coalesce(max(stop_order), 0) INTO v_max_stop_order
  FROM public.route_stops
  WHERE route_id = v_target_route_bigint;

  -- 6. Lock and transfer stops safely without double-assigning completed or already-reassigned stops
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

    -- Skip if already claimed on a different active route (prevents multi-truck overlap)
    SELECT d.id INTO v_conflict_delivery
    FROM public.deliveries d
    JOIN public.routes r ON r.id = d.route_id
    WHERE d.bin_id = v_bin_id
      AND d.route_id <> v_target_route_bigint
      AND (v_source_route_bigint IS NULL OR d.route_id <> v_source_route_bigint)
      AND (r.status IN ('active', 'pending', 'planned') OR d.status::text IN ('in_progress', 'completed'))
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

  -- 7. Sync assisting vehicle and driver status cleanly
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

  -- 8. Mark overflow event accepted
  UPDATE public.overflow_events
  SET
    status = 'accepted',
    accepted_at = v_now,
    target_driver_id = v_target_driver_txt,
    target_vehicle_id = coalesce(nullif(btrim(v_vehicle_id_txt), ''), v_event.target_vehicle_id)
  WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'target_route_id', v_route_id,
    'bins_transferred', coalesce(array_length(v_bin_ids, 1), 0),
    'bins_skipped', v_skipped_bins
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_overflow_event(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_overflow_event(uuid, text, text, text) TO authenticated, service_role, postgres;
