-- =============================================================================
-- EcoLoop: Fix Account Suspension Enum Handling & Permanent Account Deletion
-- Safe, non-destructive migration preserving routes, deliveries, reports & logs
-- =============================================================================

BEGIN;

-- 1. Ensure foreign keys referencing auth.users / drivers allow permanent
--    account deletion while preserving operational history & audit logs.

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_approved_by_fkey;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_approved_by_fkey
  FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.role_change_logs
  DROP CONSTRAINT IF EXISTS role_change_logs_changed_by_fkey;
ALTER TABLE public.role_change_logs
  ADD CONSTRAINT role_change_logs_changed_by_fkey
  FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.routes
  DROP CONSTRAINT IF EXISTS routes_generated_by_fkey;
ALTER TABLE public.routes
  ADD CONSTRAINT routes_generated_by_fkey
  FOREIGN KEY (generated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.delivery_status_logs
  DROP CONSTRAINT IF EXISTS delivery_status_logs_changed_by_fkey;
ALTER TABLE public.delivery_status_logs
  ADD CONSTRAINT delivery_status_logs_changed_by_fkey
  FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.deliveries
  ALTER COLUMN driver_id DROP NOT NULL;

ALTER TABLE public.deliveries
  DROP CONSTRAINT IF EXISTS deliveries_driver_id_fkey;
ALTER TABLE public.deliveries
  ADD CONSTRAINT deliveries_driver_id_fkey
  FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL;

-- 2. Fix driver profile synchronization trigger:
--    - Never write invalid enum values into public.drivers.status.
--    - Never overwrite existing drivers.status to 'offline' on suspension or
--      reactivation; account access is controlled via user_profiles.status.

CREATE OR REPLACE FUNCTION public.sync_driver_from_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
  v_phone text;
  v_unlinked_driver_id bigint;
BEGIN
  IF NEW.auth_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_name := COALESCE(NULLIF(btrim(NEW.full_name), ''), split_part(COALESCE(NEW.email, ''), '@', 1), 'Truck Driver');
  v_phone := COALESCE(NULLIF(btrim(NEW.phone), ''), NULLIF(btrim(NEW.phone_number), ''));

  IF NEW.role = 'truck_driver'::public.app_role THEN
    UPDATE public.drivers
    SET
      auth_user_id = NEW.auth_user_id,
      profile_id = NEW.id,
      name = COALESCE(v_name, name),
      phone = COALESCE(v_phone, phone),
      phone_number = COALESCE(v_phone, phone_number),
      address = COALESCE(NEW.address, address),
      status = CASE
        WHEN TG_OP = 'UPDATE'
             AND OLD.status = 'pending_approval'::public.account_status
             AND NEW.status = 'active'::public.account_status
             AND status = 'offline'::public.driver_status
          THEN 'available'::public.driver_status
        ELSE status
      END,
      updated_at = timezone('utc'::text, now())
    WHERE auth_user_id = NEW.auth_user_id
       OR profile_id = NEW.id;

    IF NOT FOUND THEN
      SELECT id INTO v_unlinked_driver_id
      FROM public.drivers
      WHERE auth_user_id IS NULL
        AND profile_id IS NULL
        AND lower(btrim(name)) = lower(btrim(v_name))
      ORDER BY id
      LIMIT 1;

      IF v_unlinked_driver_id IS NOT NULL THEN
        UPDATE public.drivers
        SET
          auth_user_id = NEW.auth_user_id,
          profile_id = NEW.id,
          name = v_name,
          phone = COALESCE(v_phone, phone),
          phone_number = COALESCE(v_phone, phone_number),
          address = COALESCE(NEW.address, address),
          status = CASE
            WHEN status = 'offline'::public.driver_status
                 AND NEW.status = 'active'::public.account_status
              THEN 'available'::public.driver_status
            ELSE status
          END,
          updated_at = timezone('utc'::text, now())
        WHERE id = v_unlinked_driver_id;
      ELSE
        INSERT INTO public.drivers (
          auth_user_id,
          profile_id,
          name,
          status,
          phone,
          phone_number,
          address,
          assigned_vehicle_id
        )
        VALUES (
          NEW.auth_user_id,
          NEW.id,
          v_name,
          CASE
            WHEN NEW.status IN ('inactive'::public.account_status, 'suspended'::public.account_status)
              THEN 'offline'::public.driver_status
            ELSE 'available'::public.driver_status
          END,
          v_phone,
          v_phone,
          NEW.address,
          NULL
        )
        ON CONFLICT (auth_user_id) DO UPDATE
        SET
          profile_id = EXCLUDED.profile_id,
          name = EXCLUDED.name,
          phone = COALESCE(EXCLUDED.phone, public.drivers.phone),
          phone_number = COALESCE(EXCLUDED.phone_number, public.drivers.phone_number),
          address = COALESCE(EXCLUDED.address, public.drivers.address),
          updated_at = timezone('utc'::text, now());
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Admin RPC to suspend or reactivate an account atomically:
--    - Updates user_profiles.status ('suspended' <-> 'active')
--    - Leaves drivers.status, routes, deliveries, and reports completely intact
--    - Revokes active sessions & refresh tokens on suspension so user cannot
--      remain signed in or refresh their JWT

CREATE OR REPLACE FUNCTION public.admin_suspend_user_account(
  p_auth_user_id uuid,
  p_suspend boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_profile public.user_profiles%ROWTYPE;
  v_next_status public.account_status;
  v_other_active_admins integer := 0;
  v_now timestamptz := timezone('utc'::text, now());
BEGIN
  IF NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Only active administrators can suspend or reactivate user accounts.'
      USING ERRCODE = '42501';
  END IF;

  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user account ID is required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.user_profiles
  WHERE auth_user_id = p_auth_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User account profile was not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_suspend AND p_auth_user_id = v_actor_id THEN
    RAISE EXCEPTION 'You cannot suspend your own administrator account.'
      USING ERRCODE = '42501';
  END IF;

  IF p_suspend
     AND v_profile.role = 'admin'::public.app_role
     AND v_profile.status = 'active'::public.account_status THEN
    SELECT count(*)
    INTO v_other_active_admins
    FROM public.user_profiles
    WHERE role = 'admin'::public.app_role
      AND status = 'active'::public.account_status
      AND auth_user_id <> p_auth_user_id;

    IF v_other_active_admins = 0 THEN
      RAISE EXCEPTION 'Cannot suspend the last active administrator account.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_next_status := CASE
    WHEN p_suspend THEN 'suspended'::public.account_status
    ELSE 'active'::public.account_status
  END;

  UPDATE public.user_profiles
  SET
    status = v_next_status,
    approved_at = CASE
      WHEN NOT p_suspend THEN COALESCE(approved_at, v_now)
      ELSE approved_at
    END,
    approved_by = CASE
      WHEN NOT p_suspend THEN COALESCE(approved_by, v_actor_id)
      ELSE approved_by
    END,
    updated_at = v_now
  WHERE id = v_profile.id;

  IF p_suspend THEN
    UPDATE auth.refresh_tokens
    SET revoked = true, updated_at = v_now
    WHERE user_id = p_auth_user_id::text
      AND COALESCE(revoked, false) = false;

    DELETE FROM auth.sessions
    WHERE user_id = p_auth_user_id;

    DELETE FROM public.vehicle_locations_latest
    WHERE driver_id IN (
      SELECT id
      FROM public.drivers
      WHERE auth_user_id = p_auth_user_id
         OR profile_id = v_profile.id
    );
  END IF;

  INSERT INTO public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data,
    metadata
  )
  VALUES (
    v_actor_id,
    'admin'::public.app_role,
    CASE WHEN p_suspend THEN 'ACCOUNT_SUSPENDED' ELSE 'ACCOUNT_REACTIVATED' END,
    'user_profiles',
    p_auth_user_id::text,
    jsonb_build_object(
      'status', v_profile.status,
      'role', v_profile.role,
      'email', v_profile.email,
      'full_name', v_profile.full_name
    ),
    jsonb_build_object(
      'status', v_next_status,
      'role', v_profile.role,
      'email', v_profile.email,
      'full_name', v_profile.full_name
    ),
    jsonb_build_object('source', 'admin_suspend_user_account')
  );

  RETURN jsonb_build_object(
    'success', true,
    'auth_user_id', p_auth_user_id,
    'status', v_next_status,
    'email', v_profile.email,
    'full_name', v_profile.full_name,
    'role', v_profile.role
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_suspend_user_account(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_suspend_user_account(uuid, boolean) TO authenticated;

-- 4. Admin RPC to permanently delete an account atomically:
--    - Blocks self-deletion & deleting the last active administrator
--    - Preserves historical routes, deliveries, delivery logs, waste reports,
--      maintenance records, overflow events, GPS logs & audit logs
--    - Removes auth.users, user_profiles, drivers, notifications, sessions & tokens

CREATE OR REPLACE FUNCTION public.admin_delete_user_account(
  p_auth_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_profile public.user_profiles%ROWTYPE;
  v_has_profile boolean := false;
  v_auth_email text;
  v_has_auth_user boolean := false;
  v_other_active_admins integer := 0;
  v_driver_ids bigint[];
  v_now timestamptz := timezone('utc'::text, now());
BEGIN
  IF NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Only active administrators can permanently delete user accounts.'
      USING ERRCODE = '42501';
  END IF;

  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user account ID is required.'
      USING ERRCODE = '22023';
  END IF;

  IF p_auth_user_id = v_actor_id THEN
    RAISE EXCEPTION 'You cannot delete your own administrator account while signed in.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.user_profiles
  WHERE auth_user_id = p_auth_user_id
  FOR UPDATE;
  v_has_profile := FOUND;

  SELECT email
  INTO v_auth_email
  FROM auth.users
  WHERE id = p_auth_user_id
  FOR UPDATE;
  v_has_auth_user := FOUND;

  IF NOT v_has_profile AND NOT v_has_auth_user THEN
    RAISE EXCEPTION 'Target user account was not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_has_profile
     AND v_profile.role = 'admin'::public.app_role
     AND v_profile.status = 'active'::public.account_status THEN
    SELECT count(*)
    INTO v_other_active_admins
    FROM public.user_profiles
    WHERE role = 'admin'::public.app_role
      AND status = 'active'::public.account_status
      AND auth_user_id <> p_auth_user_id;

    IF v_other_active_admins = 0 THEN
      RAISE EXCEPTION 'Cannot permanently delete the last active administrator account.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT array_agg(id)
  INTO v_driver_ids
  FROM public.drivers
  WHERE auth_user_id = p_auth_user_id
     OR (v_has_profile AND profile_id = v_profile.id);

  IF v_driver_ids IS NOT NULL AND array_length(v_driver_ids, 1) > 0 THEN
    -- Unassign vehicles linked to the deleted driver without deleting vehicles
    UPDATE public.vehicles
    SET
      driver_id = NULL,
      updated_at = v_now
    WHERE driver_id = ANY (
      SELECT d_id::text
      FROM unnest(v_driver_ids) AS d_id
    );

    -- Remove active live location ping for deleted driver(s)
    DELETE FROM public.vehicle_locations_latest
    WHERE driver_id = ANY (v_driver_ids);

    -- Detach active/planned/pending routes from deleted driver so routes remain valid;
    -- completed/cancelled routes keep their historical records with driver_id set to NULL
    UPDATE public.routes
    SET
      driver_id = NULL,
      status = CASE
        WHEN status = 'active'::public.route_status THEN 'pending'::public.route_status
        ELSE status
      END,
      assignment_updated_at = v_now,
      updated_at = v_now
    WHERE driver_id = ANY (v_driver_ids)
      AND status IN ('active'::public.route_status, 'planned'::public.route_status, 'pending'::public.route_status);

    -- Preserve original_driver_id on historical deliveries before detaching driver_id
    UPDATE public.deliveries
    SET original_driver_id = COALESCE(original_driver_id, driver_id)
    WHERE driver_id = ANY (v_driver_ids)
      AND original_driver_id IS NULL;

    -- Remove driver rows explicitly so deliveries.driver_id / routes.driver_id SET NULL triggers cleanly
    DELETE FROM public.drivers
    WHERE id = ANY (v_driver_ids);
  END IF;

  -- Remove user-owned notifications & signup error logs
  DELETE FROM public.notifications
  WHERE user_id = p_auth_user_id
     OR user_auth_id = p_auth_user_id;

  DELETE FROM public.auth_signup_errors
  WHERE auth_user_id = p_auth_user_id
     OR (
       COALESCE(v_profile.email, v_auth_email) IS NOT NULL
       AND lower(email) = lower(COALESCE(v_profile.email, v_auth_email))
     );

  -- Record permanent deletion in audit_logs while operational history remains intact
  INSERT INTO public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data,
    metadata
  )
  VALUES (
    v_actor_id,
    'admin'::public.app_role,
    'ACCOUNT_DELETED',
    'user_profiles',
    p_auth_user_id::text,
    jsonb_build_object(
      'auth_user_id', p_auth_user_id,
      'email', COALESCE(v_profile.email, v_auth_email),
      'full_name', v_profile.full_name,
      'role', v_profile.role,
      'status', v_profile.status,
      'driver_ids', COALESCE(to_jsonb(v_driver_ids), '[]'::jsonb)
    ),
    NULL,
    jsonb_build_object('source', 'admin_delete_user_account', 'permanent', true)
  );

  -- Revoke tokens, remove auth sessions, delete profile and auth.users row
  UPDATE auth.refresh_tokens
  SET revoked = true, updated_at = v_now
  WHERE user_id = p_auth_user_id::text;

  DELETE FROM auth.sessions
  WHERE user_id = p_auth_user_id;

  DELETE FROM public.user_profiles
  WHERE auth_user_id = p_auth_user_id;

  IF v_has_auth_user THEN
    DELETE FROM auth.users
    WHERE id = p_auth_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_auth_user_id', p_auth_user_id,
    'email', COALESCE(v_profile.email, v_auth_email),
    'full_name', v_profile.full_name,
    'role', v_profile.role
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_user_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user_account(uuid) TO authenticated;

COMMIT;
