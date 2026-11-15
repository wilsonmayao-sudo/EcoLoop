-- =============================================================================
-- EcoLoop: Atomic Route Creation & Duplicate Assignment Protection
-- Non-destructive migration: preserves existing routes, IDs, constraints & RLS
-- =============================================================================

BEGIN;

-- 1. Add nullable idempotency key to public.routes so timed-out/retried clicks
--    can safely recover or deduplicate without creating duplicate rows.
ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS request_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_routes_request_key_unique
  ON public.routes USING btree (request_key)
  WHERE (request_key IS NOT NULL);

-- Speeds up conflict checks for active/pending routes by area code & driver
CREATE INDEX IF NOT EXISTS idx_routes_open_area_status
  ON public.routes USING btree (upper(btrim(area_code)), status)
  WHERE (area_code IS NOT NULL AND status IN ('pending', 'planned', 'active'));

-- 2. Atomic route + stops + deliveries + vehicle + notification creation RPC.
--    Uses SECURITY INVOKER so existing RLS policies are preserved and enforced.
CREATE OR REPLACE FUNCTION public.create_route_assignment (
  p_request_key          text,
  p_name                 text,
  p_status               public.route_status DEFAULT 'pending'::public.route_status,
  p_area_code            text DEFAULT NULL::text,
  p_scheduled_days       text[] DEFAULT NULL::text[],
  p_shift_label          text DEFAULT NULL::text,
  p_waste_category       text DEFAULT NULL::text,
  p_distance_km          numeric DEFAULT 0,
  p_duration_minutes     integer DEFAULT 1,
  p_driver_id            bigint DEFAULT NULL::bigint,
  p_vehicle_id           bigint DEFAULT NULL::bigint,
  p_center_lat           double precision DEFAULT NULL::double precision,
  p_center_lng           double precision DEFAULT NULL::double precision,
  p_optimization_method  text DEFAULT 'mapbox-directions'::text,
  p_cost_source          text DEFAULT 'mapbox-directions'::text,
  p_used_mapbox_traffic  boolean DEFAULT false,
  p_bin_ids              bigint[] DEFAULT '{}'::bigint[]
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public
AS $function$
DECLARE
  v_request_key       text := nullif(btrim(p_request_key), '');
  v_name              text := nullif(btrim(p_name), '');
  v_area_code         text := upper(nullif(btrim(p_area_code), ''));
  v_shift_label       text := nullif(btrim(p_shift_label), '');
  v_waste_category    text := nullif(btrim(p_waste_category), '');
  v_days              text[] := coalesce(p_scheduled_days, '{}'::text[]);
  v_now               timestamptz := timezone('utc'::text, now());
  v_driver            record;
  v_vehicle_id        bigint := p_vehicle_id;
  v_conflict          record;
  v_existing          record;
  v_existing_day_tag  text;
  v_route_id          bigint;
  v_stop_count        int := 0;
  v_clean_bin_ids     bigint[];
BEGIN
  -- 1. Validate required inputs
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_INPUT', 'message', 'Route name is required.');
  END IF;

  IF p_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_INPUT', 'message', 'Please select a valid driver.');
  END IF;

  -- Preserve stop_order strictly matching caller-supplied ordered bin array
  SELECT array_agg(b ORDER BY ord)
  INTO v_clean_bin_ids
  FROM (
    SELECT DISTINCT ON (b) b, ord
    FROM unnest(coalesce(p_bin_ids, '{}'::bigint[])) WITH ORDINALITY AS t(b, ord)
    WHERE b IS NOT NULL
    ORDER BY b, ord
  ) dedup;

  IF coalesce(array_length(v_clean_bin_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_INPUT', 'message', 'Select at least one valid bin stop for this route.');
  END IF;

  -- Verify driver exists and resolve vehicle id deterministically
  SELECT id, name, auth_user_id, assigned_vehicle_id
  INTO v_driver
  FROM public.drivers
  WHERE id = p_driver_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_DRIVER', 'message', 'Selected driver was not found.');
  END IF;

  IF v_vehicle_id IS NULL THEN
    v_vehicle_id := v_driver.assigned_vehicle_id;
  END IF;

  IF v_vehicle_id IS NULL THEN
    SELECT id INTO v_vehicle_id
    FROM public.vehicles
    WHERE driver_id = p_driver_id::text
    ORDER BY id ASC
    LIMIT 1;
  END IF;

  -- 2. Acquire deterministic advisory transaction locks to prevent concurrent duplicates & deadlocks
  IF v_request_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('route_req:' || v_request_key));
  END IF;
  IF v_area_code IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('route_area:' || v_area_code));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext('route_name:' || lower(v_name)));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('route_driver:' || p_driver_id::text));
  IF v_vehicle_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('route_vehicle:' || v_vehicle_id::text));
  END IF;

  -- 3. Idempotency check by request_key
  IF v_request_key IS NOT NULL THEN
    SELECT id, name, status, vehicle_id
    INTO v_existing
    FROM public.routes
    WHERE request_key = v_request_key
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'route_id', v_existing.id,
        'route_name', v_existing.name,
        'status', v_existing.status,
        'vehicle_id', v_existing.vehicle_id,
        'message', 'Route assignment was already saved for this request.'
      );
    END IF;
  END IF;

  -- 4. Duplicate collection area / schedule check over open routes
  IF v_area_code IS NOT NULL THEN
    FOR v_conflict IN
      SELECT r.id, r.name, r.status, r.driver_id, r.scheduled_days, r.shift_label, d.name AS driver_name
      FROM public.routes r
      LEFT JOIN public.drivers d ON d.id = r.driver_id
      WHERE upper(btrim(r.area_code)) = v_area_code
        AND r.status IN ('pending', 'planned', 'active')
      ORDER BY r.created_at DESC
    LOOP
      -- Different explicit shift => legitimate separate schedule
      IF v_shift_label IS NOT NULL
         AND nullif(btrim(v_conflict.shift_label), '') IS NOT NULL
         AND lower(btrim(v_conflict.shift_label)) <> lower(v_shift_label) THEN
        CONTINUE;
      END IF;

      -- Disjoint explicit scheduled_days => legitimate separate schedule
      IF coalesce(array_length(v_days, 1), 0) > 0
         AND coalesce(array_length(v_conflict.scheduled_days, 1), 0) > 0
         AND NOT (v_conflict.scheduled_days && v_days) THEN
        CONTINUE;
      END IF;

      -- Handle legacy 7-day rows whose name carries an explicit day tag like "(Fri)"
      -- when scheduling a single distinct future day like ["Sat"]
      IF coalesce(array_length(v_conflict.scheduled_days, 1), 0) = 7
         AND coalesce(array_length(v_days, 1), 0) = 1 THEN
        v_existing_day_tag := (regexp_match(v_conflict.name, '\((Mon|Tue|Wed|Thu|Fri|Sat|Sun)\)'))[1];
        IF v_existing_day_tag IS NOT NULL AND v_existing_day_tag <> v_days[1] THEN
          CONTINUE;
        END IF;
      END IF;

      RETURN jsonb_build_object(
        'success', false,
        'conflict', true,
        'code', 'AREA_CONFLICT',
        'existing_route_id', v_conflict.id,
        'existing_route_name', v_conflict.name,
        'existing_status', v_conflict.status,
        'message', format(
          'Collection area %s already has an active/pending route (#%s: %s%s) for this schedule.',
          v_area_code,
          v_conflict.id,
          v_conflict.name,
          CASE WHEN v_conflict.driver_name IS NOT NULL THEN ' • Driver: ' || v_conflict.driver_name ELSE '' END
        )
      );
    END LOOP;
  ELSE
    -- Custom route without area_code: block exact duplicate active/pending route name
    SELECT r.id, r.name, r.status
    INTO v_conflict
    FROM public.routes r
    WHERE lower(btrim(r.name)) = lower(v_name)
      AND r.status IN ('pending', 'planned', 'active')
    ORDER BY r.created_at DESC
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'conflict', true,
        'code', 'DUPLICATE_ROUTE_NAME',
        'existing_route_id', v_conflict.id,
        'existing_route_name', v_conflict.name,
        'existing_status', v_conflict.status,
        'message', format('An active/pending route named "%s" (#%s) already exists.', v_conflict.name, v_conflict.id)
      );
    END IF;
  END IF;

  -- 5. Conflicting active/pending assignment check for driver
  FOR v_conflict IN
    SELECT r.id, r.name, r.status, r.scheduled_days, r.shift_label
    FROM public.routes r
    WHERE r.driver_id = p_driver_id
      AND r.status IN ('pending', 'planned', 'active')
    ORDER BY r.created_at DESC
  LOOP
    -- Allow scheduling a non-overlapping future day only when the existing route is pending/planned (not actively on road)
    IF v_conflict.status <> 'active'
       AND coalesce(array_length(v_days, 1), 0) > 0
       AND coalesce(array_length(v_conflict.scheduled_days, 1), 0) > 0
       AND NOT (v_conflict.scheduled_days && v_days) THEN
      CONTINUE;
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'conflict', true,
      'code', 'DRIVER_CONFLICT',
      'existing_route_id', v_conflict.id,
      'existing_route_name', v_conflict.name,
      'existing_status', v_conflict.status,
      'message', format(
        'Driver %s already has a %s route (#%s: %s). Complete, cancel, or reassign that route before creating another.',
        v_driver.name,
        v_conflict.status,
        v_conflict.id,
        v_conflict.name
      )
    );
  END LOOP;

  -- 6. Conflicting active/pending assignment check for vehicle
  IF v_vehicle_id IS NOT NULL THEN
    FOR v_conflict IN
      SELECT r.id, r.name, r.status, r.scheduled_days, COALESCE(v.label, v.truck_code, v.plate_number, '#' || v.id::text) AS vehicle_label
      FROM public.routes r
      JOIN public.vehicles v ON v.id = v_vehicle_id
      WHERE r.vehicle_id = v_vehicle_id
        AND r.status IN ('pending', 'planned', 'active')
      ORDER BY r.created_at DESC
    LOOP
      IF v_conflict.status <> 'active'
         AND coalesce(array_length(v_days, 1), 0) > 0
         AND coalesce(array_length(v_conflict.scheduled_days, 1), 0) > 0
         AND NOT (v_conflict.scheduled_days && v_days) THEN
        CONTINUE;
      END IF;

      RETURN jsonb_build_object(
        'success', false,
        'conflict', true,
        'code', 'VEHICLE_CONFLICT',
        'existing_route_id', v_conflict.id,
        'existing_route_name', v_conflict.name,
        'existing_status', v_conflict.status,
        'message', format(
          'Truck %s already has a %s route (#%s: %s).',
          v_conflict.vehicle_label,
          v_conflict.status,
          v_conflict.id,
          v_conflict.name
        )
      );
    END LOOP;
  END IF;

  -- 7. Atomic write across routes, vehicles, route_stops, deliveries, and notifications
  INSERT INTO public.routes (
    request_key,
    name,
    status,
    area_code,
    scheduled_days,
    shift_label,
    waste_category,
    distance_km,
    duration_minutes,
    driver_id,
    vehicle_id,
    generated_by,
    center_lat,
    center_lng,
    generated_at,
    assignment_updated_at,
    optimization_method,
    cost_source,
    used_mapbox_traffic
  ) VALUES (
    v_request_key,
    v_name,
    coalesce(p_status, 'pending'::public.route_status),
    v_area_code,
    CASE WHEN coalesce(array_length(v_days, 1), 0) > 0 THEN v_days ELSE NULL END,
    v_shift_label,
    v_waste_category,
    coalesce(p_distance_km, 0),
    greatest(1, coalesce(p_duration_minutes, 1)),
    p_driver_id,
    v_vehicle_id,
    auth.uid(),
    p_center_lat,
    p_center_lng,
    v_now,
    v_now,
    coalesce(nullif(btrim(p_optimization_method), ''), 'mapbox-directions'),
    coalesce(nullif(btrim(p_cost_source), ''), 'mapbox-directions'),
    coalesce(p_used_mapbox_traffic, false)
  )
  RETURNING id INTO v_route_id;

  IF v_vehicle_id IS NOT NULL THEN
    UPDATE public.vehicles
    SET route_id = NULL
    WHERE route_id = v_route_id::text AND id <> v_vehicle_id;

    UPDATE public.vehicles
    SET route_id = v_route_id::text,
        driver_id = p_driver_id::text
    WHERE id = v_vehicle_id;
  END IF;

  INSERT INTO public.route_stops (route_id, bin_id, stop_order)
  SELECT v_route_id, u.bin_id, u.stop_order::integer
  FROM unnest(v_clean_bin_ids) WITH ORDINALITY AS u(bin_id, stop_order);

  GET DIAGNOSTICS v_stop_count = ROW_COUNT;

  INSERT INTO public.deliveries (route_id, bin_id, driver_id, status, eta)
  SELECT v_route_id, b_id, p_driver_id, 'assigned'::public.delivery_status, NULL
  FROM unnest(v_clean_bin_ids) AS b_id;

  IF v_driver.auth_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_auth_id,
      user_id,
      role,
      title,
      message,
      type,
      category,
      route_id,
      source_table,
      source_id,
      read,
      created_at
    )
    SELECT
      v_driver.auth_user_id,
      v_driver.auth_user_id,
      'truck_driver',
      'New route assigned',
      format(
        'Route "%s" has %s stop%s (Pending). Open EcoLoop to accept it when ready.',
        v_name,
        v_stop_count,
        CASE WHEN v_stop_count = 1 THEN '' ELSE 's' END
      ),
      'info'::public.notification_type,
      'route'::public.notification_category,
      v_route_id,
      'routes',
      v_route_id::text,
      false,
      v_now
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.source_table = 'routes'
        AND n.source_id = v_route_id::text
        AND n.user_auth_id = v_driver.auth_user_id
        AND n.read = false
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'route_id', v_route_id,
    'route_name', v_name,
    'status', coalesce(p_status, 'pending'::public.route_status),
    'vehicle_id', v_vehicle_id,
    'stops_inserted', v_stop_count,
    'driver_auth_user_id', v_driver.auth_user_id
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_request_key IS NOT NULL THEN
      SELECT id, name, status, vehicle_id
      INTO v_existing
      FROM public.routes
      WHERE request_key = v_request_key
      LIMIT 1;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'success', true,
          'idempotent', true,
          'route_id', v_existing.id,
          'route_name', v_existing.name,
          'status', v_existing.status,
          'vehicle_id', v_existing.vehicle_id,
          'message', 'Route assignment was already saved for this request.'
        );
      END IF;
    END IF;
    RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_route_assignment(
  text, text, public.route_status, text, text[], text, text, numeric, integer,
  bigint, bigint, double precision, double precision, text, text, boolean, bigint[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_route_assignment(
  text, text, public.route_status, text, text[], text, text, numeric, integer,
  bigint, bigint, double precision, double precision, text, text, boolean, bigint[]
) TO authenticated, service_role, postgres;

COMMIT;
