-- Run as the database owner in a maintenance window. Never through the browser key.
-- Transactional cutover: any validation failure rolls back all schema/data changes.
BEGIN;
LOCK TABLE public.kinkin_state IN ACCESS EXCLUSIVE MODE;
CREATE SCHEMA kinkin_ledger;
REVOKE ALL ON SCHEMA kinkin_ledger FROM PUBLIC, anon, authenticated;
CREATE TABLE kinkin_ledger.backup (
  captured_at timestamptz NOT NULL DEFAULT now(),
  original_row jsonb NOT NULL
);
INSERT INTO kinkin_ledger.backup(original_row)
SELECT to_jsonb(s) FROM public.kinkin_state s WHERE key = 'kinkin_v1';
DO $$ BEGIN
  IF (SELECT count(*) FROM kinkin_ledger.backup) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one existing ledger. Migration aborted.';
  END IF;
END $$;
CREATE TABLE kinkin_ledger.legacy_permissions AS
SELECT role_name, privilege,
  has_table_privilege(role_name, 'public.kinkin_state', privilege) AS allowed
FROM (VALUES ('anon'), ('authenticated')) roles(role_name)
CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) rights(privilege);
CREATE TABLE kinkin_ledger.metadata (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL CHECK (revision >= 0),
  enabled boolean NOT NULL DEFAULT true,
  attributes jsonb NOT NULL CHECK (jsonb_typeof(attributes) = 'object')
);
INSERT INTO kinkin_ledger.metadata(singleton, revision, attributes) VALUES (true, 0, '{}');
CREATE TABLE kinkin_ledger.cash_entries (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  position bigint NOT NULL CHECK (position > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'id' = id)
);
CREATE TABLE kinkin_ledger.loans (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  position bigint NOT NULL CHECK (position > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'id' = id)
);
CREATE TABLE kinkin_ledger.trips (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  position bigint NOT NULL CHECK (position > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'id' = id)
);
CREATE TABLE kinkin_ledger.assets (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  position bigint NOT NULL CHECK (position > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'id' = id)
);
CREATE TABLE kinkin_ledger.capital_entries (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  position bigint NOT NULL CHECK (position > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'id' = id)
);
CREATE TABLE kinkin_ledger.expenses (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  position bigint NOT NULL CHECK (position > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'id' = id)
);
CREATE TABLE kinkin_ledger.import_batches (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  position bigint NOT NULL CHECK (position > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'id' = id)
);
CREATE TABLE kinkin_ledger.activity_entries (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  position bigint NOT NULL CHECK (position > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'id' = id)
);
CREATE TABLE kinkin_ledger.petty_topups (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  position bigint NOT NULL CHECK (position > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'id' = id)
);
CREATE TABLE kinkin_ledger.loan_payments (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  position bigint NOT NULL CHECK (position > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'id' = id)
);
CREATE TABLE kinkin_ledger.petty_holders (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  position bigint NOT NULL CHECK (position > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'id' = id)
);
ALTER TABLE kinkin_ledger.trips ADD COLUMN source_id text GENERATED ALWAYS AS (nullif(payload->>'sourceId', '')) STORED UNIQUE;
ALTER TABLE kinkin_ledger.expenses ADD COLUMN source_id text GENERATED ALWAYS AS (nullif(payload->>'sourceId', '')) STORED UNIQUE;
ALTER TABLE kinkin_ledger.cash_entries ADD COLUMN amount numeric GENERATED ALWAYS AS ((payload->>'amount')::numeric) STORED NOT NULL CHECK (amount >= 0 AND amount < 'Infinity'::numeric);
ALTER TABLE kinkin_ledger.expenses ADD COLUMN amount numeric GENERATED ALWAYS AS ((payload->>'amount')::numeric) STORED NOT NULL CHECK (amount >= 0 AND amount < 'Infinity'::numeric);
ALTER TABLE kinkin_ledger.petty_topups ADD COLUMN amount numeric GENERATED ALWAYS AS ((payload->>'amount')::numeric) STORED NOT NULL CHECK (amount >= 0 AND amount < 'Infinity'::numeric);
ALTER TABLE kinkin_ledger.loan_payments ADD COLUMN amount numeric GENERATED ALWAYS AS ((payload->>'amount')::numeric) STORED NOT NULL CHECK (amount >= 0 AND amount < 'Infinity'::numeric);
ALTER TABLE kinkin_ledger.capital_entries ADD COLUMN amount numeric GENERATED ALWAYS AS ((payload->>'amount')::numeric) STORED NOT NULL CHECK (amount >= 0 AND amount < 'Infinity'::numeric);
ALTER TABLE kinkin_ledger.expenses ADD COLUMN holder_id text GENERATED ALWAYS AS (nullif(payload->>'holderId', '')) STORED REFERENCES kinkin_ledger.petty_holders(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE kinkin_ledger.petty_topups ADD COLUMN holder_id text GENERATED ALWAYS AS (nullif(payload->>'holderId', '')) STORED REFERENCES kinkin_ledger.petty_holders(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE kinkin_ledger.petty_topups ALTER COLUMN holder_id SET NOT NULL;
ALTER TABLE kinkin_ledger.petty_topups ADD COLUMN cash_id text GENERATED ALWAYS AS (nullif(payload->>'kasId', '')) STORED NOT NULL UNIQUE REFERENCES kinkin_ledger.cash_entries(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE kinkin_ledger.expenses ADD COLUMN cash_id text GENERATED ALWAYS AS (nullif(payload->>'cashEntryId', '')) STORED UNIQUE REFERENCES kinkin_ledger.cash_entries(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE kinkin_ledger.loan_payments ADD COLUMN loan_id text GENERATED ALWAYS AS (nullif(payload->>'loanId', '')) STORED NOT NULL REFERENCES kinkin_ledger.loans(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE kinkin_ledger.trips ADD COLUMN entry_date text GENERATED ALWAYS AS (payload->>'date') STORED NOT NULL CHECK (entry_date ~ '^\d{4}-\d{2}-\d{2}$' AND entry_date::date IS NOT NULL);
ALTER TABLE kinkin_ledger.expenses ADD COLUMN entry_date text GENERATED ALWAYS AS (payload->>'date') STORED NOT NULL CHECK (entry_date ~ '^\d{4}-\d{2}-\d{2}$' AND entry_date::date IS NOT NULL);
ALTER TABLE kinkin_ledger.cash_entries ADD COLUMN entry_date text GENERATED ALWAYS AS (payload->>'date') STORED NOT NULL CHECK (entry_date ~ '^\d{4}-\d{2}-\d{2}$' AND entry_date::date IS NOT NULL);
ALTER TABLE kinkin_ledger.petty_topups ADD COLUMN entry_date text GENERATED ALWAYS AS (payload->>'date') STORED NOT NULL CHECK (entry_date ~ '^\d{4}-\d{2}-\d{2}$' AND entry_date::date IS NOT NULL);
ALTER TABLE kinkin_ledger.loan_payments ADD COLUMN entry_date text GENERATED ALWAYS AS (payload->>'date') STORED NOT NULL CHECK (entry_date ~ '^\d{4}-\d{2}-\d{2}$' AND entry_date::date IS NOT NULL);
ALTER TABLE kinkin_ledger.capital_entries ADD COLUMN entry_date text GENERATED ALWAYS AS (payload->>'date') STORED NOT NULL CHECK (entry_date ~ '^\d{4}-\d{2}-\d{2}$' AND entry_date::date IS NOT NULL);
ALTER TABLE kinkin_ledger.trips ADD COLUMN revenue numeric GENERATED ALWAYS AS ((payload->>'jual')::numeric) STORED NOT NULL CHECK (revenue >= 0 AND revenue < 'Infinity'::numeric);
ALTER TABLE kinkin_ledger.trips ADD COLUMN cost numeric GENERATED ALWAYS AS ((payload->>'total')::numeric) STORED NOT NULL CHECK (cost >= 0 AND cost < 'Infinity'::numeric);
ALTER TABLE kinkin_ledger.trips ADD COLUMN profit numeric GENERATED ALWAYS AS ((payload->>'profit')::numeric) STORED NOT NULL;
ALTER TABLE kinkin_ledger.trips ADD CONSTRAINT trip_profit_matches CHECK (profit = revenue - cost);
ALTER TABLE kinkin_ledger.expenses ADD COLUMN trip_source_id text GENERATED ALWAYS AS (nullif(payload->>'tripSourceId','')) STORED REFERENCES kinkin_ledger.trips(source_id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION public.kinkin_load_ledger() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb; version bigint;
BEGIN
  -- Share lock keeps all collection reads on the same revision under READ COMMITTED.
  SELECT attributes, revision INTO STRICT result, version FROM kinkin_ledger.metadata WHERE singleton AND enabled FOR SHARE;
  result := result || jsonb_build_object('kas', (SELECT coalesce(jsonb_agg(payload ORDER BY position), '[]'::jsonb) FROM kinkin_ledger.cash_entries));
  result := result || jsonb_build_object('loans', (SELECT coalesce(jsonb_agg(payload ORDER BY position), '[]'::jsonb) FROM kinkin_ledger.loans));
  result := result || jsonb_build_object('trips', (SELECT coalesce(jsonb_agg(payload ORDER BY position), '[]'::jsonb) FROM kinkin_ledger.trips));
  result := result || jsonb_build_object('assets', (SELECT coalesce(jsonb_agg(payload ORDER BY position), '[]'::jsonb) FROM kinkin_ledger.assets));
  result := result || jsonb_build_object('capital', (SELECT coalesce(jsonb_agg(payload ORDER BY position), '[]'::jsonb) FROM kinkin_ledger.capital_entries));
  result := result || jsonb_build_object('expenses', (SELECT coalesce(jsonb_agg(payload ORDER BY position), '[]'::jsonb) FROM kinkin_ledger.expenses));
  result := result || jsonb_build_object('importLogs', (SELECT coalesce(jsonb_agg(payload ORDER BY position), '[]'::jsonb) FROM kinkin_ledger.import_batches));
  result := result || jsonb_build_object('activityLog', (SELECT coalesce(jsonb_agg(payload ORDER BY position), '[]'::jsonb) FROM kinkin_ledger.activity_entries));
  result := result || jsonb_build_object('pettyTopups', (SELECT coalesce(jsonb_agg(payload ORDER BY position), '[]'::jsonb) FROM kinkin_ledger.petty_topups));
  result := result || jsonb_build_object('loanPayments', (SELECT coalesce(jsonb_agg(payload ORDER BY position), '[]'::jsonb) FROM kinkin_ledger.loan_payments));
  result := result || jsonb_build_object('pettyHolders', (SELECT coalesce(jsonb_agg(payload ORDER BY position), '[]'::jsonb) FROM kinkin_ledger.petty_holders));
  RETURN jsonb_build_object('value', result, 'revision', version);
END $$;
REVOKE ALL ON FUNCTION public.kinkin_load_ledger() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.kinkin_save_ledger(p_state jsonb, p_expected_revision bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE version bigint;
BEGIN
  SELECT revision INTO STRICT version FROM kinkin_ledger.metadata WHERE singleton AND enabled FOR UPDATE;
  IF p_expected_revision IS NULL OR version <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Ledger changed in another session. Reload before saving.';
  END IF;
  IF p_state IS NULL OR jsonb_typeof(p_state) <> 'object' THEN
    RAISE EXCEPTION 'State must be an object';
  END IF;
  IF jsonb_typeof(p_state->'kas') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Missing collection: kas';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'kas') e GROUP BY e->>'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate IDs in kas';
  END IF;
  INSERT INTO kinkin_ledger.cash_entries(id, position, payload)
    SELECT e->>'id', ord, e FROM jsonb_array_elements(p_state->'kas') WITH ORDINALITY AS rows(e, ord)
    ON CONFLICT (id) DO UPDATE SET position = excluded.position, payload = excluded.payload;
  DELETE FROM kinkin_ledger.cash_entries WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_state->'kas') e WHERE e->>'id' = cash_entries.id
  );
  IF jsonb_typeof(p_state->'loans') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Missing collection: loans';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'loans') e GROUP BY e->>'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate IDs in loans';
  END IF;
  INSERT INTO kinkin_ledger.loans(id, position, payload)
    SELECT e->>'id', ord, e FROM jsonb_array_elements(p_state->'loans') WITH ORDINALITY AS rows(e, ord)
    ON CONFLICT (id) DO UPDATE SET position = excluded.position, payload = excluded.payload;
  DELETE FROM kinkin_ledger.loans WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_state->'loans') e WHERE e->>'id' = loans.id
  );
  IF jsonb_typeof(p_state->'trips') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Missing collection: trips';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'trips') e GROUP BY e->>'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate IDs in trips';
  END IF;
  INSERT INTO kinkin_ledger.trips(id, position, payload)
    SELECT e->>'id', ord, e FROM jsonb_array_elements(p_state->'trips') WITH ORDINALITY AS rows(e, ord)
    ON CONFLICT (id) DO UPDATE SET position = excluded.position, payload = excluded.payload;
  DELETE FROM kinkin_ledger.trips WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_state->'trips') e WHERE e->>'id' = trips.id
  );
  IF jsonb_typeof(p_state->'assets') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Missing collection: assets';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'assets') e GROUP BY e->>'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate IDs in assets';
  END IF;
  INSERT INTO kinkin_ledger.assets(id, position, payload)
    SELECT e->>'id', ord, e FROM jsonb_array_elements(p_state->'assets') WITH ORDINALITY AS rows(e, ord)
    ON CONFLICT (id) DO UPDATE SET position = excluded.position, payload = excluded.payload;
  DELETE FROM kinkin_ledger.assets WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_state->'assets') e WHERE e->>'id' = assets.id
  );
  IF jsonb_typeof(p_state->'capital') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Missing collection: capital';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'capital') e GROUP BY e->>'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate IDs in capital';
  END IF;
  INSERT INTO kinkin_ledger.capital_entries(id, position, payload)
    SELECT e->>'id', ord, e FROM jsonb_array_elements(p_state->'capital') WITH ORDINALITY AS rows(e, ord)
    ON CONFLICT (id) DO UPDATE SET position = excluded.position, payload = excluded.payload;
  DELETE FROM kinkin_ledger.capital_entries WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_state->'capital') e WHERE e->>'id' = capital_entries.id
  );
  IF jsonb_typeof(p_state->'expenses') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Missing collection: expenses';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'expenses') e GROUP BY e->>'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate IDs in expenses';
  END IF;
  INSERT INTO kinkin_ledger.expenses(id, position, payload)
    SELECT e->>'id', ord, e FROM jsonb_array_elements(p_state->'expenses') WITH ORDINALITY AS rows(e, ord)
    ON CONFLICT (id) DO UPDATE SET position = excluded.position, payload = excluded.payload;
  DELETE FROM kinkin_ledger.expenses WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_state->'expenses') e WHERE e->>'id' = expenses.id
  );
  IF jsonb_typeof(p_state->'importLogs') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Missing collection: importLogs';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'importLogs') e GROUP BY e->>'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate IDs in importLogs';
  END IF;
  INSERT INTO kinkin_ledger.import_batches(id, position, payload)
    SELECT e->>'id', ord, e FROM jsonb_array_elements(p_state->'importLogs') WITH ORDINALITY AS rows(e, ord)
    ON CONFLICT (id) DO UPDATE SET position = excluded.position, payload = excluded.payload;
  DELETE FROM kinkin_ledger.import_batches WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_state->'importLogs') e WHERE e->>'id' = import_batches.id
  );
  IF jsonb_typeof(p_state->'activityLog') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Missing collection: activityLog';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'activityLog') e GROUP BY e->>'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate IDs in activityLog';
  END IF;
  INSERT INTO kinkin_ledger.activity_entries(id, position, payload)
    SELECT e->>'id', ord, e FROM jsonb_array_elements(p_state->'activityLog') WITH ORDINALITY AS rows(e, ord)
    ON CONFLICT (id) DO UPDATE SET position = excluded.position, payload = excluded.payload;
  DELETE FROM kinkin_ledger.activity_entries WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_state->'activityLog') e WHERE e->>'id' = activity_entries.id
  );
  IF jsonb_typeof(p_state->'pettyTopups') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Missing collection: pettyTopups';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'pettyTopups') e GROUP BY e->>'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate IDs in pettyTopups';
  END IF;
  INSERT INTO kinkin_ledger.petty_topups(id, position, payload)
    SELECT e->>'id', ord, e FROM jsonb_array_elements(p_state->'pettyTopups') WITH ORDINALITY AS rows(e, ord)
    ON CONFLICT (id) DO UPDATE SET position = excluded.position, payload = excluded.payload;
  DELETE FROM kinkin_ledger.petty_topups WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_state->'pettyTopups') e WHERE e->>'id' = petty_topups.id
  );
  IF jsonb_typeof(p_state->'loanPayments') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Missing collection: loanPayments';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'loanPayments') e GROUP BY e->>'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate IDs in loanPayments';
  END IF;
  INSERT INTO kinkin_ledger.loan_payments(id, position, payload)
    SELECT e->>'id', ord, e FROM jsonb_array_elements(p_state->'loanPayments') WITH ORDINALITY AS rows(e, ord)
    ON CONFLICT (id) DO UPDATE SET position = excluded.position, payload = excluded.payload;
  DELETE FROM kinkin_ledger.loan_payments WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_state->'loanPayments') e WHERE e->>'id' = loan_payments.id
  );
  IF jsonb_typeof(p_state->'pettyHolders') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Missing collection: pettyHolders';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'pettyHolders') e GROUP BY e->>'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate IDs in pettyHolders';
  END IF;
  INSERT INTO kinkin_ledger.petty_holders(id, position, payload)
    SELECT e->>'id', ord, e FROM jsonb_array_elements(p_state->'pettyHolders') WITH ORDINALITY AS rows(e, ord)
    ON CONFLICT (id) DO UPDATE SET position = excluded.position, payload = excluded.payload;
  DELETE FROM kinkin_ledger.petty_holders WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_state->'pettyHolders') e WHERE e->>'id' = petty_holders.id
  );
  IF EXISTS (
    SELECT 1 FROM kinkin_ledger.petty_topups t JOIN kinkin_ledger.cash_entries c ON c.id = t.cash_id
    WHERE c.payload->>'type' IS DISTINCT FROM 'out' OR c.amount <> t.amount
      OR c.payload->>'date' IS DISTINCT FROM t.payload->>'date'
  ) THEN RAISE EXCEPTION 'Top-up differs from linked cash payment'; END IF;
  IF EXISTS (
    SELECT 1 FROM kinkin_ledger.expenses e JOIN kinkin_ledger.cash_entries c ON c.id = e.cash_id
    WHERE c.payload->>'type' IS DISTINCT FROM 'out' OR c.amount <> e.amount
      OR c.payload->>'date' IS DISTINCT FROM e.payload->>'date'
  ) THEN RAISE EXCEPTION 'Expense differs from linked cash payment'; END IF;
  IF EXISTS (SELECT 1 FROM kinkin_ledger.expenses e JOIN kinkin_ledger.petty_topups t ON e.cash_id = t.cash_id)
    THEN RAISE EXCEPTION 'Cash payment already funds a top-up'; END IF;
  IF EXISTS (SELECT 1 FROM kinkin_ledger.expenses WHERE
      (payload->>'paidBy' = 'petty_cash' AND (holder_id IS NULL OR cash_id IS NOT NULL)) OR
      (payload->>'paidBy' = 'main_cash' AND (cash_id IS NULL OR holder_id IS NOT NULL)) OR
      (payload->>'paidBy' = 'personal_advance' AND (cash_id IS NOT NULL OR holder_id IS NOT NULL)) OR
      (payload ? 'paidBy' AND payload->>'paidBy' NOT IN ('petty_cash', 'main_cash', 'personal_advance')))
    THEN RAISE EXCEPTION 'Invalid expense payment classification'; END IF;
  UPDATE kinkin_ledger.metadata SET attributes = p_state - ARRAY['kas', 'loans', 'trips', 'assets', 'capital', 'expenses', 'importLogs', 'activityLog', 'pettyTopups', 'loanPayments', 'pettyHolders'], revision = version + 1 WHERE singleton;
  RETURN version + 1;
END $$;
REVOKE ALL ON FUNCTION public.kinkin_save_ledger(jsonb, bigint) FROM PUBLIC, anon, authenticated;

-- Backfill without changing IDs, array order, amounts or any legacy metadata.
SELECT public.kinkin_save_ledger((SELECT original_row->'value' FROM kinkin_ledger.backup), 0);
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
  IF (SELECT original_row->'value' FROM kinkin_ledger.backup) IS DISTINCT FROM (public.kinkin_load_ledger()->'value') THEN
    RAISE EXCEPTION 'Lossless round-trip check failed';
  END IF;
END $$;

-- Freeze the original snapshot. An old tab cannot silently overwrite the new ledger.
CREATE FUNCTION kinkin_ledger.reject_legacy_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Ledger migrated. Reload the current application.';
END $$;
CREATE TRIGGER kinkin_legacy_frozen BEFORE INSERT OR UPDATE OR DELETE ON public.kinkin_state
FOR EACH STATEMENT EXECUTE FUNCTION kinkin_ledger.reject_legacy_write();
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.kinkin_state FROM anon, authenticated;

-- Preserve the existing application's API roles; this is not an authentication migration.
-- Tables/backup stay inaccessible to API roles. Only the two validated RPCs are exposed.
REVOKE ALL ON ALL TABLES IN SCHEMA kinkin_ledger FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA kinkin_ledger FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kinkin_load_ledger() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kinkin_save_ledger(jsonb, bigint) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
