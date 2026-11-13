-- ============================================================================
-- EcoLoop: Permanent Bin Deletion Protection Migration
-- Enforces non-deletion of public.bins at the database level via:
--   1. Privilege revocation (REVOKE DELETE, TRUNCATE from anon & authenticated)
--   2. RLS policy replacement (SELECT, INSERT, UPDATE only — no DELETE policy)
--   3. BEFORE DELETE trigger (blocks direct SQL deletion unless maintenance flag is set)
-- ============================================================================

BEGIN;

-- 1. Revoke DELETE and TRUNCATE privileges from client-facing roles
REVOKE DELETE, TRUNCATE ON TABLE public.bins FROM anon, authenticated;

-- 2. Replace FOR ALL RLS policies on public.bins with explicit INSERT & UPDATE policies
DROP POLICY IF EXISTS "admin dispatcher manage bins" ON public.bins;
DROP POLICY IF EXISTS "bins_admin_dispatcher_manage" ON public.bins;
DROP POLICY IF EXISTS "admin dispatcher insert bins" ON public.bins;
DROP POLICY IF EXISTS "admin dispatcher update bins" ON public.bins;
DROP POLICY IF EXISTS "bins_admin_dispatcher_insert" ON public.bins;
DROP POLICY IF EXISTS "bins_admin_dispatcher_update" ON public.bins;

CREATE POLICY "admin dispatcher insert bins" ON public.bins
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    public.current_profile_is_active()
    AND (public.current_app_role() = ANY (ARRAY['admin'::text, 'dispatcher'::text]))
  );

CREATE POLICY "admin dispatcher update bins" ON public.bins
  FOR UPDATE
  TO PUBLIC
  USING (
    public.current_profile_is_active()
    AND (public.current_app_role() = ANY (ARRAY['admin'::text, 'dispatcher'::text]))
  )
  WITH CHECK (
    public.current_profile_is_active()
    AND (public.current_app_role() = ANY (ARRAY['admin'::text, 'dispatcher'::text]))
  );

CREATE POLICY "bins_admin_dispatcher_insert" ON public.bins
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    public.is_admin(auth.uid()) OR public.is_dispatcher(auth.uid())
  );

CREATE POLICY "bins_admin_dispatcher_update" ON public.bins
  FOR UPDATE
  TO PUBLIC
  USING (
    public.is_admin(auth.uid()) OR public.is_dispatcher(auth.uid())
  )
  WITH CHECK (
    public.is_admin(auth.uid()) OR public.is_dispatcher(auth.uid())
  );

-- 3. Database trigger to block permanent deletion of bin records
CREATE OR REPLACE FUNCTION public.prevent_bin_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('ecoloop.allow_bin_delete', true), 'false') = 'true' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Permanent deletion of bin records is disabled. Disable the bin (is_active = false, status = ''disabled'') instead.'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_bin_deletion ON public.bins;
CREATE TRIGGER trg_prevent_bin_deletion
  BEFORE DELETE ON public.bins
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_bin_deletion();

COMMIT;
