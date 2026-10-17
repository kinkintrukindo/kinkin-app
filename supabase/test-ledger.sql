-- Run after migration against an isolated copy only. All test changes roll back.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE snapshot jsonb := public.kinkin_load_ledger(); state jsonb; revised jsonb; version bigint; result bigint;
BEGIN
  state := snapshot->'value'; version := (snapshot->>'revision')::bigint;
  IF state IS DISTINCT FROM (SELECT original_row->'value' FROM kinkin_ledger.backup) THEN RAISE EXCEPTION 'Backfill differs'; END IF;
  BEGIN
    PERFORM public.kinkin_save_ledger(state, version - 1);
    RAISE EXCEPTION 'Expected conflict';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN
    PERFORM public.kinkin_save_ledger(state - 'expenses', version);
    RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='Missing array accepted';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  revised := jsonb_set(state, '{trips}', (state->'trips') || jsonb_build_array(state->'trips'->0));
  BEGIN
    PERFORM public.kinkin_save_ledger(revised, version);
    RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='Duplicate ID accepted';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  revised := jsonb_set(state, '{pettyTopups,0,kasId}', '"missing-cash"');
  BEGIN
    PERFORM public.kinkin_save_ledger(revised, version);
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='Orphan accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  revised := jsonb_set(state, '{pettyTopups,0,amount}', '1');
  BEGIN
    PERFORM public.kinkin_save_ledger(revised, version);
    RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='Payment mismatch accepted';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN
    UPDATE public.kinkin_state SET value=state WHERE key='kinkin_v1';
    RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='Old client write accepted';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  IF public.kinkin_load_ledger() IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'Failed save changed data'; END IF;
  -- Atomic matched edit of a top-up and its main-cash payment.
  revised := jsonb_set(state, '{pettyTopups,0,amount}', to_jsonb((state#>>'{pettyTopups,0,amount}')::numeric + 1));
  revised := jsonb_set(revised, '{kas}', (SELECT jsonb_agg(CASE WHEN e->>'id'=state#>>'{pettyTopups,0,kasId}' THEN jsonb_set(e,'{amount}',to_jsonb((e->>'amount')::numeric+1)) ELSE e END ORDER BY ord) FROM jsonb_array_elements(state->'kas') WITH ORDINALITY r(e,ord)));
  result := public.kinkin_save_ledger(revised, version);
  SET CONSTRAINTS ALL IMMEDIATE;
  IF result <> version+1 OR public.kinkin_load_ledger()->'value' IS DISTINCT FROM revised THEN RAISE EXCEPTION 'Atomic edit failed'; END IF;
END $$;
SET LOCAL ROLE anon;
SELECT public.kinkin_load_ledger()->>'revision' AS accessible_revision;
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM kinkin_ledger.backup;
    RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='Backup exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
