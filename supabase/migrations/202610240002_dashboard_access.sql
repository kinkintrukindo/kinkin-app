BEGIN;
CREATE TABLE kinkin_ledger.authorized_emails (
  email text PRIMARY KEY CHECK (email = lower(btrim(email)) AND length(email) <= 254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id)
);
ALTER TABLE kinkin_ledger.authorized_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kinkin_ledger.authorized_emails FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.kinkin_current_member() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('user_id', u.id, 'role', CASE WHEN m.active THEN 'owner' ELSE 'staff' END)
  FROM auth.users u
  LEFT JOIN kinkin_ledger.members m ON m.user_id = u.id
  WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
    AND (u.banned_until IS NULL OR u.banned_until <= now())
    AND (m.active OR (m.user_id IS NULL AND EXISTS (
      SELECT 1 FROM kinkin_ledger.authorized_emails a WHERE a.email = lower(u.email)
    )));
$$;

CREATE FUNCTION public.kinkin_list_dashboard_access() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(public.kinkin_current_member()->>'role', '') <> 'owner' THEN
    RAISE EXCEPTION 'Only the owner can manage dashboard access' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x->>'email'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('email', lower(u.email), 'role', 'owner', 'status', 'Active') AS x
    FROM kinkin_ledger.members m JOIN auth.users u ON u.id = m.user_id WHERE m.active
    UNION ALL
    SELECT jsonb_build_object('email', a.email, 'role', 'staff', 'status',
      CASE WHEN EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = a.email AND u.email_confirmed_at IS NOT NULL) THEN 'Verified' ELSE 'Awaiting sign-in' END)
    FROM kinkin_ledger.authorized_emails a
  ) entries);
END;
$$;

CREATE FUNCTION public.kinkin_set_dashboard_access(p_email text, p_allowed boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE normalized text := lower(btrim(p_email));
BEGIN
  IF coalesce(public.kinkin_current_member()->>'role', '') <> 'owner' THEN
    RAISE EXCEPTION 'Only the owner can manage dashboard access' USING ERRCODE = '42501';
  END IF;
  IF normalized IS NULL OR length(normalized) > 254 OR normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR p_allowed IS NULL THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;
  IF EXISTS (SELECT 1 FROM kinkin_ledger.members m JOIN auth.users u ON u.id = m.user_id WHERE lower(u.email) = normalized) THEN
    RAISE EXCEPTION 'Owner access cannot be changed here';
  END IF;
  IF p_allowed THEN
    INSERT INTO kinkin_ledger.authorized_emails(email, created_by) VALUES (normalized, auth.uid()) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM kinkin_ledger.authorized_emails WHERE email = normalized;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.kinkin_list_dashboard_access() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kinkin_set_dashboard_access(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kinkin_list_dashboard_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.kinkin_set_dashboard_access(text, boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
