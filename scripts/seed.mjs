// One-time seed script — inserts initial business data into Supabase.
// Safe to re-run: skips if kinkin_v1 already exists.
//
// Usage: node scripts/seed.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ivybpomjhgfkrmfuxfsm.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2eWJwb21qaGdma3JtZnV4ZnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1ODc5ODgsImV4cCI6MjA5NTE2Mzk4OH0.XnyEZtovivUIU1E0sg8gKEsan_9882GR5M0PwJvjJsU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const INITIAL_DATA = {
  trips: [],
  expenses: [
    { id: "exp001", date: "2026-04-02", category: "Admin", description: "Incorporation / Lawyer fee", amount: 7500000, expenseType: "overhead", truck: "", vendor: "Yunny Kisworo", source: "manual" },
    { id: "exp002", date: "2026-04-14", category: "Admin", description: "Port License", amount: 400000, expenseType: "overhead", truck: "", vendor: "Samsul Bahri", source: "manual" },
    { id: "exp003", date: "2026-05-06", category: "Admin", description: "STID fee / Port License", amount: 700000, expenseType: "overhead", truck: "", vendor: "", source: "manual" },
    { id: "exp004", date: "2026-04-07", category: "Spare Parts", description: "Tires", amount: 7280000, expenseType: "truck", truck: "B9674UEJ", vendor: "ENES TIANA", source: "manual" },
    { id: "exp005", date: "2026-05-20", category: "Spare Parts", description: "Tires", amount: 7280000, expenseType: "truck", truck: "E9129YB", vendor: "", source: "manual" },
  ],
  kas: [
    { id: "k001", date: "2026-01-23", description: "Capital injection — Sintawati", amount: 500000000, type: "in" },
    { id: "k002", date: "2026-03-31", description: "Downpayment B9674UEJ — Arthadina Langgeng Logistindo", amount: 20000000, type: "out" },
    { id: "k003", date: "2026-04-14", description: "Remaining downpayment B9674UEJ — Herlinda Risma Djaja", amount: 99050000, type: "out" },
    { id: "k004", date: "2026-04-14", description: "Downpayment E9129YB truck", amount: 20000000, type: "out" },
    { id: "k005", date: "2026-04-02", description: "Incorporation / Lawyer fee — Yunny Kisworo", amount: 7500000, type: "out" },
    { id: "k006", date: "2026-04-14", description: "Port License — Samsul Bahri", amount: 400000, type: "out" },
    { id: "k007", date: "2026-05-06", description: "STID fee / Port License", amount: 700000, type: "out" },
    { id: "k008", date: "2026-04-07", description: "Tires B9674UEJ — ENES TIANA", amount: 7280000, type: "out" },
    { id: "k009", date: "2026-05-20", description: "Tires E9129YB", amount: 7280000, type: "out" },
    { id: "k010", date: "2026-04-28", description: "Operating cash to Martha", amount: 3000000, type: "out" },
    { id: "k011", date: "2026-05-07", description: "Operating cash to Martha", amount: 5000000, type: "out" },
    { id: "k012", date: "2026-05-13", description: "Operating cash to Martha", amount: 5000000, type: "out" },
    { id: "k013", date: "2026-04-30", description: "April trip expenses paid from Martha cash (per CSV)", amount: 3842000, type: "out" },
    { id: "k014", date: "2026-05-12", description: "1st installment B9674UEJ — Arthadina Langgeng Logistindo", amount: 10877000, type: "out" },
  ],
  capital: [
    { id: "cap001", date: "2026-01-23", source: "Sintawati", description: "Owner financing / capital injection", amount: 500000000, type: "capital" },
  ],
  loans: [
    { id: "loan001", lender: "Arthadina Langgeng Logistindo", purpose: "Truck B9674UEJ", truckId: "asset001", vehicleValue: 390000000, principal: 390000000, monthlyPayment: 10877000, startDate: "2026-03-31", termMonths: 36, notes: "DP 20,000,000 (31 Mar via Arthadina) + remaining 99,050,000 (14 Apr via Herlinda Risma Djaja). Monthly 10,877,000 x 36 months." },
    { id: "loan002", lender: "Arthadina Langgeng Logistindo", purpose: "Truck E9129YB", truckId: "asset002", vehicleValue: 460000000, principal: 460000000, monthlyPayment: 12028000, startDate: "2026-04-14", termMonths: 36, notes: "DP 20,000,000 (14 Apr). Monthly 12,028,000 x 36 months." },
  ],
  assets: [
    { id: "asset001", name: "Truck B9674UEJ", assetType: "Truck", nopol: "B9674UEJ", purchaseDate: "2026-03-31", purchasePrice: 390000000, financedBy: "loan001", status: "active", notes: "36-month contract at 10,877,000/month. DP 20M (Mar) + remaining 99.05M (Apr)." },
    { id: "asset002", name: "Truck E9129YB", assetType: "Truck", nopol: "E9129YB", purchaseDate: "2026-04-14", purchasePrice: 460000000, financedBy: "loan002", status: "active", notes: "36-month contract at 12,028,000/month. DP 20M (Apr)." },
  ],
  loanPayments: [
    { id: "pay001", loanId: "loan001", date: "2026-05-12", amount: 10877000, note: "1st installment — B9674UEJ (Arthadina)" },
  ],
  importLogs: [],
  pettyHolders: [
    { id: "ph001", name: "Martha", active: true, notes: "Handles daily operational expenses — reports monthly via CSV" },
  ],
  pettyTopups: [
    { id: "pt001", holderId: "ph001", date: "2026-04-28", amount: 3000000, note: "Operating cash April" },
    { id: "pt002", holderId: "ph001", date: "2026-05-07", amount: 5000000, note: "Operating cash May (1)" },
    { id: "pt003", holderId: "ph001", date: "2026-05-13", amount: 5000000, note: "Operating cash May (2)" },
  ],
};

const { data: existing } = await supabase
  .from("kinkin_state")
  .select("key")
  .eq("key", "kinkin_v1")
  .single();

if (existing) {
  console.log("✓ Data already exists in Supabase — no seed needed.");
} else {
  const { error } = await supabase
    .from("kinkin_state")
    .insert({ key: "kinkin_v1", value: INITIAL_DATA, updated_at: new Date().toISOString() });

  if (error) {
    console.error("✗ Seed failed:", error.message);
    process.exit(1);
  } else {
    console.log("✓ Seeded initial data into Supabase.");
  }
}
