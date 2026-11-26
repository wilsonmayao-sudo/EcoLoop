-- Lock down public.auth_signup_errors (previously RLS disabled with full anon/authenticated grants).
-- Only SECURITY DEFINER functions (handle_new_auth_user, admin_delete_user_account) write/delete rows.
ALTER TABLE public.auth_signup_errors ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auth_signup_errors FROM anon, authenticated;
GRANT SELECT ON TABLE public.auth_signup_errors TO authenticated;

DROP POLICY IF EXISTS "Admins can read auth signup errors" ON public.auth_signup_errors;
CREATE POLICY "Admins can read auth signup errors"
  ON public.auth_signup_errors
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));
