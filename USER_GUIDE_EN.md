# User Guide — Kin Kin Trukindo App

This guide is for the admin or owner who manages the app on a daily basis. No technical background required.

---

## Getting Started

**Open in your browser:** [kinkintrukindo.com](https://kinkintrukindo.com)

The app works on any device — laptop, phone, or tablet — because all data is stored in the cloud. Nothing to install.

**Login:** Enter the authorization code, then click **Authorize**.

---

## Main Layout

At the top you will find **7 tabs** (menu items). Click a tab to navigate:

| Tab | Purpose |
|---|---|
| 📊 Dashboard | Overall business summary |
| 🚛 Trips | List of all truck trips |
| 💸 Expenses | Record all expenditures |
| 🏦 Cash | Cash in and cash out ledger |
| 👛 Petty Cash | Daily operational cash (Martha) |
| 💰 Capital & Fleet | Truck assets, loan installments, and capital |
| 📄 Reports | Financial reports |

---

## Tab 1 — Dashboard

This is the first page you see when you open the app. It contains:

**KPI Cards (the large numbers at the top):**
- **Total Revenue** — total value of invoices sent to clients
- **Trip Gross Profit** — gross profit from trips (revenue minus driver costs)
- **Truck Ops Expenses** — truck operational expenses (fuel, toll, spare parts, etc.)
- **Overhead Expenses** — office/admin expenses (administration, permits, etc.)
- **Net Profit** — net profit after all expenses
- **Cash Balance** — remaining cash on hand

Click any card to see a detailed breakdown.

**Charts:** Show monthly revenue and profit trends.

**Import Excel:** The yellow **📥 Import Excel Sheet** button in the top-right corner. Used each month to load Martha's report.

**Import History:** A log of all previously imported files. Use the 🗑 Undo button to reverse an import if a mistake was made.

---

## Tab 2 — Trips

A complete list of all truck trips. Each row contains:
- Date, invoice number, destination, truck plate, container number
- **Sangu** = driver allowance
- **Other Costs** = additional costs
- **Total** = total driver cost (sangu + other costs)
- **Invoiced (Jual)** = invoice value to client (revenue)
- **Profit** = invoiced amount minus total driver cost

### Adding a Trip Manually

Click **+ Add Trip** in the top right, fill in the form, then click **Add Trip**.

### Editing a Trip

Click ✏️ on the trip row you want to change. Edit directly in the table, click ✓ to save or ✕ to cancel.

### Deleting a Trip

Click 🗑 on the row you want to delete. A confirmation prompt will appear before the entry is removed.

---

## Tab 3 — Expenses

This tab records all company expenditures, split into three types:

### Expense Types

**Truck / Operational** — expenses directly related to trucks:
- Fuel, Toll, Repair, Spare Parts, Garage, etc.

**Overhead** — office and business expenses:
- Salary, Office Rent, Utilities, Admin, Insurance, Marketing, etc.

**Petty Cash** — topping up Martha's operational cash (see the Petty Cash tab)

### Adding an Expense

1. Select the type: **Truck**, **Overhead**, or **Petty Cash**
2. Fill in the date, category, description, and amount
3. For **Truck**: select which truck plate
4. For **Overhead**: enter the vendor name (optional)
5. Click **+ Add Expense**

### Period Filter

At the top, use the **All Time / This Month / Last Month / Year to Date** buttons to filter the view. You can also select a custom date range.

---

## Tab 4 — Cash

A simple cash ledger — records all money flowing in and out of the company's cash or bank account.

**Cash Balance** = total cash in minus total cash out.

### Adding a Cash Entry

1. Choose **Cash In** or **Cash Out**
2. Fill in the date, description, and amount
3. Click **+ Add Entry**

> **Note:** Petty cash top-ups to Martha are automatically recorded here when added from the Petty Cash or Expenses tab. Truck loan installment payments are also automatically recorded here when logged from the Capital & Fleet tab.

---

## Tab 5 — Petty Cash

This tab tracks the **daily operational cash** held by Martha.

**How it works:**
- The company gives Martha money (top-up)
- Martha uses it for daily operational expenses
- Each month Martha reports her expenses via a CSV/Excel file
- Martha's balance = total money given − total expenses recorded

### Viewing Martha's Details

Click the **Martha** card to see all top-ups and expenses recorded under her name.

### Recording a Top-Up for Martha

In the **Record Top-Up** section, select Martha, fill in the date and amount, then click **+ Record Top-Up**.

> This is also automatically recorded as a **Cash Out** in the Cash tab.

### Unassigned Expenses

If any imported expenses have not yet been assigned to Martha, an **Unassigned Expenses** card will appear. Click **Assign to [Name]** to assign them.

---

## Tab 6 — Capital & Fleet

This tab is divided into two sub-tabs:

### Sub-tab: Fleet & Loans

Shows both trucks and their installment schedules:
- **B9674UEJ** — Rp 10,877,000/month × 36 months (from March 2026)
- **E9129YB** — Rp 12,028,000/month × 36 months (from April 2026)

**Recording an installment payment:**
1. On the relevant truck card, click **+ Record Payment**
2. Fill in the date and amount
3. Click **Add Payment**

> The remaining loan balance will automatically decrease, **and the payment will be automatically recorded as a Cash Out in the Cash tab** — no need to enter it manually in Cash.

**Adding a new truck:** Click **+ Add Truck** in the top right.

### Sub-tab: Capital Injections

Records money injected into the business from the owner or external financing (not truck installments).

**How to add:**
1. Select the type: **Owner Capital** (own funds) or **Loan / Other Financing** (borrowed money)
2. Fill in the form and click **+ Record Capital / Loan**

---

## Tab 7 — Reports

Full financial report with date filtering.

### How to Use

1. Select a period: **All Time / This Month / Last Month / Year to Date** or a custom range
2. The report updates automatically

### Exporting to Excel

Click **📥 Download Excel Report** to download the report as an `.xlsx` file.

---

## Importing Martha's Monthly Report (Most Important!)

Each month Martha sends an Excel or CSV file containing the list of trips and expenses. How to import:

1. Open the **Dashboard** tab
2. Click **📥 Import Excel Sheet**
3. Select the file from your computer
4. A window will appear — **select the month** that matches the report
5. Click **📋 Parse & Preview →**
6. Review the detected trips and expenses — all fields are editable if anything looks wrong
7. Click **✓ Confirm Import** when everything looks correct

**What happens automatically:**
- Duplicate entries (trips already in the system) are silently skipped
- Expenses are automatically assigned to Martha if she is the only active petty cash holder
- The import is saved in **Import History** and can be reversed if needed

---

## Reversing a Mistaken Import

1. Open the **Dashboard** tab
2. Scroll down to **📜 Import History**
3. Find the incorrect import
4. Click **🗑 Undo**
5. Enter the admin password to confirm — all trips and expenses from that import will be deleted

---

## Resetting All Data

> ⚠️ **Warning: This permanently deletes ALL data.**

At the very bottom of the Dashboard, there is a **Danger Zone** section with a **Reset All Data** button. Only use this if you truly need to start from scratch. Admin password required.

---

## Frequently Asked Questions

**Is data safe if I close the browser?**
Yes. All data is saved to the cloud (Supabase) automatically every time a change is made.

**Can two people use the app at the same time?**
Yes, but avoid editing the same data simultaneously as this can cause conflicts.

**How do I open it on my phone?**
Open a browser (Chrome or Safari), type `kinkintrukindo.com`, and enter the authorization code.

**Why does the cash balance look different from what I expect?**
Make sure all truck loan installments are recorded in the **Capital & Fleet** tab — payments are automatically counted as Cash Out. Operational expenses must also be recorded for the balance to be accurate.

**What if Martha has expenses that haven't been recorded yet?**
Add them manually in the **Expenses** tab → select **Petty Cash** → select Martha.

---

## Technical Contact

For feature changes, bug fixes, or technical assistance, contact the developer and provide access to:
- Codebase in the `kinkin-app` folder
- Supabase project: `ivybpomjhgfkrmfuxfsm`
- Vercel project: `kinkin-app` under team `info-95777617s-projects`
