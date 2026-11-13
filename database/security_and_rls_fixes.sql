-- Migration: Critical Security, RLS, Vehicle Binding, and Schema Fixes (Section D.1 & D.2)
-- Idempotent migration script for Supabase SQL Editor.

BEGIN;

-- 1. Fix bins.collection_status malformed default and clean literal single-quoted values
ALTER TABLE public.bins
  ALTER COLUMN collection_status SET DEFAULT 'pending'::text;

UPDATE public.bins
SET collection_status = btrim(collection_status, '''')
WHERE collection_status LIKE '''%''';

-- 2. Remove hardcoded DEFAULT '1'::bigint from drivers.assigned_vehicle_id
ALTER TABLE public.drivers
  ALTER COLUMN assigned_vehicle_id DROP DEFAULT;

-- Sync drivers.assigned_vehicle_id with active/pending routes where available
UPDATE public.drivers d
SET assigned_vehicle_id = r.vehicle_id
FROM public.routes r
WHERE r.driver_id = d.id
  AND r.vehicle_id IS NOT NULL
  AND r.status IN ('pending'::public.route_status, 'planned'::public.route_status, 'active'::public.route_status);

-- 3. Allow authenticated truck drivers to UPDATE their assigned vehicle (load_percent, status, route_id)
DROP POLICY IF EXISTS "truck_drivers_update_assigned_vehicle" ON public.vehicles;
CREATE POLICY "truck_drivers_update_assigned_vehicle" ON public.vehicles
  FOR UPDATE
  TO authenticated
  USING (
    public.current_profile_is_active()
    AND public.current_app_role() = 'truck_driver'::text
    AND EXISTS (
      SELECT 1
      FROM public.drivers d
      WHERE d.auth_user_id = auth.uid()
        AND (
          vehicles.driver_id = d.id::text
          OR d.assigned_vehicle_id = vehicles.id
          OR EXISTS (
            SELECT 1
            FROM public.routes r
            WHERE r.driver_id = d.id
              AND r.vehicle_id = vehicles.id
              AND r.status IN ('pending'::public.route_status, 'planned'::public.route_status, 'active'::public.route_status)
          )
        )
    )
  )
  WITH CHECK (
    public.current_profile_is_active()
    AND public.current_app_role() = 'truck_driver'::text
  );

-- 4. Allow active truck drivers and supervisors to INSERT operational notifications
DROP POLICY IF EXISTS "admin dispatcher create notifications" ON public.notifications;
CREATE POLICY "admin dispatcher create notifications" ON public.notifications
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    public.current_profile_is_active()
    AND (public.current_app_role() = ANY (ARRAY['admin'::text, 'dispatcher'::text, 'supervisor'::text, 'truck_driver'::text]))
  );

DROP POLICY IF EXISTS "notifications_staff_insert" ON public.notifications;
CREATE POLICY "notifications_staff_insert" ON public.notifications
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.is_dispatcher(auth.uid())
    OR public.is_supervisor(auth.uid())
    OR public.is_driver(auth.uid())
  );

-- 5. Lock down user_profiles self-insert and self-update against privilege escalation
DROP POLICY IF EXISTS "profiles_self_insert" ON public.user_profiles;
CREATE POLICY "profiles_self_insert" ON public.user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth_user_id = auth.uid())
    AND (role = 'truck_driver'::public.app_role)
    AND (status = 'pending_approval'::public.account_status)
  );

DROP POLICY IF EXISTS "user_profiles_insert_self" ON public.user_profiles;
CREATE POLICY "user_profiles_insert_self" ON public.user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.uid() = auth_user_id)
    AND (role = 'truck_driver'::public.app_role)
    AND (status = 'pending_approval'::public.account_status)
  );

DROP POLICY IF EXISTS "profiles_self_update" ON public.user_profiles;
CREATE POLICY "profiles_self_update" ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (
    (auth_user_id = auth.uid())
    AND (
      public.is_admin(auth.uid())
      OR (
        role = (SELECT up.role FROM public.user_profiles up WHERE up.id = user_profiles.id)
        AND status = (SELECT up.status FROM public.user_profiles up WHERE up.id = user_profiles.id)
      )
    )
  );

DROP POLICY IF EXISTS "user_profiles_update_self" ON public.user_profiles;
CREATE POLICY "user_profiles_update_self" ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = auth_user_id)
  WITH CHECK (
    (auth.uid() = auth_user_id)
    AND (
      public.is_admin(auth.uid())
      OR (
        role = (SELECT up.role FROM public.user_profiles up WHERE up.id = user_profiles.id)
        AND status = (SELECT up.status FROM public.user_profiles up WHERE up.id = user_profiles.id)
      )
    )
  );

-- Trigger guard preventing non-admins from mutating role or status on user_profiles
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('role', true), '') NOT IN ('service_role', 'postgres')
     AND auth.uid() IS NOT NULL
     AND NOT public.is_admin(auth.uid()) THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Only administrators may change user roles.';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Only administrators may change account approval status.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_privilege_escalation ON public.user_profiles;
CREATE TRIGGER trg_prevent_profile_privilege_escalation
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_privilege_escalation();

-- 6. Lock down accept_overflow_event RPC execution permissions
REVOKE ALL ON FUNCTION public.accept_overflow_event(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_overflow_event(uuid, text, text, text) TO authenticated, service_role, postgres;

COMMIT;
