-- Run after dashboard-access.test.sql in the same disposable database only.
\set ON_ERROR_STOP on
CREATE TABLE kinkin_ledger.trips(id text PRIMARY KEY, payload jsonb NOT NULL);
INSERT INTO kinkin_ledger.trips VALUES
('sample1','{"date":"2026-10-22","destination":"Warehouse","contNo":"ABCD1234567","nopol":"B 1234 ABC","jual":750000,"invNo":"SAMPLE","profit":600000,"sangu":150000}'),
('sample2','{"date":"2026-10-23","destination":"Port","contNo":"abcd 1234567","nopol":"B 1234 ABC","jual":800000,"invNo":"SAMPLE2"}'),
('other','{"date":"2026-10-22","destination":"Private","contNo":"EFGH1234567","nopol":"B 1234 ABC","jual":500000,"invNo":"OTHER"}');
\ir ../../supabase/migrations/202610240001_container_lookup.sql
SET ROLE anon;
DO $$ DECLARE result jsonb; BEGIN
 SELECT jsonb_agg(to_jsonb(t)) INTO result FROM public.kinkin_lookup_container('abcd-1234567') t;
 IF jsonb_array_length(result) <> 2 THEN RAISE EXCEPTION 'Exact normalized matching failed'; END IF;
 IF result->0->>'date' <> '2026-10-23' THEN RAISE EXCEPTION 'Ordering failed'; END IF;
 IF result->0 ? 'profit' OR result->0 ? 'sangu' THEN RAISE EXCEPTION 'Internal financial fields exposed'; END IF;
 IF (SELECT count(*) FROM public.kinkin_lookup_container('ABCD123456')) <> 0 THEN RAISE EXCEPTION 'Partial match leaked'; END IF;
 BEGIN PERFORM public.kinkin_lookup_container('%'); RAISE EXCEPTION 'Wildcard allowed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Enter a full container number' THEN RAISE; END IF; END;
 BEGIN PERFORM * FROM kinkin_ledger.trips; RAISE EXCEPTION 'Private table exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'Container lookup checks passed' AS result;
