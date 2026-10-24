BEGIN;
CREATE OR REPLACE FUNCTION public.kinkin_lookup_container(p_container text)
RETURNS TABLE (date text, destination text, container text, plate text, invoiced numeric, invoice text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE normalized text := upper(regexp_replace(p_container, '[[:space:]-]', '', 'g'));
BEGIN
  IF p_container IS NULL OR length(p_container) > 30 OR normalized !~ '^[A-Z0-9]{6,20}$' THEN
    RAISE EXCEPTION 'Enter a full container number';
  END IF;
  RETURN QUERY
  SELECT t.payload->>'date', t.payload->>'destination', t.payload->>'contNo',
         t.payload->>'nopol', (t.payload->>'jual')::numeric, t.payload->>'invNo'
  FROM kinkin_ledger.trips t
  WHERE upper(regexp_replace(t.payload->>'contNo', '[[:space:]-]', '', 'g')) = normalized
  ORDER BY t.payload->>'date' DESC, t.id
  LIMIT 100;
END;
$$;
REVOKE ALL ON FUNCTION public.kinkin_lookup_container(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kinkin_lookup_container(text) TO anon, authenticated;
COMMIT;
