# Normalized ledger cutover

This migration replaces the shared JSON row with 11 record tables in the private `kinkin_ledger` schema. Each row retains its full legacy payload and array position; generated relational columns enforce IDs, finite amounts, dates, trip arithmetic, permanent source IDs, holder/trip/loan relationships and linked cash payments. This is a lossless first normalization step: auxiliary fields remain JSONB. The client still sends a snapshot, but a database transaction applies it across the record tables with a revision comparison. Stale writers fail instead of overwriting newer records.

## Access and prerequisites

Apply SQL using the Supabase SQL editor or a database-owner connection, not the public browser key. Keep all backups outside Git. Existing records must pass every constraint; failures roll back the entire migration. Never silently repair financial data to make migration pass.

This does **not** introduce Supabase Auth. The application currently uses a browser-side password with the anonymous API role. The two RPCs preserve that existing access model; this is not suitable for multiple companies or a claim of server-side user authorization. Private tables and the backup have no API-role access. The RPC functions have a fixed empty search path and explicit execution grants. See [Supabase database function security](https://supabase.com/docs/guides/database/functions). A separate authentication change should replace the existing shared client-side login.

## Cutover sequence

1. Verify the migration PR preview build/tests and coordinate a short maintenance window. Close all admin tabs. Do not merge/deploy the new client before the database is ready: it intentionally has no legacy write fallback.
2. Export the latest `kinkin_state` row privately. Record collection counts and revenue, costs, expenses, cash and petty balances. The migration takes an additional in-database backup under an exclusive lock.
3. Run `supabase/migrations/202610170001_normalized_ledger.sql` once, as database owner. Its transaction validates the full reconstructed JSON against the source before committing. Existing legacy writes are blocked from this point.
4. Confirm `public.kinkin_load_ledger()` returns revision 1. Compare its value to the locked backup, not an older external export. Inspect grants and confirm the private schema is not in exposed API schemas.
5. Deploy the migration client. Verify loading, one reversible test edit, reload persistence, a second-tab stale-write rejection, and saved/error indicators. Remove any test records through the app and recheck balances.
6. Keep the original row, private backup and migration tables. Do not drop them as part of cutover.

Old tabs must reload. The frozen original row is a cutover snapshot and is no longer current. Old clients may suppress their save errors; closing tabs before maintenance and reloading afterward is required.

## Verification on an isolated PostgreSQL copy

Seed a disposable UTF-8 PostgreSQL database with roles `anon` and `authenticated`, and a `public.kinkin_state(key text primary key, value jsonb, updated_at timestamptz)` row. Then run:

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202610170001_normalized_ledger.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/test-ledger.sql
npm test
npm run build
```

The SQL test expects a populated snapshot with a top-up and trips. It verifies exact backfill, duplicate rejection, conflict rejection, missing-collection rejection, orphan/mismatched payments, atomic matching edits, old-client blocking, backup isolation and rollback of test changes. Never run this test against production.

The client serializes saves and compares canonical snapshots. A database/network/validation error halts subsequent writes; an ambiguous result is not blindly retried. Failed loads cannot become empty ledgers. Unsaved work can be downloaded for manual reconciliation; the recovery file excludes the application password.

## Rollback

Pause editing and export the latest normalized state privately. Run `supabase/rollback-ledger.sql` as database owner, then restore the previous frontend deployment (PR #6). Rollback copies the **latest** normalized state back into the original row, disables/revokes the RPCs, and restores only previously held legacy write privileges. No tables or backups are dropped. Verify totals and reload all tabs. Do not rerun the forward migration after rollback; the retained schema requires an explicit reviewed reactivation migration.

## Limitations

Snapshots still travel over the network; the global revision serializes saves across the company. Independent concurrent edits require reload/reconciliation rather than automatic merging. Legacy records without explicit payment references remain losslessly preserved; strict reference checks apply when a link is present (top-up cash links are mandatory). This migration does not close periods, require source reconciliation on every manual edit, or add user-level audit identity.
