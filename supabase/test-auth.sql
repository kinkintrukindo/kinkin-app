-- LOCAL ONLY. Fixture: auth users ...001 (owner), ...002 (outsider), and
-- before_auth(snapshot) captured before applying the authentication migration.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.kinkin_load_ledger(); RAISE EXCEPTION 'Anonymous read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.kinkin_save_ledger('{}',1); RAISE EXCEPTION 'Anonymous write allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM value FROM public.kinkin_state; RAISE EXCEPTION 'Legacy read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
DO $$ BEGIN
  IF public.kinkin_current_member() IS NOT NULL THEN RAISE EXCEPTION 'Outsider is member'; END IF;
  BEGIN PERFORM public.kinkin_load_ledger(); RAISE EXCEPTION 'Outsider read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.kinkin_save_ledger('{}',1); RAISE EXCEPTION 'Outsider write allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM value FROM public.kinkin_state; RAISE EXCEPTION 'Legacy exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM kinkin_ledger.kinkin_load_ledger(); RAISE EXCEPTION 'Internal function exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO kinkin_ledger.members(user_id) VALUES(auth.uid()); RAISE EXCEPTION 'Self promotion allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE s jsonb; r bigint; BEGIN
  s := public.kinkin_load_ledger();
  IF s->'value' ? 'appPassword' THEN RAISE EXCEPTION 'Password exposed'; END IF;
  BEGIN PERFORM public.kinkin_save_ledger(s->'value',(s->>'revision')::bigint-1); RAISE EXCEPTION 'Conflict allowed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
  r := public.kinkin_save_ledger((s->'value') || '{"appPassword":"must-not-persist"}',(s->>'revision')::bigint);
  IF r <> (s->>'revision')::bigint + 1 THEN RAISE EXCEPTION 'Owner save failed'; END IF;
  IF public.kinkin_load_ledger()->'value' IS DISTINCT FROM s->'value' THEN RAISE EXCEPTION 'Save changed data'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF public.kinkin_load_ledger()->'value' IS DISTINCT FROM (SELECT (snapshot->'value') - 'appPassword' FROM before_auth) THEN RAISE EXCEPTION 'Financial data changed'; END IF;
END $$;
UPDATE kinkin_ledger.members SET active=false;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.kinkin_load_ledger(); RAISE EXCEPTION 'Revoked owner allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.kinkin_save_ledger('{}',1); RAISE EXCEPTION 'Revoked owner write allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE kinkin_ledger.members SET active=true;
UPDATE auth.users SET email_confirmed_at=NULL WHERE id=auth.uid();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.kinkin_load_ledger(); RAISE EXCEPTION 'Unconfirmed owner allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE auth.users SET email_confirmed_at=now(),banned_until=now()+interval '1 day' WHERE id=auth.uid();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.kinkin_load_ledger(); RAISE EXCEPTION 'Banned owner allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
