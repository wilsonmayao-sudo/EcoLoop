-- ============================================================================
-- Enforce Strict Dispatcher Fleet Registry Permissions
-- ============================================================================
-- Admin retains full control over the Fleet Registry (vehicles & maintenance).
-- Dispatcher is restricted strictly to viewing fleet records and assigning /
-- changing drivers assigned to trucks (plus route_id linking during routing).
-- Database RLS, column-level BEFORE UPDATE triggers, and atomic RPC enforce
-- these boundaries even against direct REST / PostgREST mutations.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.auth_user_id = uid
      AND up.role = 'admin'::public.app_role
      AND up.status = 'active'::public.account_status
  );
$function$;

GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO PUBLIC, anon, authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.is_dispatcher(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.auth_user_id = uid
      AND up.role = 'dispatcher'::public.app_role
      AND up.status = 'active'::public.account_status
  );
$function$;

GRANT EXECUTE ON FUNCTION public.is_dispatcher(uuid) TO PUBLIC, anon, authenticated, service_role, postgres;

-- 1. public.vehicles: Admin full control; Dispatcher SELECT + scoped driver UPDATE only
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vehicles TO authenticated;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.vehicles_id_seq TO authenticated;

DROP POLICY IF EXISTS "admins manage vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "vehicles_admin_only" ON public.vehicles;
DROP POLICY IF EXISTS "vehicles_insert_admin" ON public.vehicles;
DROP POLICY IF EXISTS "vehicles_update_admin" ON public.vehicles;
DROP POLICY IF EXISTS "vehicles_delete_admin" ON public.vehicles;
DROP POLICY IF EXISTS "dispatchers update vehicle driver" ON public.vehicles;
DROP POLICY IF EXISTS "dispatchers manage vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "vehicles_admin_dispatcher_manage" ON public.vehicles;
DROP POLICY IF EXISTS "vehicles_admin_manage" ON public.vehicles;
DROP POLICY IF EXISTS "vehicles_dispatcher_assign_driver" ON public.vehicles;
DROP POLICY IF EXISTS "active web staff read vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "vehicles_read_staff" ON public.vehicles;

CREATE POLICY "active web staff read vehicles" ON public.vehicles
  FOR SELECT
  TO authenticated
  USING (
    public.current_profile_is_active()
    AND public.current_app_role() = ANY (ARRAY['admin'::text, 'dispatcher'::text, 'supervisor'::text])
  );

CREATE POLICY "vehicles_read_staff" ON public.vehicles
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_dispatcher(auth.uid())
    OR public.is_supervisor(auth.uid())
    OR public.is_driver(auth.uid())
  );

CREATE POLICY "vehicles_admin_manage" ON public.vehicles
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "vehicles_dispatcher_assign_driver" ON public.vehicles
  FOR UPDATE
  TO authenticated
  USING (public.is_dispatcher(auth.uid()))
  WITH CHECK (public.is_dispatcher(auth.uid()));

CREATE OR REPLACE FUNCTION public.enforce_dispatcher_vehicle_update_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF public.is_dispatcher(auth.uid()) THEN
    IF NEW.code IS DISTINCT FROM OLD.code
      OR NEW.truck_code IS DISTINCT FROM OLD.truck_code
      OR NEW.plate_number IS DISTINCT FROM OLD.plate_number
      OR NEW.label IS DISTINCT FROM OLD.label
      OR NEW.model IS DISTINCT FROM OLD.model
      OR NEW.capacity_liters IS DISTINCT FROM OLD.capacity_liters
      OR NEW.capacity_kg IS DISTINCT FROM OLD.capacity_kg
      OR NEW.current_odometer_km IS DISTINCT FROM OLD.current_odometer_km
      OR NEW.is_active IS DISTINCT FROM OLD.is_active
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.fuel_percent IS DISTINCT FROM OLD.fuel_percent
      OR NEW.load_percent IS DISTINCT FROM OLD.load_percent
      OR NEW.latitude IS DISTINCT FROM OLD.latitude
      OR NEW.longitude IS DISTINCT FROM OLD.longitude
      OR NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Dispatchers are only permitted to assign or change drivers on trucks.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_dispatcher_vehicle_update_scope ON public.vehicles;
CREATE TRIGGER trg_enforce_dispatcher_vehicle_update_scope
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_dispatcher_vehicle_update_scope();

-- 2. public.maintenance_records: Admin write/manage only; staff read-only
ALTER TABLE public.maintenance_records ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_records TO authenticated;

DROP POLICY IF EXISTS "dispatchers manage maintenance" ON public.maintenance_records;
DROP POLICY IF EXISTS "admins manage maintenance" ON public.maintenance_records;
DROP POLICY IF EXISTS "maintenance_admin_only" ON public.maintenance_records;
DROP POLICY IF EXISTS "active web staff read maintenance" ON public.maintenance_records;

CREATE POLICY "active web staff read maintenance" ON public.maintenance_records
  FOR SELECT
  TO authenticated
  USING (
    public.current_profile_is_active()
    AND public.current_app_role() = ANY (ARRAY['admin'::text, 'dispatcher'::text, 'supervisor'::text])
  );

CREATE POLICY "admins manage maintenance" ON public.maintenance_records
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 3. public.drivers: Admin full manage; Dispatcher scoped assigned_vehicle_id update only
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.drivers TO authenticated;

DROP POLICY IF EXISTS "drivers_admin_dispatcher_manage" ON public.drivers;
DROP POLICY IF EXISTS "drivers_admin_manage" ON public.drivers;
DROP POLICY IF EXISTS "drivers_dispatcher_assign_vehicle" ON public.drivers;

CREATE POLICY "drivers_admin_manage" ON public.drivers
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "drivers_dispatcher_assign_vehicle" ON public.drivers
  FOR UPDATE
  TO authenticated
  USING (public.is_dispatcher(auth.uid()))
  WITH CHECK (public.is_dispatcher(auth.uid()));

CREATE OR REPLACE FUNCTION public.enforce_dispatcher_driver_update_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF public.is_dispatcher(auth.uid()) THEN
    IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
      OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.phone IS DISTINCT FROM OLD.phone
      OR NEW.phone_number IS DISTINCT FROM OLD.phone_number
      OR NEW.address IS DISTINCT FROM OLD.address
      OR NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Dispatchers are only permitted to update assigned vehicles for drivers.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_dispatcher_driver_update_scope ON public.drivers;
CREATE TRIGGER trg_enforce_dispatcher_driver_update_scope
  BEFORE UPDATE ON public.drivers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_dispatcher_driver_update_scope();

-- 4. Atomic RPC for vehicle <-> driver assignment (Admin & Dispatcher only)
CREATE OR REPLACE FUNCTION public.assign_vehicle_driver(
  p_vehicle_id bigint,
  p_driver_id  bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_vehicle_exists boolean;
  v_driver_exists  boolean;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.is_dispatcher(auth.uid())) THEN
    RAISE EXCEPTION 'Only Administrators and Dispatchers can assign drivers to trucks.'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.vehicles WHERE id = p_vehicle_id)
    INTO v_vehicle_exists;
  IF NOT v_vehicle_exists THEN
    RAISE EXCEPTION 'Vehicle % not found.', p_vehicle_id USING ERRCODE = 'P0002';
  END IF;

  IF p_driver_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id)
      INTO v_driver_exists;
    IF NOT v_driver_exists THEN
      RAISE EXCEPTION 'Driver % not found.', p_driver_id USING ERRCODE = 'P0002';
    END IF;
  END IF;

  UPDATE public.drivers
  SET assigned_vehicle_id = NULL,
      updated_at = now()
  WHERE assigned_vehicle_id = p_vehicle_id;

  IF p_driver_id IS NOT NULL THEN
    UPDATE public.vehicles
    SET driver_id = NULL,
        updated_at = now()
    WHERE driver_id = p_driver_id::text
      AND id <> p_vehicle_id;
  END IF;

  UPDATE public.vehicles
  SET driver_id = CASE WHEN p_driver_id IS NULL THEN NULL ELSE p_driver_id::text END,
      updated_at = now()
  WHERE id = p_vehicle_id;

  IF p_driver_id IS NOT NULL THEN
    UPDATE public.drivers
    SET assigned_vehicle_id = p_vehicle_id,
        updated_at = now()
    WHERE id = p_driver_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'vehicle_id', p_vehicle_id,
    'driver_id', p_driver_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.assign_vehicle_driver(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_vehicle_driver(bigint, bigint) TO authenticated, service_role;

-- 5. Align role_permissions metadata while keeping Admin-only modules restricted
INSERT INTO public.role_permissions (role, page, can_read, can_create, can_update, can_delete)
VALUES
  ('admin', 'live-monitoring', true, true, true, true),
  ('dispatcher', 'live-monitoring', true, false, true, false),
  ('supervisor', 'live-monitoring', true, false, false, false)
ON CONFLICT (role, page) DO UPDATE
SET
  can_read = EXCLUDED.can_read,
  can_create = EXCLUDED.can_create,
  can_update = EXCLUDED.can_update,
  can_delete = EXCLUDED.can_delete,
  updated_at = now();

DELETE FROM public.role_permissions
WHERE role IN ('dispatcher', 'supervisor')
  AND page IN ('users', 'system-settings');

COMMIT;
