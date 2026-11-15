-- =============================================================================
-- EcoLoop: Remove Truck Driver Waiting-for-Approval Requirement
-- =============================================================================
-- Fixes:
-- 1. public.drivers.assigned_vehicle_id had DEFAULT '1'::bigint on production,
--    causing INSERT INTO public.drivers to fail with FK violation
--    drivers_assigned_vehicle_id_fkey when vehicle id=1 does not exist.
-- 2. public.handle_new_auth_user() declared profile_status as text instead of
--    public.account_status (causing user_profiles insert/update to fail with
--    type mismatch) and set truck_driver accounts to 'pending_approval'.
-- 3. Newly registered truck_driver accounts are now created immediately as
--    status = 'active' with a linked public.drivers row (status = 'available').
-- 4. Provides public.ensure_current_driver_account() so authenticated truck
--    drivers can self-heal missing/pending profile or driver rows on login
--    without weakening RBAC for non-driver roles or suspended accounts.
-- 5. Backfills existing truck_driver accounts that are pending_approval or
--    missing their public.drivers record (without modifying admin, dispatcher,
--    or supervisor statuses).
-- =============================================================================

BEGIN;

-- 1. Remove invalid default vehicle ID on public.drivers
ALTER TABLE public.drivers
  ALTER COLUMN assigned_vehicle_id SET DEFAULT NULL;

-- 2. Update default status on public.user_profiles to 'active'
ALTER TABLE public.user_profiles
  ALTER COLUMN status SET DEFAULT 'active'::public.account_status;

-- 3. Update self-insert RLS policies on public.user_profiles and public.drivers
DROP POLICY IF EXISTS "user_profiles_insert_self" ON public.user_profiles;
CREATE POLICY "user_profiles_insert_self" ON public.user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.uid() = auth_user_id)
    AND (
      (role = 'truck_driver'::public.app_role AND status = ANY (ARRAY['active'::public.account_status, 'pending_approval'::public.account_status]))
      OR (status = 'pending_approval'::public.account_status)
    )
  );

DROP POLICY IF EXISTS "profiles_self_insert" ON public.user_profiles;
CREATE POLICY "profiles_self_insert" ON public.user_profiles
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    (auth_user_id = auth.uid())
    AND (role = ANY (ARRAY['admin'::public.app_role, 'dispatcher'::public.app_role, 'supervisor'::public.app_role, 'truck_driver'::public.app_role]))
    AND (status = ANY (ARRAY['pending_approval'::public.account_status, 'active'::public.account_status]))
  );

DROP POLICY IF EXISTS "truck drivers insert own driver record" ON public.drivers;
CREATE POLICY "truck drivers insert own driver record" ON public.drivers
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    public.current_profile_is_active()
    AND (public.current_app_role() = 'truck_driver'::text)
    AND (auth_user_id = auth.uid())
  );

-- 4. Fix public.handle_new_auth_user() trigger function
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
  profile_status public.account_status;
  profile_approved_at timestamptz;
  profile_name text := coalesce(nullif(btrim(metadata->>'full_name'), ''), split_part(new.email, '@', 1), 'Truck Driver');
  profile_phone text := coalesce(nullif(btrim(metadata->>'phone_number'), ''), nullif(btrim(metadata->>'contact_number'), ''), nullif(btrim(metadata->>'phone'), ''));
  profile_address text := nullif(btrim(metadata->>'address'), '');
  v_profile_id uuid;
BEGIN
  profile_role := CASE
    WHEN requested_role IN ('admin', 'dispatcher', 'supervisor', 'truck_driver') THEN requested_role::public.app_role
    ELSE 'truck_driver'::public.app_role
  END;

  IF profile_role = 'truck_driver'::public.app_role THEN
    profile_status := 'active'::public.account_status;
    profile_approved_at := timezone('utc'::text, now());
  ELSE
    profile_status := 'pending_approval'::public.account_status;
    profile_approved_at := NULL;
  END IF;

  BEGIN
    UPDATE public.user_profiles
    SET
      full_name = COALESCE(NULLIF(profile_name, ''), full_name),
      email = new.email,
      role = profile_role,
      status = CASE
        WHEN status = 'active'::public.account_status THEN status
        ELSE profile_status
      END,
      phone = COALESCE(profile_phone, phone),
      phone_number = COALESCE(profile_phone, phone_number),
      address = COALESCE(profile_address, address),
      approved_at = COALESCE(approved_at, profile_approved_at),
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
        address,
        approved_at
      )
      VALUES (
        new.id,
        profile_name,
        new.email,
        profile_role,
        profile_status,
        profile_phone,
        profile_phone,
        profile_address,
        profile_approved_at
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

-- 5. Helper RPC for MobileApp / WebApp to ensure current truck_driver account is active & linked
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
      address,
      approved_at
    )
    VALUES (
      v_uid,
      v_name,
      v_auth.email,
      'truck_driver'::public.app_role,
      'active'::public.account_status,
      v_phone,
      v_phone,
      v_address,
      timezone('utc'::text, now())
    )
    RETURNING * INTO v_profile;
  ELSIF v_profile.role = 'truck_driver'::public.app_role AND v_profile.status = 'pending_approval'::public.account_status THEN
    UPDATE public.user_profiles
    SET
      status = 'active'::public.account_status,
      approved_at = COALESCE(approved_at, timezone('utc'::text, now())),
      phone = COALESCE(v_profile.phone, v_phone),
      phone_number = COALESCE(v_profile.phone_number, v_phone),
      address = COALESCE(v_profile.address, v_address),
      updated_at = timezone('utc'::text, now())
    WHERE id = v_profile.id
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

-- 6. Backfill any auth.users with role='truck_driver' that are missing a user_profiles row
INSERT INTO public.user_profiles (
  auth_user_id,
  full_name,
  email,
  role,
  status,
  phone,
  phone_number,
  address,
  approved_at
)
SELECT
  u.id,
  COALESCE(NULLIF(btrim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1), 'Truck Driver'),
  u.email,
  'truck_driver'::public.app_role,
  'active'::public.account_status,
  COALESCE(NULLIF(btrim(u.raw_user_meta_data->>'phone_number'), ''), NULLIF(btrim(u.raw_user_meta_data->>'contact_number'), '')),
  COALESCE(NULLIF(btrim(u.raw_user_meta_data->>'phone_number'), ''), NULLIF(btrim(u.raw_user_meta_data->>'contact_number'), '')),
  NULLIF(btrim(u.raw_user_meta_data->>'address'), ''),
  timezone('utc'::text, now())
FROM auth.users u
LEFT JOIN public.user_profiles up ON up.auth_user_id = u.id
WHERE up.id IS NULL
  AND lower(btrim(coalesce(nullif(u.raw_user_meta_data->>'role', ''), 'truck_driver'))) = 'truck_driver';

-- 7. Activate any existing pending truck_driver profiles (do NOT touch admin/dispatcher/supervisor)
UPDATE public.user_profiles
SET
  status = 'active'::public.account_status,
  approved_at = COALESCE(approved_at, timezone('utc'::text, now())),
  updated_at = timezone('utc'::text, now())
WHERE role = 'truck_driver'::public.app_role
  AND status = 'pending_approval'::public.account_status;

-- 8. Backfill missing public.drivers rows for all active truck_driver profiles
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
SELECT
  up.auth_user_id,
  up.id,
  COALESCE(NULLIF(btrim(up.full_name), ''), split_part(up.email, '@', 1), 'Truck Driver'),
  'available'::public.driver_status,
  COALESCE(up.phone, up.phone_number),
  COALESCE(up.phone_number, up.phone),
  up.address,
  NULL
FROM public.user_profiles up
LEFT JOIN public.drivers d ON d.auth_user_id = up.auth_user_id
WHERE up.role = 'truck_driver'::public.app_role
  AND up.status = 'active'::public.account_status
  AND d.id IS NULL;

-- 9. Link profile_id on any existing drivers rows where profile_id is NULL
UPDATE public.drivers d
SET
  profile_id = up.id,
  updated_at = timezone('utc'::text, now())
FROM public.user_profiles up
WHERE d.auth_user_id = up.auth_user_id
  AND d.profile_id IS NULL;

-- 10. Automatically activate truck_driver profiles and sync public.drivers on insert/update/appointment
CREATE OR REPLACE FUNCTION public.normalize_truck_driver_profile()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role = 'truck_driver'::public.app_role AND NEW.status = 'pending_approval'::public.account_status THEN
    NEW.status := 'active'::public.account_status;
    NEW.approved_at := COALESCE(NEW.approved_at, timezone('utc'::text, now()));
  END IF;

  IF NEW.phone IS NOT NULL AND NEW.phone_number IS NULL THEN
    NEW.phone_number := NEW.phone;
  ELSIF NEW.phone_number IS NOT NULL AND NEW.phone IS NULL THEN
    NEW.phone := NEW.phone_number;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_normalize_truck_driver_profile ON public.user_profiles;
CREATE TRIGGER trg_normalize_truck_driver_profile
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_truck_driver_profile();

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
        WHEN NEW.status IN ('inactive'::public.account_status, 'suspended'::public.account_status)
          THEN 'offline'::public.driver_status
        WHEN status = 'offline'::public.driver_status AND NEW.status = 'active'::public.account_status
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
            WHEN NEW.status IN ('inactive'::public.account_status, 'suspended'::public.account_status)
              THEN 'offline'::public.driver_status
            WHEN status = 'offline'::public.driver_status
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
  ELSIF TG_OP = 'UPDATE' AND OLD.role = 'truck_driver'::public.app_role AND NEW.role <> 'truck_driver'::public.app_role THEN
    UPDATE public.drivers
    SET
      status = 'offline'::public.driver_status,
      updated_at = timezone('utc'::text, now())
    WHERE auth_user_id = NEW.auth_user_id
       OR profile_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_driver_from_user_profile ON public.user_profiles;
CREATE TRIGGER trg_sync_driver_from_user_profile
  AFTER INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_driver_from_user_profile();

-- 11. Update approve_user_profile to support appointing/approving any profile and syncing drivers
CREATE OR REPLACE FUNCTION public.approve_user_profile(p_profile_id uuid, p_role public.app_role)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admin can approve users';
  END IF;

  UPDATE public.user_profiles
  SET
    role = p_role,
    status = 'active'::public.account_status,
    approved_by = auth.uid(),
    approved_at = COALESCE(approved_at, timezone('utc'::text, now())),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_profile_id;
END;
$function$;

-- 12. Ensure user_profiles and collection_schedules are in supabase_realtime publication
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_profiles'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.user_profiles;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'collection_schedules'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.collection_schedules;
    END IF;
  END IF;
END;
$$;

COMMIT;
