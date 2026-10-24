# Dashboard authentication

The dashboard uses Supabase email/password authentication. The first approved owner is `info@kinkintrukindo.com`. Signing in alone does not grant access: every ledger read and write checks the private membership table, confirmed email, and account ban status. This release supports owners only; do not give staff an owner account unless they should have full accounting edit/delete access.

The public anonymous key is an application identifier, not a password. Never ship a service-role key. Anonymous users, unapproved authenticated users, and revoked owners cannot call the ledger RPCs. Both normalized tables and the frozen legacy snapshot are inaccessible directly. Internal transaction functions remain private. Passwords are stripped from ledger metadata and incoming saves; historical private backups remain restricted.

## Production rollout

1. Prepare and test the frontend and migration on an isolated database. Preserve a private current ledger backup.
2. In Supabase Authentication, set Site URL to `https://kinkintrukindo.com/admin.html`. Disable public signup and anonymous sign-in, retain email confirmation and secure email change, set minimum password length to 12, and require current password for password changes. No paid features are required. The built-in email service has delivery restrictions; verify the owner's invitation actually arrives before declaring setup complete.
3. With owner approval, invite `info@kinkintrukindo.com`. The user chooses their password; never generate, record, or enter it for them. A Supabase project/dashboard login is separate from an application user.
4. Apply `supabase/migrations/202610180001_owner_authentication.sql` in the approved project. It fails atomically if the designated auth user does not exist. This grants that UUID owner access and closes anonymous API access. The old frontend becomes unavailable until the new frontend is deployed.
5. Deploy the matching frontend promptly, then have the owner follow the invitation and set a password. Recovery/invitation links must land on `/admin.html`.
6. Verify live anonymous RPC and legacy-table requests are denied; have the owner verify login, ledger values, refresh, and sign-out. Compare before/after ledger JSON excluding only the removed `appPassword` property. Do not create test financial transactions in production.

## Account operations

- Sign out explicitly on shared devices. Auth tokens are stored per tab in sessionStorage, surviving reload; browser session restoration can preserve this storage. Financial records remain in Supabase.
- Forgotten password: use the login screen's reset link. Replies do not reveal account existence. Supabase owns link expiration, hashing, and authentication rate limiting.
- Change password: Settings, with current password and a new password of at least 12 characters. Current-password enforcement is a Supabase setting, not just a form check.
- Recovery and invitation sessions show a set-password form before the dashboard. An expired link requires a fresh recovery request.
- Revoke access with `UPDATE kinkin_ledger.members SET active = false WHERE user_id = '<approved UUID>';`. This is checked on the next RPC, including for existing tokens. Existing data already displayed in a browser cannot be remotely erased.
- Destructive action confirmations use DELETE, UNDO, or RESET. These prevent accidental clicks; they are not passwords or authorization checks. The database owner check is the security boundary.
- If frontend deployment fails, keep the database restrictions in place and fix forward. Do not run the old ledger rollback script or restore anonymous privileges as an auth rollback.

## Verification

`npm test` includes session-close write cancellation and revision consistency. `npm run build` validates production compilation. `supabase/test-auth.sql` runs on an isolated PostgreSQL fixture with two auth users and a pre-migration snapshot: anonymous/outsider denial, direct-access denial, self-promotion denial, owner read/write, conflict handling, unchanged financial data, password stripping, revocation, unconfirmed email and bans. All test writes roll back.

Local browser QA uses a mock auth endpoint, never production financial writes. Real invitation delivery, password creation, and live owner sign-in require user participation and must be verified separately.

### Authorized email settings

Apply `202610240002_dashboard_access.sql` before deploying the updated admin UI.
Owners manage the list in Settings → Dashboard Access. Added addresses receive full
ledger access (including edit, import and delete), but cannot manage authorization.
The existing owner membership cannot be removed through this screen. Adding an
address does not send mail. The user selects **Email me a sign-in link** on the
login page and verifies their own mailbox. Supabase email signups and email delivery
must be enabled, and the production `/admin.html` callback must be allowed.
Unapproved signups cannot read or write the ledger. Removing an approved address
blocks subsequent ledger requests even for an existing session; previously viewed
information cannot be recalled from the user's browser. No service-role key is used.

For a disposable PostgreSQL database only, run
`psql -v ON_ERROR_STOP=1 -f scripts/sql/dashboard-access.test.sql`.
The fixture creates mock auth tables and roles; never run it in production.
