# Workbook import and reconciliation

Monthly CSV or workbook trip sheets can be imported without a Kas/Month Control tab. Matching, date, fleet, payment-source and duplicate checks still run. The import is recorded as `not_reconciled` with null control amounts; missing cash balances are never assumed to be zero. When a control tab is supplied, all existing cash checks remain mandatory. A routine upload does not need permanent IDs or a written reason; ambiguous matches still block saving, and actual warnings or edits to previously reconciled months require a reason.

The workbook remains the source of truth. Correct source dates, plates and amounts in Excel, then upload again. The preview no longer edits source values. Imports preserve records absent from the upload; they do not delete them automatically.

## Recommended workbook format

Use these exact sheet names and headers in row 1. No merged cells, subtotal rows or blank column headers. IDs must remain unchanged across corrections and row reordering. Dates are ISO text (`2026-08-03`); monetary cells are numbers in rupiah.

- **Trips**: `trip_id,date,invoice,truck,container,destination,revenue`
- **Expenses**: `expense_id,date,trip_id,truck,description,category,amount,paid_by,holder_id,cash_entry_id`
- **Month Control**: `month,holder_id,coverage_through,opening,transfers,spending,closing`

One expense per row, including every driver cost. A nonblank `trip_id` links a driver cost to a trip with the same date and truck. Trip cost and profit are derived from those expenses. Leave `trip_id` blank for other expenses. Use permanent unique IDs such as `TR-000001` and `EX-000001`, never row numbers. Referenced trips must be present in the selected month. Changes that move an ID between months require separate reconciliation first.

`paid_by` is `petty_cash`, `main_cash`, or `personal_advance`. Petty expenses require the existing holder ID. Main-cash expenses require a unique existing cash-out entry ID with matching date and amount; a top-up cannot also fund an expense directly. Personal advances require a review reason and do not create a payment. An import never creates cash movements.

Month Control has exactly one row per imported month/holder. This version imports one holder per month per upload. Example: `2026-08,h1,2026-08-13,0,5000000,1200000,3800000`. Coverage includes month start through that date. Expense details must cover the entire declared period. Later website records are preserved and excluded from its balance check.

## Approval gates

Configure fleet and holder first. Record/reconcile top-ups with their main-cash links before importing. The preview requires:

1. Valid dates, numeric amounts, known plates and unambiguous record identity.
2. Opening balance matching the website's earlier-period closing.
3. Transfer totals matching existing top-ups, each with a valid unique cash link.
4. Detailed petty spending matching the control total.
5. Opening + transfers − spending = closing, both in the source and after applying the proposed changes.
6. Explicit acknowledgment. Warnings (legacy matching, negative balance, retained records, personal advances, changes to a previously reconciled month) also require a review reason of at least 10 characters.

The import history stores controls, resulting totals, warning text, reason and acknowledgment alongside record changes. Errors have no override. Repeating the same structured workbook skips unchanged records.

## Existing monthly workbooks

Legacy monthly trip tabs remain supported alongside a KAS sheet or an explicit Month Control sheet. They require a review reason because they lack permanent IDs. Payment classifications can be selected in the preview. Ambiguous old matches block rather than guessing. KAS transfer dates must match, not merely their aggregate amount. Blank spending/closing cells are errors, not zero. Standalone CSV cannot be approved without workbook controls: use XLSX instead.

For incomplete months, add Month Control with the actual coverage date. Legacy KAS defaults to month end and cannot establish a partial cutoff. Mixed-month KAS blocks, incorrect years, unknown plates and discrepancies between detail and summary must be corrected in the source. Do not manufacture detail just to force totals to match; document and resolve unallocated amounts explicitly.

## Separate follow-up

These are application import controls, not database constraints. This PR does not migrate the shared Supabase JSON record, introduce server-side authorization, prevent concurrent clients overwriting that record, or close accounting periods. Normalized tables, database uniqueness/foreign keys, atomic transactions and concurrency controls belong in the separate migration PR. Existing manual-entry paths retain their current behavior.
