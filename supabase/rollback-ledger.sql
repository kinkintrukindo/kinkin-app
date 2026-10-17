-- Database owner only. Coordinate with the legacy frontend deployment.
-- Restores the LATEST ledger, never the old backup. Retains all migration tables.
BEGIN;
LOCK TABLE public.kinkin_state IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE snapshot jsonb; permission record;
BEGIN
  PERFORM 1 FROM kinkin_ledger.metadata WHERE singleton AND enabled FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ledger is not active'; END IF;
  snapshot := public.kinkin_load_ledger()->'value';
  DROP TRIGGER kinkin_legacy_frozen ON public.kinkin_state;
  UPDATE public.kinkin_state SET value=snapshot, updated_at=now() WHERE key='kinkin_v1';
  IF NOT FOUND THEN RAISE EXCEPTION 'Legacy row is missing'; END IF;
  IF (SELECT value FROM public.kinkin_state WHERE key='kinkin_v1') IS DISTINCT FROM snapshot THEN
    RAISE EXCEPTION 'Rollback round-trip failed';
  END IF;
  UPDATE kinkin_ledger.metadata SET enabled=false WHERE singleton;
  FOR permission IN SELECT * FROM kinkin_ledger.legacy_permissions WHERE allowed LOOP
    EXECUTE format('GRANT %s ON public.kinkin_state TO %I', permission.privilege, permission.role_name);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.kinkin_load_ledger() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.kinkin_save_ledger(jsonb, bigint) FROM anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
