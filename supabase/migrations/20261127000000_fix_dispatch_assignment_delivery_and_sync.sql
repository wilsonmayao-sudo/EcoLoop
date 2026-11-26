-- =============================================================================
-- EcoLoop: Fix Dispatch Assignment Delivery, Driver Isolation, & Synchronization
-- 1. Adds missing lifecycle & identity columns to public.overflow_events
--    (dispatched_at, driver_notified_at, declined_at, updated_at,
--     target_driver_auth_user_id, source_driver_auth_user_id) + safe backfill.
-- 2. Fixes public.notifications RLS policies so targeted user notifications are
--    isolated strictly to the intended recipient (no cross-driver role leak).
-- 3. Tightens public.overflow_events RLS policies using auth_user_id + driver_id.
-- 4. Adds atomic SECURITY DEFINER RPCs:
--      - public.dispatch_overflow_event(...)
--      - public.create_overflow_dispatch(...)
--      - public.decline_overflow_event(...)
--    and upgrades public.accept_overflow_event(...) to fix user_profiles lookup,
--    allow offline->on_route self-acceptance, persist target_driver_auth_user_id,
--    mark driver notification read, and deduplicate dispatcher notifications.
-- 5. Ensures REPLICA IDENTITY FULL and supabase_realtime publication coverage.
-- =============================================================================

BEGIN;

-- 1. Extend public.overflow_events non-destructively
ALTER TABLE public.overflow_events
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS driver_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS target_driver_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_driver_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.overflow_events'::regclass
      AND conname = 'overflow_events_status_check'
  ) THEN
    ALTER TABLE public.overflow_events DROP CONSTRAINT overflow_events_status_check;
  END IF;

  ALTER TABLE public.overflow_events
    ADD CONSTRAINT overflow_events_status_check
    CHECK (status = ANY (ARRAY['pending'::text, 'dispatched'::text, 'accepted'::text, 'declined'::text, 'completed'::text, 'cancelled'::text]));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP TRIGGER IF EXISTS touch_overflow_events_updated_at ON public.overflow_events;
CREATE TRIGGER touch_overflow_events_updated_at
  BEFORE UPDATE ON public.overflow_events
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- Backfill driver auth_user_id links and dispatched_at safely for existing rows
UPDATE public.overflow_events oe
SET target_driver_auth_user_id = d.auth_user_id
FROM public.drivers d
WHERE oe.target_driver_auth_user_id IS NULL
  AND nullif(btrim(oe.target_driver_id), '') IS NOT NULL
  AND btrim(oe.target_driver_id) = d.id::text;

UPDATE public.overflow_events oe
SET source_driver_auth_user_id = d.auth_user_id
FROM public.drivers d
WHERE oe.source_driver_auth_user_id IS NULL
  AND nullif(btrim(oe.source_driver_id), '') IS NOT NULL
  AND btrim(oe.source_driver_id) = d.id::text;

UPDATE public.overflow_events
SET dispatched_at = coalesce(dispatched_at, created_at)
WHERE dispatched_at IS NULL
  AND status IN ('dispatched', 'accepted', 'completed');

CREATE INDEX IF NOT EXISTS overflow_events_target_auth_status_idx
  ON public.overflow_events (target_driver_auth_user_id, status);

CREATE INDEX IF NOT EXISTS overflow_events_source_route_active_idx
  ON public.overflow_events (source_route_id, status)
  WHERE status IN ('pending', 'dispatched', 'accepted');

-- 2. Ensure driver identity helpers exist
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

-- 3. Tighten RLS on public.overflow_events (auth_user_id + driver_id + empty-driver vehicle fallback)
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
        source_driver_auth_user_id = auth.uid()
        OR target_driver_auth_user_id = auth.uid()
        OR btrim(coalesce(source_driver_id, '')) = public.current_driver_id()::text
        OR btrim(coalesce(target_driver_id, '')) = public.current_driver_id()::text
        OR (
          public.current_driver_vehicle_id() IS NOT NULL
          AND (
            (
              btrim(coalesce(source_driver_id, '')) = ''
              AND source_driver_auth_user_id IS NULL
              AND btrim(coalesce(source_vehicle_id, '')) = public.current_driver_vehicle_id()::text
            )
            OR (
              btrim(coalesce(target_driver_id, '')) = ''
              AND target_driver_auth_user_id IS NULL
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
      AND (source_driver_auth_user_id IS NULL OR source_driver_auth_user_id = auth.uid())
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
        source_driver_auth_user_id = auth.uid()
        OR target_driver_auth_user_id = auth.uid()
        OR btrim(coalesce(source_driver_id, '')) = public.current_driver_id()::text
        OR btrim(coalesce(target_driver_id, '')) = public.current_driver_id()::text
        OR (
          public.current_driver_vehicle_id() IS NOT NULL
          AND btrim(coalesce(target_driver_id, '')) = ''
          AND target_driver_auth_user_id IS NULL
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
        source_driver_auth_user_id = auth.uid()
        OR target_driver_auth_user_id = auth.uid()
        OR btrim(coalesce(source_driver_id, '')) = public.current_driver_id()::text
        OR btrim(coalesce(target_driver_id, '')) = public.current_driver_id()::text
        OR (
          public.current_driver_vehicle_id() IS NOT NULL
          AND btrim(coalesce(target_driver_id, '')) = ''
          AND target_driver_auth_user_id IS NULL
          AND btrim(coalesce(target_vehicle_id, '')) = public.current_driver_vehicle_id()::text
        )
      )
    )
  );

CREATE POLICY "overflow_events_delete_staff" ON public.overflow_events
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_dispatcher(auth.uid()));

-- 4. Fix RLS on public.notifications so user-targeted rows never leak to other drivers with the same role
DROP POLICY IF EXISTS "users read addressed notifications" ON public.notifications;
DROP POLICY IF EXISTS "users update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "users delete own notifications" ON public.notifications;

CREATE POLICY "users read addressed notifications" ON public.notifications
  FOR SELECT TO PUBLIC
  USING (
    public.current_profile_is_active()
    AND (
      user_auth_id = auth.uid()
      OR user_id = auth.uid()
      OR (
        user_auth_id IS NULL
        AND user_id IS NULL
        AND role = public.current_app_role()
      )
      OR (
        user_auth_id IS NULL
        AND user_id IS NULL
        AND role IS NULL
      )
    )
  );

CREATE POLICY "users update own notifications" ON public.notifications
  FOR UPDATE TO PUBLIC
  USING (
    public.current_profile_is_active()
    AND (
      user_auth_id = auth.uid()
      OR user_id = auth.uid()
      OR (
        user_auth_id IS NULL
        AND user_id IS NULL
        AND role = public.current_app_role()
      )
      OR (
        user_auth_id IS NULL
        AND user_id IS NULL
        AND role IS NULL
      )
    )
  )
  WITH CHECK (
    public.current_profile_is_active()
    AND (
      user_auth_id = auth.uid()
      OR user_id = auth.uid()
      OR (
        user_auth_id IS NULL
        AND user_id IS NULL
        AND role = public.current_app_role()
      )
      OR (
        user_auth_id IS NULL
        AND user_id IS NULL
        AND role IS NULL
      )
    )
  );

CREATE POLICY "users delete own notifications" ON public.notifications
  FOR DELETE TO PUBLIC
  USING (
    public.current_profile_is_active()
    AND (
      user_auth_id = auth.uid()
      OR user_id = auth.uid()
      OR (
        user_auth_id IS NULL
        AND user_id IS NULL
        AND role = public.current_app_role()
      )
      OR public.current_app_role() = 'admin'::text
    )
  );

-- 5. Atomic RPC: dispatch_overflow_event (manual / auto dispatcher reassignment + driver notification)
CREATE OR REPLACE FUNCTION public.dispatch_overflow_event(
  p_event_id               uuid,
  p_target_vehicle_id      text,
  p_target_driver_id       text DEFAULT NULL,
  p_overflow_bins          jsonb DEFAULT NULL,
  p_distance_km            double precision DEFAULT NULL,
  p_reassignment_metadata  jsonb DEFAULT NULL,
  p_extra_splits           jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event                  record;
  v_vehicle                record;
  v_driver                 record;
  v_profile                record;
  v_split_vehicle          record;
  v_split_driver           record;
  v_split_profile          record;
  v_now                    timestamptz := now();
  v_vehicle_id_txt         text := nullif(btrim(p_target_vehicle_id), '');
  v_vehicle_bigint         bigint;
  v_driver_id_txt          text := nullif(btrim(p_target_driver_id), '');
  v_driver_bigint          bigint := NULL;
  v_source_vehicle_label   text;
  v_source_driver_name     text;
  v_source_route_name      text;
  v_target_vehicle_label   text;
  v_bins                   jsonb;
  v_bins_count             int;
  v_meta                   jsonb;
  v_driver_notified        boolean := false;
  v_driver_notified_at     timestamptz := NULL;
  v_notif_exists           boolean := false;
  v_split_elem             jsonb;
  v_split_i                int;
  v_split_veh_txt          text;
  v_split_veh_bigint       bigint;
  v_split_drv_txt          text;
  v_split_drv_bigint       bigint;
  v_split_bins             jsonb;
  v_split_bins_count       int;
  v_split_dist             double precision;
  v_split_meta             jsonb;
  v_split_id               uuid;
  v_split_ids              uuid[] := '{}';
  v_split_notified_at      timestamptz;
BEGIN
  IF auth.uid() IS NULL AND coalesce(current_setting('role', true), '') NOT IN ('service_role', 'postgres') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  IF coalesce(current_setting('role', true), '') NOT IN ('service_role', 'postgres') THEN
    IF NOT (
      public.is_admin(auth.uid())
      OR public.is_dispatcher(auth.uid())
      OR public.is_supervisor(auth.uid())
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only authorized dispatch staff can assign relief trucks');
    END IF;
  END IF;

  IF v_vehicle_id_txt IS NULL OR v_vehicle_id_txt !~ '^[0-9]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A valid assisting vehicle ID is required');
  END IF;
  v_vehicle_bigint := v_vehicle_id_txt::bigint;

  SELECT * INTO v_event
  FROM public.overflow_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Overflow event not found');
  END IF;

  IF v_event.status IN ('accepted', 'completed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot reassign an overflow event that is already ' || v_event.status);
  END IF;

  IF v_event.source_vehicle_id IS NOT NULL AND btrim(v_event.source_vehicle_id) = v_vehicle_id_txt THEN
    RETURN jsonb_build_object('success', false, 'error', 'Relief truck must be different from the full truck');
  END IF;

  SELECT * INTO v_vehicle
  FROM public.vehicles
  WHERE id = v_vehicle_bigint
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Selected relief truck was not found');
  END IF;

  IF v_vehicle.is_active IS FALSE THEN
    RETURN jsonb_build_object('success', false, 'error', 'Selected relief truck is inactive');
  END IF;

  IF lower(coalesce(v_vehicle.status, '')) IN ('full', 'maintenance', 'inactive', 'out_of_service', 'suspended', 'assisting_overflow', 'unloading') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Selected relief truck is unavailable (' || v_vehicle.status || ')');
  END IF;

  -- Resolve authoritative driver for the assisting vehicle
  IF v_driver_id_txt IS NOT NULL AND v_driver_id_txt ~ '^[0-9]+$' THEN
    v_driver_bigint := v_driver_id_txt::bigint;
  END IF;

  IF v_driver_bigint IS NULL AND nullif(btrim(v_vehicle.driver_id), '') IS NOT NULL AND btrim(v_vehicle.driver_id) ~ '^[0-9]+$' THEN
    v_driver_bigint := btrim(v_vehicle.driver_id)::bigint;
  END IF;

  IF v_driver_bigint IS NULL THEN
    SELECT d.id INTO v_driver_bigint
    FROM public.drivers d
    WHERE d.assigned_vehicle_id = v_vehicle_bigint
    ORDER BY CASE WHEN d.status::text IN ('available', 'on_route') THEN 0 ELSE 1 END, d.id ASC
    LIMIT 1;
  END IF;

  IF v_driver_bigint IS NULL THEN
    SELECT r.driver_id INTO v_driver_bigint
    FROM public.routes r
    WHERE r.vehicle_id = v_vehicle_bigint
      AND r.driver_id IS NOT NULL
      AND r.status IN ('active'::public.route_status, 'pending'::public.route_status, 'planned'::public.route_status)
    ORDER BY CASE WHEN r.status = 'active'::public.route_status THEN 0 ELSE 1 END, r.created_at DESC
    LIMIT 1;
  END IF;

  IF v_driver_bigint IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Selected relief truck has no assigned driver');
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id = v_driver_bigint
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Assigned driver record not found');
  END IF;

  IF v_event.source_driver_id IS NOT NULL AND btrim(v_event.source_driver_id) = v_driver.id::text THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source driver cannot be assigned to assist their own overflow event');
  END IF;

  IF lower(coalesce(v_driver.status::text, '')) IN ('inactive', 'suspended', 'full') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Assigned driver is unavailable (' || coalesce(v_driver.status::text, 'unknown') || ')');
  END IF;

  SELECT up.id, up.auth_user_id, up.role::text AS role, up.status::text AS status
  INTO v_profile
  FROM public.user_profiles up
  WHERE (v_driver.profile_id IS NOT NULL AND up.id = v_driver.profile_id)
     OR up.auth_user_id = v_driver.auth_user_id
  LIMIT 1;

  IF FOUND THEN
    IF lower(coalesce(v_profile.status, '')) IN ('suspended', 'inactive') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Assigned driver account is ' || v_profile.status);
    END IF;
    IF v_profile.role IS NOT NULL AND v_profile.role <> 'truck_driver' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Assigned user is not a Truck Driver account');
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.overflow_events oe
    WHERE oe.id <> p_event_id
      AND oe.status IN ('dispatched', 'accepted')
      AND (
        btrim(coalesce(oe.target_vehicle_id, '')) = v_vehicle.id::text
        OR btrim(coalesce(oe.target_driver_id, '')) = v_driver.id::text
      )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Selected relief truck or driver is already assigned to another active overflow dispatch');
  END IF;

  -- Idempotency check for repeated dispatch clicks / duplicate calls
  IF v_event.status = 'dispatched'
     AND btrim(coalesce(v_event.target_driver_id, '')) = v_driver.id::text
     AND btrim(coalesce(v_event.target_vehicle_id, '')) = v_vehicle.id::text
     AND coalesce(jsonb_array_length(p_extra_splits), 0) = 0
  THEN
    SELECT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.source_table = 'overflow_events'
        AND n.source_id = p_event_id::text
        AND n.user_auth_id = v_driver.auth_user_id
    ) INTO v_notif_exists;

    IF v_driver.auth_user_id IS NOT NULL AND NOT v_notif_exists THEN
      v_target_vehicle_label := coalesce(nullif(btrim(v_vehicle.label), ''), nullif(btrim(v_vehicle.truck_code), ''), v_vehicle.plate_number, 'Truck #' || v_vehicle.id::text);
      INSERT INTO public.notifications (
        user_auth_id, user_id, role, title, message, type, category,
        route_id, source_table, source_id, read, created_at
      ) VALUES (
        v_driver.auth_user_id,
        v_driver.auth_user_id,
        NULL,
        'Overflow Assistance Assigned',
        format('Assigned to %s for %s overflow stop(s). Open EcoLoop Home to review and accept.', v_target_vehicle_label, coalesce(v_event.bins_count, 0)),
        'warning'::public.notification_type,
        'assignment'::public.notification_category,
        CASE WHEN v_event.source_route_id ~ '^[0-9]+$' THEN v_event.source_route_id::bigint ELSE NULL END,
        'overflow_events',
        p_event_id::text,
        false,
        v_now
      );
      UPDATE public.overflow_events
      SET driver_notified_at = coalesce(driver_notified_at, v_now)
      WHERE id = p_event_id
      RETURNING driver_notified_at INTO v_driver_notified_at;
    ELSE
      v_driver_notified_at := v_event.driver_notified_at;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'event_id', p_event_id,
      'target_driver_id', v_driver.id::text,
      'target_driver_auth_user_id', v_driver.auth_user_id,
      'target_vehicle_id', v_vehicle.id::text,
      'driver_notified', (v_driver.auth_user_id IS NOT NULL AND (v_notif_exists OR v_driver_notified_at IS NOT NULL)),
      'driver_notified_at', v_driver_notified_at,
      'dispatched_at', v_event.dispatched_at,
      'split_event_ids', '[]'::jsonb
    );
  END IF;

  -- Resolve source context labels so MobileApp displays requesting truck/driver/route clearly
  IF nullif(btrim(v_event.source_vehicle_id), '') IS NOT NULL AND btrim(v_event.source_vehicle_id) ~ '^[0-9]+$' THEN
    SELECT coalesce(nullif(btrim(label), ''), nullif(btrim(truck_code), ''), plate_number, 'Truck #' || id::text)
    INTO v_source_vehicle_label
    FROM public.vehicles
    WHERE id = btrim(v_event.source_vehicle_id)::bigint;
  END IF;
  v_source_vehicle_label := coalesce(v_source_vehicle_label, 'Truck ' || coalesce(v_event.source_vehicle_id, '?'));

  IF nullif(btrim(v_event.source_driver_id), '') IS NOT NULL AND btrim(v_event.source_driver_id) ~ '^[0-9]+$' THEN
    SELECT name INTO v_source_driver_name
    FROM public.drivers
    WHERE id = btrim(v_event.source_driver_id)::bigint;
  END IF;

  IF nullif(btrim(v_event.source_route_id), '') IS NOT NULL AND btrim(v_event.source_route_id) ~ '^[0-9]+$' THEN
    SELECT name INTO v_source_route_name
    FROM public.routes
    WHERE id = btrim(v_event.source_route_id)::bigint;
  END IF;

  v_target_vehicle_label := coalesce(nullif(btrim(v_vehicle.label), ''), nullif(btrim(v_vehicle.truck_code), ''), v_vehicle.plate_number, 'Truck #' || v_vehicle.id::text);

  v_bins := coalesce(p_overflow_bins, v_event.overflow_bins, '[]'::jsonb);
  v_bins_count := coalesce(jsonb_array_length(v_bins), v_event.bins_count, 0);

  v_meta := coalesce(v_event.reassignment_metadata, '{}'::jsonb)
    || coalesce(p_reassignment_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source_vehicle_label', v_source_vehicle_label,
      'source_driver_name', v_source_driver_name,
      'source_route_name', v_source_route_name,
      'target_vehicle_label', v_target_vehicle_label,
      'target_driver_name', v_driver.name,
      'target_driver_id', v_driver.id::text,
      'target_driver_auth_user_id', v_driver.auth_user_id,
      'assigned_by_auth_id', auth.uid(),
      'dispatched_at', v_now
    );

  UPDATE public.overflow_events
  SET
    target_vehicle_id = v_vehicle.id::text,
    target_driver_id = v_driver.id::text,
    target_driver_auth_user_id = v_driver.auth_user_id,
    status = 'dispatched',
    dispatched_at = v_now,
    declined_at = NULL,
    overflow_bins = v_bins,
    bins_count = v_bins_count,
    distance_km = coalesce(p_distance_km, distance_km),
    reassignment_metadata = v_meta
  WHERE id = p_event_id;

  -- Create private targeted notification for the assisting driver (deduplicated)
  IF v_driver.auth_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_auth_id, user_id, role, title, message, type, category,
      route_id, source_table, source_id, read, created_at
    )
    SELECT
      v_driver.auth_user_id,
      v_driver.auth_user_id,
      NULL,
      'Overflow Assistance Assigned',
      format(
        '%s requested assistance%s (%s stop%s) -> assigned to %s.',
        v_source_vehicle_label,
        CASE WHEN v_source_route_name IS NOT NULL THEN ' on ' || v_source_route_name ELSE '' END,
        v_bins_count,
        CASE WHEN v_bins_count = 1 THEN '' ELSE 's' END,
        v_target_vehicle_label
      ),
      'warning'::public.notification_type,
      'assignment'::public.notification_category,
      CASE WHEN v_event.source_route_id ~ '^[0-9]+$' THEN v_event.source_route_id::bigint ELSE NULL END,
      'overflow_events',
      p_event_id::text,
      false,
      v_now
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.source_table = 'overflow_events'
        AND n.source_id = p_event_id::text
        AND n.user_auth_id = v_driver.auth_user_id
        AND n.read = false
    );

    v_driver_notified := true;
    v_driver_notified_at := v_now;
    UPDATE public.overflow_events
    SET driver_notified_at = v_now
    WHERE id = p_event_id;
  END IF;

  -- Process optional multi-truck split / pending remainder records atomically
  FOR v_split_i IN 0 .. coalesce(jsonb_array_length(p_extra_splits), 0) - 1 LOOP
    v_split_elem := p_extra_splits->v_split_i;
    v_split_veh_txt := nullif(btrim(v_split_elem->>'target_vehicle_id'), '');
    v_split_drv_txt := nullif(btrim(v_split_elem->>'target_driver_id'), '');
    v_split_bins := coalesce(v_split_elem->'overflow_bins', '[]'::jsonb);
    v_split_bins_count := coalesce((v_split_elem->>'bins_count')::int, jsonb_array_length(v_split_bins), 0);
    v_split_dist := (v_split_elem->>'distance_km')::double precision;
    v_split_meta := coalesce(v_split_elem->'reassignment_metadata', '{}'::jsonb)
      || jsonb_build_object(
        'source_vehicle_label', v_source_vehicle_label,
        'source_driver_name', v_source_driver_name,
        'source_route_name', v_source_route_name
      );

    v_split_veh_bigint := NULL;
    v_split_drv_bigint := NULL;
    v_split_notified_at := NULL;

    IF v_split_veh_txt IS NOT NULL AND v_split_veh_txt ~ '^[0-9]+$' THEN
      v_split_veh_bigint := v_split_veh_txt::bigint;
      SELECT * INTO v_split_vehicle FROM public.vehicles WHERE id = v_split_veh_bigint;

      IF v_split_drv_txt IS NOT NULL AND v_split_drv_txt ~ '^[0-9]+$' THEN
        v_split_drv_bigint := v_split_drv_txt::bigint;
      ELSIF v_split_vehicle.driver_id IS NOT NULL AND btrim(v_split_vehicle.driver_id) ~ '^[0-9]+$' THEN
        v_split_drv_bigint := btrim(v_split_vehicle.driver_id)::bigint;
      ELSE
        SELECT d.id INTO v_split_drv_bigint
        FROM public.drivers d
        WHERE d.assigned_vehicle_id = v_split_veh_bigint
        ORDER BY d.id ASC
        LIMIT 1;
      END IF;

      IF v_split_drv_bigint IS NOT NULL THEN
        SELECT * INTO v_split_driver FROM public.drivers WHERE id = v_split_drv_bigint;
        SELECT up.status::text AS status INTO v_split_profile
        FROM public.user_profiles up
        WHERE (v_split_driver.profile_id IS NOT NULL AND up.id = v_split_driver.profile_id)
           OR up.auth_user_id = v_split_driver.auth_user_id
        LIMIT 1;
      END IF;
    END IF;

    INSERT INTO public.overflow_events (
      source_vehicle_id,
      source_driver_id,
      source_driver_auth_user_id,
      source_route_id,
      target_vehicle_id,
      target_driver_id,
      target_driver_auth_user_id,
      status,
      overflow_bins,
      bins_count,
      distance_km,
      reassignment_metadata,
      dispatched_at,
      created_at
    ) VALUES (
      v_event.source_vehicle_id,
      v_event.source_driver_id,
      v_event.source_driver_auth_user_id,
      v_event.source_route_id,
      CASE WHEN v_split_veh_bigint IS NOT NULL THEN v_split_veh_bigint::text ELSE NULL END,
      CASE WHEN v_split_drv_bigint IS NOT NULL THEN v_split_drv_bigint::text ELSE NULL END,
      CASE WHEN v_split_drv_bigint IS NOT NULL THEN v_split_driver.auth_user_id ELSE NULL END,
      CASE WHEN v_split_drv_bigint IS NOT NULL THEN 'dispatched' ELSE 'pending' END,
      v_split_bins,
      v_split_bins_count,
      v_split_dist,
      v_split_meta,
      CASE WHEN v_split_drv_bigint IS NOT NULL THEN v_now ELSE NULL END,
      v_now
    )
    RETURNING id INTO v_split_id;

    v_split_ids := array_append(v_split_ids, v_split_id);

    IF v_split_drv_bigint IS NOT NULL AND v_split_driver.auth_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_auth_id, user_id, role, title, message, type, category,
        route_id, source_table, source_id, read, created_at
      )
      SELECT
        v_split_driver.auth_user_id,
        v_split_driver.auth_user_id,
        NULL,
        'Overflow Assistance Assigned',
        format(
          '%s requested assistance%s (%s stop%s). Open EcoLoop Home to review and accept.',
          v_source_vehicle_label,
          CASE WHEN v_source_route_name IS NOT NULL THEN ' on ' || v_source_route_name ELSE '' END,
          v_split_bins_count,
          CASE WHEN v_split_bins_count = 1 THEN '' ELSE 's' END
        ),
        'warning'::public.notification_type,
        'assignment'::public.notification_category,
        CASE WHEN v_event.source_route_id ~ '^[0-9]+$' THEN v_event.source_route_id::bigint ELSE NULL END,
        'overflow_events',
        v_split_id::text,
        false,
        v_now
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.source_table = 'overflow_events'
          AND n.source_id = v_split_id::text
          AND n.user_auth_id = v_split_driver.auth_user_id
          AND n.read = false
      );

      v_split_notified_at := v_now;
      UPDATE public.overflow_events
      SET driver_notified_at = v_split_notified_at
      WHERE id = v_split_id;
    END IF;
  END LOOP;

  -- Deduplicated dispatcher notification
  INSERT INTO public.notifications (
    user_auth_id, user_id, role, title, message, type, category,
    route_id, source_table, source_id, read, created_at
  )
  SELECT
    NULL,
    NULL,
    'dispatcher',
    'Overflow Relief Dispatched',
    format('%s assigned to assist %s (%s stop%s).', v_target_vehicle_label, v_source_vehicle_label, v_bins_count, CASE WHEN v_bins_count = 1 THEN '' ELSE 's' END),
    'info'::public.notification_type,
    'assignment'::public.notification_category,
    CASE WHEN v_event.source_route_id ~ '^[0-9]+$' THEN v_event.source_route_id::bigint ELSE NULL END,
    'overflow_events',
    p_event_id::text,
    false,
    v_now
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.source_table = 'overflow_events'
      AND n.source_id = p_event_id::text
      AND n.role = 'dispatcher'
      AND n.title = 'Overflow Relief Dispatched'
      AND n.read = false
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'event_id', p_event_id,
    'target_driver_id', v_driver.id::text,
    'target_driver_auth_user_id', v_driver.auth_user_id,
    'target_vehicle_id', v_vehicle.id::text,
    'driver_notified', v_driver_notified,
    'driver_notified_at', v_driver_notified_at,
    'dispatched_at', v_now,
    'split_event_ids', to_jsonb(v_split_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_overflow_event(uuid, text, text, jsonb, double precision, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_overflow_event(uuid, text, text, jsonb, double precision, jsonb, jsonb) TO authenticated, service_role, postgres;

-- 6. Atomic RPC: create_overflow_dispatch (truck-full / overflow event creation + driver & dispatcher notifications)
CREATE OR REPLACE FUNCTION public.create_overflow_dispatch(
  p_source_vehicle_id       text,
  p_source_driver_id        text DEFAULT NULL,
  p_source_route_id         text DEFAULT NULL,
  p_assignments             jsonb DEFAULT '[]'::jsonb,
  p_pending_bins            jsonb DEFAULT '[]'::jsonb,
  p_pending_metadata        jsonb DEFAULT '{}'::jsonb,
  p_mark_deliveries_overflow boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now                     timestamptz := now();
  v_src_veh_txt             text := nullif(btrim(p_source_vehicle_id), '');
  v_src_drv_txt             text := nullif(btrim(p_source_driver_id), '');
  v_src_route_txt           text := nullif(btrim(p_source_route_id), '');
  v_src_veh_bigint          bigint;
  v_src_drv_bigint          bigint := NULL;
  v_src_route_bigint        bigint := NULL;
  v_src_auth_uid            uuid := NULL;
  v_src_veh_label           text;
  v_src_drv_name            text;
  v_src_route_name          text;
  v_caller_driver_id        bigint := public.current_driver_id();
  v_is_staff                boolean := false;
  v_existing_ids            uuid[];
  v_assign                  jsonb;
  v_i                       int;
  v_tgt_veh_txt             text;
  v_tgt_drv_txt             text;
  v_tgt_veh_bigint          bigint;
  v_tgt_drv_bigint          bigint;
  v_tgt_driver              record;
  v_tgt_vehicle             record;
  v_tgt_veh_label           text;
  v_bins                    jsonb;
  v_bins_count              int;
  v_dist_km                 double precision;
  v_meta                    jsonb;
  v_new_id                  uuid;
  v_created_ids             uuid[] := '{}';
  v_notified_driver_ids     text[] := '{}';
  v_primary_id              uuid := NULL;
  v_total_dispatched_stops  int := 0;
  v_pending_count           int := coalesce(jsonb_array_length(p_pending_bins), 0);
  v_notif_msg               text;
BEGIN
  IF auth.uid() IS NULL AND coalesce(current_setting('role', true), '') NOT IN ('service_role', 'postgres') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  IF v_src_veh_txt IS NULL OR v_src_veh_txt !~ '^[0-9]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source vehicle assignment is required to signal overflow');
  END IF;
  v_src_veh_bigint := v_src_veh_txt::bigint;

  IF v_src_drv_txt IS NOT NULL AND v_src_drv_txt ~ '^[0-9]+$' THEN
    v_src_drv_bigint := v_src_drv_txt::bigint;
  END IF;

  IF v_src_route_txt IS NOT NULL AND v_src_route_txt ~ '^[0-9]+$' THEN
    v_src_route_bigint := v_src_route_txt::bigint;
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
        AND v_caller_driver_id IS NOT NULL
        AND (v_src_drv_bigint IS NULL OR v_src_drv_bigint = v_caller_driver_id)
      )
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not authorized to create overflow dispatch');
    END IF;
    IF NOT v_is_staff AND v_src_drv_bigint IS NULL THEN
      v_src_drv_bigint := v_caller_driver_id;
      v_src_drv_txt := v_caller_driver_id::text;
    END IF;
  END IF;

  -- Serialize overflow creation per source route/vehicle to prevent duplicate submissions
  PERFORM pg_advisory_xact_lock(hashtext('overflow_source:' || coalesce(v_src_route_txt, v_src_veh_txt)));

  -- Duplicate prevention: reuse active pending/dispatched events if already created for this route & vehicle
  SELECT array_agg(oe.id ORDER BY oe.created_at ASC)
  INTO v_existing_ids
  FROM public.overflow_events oe
  WHERE btrim(coalesce(oe.source_vehicle_id, '')) = v_src_veh_txt
    AND (v_src_route_txt IS NULL OR btrim(coalesce(oe.source_route_id, '')) = v_src_route_txt)
    AND oe.status IN ('pending', 'dispatched');

  IF coalesce(array_length(v_existing_ids, 1), 0) > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'primary_event_id', v_existing_ids[1],
      'event_ids', to_jsonb(v_existing_ids),
      'notified_driver_ids', '[]'::jsonb
    );
  END IF;

  -- Resolve source context labels
  SELECT coalesce(nullif(btrim(label), ''), nullif(btrim(truck_code), ''), plate_number, 'Truck #' || id::text)
  INTO v_src_veh_label
  FROM public.vehicles
  WHERE id = v_src_veh_bigint;
  v_src_veh_label := coalesce(v_src_veh_label, 'Truck #' || v_src_veh_txt);

  IF v_src_drv_bigint IS NOT NULL THEN
    SELECT name, auth_user_id INTO v_src_drv_name, v_src_auth_uid
    FROM public.drivers
    WHERE id = v_src_drv_bigint;
  END IF;

  IF v_src_route_bigint IS NOT NULL THEN
    SELECT name INTO v_src_route_name
    FROM public.routes
    WHERE id = v_src_route_bigint;
  END IF;

  -- Mark source vehicle full inside the same transaction
  UPDATE public.vehicles
  SET status = 'full',
      load_percent = 100,
      updated_at = v_now
  WHERE id = v_src_veh_bigint;

  IF p_mark_deliveries_overflow AND v_src_route_bigint IS NOT NULL THEN
    BEGIN
      UPDATE public.deliveries
      SET status = 'overflow_uncollected'::public.delivery_status,
          updated_at = v_now
      WHERE route_id = v_src_route_bigint
        AND status::text NOT IN ('completed', 'cancelled');
    EXCEPTION WHEN invalid_text_representation THEN
      NULL;
    END;
  END IF;

  -- Insert assigned/dispatched split event(s) and privately notify each assisting driver
  FOR v_i IN 0 .. coalesce(jsonb_array_length(p_assignments), 0) - 1 LOOP
    v_assign := p_assignments->v_i;
    v_tgt_veh_txt := nullif(btrim(v_assign->>'target_vehicle_id'), '');
    v_tgt_drv_txt := nullif(btrim(v_assign->>'target_driver_id'), '');
    v_bins := coalesce(v_assign->'overflow_bins', '[]'::jsonb);
    v_bins_count := coalesce((v_assign->>'bins_count')::int, jsonb_array_length(v_bins), 0);
    v_dist_km := (v_assign->>'distance_km')::double precision;

    v_tgt_veh_bigint := NULL;
    v_tgt_drv_bigint := NULL;
    v_tgt_driver := NULL;
    v_tgt_vehicle := NULL;
    v_tgt_veh_label := NULL;

    IF v_tgt_veh_txt IS NOT NULL AND v_tgt_veh_txt ~ '^[0-9]+$' AND v_tgt_veh_txt <> v_src_veh_txt THEN
      v_tgt_veh_bigint := v_tgt_veh_txt::bigint;
      SELECT * INTO v_tgt_vehicle FROM public.vehicles WHERE id = v_tgt_veh_bigint;
      IF FOUND THEN
        v_tgt_veh_label := coalesce(nullif(btrim(v_tgt_vehicle.label), ''), nullif(btrim(v_tgt_vehicle.truck_code), ''), v_tgt_vehicle.plate_number, 'Truck #' || v_tgt_vehicle.id::text);
      END IF;
    END IF;

    IF v_tgt_drv_txt IS NOT NULL AND v_tgt_drv_txt ~ '^[0-9]+$' THEN
      v_tgt_drv_bigint := v_tgt_drv_txt::bigint;
    ELSIF v_tgt_veh_bigint IS NOT NULL AND v_tgt_vehicle.driver_id IS NOT NULL AND btrim(v_tgt_vehicle.driver_id) ~ '^[0-9]+$' THEN
      v_tgt_drv_bigint := btrim(v_tgt_vehicle.driver_id)::bigint;
    ELSIF v_tgt_veh_bigint IS NOT NULL THEN
      SELECT d.id INTO v_tgt_drv_bigint
      FROM public.drivers d
      WHERE d.assigned_vehicle_id = v_tgt_veh_bigint
      ORDER BY d.id ASC
      LIMIT 1;
    END IF;

    IF v_tgt_drv_bigint IS NOT NULL AND (v_src_drv_bigint IS NULL OR v_tgt_drv_bigint <> v_src_drv_bigint) THEN
      SELECT * INTO v_tgt_driver FROM public.drivers WHERE id = v_tgt_drv_bigint;
      IF NOT FOUND THEN
        v_tgt_drv_bigint := NULL;
      END IF;
    ELSE
      v_tgt_drv_bigint := NULL;
    END IF;

    v_meta := coalesce(v_assign->'reassignment_metadata', '{}'::jsonb)
      || jsonb_build_object(
        'source_vehicle_label', v_src_veh_label,
        'source_driver_name', v_src_drv_name,
        'source_route_name', v_src_route_name,
        'target_vehicle_label', v_tgt_veh_label,
        'target_driver_name', CASE WHEN v_tgt_drv_bigint IS NOT NULL THEN v_tgt_driver.name ELSE NULL END
      );

    INSERT INTO public.overflow_events (
      source_vehicle_id,
      source_driver_id,
      source_driver_auth_user_id,
      source_route_id,
      target_vehicle_id,
      target_driver_id,
      target_driver_auth_user_id,
      status,
      overflow_bins,
      bins_count,
      distance_km,
      reassignment_metadata,
      dispatched_at,
      created_at
    ) VALUES (
      v_src_veh_txt,
      v_src_drv_txt,
      v_src_auth_uid,
      v_src_route_txt,
      CASE WHEN v_tgt_veh_bigint IS NOT NULL THEN v_tgt_veh_bigint::text ELSE NULL END,
      CASE WHEN v_tgt_drv_bigint IS NOT NULL THEN v_tgt_drv_bigint::text ELSE NULL END,
      CASE WHEN v_tgt_drv_bigint IS NOT NULL THEN v_tgt_driver.auth_user_id ELSE NULL END,
      CASE WHEN v_tgt_drv_bigint IS NOT NULL THEN 'dispatched' ELSE 'pending' END,
      v_bins,
      v_bins_count,
      v_dist_km,
      v_meta,
      CASE WHEN v_tgt_drv_bigint IS NOT NULL THEN v_now ELSE NULL END,
      v_now
    )
    RETURNING id INTO v_new_id;

    v_created_ids := array_append(v_created_ids, v_new_id);
    IF v_primary_id IS NULL THEN
      v_primary_id := v_new_id;
    END IF;

    IF v_tgt_drv_bigint IS NOT NULL THEN
      v_total_dispatched_stops := v_total_dispatched_stops + v_bins_count;
      IF v_tgt_driver.auth_user_id IS NOT NULL THEN
        INSERT INTO public.notifications (
          user_auth_id, user_id, role, title, message, type, category,
          route_id, source_table, source_id, read, created_at
        )
        SELECT
          v_tgt_driver.auth_user_id,
          v_tgt_driver.auth_user_id,
          NULL,
          'Overflow Assistance Assigned',
          format(
            '%s requested assistance%s (%s stop%s). Open EcoLoop Home to review and accept.',
            v_src_veh_label,
            CASE WHEN v_src_route_name IS NOT NULL THEN ' on ' || v_src_route_name ELSE '' END,
            v_bins_count,
            CASE WHEN v_bins_count = 1 THEN '' ELSE 's' END
          ),
          'warning'::public.notification_type,
          'assignment'::public.notification_category,
          v_src_route_bigint,
          'overflow_events',
          v_new_id::text,
          false,
          v_now
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.notifications n
          WHERE n.source_table = 'overflow_events'
            AND n.source_id = v_new_id::text
            AND n.user_auth_id = v_tgt_driver.auth_user_id
            AND n.read = false
        );

        UPDATE public.overflow_events
        SET driver_notified_at = v_now
        WHERE id = v_new_id;

        v_notified_driver_ids := array_append(v_notified_driver_ids, v_tgt_drv_bigint::text);
      END IF;
    END IF;
  END LOOP;

  -- Insert pending event for unassigned / manual-review stops
  IF v_pending_count > 0 THEN
    v_meta := coalesce(p_pending_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'source_vehicle_label', v_src_veh_label,
        'source_driver_name', v_src_drv_name,
        'source_route_name', v_src_route_name
      );

    INSERT INTO public.overflow_events (
      source_vehicle_id,
      source_driver_id,
      source_driver_auth_user_id,
      source_route_id,
      target_vehicle_id,
      target_driver_id,
      target_driver_auth_user_id,
      status,
      overflow_bins,
      bins_count,
      distance_km,
      reassignment_metadata,
      created_at
    ) VALUES (
      v_src_veh_txt,
      v_src_drv_txt,
      v_src_auth_uid,
      v_src_route_txt,
      NULL,
      NULL,
      NULL,
      'pending',
      p_pending_bins,
      v_pending_count,
      NULL,
      v_meta,
      v_now
    )
    RETURNING id INTO v_new_id;

    v_created_ids := array_append(v_created_ids, v_new_id);
    IF v_primary_id IS NULL THEN
      v_primary_id := v_new_id;
    END IF;
  END IF;

  IF v_primary_id IS NOT NULL THEN
    v_notif_msg := CASE
      WHEN coalesce(array_length(v_notified_driver_ids, 1), 0) > 0 THEN
        format(
          '%s (%s) signaled FULL on %s. Dispatched %s overflow stop(s) to relief truck(s)%s.',
          v_src_veh_label,
          coalesce(v_src_drv_name, 'Driver'),
          coalesce(v_src_route_name, 'route'),
          v_total_dispatched_stops,
          CASE WHEN v_pending_count > 0 THEN format(' (%s pending manual dispatch)', v_pending_count) ELSE '' END
        )
      ELSE
        format(
          '%s (%s) signaled FULL on %s. %s uncollected stop(s) awaiting relief truck assignment.',
          v_src_veh_label,
          coalesce(v_src_drv_name, 'Driver'),
          coalesce(v_src_route_name, 'route'),
          v_pending_count
        )
    END;

    INSERT INTO public.notifications (
      user_auth_id, user_id, role, title, message, type, category,
      route_id, source_table, source_id, read, created_at
    )
    SELECT
      NULL,
      NULL,
      'dispatcher',
      'Truck Capacity Full (100%)',
      v_notif_msg,
      'warning'::public.notification_type,
      'assignment'::public.notification_category,
      v_src_route_bigint,
      'overflow_events',
      v_primary_id::text,
      false,
      v_now
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.source_table = 'overflow_events'
        AND n.source_id = v_primary_id::text
        AND n.role = 'dispatcher'
        AND n.title = 'Truck Capacity Full (100%)'
        AND n.read = false
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'primary_event_id', v_primary_id,
    'event_ids', to_jsonb(v_created_ids),
    'notified_driver_ids', to_jsonb(v_notified_driver_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_overflow_dispatch(text, text, text, jsonb, jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_overflow_dispatch(text, text, text, jsonb, jsonb, jsonb, boolean) TO authenticated, service_role, postgres;

-- 7. Atomic RPC: decline_overflow_event
CREATE OR REPLACE FUNCTION public.decline_overflow_event(
  p_event_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event             record;
  v_caller_driver_id  bigint := public.current_driver_id();
  v_caller_vehicle_id bigint := public.current_driver_vehicle_id();
  v_is_staff          boolean := false;
  v_target_driver     record;
  v_now               timestamptz := now();
BEGIN
  IF auth.uid() IS NULL AND coalesce(current_setting('role', true), '') NOT IN ('service_role', 'postgres') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  SELECT * INTO v_event
  FROM public.overflow_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Overflow event not found');
  END IF;

  IF coalesce(current_setting('role', true), '') NOT IN ('service_role', 'postgres') THEN
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
        AND v_caller_driver_id IS NOT NULL
        AND (
          v_event.target_driver_auth_user_id = auth.uid()
          OR btrim(coalesce(v_event.target_driver_id, '')) = v_caller_driver_id::text
          OR (
            v_caller_vehicle_id IS NOT NULL
            AND btrim(coalesce(v_event.target_driver_id, '')) = ''
            AND v_event.target_driver_auth_user_id IS NULL
            AND btrim(coalesce(v_event.target_vehicle_id, '')) = v_caller_vehicle_id::text
          )
        )
      )
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not authorized to decline this overflow dispatch');
    END IF;
  END IF;

  IF v_event.status = 'declined' THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'event_id', p_event_id);
  END IF;

  IF v_event.status IN ('accepted', 'completed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot decline an overflow event that is already ' || v_event.status);
  END IF;

  IF nullif(btrim(v_event.target_driver_id), '') IS NOT NULL AND btrim(v_event.target_driver_id) ~ '^[0-9]+$' THEN
    SELECT * INTO v_target_driver FROM public.drivers WHERE id = btrim(v_event.target_driver_id)::bigint;
  ELSIF v_caller_driver_id IS NOT NULL THEN
    SELECT * INTO v_target_driver FROM public.drivers WHERE id = v_caller_driver_id;
  END IF;

  UPDATE public.overflow_events
  SET
    status = 'declined',
    declined_at = v_now,
    reassignment_metadata = coalesce(reassignment_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'declined_at', v_now,
        'declined_by_driver_id', coalesce(v_caller_driver_id::text, v_event.target_driver_id),
        'decline_reason', nullif(btrim(p_reason), '')
      )
  WHERE id = p_event_id;

  IF coalesce(v_event.target_driver_auth_user_id, v_target_driver.auth_user_id) IS NOT NULL THEN
    UPDATE public.notifications
    SET read = true,
        is_read = true,
        read_at = coalesce(read_at, v_now)
    WHERE source_table = 'overflow_events'
      AND source_id = p_event_id::text
      AND user_auth_id = coalesce(v_event.target_driver_auth_user_id, v_target_driver.auth_user_id)
      AND read = false;
  END IF;

  INSERT INTO public.notifications (
    user_auth_id, user_id, role, title, message, type, category,
    route_id, source_table, source_id, read, created_at
  )
  SELECT
    NULL,
    NULL,
    'dispatcher',
    'Overflow Declined',
    format(
      '%s declined overflow assistance of %s stop(s). Reassignment needed.',
      coalesce(v_target_driver.name, 'Driver'),
      coalesce(v_event.bins_count, 0)
    ),
    'warning'::public.notification_type,
    'assignment'::public.notification_category,
    CASE WHEN v_event.source_route_id ~ '^[0-9]+$' THEN v_event.source_route_id::bigint ELSE NULL END,
    'overflow_events',
    p_event_id::text,
    false,
    v_now
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.source_table = 'overflow_events'
      AND n.source_id = p_event_id::text
      AND n.role = 'dispatcher'
      AND n.title = 'Overflow Declined'
      AND n.read = false
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'event_id', p_event_id,
    'declined_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.decline_overflow_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_overflow_event(uuid, text) TO authenticated, service_role, postgres;

-- 8. Upgrade accept_overflow_event (fix user_profiles auth_user_id check, offline->on_route acceptance, notification sync)
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
  v_target_vehicle_label text := NULL;
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

  IF v_event.status IN ('declined', 'completed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Overflow event cannot be accepted in current state: ' || v_event.status);
  END IF;

  IF NOT v_is_staff
     AND (
       (nullif(btrim(v_event.target_driver_id), '') IS NOT NULL AND btrim(v_event.target_driver_id) <> v_target_driver_txt)
       OR (v_event.target_driver_auth_user_id IS NOT NULL AND v_event.target_driver_auth_user_id <> auth.uid())
     )
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'This overflow dispatch is assigned to a different driver');
  END IF;

  IF v_event.source_driver_id IS NOT NULL AND btrim(v_event.source_driver_id) = v_target_driver_txt THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source driver cannot accept their own overflow event');
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id = v_target_driver_bigint
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target driver not found');
  END IF;

  IF lower(coalesce(v_driver.status::text, '')) IN ('inactive', 'suspended', 'full', 'on_break') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target driver is not available (' || coalesce(v_driver.status::text, 'unknown') || ')');
  END IF;

  IF v_is_staff AND lower(coalesce(v_driver.status::text, '')) = 'offline' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target driver is currently offline');
  END IF;

  SELECT up.status::text INTO v_profile_status
  FROM public.user_profiles up
  WHERE (v_driver.profile_id IS NOT NULL AND up.id = v_driver.profile_id)
     OR up.auth_user_id = v_driver.auth_user_id
  LIMIT 1;

  IF v_profile_status IS NOT NULL AND lower(v_profile_status) IN ('suspended', 'inactive') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target driver account is ' || v_profile_status);
  END IF;

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

    v_target_vehicle_label := coalesce(nullif(btrim(v_vehicle.label), ''), nullif(btrim(v_vehicle.truck_code), ''), v_vehicle.plate_number, 'Truck #' || v_vehicle.id::text);
  END IF;

  IF v_event.source_route_id IS NOT NULL AND btrim(v_event.source_route_id) ~ '^[0-9]+$' THEN
    v_source_route_bigint := btrim(v_event.source_route_id)::bigint;
  END IF;

  IF v_event.source_driver_id IS NOT NULL AND btrim(v_event.source_driver_id) ~ '^[0-9]+$' THEN
    v_source_driver_bigint := btrim(v_event.source_driver_id)::bigint;
  END IF;

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

  IF v_driver.status::text IN ('available', 'offline') THEN
    UPDATE public.drivers
    SET
      status = 'on_route',
      last_seen_at = v_now,
      updated_at = v_now
    WHERE id = v_target_driver_bigint;
  END IF;

  UPDATE public.overflow_events
  SET
    status = 'accepted',
    accepted_at = v_now,
    target_driver_id = v_target_driver_txt,
    target_driver_auth_user_id = v_driver.auth_user_id,
    target_vehicle_id = coalesce(nullif(btrim(v_vehicle_id_txt), ''), v_event.target_vehicle_id),
    target_route_id = v_target_route_bigint,
    reassignment_metadata = coalesce(reassignment_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'target_route_id', v_target_route_bigint,
        'target_driver_id', v_target_driver_txt,
        'target_driver_auth_user_id', v_driver.auth_user_id,
        'target_vehicle_id', coalesce(nullif(btrim(v_vehicle_id_txt), ''), v_event.target_vehicle_id),
        'accepted_at', v_now
      )
  WHERE id = p_event_id;

  IF v_driver.auth_user_id IS NOT NULL THEN
    UPDATE public.notifications
    SET read = true,
        is_read = true,
        read_at = coalesce(read_at, v_now)
    WHERE source_table = 'overflow_events'
      AND source_id = p_event_id::text
      AND user_auth_id = v_driver.auth_user_id
      AND read = false;
  END IF;

  INSERT INTO public.notifications (
    user_auth_id, user_id, role, title, message, type, category,
    route_id, source_table, source_id, read, created_at
  )
  SELECT
    NULL,
    NULL,
    'dispatcher',
    'Overflow Accepted',
    format(
      '%s (%s) accepted overflow assistance (%s stop%s).',
      coalesce(v_driver.name, 'Driver'),
      coalesce(v_target_vehicle_label, 'Truck'),
      coalesce(array_length(v_bin_ids, 1), 0),
      CASE WHEN coalesce(array_length(v_bin_ids, 1), 0) = 1 THEN '' ELSE 's' END
    ),
    'success'::public.notification_type,
    'assignment'::public.notification_category,
    v_target_route_bigint,
    'overflow_events',
    p_event_id::text,
    false,
    v_now
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.source_table = 'overflow_events'
      AND n.source_id = p_event_id::text
      AND n.role = 'dispatcher'
      AND n.title = 'Overflow Accepted'
      AND n.read = false
  );

  RETURN jsonb_build_object(
    'success', true,
    'ok', true,
    'event_id', p_event_id,
    'target_route_id', v_route_id,
    'route_id', v_route_id,
    'assigned_bin_ids', to_jsonb(v_bin_ids),
    'accepted_at', v_now,
    'bins_transferred', coalesce(array_length(v_bin_ids, 1), 0),
    'bins_skipped', v_skipped_bins,
    'dispatcher_notified', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_overflow_event(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_overflow_event(uuid, text, text, text) TO authenticated, service_role, postgres;

-- 9. Ensure full Realtime payload & publication coverage
ALTER TABLE public.overflow_events REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.overflow_events;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
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

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicles;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
END $$;

COMMIT;
