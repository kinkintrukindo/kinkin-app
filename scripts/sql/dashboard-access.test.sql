-- Run only in an empty, disposable PostgreSQL database.
\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE SCHEMA kinkin_ledger;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, banned_until timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
CREATE TABLE kinkin_ledger.members(user_id uuid PRIMARY KEY REFERENCES auth.users, role text DEFAULT 'owner', active boolean DEFAULT true);
INSERT INTO auth.users VALUES
 ('00000000-0000-0000-0000-000000000001','owner@example.test',now(),null),
 ('00000000-0000-0000-0000-000000000002','staff@example.test',now(),null),
 ('00000000-0000-0000-0000-000000000003','pending@example.test',null,null);
INSERT INTO kinkin_ledger.members(user_id) VALUES ('00000000-0000-0000-0000-000000000001');
\ir ../../supabase/migrations/202610240002_dashboard_access.sql
DO $$ BEGIN
 IF has_function_privilege('anon','public.kinkin_set_dashboard_access(text,boolean)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous management exposed'; END IF;
 IF has_table_privilege('authenticated','kinkin_ledger.authorized_emails','SELECT') THEN RAISE EXCEPTION 'Private table exposed'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
DO $$ BEGIN
 IF public.kinkin_current_member() IS NOT NULL THEN RAISE EXCEPTION 'Unapproved user admitted'; END IF;
 BEGIN PERFORM public.kinkin_set_dashboard_access('staff@example.test',true); RAISE EXCEPTION 'Self authorization allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.kinkin_list_dashboard_access(); RAISE EXCEPTION 'List leaked'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT public.kinkin_set_dashboard_access(' STAFF@example.test ',true);
SELECT public.kinkin_set_dashboard_access('staff@example.test',true);
SELECT public.kinkin_set_dashboard_access('pending@example.test',true);
DO $$ BEGIN
 IF jsonb_array_length(public.kinkin_list_dashboard_access()) <> 3 THEN RAISE EXCEPTION 'Normalization/idempotency failed'; END IF;
 BEGIN PERFORM public.kinkin_set_dashboard_access('owner@example.test',false); RAISE EXCEPTION 'Owner removal allowed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Owner access cannot be changed here' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
DO $$ BEGIN IF public.kinkin_current_member() IS NOT NULL THEN RAISE EXCEPTION 'Unverified email admitted'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
DO $$ BEGIN
 IF public.kinkin_current_member()->>'role' <> 'staff' THEN RAISE EXCEPTION 'Approved staff denied'; END IF;
 BEGIN PERFORM public.kinkin_set_dashboard_access('another@example.test',true); RAISE EXCEPTION 'Staff escalation allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT public.kinkin_set_dashboard_access('staff@example.test',false);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
DO $$ BEGIN IF public.kinkin_current_member() IS NOT NULL THEN RAISE EXCEPTION 'Revoked session admitted'; END IF; END $$;
RESET ROLE;
SELECT 'Dashboard access checks passed' AS result;
