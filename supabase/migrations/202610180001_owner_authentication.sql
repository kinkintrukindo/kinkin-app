-- Requires the owner to exist in Supabase Authentication before this transaction.
-- Run once, after the authentication frontend is ready to deploy.
BEGIN;
CREATE TABLE kinkin_ledger.members (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role = 'owner'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE kinkin_ledger.members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kinkin_ledger.members FROM PUBLIC, anon, authenticated;

DO $$
DECLARE owner_id uuid;
BEGIN
  SELECT id INTO STRICT owner_id FROM auth.users WHERE lower(email) = 'info@kinkintrukindo.com';
  INSERT INTO kinkin_ledger.members(user_id) VALUES(owner_id);
EXCEPTION WHEN no_data_found THEN
  RAISE EXCEPTION 'Create the approved owner in Supabase Authentication before applying this migration';
END $$;

-- Preserve the validated transaction implementation, but make it private.
ALTER FUNCTION public.kinkin_load_ledger() SET SCHEMA kinkin_ledger;
ALTER FUNCTION public.kinkin_save_ledger(jsonb, bigint) SET SCHEMA kinkin_ledger;
REVOKE ALL ON FUNCTION kinkin_ledger.kinkin_load_ledger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION kinkin_ledger.kinkin_save_ledger(jsonb, bigint) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.kinkin_current_member() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('user_id', m.user_id, 'role', m.role)
  FROM kinkin_ledger.members m JOIN auth.users u ON u.id = m.user_id
  WHERE m.user_id = auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL
    AND (u.banned_until IS NULL OR u.banned_until <= now());
$$;
CREATE FUNCTION public.kinkin_load_ledger() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.kinkin_current_member() IS NULL THEN
    RAISE EXCEPTION 'Dashboard owner access required' USING ERRCODE = '42501';
  END IF;
  RETURN kinkin_ledger.kinkin_load_ledger();
END $$;
CREATE FUNCTION public.kinkin_save_ledger(p_state jsonb, p_expected_revision bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.kinkin_current_member() IS NULL THEN
    RAISE EXCEPTION 'Dashboard owner access required' USING ERRCODE = '42501';
  END IF;
  RETURN kinkin_ledger.kinkin_save_ledger(p_state - 'appPassword', p_expected_revision);
END $$;
REVOKE ALL ON FUNCTION public.kinkin_current_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kinkin_load_ledger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kinkin_save_ledger(jsonb, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kinkin_current_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.kinkin_load_ledger() TO authenticated;
GRANT EXECUTE ON FUNCTION public.kinkin_save_ledger(jsonb, bigint) TO authenticated;

-- The frozen legacy snapshot also contains financial data. Close its read path.
REVOKE ALL ON public.kinkin_state FROM PUBLIC, anon, authenticated;
ALTER TABLE public.kinkin_state ENABLE ROW LEVEL SECURITY;
UPDATE kinkin_ledger.metadata SET attributes = attributes - 'appPassword' WHERE singleton;
NOTIFY pgrst, 'reload schema';
COMMIT;
