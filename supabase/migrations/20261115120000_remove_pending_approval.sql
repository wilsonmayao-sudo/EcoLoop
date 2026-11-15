-- =============================================================================
-- EcoLoop: Remove Entire Pending Approval Feature
-- =============================================================================
-- 1. Activates any legacy pending_approval rows (if present).
-- 2. Drops approve_user_profile() RPC (approval-exclusive).
-- 3. Drops user_profiles.approved_by, approved_at, rejected_reason and FK.
-- 4. Removes 'pending_approval' from public.account_status enum cleanly.
-- 5. Updates RLS policies and auth/profile functions/triggers so all
--    authorized users access the system immediately without admin approval,
--    while keeping role checks, suspension/reactivation, and deletion intact.
-- =============================================================================

BEGIN;

-- 1. Ensure no rows retain pending_approval before enum replacement
UPDATE public.user_profiles
SET
  status = 'active'::public.account_status,
  updated_at = timezone('utc'::text, now())
WHERE status::text = 'pending_approval';

-- 2. Drop approval-only RPC
DROP FUNCTION IF EXISTS public.approve_user_profile(uuid, public.app_role);

-- 3. Drop approval-only columns and foreign key on user_profiles
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_approved_by_fkey;

ALTER TABLE public.user_profiles
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS rejected_reason;

-- 4. Drop policies referencing pending_approval before replacing account_status
DROP POLICY IF EXISTS "profiles_self_insert" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_insert_self" ON public.user_profiles;

-- 5. Replace public.account_status enum without 'pending_approval'
ALTER TABLE public.user_profiles
  ALTER COLUMN status DROP DEFAULT;

CREATE TYPE public.account_status_new AS ENUM (
  'active',
  'suspended',
  'inactive'
);

ALTER TABLE public.user_profiles
  ALTER COLUMN status TYPE public.account_status_new
  USING (
    CASE
      WHEN status::text = 'pending_approval' THEN 'active'
      ELSE status::text
    END
  )::public.account_status_new;

DROP TYPE public.account_status;
ALTER TYPE public.account_status_new RENAME TO account_status;

ALTER TABLE public.user_profiles
  ALTER COLUMN status SET DEFAULT 'active'::public.account_status;

-- 6. Recreate self-insert RLS policies requiring active truck_driver status
CREATE POLICY "profiles_self_insert" ON public.user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth_user_id = auth.uid())
    AND (role = 'truck_driver'::public.app_role)
    AND (status = 'active'::public.account_status)
  );

CREATE POLICY "user_profiles_insert_self" ON public.user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.uid() = auth_user_id)
    AND (role = 'truck_driver'::public.app_role)
    AND (status = 'active'::public.account_status)
  );

-- 7. Refresh helper functions referencing public.account_status
CREATE OR REPLACE FUNCTION public.has_active_role(required_role public.app_role)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE auth_user_id = auth.uid()
      AND role = required_role
      AND status = 'active'::public.account_status
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_active_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE auth_user_id = auth.uid()
      AND role = 'admin'::public.app_role
      AND status = 'active'::public.account_status
  );
$function$;

-- 8. Update auth signup trigger function: all authorized users activate immediately
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  requested_role text := lower(btrim(coalesce(nullif(metadata->>'role', ''), 'truck_driver')));
  profile_role public.app_role;
  profile_status public.account_status := 'active'::public.account_status;
  profile_name text := coalesce(nullif(btrim(metadata->>'full_name'), ''), split_part(new.email, '@', 1), 'Truck Driver');
  profile_phone text := coalesce(nullif(btrim(metadata->>'phone_number'), ''), nullif(btrim(metadata->>'contact_number'), ''), nullif(btrim(metadata->>'phone'), ''));
  profile_address text := nullif(btrim(metadata->>'address'), '');
  v_profile_id uuid;
BEGIN
  profile_role := CASE
    WHEN requested_role IN ('admin', 'dispatcher', 'supervisor', 'truck_driver') THEN requested_role::public.app_role
    ELSE 'truck_driver'::public.app_role
  END;

  BEGIN
    UPDATE public.user_profiles
    SET
      full_name = COALESCE(NULLIF(profile_name, ''), full_name),
      email = new.email,
      role = profile_role,
      status = CASE
        WHEN status IN ('suspended'::public.account_status, 'inactive'::public.account_status) THEN status
        ELSE profile_status
      END,
      phone = COALESCE(profile_phone, phone),
      phone_number = COALESCE(profile_phone, phone_number),
      address = COALESCE(profile_address, address),
      updated_at = timezone('utc'::text, now())
    WHERE auth_user_id = new.id
    RETURNING id INTO v_profile_id;

    IF NOT FOUND THEN
      INSERT INTO public.user_profiles (
        auth_user_id,
        full_name,
        email,
        role,
        status,
        phone,
        phone_number,
        address
      )
      VALUES (
        new.id,
        profile_name,
        new.email,
        profile_role,
        profile_status,
        profile_phone,
        profile_phone,
        profile_address
      )
      RETURNING id INTO v_profile_id;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO public.auth_signup_errors (auth_user_id, email, error_message)
      VALUES (new.id, new.email, 'user_profiles sync failed: ' || sqlerrm);
  END;

  IF profile_role = 'truck_driver'::public.app_role THEN
    BEGIN
      UPDATE public.drivers
      SET
        profile_id = COALESCE(v_profile_id, profile_id),
        name = COALESCE(NULLIF(profile_name, ''), name),
        phone = COALESCE(profile_phone, phone),
        phone_number = COALESCE(profile_phone, phone_number),
        address = COALESCE(profile_address, address),
        updated_at = timezone('utc'::text, now())
      WHERE auth_user_id = new.id;

      IF NOT FOUND THEN
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
          new.id,
          v_profile_id,
          profile_name,
          'available'::public.driver_status,
          profile_phone,
          profile_phone,
          profile_address,
          NULL
        );
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        INSERT INTO public.auth_signup_errors (auth_user_id, email, error_message)
        VALUES (new.id, new.email, 'drivers sync failed: ' || sqlerrm);
    END;
  END IF;

  RETURN new;
END;
$function$;

-- 9. Update ensure_current_driver_account RPC without pending_approval / approved_at
CREATE OR REPLACE FUNCTION public.ensure_current_driver_account()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_auth record;
  v_profile public.user_profiles%ROWTYPE;
  v_driver public.drivers%ROWTYPE;
  v_meta jsonb;
  v_requested_role text;
  v_name text;
  v_phone text;
  v_address text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, email, raw_user_meta_data
  INTO v_auth
  FROM auth.users
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authenticated user not found';
  END IF;

  v_meta := coalesce(v_auth.raw_user_meta_data, '{}'::jsonb);
  v_requested_role := lower(btrim(coalesce(nullif(v_meta->>'role', ''), 'truck_driver')));
  v_name := coalesce(nullif(btrim(v_meta->>'full_name'), ''), split_part(v_auth.email, '@', 1), 'Truck Driver');
  v_phone := coalesce(nullif(btrim(v_meta->>'phone_number'), ''), nullif(btrim(v_meta->>'contact_number'), ''), nullif(btrim(v_meta->>'phone'), ''));
  v_address := nullif(btrim(v_meta->>'address'), '');

  SELECT *
  INTO v_profile
  FROM public.user_profiles
  WHERE auth_user_id = v_uid
  LIMIT 1;

  IF NOT FOUND THEN
    IF v_requested_role <> 'truck_driver' THEN
      RETURN jsonb_build_object('profile', NULL, 'driver', NULL);
    END IF;

    INSERT INTO public.user_profiles (
      auth_user_id,
      full_name,
      email,
      role,
      status,
      phone,
      phone_number,
      address
    )
    VALUES (
      v_uid,
      v_name,
      v_auth.email,
      'truck_driver'::public.app_role,
      'active'::public.account_status,
      v_phone,
      v_phone,
      v_address
    )
    RETURNING * INTO v_profile;
  END IF;

  IF v_profile.role = 'truck_driver'::public.app_role AND v_profile.status = 'active'::public.account_status THEN
    SELECT *
    INTO v_driver
    FROM public.drivers
    WHERE auth_user_id = v_uid
    LIMIT 1;

    IF NOT FOUND THEN
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
        v_uid,
        v_profile.id,
        COALESCE(NULLIF(btrim(v_profile.full_name), ''), v_name),
        'available'::public.driver_status,
        COALESCE(v_profile.phone, v_profile.phone_number, v_phone),
        COALESCE(v_profile.phone_number, v_profile.phone, v_phone),
        COALESCE(v_profile.address, v_address),
        NULL
      )
      RETURNING * INTO v_driver;
    ELSIF v_driver.profile_id IS NULL THEN
      UPDATE public.drivers
      SET
        profile_id = v_profile.id,
        updated_at = timezone('utc'::text, now())
      WHERE id = v_driver.id
      RETURNING * INTO v_driver;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'driver', CASE WHEN v_driver.id IS NOT NULL THEN to_jsonb(v_driver) ELSE NULL END
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ensure_current_driver_account() TO authenticated, service_role;

-- 10. Update profile triggers to remove pending_approval / approved_at references
CREATE OR REPLACE FUNCTION public.normalize_truck_driver_profile()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.phone IS NOT NULL AND NEW.phone_number IS NULL THEN
    NEW.phone_number := NEW.phone;
  ELSIF NEW.phone_number IS NOT NULL AND NEW.phone IS NULL THEN
    NEW.phone := NEW.phone_number;
  END IF;

  RETURN NEW;
END;
$function$;

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

-- 11. Update admin_suspend_user_account to remove approved_at / approved_by writes
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

-- 12. Remove any legacy user-approvals permission rows
DELETE FROM public.role_permissions
WHERE page = 'user-approvals';

COMMIT;
