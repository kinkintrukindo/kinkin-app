import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── Utility helpers ──────────────────────────────────────────────────────────
const fmt = (n) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);

const today = () => new Date().toISOString().slice(0, 10);

function genId() {
  return Math.random().toString(36).slice(2, 9);
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

// ── CSV parser that handles quoted values with commas ─────────────────────────
function parseCSV(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line === "") { rows.push([]); continue; }
    const cells = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (c === "," && !inQuote) {
        cells.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

// ── Parse the employee's monthly sheet ────────────────────────────────────────
// The sheet has TWO sections:
//   Section 1: TRIPS (starts after header row "NO,TANGGAL MUAT,...", ends at "TOTAL" row)
//   Section 2: EXPENSES (starts at "PENGELUARAN TAMBAHAN ...", ends at final "TOTAL" row)
// Each trip can span multiple rows (sub-rows for extra LAIN-LAIN charges).
// Returns { trips, expenses, truckPlate } — truckPlate is auto-detected.

function parseMonthlySheet(rows, monthYear, holderId = "") {
  // Helper to parse currency strings like "  1,050,000 " -> 1050000
  const num = (v) => {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return v;
    const cleaned = String(v).replace(/[^0-9.-]/g, "");
    return cleaned === "" || cleaned === "-" ? 0 : Number(cleaned);
  };
  const str = (v) => (v == null ? "" : String(v).trim());

  // Parse various date formats (Excel serial, M/D/YYYY, DD/MM/YYYY, etc.)
  const parseDate = (v) => {
    if (!v) return "";
    if (typeof v === "number" && v > 40000) {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return d.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    if (!s) return "";
    // Try M/D/YYYY or D/M/YYYY
    const parts = s.split(/[\/\-]/);
    if (parts.length === 3) {
      let [a, b, c] = parts.map(Number);
      if (c < 100) c += 2000;
      // Assume M/D/YYYY (US format from CSV)
      if (a > 0 && a <= 12 && b > 0 && b <= 31) {
        return `${c}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
      }
    }
    // Already ISO?
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return s;
  };

  const trips = [];
  const expenses = [];
  let truckPlate = "";
  // Each entry: { plate, labelCol, amtCol } — one per truck column group in the sheet
  let truckColumns = [];

  // ── Find boundaries ─────────────────────────────────────────────────────
  let tripStartIdx = -1;
  let tripEndIdx = -1;
  let expStartIdx = -1;
  let expEndIdx = -1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const firstCell = str(row[0]).toUpperCase();
    const secondCell = str(row[1]).toUpperCase();

    if (tripStartIdx === -1 && firstCell === "NO" && secondCell.includes("TANGGAL")) {
      tripStartIdx = i + 1;
      continue;
    }
    if (tripStartIdx !== -1 && tripEndIdx === -1 && secondCell === "TOTAL") {
      tripEndIdx = i;
      continue;
    }
    if (firstCell.startsWith("PENGELUARAN TAMBAHAN")) {
      // Scan every 3rd column across the row for truck headers (col 0, 3, 6, ...)
      // Martha's format: each truck section occupies 2 data cols + 1 spacer col
      truckColumns = [];
      for (let c = 0; c < row.length; c += 3) {
        const cell = str(row[c]).toUpperCase();
        const match = cell.match(/PENGELUARAN TAMBAHAN\s+(.+)/);
        if (match) {
          const plate = match[1].trim();
          truckColumns.push({ plate, labelCol: c, amtCol: c + 1 });
          if (!truckPlate) truckPlate = plate; // keep first plate for legacy return value
        }
      }
      expStartIdx = i + 2;
      continue;
    }
    if (expStartIdx !== -1 && expEndIdx === -1 && firstCell === "TOTAL") {
      expEndIdx = i;
    }
  }

  // ── Parse trips section ─────────────────────────────────────────────────
  if (tripStartIdx !== -1) {
    const endIdx = tripEndIdx === -1 ? rows.length : tripEndIdx;
    let currentTrip = null;

    for (let i = tripStartIdx; i < endIdx; i++) {
      const row = rows[i];
      if (!row) continue;
      const no = row[0];
      const isTripStart = no !== "" && no != null && !isNaN(Number(no));

      if (isTripStart) {
        // Save previous trip if any
        if (currentTrip && (currentTrip.destination || currentTrip.jual > 0)) {
          trips.push(currentTrip);
        }
        const dateStr = parseDate(row[1]);
        const invNo = str(row[2]);
        const destination = str(row[3]);
        const nopol = str(row[4]);
        const contNo = str(row[5]);
        const sangu = num(row[6]);
        const firstLainLabel = str(row[7]);
        const firstLainAmt = num(row[8]);
        const total = num(row[9]);
        const jual = num(row[10]);
        const profit = num(row[11]);

        // Skip empty placeholder rows (NO=4, NO=5 in the sample)
        if (!destination && !jual && !contNo) {
          currentTrip = null;
          continue;
        }

        currentTrip = {
          no: Number(no),
          date: dateStr,
          invNo,
          destination,
          nopol,
          contNo,
          sangu,
          lainItems: firstLainLabel || firstLainAmt > 0 ? [{ label: firstLainLabel, amount: firstLainAmt }] : [],
          total,
          jual,
          profit,
        };

        // Capture truck plate from first trip if not yet known
        if (!truckPlate && nopol) truckPlate = nopol;
      } else if (currentTrip) {
        // Sub-row with extra LAIN-LAIN charge under the current trip
        const subLabel = str(row[7]);
        const subAmt = num(row[8]);
        if (subLabel || subAmt > 0) {
          currentTrip.lainItems.push({ label: subLabel, amount: subAmt });
        }
      }
    }

    // Don't forget the last trip
    if (currentTrip && (currentTrip.destination || currentTrip.jual > 0)) {
      trips.push(currentTrip);
    }
  }

  // Consolidate lainItems into a single lainLabel/lainAmt for backward compat
  for (const t of trips) {
    const totalLain = t.lainItems.reduce((s, x) => s + x.amount, 0);
    const labels = t.lainItems.filter((x) => x.label).map((x) => x.label).join(" + ");
    t.lainLabel = labels;
    t.lainAmt = totalLain;
    t.id = genId();
    t.source = "import";
  }

  // Emit driver cost expense entries (sangu + each lain item) for Expenses tab + petty cash tracking
  for (const t of trips) {
    if (t.sangu > 0) {
      expenses.push({
        id: genId(),
        date: t.date,
        category: "Salary",
        description: `Driver Allowance${t.destination ? " — " + t.destination : ""}`,
        amount: t.sangu,
        expenseType: "driver",
        truck: t.nopol,
        holderId: holderId || "unassigned",
        source: "import",
        _fpKey: `DRIVER:${t.date}|SANGU|${t.nopol || ""}|${t.sangu}`,
      });
    }
    for (const item of t.lainItems) {
      if (!item.amount || item.amount <= 0) continue;
      expenses.push({
        id: genId(),
        date: t.date,
        category: categorizeExpense(item.label || "Other"),
        description: item.label || "Misc. Expense",
        amount: item.amount,
        expenseType: "driver",
        truck: t.nopol,
        holderId: holderId || "unassigned",
        source: "import",
        _fpKey: `DRIVER:${t.date}|${(item.label || "LAIN").toUpperCase()}|${t.nopol || ""}|${item.amount}`,
      });
    }
  }

  // ── Parse expenses section ──────────────────────────────────────────────
  if (expStartIdx !== -1) {
    const endIdx = expEndIdx === -1 ? rows.length : expEndIdx;
    // Fall back to legacy two-column behaviour if no truckColumns were detected
    const cols = truckColumns.length > 0
      ? truckColumns
      : [{ plate: truckPlate, labelCol: 0, amtCol: 1 }, { plate: truckPlate, labelCol: 3, amtCol: 4 }];
    for (let i = expStartIdx; i < endIdx; i++) {
      const row = rows[i];
      if (!row) continue;
      for (const { plate, labelCol, amtCol } of cols) {
        const label = str(row[labelCol]);
        const amt = num(row[amtCol]);
        if (!label) continue;
        const lu = label.toUpperCase();
        if (lu === "TOTAL" || lu === "KETERANGAN" || lu === "NOMINAL") continue;
        if (amt <= 0) continue;
        expenses.push({
          id: genId(),
          date: monthYear || new Date().toISOString().slice(0, 10),
          category: categorizeExpense(label),
          description: label,
          amount: amt,
          truck: plate,
          expenseType: "truck",
          source: "import",
          _fpKey: `EXP:${monthYear}|${plate}|${lu}|${amt}`,
        });
      }
    }
  }

  return { trips, expenses, truckPlate };
}

// Auto-categorize expenses based on the description keyword
function categorizeExpense(desc) {
  const u = desc.toUpperCase();
  if (u.includes("TOL") || u.includes("PORTAL") || u.includes("PARKIR")) return "Toll";
  if (u.includes("BBM") || u.includes("SOLAR") || u.includes("PERTAMAX")) return "Fuel";
  if (u.includes("SPART") || u.includes("SPARE")) return "Spare Parts";
  if (u.includes("DANDAN") || u.includes("REPAIR") || u.includes("PERBAIKAN")) return "Repair";
  if (u.includes("GARASI") || u.includes("GARAGE")) return "Garage";
  return "Other";
}



// ── XLSX download helper ──────────────────────────────────────────────────────
function downloadExcel(filename, sheetData) {
  // sheetData: { sheetName: [[row],[row],...] }
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheetData)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, filename);
}



// ── Supabase persistence ──────────────────────────────────────────────────────
const STORE_KEY = "kinkin_v1";

async function loadState() {
  try {
    const { data, error } = await supabase
      .from("kinkin_state")
      .select("value")
      .eq("key", STORE_KEY)
      .single();
    if (error || !data) return null;
    return data.value;
  } catch { return null; }
}

async function saveState(state) {
  try {
    await supabase
      .from("kinkin_state")
      .upsert({ key: STORE_KEY, value: state, updated_at: new Date().toISOString() });
  } catch (e) {
    console.warn("Storage save failed:", e);
  }
}



// ── CATEGORY COLORS ────────────────────────────────────────────────────────────
const CAT_COLOR = {
  // Truck / operational
  Fuel: "#f59e0b",
  Toll: "#60a5fa",
  Repair: "#f87171",
  "Spare Parts": "#8b5cf6",
  Garage: "#34d399",
  // Overhead
  Salary: "#ec4899",
  "Office Rent": "#06b6d4",
  Utilities: "#14b8a6",
  Admin: "#a78bfa",
  Insurance: "#f43f5e",
  Marketing: "#fb923c",
  Other: "#6b7280",
};

const TRUCK_CATEGORIES = ["Fuel", "Toll", "Repair", "Spare Parts", "Garage", "Other"];
const OVERHEAD_CATEGORIES = ["Salary", "Office Rent", "Utilities", "Admin", "Insurance", "Marketing", "Other"];

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
const TABS = [
  { key: "dashboard", label: "Dashboard",       short: "Dash" },
  { key: "trips",     label: "Trips",           short: "Trips" },
  { key: "expenses",  label: "Expenses",        short: "Costs" },
  { key: "kas",       label: "Cash",            short: "Cash" },
  { key: "petty",     label: "Petty Cash",      short: "Petty" },
  { key: "fleet",     label: "Fleet",           short: "Fleet" },
  { key: "reports",   label: "Reports",         short: "Report" },
  { key: "settings",  label: "Settings",        short: "Opts" },
];

function KinKinApp() {
  const [tab, setTab] = useState("dashboard");
  const isMobile = useIsMobile();
  const [trips, setTrips] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [kas, setKas] = useState([]);
  const [capital, setCapital] = useState([]);
  const [loans, setLoans] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loanPayments, setLoanPayments] = useState([]);
  const [importLogs, setImportLogs] = useState([]);
  const [pettyHolders, setPettyHolders] = useState([]);
  const [pettyTopups, setPettyTopups] = useState([]);
  const [uploadModal, setUploadModal] = useState(null); // { file, fileName, monthYear }
  const [confirmModal, setConfirmModal] = useState(null); // { title, message, onConfirm }
  const [toast, setToast] = useState(null);
  const [importing, setImporting] = useState(false);
  const [appLoading, setAppLoading] = useState(true);
  const [deleteGuard, setDeleteGuard] = useState(null); // { message, onConfirm }
  const [deleteGuardCode, setDeleteGuardCode] = useState("");
  const [deleteGuardErr, setDeleteGuardErr] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [cashBackfillDone, setCashBackfillDone] = useState(false);
  const [appPassword, setAppPassword] = useState(APP_PASSWORD);
  const [saveStatus, setSaveStatus] = useState("saved"); // "saved" | "saving" | "error"
  const [fabOpen, setFabOpen] = useState(false);
  const [fabMode, setFabMode] = useState(null); // "cash-in"|"cash-out"|"expense"|"trip"
  const [fabForm, setFabForm] = useState({});
  const globalFileRef = useRef(null);

  const _skipSave = useRef(true);

  useEffect(() => {
    loadState().then((saved) => {
      if (saved) {
        setTrips(saved.trips ?? []);
        setExpenses(saved.expenses ?? []);
        setCapital(saved.capital ?? []);
        setLoans(saved.loans ?? []);
        setAssets(saved.assets ?? []);
        setLoanPayments(saved.loanPayments ?? []);
        setImportLogs(saved.importLogs ?? []);
        setPettyHolders(saved.pettyHolders ?? []);
        setPettyTopups(saved.pettyTopups ?? []);
        setActivityLog(saved.activityLog ?? []);
        setCashBackfillDone(saved.cashBackfillDone ?? false);
        if (saved.appPassword) { setAppPassword(saved.appPassword); _runtimePassword = saved.appPassword; }

        // One-time migration: create kas "out" entries for historical manually-added
        // truck and overhead expenses that were logged before the cash-deduction fix.
        const existingKas = saved.kas ?? [];
        const existingExpenses = saved.expenses ?? [];
        if (!saved.cashBackfillDone) {
          const manual = existingExpenses.filter(
            (e) => (e.expenseType === "truck" || e.expenseType === "overhead") && e.source !== "import"
          );
          const backfillEntries = manual.map((e) => ({
            id: genId(),
            date: e.date,
            description: e.expenseType === "truck"
              ? `Truck expense — ${e.truck || ""}${e.description ? ": " + e.description : ""}`
              : `Overhead — ${e.description}${e.vendor ? " (" + e.vendor + ")" : ""}`,
            amount: e.amount,
            type: "out",
          }));
          setKas([...existingKas, ...backfillEntries]);
          setCashBackfillDone(true);
          if (backfillEntries.length > 0) {
            setActivityLog((prev) => [
              { id: genId(), at: new Date().toISOString(), action: "migration", type: "cash", description: `Backfilled ${backfillEntries.length} kas entries for historical truck/overhead expenses` },
              ...prev,
            ]);
          }
        } else {
          setKas(existingKas);
        }
      }
      _skipSave.current = false;
      setAppLoading(false);
    });
  }, []);

  // Keep module-level ref in sync so LoginGate always reads the current password
  useEffect(() => { _runtimePassword = appPassword; }, [appPassword]);

  // Auto-save whenever any data changes
  useEffect(() => {
    if (_skipSave.current) return;
    setSaveStatus("saving");
    saveState({ trips, expenses, kas, capital, loans, assets, loanPayments, importLogs, pettyHolders, pettyTopups, activityLog, cashBackfillDone, appPassword })
      .then(() => setSaveStatus("saved"))
      .catch(() => setSaveStatus("error"));
  }, [trips, expenses, kas, capital, loans, assets, loanPayments, importLogs, pettyHolders, pettyTopups, activityLog, cashBackfillDone, appPassword]);

  // Step 1: User picks a file — open modal asking for month/year
  // ── Fingerprint for deduplication — container # is physically unique ────────
  const fingerprint = (t) => {
    const cn = t.contNo != null ? String(t.contNo).trim() : "";
    if (cn) return `CONT:${t.date}|${cn.toUpperCase()}`;
    const np = String(t.nopol || "").toUpperCase();
    const ds = String(t.destination || "").toUpperCase();
    return `ALT:${t.date}|${np}|${ds}|${t.jual}`;
  };

  const handleGlobalImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const now = new Date();
    const defaultMonthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    setUploadModal({ file, fileName: file.name, monthYear: defaultMonthYear });
    e.target.value = "";
  };

  // Step 2: User confirms month/year — parse and preview
  const proceedWithUpload = async () => {
    if (!uploadModal) return;
    const { file, monthYear } = uploadModal;
    setImporting(true);
    try {
      const data = await file.arrayBuffer();
      const fileName = file.name.toLowerCase();
      let allRows = [];

      if (fileName.endsWith(".csv")) {
        const text = new TextDecoder().decode(data);
        allRows = parseCSV(text);
      } else {
        const wb = XLSX.read(data, { type: "array" });
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          if (rows.length > 0) {
            allRows = rows;
            break;
          }
        }
      }

      const monthDate = monthYear + "-01";
      const result = parseMonthlySheet(allRows, monthDate);

      if (result.trips.length === 0 && result.expenses.length === 0) {
        showToast("No trips or expenses found in this file", "error");
        setImporting(false);
        setUploadModal(null);
        return;
      }

      for (const t of result.trips) {
        if (!t.date) t.date = monthDate;
      }

      // Mark duplicates at preview time so the user can see what's new vs already imported
      const previewExistingByFp = new Map(trips.map((t) => [fingerprint(t), t]));
      const previewExpFp = new Set();
      for (const e of expenses.filter((e) => e._fpKey)) {
        previewExpFp.add(e._fpKey);
        const parts = e._fpKey.split("|");
        if (parts.length === 3 && e.truck) previewExpFp.add(`${parts[0]}|${e.truck}|${parts[1]}|${parts[2]}`);
      }

      setUploadModal({
        ...uploadModal,
        previewReady: true,
        parsed: {
          ...result,
          trips: result.trips.map((t) => ({ ...t, _isDuplicate: previewExistingByFp.has(fingerprint(t)) })),
          expenses: result.expenses.map((e) => ({ ...e, usePettyCash: true, _isDuplicate: e._fpKey ? previewExpFp.has(e._fpKey) : false })),
        },
      });
    } catch (err) {
      showToast("Import failed: " + err.message, "error");
    }
    setImporting(false);
  };

  // Step 3: User confirms preview — actually commit + create log entry
  const confirmGlobalImport = () => {
    if (!uploadModal || !uploadModal.parsed) return;
    const { parsed, monthYear, fileName } = uploadModal;

    // ── Deduplicate trips against existing ────────────────────────────────────
    const existingByFp = new Map(trips.map((t) => [fingerprint(t), t]));
    const newTrips = parsed.trips.filter((t) => !existingByFp.has(fingerprint(t)));
    const skippedCount = parsed.trips.length - newTrips.length;

    // ── Deduplicate expenses against existing ─────────────────────────────────
    // Build the set of existing keys, and also derive the new-format equivalent
    // for expenses that were saved with the old key format (no plate in key),
    // so re-uploading a month doesn't create duplicates for already-imported rows.
    const existingExpFp = new Set();
    for (const e of expenses.filter((e) => e._fpKey)) {
      existingExpFp.add(e._fpKey);
      // Old format: EXP:{date}|{LABEL}|{amt}  (3 pipe-separated parts)
      // New format: EXP:{date}|{plate}|{LABEL}|{amt}  (4 parts)
      // If old format and we have a truck plate, also register the new-format key
      const parts = e._fpKey.split("|");
      if (parts.length === 3 && e.truck) {
        existingExpFp.add(`${parts[0]}|${e.truck}|${parts[1]}|${parts[2]}`);
      }
    }
    const newExpenses = parsed.expenses.filter((e) => {
      if (!e._fpKey) return true;
      if (existingExpFp.has(e._fpKey)) return false;
      existingExpFp.add(e._fpKey);
      return true;
    });
    const skippedExpCount = parsed.expenses.length - newExpenses.length;

    // Assign holderId based on per-expense usePettyCash flag set in the preview
    const activeHolders = pettyHolders.filter((h) => h.active);
    const autoHolderId = activeHolders.length === 1 ? activeHolders[0].id : "unassigned";
    const taggedExpenses = newExpenses.map((e) => {
      if (e.source !== "import") return e;
      const { usePettyCash: _flag, ...rest } = e;
      return { ...rest, holderId: _flag !== false ? autoHolderId : "" };
    });

    const tripIds = newTrips.map((t) => t.id);
    const expenseIds = taggedExpenses.map((e) => e.id);

    setTrips([...trips, ...newTrips]);
    setExpenses([...expenses, ...taggedExpenses]);

    // Sheet expenses (driver costs + pengeluaran tambahan) are paid by Martha
    // from her petty cash — they do NOT touch the main cash balance directly.
    // Main cash only reduces when Martha receives a top-up from the Cash tab.
    const kasIds = [];

    const log = {
      id: genId(),
      importedAt: new Date().toISOString(),
      fileName,
      monthYear,
      truckPlate: parsed.truckPlate || "—",
      tripIds,
      expenseIds,
      kasIds,
      summary: {
        tripCount: newTrips.length,
        skippedDuplicates: skippedCount,
        expenseCount: newExpenses.length,
        skippedExpenses: skippedExpCount,
        totalRevenue: newTrips.reduce((s, t) => s + t.jual, 0),
        totalCosts: newTrips.reduce((s, t) => s + t.total, 0),
        totalExpenses: newExpenses.reduce((s, e) => s + e.amount, 0),
      },
    };
    setImportLogs([log, ...importLogs]);
    logActivity("import", "import", `Imported ${fileName} — ${newTrips.length} trips, ${taggedExpenses.length} expenses`);

    const parts = [];
    if (newTrips.length > 0)    parts.push(`${newTrips.length} trips`);
    if (newExpenses.length > 0) parts.push(`${newExpenses.length} expenses`);
    const skips = [];
    if (skippedCount > 0)    skips.push(`${skippedCount} duplicate trips skipped`);
    if (skippedExpCount > 0) skips.push(`${skippedExpCount} duplicate expenses skipped`);
    const msg = `✅ Imported: ${parts.join(" + ")}${skips.length ? ` (${skips.join(", ")})` : ""}`;
    showToast(msg);
    setUploadModal(null);
  };

  const cancelGlobalImport = () => {
    setUploadModal(null);
    showToast("Import cancelled", "error");
  };

  // Undo a specific import — delete all trips and expenses tied to that log
  const undoImport = (logId) => {
    const log = importLogs.find((l) => l.id === logId);
    if (!log) return;
    setConfirmModal({
      title: "Delete this import?",
      message: `This will remove all ${log.summary.tripCount} trips and ${log.summary.expenseCount} expenses from this import.`,
      details: `File: ${log.fileName}\nPeriod: ${log.monthYear}`,
      warning: "This cannot be undone.",
      onConfirm: () => {
        setTrips(trips.filter((t) => !log.tripIds.includes(t.id)));
        setExpenses(expenses.filter((e) => !log.expenseIds.includes(e.id)));
        if (log.kasIds?.length) setKas(kas.filter((k) => !log.kasIds.includes(k.id)));
        setImportLogs(importLogs.filter((l) => l.id !== logId));
        logActivity("undo", "import", `Undone import: ${log.fileName}`);
        showToast(`Removed import: ${log.fileName}`);
        setConfirmModal(null);
      },
    });
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const logActivity = (action, type, description) => {
    setActivityLog((prev) => [{ id: genId(), at: new Date().toISOString(), action, type, description }, ...prev]);
  };

  const resetAll = () => {
    setTrips([]); setExpenses([]); setKas([]); setCapital([]); setLoans([]);
    setAssets([]); setLoanPayments([]); setImportLogs([]); setPettyTopups([]);
    setActivityLog([]);
  };

  const guardedDelete = (message, onConfirm) => {
    setDeleteGuard({ message, onConfirm });
    setDeleteGuardCode("");
    setDeleteGuardErr(false);
  };

  // ── Aggregates ──────────────────────────────────────────────────────────────
  const totalRevenue = trips.reduce((s, t) => s + t.jual, 0);
  const totalExpenses = expenses.filter((e) => e.expenseType !== "driver").reduce((s, e) => s + e.amount, 0);
  const truckOpsExpenses = expenses.filter((e) => (e.expenseType || "truck") === "truck").reduce((s, e) => s + e.amount, 0);
  const overheadExpenses = expenses.filter((e) => e.expenseType === "overhead").reduce((s, e) => s + e.amount, 0);
  const tripCosts = trips.reduce((s, t) => s + t.total, 0);
  const grossProfit = trips.reduce((s, t) => s + t.profit, 0);
  const netProfit = grossProfit - totalExpenses;
  const kasBalance = kas.reduce((s, k) => s + (k.type === "in" ? k.amount : -k.amount), 0);

  // Financing aggregates
  const totalCapitalInjected = capital.filter((c) => c.type === "capital").reduce((s, c) => s + c.amount, 0);
  const totalLoansReceived = capital.filter((c) => c.type === "loan").reduce((s, c) => s + c.amount, 0);
  const totalLoanPrincipalRemaining = loans.reduce((s, l) => {
    const paid = loanPayments.filter((p) => p.loanId === l.id).reduce((sum, p) => sum + p.amount, 0);
    return s + Math.max(0, l.principal - paid);
  }, 0);
  const totalLoanPaymentsMade = loanPayments.reduce((s, p) => s + p.amount, 0);
  const totalAssetsValue = assets.reduce((s, a) => s + (a.purchasePrice || 0), 0);

  const trucks = [...new Set([...trips.map((t) => t.nopol), ...expenses.map((e) => e.truck)])].filter(Boolean);

  if (appLoading) return (
    <div style={{ minHeight: "100vh", background: "#0c1420", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
      <img src="/logo-light.png" alt="Kin Kin Trukindo" style={{ height: 80, width: "auto", objectFit: "contain", opacity: 0.85 }} />
      <div style={{ width: 40, height: 40, border: "3px solid rgba(255,255,255,0.08)", borderTopColor: "#c8a86b", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#0c1420", minHeight: "100vh", color: "#e2e8f0", width: "100%", overflowX: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0c1420; color: #e2e8f0; overflow-x: hidden; width: 100%; }
        #root { width: 100%; }
        body, input, select, textarea, button, table { font-family: 'Inter', system-ui, sans-serif; }
        h1, h2, h3, h4 { font-family: 'Montserrat', sans-serif; font-weight: 700; }
        td, th { font-variant-numeric: tabular-nums; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0c1420; } ::-webkit-scrollbar-thumb { background: #c8a86b; }
        input, select, textarea { background: #0f1c2a !important; color: #e2e8f0 !important; border-color: rgba(255,255,255,0.12) !important; padding: 8px 12px; border-radius: 4px; font-family: inherit; font-size: 13px; width: 100%; outline: none; }
        input::placeholder { color: rgba(255,255,255,0.25) !important; }
        input:focus, select:focus { border-color: #c8a86b !important; }
        button { cursor: pointer; font-family: inherit; }
        .tag { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 500; }
      `}</style>

      {/* Hidden file input for global import */}
      <input ref={globalFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={handleGlobalImport} />

      {/* Header */}
      <div style={{ background: "#0d1e30", borderBottom: "2px solid #c8a86b", padding: isMobile ? "0 12px" : "0 24px", display: "flex", alignItems: "center", gap: isMobile ? 8 : 16, height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/logo-light.png" alt="KinKin Logo" style={{ height: 40, width: 40, objectFit: "contain" }} />
          {isMobile ? (
            <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 14, color: "#e2e8f0", fontWeight: 800, letterSpacing: 0.5 }}>Kin Kin Trukindo</div>
          ) : (
            <div style={{ fontFamily: "'Montserrat', sans-serif", color: "#e2e8f0", letterSpacing: 0.5, lineHeight: 1.1, fontWeight: 800, whiteSpace: "nowrap" }}>
              <div style={{ fontSize: 14 }}>Kin Kin Trukindo, Ltd.</div>
              <div style={{ fontSize: 9, color: "#c8a86b", letterSpacing: 1.5, fontFamily: "'Inter', sans-serif", fontWeight: 500, marginTop: 2 }}>FREIGHT & LOGISTICS</div>
            </div>
          )}
          {/* Save status indicator */}
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase",
            padding: "2px 8px", borderRadius: 20, marginLeft: 6,
            background: saveStatus === "saved" ? "rgba(52,211,153,0.15)" : saveStatus === "saving" ? "rgba(200,168,107,0.15)" : "rgba(248,113,113,0.15)",
            color: saveStatus === "saved" ? "#34d399" : saveStatus === "saving" ? "#c8a86b" : "#f87171",
            border: `1px solid ${saveStatus === "saved" ? "rgba(52,211,153,0.3)" : saveStatus === "saving" ? "rgba(200,168,107,0.3)" : "rgba(248,113,113,0.3)"}`,
          }}>
            {saveStatus === "saved" ? "Saved" : saveStatus === "saving" ? "Saving..." : "Save failed"}
          </div>
        </div>
        {!isMobile && (
          <>
            <div style={{ flex: 1 }} />
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                background: tab === t.key ? "rgba(200,168,107,0.12)" : "transparent",
                color: tab === t.key ? "#e2e8f0" : "rgba(255,255,255,0.45)",
                border: "none",
                borderBottom: tab === t.key ? "2px solid #c8a86b" : "2px solid transparent",
                padding: "6px 14px", fontSize: 12, fontWeight: tab === t.key ? 600 : 500,
                transition: "all .15s", height: 56, borderRadius: 0,
              }}>
                {t.label}
              </button>
            ))}
          </>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setConfirmModal({
            title: "Reset all data?",
            message: "This will permanently delete all trips, expenses, cash entries, loans, assets, capital, and import history from this device.",
            warning: "This cannot be undone.",
            onConfirm: async () => { await supabase.from("kinkin_state").delete().eq("key", STORE_KEY); window.location.reload(); },
          })}
          style={{ display: "none" }}
          title="Clear all data"
        >
          Reset
        </button>
      </div>

      {/* Mobile bottom navigation */}
      {isMobile && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#0d1e30", borderTop: "1px solid rgba(200,168,107,0.4)", display: "flex", zIndex: 500, paddingBottom: "env(safe-area-inset-bottom)" }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "8px 2px 10px", background: "transparent", border: "none", borderTop: tab === t.key ? "2px solid #c8a86b" : "2px solid transparent", color: tab === t.key ? "#c8a86b" : "rgba(255,255,255,0.3)", fontFamily: "inherit" }}>
              <span style={{ fontSize: 9, marginTop: 3, letterSpacing: 0.3, fontWeight: tab === t.key ? 600 : 400 }}>{t.short}</span>
            </button>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 70, right: 24, background: toast.type === "success" ? "#162030" : "#162030", border: `1px solid ${toast.type === "success" ? "#34d399" : "#f87171"}`, color: toast.type === "success" ? "#34d399" : "#f87171", padding: "10px 18px", borderRadius: 6, zIndex: 999, fontSize: 13, boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
          {toast.msg}
        </div>
      )}

      {/* Upload Modal — 2-step flow: pick month/year → preview → confirm */}
      {uploadModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#162030", border: "1px solid #A39159", borderRadius: 10, padding: 24, maxWidth: 700, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 20 }}>
              <div>
                <h3 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 20, color: "#e2e8f0", letterSpacing: 0.3, fontWeight: 700 }}>
                  {uploadModal.previewReady ? "Preview Import" : "Import Monthly Report"}
                </h3>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>
                  File: <span style={{ color: "#c8a86b" }}>{uploadModal.fileName}</span>
                </div>
              </div>
              <button onClick={cancelGlobalImport} style={{ background: "transparent", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)", padding: "6px 12px", borderRadius: 4, fontSize: 12, cursor: "pointer" }}>
                Cancel
              </button>
            </div>

            {!uploadModal.previewReady ? (
              <>
                {/* Step 1: Confirm month/year */}
                <div style={{ background: "#0c1420", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: 20, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "#e2e8f0", marginBottom: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Which month is this report for?</div>
                  <input
                    type="month"
                    value={uploadModal.monthYear}
                    onChange={(e) => setUploadModal({ ...uploadModal, monthYear: e.target.value })}
                    style={{ fontSize: 15, padding: "10px 14px" }}
                  />
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 10, lineHeight: 1.6 }}>
                    The system will use this period to:<br />
                    • Fill in dates for entries that don&apos;t have one<br />
                    • Date the additional expenses (PENGELUARAN TAMBAHAN)<br />
                    • Label this import in the log
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <button onClick={cancelGlobalImport} style={{ background: "transparent", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)", padding: "10px 20px", borderRadius: 4, fontSize: 12, cursor: "pointer" }}>
                    Cancel
                  </button>
                  <button onClick={proceedWithUpload} disabled={importing} style={{ background: "#c8a86b", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 4, fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: importing ? 0.5 : 1 }}>
                    {importing ? "Parsing..." : "Parse & Preview"}
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Step 2: Preview parsed data */}
                <div style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 6, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "#34d399", fontWeight: 600, marginBottom: 8 }}>PARSED SUCCESSFULLY</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>PERIOD</div>
                      <div style={{ fontSize: 14, color: "#c8a86b", fontWeight: 600 }}>{uploadModal.monthYear}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>FILE</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }} title={uploadModal.fileName}>{uploadModal.fileName.length > 24 ? uploadModal.fileName.slice(0, 22) + "…" : uploadModal.fileName}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>TRIPS FOUND</div>
                      <div style={{ fontSize: 14, color: "#34d399", fontWeight: 600 }}>{uploadModal.parsed.trips.length}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>TOTAL INVOICED</div>
                      <div style={{ fontSize: 14, color: "#34d399", fontWeight: 600 }}>{fmt(uploadModal.parsed.trips.reduce((s, t) => s + (Number(t.jual) || 0), 0))}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>EXPENSES FOUND</div>
                      <div style={{ fontSize: 14, color: "#f59e0b", fontWeight: 600 }}>{uploadModal.parsed.expenses.length}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>TOTAL EXPENSES</div>
                      <div style={{ fontSize: 14, color: "#f59e0b", fontWeight: 600 }}>{fmt(uploadModal.parsed.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0))}</div>
                    </div>
                  </div>
                </div>

                {/* Trips preview — editable (functional state updates to avoid stale closure) */}
                {uploadModal.parsed.trips.length > 0 && (() => {
                  const newCount = uploadModal.parsed.trips.filter(t => !t._isDuplicate).length;
                  const skipCount = uploadModal.parsed.trips.length - newCount;
                  return (
                  <details open style={{ marginBottom: 14 }}>
                    <summary style={{ cursor: "pointer", color: "#34d399", fontSize: 12, fontWeight: 600, padding: "8px 0" }}>
                      Trips ({uploadModal.parsed.trips.length}) —{" "}
                      <span style={{ color: "#34d399" }}>{newCount} new</span>
                      {skipCount > 0 && <span style={{ color: "rgba(255,255,255,0.25)" }}>, {skipCount} already imported (will skip)</span>}
                      <span style={{ color: "#c8a86b", fontWeight: 400 }}> — all fields editable below</span>
                    </summary>
                    <div style={{ background: "#0c1420", borderRadius: 4, maxHeight: 300, overflowY: "auto", marginTop: 6 }}>
                      <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ color: "rgba(255,255,255,0.7)", background: "#1e2d3e", position: "sticky", top: 0 }}>
                            <th style={{ textAlign: "left", padding: "6px 8px" }}>DATE</th>
                            <th style={{ textAlign: "left", padding: "6px 8px" }}>INV NO</th>
                            <th style={{ textAlign: "left", padding: "6px 8px" }}>DESTINATION</th>
                            <th style={{ textAlign: "left", padding: "6px 8px" }}>PLATE</th>
                            <th style={{ textAlign: "left", padding: "6px 8px" }}>CONTAINER</th>
                            <th style={{ textAlign: "right", padding: "6px 8px" }}>INVOICED</th>
                            <th style={{ textAlign: "right", padding: "6px 8px" }}>PROFIT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {uploadModal.parsed.trips.map((t, i) => {
                            const iStyle = { padding: "4px 6px", background: "#1e2d3e", border: "1px solid rgba(255,255,255,0.08)", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", width: "100%", borderRadius: 3, outline: "none" };
                            const updateTrip = (field, val) => {
                              setUploadModal((prev) => {
                                const updated = prev.parsed.trips.map((trip, idx) => {
                                  if (idx !== i) return trip;
                                  const t2 = { ...trip, [field]: val };
                                  const jual = field === "jual" ? Number(val) : Number(t2.jual) || 0;
                                  const total = (Number(t2.sangu) || 0) + (Number(t2.lainAmt) || 0);
                                  return { ...t2, jual, total, profit: jual - total };
                                });
                                return { ...prev, parsed: { ...prev.parsed, trips: updated } };
                              });
                            };
                            const rowStyle = t._isDuplicate ? { borderBottom: "1px solid rgba(255,255,255,0.08)", opacity: 0.4, background: "#1e2d3e" } : { borderBottom: "1px solid rgba(255,255,255,0.08)" };
                            return (
                              <tr key={i} style={rowStyle}>
                                <td style={{ padding: "4px 4px" }}><input type="date" value={t.date || ""} onChange={(e) => updateTrip("date", e.target.value)} style={iStyle} disabled={t._isDuplicate} /></td>
                                <td style={{ padding: "4px 4px" }}><input value={t.invNo || ""} placeholder="Inv #" onChange={(e) => updateTrip("invNo", e.target.value)} style={iStyle} disabled={t._isDuplicate} /></td>
                                <td style={{ padding: "4px 4px" }}><input value={t.destination || ""} onChange={(e) => updateTrip("destination", e.target.value)} style={iStyle} disabled={t._isDuplicate} /></td>
                                <td style={{ padding: "4px 4px" }}><input value={t.nopol || ""} onChange={(e) => updateTrip("nopol", e.target.value)} style={{ ...iStyle, color: "#c8a86b" }} disabled={t._isDuplicate} /></td>
                                <td style={{ padding: "4px 4px" }}><input value={t.contNo || ""} onChange={(e) => updateTrip("contNo", e.target.value)} style={{ ...iStyle, color: "rgba(255,255,255,0.45)" }} disabled={t._isDuplicate} /></td>
                                <td style={{ padding: "4px 4px" }}><input type="number" value={t.jual ?? ""} onChange={(e) => updateTrip("jual", e.target.value)} style={{ ...iStyle, textAlign: "right" }} disabled={t._isDuplicate} /></td>
                                <td style={{ padding: "4px 8px", textAlign: "right", color: (t.profit || 0) >= 0 ? "#34d399" : "#f87171", whiteSpace: "nowrap" }}>
                                  {t._isDuplicate ? <span style={{ color: "#bbb", fontSize: 10 }}>skip</span> : fmt(t.profit || 0)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                  );
                })()}

                {/* Expenses preview — editable */}
                {uploadModal.parsed.expenses.length > 0 && (() => {
                  const newCount = uploadModal.parsed.expenses.filter(e => !e._isDuplicate).length;
                  const skipCount = uploadModal.parsed.expenses.length - newCount;
                  return (
                  <details style={{ marginBottom: 14 }}>
                    <summary style={{ cursor: "pointer", color: "#f59e0b", fontSize: 12, fontWeight: 600, padding: "8px 0" }}>
                      Additional Expenses ({uploadModal.parsed.expenses.length}) —{" "}
                      <span style={{ color: "#34d399" }}>{newCount} new</span>
                      {skipCount > 0 && <span style={{ color: "rgba(255,255,255,0.25)" }}>, {skipCount} already imported (will skip)</span>}
                    </summary>
                    <div style={{ background: "#0c1420", borderRadius: 4, maxHeight: 260, overflowY: "auto", marginTop: 6 }}>
                      <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ color: "rgba(255,255,255,0.7)", background: "#1e2d3e", position: "sticky", top: 0 }}>
                            <th style={{ textAlign: "left", padding: "6px 8px" }}>DESCRIPTION</th>
                            <th style={{ textAlign: "left", padding: "6px 8px" }}>CATEGORY</th>
                            <th style={{ textAlign: "right", padding: "6px 8px" }}>AMOUNT</th>
                            <th style={{ textAlign: "center", padding: "6px 8px" }}>PETTY CASH?</th>
                            <th style={{ padding: "6px 8px" }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {uploadModal.parsed.expenses.map((e, i) => {
                            const iStyle = { padding: "4px 6px", background: "#1e2d3e", border: "1px solid rgba(255,255,255,0.08)", color: "#e2e8f0", fontSize: 11, fontFamily: "inherit", width: "100%", borderRadius: 3, outline: "none" };
                            const updateExp = (field, val) => {
                              setUploadModal((prev) => {
                                const updated = prev.parsed.expenses.map((exp, idx) => idx === i ? { ...exp, [field]: val } : exp);
                                return { ...prev, parsed: { ...prev.parsed, expenses: updated } };
                              });
                            };
                            const removeExp = () => {
                              setUploadModal((prev) => ({
                                ...prev,
                                parsed: { ...prev.parsed, expenses: prev.parsed.expenses.filter((_, idx) => idx !== i) }
                              }));
                            };
                            if (e._isDuplicate) {
                              return (
                                <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", opacity: 0.35, background: "#1e2d3e" }}>
                                  <td style={{ padding: "4px 8px", color: "rgba(255,255,255,0.25)", fontSize: 11 }}>{e.description}</td>
                                  <td style={{ padding: "4px 8px", color: "#bbb", fontSize: 11 }}>{e.category}</td>
                                  <td style={{ padding: "4px 8px", textAlign: "right", color: "#bbb", fontSize: 11 }}>{fmt(e.amount)}</td>
                                  <td colSpan={2} style={{ padding: "4px 8px", textAlign: "center", color: "#bbb", fontSize: 10 }}>already imported — skip</td>
                                </tr>
                              );
                            }
                            return (
                              <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                                <td style={{ padding: "4px 4px" }}><input value={e.description} onChange={(ev) => updateExp("description", ev.target.value)} style={iStyle} /></td>
                                <td style={{ padding: "4px 4px" }}>
                                  <select value={e.category} onChange={(ev) => updateExp("category", ev.target.value)} style={{ ...iStyle, cursor: "pointer" }}>
                                    {["Fuel","Toll","Repair","Spare Parts","Garage","Salary","Office Rent","Utilities","Admin","Insurance","Marketing","Other"].map((c) => <option key={c}>{c}</option>)}
                                  </select>
                                </td>
                                <td style={{ padding: "4px 4px" }}><input type="number" value={e.amount} onChange={(ev) => updateExp("amount", Number(ev.target.value))} style={{ ...iStyle, textAlign: "right", color: "#f87171" }} /></td>
                                <td style={{ padding: "4px 4px", textAlign: "center" }}>
                                  <input type="checkbox" checked={e.usePettyCash !== false} onChange={(ev) => updateExp("usePettyCash", ev.target.checked)} style={{ width: "auto", cursor: "pointer", accentColor: "#c8a86b" }} />
                                </td>
                                <td style={{ padding: "4px 4px", textAlign: "center" }}><button onClick={removeExp} style={{ background: "transparent", border: "1px solid #c0392b44", color: "#f87171", fontSize: 11, padding: "2px 6px", borderRadius: 3, cursor: "pointer" }}>✕</button></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                  );
                })()}

                <div style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, padding: 12, fontSize: 11, color: "#e2e8f0", marginBottom: 14 }}>
                  This import will be saved as a log entry. You can delete the whole batch later if uploaded wrongly — from Settings → Import History.
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <button onClick={() => setUploadModal({ ...uploadModal, previewReady: false, parsed: null })} style={{ background: "transparent", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)", padding: "10px 20px", borderRadius: 4, fontSize: 12, cursor: "pointer" }}>
                    Back
                  </button>
                  <button onClick={cancelGlobalImport} style={{ background: "transparent", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)", padding: "10px 20px", borderRadius: 4, fontSize: 12, cursor: "pointer" }}>
                    Cancel
                  </button>
                  <button onClick={confirmGlobalImport} style={{ background: "#34d399", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 4, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                    Confirm Import ({uploadModal.parsed.trips.length + uploadModal.parsed.expenses.length} entries)
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal — replaces window.confirm */}
      {confirmModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.75)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#162030", border: "1px solid rgba(248,113,113,0.4)", borderRadius: 10, padding: 24, maxWidth: 480, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
            <h3 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 18, color: "#f87171", fontWeight: 700, marginBottom: 12 }}>
              {confirmModal.title}
            </h3>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 14, lineHeight: 1.5 }}>
              {confirmModal.message}
            </p>
            {confirmModal.details && (
              <div style={{ background: "#0c1420", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, padding: 12, marginBottom: 14, fontSize: 12, color: "rgba(255,255,255,0.45)", whiteSpace: "pre-line", fontFamily: "monospace" }}>
                {confirmModal.details}
              </div>
            )}
            {confirmModal.warning && (
              <div style={{ color: "#f87171", fontSize: 12, fontWeight: 600, marginBottom: 16 }}>
                {confirmModal.warning}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmModal(null)} style={{ background: "transparent", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)", padding: "10px 20px", borderRadius: 4, fontSize: 12, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={confirmModal.onConfirm} style={{ background: "#f87171", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 4, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      

      {deleteGuard && (
        <div style={{ position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.8)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center",padding:20 }}>
          <div style={{ background:"#162030",border:"1px solid rgba(248,113,113,0.4)",borderRadius:10,padding:24,maxWidth:400,width:"100%",boxShadow:"0 8px 32px rgba(0,0,0,0.25)" }}>
            <h3 style={{ fontFamily:"'Montserrat',sans-serif",fontSize:16,color:"#f87171",fontWeight:700,marginBottom:10 }}>⚠ Confirm Deletion</h3>
            <p style={{ fontSize:13,color:"rgba(255,255,255,0.45)",marginBottom:16,lineHeight:1.5 }}>{deleteGuard.message}</p>
            <p style={{ fontSize:12,color:"rgba(255,255,255,0.25)",marginBottom:8 }}>Enter admin code to proceed:</p>
            <input
              type="password" value={deleteGuardCode} autoFocus
              onChange={(e) => { setDeleteGuardCode(e.target.value); setDeleteGuardErr(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") {
                if (deleteGuardCode === appPassword) { deleteGuard.onConfirm(); setDeleteGuard(null); }
                else setDeleteGuardErr(true);
              }}}
              style={{ width:"100%",padding:"8px 10px",border:`1px solid ${deleteGuardErr?"#f87171":"rgba(255,255,255,0.08)"}`,borderRadius:4,fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:deleteGuardErr?4:14 }}
              placeholder="Admin code"
            />
            {deleteGuardErr && <p style={{ color:"#f87171",fontSize:11,marginBottom:10 }}>Incorrect code. Try again.</p>}
            <div style={{ display:"flex",gap:10,justifyContent:"flex-end" }}>
              <button onClick={() => setDeleteGuard(null)} style={{ background:"transparent",color:"rgba(255,255,255,0.45)",border:"1px solid rgba(255,255,255,0.08)",padding:"9px 18px",borderRadius:4,fontSize:12,cursor:"pointer" }}>Cancel</button>
              <button onClick={() => {
                if (deleteGuardCode === appPassword) { deleteGuard.onConfirm(); setDeleteGuard(null); }
                else setDeleteGuardErr(true);
              }} style={{ background:"#f87171",color:"#fff",border:"none",padding:"9px 20px",borderRadius:4,fontWeight:700,fontSize:13,cursor:"pointer" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: isMobile ? "16px 12px" : 24, paddingBottom: isMobile ? "calc(80px + env(safe-area-inset-bottom))" : 24 }}>
        {tab === "dashboard" && <Dashboard trips={trips} expenses={expenses} kas={kas} trucks={trucks} totalRevenue={totalRevenue} totalExpenses={totalExpenses} truckOpsExpenses={truckOpsExpenses} overheadExpenses={overheadExpenses} tripCosts={tripCosts} grossProfit={grossProfit} netProfit={netProfit} kasBalance={kasBalance} totalCapitalInjected={totalCapitalInjected} totalLoanPrincipalRemaining={totalLoanPrincipalRemaining} totalAssetsValue={totalAssetsValue} loans={loans} loanPayments={loanPayments} globalFileRef={globalFileRef} importing={importing} />}
        {tab === "trips" && <Trips trips={trips} setTrips={setTrips} showToast={showToast} guardedDelete={guardedDelete} logActivity={logActivity} />}
        {tab === "expenses" && <Expenses expenses={expenses} setExpenses={setExpenses} trucks={trucks} pettyHolders={pettyHolders} setPettyTopups={setPettyTopups} pettyTopups={pettyTopups} setKas={setKas} kas={kas} showToast={showToast} guardedDelete={guardedDelete} logActivity={logActivity} />}
        {tab === "kas" && <Kas kas={kas} setKas={setKas} showToast={showToast} kasBalance={kasBalance} guardedDelete={guardedDelete} logActivity={logActivity} />}
        {tab === "petty" && <PettyCash pettyHolders={pettyHolders} setPettyHolders={setPettyHolders} pettyTopups={pettyTopups} setPettyTopups={setPettyTopups} expenses={expenses} setExpenses={setExpenses} kas={kas} setKas={setKas} showToast={showToast} confirmModal={confirmModal} setConfirmModal={setConfirmModal} guardedDelete={guardedDelete} logActivity={logActivity} />}
        {tab === "fleet" && <Fleet loans={loans} setLoans={setLoans} assets={assets} setAssets={setAssets} loanPayments={loanPayments} setLoanPayments={setLoanPayments} capital={capital} setCapital={setCapital} totalCapitalInjected={totalCapitalInjected} kas={kas} setKas={setKas} showToast={showToast} confirmModal={confirmModal} setConfirmModal={setConfirmModal} guardedDelete={guardedDelete} logActivity={logActivity} />}
        {tab === "reports" && <Reports trips={trips} expenses={expenses} kas={kas} capital={capital} loans={loans} assets={assets} loanPayments={loanPayments} grossProfit={grossProfit} netProfit={netProfit} totalRevenue={totalRevenue} totalExpenses={totalExpenses} truckOpsExpenses={truckOpsExpenses} overheadExpenses={overheadExpenses} tripCosts={tripCosts} totalCapitalInjected={totalCapitalInjected} totalLoanPrincipalRemaining={totalLoanPrincipalRemaining} totalLoanPaymentsMade={totalLoanPaymentsMade} totalAssetsValue={totalAssetsValue} />}
        {tab === "settings" && <Settings appPassword={appPassword} setAppPassword={setAppPassword} activityLog={activityLog} kas={kas} expenses={expenses} trips={trips} pettyHolders={pettyHolders} pettyTopups={pettyTopups} loans={loans} loanPayments={loanPayments} kasBalance={kasBalance} showToast={showToast} importLogs={importLogs} undoImport={undoImport} resetAll={resetAll} />}
      </div>

      {/* ── GLOBAL FAB ── */}
      {!uploadModal && (
        <div style={{ position:"fixed", bottom:isMobile?80:24, right:20, zIndex:900, display:"flex", flexDirection:"column-reverse", alignItems:"flex-end", gap:10 }}>
          {fabOpen && !fabMode && (
            <div style={{ background:"#162030", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:8, boxShadow:"0 8px 24px rgba(0,0,0,0.4)", marginBottom:6 }}>
              {[
                { key:"cash-in",  label:"Cash In",   color:"#34d399" },
                { key:"cash-out", label:"Cash Out",  color:"#f87171" },
                { key:"expense",  label:"Expense",   color:"#c8a86b" },
                { key:"trip",     label:"New Trip",  color:"#60a5fa" },
              ].map(a => (
                <div key={a.key} onClick={() => { setFabMode(a.key); setFabForm({ date: today(), amount: "", description: "", truck: localStorage.getItem("kkLastPlate")||"", type: a.key==="cash-in"?"in":"out" }); }}
                  style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 14px", borderRadius:6, cursor:"pointer", fontSize:12, fontWeight:600, color:"#e2e8f0" }}
                  onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                  onMouseLeave={e => e.currentTarget.style.background="transparent"}
                >
                  <div style={{ width:8, height:8, borderRadius:"50%", background:a.color, flexShrink:0 }}></div>
                  {a.label}
                </div>
              ))}
            </div>
          )}
          {fabOpen && fabMode && (
            <div style={{ background:"#162030", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:16, boxShadow:"0 8px 24px rgba(0,0,0,0.4)", width:300, marginBottom:6 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <span style={{ fontFamily:"'Montserrat',sans-serif", fontSize:13, fontWeight:700, color:"#e2e8f0" }}>
                  {fabMode==="cash-in"?"Cash In":fabMode==="cash-out"?"Cash Out":fabMode==="expense"?"Expense":"New Trip"}
                </span>
                <button onClick={() => setFabMode(null)} style={{ background:"transparent", border:"none", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:16 }}>×</button>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <input type="date" value={fabForm.date||today()} onChange={e=>setFabForm({...fabForm,date:e.target.value})}
                  style={{ width:"100%", padding:"7px 9px", background:"#0f1c2a", border:"1px solid rgba(255,255,255,0.12)", borderRadius:5, fontSize:12, color:"#e2e8f0", fontFamily:"inherit" }} />
                {(fabMode==="expense"||fabMode==="trip") && (
                  <input placeholder={fabMode==="trip"?"Destination":"Description"} value={fabForm.description||""} onChange={e=>setFabForm({...fabForm,description:e.target.value})}
                    style={{ width:"100%", padding:"7px 9px", background:"#0f1c2a", border:"1px solid rgba(255,255,255,0.12)", borderRadius:5, fontSize:12, color:"#e2e8f0", fontFamily:"inherit" }} />
                )}
                {(fabMode==="cash-in"||fabMode==="cash-out") && (
                  <input placeholder="Description" value={fabForm.description||""} onChange={e=>setFabForm({...fabForm,description:e.target.value})}
                    style={{ width:"100%", padding:"7px 9px", background:"#0f1c2a", border:"1px solid rgba(255,255,255,0.12)", borderRadius:5, fontSize:12, color:"#e2e8f0", fontFamily:"inherit" }} />
                )}
                <input type="number" placeholder="Amount (Rp)" value={fabForm.amount||""} onChange={e=>setFabForm({...fabForm,amount:e.target.value})}
                  style={{ width:"100%", padding:"7px 9px", background:"#0f1c2a", border:"1px solid rgba(255,255,255,0.12)", borderRadius:5, fontSize:12, color:"#e2e8f0", fontFamily:"inherit" }} />
                <button
                  onClick={() => {
                    if (!fabForm.amount) return;
                    const amt = Number(fabForm.amount);
                    if (fabMode==="cash-in"||fabMode==="cash-out") {
                      setKas([...kas, { id:genId(), date:fabForm.date, description:fabForm.description||"(no description)", amount:amt, type:fabMode==="cash-in"?"in":"out" }]);
                      logActivity("add","cash",fabForm.description||fabMode);
                      showToast(`${fabMode==="cash-in"?"Cash in":"Cash out"} recorded!`);
                    } else if (fabMode==="expense") {
                      const entry = { id:genId(), date:fabForm.date, category:"Other", description:fabForm.description||"Expense", amount:amt, expenseType:"truck", truck:fabForm.truck||"", source:"manual" };
                      setExpenses([...expenses, entry]);
                      const label = `Truck expense — ${fabForm.truck||""}: ${fabForm.description||"Expense"}`;
                      setKas([...kas, { id:genId(), date:fabForm.date, description:label, amount:amt, type:"out" }]);
                      logActivity("add","expense",fabForm.description||"Expense");
                      showToast("Expense recorded!");
                    } else if (fabMode==="trip") {
                      const trip = { id:genId(), date:fabForm.date, invNo:"", destination:fabForm.description||"", nopol:fabForm.truck||"", contNo:"", sangu:0, lainItems:[], lainLabel:"", lainAmt:0, total:0, jual:amt, profit:amt, source:"manual" };
                      setTrips([...trips, trip]);
                      logActivity("add","trip",fabForm.description||"Trip");
                      showToast("Trip added! Edit it in Trips tab.");
                    }
                    setFabMode(null); setFabOpen(false); setFabForm({});
                  }}
                  style={{ background:"#c8a86b", border:"none", color:"#fff", padding:"8px", borderRadius:5, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}
                >
                  Save
                </button>
              </div>
            </div>
          )}
          <div onClick={() => { setFabOpen(!fabOpen); if(fabOpen){setFabMode(null);} }}
            style={{ width:48, height:48, background:"#c8a86b", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", boxShadow:"0 4px 16px rgba(200,168,107,0.45)", fontSize:24, fontWeight:300, color:"#fff", userSelect:"none", transition:"transform .15s", transform: fabOpen?"rotate(45deg)":"rotate(0deg)" }}
          >+</div>
        </div>
      )}
    </div>
  );
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function Dashboard({ trips, expenses, trucks, totalRevenue, grossProfit, netProfit, kasBalance, tripCosts, totalExpenses, truckOpsExpenses, overheadExpenses, totalCapitalInjected, totalLoanPrincipalRemaining, totalAssetsValue, loans, loanPayments, globalFileRef, importing, kas }) {
  const isMobile = useIsMobile();
  const [kpiPopup, setKpiPopup] = useState(null);
  const truckStats = trucks.map((t) => {
    const tTrips = trips.filter((x) => x.nopol === t);
    const tExp = expenses.filter((x) => x.truck === t);
    return {
      nopol: t,
      trips: tTrips.length,
      revenue: tTrips.reduce((s, x) => s + x.jual, 0),
      profit: tTrips.reduce((s, x) => s + x.profit, 0) - tExp.reduce((s, x) => s + x.amount, 0),
    };
  });

  const expByCategory = {};
  for (const e of expenses) {
    expByCategory[e.category] = (expByCategory[e.category] || 0) + e.amount;
  }

  return (
    <div>
      {/* Transparent backdrop to close KPI popup on outside click */}
      {kpiPopup && <div onClick={() => setKpiPopup(null)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 199 }} />}


      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 20, color: "#e2e8f0", letterSpacing: 0.3, fontWeight: 700 }}>DASHBOARD OVERVIEW</h2>
        <button
          onClick={() => globalFileRef.current.click()}
          style={{ background: "#c8a86b", color: "#fff", border: "none", padding: "10px 22px", borderRadius: 6, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 2px 8px rgba(200,168,107,0.25)", cursor: "pointer" }}
          title="Upload your employee's monthly Excel report"
        >
          {importing ? "Importing..." : "Import Excel Sheet"}
        </button>
      </div>

      {/* Welcome empty-state */}
      {trips.length === 0 && expenses.length === 0 && (
        <div style={{ background: "linear-gradient(135deg, #A3915915, #F0F0EE)", border: "1px solid rgba(200,168,107,0.3)", borderRadius: 10, padding: 28, marginBottom: 24, textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 10, color: "#c8a86b", fontFamily: "'Montserrat', sans-serif", fontWeight: 800 }}>KK</div>
          <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 18, color: "#c8a86b", fontWeight: 700, marginBottom: 8 }}>Welcome — Let's get started</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 18, maxWidth: 520, margin: "0 auto 18px" }}>
            Upload your employee&apos;s monthly Excel report to instantly populate trips, or add entries manually from the tabs above.
          </div>
          <button
            onClick={() => globalFileRef.current.click()}
            style={{ background: "#c8a86b", color: "#fff", border: "none", padding: "12px 32px", borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            {importing ? "Importing..." : "Upload Excel Sheet"}
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 28 }}>
        {[
          {
            label: "Total Revenue (Invoiced)", value: fmt(totalRevenue), color: "#60a5fa", icon: "▲",
            breakdown: trips.length === 0 ? [["No trips yet", ""]] : [
              ...trips.slice().sort((a,b) => b.jual - a.jual).map((t) => [`${t.date} · ${t.destination}`, fmt(t.jual)]),
              ["─────────", ""],
              ["TOTAL", fmt(totalRevenue)],
            ],
          },
          {
            label: "Trip Gross Profit", value: fmt(grossProfit), color: "#34d399", icon: "◈",
            breakdown: trips.length === 0 ? [["No trips yet", ""]] : [
              ...trips.slice().sort((a,b) => b.profit - a.profit).map((t) => [`${t.date} · ${t.destination}`, fmt(t.profit)]),
              ["─────────", ""],
              ["TOTAL PROFIT", fmt(grossProfit)],
            ],
          },
          {
            label: "Truck Ops Expenses", value: fmt(truckOpsExpenses), color: "#c8a86b", icon: "▼",
            breakdown: (() => {
              const byCat = {};
              expenses.filter((e) => (e.expenseType || "truck") === "truck").forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
              const rows = Object.entries(byCat).sort((a,b) => b[1]-a[1]).map(([cat, amt]) => [cat, fmt(amt)]);
              return rows.length === 0 ? [["No expenses yet", ""]] : [...rows, ["─────────", ""], ["TOTAL", fmt(truckOpsExpenses)]];
            })(),
          },
          {
            label: "Overhead Expenses", value: fmt(overheadExpenses), color: "rgba(255,255,255,0.45)", icon: "▼",
            breakdown: (() => {
              const byCat = {};
              expenses.filter((e) => e.expenseType === "overhead").forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
              const rows = Object.entries(byCat).sort((a,b) => b[1]-a[1]).map(([cat, amt]) => [cat, fmt(amt)]);
              return rows.length === 0 ? [["No overhead yet", ""]] : [...rows, ["─────────", ""], ["TOTAL", fmt(overheadExpenses)]];
            })(),
          },
          {
            label: "Net Profit", value: fmt(netProfit), color: netProfit >= 0 ? "#34d399" : "#f87171", icon: "◉",
            breakdown: [
              ["Revenue", fmt(totalRevenue)],
              ["− Trip costs (COGS)", fmt(-tripCosts)],
              ["= Gross Profit", fmt(grossProfit)],
              ["− Truck Ops Expenses", fmt(-truckOpsExpenses)],
              ["= Operating Profit", fmt(grossProfit - truckOpsExpenses)],
              ["− Overhead (SG&A)", fmt(-overheadExpenses)],
              ["─────────", ""],
              ["NET PROFIT", fmt(netProfit)],
            ],
          },
          {
            label: "Cash Balance", value: fmt(kasBalance), color: "#c8a86b", icon: "◈",
            breakdown: (() => {
              const totalIn = kas.filter((k) => k.type === "in").reduce((s, k) => s + k.amount, 0);
              const totalOut = kas.filter((k) => k.type === "out").reduce((s, k) => s + k.amount, 0);
              return [
                ["Total Cash In", fmt(totalIn)],
                ["Total Cash Out", fmt(-totalOut)],
                ["─────────", ""],
                ["BALANCE", fmt(kasBalance)],
              ];
            })(),
          },
        ].map((k) => (
          <div
            key={k.label}
            onClick={(e) => { e.stopPropagation(); setKpiPopup(kpiPopup === k.label ? null : k.label); }}
            style={{ background: "#162030", border: `1px solid ${kpiPopup === k.label ? k.color + "88" : "rgba(255,255,255,0.08)"}`, borderRadius: 8, padding: "18px 20px", cursor: "pointer", transition: "border-color .15s", position: "relative", borderTop: `2px solid ${k.color}` }}
            title="Click to see breakdown"
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
              <div style={{ fontSize: 20 }}>{k.icon}</div>
              <div style={{ fontSize: 10, color: kpiPopup === k.label ? k.color : "rgba(255,255,255,0.45)" }}>{kpiPopup === k.label ? "▲" : "▼"}</div>
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 4, marginTop: 6, textTransform: "uppercase", letterSpacing: 1 }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 500, color: k.color }}>{k.value}</div>

            {/* Breakdown popup */}
            {kpiPopup === k.label && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 200, background: "#0d1e30", border: `1px solid ${k.color}66`, borderRadius: 8, padding: "14px 16px", minWidth: 280, boxShadow: "0 8px 32px rgba(0,0,0,0.7)" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: k.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{k.icon} {k.label}</div>
                  <button onClick={(e) => { e.stopPropagation(); setKpiPopup(null); }} style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.45)", fontSize: 14, cursor: "pointer", lineHeight: 1 }}>✕</button>
                </div>
                {k.breakdown.map(([label, val], i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "4px 0",
                    borderBottom: label === "─────────" ? "1px solid rgba(255,255,255,0.08)" : "none",
                    color: (label.startsWith("TOTAL") || label.startsWith("NET") || label.startsWith("=") || label.startsWith("BALANCE")) ? k.color : "rgba(255,255,255,0.45)",
                    fontWeight: (label.startsWith("TOTAL") || label.startsWith("NET") || label.startsWith("=") || label.startsWith("BALANCE")) ? 700 : 400,
                    fontSize: (label.startsWith("TOTAL") || label.startsWith("NET") || label.startsWith("BALANCE")) ? 13 : 12,
                  }}>
                    {label !== "─────────" && <><span style={{ marginRight: 16 }}>{label}</span><span style={{ whiteSpace: "nowrap" }}>{val}</span></>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Truck Performance Table */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20 }}>
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20 }}>
          <h3 style={{ fontSize: 13, color: "#c8a86b", marginBottom: 14, letterSpacing: 1, textTransform: "uppercase" }}>Truck Performance</h3>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "rgba(255,255,255,0.45)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <th style={{ textAlign: "left", padding: "6px 0" }}>PLATE</th>
                <th style={{ textAlign: "right", padding: "6px 0" }}>TRIPS</th>
                <th style={{ textAlign: "right", padding: "6px 0" }}>REVENUE</th>
                <th style={{ textAlign: "right", padding: "6px 0" }}>NET PROFIT</th>
              </tr>
            </thead>
            <tbody>
              {truckStats.map((t) => (
                <tr key={t.nopol} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: "8px 0" }}><span style={{ background:"rgba(96,165,250,0.12)", color:"#60a5fa", padding:"2px 7px", borderRadius:3, fontFamily:"monospace", fontSize:11, fontWeight:700 }}>{t.nopol}</span></td>
                  <td style={{ textAlign: "right", padding: "8px 0" }}>{t.trips}</td>
                  <td style={{ textAlign: "right", padding: "8px 0" }}>{fmt(t.revenue)}</td>
                  <td style={{ textAlign: "right", padding: "8px 0", color: t.profit >= 0 ? "#34d399" : "#f87171" }}>{fmt(t.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20 }}>
          <h3 style={{ fontSize: 13, color: "#c8a86b", marginBottom: 14, letterSpacing: 1, textTransform: "uppercase" }}>Expense Breakdown</h3>
          {Object.entries(expByCategory).map(([cat, amt]) => {
            const pct = totalExpenses > 0 ? (amt / totalExpenses) * 100 : 0;
            return (
              <div key={cat} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: CAT_COLOR[cat] || "rgba(255,255,255,0.45)" }}>{cat}</span>
                  <span>{fmt(amt)}</span>
                </div>
                <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 2, height: 4 }}>
                  <div style={{ width: `${pct}%`, background: CAT_COLOR[cat] || "rgba(255,255,255,0.45)", height: 4, borderRadius: 2, transition: "width .5s" }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Financing Summary */}
      {(totalCapitalInjected > 0 || totalAssetsValue > 0) && (
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20, marginTop: 20 }}>
          <h3 style={{ fontSize: 13, color: "#c8a86b", marginBottom: 14, letterSpacing: 1, textTransform: "uppercase" }}>Capital & Fleet Position</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
            <div><div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>OWNER CAPITAL</div><div style={{ fontSize: 15, color: "#34d399" }}>{fmt(totalCapitalInjected)}</div></div>
            
            <div><div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>LOAN PRINCIPAL REMAINING</div><div style={{ fontSize: 15, color: "#f87171" }}>{fmt(totalLoanPrincipalRemaining)}</div></div>
            <div><div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>TOTAL ASSETS</div><div style={{ fontSize: 15, color: "#c8a86b" }}>{fmt(totalAssetsValue)}</div></div>
            <div><div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>ACTIVE LOANS</div><div style={{ fontSize: 15, color: "#a78bfa" }}>{loans.filter((l) => { const paid = loanPayments.filter((p) => p.loanId === l.id).reduce((s, p) => s + p.amount, 0); return paid < l.principal; }).length} / {loans.length}</div></div>
          </div>
        </div>
      )}

      {/* Recent Trips */}
      <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20, marginTop: 20 }}>
        <h3 style={{ fontSize: 13, color: "#c8a86b", marginBottom: 14, letterSpacing: 1, textTransform: "uppercase" }}>Recent Trips</h3>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 560 }}>
          <thead>
            <tr style={{ color: "rgba(255,255,255,0.45)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              {["DATE", "DESTINATION", "PLATE", "CONTAINER", "TOTAL COST", "INVOICE", "PROFIT"].map((h) => (
                <th key={h} style={{ textAlign: h === "DATE" || h === "DESTINATION" || h === "PLATE" || h === "CONTAINER" ? "left" : "right", padding: "6px 8px", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...trips].sort((a, b) => a.date.localeCompare(b.date)).slice(-6).reverse().map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <td style={{ padding: "8px 8px", whiteSpace: "nowrap" }}>{t.date}</td>
                <td style={{ padding: "8px 8px", color: "#e2e8f0", whiteSpace: "nowrap" }}>{t.destination}</td>
                <td style={{ padding: "8px 8px", whiteSpace: "nowrap" }}><span style={{ background:"rgba(96,165,250,0.12)", color:"#60a5fa", padding:"2px 7px", borderRadius:3, fontFamily:"monospace", fontSize:11, fontWeight:700 }}>{t.nopol}</span></td>
                <td style={{ padding: "8px 8px", color: "rgba(255,255,255,0.45)", whiteSpace: "nowrap" }}>{t.contNo}</td>
                <td style={{ padding: "8px 8px", textAlign: "right", whiteSpace: "nowrap" }}>{fmt(t.total)}</td>
                <td style={{ padding: "8px 8px", textAlign: "right", whiteSpace: "nowrap" }}>{fmt(t.jual)}</td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: "#34d399", whiteSpace: "nowrap" }}>{fmt(t.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

    </div>
  );
}

// ── TRIPS ─────────────────────────────────────────────────────────────────────
function Trips({ trips, setTrips, showToast, guardedDelete, logActivity }) {
  const [form, setForm] = useState({ date: today(), invNo: "", destination: "", nopol: localStorage.getItem("kkLastPlate")||"", contNo: "", sangu: "", lainLabel: "", lainAmt: "", jual: "" });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);

  const total = (Number(form.sangu) || 0) + (Number(form.lainAmt) || 0);
  const profit = (Number(form.jual) || 0) - total;

  const addTrip = () => {
    if (!form.destination || !form.jual) { showToast("Fill in Destination and Invoice Amount", "error"); return; }
    setTrips([...trips, { ...form, id: genId(), total, profit, sangu: Number(form.sangu), lainAmt: Number(form.lainAmt), jual: Number(form.jual), source: "manual" }]);
    logActivity("add", "trip", `Trip to ${form.destination}`);
    if (form.nopol) localStorage.setItem("kkLastPlate", form.nopol);
    setForm({ date: today(), invNo: "", destination: "", nopol: form.nopol, contNo: "", sangu: "", lainLabel: "", lainAmt: "", jual: "" });
    setShowAddForm(false);
    showToast("Trip added!");
  };

  const deleteTrip = (id) => {
    const t = trips.find((x) => x.id === id);
    guardedDelete(`Delete trip to ${t?.destination || "unknown"} on ${t?.date || "?"}?`, () => {
      setTrips(trips.filter((x) => x.id !== id));
      logActivity("delete", "trip", `Trip ${t?.destination} ${t?.date}`);
      showToast("Trip deleted");
    });
  };

  const startEdit = (trip) => {
    setEditingId(trip.id);
    setEditForm({
      date: trip.date || "",
      invNo: trip.invNo || "",
      destination: trip.destination || "",
      nopol: trip.nopol || "",
      contNo: trip.contNo || "",
      sangu: trip.sangu || 0,
      lainLabel: trip.lainLabel || "",
      lainAmt: trip.lainAmt || 0,
      jual: trip.jual || 0,
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditForm({}); };

  const saveEdit = (id) => {
    const sangu = Number(editForm.sangu) || 0;
    const lainAmt = Number(editForm.lainAmt) || 0;
    const jual = Number(editForm.jual) || 0;
    const newTotal = sangu + lainAmt;
    const newProfit = jual - newTotal;
    setTrips(trips.map((t) => t.id === id ? {
      ...t,
      date: editForm.date,
      invNo: editForm.invNo,
      destination: editForm.destination,
      nopol: editForm.nopol,
      contNo: editForm.contNo,
      sangu, lainLabel: editForm.lainLabel, lainAmt,
      total: newTotal, jual, profit: newProfit,
    } : t));
    setEditingId(null);
    setEditForm({});
    showToast("Trip updated!");
  };



  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 20, color: "#e2e8f0", letterSpacing: 0.3, fontWeight: 700 }}>TRIPS</h2>
        <button onClick={() => setShowAddForm(!showAddForm)} style={{ background: showAddForm ? "transparent" : "#c8a86b", color: showAddForm ? "rgba(255,255,255,0.5)" : "#fff", border: showAddForm ? "1px solid rgba(255,255,255,0.15)" : "none", padding: "9px 18px", borderRadius: 5, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          {showAddForm ? "✕ Cancel" : "+ New Trip"}
        </button>
      </div>

      {/* Add Trip Form — only when open */}
      {showAddForm && (
      <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Add New Trip</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>DATE</label><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>INVOICE NO</label><input placeholder="001/KK/V/2026" value={form.invNo} onChange={(e) => setForm({ ...form, invNo: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>DESTINATION *</label><input placeholder="e.g. Customer warehouse name" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>PLATE NUMBER</label><input placeholder="B9674UEJ" value={form.nopol} onChange={(e) => setForm({ ...form, nopol: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>CONTAINER NO</label><input placeholder="TEGU2917447" value={form.contNo} onChange={(e) => setForm({ ...form, contNo: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>DRIVER ALLOWANCE (Rp)</label><input type="number" placeholder="350000" value={form.sangu} onChange={(e) => setForm({ ...form, sangu: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>MISC CHARGE LABEL</label><input placeholder="Port fee, toll gate, etc." value={form.lainLabel} onChange={(e) => setForm({ ...form, lainLabel: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>MISC AMOUNT</label><input type="number" placeholder="5000" value={form.lainAmt} onChange={(e) => setForm({ ...form, lainAmt: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>INVOICE AMOUNT *</label><input type="number" placeholder="1050000" value={form.jual} onChange={(e) => setForm({ ...form, jual: e.target.value })} /></div>
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 14, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
          <span>Total Cost: <strong style={{ color: "#e2e8f0" }}>{fmt(total)}</strong></span>
          <span>Profit: <strong style={{ color: profit >= 0 ? "#34d399" : "#f87171" }}>{fmt(profit)}</strong></span>
        </div>
        <button onClick={addTrip} style={{ marginTop: 14, background: "#c8a86b", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 4, fontWeight: 600, fontSize: 13 }}>
          + Add Trip
        </button>
      </div>
      )}

      {/* Trips Table */}
      <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, alignItems: "center" }}>
          <div>
            <h3 style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: 1 }}>All Trips ({trips.length})</h3>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>Duplicates detected by date + Container # — re-uploads safe</div>
          </div>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>Total Profit: <span style={{ color: "#34d399" }}>{fmt(trips.reduce((s, t) => s + t.profit, 0))}</span></span>
        </div>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 800 }}>
          <thead>
            <tr style={{ color: "rgba(255,255,255,0.45)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              {["DATE", "INV NO", "DESTINATION", "PLATE", "CONTAINER", "DRIVER ALLOW.", "MISC", "TOTAL", "INVOICED", "PROFIT", ""].map((h) => (
                <th key={h} style={{ textAlign: ["DRIVER ALLOW.", "MISC", "TOTAL", "INVOICED", "PROFIT"].includes(h) ? "right" : "left", padding: "6px 8px", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...trips].sort((a, b) => a.date.localeCompare(b.date)).map((t) => {
              const isEditing = editingId === t.id;
              if (isEditing) {
                const editTotal = (Number(editForm.sangu) || 0) + (Number(editForm.lainAmt) || 0);
                const editProfit = (Number(editForm.jual) || 0) - editTotal;
                const inputStyle = { width: "100%", padding: "4px 6px", fontSize: 11, background: "#1e2d3e", border: "1px solid rgba(200,168,107,0.4)", borderRadius: 3, color: "#e2e8f0" };
                return (
                  <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "#1e2d3e" }}>
                    <td style={{ padding: "6px 6px" }}><input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} style={inputStyle} /></td>
                    <td style={{ padding: "6px 6px" }}><input placeholder="Inv #" value={editForm.invNo} onChange={(e) => setEditForm({ ...editForm, invNo: e.target.value })} style={inputStyle} /></td>
                    <td style={{ padding: "6px 6px" }}><input placeholder="Destination" value={editForm.destination} onChange={(e) => setEditForm({ ...editForm, destination: e.target.value })} style={inputStyle} /></td>
                    <td style={{ padding: "6px 6px" }}><input placeholder="Plate" value={editForm.nopol} onChange={(e) => setEditForm({ ...editForm, nopol: e.target.value })} style={{ ...inputStyle, color: "#c8a86b" }} /></td>
                    <td style={{ padding: "6px 6px" }}><input placeholder="Container" value={editForm.contNo} onChange={(e) => setEditForm({ ...editForm, contNo: e.target.value })} style={inputStyle} /></td>
                    <td style={{ padding: "6px 6px" }}><input type="number" value={editForm.sangu} onChange={(e) => setEditForm({ ...editForm, sangu: e.target.value })} style={{ ...inputStyle, textAlign: "right" }} /></td>
                    <td style={{ padding: "6px 6px" }}>
                      <input placeholder="Label" value={editForm.lainLabel} onChange={(e) => setEditForm({ ...editForm, lainLabel: e.target.value })} style={{ ...inputStyle, marginBottom: 2 }} />
                      <input type="number" placeholder="Amount" value={editForm.lainAmt} onChange={(e) => setEditForm({ ...editForm, lainAmt: e.target.value })} style={{ ...inputStyle, textAlign: "right" }} />
                    </td>
                    <td style={{ padding: "6px 6px", textAlign: "right", color: "rgba(255,255,255,0.45)", fontSize: 11 }}>{fmt(editTotal)}</td>
                    <td style={{ padding: "6px 6px" }}><input type="number" value={editForm.jual} onChange={(e) => setEditForm({ ...editForm, jual: e.target.value })} style={{ ...inputStyle, textAlign: "right" }} /></td>
                    <td style={{ padding: "6px 6px", textAlign: "right", color: editProfit >= 0 ? "#34d399" : "#f87171", fontSize: 11 }}>{fmt(editProfit)}</td>
                    <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                      <button onClick={() => saveEdit(t.id)} style={{ background: "#34d399", border: "none", color: "#fff", fontSize: 11, padding: "4px 8px", borderRadius: 3, marginRight: 4, cursor: "pointer", fontWeight: 600 }} title="Save">✓</button>
                      <button onClick={cancelEdit} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.45)", fontSize: 11, padding: "3px 8px", borderRadius: 3, cursor: "pointer" }} title="Cancel">✕</button>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: "8px 8px", whiteSpace: "nowrap" }}>{t.date}</td>
                  <td style={{ padding: "8px 8px", color: t.invNo ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.25)", fontSize: 11, fontStyle: t.invNo ? "normal" : "italic" }}>{t.invNo || "—"}</td>
                  <td style={{ padding: "8px 8px" }}>{t.destination}</td>
                  <td style={{ padding: "8px 8px" }}><span style={{ background:"rgba(96,165,250,0.12)", color:"#60a5fa", padding:"2px 7px", borderRadius:3, fontFamily:"monospace", fontSize:11, fontWeight:700 }}>{t.nopol}</span></td>
                  <td style={{ padding: "8px 8px", color: "rgba(255,255,255,0.45)", fontSize: 11 }}>{t.contNo}</td>
                  <td style={{ padding: "8px 8px", textAlign: "right" }}>{fmt(t.sangu)}</td>
                  <td style={{ padding: "8px 8px", textAlign: "right" }}>
                    {t.lainLabel && <span style={{ color: "rgba(255,255,255,0.45)", marginRight: 4, fontSize: 10 }}>{t.lainLabel}:</span>}
                    {fmt(t.lainAmt)}
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "right" }}>{fmt(t.total)}</td>
                  <td style={{ padding: "8px 8px", textAlign: "right" }}>{fmt(t.jual)}</td>
                  <td style={{ padding: "8px 8px", textAlign: "right", color: t.profit >= 0 ? "#34d399" : "#f87171" }}>{fmt(t.profit)}</td>
                  <td style={{ padding: "8px 4px", whiteSpace: "nowrap" }}>
                    <button onClick={() => startEdit(t)} style={{ background: "transparent", border: "1px solid rgba(200,168,107,0.3)", color: "#c8a86b", fontSize: 11, padding: "3px 8px", borderRadius: 3, marginRight: 4, cursor: "pointer" }} title="Edit">Edit</button>
                    <button onClick={() => deleteTrip(t.id)} style={{ background: "transparent", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", fontSize: 11, padding: "3px 8px", borderRadius: 3, cursor: "pointer" }} title="Delete">Del</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── EXPENSES ──────────────────────────────────────────────────────────────────
function Expenses({ expenses, setExpenses, trucks, pettyHolders, setPettyTopups, pettyTopups, setKas, kas, showToast, guardedDelete, logActivity }) {
  const isMobile = useIsMobile();
  const [expenseType, setExpenseType] = useState("truck"); // "truck" | "overhead" | "petty"
  const [filter, setFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    date: today(),
    category: "Fuel",
    description: "",
    amount: "",
    truck: localStorage.getItem("kkLastPlate") || trucks[0] || "",
    vendor: "",
    holderId: "",
    expenseType: "truck",
  });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  // Period filter
  const [filterPeriod, setFilterPeriod] = useState("all"); // "all"|"this-month"|"last-month"|"this-quarter"|"custom"
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const getPeriodBounds = (period) => {
    const t = today();
    const [y, m] = t.split('-').map(Number);
    if (period === 'this-month') return { from: `${y}-${String(m).padStart(2,'0')}-01`, to: t };
    if (period === 'last-month') {
      const lm = m === 1 ? 12 : m - 1;
      const ly = m === 1 ? y - 1 : y;
      const lastDay = new Date(y, m - 1, 0).getDate();
      return { from: `${ly}-${String(lm).padStart(2,'0')}-01`, to: `${ly}-${String(lm).padStart(2,'0')}-${lastDay}` };
    }
    if (period === 'this-quarter') {
      const qStart = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: `${y}-${String(qStart).padStart(2,'0')}-01`, to: t };
    }
    return { from: '', to: '' };
  };

  const selectPeriod = (period) => {
    setFilterPeriod(period);
    if (period !== 'custom') {
      const bounds = getPeriodBounds(period);
      setDateFrom(bounds.from);
      setDateTo(bounds.to);
    }
  };

  const effectiveFrom = filterPeriod === 'all' ? '' : filterPeriod === 'custom' ? dateFrom : getPeriodBounds(filterPeriod).from;
  const effectiveTo   = filterPeriod === 'all' ? '' : filterPeriod === 'custom' ? dateTo   : getPeriodBounds(filterPeriod).to;

  const inDateRange = (dateStr) => {
    if (!dateStr) return true;
    if (effectiveFrom && dateStr < effectiveFrom) return false;
    if (effectiveTo   && dateStr > effectiveTo)   return false;
    return true;
  };

  const switchType = (type) => {
    setExpenseType(type);
    setForm({
      ...form,
      expenseType: type,
      category: type === "truck" ? "Fuel" : type === "overhead" ? "Salary" : "Petty Cash",
      holderId: "",
    });
  };

  const addExpense = () => {
    if (!form.description || !form.amount) { showToast("Fill in Description and Amount", "error"); return; }
    if (form.expenseType === "truck" && !form.truck) { showToast("Select a truck", "error"); return; }
    if (form.expenseType === "petty" && !form.holderId) { showToast("Select a petty cash holder", "error"); return; }
    const entry = {
      id: genId(),
      date: form.date,
      category: form.category,
      description: form.description,
      amount: Number(form.amount),
      expenseType: form.expenseType,
      truck:    form.expenseType === "truck"     ? form.truck    : "",
      vendor:   form.expenseType === "overhead"  ? form.vendor   : "",
      holderId: form.expenseType === "petty"     ? form.holderId : "",
    };
    setExpenses([...expenses, entry]);
    logActivity("add", "expense", `${form.expenseType} — ${form.description}`);

    // If petty cash — also create a top-up entry (money going to holder)
    // AND a cash ledger entry
    if (form.expenseType === "petty") {
      const holder = pettyHolders.find((h) => h.id === form.holderId);
      const topup = { id: genId(), holderId: form.holderId, date: form.date, amount: Number(form.amount), note: form.description };
      setPettyTopups([...pettyTopups, topup]);
      setKas([...kas, { id: genId(), date: form.date, description: `Petty cash — ${holder?.name || "holder"}${form.description ? ": " + form.description : ""}`, amount: Number(form.amount), type: "out" }]);
      showToast(`Petty cash recorded for ${holder?.name || "holder"} + added to cash ledger!`);
    } else {
      // Truck and overhead expenses are paid from main cash balance
      const label = form.expenseType === "truck"
        ? `Truck expense — ${form.truck}${form.description ? ": " + form.description : ""}`
        : `Overhead — ${form.description}${form.vendor ? " (" + form.vendor + ")" : ""}`;
      setKas([...kas, { id: genId(), date: form.date, description: label, amount: Number(form.amount), type: "out" }]);
      showToast(`${form.expenseType === "truck" ? "Truck" : "Overhead"} expense recorded + deducted from cash!`);
    }

    if (form.expenseType === "truck" && form.truck) localStorage.setItem("kkLastPlate", form.truck);
    setForm({ ...form, description: "", amount: "", vendor: "", holderId: "" });
    setShowAddForm(false);
  };

  const deleteExpense = (id) => {
    const exp = expenses.find((e) => e.id === id);
    guardedDelete(`Delete expense: ${exp?.description || "this expense"}?`, () => {
      setExpenses(expenses.filter((e) => e.id !== id));
      logActivity("delete", "expense", `${exp?.expenseType || "expense"} — ${exp?.description || ""}`);
      showToast("Expense deleted");
    });
  };

  const startEdit = (exp) => {
    setEditingId(exp.id);
    setEditForm({
      date: exp.date || "",
      category: exp.category || "Other",
      description: exp.description || "",
      amount: exp.amount || 0,
      expenseType: exp.expenseType || "truck",
      truck: exp.truck || "",
      vendor: exp.vendor || "",
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditForm({}); };

  const saveEdit = (id) => {
    const isOverhead = editForm.expenseType === "overhead";
    setExpenses(expenses.map((e) => e.id === id ? {
      ...e,
      date: editForm.date,
      category: editForm.category,
      description: editForm.description,
      amount: Number(editForm.amount) || 0,
      expenseType: editForm.expenseType,
      truck: isOverhead ? "" : editForm.truck,
      vendor: isOverhead ? editForm.vendor : "",
    } : e));
    setEditingId(null);
    setEditForm({});
    showToast("Expense updated!");
  };

  // ── Filtered data for chart + analysis ─────────────────────────────────────
  const dateFiltered = expenses.filter((e) => inDateRange(e.date));
  const truckTotal = dateFiltered.filter((e) => (e.expenseType || "truck") === "truck").reduce((s, e) => s + e.amount, 0);
  const overheadTotal = dateFiltered.filter((e) => e.expenseType === "overhead").reduce((s, e) => s + e.amount, 0);
  const grandTotal = truckTotal + overheadTotal;
  const periodLabel = filterPeriod === 'all' ? 'All time' : filterPeriod === 'custom' ? `${effectiveFrom || 'earliest'} → ${effectiveTo || 'today'}` : filterPeriod.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Aggregate by category for pie chart
  const byCategory = {};
  for (const e of dateFiltered) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  }
  const categoryEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  // Build SVG pie chart data (cumulative angles)
  const pieData = [];
  let cumulative = 0;
  for (const [cat, amt] of categoryEntries) {
    const pct = grandTotal > 0 ? amt / grandTotal : 0;
    const startAngle = cumulative * 2 * Math.PI;
    cumulative += pct;
    const endAngle = cumulative * 2 * Math.PI;
    pieData.push({ category: cat, amount: amt, pct, startAngle, endAngle, color: CAT_COLOR[cat] || "#6b7280" });
  }

  // Helper: SVG arc path for pie slice
  const arcPath = (startAngle, endAngle, r = 80, cx = 100, cy = 100) => {
    const x1 = cx + r * Math.sin(startAngle);
    const y1 = cy - r * Math.cos(startAngle);
    const x2 = cx + r * Math.sin(endAngle);
    const y2 = cy - r * Math.cos(endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  };

  const sourceFiltered = sourceFilter === "import"
    ? dateFiltered.filter((e) => e.source === "import")
    : sourceFilter === "manual"
    ? dateFiltered.filter((e) => e.source !== "import")
    : dateFiltered;
  const filtered = (filter === "all" ? sourceFiltered : sourceFiltered.filter((e) => (e.expenseType || "truck") === filter)).sort((a, b) => a.date.localeCompare(b.date));
  const categories = expenseType === "truck" ? TRUCK_CATEGORIES : expenseType === "overhead" ? OVERHEAD_CATEGORIES : ["Petty Cash"];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 20, color: "#e2e8f0", letterSpacing: 0.3, fontWeight: 700 }}>EXPENSES</h2>
        <button onClick={() => setShowAddForm(!showAddForm)} style={{ background: showAddForm ? "transparent" : "#c8a86b", color: showAddForm ? "rgba(255,255,255,0.5)" : "#fff", border: showAddForm ? "1px solid rgba(255,255,255,0.15)" : "none", padding: "9px 18px", borderRadius: 5, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          {showAddForm ? "✕ Cancel" : "+ New Expense"}
        </button>
      </div>

      {/* Period Filter */}
      <div style={{ background: "#162030", border: "1px solid rgba(200,168,107,0.3)", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ fontSize: 12, color: "#c8a86b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Period Filter</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{periodLabel} · {dateFiltered.length} entries</div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          {[
            { key: "all",          label: "All Time" },
            { key: "this-month",   label: "This Month" },
            { key: "last-month",   label: "Last Month" },
            { key: "this-quarter", label: "This Quarter" },
            { key: "custom",       label: "Custom" },
          ].map((p) => (
            <button key={p.key} onClick={() => selectPeriod(p.key)} style={{
              background: filterPeriod === p.key ? "#c8a86b" : "#1e2d3e",
              color: filterPeriod === p.key ? "#162030" : "rgba(255,255,255,0.45)",
              border: `1px solid ${filterPeriod === p.key ? "#c8a86b" : "rgba(255,255,255,0.12)"}`,
              padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer"
            }}>
              {p.label}
            </button>
          ))}
          {filterPeriod === 'custom' && (
            <>
              <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setFilterPeriod("custom"); }} style={{ width: 130, padding: "5px 8px", fontSize: 11 }} />
              <span style={{ color: "rgba(255,255,255,0.45)" }}>→</span>
              <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setFilterPeriod("custom"); }} style={{ width: 130, padding: "5px 8px", fontSize: 11 }} />
            </>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 20 }}>
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 18 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>TRUCK / OPERATIONAL</div>
          <div style={{ fontSize: 18, color: "#f59e0b" }}>{fmt(truckTotal)}</div>
        </div>
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 18 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>OVERHEAD</div>
          <div style={{ fontSize: 18, color: "#ec4899" }}>{fmt(overheadTotal)}</div>
        </div>
        <div style={{ background: "#162030", border: "1px solid rgba(200,168,107,0.3)", borderRadius: 8, padding: 18 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>PETTY CASH TOP-UPS</div>
          <div style={{ fontSize: 18, color: "#c8a86b" }}>{fmt(dateFiltered.filter(e => e.expenseType === "petty").reduce((s, e) => s + e.amount, 0))}</div>
        </div>
        <div style={{ background: "#162030", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, padding: 18 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>TOTAL EXPENSES</div>
          <div style={{ fontSize: 18, color: "#f87171", fontWeight: 600 }}>{fmt(grandTotal)}</div>
        </div>
      </div>

      {/* Pie Chart + Breakdown */}
      {grandTotal > 0 && (
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20, marginBottom: 20 }}>
          <h3 style={{ fontSize: 12, color: "#c8a86b", marginBottom: 16, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>Expense Breakdown by Category</h3>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "240px 1fr", gap: 30, alignItems: "center" }}>
            {/* Pie chart */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <svg width="220" height="220" viewBox="0 0 200 200">
                {pieData.length === 1 ? (
                  <circle cx="100" cy="100" r="80" fill={pieData[0].color} />
                ) : (
                  pieData.map((slice, i) => (
                    <path
                      key={i}
                      d={arcPath(slice.startAngle, slice.endAngle)}
                      fill={slice.color}
                      stroke="#162030"
                      strokeWidth="1.5"
                    >
                      <title>{slice.category}: {fmt(slice.amount)} ({(slice.pct * 100).toFixed(1)}%)</title>
                    </path>
                  ))
                )}
                {/* Donut hole */}
                <circle cx="100" cy="100" r="38" fill="#162030" />
                <text x="100" y="95" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.45)" fontFamily="Inter">TOTAL</text>
                <text x="100" y="110" textAnchor="middle" fontSize="11" fill="#c8a86b" fontWeight="600" fontFamily="Inter">
                  {grandTotal >= 1000000 ? `${(grandTotal / 1000000).toFixed(1)}M` : `${(grandTotal / 1000).toFixed(0)}K`}
                </text>
              </svg>
            </div>

            {/* Legend */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {categoryEntries.map(([cat, amt], i) => {
                const pct = grandTotal > 0 ? (amt / grandTotal) * 100 : 0;
                const color = CAT_COLOR[cat] || "#6b7280";
                return (
                  <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 14, height: 14, background: color, borderRadius: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: "#e2e8f0" }}>{cat}</span>
                        <span style={{ color, fontWeight: 600 }}>{fmt(amt)} <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 400 }}>({pct.toFixed(1)}%)</span></span>
                      </div>
                      <div style={{ background: "rgba(255,255,255,0.08)", height: 4, borderRadius: 2 }}>
                        <div style={{ width: `${pct}%`, background: color, height: 4, borderRadius: 2, transition: "width .4s" }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Add Expense Form — only when open */}
      {showAddForm && (
      <>
      {/* Type toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={() => switchType("truck")} style={{ background: expenseType === "truck" ? "#f59e0b" : "#1e2d3e", color: expenseType === "truck" ? "#0c1420" : "rgba(255,255,255,0.45)", border: `1px solid ${expenseType === "truck" ? "#f59e0b" : "rgba(255,255,255,0.12)"}`, padding: "8px 18px", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          Truck Expense
        </button>
        <button onClick={() => switchType("overhead")} style={{ background: expenseType === "overhead" ? "#ec4899" : "#1e2d3e", color: expenseType === "overhead" ? "#fff" : "rgba(255,255,255,0.45)", border: `1px solid ${expenseType === "overhead" ? "#ec4899" : "rgba(255,255,255,0.12)"}`, padding: "8px 18px", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          Overhead Expense
        </button>
        <button onClick={() => switchType("petty")} style={{ background: expenseType === "petty" ? "#c8a86b" : "#1e2d3e", color: expenseType === "petty" ? "#0c1420" : "rgba(255,255,255,0.45)", border: `1px solid ${expenseType === "petty" ? "#c8a86b" : "rgba(255,255,255,0.12)"}`, padding: "8px 18px", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          Petty Cash Top-Up
        </button>
        <button onClick={() => switchType("driver")} style={{ background: expenseType === "driver" ? "rgba(13,30,48,0.8)" : "#1e2d3e", color: expenseType === "driver" ? "#c8a86b" : "rgba(255,255,255,0.45)", border: `1px solid ${expenseType === "driver" ? "#c8a86b" : "rgba(255,255,255,0.12)"}`, padding: "8px 18px", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          Driver Costs
        </button>
      </div>

      <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>
          Add {expenseType === "truck" ? "Truck" : expenseType === "overhead" ? "Overhead" : expenseType === "driver" ? "Driver Cost" : "Petty Cash Top-Up"}
        </h3>
        {expenseType === "driver" ? (
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, padding: "12px 0" }}>
            Driver costs are recorded automatically when you import a monthly CSV. They cannot be added manually.
          </div>
        ) : (
        <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>DATE</label><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div>
            <label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>CATEGORY</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>DESCRIPTION *</label>
            <input placeholder={expenseType === "truck" ? "e.g. spare parts, fuel, repairs" : "e.g. Driver salary - month, Office rent"} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>AMOUNT (Rp) *</label><input type="number" placeholder="250000" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          {expenseType === "truck" ? (
            <div>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>TRUCK *</label>
              <select value={form.truck} onChange={(e) => setForm({ ...form, truck: e.target.value })}>
                {trucks.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          ) : expenseType === "overhead" ? (
            <div>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>VENDOR / PAID TO</label>
              <input placeholder="e.g. John Smith, PLN, Indihome" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
            </div>
          ) : (
            <div>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>PETTY CASH HOLDER *</label>
              <select value={form.holderId} onChange={(e) => setForm({ ...form, holderId: e.target.value })}>
                <option value="">— Select Holder —</option>
                {pettyHolders.filter((h) => h.active).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <button onClick={addExpense} style={{ marginTop: 14, background: "#c8a86b", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 4, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
          + Record {expenseType === "truck" ? "Truck" : expenseType === "overhead" ? "Overhead" : "Petty Cash"} Expense
        </button>
        </>
        )}
      </div>
      </>
      )}

      <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: 1 }}>All Expenses ({filtered.length})</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 4, marginRight: 8 }}>
              {[{ key: "all", label: "All Sources" }, { key: "import", label: "From Import" }, { key: "manual", label: "Manual" }].map((f) => (
                <button key={f.key} onClick={() => setSourceFilter(f.key)} style={{ background: sourceFilter === f.key ? "#c8a86b" : "transparent", color: sourceFilter === f.key ? "#fff" : "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)", padding: "4px 10px", borderRadius: 3, fontSize: 11, cursor: "pointer" }}>
                  {f.label}
                </button>
              ))}
            </div>
            {[{ key: "all", label: "All" }, { key: "truck", label: "Truck" }, { key: "overhead", label: "Overhead" }].map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)} style={{ background: filter === f.key ? "#c8a86b" : "transparent", color: filter === f.key ? "#162030" : "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)", padding: "4px 10px", borderRadius: 3, fontSize: 11, cursor: "pointer" }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 700 }}>
          <thead>
            <tr style={{ color: "rgba(255,255,255,0.45)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              {["DATE", "TYPE", "CATEGORY", "DESCRIPTION", "TRUCK / VENDOR / HOLDER", "AMOUNT", ""].map((h) => (
                <th key={h} style={{ textAlign: h === "AMOUNT" ? "right" : "left", padding: "6px 8px", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const isEditing = editingId === e.id;
              if (isEditing) {
                const isOverheadEdit = editForm.expenseType === "overhead";
                const editCategories = isOverheadEdit ? OVERHEAD_CATEGORIES : TRUCK_CATEGORIES;
                const inputStyle = { width: "100%", padding: "4px 6px", fontSize: 11, background: "#1e2d3e", border: "1px solid rgba(200,168,107,0.4)", borderRadius: 3, color: "#e2e8f0" };
                return (
                  <tr key={e.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "#1e2d3e" }}>
                    <td style={{ padding: "6px 6px" }}><input type="date" value={editForm.date} onChange={(ev) => setEditForm({ ...editForm, date: ev.target.value })} style={inputStyle} /></td>
                    <td style={{ padding: "6px 6px" }}>
                      <select value={editForm.expenseType} onChange={(ev) => setEditForm({ ...editForm, expenseType: ev.target.value, category: ev.target.value === "overhead" ? "Salary" : "Fuel" })} style={inputStyle}>
                        <option value="truck">Truck</option>
                        <option value="overhead">Overhead</option>
                      </select>
                    </td>
                    <td style={{ padding: "6px 6px" }}>
                      <select value={editForm.category} onChange={(ev) => setEditForm({ ...editForm, category: ev.target.value })} style={inputStyle}>
                        {editCategories.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "6px 6px" }}><input placeholder="Description" value={editForm.description} onChange={(ev) => setEditForm({ ...editForm, description: ev.target.value })} style={inputStyle} /></td>
                    <td style={{ padding: "6px 6px" }}>
                      {isOverheadEdit ? (
                        <input placeholder="Vendor" value={editForm.vendor} onChange={(ev) => setEditForm({ ...editForm, vendor: ev.target.value })} style={inputStyle} />
                      ) : (
                        <select value={editForm.truck} onChange={(ev) => setEditForm({ ...editForm, truck: ev.target.value })} style={inputStyle}>
                          <option value="">— Truck —</option>
                          {trucks.map((t) => <option key={t}>{t}</option>)}
                        </select>
                      )}
                    </td>
                    <td style={{ padding: "6px 6px" }}><input type="number" value={editForm.amount} onChange={(ev) => setEditForm({ ...editForm, amount: ev.target.value })} style={{ ...inputStyle, textAlign: "right" }} /></td>
                    <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                      <button onClick={() => saveEdit(e.id)} style={{ background: "#34d399", border: "none", color: "#fff", fontSize: 11, padding: "4px 8px", borderRadius: 3, marginRight: 4, cursor: "pointer", fontWeight: 600 }} title="Save">✓</button>
                      <button onClick={cancelEdit} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.45)", fontSize: 11, padding: "3px 8px", borderRadius: 3, cursor: "pointer" }} title="Cancel">✕</button>
                    </td>
                  </tr>
                );
              }
              const isOverhead = e.expenseType === "overhead";
              return (
                <tr key={e.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: "8px 8px", whiteSpace: "nowrap" }}>{e.date}</td>
                  <td style={{ padding: "8px 8px" }}>
                    {(() => {
                      const isDriver = e.expenseType === "driver";
                      const isPetty = e.expenseType === "petty";
                      const bg = isDriver ? "rgba(255,255,255,0.06)" : isPetty ? "rgba(200,168,107,0.13)" : isOverhead ? "#7C8B6722" : "rgba(255,255,255,0.06)";
                      const col = isDriver ? "#0d1e30" : isPetty ? "#c8a86b" : isOverhead ? "rgba(255,255,255,0.45)" : "#0d1e30";
                      const label = isDriver ? "Driver" : isPetty ? "Petty Cash" : isOverhead ? "Overhead" : "Truck";
                      return <span className="tag" style={{ background: bg, color: col, border: `1px solid ${col}44` }}>{label}</span>;
                    })()}
                  </td>
                  <td style={{ padding: "8px 8px" }}>
                    <span className="tag" style={{ background: (CAT_COLOR[e.category] || "#6b7280") + "22", color: CAT_COLOR[e.category] || "rgba(255,255,255,0.45)", border: `1px solid ${(CAT_COLOR[e.category] || "#6b7280")}44` }}>
                      {e.category}
                    </span>
                  </td>
                  <td style={{ padding: "8px 8px", whiteSpace: "nowrap" }}>{e.description}</td>
                  <td style={{ padding: "8px 8px", whiteSpace: "nowrap" }}>
                    {e.expenseType === "petty"
                      ? <span style={{ color: "#c8a86b" }}>{pettyHolders.find(h => h.id === e.holderId)?.name || "—"}</span>
                      : isOverhead ? <span style={{ color: "rgba(255,255,255,0.45)" }}>{e.vendor || "—"}</span> : <span style={{ background:"rgba(96,165,250,0.12)", color:"#60a5fa", padding:"2px 7px", borderRadius:3, fontFamily:"monospace", fontSize:11, fontWeight:700 }}>{e.truck || "—"}</span>}
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "right", color: "#f87171", whiteSpace: "nowrap" }}>{fmt(e.amount)}</td>
                  <td style={{ padding: "8px 4px", whiteSpace: "nowrap" }}>
                    {(() => {
                      const holder = pettyHolders.find(h => h.id === e.holderId);
                      const activeHolder = pettyHolders.find(h => h.active);
                      if (holder) {
                        return (
                          <button
                            onClick={() => setExpenses(expenses.map(x => x.id === e.id ? { ...x, holderId: "" } : x))}
                            style={{ background: "rgba(200,168,107,0.13)", border: "1px solid rgba(200,168,107,0.4)", color: "#c8a86b", fontSize: 10, padding: "2px 6px", borderRadius: 3, marginRight: 4, cursor: "pointer" }}
                            title="Remove petty cash attribution"
                          >
                            {holder.name} ✓
                          </button>
                        );
                      }
                      return (
                        <button
                          onClick={() => { if (activeHolder) setExpenses(expenses.map(x => x.id === e.id ? { ...x, holderId: activeHolder.id } : x)); }}
                          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.25)", fontSize: 10, padding: "2px 6px", borderRadius: 3, marginRight: 4, cursor: "pointer" }}
                          title="Attribute to petty cash"
                        >
                          + Petty
                        </button>
                      );
                    })()}
                    <button onClick={() => startEdit(e)} style={{ background: "transparent", border: "1px solid rgba(200,168,107,0.3)", color: "#c8a86b", fontSize: 11, padding: "3px 8px", borderRadius: 3, marginRight: 4, cursor: "pointer" }} title="Edit">Edit</button>
                    <button onClick={() => deleteExpense(e.id)} style={{ background: "transparent", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", fontSize: 11, padding: "3px 8px", borderRadius: 3, cursor: "pointer" }} title="Delete">Del</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}


// ── CASH  ────────────────────────────────────────────────────────────────
function Kas({ kas, setKas, showToast, kasBalance, guardedDelete, logActivity }) {
  const isMobile = useIsMobile();
  const [form, setForm] = useState({ date: today(), description: "", amount: "", type: "in" });
  const [showAddForm, setShowAddForm] = useState(false);

  // Period filter
  const [kasFilter, setKasFilter] = useState("all");
  const [kasFrom, setKasFrom] = useState("");
  const [kasTo, setKasTo] = useState("");

  const getKasPeriodBounds = (period) => {
    const t = today();
    const [y, m] = t.split('-').map(Number);
    if (period === 'this-month') return { from: `${y}-${String(m).padStart(2,'0')}-01`, to: t };
    if (period === 'last-month') {
      const lm = m === 1 ? 12 : m - 1;
      const ly = m === 1 ? y - 1 : y;
      const lastDay = new Date(y, m - 1, 0).getDate();
      return { from: `${ly}-${String(lm).padStart(2,'0')}-01`, to: `${ly}-${String(lm).padStart(2,'0')}-${lastDay}` };
    }
    if (period === 'this-quarter') {
      const qStart = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: `${y}-${String(qStart).padStart(2,'0')}-01`, to: t };
    }
    return { from: '', to: '' };
  };

  const selectKasPeriod = (period) => {
    setKasFilter(period);
    if (period !== 'custom') {
      const bounds = getKasPeriodBounds(period);
      setKasFrom(bounds.from);
      setKasTo(bounds.to);
    }
  };

  const effectiveKasFrom = kasFilter === 'all' ? '' : kasFilter === 'custom' ? kasFrom : getKasPeriodBounds(kasFilter).from;
  const effectiveKasTo   = kasFilter === 'all' ? '' : kasFilter === 'custom' ? kasTo   : getKasPeriodBounds(kasFilter).to;

  const addKas = () => {
    if (!form.description || !form.amount) { showToast("Fill in Description and Amount", "error"); return; }
    setKas([...kas, { ...form, id: genId(), amount: Number(form.amount) }]);
    logActivity("add", "cash", form.description);
    setForm({ ...form, description: "", amount: "" });
    showToast("Cash entry added!");
  };

  let running = 0;
  const rows = [...kas].sort((a, b) => a.date.localeCompare(b.date)).map((k) => {
    running += k.type === "in" ? k.amount : -k.amount;
    return { ...k, balance: running };
  });

  const filteredRows = kasFilter === 'all'
    ? rows
    : rows.filter((k) => {
        if (effectiveKasFrom && k.date < effectiveKasFrom) return false;
        if (effectiveKasTo   && k.date > effectiveKasTo)   return false;
        return true;
      });

  const periodCashIn  = filteredRows.filter(k => k.type === "in").reduce((s, k) => s + k.amount, 0);
  const periodCashOut = filteredRows.filter(k => k.type === "out").reduce((s, k) => s + k.amount, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 20, color: "#e2e8f0", letterSpacing: 0.3, fontWeight: 700 }}>CASH LEDGER</h2>
        <button onClick={() => setShowAddForm(!showAddForm)} style={{ background: showAddForm ? "transparent" : "#c8a86b", color: showAddForm ? "rgba(255,255,255,0.5)" : "#fff", border: showAddForm ? "1px solid rgba(255,255,255,0.15)" : "none", padding: "9px 18px", borderRadius: 5, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          {showAddForm ? "✕ Cancel" : "+ New Entry"}
        </button>
      </div>

      {/* All-time cash summary strip */}
      <div style={{ display:"flex", flexDirection: isMobile ? "column" : "row", background:"#162030", borderRadius:8, border:"1px solid rgba(255,255,255,0.08)", overflow:"hidden", marginBottom: kasFilter !== 'all' ? 0 : 16 }}>
        <div style={{ flex:1, padding:"14px 18px", borderRight: isMobile ? "none" : "1px solid rgba(255,255,255,0.08)", borderBottom: isMobile ? "1px solid rgba(255,255,255,0.08)" : "none" }}>
          <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:"1px", marginBottom:5 }}>Cash In (All Time)</div>
          <div style={{ fontFamily:"'Montserrat',sans-serif", fontSize:18, fontWeight:700, color:"#34d399" }}>{fmt(kas.filter(k=>k.type==="in").reduce((s,k)=>s+k.amount,0))}</div>
        </div>
        <div style={{ flex:1, padding:"14px 18px", borderRight: isMobile ? "none" : "1px solid rgba(255,255,255,0.08)", borderBottom: isMobile ? "1px solid rgba(255,255,255,0.08)" : "none" }}>
          <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:"1px", marginBottom:5 }}>Cash Out (All Time)</div>
          <div style={{ fontFamily:"'Montserrat',sans-serif", fontSize:18, fontWeight:700, color:"#f87171" }}>{fmt(kas.filter(k=>k.type==="out").reduce((s,k)=>s+k.amount,0))}</div>
        </div>
        <div style={{ flex:1, padding:"14px 18px", background:"rgba(200,168,107,0.06)" }}>
          <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:"1px", marginBottom:5 }}>Balance</div>
          <div style={{ fontFamily:"'Montserrat',sans-serif", fontSize:18, fontWeight:700, color:"#c8a86b" }}>{fmt(kasBalance)}</div>
        </div>
      </div>
      {kasFilter !== 'all' && (
        <div style={{ background:"#1e2d3e", border:"1px solid rgba(255,255,255,0.08)", borderTop:"none", borderRadius:"0 0 8px 8px", padding:"8px 18px", marginBottom:16, fontSize:11, color:"rgba(255,255,255,0.45)", display:"flex", gap:20, flexWrap:"wrap" }}>
          <span>Period total:</span>
          <span style={{ color:"#34d399" }}>Cash In {fmt(periodCashIn)}</span>
          <span style={{ color:"rgba(255,255,255,0.3)" }}>·</span>
          <span style={{ color:"#f87171" }}>Cash Out {fmt(periodCashOut)}</span>
          <span style={{ color:"rgba(255,255,255,0.3)" }}>·</span>
          <span style={{ color:"#c8a86b" }}>Net {fmt(periodCashIn - periodCashOut)}</span>
        </div>
      )}

      {/* Period Filter */}
      <div style={{ background: "#162030", border: "1px solid rgba(200,168,107,0.3)", borderRadius: 8, padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#c8a86b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginRight: 6 }}>Period:</span>
          {[
            { key: "all",          label: "All Time" },
            { key: "this-month",   label: "This Month" },
            { key: "last-month",   label: "Last Month" },
            { key: "this-quarter", label: "This Quarter" },
            { key: "custom",       label: "Custom" },
          ].map((p) => (
            <button key={p.key} onClick={() => selectKasPeriod(p.key)} style={{
              background: kasFilter === p.key ? "#c8a86b" : "#1e2d3e",
              color: kasFilter === p.key ? "#162030" : "rgba(255,255,255,0.45)",
              border: `1px solid ${kasFilter === p.key ? "#c8a86b" : "rgba(255,255,255,0.12)"}`,
              padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer"
            }}>
              {p.label}
            </button>
          ))}
          {kasFilter === 'custom' && (
            <>
              <input type="date" value={kasFrom} onChange={(e) => { setKasFrom(e.target.value); setKasFilter("custom"); }} style={{ width: 130, padding: "5px 8px", fontSize: 11 }} />
              <span style={{ color: "rgba(255,255,255,0.45)" }}>→</span>
              <input type="date" value={kasTo} onChange={(e) => { setKasTo(e.target.value); setKasFilter("custom"); }} style={{ width: 130, padding: "5px 8px", fontSize: 11 }} />
            </>
          )}
        </div>
      </div>

      {/* Add Cash Entry Form — only when open */}
      {showAddForm && (
      <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Add Cash Entry</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>DATE</label><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div>
            <label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>TYPE</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="in">Cash In</option>
              <option value="out">Cash Out</option>
            </select>
          </div>
          <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>DESCRIPTION *</label><input placeholder="KAS IN / EXPENSE..." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>AMOUNT (Rp) *</label><input type="number" placeholder="3000000" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
        </div>
        <button onClick={addKas} style={{ marginTop: 14, background: "#c8a86b", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 4, fontWeight: 600, fontSize: 13 }}>
          + Add Entry
        </button>
      </div>
      )}

      <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20 }}>
        <h3 style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Cash Ledger {kasFilter !== 'all' ? `(${filteredRows.length} entries in period)` : `(${rows.length} total)`}</h3>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 480 }}>
          <thead>
            <tr style={{ color: "rgba(255,255,255,0.45)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              {["DATE", "DESCRIPTION", "CASH IN", "CASH OUT", "BALANCE", ""].map((h) => (
                <th key={h} style={{ textAlign: ["CASH IN", "CASH OUT", "BALANCE"].includes(h) ? "right" : "left", padding: "6px 8px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((k) => (
              <tr key={k.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <td style={{ padding: "8px 8px" }}>{k.date}</td>
                <td style={{ padding: "8px 8px" }}>{k.description}</td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: "#34d399" }}>{k.type === "in" ? fmt(k.amount) : "—"}</td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: "#f87171" }}>{k.type === "out" ? fmt(k.amount) : "—"}</td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: "#c8a86b" }}>{fmt(k.balance)}</td>
                <td><button onClick={() => guardedDelete(`Delete cash entry: ${k.description}?`, () => { setKas(kas.filter((x) => x.id !== k.id)); logActivity("delete", "cash", k.description); showToast("Entry deleted"); })} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.25)", fontSize: 14, padding: "2px 6px" }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}


// ── FINANCING ─────────────────────────────────────────────────────────────────

// ── PETTY CASH ────────────────────────────────────────────────────────────────
function PettyCash({ pettyHolders, setPettyHolders, pettyTopups, setPettyTopups, expenses, setExpenses, kas, setKas, showToast, confirmModal, setConfirmModal, guardedDelete, logActivity }) {
  const isMobile = useIsMobile();
  const [activeHolder, setActiveHolder] = useState(null); // holderId or null = overview
  const [addingHolder, setAddingHolder] = useState(false);
  const [newHolderForm, setNewHolderForm] = useState({ name: "", notes: "" });
  const [editHolderId, setEditHolderId] = useState(null);
  const [editHolderForm, setEditHolderForm] = useState({});

  // Top-up form
  const [topupForm, setTopupForm] = useState({ holderId: "", date: today(), amount: "", note: "" });
  const [editTopupId, setEditTopupId] = useState(null);
  const [editTopupForm, setEditTopupForm] = useState({});

  // ── Calculations ─────────────────────────────────────────────────────────
  const getHolderStats = (holder) => {
    const topups = pettyTopups.filter((t) => t.holderId === holder.id).sort((a, b) => a.date.localeCompare(b.date));
    const totalTopup = topups.reduce((s, t) => s + t.amount, 0);
    // Spending = all expenses tagged to this holder (manual or imported)
    const holderExpenses = expenses.filter((e) => e.holderId === holder.id).sort((a, b) => a.date.localeCompare(b.date));
    const spending = holderExpenses.reduce((s, e) => s + e.amount, 0);
    const balance = totalTopup - spending;
    return { topups, totalTopup, spending, balance, holderExpenses };
  };

  // Unassigned imported expenses (multiple holders, not yet assigned)
  const unassignedExpenses = expenses.filter((e) => e.holderId === "unassigned");

  // Grand totals
  const grandTopup   = pettyTopups.reduce((s, t) => s + t.amount, 0);
  const grandBalance = pettyHolders.filter((h) => h.active).reduce((s, h) => {
    const { balance } = getHolderStats(h);
    return s + balance;
  }, 0);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const addHolder = () => {
    if (!newHolderForm.name.trim()) { showToast("Enter a name", "error"); return; }
    setPettyHolders([...pettyHolders, { id: genId(), name: newHolderForm.name.trim(), active: true, notes: newHolderForm.notes }]);
    setNewHolderForm({ name: "", notes: "" });
    setAddingHolder(false);
    showToast("Petty cash holder added!");
  };

  const saveEditHolder = () => {
    setPettyHolders(pettyHolders.map((h) => h.id === editHolderId ? { ...h, name: editHolderForm.name, notes: editHolderForm.notes } : h));
    setEditHolderId(null);
    showToast("Updated!");
  };

  const deactivateHolder = (id) => {
    setConfirmModal({
      title: "Deactivate this holder?",
      message: "Their top-up history will be kept. They won't appear in new top-up forms.",
      warning: "You can reactivate from the holder card.",
      onConfirm: () => {
        setPettyHolders(pettyHolders.map((h) => h.id === id ? { ...h, active: false } : h));
        setConfirmModal(null);
        if (activeHolder === id) setActiveHolder(null);
        showToast("Holder deactivated");
      },
    });
  };

  const deleteHolder = (id) => {
    const holder = pettyHolders.find((h) => h.id === id);
    const topupCount = pettyTopups.filter((t) => t.holderId === id).length;
    guardedDelete(`Delete ${holder?.name}? This will permanently delete this holder and all ${topupCount} top-up record${topupCount !== 1 ? "s" : ""} associated with them.`, () => {
      setPettyHolders(pettyHolders.filter((h) => h.id !== id));
      setPettyTopups(pettyTopups.filter((t) => t.holderId !== id));
      logActivity("delete", "petty holder", `Holder ${holder?.name} deleted`);
      if (activeHolder === id) setActiveHolder(null);
      showToast(`${holder?.name} deleted`);
    });
  };

  const addTopup = () => {
    if (!topupForm.holderId || !topupForm.amount) { showToast("Select a holder and enter amount", "error"); return; }
    const holderName = pettyHolders.find(h=>h.id===topupForm.holderId)?.name || "";
    const newTopup = { id: genId(), holderId: topupForm.holderId, date: topupForm.date, amount: Number(topupForm.amount), note: topupForm.note };
    setPettyTopups([...pettyTopups, newTopup]);
    // Also record as cash-out in the main cash ledger
    setKas([...kas, { id: genId(), date: topupForm.date, description: `Petty cash top-up — ${holderName}${topupForm.note ? " · " + topupForm.note : ""}`, amount: Number(topupForm.amount), type: "out" }]);
    logActivity("add", "petty topup", `Top-up for ${holderName}${topupForm.note ? ": " + topupForm.note : ""}`);
    setTopupForm({ holderId: topupForm.holderId, date: today(), amount: "", note: "" });
    showToast("Top-up recorded + added to cash ledger!");
  };

  const saveEditTopup = () => {
    setPettyTopups(pettyTopups.map((t) => t.id === editTopupId ? { ...t, date: editTopupForm.date, amount: Number(editTopupForm.amount) || 0, note: editTopupForm.note } : t));
    setEditTopupId(null);
    showToast("Top-up updated!");
  };

  const deleteTopup = (id) => {
    const topup = pettyTopups.find((t) => t.id === id);
    guardedDelete("Delete this top-up? The matching cash ledger entry is NOT automatically removed.", () => {
      setPettyTopups(pettyTopups.filter((t) => t.id !== id));
      logActivity("delete", "petty topup", `Top-up deleted${topup?.note ? ": " + topup.note : ""}`);
      showToast("Top-up deleted");
    });
  };

  const [filterMonth, setFilterMonth] = useState("");

  const iStyle = { background: "#1e2d3e", border: "1px solid rgba(200,168,107,0.4)", color: "#e2e8f0", padding: "5px 8px", borderRadius: 3, fontFamily: "inherit", fontSize: 11, width: "100%" };
  const inputStyle = { background: "#1e2d3e", border: "1px solid rgba(255,255,255,0.08)", color: "#e2e8f0", padding: "8px 10px", borderRadius: 4, fontFamily: "inherit", fontSize: 12, width: "100%", outline: "none" };

  const currentHolder = activeHolder ? pettyHolders.find((h) => h.id === activeHolder) : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {activeHolder && (
            <button onClick={() => setActiveHolder(null)} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.45)", padding: "5px 10px", borderRadius: 4, fontSize: 12, cursor: "pointer" }}>
              ← Back
            </button>
          )}
          <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 20, color: "#e2e8f0", letterSpacing: 0.3, fontWeight: 700 }}>
            PETTY CASH {currentHolder ? `— ${currentHolder.name}` : ""}
          </h2>
        </div>
        {!activeHolder && (
          <button onClick={() => setAddingHolder(!addingHolder)} style={{ background: addingHolder ? "rgba(255,255,255,0.25)" : "#c8a86b", color: addingHolder ? "rgba(255,255,255,0.45)" : "#162030", border: "none", padding: "8px 16px", borderRadius: 4, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            {addingHolder ? "✕ Cancel" : "+ Add Holder"}
          </button>
        )}
      </div>

      {/* ── OVERVIEW ── */}
      {!activeHolder && (
        <>
          {/* Add holder form */}
          {addingHolder && (
            <div style={{ background: "#162030", border: "1px solid rgba(200,168,107,0.3)", borderRadius: 8, padding: 20, marginBottom: 20 }}>
              <h3 style={{ fontSize: 12, color: "#c8a86b", marginBottom: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>New Petty Cash Holder</h3>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 2fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>NAME *</label>
                  <input placeholder="Holder name" value={newHolderForm.name} onChange={(e) => setNewHolderForm({ ...newHolderForm, name: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>NOTES</label>
                  <input placeholder="e.g. Handles daily operational expenses" value={newHolderForm.notes} onChange={(e) => setNewHolderForm({ ...newHolderForm, notes: e.target.value })} style={inputStyle} />
                </div>
              </div>
              <button onClick={addHolder} style={{ marginTop: 12, background: "#c8a86b", color: "#fff", border: "none", padding: "9px 22px", borderRadius: 4, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                + Add Holder
              </button>
            </div>
          )}

          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
            <div style={{ background: "#162030", border: "1px solid rgba(96,165,250,0.3)", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>TOTAL TOPPED UP</div>
              <div style={{ fontSize: 18, color: "#60a5fa", fontWeight: 600 }}>{fmt(grandTopup)}</div>
            </div>
            <div style={{ background: "#162030", border: "1px solid rgba(200,168,107,0.3)", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>TOTAL OUTSTANDING BALANCE</div>
              <div style={{ fontSize: 18, color: "#c8a86b", fontWeight: 600 }}>{fmt(grandBalance)}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>across {pettyHolders.filter(h=>h.active).length} active holder{pettyHolders.filter(h=>h.active).length !== 1 ? "s" : ""}</div>
            </div>
          </div>

          {/* Holder cards */}
          {/* Unassigned imported expenses */}
          {unassignedExpenses.length > 0 && (
            <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid #f59e0b66", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 700 }}>⚠ {unassignedExpenses.length} Unassigned Expense{unassignedExpenses.length !== 1 ? "s" : ""}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>These were imported but could not be auto-assigned (multiple active holders). Assign them to a holder below.</div>
                </div>
                <div style={{ fontSize: 14, color: "#f59e0b", fontWeight: 700 }}>{fmt(unassignedExpenses.reduce((s,e) => s + e.amount, 0))}</div>
              </div>
              <div style={{ maxHeight: 160, overflowY: "auto" }}>
                {unassignedExpenses.map((e) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.08)", fontSize: 12 }}>
                    <span style={{ color: "rgba(255,255,255,0.45)" }}>{e.date} · {e.description}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ color: "#f59e0b" }}>{fmt(e.amount)}</span>
                      <select
                        value=""
                        onChange={(ev) => {
                          if (!ev.target.value) return;
                          setExpenses(expenses.map((x) => x.id === e.id ? { ...x, holderId: ev.target.value } : x));
                        }}
                        style={{ background: "#1e2d3e", border: "1px solid #f59e0b66", color: "#f59e0b", padding: "3px 6px", borderRadius: 3, fontSize: 11, fontFamily: "inherit" }}
                      >
                        <option value="">Assign to…</option>
                        {pettyHolders.filter((h) => h.active).map((h) => (
                          <option key={h.id} value={h.id}>{h.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
              {pettyHolders.filter((h) => h.active).length > 0 && (
                <button
                  onClick={() => {
                    const firstHolder = pettyHolders.filter((h) => h.active)[0];
                    setExpenses(expenses.map((e) => e.holderId === "unassigned" ? { ...e, holderId: firstHolder.id } : e));
                    showToast(`All assigned to ${firstHolder.name}`);
                  }}
                  style={{ marginTop: 10, background: "#f59e0b", color: "#fff", border: "none", padding: "6px 14px", borderRadius: 3, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                >
                  Assign all to {pettyHolders.filter((h) => h.active)[0]?.name}
                </button>
              )}
            </div>
          )}

          {pettyHolders.length === 0 ? (
            <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 40, textAlign: "center", color: "rgba(255,255,255,0.45)" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>👛</div>
              <div style={{ fontSize: 14, marginBottom: 6 }}>No petty cash holders yet</div>
              <div style={{ fontSize: 12 }}>Click "+ Add Holder" to get started</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {pettyHolders.map((h) => {
                const { totalTopup, spending, balance, topups } = getHolderStats(h);
                const isEditing = editHolderId === h.id;
                return (
                  <div key={h.id} style={{ background: "#162030", border: `1px solid ${h.active ? "rgba(255,255,255,0.08)" : "#1e2d3e"}`, borderRadius: 8, padding: 20, opacity: h.active ? 1 : 0.55 }}>
                    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "start", marginBottom: 14, gap: isMobile ? 10 : 0 }}>
                      <div style={{ flex: 1 }}>
                        {isEditing ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                            <input value={editHolderForm.name} onChange={(e) => setEditHolderForm({ ...editHolderForm, name: e.target.value })} style={{ ...iStyle, fontSize: 14, fontWeight: 700, width: 140 }} />
                            <input value={editHolderForm.notes} onChange={(e) => setEditHolderForm({ ...editHolderForm, notes: e.target.value })} style={{ ...iStyle, flex: 1, minWidth: 120 }} placeholder="Notes" />
                            <button onClick={saveEditHolder} style={{ background: "#34d399", border: "none", color: "#fff", padding: "5px 12px", borderRadius: 3, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>✓</button>
                            <button onClick={() => setEditHolderId(null)} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.45)", padding: "4px 10px", borderRadius: 3, fontSize: 12, cursor: "pointer" }}>✕</button>
                          </div>
                        ) : (
                          <>
                            <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 16, color: "#c8a86b", fontWeight: 700 }}>{h.name}</div>
                            {h.notes && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 3 }}>{h.notes}</div>}
                          </>
                        )}
                      </div>
                      {!isEditing && (
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10, background: h.active ? "rgba(52,211,153,0.1)" : "#6b728022", color: h.active ? "#34d399" : "rgba(255,255,255,0.45)", border: `1px solid ${h.active ? "#4A643C44" : "#6b728044"}`, padding: "2px 8px", borderRadius: 3 }}>
                            {h.active ? "ACTIVE" : "INACTIVE"}
                          </span>
                          <button onClick={() => setActiveHolder(h.id)} style={{ background: "#c8a86b", color: "#fff", border: "none", padding: "5px 12px", borderRadius: 3, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                            View Details →
                          </button>
                          <button onClick={() => { setEditHolderId(h.id); setEditHolderForm({ name: h.name, notes: h.notes || "" }); }} style={{ background: "transparent", border: "1px solid rgba(200,168,107,0.3)", color: "#c8a86b", padding: "4px 8px", borderRadius: 3, fontSize: 12, cursor: "pointer" }}>Edit</button>
                          {h.active && <button onClick={() => deactivateHolder(h.id)} style={{ background: "transparent", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", padding: "4px 8px", borderRadius: 3, fontSize: 12, cursor: "pointer" }} title="Deactivate">⊗</button>}
                          {!h.active && <button onClick={() => setPettyHolders(pettyHolders.map((x) => x.id === h.id ? { ...x, active: true } : x))} style={{ background: "transparent", border: "1px solid rgba(52,211,153,0.25)", color: "#34d399", padding: "4px 8px", borderRadius: 3, fontSize: 12, cursor: "pointer" }} title="Reactivate">↺</button>}
                          <button onClick={() => deleteHolder(h.id)} style={{ background: "transparent", border: "1px solid #ef444488", color: "#ef444488", padding: "4px 8px", borderRadius: 3, fontSize: 12, cursor: "pointer" }} title="Delete permanently">Del</button>
                        </div>
                      )}
                    </div>

                    {/* Stats row */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, background: "#0c1420", borderRadius: 6, padding: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>TOTAL TOPPED UP</div>
                        <div style={{ fontSize: 15, color: "#60a5fa", fontWeight: 600 }}>{fmt(totalTopup)}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>{topups.length} disbursement{topups.length !== 1 ? "s" : ""}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>REPORTED SPENDING</div>
                        <div style={{ fontSize: 15, color: "#f87171", fontWeight: 600 }}>{fmt(spending)}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>from expense log</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>BALANCE OUTSTANDING</div>
                        <div style={{ fontSize: 15, color: balance > 0 ? "#c8a86b" : "#34d399", fontWeight: 600 }}>{fmt(balance)}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>{balance > 0 ? "still with holder" : "fully accounted"}</div>
                      </div>
                    </div>

                    {/* OPT 3 — Quick Top-Up inline */}
                    {h.active && (
                    <div style={{ borderTop:"1px solid rgba(255,255,255,0.07)", marginTop:10, paddingTop:10 }}>
                      <div style={{ fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.3)", textTransform:"uppercase", letterSpacing:"1px", marginBottom:7 }}>Quick Top-Up</div>
                      <div style={{ display:"flex", gap:6, alignItems:"flex-end" }}>
                        <div style={{ flex:1 }}>
                          <input
                            type="number" placeholder="Amount (Rp)"
                            id={`quick-topup-amt-${h.id}`}
                            style={{ width:"100%", padding:"5px 8px", background:"#0f1c2a", border:"1px solid rgba(255,255,255,0.12)", borderRadius:4, fontSize:11, color:"#e2e8f0", fontFamily:"inherit" }}
                          />
                        </div>
                        <div style={{ flex:1 }}>
                          <input
                            type="text" placeholder="Note (optional)"
                            id={`quick-topup-note-${h.id}`}
                            style={{ width:"100%", padding:"5px 8px", background:"#0f1c2a", border:"1px solid rgba(255,255,255,0.12)", borderRadius:4, fontSize:11, color:"#e2e8f0", fontFamily:"inherit" }}
                          />
                        </div>
                        <button
                          onClick={() => {
                            const amt = Number(document.getElementById(`quick-topup-amt-${h.id}`)?.value);
                            const note = document.getElementById(`quick-topup-note-${h.id}`)?.value || "";
                            if (!amt) return;
                            const newTopup = { id: genId(), holderId: h.id, date: today(), amount: amt, note };
                            setPettyTopups([...pettyTopups, newTopup]);
                            setKas([...kas, { id: genId(), date: today(), description: `Petty cash top-up — ${h.name}${note ? " · "+note : ""}`, amount: amt, type: "out" }]);
                            logActivity("add", "petty topup", `Quick top-up for ${h.name}`);
                            if (document.getElementById(`quick-topup-amt-${h.id}`)) document.getElementById(`quick-topup-amt-${h.id}`).value = "";
                            if (document.getElementById(`quick-topup-note-${h.id}`)) document.getElementById(`quick-topup-note-${h.id}`).value = "";
                            showToast(`Top-up recorded for ${h.name}!`);
                          }}
                          style={{ background:"#c8a86b", border:"none", color:"#fff", padding:"6px 12px", borderRadius:4, fontSize:11, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", fontFamily:"inherit" }}
                        >
                          + Top Up
                        </button>
                      </div>
                    </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── HOLDER DETAIL VIEW ── */}
      {activeHolder && currentHolder && (() => {
        const { topups, totalTopup, spending, balance, holderExpenses } = getHolderStats(currentHolder);

        const filtered = filterMonth
          ? holderExpenses.filter(e => e.date.slice(0, 7) === filterMonth)
          : holderExpenses;

        const driverExp = filtered.filter(e => e.expenseType === "driver").sort((a, b) => a.date.localeCompare(b.date));
        const otherExp  = filtered.filter(e => e.expenseType !== "driver").sort((a, b) => a.date.localeCompare(b.date));
        const driverTotal = driverExp.reduce((s, e) => s + e.amount, 0);
        const otherTotal  = otherExp.reduce((s, e) => s + e.amount, 0);
        const filteredTotal = driverTotal + otherTotal;

        return (
          <div>
            {/* Summary */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 20 }}>
              <div style={{ background: "#162030", border: "1px solid rgba(96,165,250,0.3)", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>TOTAL TOPPED UP</div>
                <div style={{ fontSize: 18, color: "#60a5fa", fontWeight: 600 }}>{fmt(totalTopup)}</div>
              </div>
              <div style={{ background: "#162030", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>REPORTED SPENDING</div>
                <div style={{ fontSize: 18, color: "#f87171", fontWeight: 600 }}>{fmt(spending)}</div>
              </div>
              <div style={{ background: "#162030", border: `1px solid ${balance > 0 ? "#A3915944" : "#4A643C44"}`, borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>BALANCE OUTSTANDING</div>
                <div style={{ fontSize: 18, color: balance > 0 ? "#c8a86b" : "#34d399", fontWeight: 700 }}>{fmt(balance)}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>{balance > 0 ? `${currentHolder.name} still holds this amount` : "Fully accounted ✓"}</div>
              </div>
            </div>

            {/* Top-up history */}
            <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h3 style={{ fontSize: 12, color: "#c8a86b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Top-up History ({topups.length})
                </h3>
              </div>

              {/* Add top-up */}
              <div style={{ background: "#0c1420", borderRadius: 6, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 10 }}>Record a new top-up for {currentHolder.name}</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 2fr auto", gap: 10, alignItems: "end" }}>
                  <div>
                    <label style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 3 }}>DATE</label>
                    <input type="date" value={topupForm.date} onChange={(e) => setTopupForm({ ...topupForm, date: e.target.value, holderId: currentHolder.id })} style={iStyle} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 3 }}>AMOUNT (Rp)</label>
                    <input type="number" placeholder="3000000" value={topupForm.amount} onChange={(e) => setTopupForm({ ...topupForm, amount: e.target.value, holderId: currentHolder.id })} style={iStyle} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 3 }}>NOTE</label>
                    <input placeholder="e.g. Operating cash May (3)" value={topupForm.note} onChange={(e) => setTopupForm({ ...topupForm, note: e.target.value, holderId: currentHolder.id })} style={iStyle} />
                  </div>
                  <button onClick={() => { setTopupForm({ ...topupForm, holderId: currentHolder.id }); addTopup(); }} style={{ background: "#c8a86b", border: "none", color: "#fff", padding: "7px 16px", borderRadius: 4, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>+ Top Up</button>
                </div>
              </div>

              {topups.length === 0 ? (
                <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, padding: "10px 0" }}>No top-ups yet.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 320 }}>
                  <thead>
                    <tr style={{ color: "rgba(255,255,255,0.45)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      {["DATE", "NOTE", "AMOUNT", ""].map((h) => (
                        <th key={h} style={{ textAlign: h === "AMOUNT" ? "right" : "left", padding: "5px 8px" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topups.slice().sort((a, b) => b.date.localeCompare(a.date)).map((t) => {
                      const isEdit = editTopupId === t.id;
                      if (isEdit) return (
                        <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "#1e2d3e" }}>
                          <td style={{ padding: "5px 6px" }}><input type="date" value={editTopupForm.date} onChange={(e) => setEditTopupForm({ ...editTopupForm, date: e.target.value })} style={iStyle} /></td>
                          <td style={{ padding: "5px 6px" }}><input value={editTopupForm.note} onChange={(e) => setEditTopupForm({ ...editTopupForm, note: e.target.value })} style={iStyle} /></td>
                          <td style={{ padding: "5px 6px" }}><input type="number" value={editTopupForm.amount} onChange={(e) => setEditTopupForm({ ...editTopupForm, amount: e.target.value })} style={{ ...iStyle, textAlign: "right" }} /></td>
                          <td style={{ padding: "5px 4px", whiteSpace: "nowrap" }}>
                            <button onClick={saveEditTopup} style={{ background: "#34d399", border: "none", color: "#fff", padding: "3px 8px", borderRadius: 3, fontSize: 11, cursor: "pointer", fontWeight: 600, marginRight: 4 }}>✓</button>
                            <button onClick={() => setEditTopupId(null)} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.45)", padding: "2px 7px", borderRadius: 3, fontSize: 11, cursor: "pointer" }}>✕</button>
                          </td>
                        </tr>
                      );
                      return (
                        <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "7px 8px" }}>{t.date}</td>
                          <td style={{ padding: "7px 8px", color: "rgba(255,255,255,0.45)" }}>{t.note || "—"}</td>
                          <td style={{ padding: "7px 8px", textAlign: "right", color: "#60a5fa", fontWeight: 600 }}>{fmt(t.amount)}</td>
                          <td style={{ padding: "7px 4px", whiteSpace: "nowrap" }}>
                            <button onClick={() => { setEditTopupId(t.id); setEditTopupForm({ date: t.date, amount: t.amount, note: t.note || "" }); }} style={{ background: "transparent", border: "1px solid rgba(200,168,107,0.3)", color: "#c8a86b", fontSize: 11, padding: "2px 7px", borderRadius: 3, marginRight: 4, cursor: "pointer" }}>Edit</button>
                            <button onClick={() => deleteTopup(t.id)} style={{ background: "transparent", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", fontSize: 11, padding: "2px 7px", borderRadius: 3, cursor: "pointer" }}>Del</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "2px solid rgba(255,255,255,0.08)" }}>
                      <td colSpan={2} style={{ padding: "6px 8px", fontSize: 11, color: "rgba(255,255,255,0.45)" }}>Total</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: "#60a5fa", fontWeight: 700 }}>{fmt(totalTopup)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
                </div>
              )}
            </div>

            {/* Reported spending — split by type with month filter */}
            <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20 }}>
              {/* Header + filter */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                <h3 style={{ fontSize: 12, color: "#c8a86b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Reported Spending ({holderExpenses.length} entries total)
                </h3>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>Filter by month:</label>
                  <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
                    style={{ fontSize: 12, padding: "4px 8px", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, background: "#1e2d3e", color: "#e2e8f0", fontFamily: "inherit" }} />
                  {filterMonth && <button onClick={() => setFilterMonth("")} style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 3, padding: "3px 8px", cursor: "pointer" }}>Clear</button>}
                </div>
              </div>

              {holderExpenses.length === 0 ? (
                <div style={{ background: "#0c1420", borderRadius: 6, padding: 16, fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.7 }}>
                  <div style={{ marginBottom: 6 }}>No spending reported yet for {currentHolder.name}.</div>
                  <div>Spending is recorded when you import a monthly CSV or manually add an expense tagged to this holder.</div>
                </div>
              ) : (
                <>
                  {filtered.length === 0 && (
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", padding: "10px 0" }}>No entries for this month.</div>
                  )}

                  {/* Section 1 — Trip Driver Costs */}
                  {driverExp.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, paddingBottom: 4, borderBottom: "2px solid rgba(255,255,255,0.06)" }}>
                        Trip Driver Costs — Allowances &amp; Misc
                      </div>
                      <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 320 }}>
                        <thead>
                          <tr style={{ color: "rgba(255,255,255,0.45)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                            {["DATE", "DESCRIPTION", "TRUCK", "AMOUNT"].map(h => (
                              <th key={h} style={{ textAlign: h === "AMOUNT" ? "right" : "left", padding: "5px 8px" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {driverExp.map(e => (
                            <tr key={e.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                              <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{e.date}</td>
                              <td style={{ padding: "6px 8px" }}>{e.description}</td>
                              <td style={{ padding: "6px 8px", color: "#c8a86b", fontSize: 11 }}>{e.truck || "—"}</td>
                              <td style={{ padding: "6px 8px", textAlign: "right", color: "#f87171" }}>{fmt(e.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)", background: "#1e2d3e" }}>
                            <td colSpan={3} style={{ padding: "5px 8px", fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 600 }}>Subtotal — Trip Costs</td>
                            <td style={{ padding: "5px 8px", textAlign: "right", color: "#f87171", fontWeight: 700 }}>{fmt(driverTotal)}</td>
                          </tr>
                        </tfoot>
                      </table>
                      </div>
                    </div>
                  )}

                  {/* Section 2 — Pengeluaran Tambahan */}
                  {otherExp.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#c8a86b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, paddingBottom: 4, borderBottom: "2px solid #A3915922" }}>
                        Additional Expenses — Operational &amp; Misc
                      </div>
                      <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 320 }}>
                        <thead>
                          <tr style={{ color: "rgba(255,255,255,0.45)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                            {["DATE", "DESCRIPTION", "CATEGORY", "AMOUNT"].map(h => (
                              <th key={h} style={{ textAlign: h === "AMOUNT" ? "right" : "left", padding: "5px 8px" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {otherExp.map(e => (
                            <tr key={e.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                              <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{e.date}</td>
                              <td style={{ padding: "6px 8px" }}>{e.description}</td>
                              <td style={{ padding: "6px 8px" }}>
                                <span style={{ background: (CAT_COLOR[e.category] || "#6b7280") + "22", color: CAT_COLOR[e.category] || "rgba(255,255,255,0.45)", border: `1px solid ${(CAT_COLOR[e.category] || "#6b7280")}44`, fontSize: 10, padding: "2px 6px", borderRadius: 3 }}>
                                  {e.category}
                                </span>
                              </td>
                              <td style={{ padding: "6px 8px", textAlign: "right", color: "#f87171" }}>{fmt(e.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)", background: "#1e2d3e" }}>
                            <td colSpan={3} style={{ padding: "5px 8px", fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 600 }}>Subtotal — Pengeluaran Tambahan</td>
                            <td style={{ padding: "5px 8px", textAlign: "right", color: "#f87171", fontWeight: 700 }}>{fmt(otherTotal)}</td>
                          </tr>
                        </tfoot>
                      </table>
                      </div>
                    </div>
                  )}

                  {/* Grand total */}
                  {filtered.length > 0 && (
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <div style={{ background: "#0d1e30", borderRadius: 6, padding: "10px 20px", display: "flex", gap: 32, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 1 }}>
                          {filterMonth ? `Total ${filterMonth}` : "Grand Total"}
                        </span>
                        <span style={{ fontSize: 16, color: "#f87171", fontWeight: 700 }}>{fmt(filteredTotal)}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── FLEET ─────────────────────────────────────────────────────────────────────
function Fleet({ loans, setLoans, assets, setAssets, loanPayments, setLoanPayments, capital, setCapital, totalCapitalInjected, kas, setKas, showToast, confirmModal, setConfirmModal, guardedDelete, logActivity }) {
  const isMobile = useIsMobile();
  const [editLoanId, setEditLoanId] = useState(null);
  const [editLoanForm, setEditLoanForm] = useState({});
  const [editPayId, setEditPayId] = useState(null);
  const [editPayForm, setEditPayForm] = useState({});
  const [addPayLoanId, setAddPayLoanId] = useState(null);
  const [newPay, setNewPay] = useState({ date: today(), amount: "", note: "" });
  const [linkMode, setLinkMode] = useState(false);
  const [linkedKasId, setLinkedKasId] = useState("");
  const [addingTruck, setAddingTruck] = useState(false);
  const [newTruckForm, setNewTruckForm] = useState({ name: "", nopol: "", purchaseDate: today(), vehicleValue: "", monthlyPayment: "", termMonths: 36, startDate: today(), lender: "", notes: "" });

  // Capital section state
  const [activeSection, setActiveSection] = useState("fleet"); // "fleet" | "capital"
  const [capForm, setCapForm] = useState({ date: today(), source: "", description: "", amount: "", type: "capital" });
  const [editCapId, setEditCapId] = useState(null);
  const [editCapForm, setEditCapForm] = useState({});

  const addCapital = () => {
    if (!capForm.source || !capForm.amount) { showToast("Fill in Source and Amount", "error"); return; }
    setCapital([...capital, { ...capForm, id: genId(), amount: Number(capForm.amount) }]);
    logActivity("add", capForm.type === "capital" ? "capital" : "loan", `${capForm.type === "capital" ? "Capital" : "Loan"} from ${capForm.source}`);
    setCapForm({ date: today(), source: "", description: "", amount: "", type: "capital" });
    showToast(capForm.type === "capital" ? "Capital injection recorded!" : "Loan recorded!");
  };

  const deleteCapital = (id) => {
    const entry = capital.find((c) => c.id === id);
    if (entry?.loanId) { showToast("Linked to a loan — remove via Fleet section", "error"); return; }
    guardedDelete(`Delete capital entry from ${entry?.source || "unknown"}?`, () => {
      setCapital(capital.filter((c) => c.id !== id));
      logActivity("delete", "capital", `Capital entry from ${entry?.source || ""} deleted`);
      showToast("Entry removed");
    });
  };

  const saveEditCap = () => {
    setCapital(capital.map((c) => c.id === editCapId ? {
      ...c,
      date: editCapForm.date,
      source: editCapForm.source,
      description: editCapForm.description,
      amount: Number(editCapForm.amount) || 0,
      type: editCapForm.type,
    } : c));
    setEditCapId(null);
    showToast("Entry updated!");
  };

  const getLoanStats = (loan) => {
    const payments = loanPayments.filter((p) => p.loanId === loan.id).sort((a, b) => a.date.localeCompare(b.date));
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    const dpPaid = loan.principal - (loan.vehicleValue || loan.principal);
    const financedAmount = loan.vehicleValue || loan.principal;
    const remaining = Math.max(0, financedAmount - totalPaid);
    const pct = financedAmount > 0 ? Math.min(100, (totalPaid / financedAmount) * 100) : 0;
    const monthsPaid = payments.length;
    const monthsLeft = Math.max(0, (loan.termMonths || 0) - monthsPaid);
    return { payments, totalPaid, remaining, pct, monthsPaid, monthsLeft, financedAmount };
  };

  const startEditLoan = (loan) => {
    setEditLoanId(loan.id);
    setEditLoanForm({ ...loan });
  };
  const cancelEditLoan = () => { setEditLoanId(null); setEditLoanForm({}); };
  const saveEditLoan = () => {
    setLoans(loans.map((l) => l.id === editLoanId ? {
      ...l,
      lender: editLoanForm.lender,
      purpose: editLoanForm.purpose,
      vehicleValue: Number(editLoanForm.vehicleValue) || 0,
      principal: Number(editLoanForm.vehicleValue) || Number(editLoanForm.principal) || 0,
      monthlyPayment: Number(editLoanForm.monthlyPayment) || 0,
      startDate: editLoanForm.startDate,
      termMonths: Number(editLoanForm.termMonths) || 0,
      notes: editLoanForm.notes,
    } : l));
    setEditLoanId(null);
    showToast("Contract updated!");
  };

  const startEditPay = (pay) => { setEditPayId(pay.id); setEditPayForm({ ...pay }); };
  const cancelEditPay = () => { setEditPayId(null); setEditPayForm({}); };
  const saveEditPay = () => {
    const payment = loanPayments.find((p) => p.id === editPayId);
    setLoanPayments(loanPayments.map((p) => p.id === editPayId ? { ...p, date: editPayForm.date, amount: Number(editPayForm.amount) || 0, note: editPayForm.note } : p));
    if (payment?.kasId) setKas(kas.map((k) => k.id === payment.kasId ? { ...k, date: editPayForm.date, amount: Number(editPayForm.amount) || 0 } : k));
    setEditPayId(null);
    showToast("Payment updated!");
  };
  const deletePay = (payId, loanId) => {
    const payment = loanPayments.find((p) => p.id === payId);
    const loan = loans.find((l) => l.id === loanId);
    guardedDelete(`Delete loan payment of ${payment ? fmt(payment.amount) : ""} for ${loan?.lender || "loan"}?`, () => {
      setLoanPayments(loanPayments.filter((p) => p.id !== payId));
      if (payment?.kasId) setKas(kas.filter((k) => k.id !== payment.kasId));
      logActivity("delete", "loan payment", `Payment for ${loan?.lender || "loan"} deleted`);
      showToast("Payment removed");
    });
  };

  const addPayment = (loanId) => {
    if (linkMode) {
      if (!linkedKasId) { showToast("Select a Cash entry to link", "error"); return; }
      const kasEntry = kas.find((k) => k.id === linkedKasId);
      setLoanPayments([...loanPayments, { id: genId(), loanId, date: kasEntry.date, amount: kasEntry.amount, note: newPay.note, kasId: linkedKasId }]);
      setNewPay({ date: today(), amount: "", note: "" });
      setLinkMode(false);
      setLinkedKasId("");
      setAddPayLoanId(null);
      showToast("Payment linked!");
      return;
    }
    if (!newPay.amount) { showToast("Enter an amount", "error"); return; }
    const loan = loans.find((l) => l.id === loanId);
    const kasId = genId();
    setLoanPayments([...loanPayments, { id: genId(), loanId, date: newPay.date, amount: Number(newPay.amount), note: newPay.note, kasId }]);
    setKas([...kas, { id: kasId, date: newPay.date, description: `Loan payment — ${loan?.lender || "loan"}${newPay.note ? " · " + newPay.note : ""}`, amount: Number(newPay.amount), type: "out" }]);
    logActivity("add", "loan payment", `Payment for ${loan?.lender || "loan"}`);
    setNewPay({ date: today(), amount: "", note: "" });
    setAddPayLoanId(null);
    showToast("Payment recorded!");
  };

  const addTruck = () => {
    if (!newTruckForm.nopol || !newTruckForm.vehicleValue) { showToast("Plate number and vehicle value required", "error"); return; }
    const assetId = genId();
    const loanId = genId();
    setAssets([...assets, {
      id: assetId, name: newTruckForm.name || `Truck ${newTruckForm.nopol}`,
      assetType: "Truck", nopol: newTruckForm.nopol, purchaseDate: newTruckForm.purchaseDate,
      purchasePrice: Number(newTruckForm.vehicleValue), financedBy: loanId, status: "active",
      notes: newTruckForm.notes,
    }]);
    setLoans([...loans, {
      id: loanId, lender: newTruckForm.lender, purpose: `Truck ${newTruckForm.nopol}`,
      truckId: assetId, vehicleValue: Number(newTruckForm.vehicleValue),
      principal: Number(newTruckForm.vehicleValue),
      monthlyPayment: Number(newTruckForm.monthlyPayment) || 0,
      startDate: newTruckForm.startDate, termMonths: Number(newTruckForm.termMonths) || 36,
      notes: newTruckForm.notes,
    }]);
    logActivity("add", "truck", `Truck ${newTruckForm.nopol} added`);
    setNewTruckForm({ name: "", nopol: "", purchaseDate: today(), vehicleValue: "", monthlyPayment: "", termMonths: 36, startDate: today(), lender: "", notes: "" });
    setAddingTruck(false);
    showToast("Truck & contract added!");
  };

  const inputStyle = { background: "#1e2d3e", border: "1px solid rgba(255,255,255,0.08)", color: "#e2e8f0", padding: "7px 10px", borderRadius: 4, fontFamily: "inherit", fontSize: 12, width: "100%", outline: "none" };
  const editInputStyle = { background: "#1e2d3e", border: "1px solid rgba(200,168,107,0.4)", color: "#e2e8f0", padding: "5px 8px", borderRadius: 3, fontFamily: "inherit", fontSize: 11, width: "100%" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 20, color: "#e2e8f0", letterSpacing: 0.3, fontWeight: 700 }}>CAPITAL & FLEET</h2>
        {activeSection === "fleet" && (
          <button onClick={() => setAddingTruck(!addingTruck)} style={{ background: addingTruck ? "rgba(255,255,255,0.25)" : "#c8a86b", color: addingTruck ? "rgba(255,255,255,0.45)" : "#162030", border: "none", padding: "9px 18px", borderRadius: 4, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            {addingTruck ? "✕ Cancel" : "+ Add Truck"}
          </button>
        )}
      </div>

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        {[
          { key: "fleet", label: "Fleet & Loans", sub: `${loans.length} truck${loans.length !== 1 ? "s" : ""}` },
          { key: "capital", label: "Capital Injections", sub: `${capital.length} entr${capital.length !== 1 ? "ies" : "y"}` },
        ].map((s) => (
          <button key={s.key} onClick={() => setActiveSection(s.key)} style={{
            background: "transparent", border: "none", borderBottom: activeSection === s.key ? "2px solid #c8a86b" : "2px solid transparent",
            color: activeSection === s.key ? "#c8a86b" : "rgba(255,255,255,0.45)", padding: "10px 20px", fontSize: 13, fontWeight: 600,
            cursor: "pointer", marginBottom: -1, fontFamily: "inherit",
          }}>
            {s.label} <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginLeft: 6 }}>({s.sub})</span>
          </button>
        ))}
      </div>

      {activeSection === "capital" && (
        <div>
          {/* Capital summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 20 }}>
            <div style={{ background: "#162030", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>TOTAL OWNER CAPITAL</div>
              <div style={{ fontSize: 18, color: "#34d399", fontWeight: 600 }}>{fmt(capital.filter((c) => c.type === "capital").reduce((s, c) => s + c.amount, 0))}</div>
            </div>
            <div style={{ background: "#162030", border: "1px solid rgba(96,165,250,0.3)", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>OTHER LOANS RECEIVED</div>
              <div style={{ fontSize: 18, color: "#60a5fa", fontWeight: 600 }}>{fmt(capital.filter((c) => c.type === "loan").reduce((s, c) => s + c.amount, 0))}</div>
            </div>
            <div style={{ background: "#162030", border: "1px solid rgba(200,168,107,0.3)", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>TOTAL INJECTED</div>
              <div style={{ fontSize: 18, color: "#c8a86b", fontWeight: 600 }}>{fmt(totalCapitalInjected)}</div>
            </div>
          </div>

          {/* Add capital form */}
          <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20, marginBottom: 20 }}>
            <h3 style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Add Capital Entry</h3>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button onClick={() => setCapForm({ ...capForm, type: "capital" })} style={{ background: capForm.type === "capital" ? "#34d399" : "#1e2d3e", color: capForm.type === "capital" ? "#fff" : "rgba(255,255,255,0.45)", border: `1px solid ${capForm.type === "capital" ? "#34d399" : "rgba(255,255,255,0.12)"}`, padding: "7px 16px", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                💰 Owner Capital (Modal Sendiri)
              </button>
              <button onClick={() => setCapForm({ ...capForm, type: "loan" })} style={{ background: capForm.type === "loan" ? "#60a5fa" : "#1e2d3e", color: capForm.type === "loan" ? "#fff" : "rgba(255,255,255,0.45)", border: `1px solid ${capForm.type === "loan" ? "#60a5fa" : "rgba(255,255,255,0.12)"}`, padding: "7px 16px", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                🏦 Loan / Other Financing
              </button>
            </div>
            <div style={{ background: "#0c1420", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 4, padding: 10, fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 14 }}>
              {capForm.type === "capital" ? "Money you or other owners put into the business. Does not need to be repaid." : "Money from a bank or lender (not a truck installment). For truck loans, use the Fleet tab."}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>DATE</label><input type="date" value={capForm.date} onChange={(e) => setCapForm({ ...capForm, date: e.target.value })} /></div>
              <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>{capForm.type === "capital" ? "FROM (OWNER NAME) *" : "LENDER *"}</label><input placeholder={capForm.type === "capital" ? "e.g. Sintawati" : "e.g. Bank BCA"} value={capForm.source} onChange={(e) => setCapForm({ ...capForm, source: e.target.value })} /></div>
              <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>DESCRIPTION</label><input placeholder="e.g. Initial capital, working capital" value={capForm.description} onChange={(e) => setCapForm({ ...capForm, description: e.target.value })} /></div>
              <div><label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>AMOUNT (Rp) *</label><input type="number" placeholder="500000000" value={capForm.amount} onChange={(e) => setCapForm({ ...capForm, amount: e.target.value })} /></div>
            </div>
            <button onClick={addCapital} style={{ marginTop: 14, background: "#c8a86b", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 4, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              + Record {capForm.type === "capital" ? "Capital" : "Loan"}
            </button>
          </div>

          {/* Capital table */}
          <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20 }}>
            <h3 style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>All Capital & Financing Entries ({capital.length})</h3>
            {capital.length === 0 ? (
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, textAlign: "center", padding: 30 }}>No entries yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 480 }}>
                <thead>
                  <tr style={{ color: "rgba(255,255,255,0.45)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    {["DATE", "TYPE", "FROM / LENDER", "DESCRIPTION", "AMOUNT", ""].map((h) => (
                      <th key={h} style={{ textAlign: h === "AMOUNT" ? "right" : "left", padding: "6px 8px" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...capital].sort((a, b) => a.date.localeCompare(b.date)).map((c) => {
                    const isEditing = editCapId === c.id;
                    const iStyle = { background: "#1e2d3e", border: "1px solid rgba(200,168,107,0.4)", color: "#e2e8f0", padding: "4px 6px", borderRadius: 3, fontSize: 11, fontFamily: "inherit", width: "100%" };
                    if (isEditing) return (
                      <tr key={c.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "#1e2d3e" }}>
                        <td style={{ padding: "5px 6px" }}><input type="date" value={editCapForm.date} onChange={(e) => setEditCapForm({ ...editCapForm, date: e.target.value })} style={iStyle} /></td>
                        <td style={{ padding: "5px 6px" }}>
                          <select value={editCapForm.type} onChange={(e) => setEditCapForm({ ...editCapForm, type: e.target.value })} style={iStyle}>
                            <option value="capital">💰 Capital</option>
                            <option value="loan">🏦 Loan</option>
                          </select>
                        </td>
                        <td style={{ padding: "5px 6px" }}><input value={editCapForm.source} onChange={(e) => setEditCapForm({ ...editCapForm, source: e.target.value })} style={iStyle} /></td>
                        <td style={{ padding: "5px 6px" }}><input value={editCapForm.description} onChange={(e) => setEditCapForm({ ...editCapForm, description: e.target.value })} style={iStyle} /></td>
                        <td style={{ padding: "5px 6px" }}><input type="number" value={editCapForm.amount} onChange={(e) => setEditCapForm({ ...editCapForm, amount: e.target.value })} style={{ ...iStyle, textAlign: "right" }} /></td>
                        <td style={{ padding: "5px 4px", whiteSpace: "nowrap" }}>
                          <button onClick={saveEditCap} style={{ background: "#34d399", border: "none", color: "#fff", fontSize: 11, padding: "4px 8px", borderRadius: 3, marginRight: 4, cursor: "pointer", fontWeight: 600 }}>✓</button>
                          <button onClick={() => setEditCapId(null)} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.45)", fontSize: 11, padding: "3px 8px", borderRadius: 3, cursor: "pointer" }}>✕</button>
                        </td>
                      </tr>
                    );
                    return (
                      <tr key={c.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <td style={{ padding: "8px 8px" }}>{c.date}</td>
                        <td style={{ padding: "8px 8px" }}>
                          <span className="tag" style={{ background: c.type === "capital" ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.06)", color: c.type === "capital" ? "#34d399" : "#0d1e30", border: `1px solid ${c.type === "capital" ? "#4A643C44" : "#1B3F6044"}` }}>
                            {c.type === "capital" ? "Capital" : "Loan"}
                          </span>
                        </td>
                        <td style={{ padding: "8px 8px", color: "#c8a86b" }}>{c.source}</td>
                        <td style={{ padding: "8px 8px", color: "rgba(255,255,255,0.45)" }}>{c.description}</td>
                        <td style={{ padding: "8px 8px", textAlign: "right", color: c.type === "capital" ? "#34d399" : "#60a5fa", fontWeight: 600 }}>{fmt(c.amount)}</td>
                        <td style={{ padding: "8px 4px", whiteSpace: "nowrap" }}>
                          <button onClick={() => { setEditCapId(c.id); setEditCapForm({ ...c }); }} style={{ background: "transparent", border: "1px solid rgba(200,168,107,0.3)", color: "#c8a86b", fontSize: 11, padding: "3px 8px", borderRadius: 3, marginRight: 4, cursor: "pointer" }}>Edit</button>
                          <button onClick={() => deleteCapital(c.id)} style={{ background: "transparent", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", fontSize: 11, padding: "3px 8px", borderRadius: 3, cursor: "pointer" }}>Del</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid rgba(255,255,255,0.08)" }}>
                    <td colSpan={4} style={{ padding: "8px 8px", fontSize: 12, color: "rgba(255,255,255,0.45)" }}>Total</td>
                    <td style={{ padding: "8px 8px", textAlign: "right", color: "#c8a86b", fontWeight: 700, fontSize: 13 }}>{fmt(capital.reduce((s, c) => s + c.amount, 0))}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeSection === "fleet" && (
      <div>

      {/* Add New Truck Form */}
      {addingTruck && (
        <div style={{ background: "#162030", border: "1px solid rgba(200,168,107,0.3)", borderRadius: 8, padding: 20, marginBottom: 24 }}>
          <h3 style={{ fontSize: 12, color: "#c8a86b", marginBottom: 14, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>New Truck & Contract</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {[
              ["PLATE NUMBER *", "nopol", "text", "e.g. B9674UEJ"],
              ["TRUCK NAME", "name", "text", "e.g. Hino 500 2023"],
              ["VEHICLE VALUE (Rp) *", "vehicleValue", "number", "e.g. 390000000"],
              ["MONTHLY PAYMENT (Rp)", "monthlyPayment", "number", "e.g. 10877000"],
              ["TERM (MONTHS)", "termMonths", "number", "36"],
              ["CONTRACT START", "startDate", "date", ""],
              ["PURCHASE DATE", "purchaseDate", "date", ""],
              ["LENDER / DEALER", "lender", "text", "e.g. Arthadina Langgeng"],
            ].map(([label, key, type, ph]) => (
              <div key={key}>
                <label style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>{label}</label>
                <input type={type} placeholder={ph} value={newTruckForm[key]} onChange={(e) => setNewTruckForm({ ...newTruckForm, [key]: e.target.value })} style={inputStyle} />
              </div>
            ))}
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>NOTES</label>
              <input placeholder="Any additional notes about this truck or contract" value={newTruckForm.notes} onChange={(e) => setNewTruckForm({ ...newTruckForm, notes: e.target.value })} style={inputStyle} />
            </div>
          </div>
          <button onClick={addTruck} style={{ marginTop: 14, background: "#c8a86b", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 4, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            + Add Truck & Contract
          </button>
        </div>
      )}

      {/* Fleet Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>TOTAL TRUCKS</div>
          <div style={{ fontSize: 18, color: "#c8a86b", fontWeight: 700 }}>{loans.length}</div>
        </div>
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>TOTAL FLEET VALUE</div>
          <div style={{ fontSize: 16, color: "#34d399" }}>{fmt(loans.reduce((s, l) => s + (l.vehicleValue || 0), 0))}</div>
        </div>
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>TOTAL PAID SO FAR</div>
          <div style={{ fontSize: 16, color: "#60a5fa" }}>{fmt(loanPayments.reduce((s, p) => s + p.amount, 0))}</div>
        </div>
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>MONTHLY OBLIGATIONS</div>
          <div style={{ fontSize: 16, color: "#ec4899" }}>{fmt(loans.reduce((s, l) => s + (l.monthlyPayment || 0), 0))}</div>
        </div>
        <div style={{ background: "#162030", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>REMAINING BALANCE</div>
          <div style={{ fontSize: 16, color: "#f87171" }}>{fmt(loans.reduce((s, l) => {
            const paid = loanPayments.filter((p) => p.loanId === l.id).reduce((a, p) => a + p.amount, 0);
            return s + Math.max(0, (l.vehicleValue || l.principal) - paid);
          }, 0))}</div>
        </div>
      </div>

      {/* Truck Cards */}
      {loans.map((loan) => {
        const stats = getLoanStats(loan);
        const asset = assets.find((a) => a.id === loan.truckId || a.financedBy === loan.id);
        const isEditingContract = editLoanId === loan.id;

        return (
          <div key={loan.id} style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 24, marginBottom: 20 }}>
            {/* Truck Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 18 }}>
              <div>
                <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 18, color: "#c8a86b", fontWeight: 700 }}>{loan.purpose || asset?.name || "Truck"}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>Lender: <span style={{ color: "rgba(255,255,255,0.45)" }}>{loan.lender || "—"}</span></div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ background: "rgba(52,211,153,0.1)", color: "#34d399", border: "1px solid rgba(52,211,153,0.25)", padding: "3px 10px", borderRadius: 3, fontSize: 11, fontWeight: 600 }}>
                  ACTIVE
                </span>
                {!isEditingContract && (
                  <button onClick={() => startEditLoan(loan)} style={{ background: "transparent", border: "1px solid rgba(200,168,107,0.3)", color: "#c8a86b", fontSize: 11, padding: "4px 10px", borderRadius: 3, cursor: "pointer" }}>
                    Edit Contract
                  </button>
                )}
              </div>
            </div>

            {/* Contract Details — view or edit mode */}
            {isEditingContract ? (
              <div style={{ background: "#1e2d3e", border: "1px solid rgba(200,168,107,0.3)", borderRadius: 6, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: "#c8a86b", marginBottom: 12, fontWeight: 600 }}>Editing Contract</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                  {[
                    ["Purpose / Name", "purpose"], ["Lender", "lender"], ["Vehicle Value (Rp)", "vehicleValue"],
                    ["Monthly Payment (Rp)", "monthlyPayment"], ["Term (Months)", "termMonths"], ["Start Date", "startDate"],
                  ].map(([label, key]) => (
                    <div key={key}>
                      <label style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 3 }}>{label}</label>
                      <input
                        type={["vehicleValue","monthlyPayment","termMonths"].includes(key) ? "number" : key === "startDate" ? "date" : "text"}
                        value={editLoanForm[key] || ""}
                        onChange={(e) => setEditLoanForm({ ...editLoanForm, [key]: e.target.value })}
                        style={editInputStyle}
                      />
                    </div>
                  ))}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 3 }}>Notes</label>
                    <input value={editLoanForm.notes || ""} onChange={(e) => setEditLoanForm({ ...editLoanForm, notes: e.target.value })} style={editInputStyle} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button onClick={saveEditLoan} style={{ background: "#34d399", border: "none", color: "#fff", padding: "8px 18px", borderRadius: 4, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>✓ Save Contract</button>
                  <button onClick={cancelEditLoan} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.45)", padding: "7px 16px", borderRadius: 4, fontSize: 12, cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14, marginBottom: 16, background: "#0c1420", borderRadius: 6, padding: 14 }}>
                {[
                  ["Vehicle Value", fmt(loan.vehicleValue || loan.principal)],
                  ["Monthly Payment", fmt(loan.monthlyPayment)],
                  ["Term", `${loan.termMonths} months`],
                  ["Start Date", loan.startDate],
                  ["Months Paid", `${stats.monthsPaid} / ${loan.termMonths}`],
                  ["Months Left", `${stats.monthsLeft}`],
                  ["Total Paid", fmt(stats.totalPaid)],
                  ["Remaining", fmt(stats.remaining)],
                ].map(([label, val]) => (
                  <div key={label}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 13, color: label === "Remaining" ? "#f87171" : label === "Total Paid" ? "#34d399" : "#e2e8f0" }}>{val}</div>
                  </div>
                ))}
                {loan.notes && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 3 }}>NOTES</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{loan.notes}</div>
                  </div>
                )}
              </div>
            )}

            {/* Progress Bar */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>
                <span style={{ color: "#34d399" }}>{stats.pct.toFixed(1)}% paid</span>
                <span>{fmt(stats.totalPaid)} / {fmt(loan.vehicleValue || loan.principal)}</span>
              </div>
              <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 4, height: 10, overflow: "hidden" }}>
                <div style={{ width: `${stats.pct}%`, background: stats.pct >= 100 ? "#34d399" : "#c8a86b", height: 10, borderRadius: 4, transition: "width .5s" }} />
              </div>
            </div>

            {/* Payment History */}
            <div style={{ background: "#0c1420", borderRadius: 6, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#c8a86b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Payment History ({stats.payments.length})
                </div>
                <button
                  onClick={() => { setAddPayLoanId(addPayLoanId === loan.id ? null : loan.id); setNewPay({ date: today(), amount: String(loan.monthlyPayment || ""), note: "" }); }}
                  style={{ background: "#c8a86b", color: "#fff", border: "none", padding: "5px 12px", borderRadius: 3, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                >
                  + Add Payment
                </button>
              </div>

              {/* Add payment inline form */}
              {addPayLoanId === loan.id && (
                <div style={{ background: "#162030", border: "1px solid rgba(200,168,107,0.2)", borderRadius: 4, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 2fr auto", gap: 8, alignItems: "end" }}>
                    <div>
                      <label style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 3 }}>DATE</label>
                      <input type="date" value={newPay.date} onChange={(e) => setNewPay({ ...newPay, date: e.target.value })} style={editInputStyle} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 3 }}>AMOUNT (Rp)</label>
                      <input type="number" value={newPay.amount} onChange={(e) => setNewPay({ ...newPay, amount: e.target.value })} style={editInputStyle} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 3 }}>NOTE</label>
                      <input placeholder="e.g. Installment #2" value={newPay.note} onChange={(e) => setNewPay({ ...newPay, note: e.target.value })} style={editInputStyle} />
                    </div>
                    <button onClick={() => addPayment(loan.id)} style={{ background: "#34d399", border: "none", color: "#fff", padding: "6px 14px", borderRadius: 3, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>✓</button>
                  </div>
                </div>
              )}

              {stats.payments.length === 0 ? (
                <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, padding: "10px 0" }}>No payments recorded yet.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 360 }}>
                  <thead>
                    <tr style={{ color: "rgba(255,255,255,0.25)" }}>
                      <th style={{ textAlign: "left", padding: "5px 6px" }}>#</th>
                      <th style={{ textAlign: "left", padding: "5px 6px" }}>DATE</th>
                      <th style={{ textAlign: "left", padding: "5px 6px" }}>NOTE</th>
                      <th style={{ textAlign: "right", padding: "5px 6px" }}>AMOUNT</th>
                      <th style={{ padding: "5px 6px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.payments.map((p, idx) => {
                      const isEditingPay = editPayId === p.id;
                      if (isEditingPay) return (
                        <tr key={p.id} style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: "#1e2d3e" }}>
                          <td style={{ padding: "5px 6px", color: "rgba(255,255,255,0.45)" }}>{idx + 1}</td>
                          <td style={{ padding: "5px 6px" }}><input type="date" value={editPayForm.date} onChange={(e) => setEditPayForm({ ...editPayForm, date: e.target.value })} style={{ ...editInputStyle, width: 130 }} /></td>
                          <td style={{ padding: "5px 6px" }}><input value={editPayForm.note} onChange={(e) => setEditPayForm({ ...editPayForm, note: e.target.value })} style={editInputStyle} /></td>
                          <td style={{ padding: "5px 6px" }}><input type="number" value={editPayForm.amount} onChange={(e) => setEditPayForm({ ...editPayForm, amount: e.target.value })} style={{ ...editInputStyle, textAlign: "right", width: 120 }} /></td>
                          <td style={{ padding: "5px 6px", whiteSpace: "nowrap" }}>
                            <button onClick={saveEditPay} style={{ background: "#34d399", border: "none", color: "#fff", padding: "3px 8px", borderRadius: 3, fontSize: 11, cursor: "pointer", marginRight: 4 }}>✓</button>
                            <button onClick={cancelEditPay} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.45)", padding: "2px 7px", borderRadius: 3, fontSize: 11, cursor: "pointer" }}>✕</button>
                          </td>
                        </tr>
                      );
                      return (
                        <tr key={p.id} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "6px 6px", color: "rgba(255,255,255,0.45)" }}>{idx + 1}</td>
                          <td style={{ padding: "6px 6px" }}>{p.date}</td>
                          <td style={{ padding: "6px 6px", color: "rgba(255,255,255,0.45)" }}>{p.note || "—"}</td>
                          <td style={{ padding: "6px 6px", textAlign: "right", color: "#34d399", fontWeight: 600 }}>{fmt(p.amount)}</td>
                          <td style={{ padding: "6px 6px", whiteSpace: "nowrap" }}>
                            <button onClick={() => startEditPay(p)} style={{ background: "transparent", border: "1px solid rgba(200,168,107,0.3)", color: "#c8a86b", fontSize: 11, padding: "2px 7px", borderRadius: 3, marginRight: 4, cursor: "pointer" }}>Edit</button>
                            <button onClick={() => deletePay(p.id, loan.id)} style={{ background: "transparent", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", fontSize: 11, padding: "2px 7px", borderRadius: 3, cursor: "pointer" }}>Del</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "2px solid rgba(255,255,255,0.08)" }}>
                      <td colSpan={3} style={{ padding: "6px 6px", fontSize: 11, color: "rgba(255,255,255,0.45)" }}>Total paid</td>
                      <td style={{ padding: "6px 6px", textAlign: "right", color: "#34d399", fontWeight: 700 }}>{fmt(stats.totalPaid)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {loans.length === 0 && (
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 40, textAlign: "center", color: "rgba(255,255,255,0.45)" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🚚</div>
          <div style={{ fontSize: 14, marginBottom: 8 }}>No trucks added yet</div>
          <div style={{ fontSize: 12 }}>Click "+ Add Truck" to register your first truck and contract</div>
        </div>
      )}
      </div>
      )}
    </div>
  );
}


// ── BUSINESS METRICS ──────────────────────────────────────────────────────────
function BusinessMetrics({ trips, expenses, kas, loans, loanPayments, assets, capital,
  fTotalRevenue, fGrossProfit, fNetProfit, fTripCosts, fTruckOpsExpenses, fOverheadExpenses,
  fKasBalance, totalAssetsValue, totalLoanPrincipalRemaining, totalCapitalInjected, periodLabel }) {

  const isMobile = useIsMobile();
  const [chartGranularity, setChartGranularity] = useState("monthly"); // weekly | monthly | quarterly | yearly
  const [activeMetrics, setActiveMetrics] = useState(["gpPct", "netPct", "debtToAsset"]);
  const [activeAbsMetrics, setActiveAbsMetrics] = useState(["netRevenue", "grossProfitAbs"]);

  // ── Cumulative balance sheet figures (always all-time) ────────────────────
  const totalDebt = totalLoanPrincipalRemaining;
  const totalAssets = totalAssetsValue + Math.max(0, fKasBalance);
  const totalEquity = totalCapitalInjected - totalDebt;

  // ── Ratio computations (for selected period) ──────────────────────────────
  const gpPct       = fTotalRevenue > 0 ? (fGrossProfit / fTotalRevenue) * 100 : null;
  const netPct      = fTotalRevenue > 0 ? (fNetProfit / fTotalRevenue) * 100 : null;
  const opPct       = fTotalRevenue > 0 ? ((fGrossProfit - fTruckOpsExpenses) / fTotalRevenue) * 100 : null;
  const cogs_pct    = fTotalRevenue > 0 ? (fTripCosts / fTotalRevenue) * 100 : null;
  const opex_pct    = fTotalRevenue > 0 ? ((fTruckOpsExpenses + fOverheadExpenses) / fTotalRevenue) * 100 : null;
  const debtToAsset = totalAssets > 0 ? (totalDebt / totalAssets) * 100 : null;
  const debtToEquity = totalEquity !== 0 ? (totalDebt / Math.abs(totalEquity)) * 100 : null;
  const currentRatio = fTruckOpsExpenses + fOverheadExpenses > 0
    ? fKasBalance / (fTruckOpsExpenses + fOverheadExpenses) : null;
  const revenuePerTrip = trips.length > 0 ? fTotalRevenue / trips.filter(t => t.jual > 0).length : null;
  const profitPerTrip  = trips.length > 0 ? fNetProfit / trips.filter(t => t.jual > 0).length : null;

  // ── Build time-series data from ALL trips + expenses ─────────────────────
  const buildTimeSeries = () => {
    const buckets = {};

    const getBucket = (dateStr) => {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      if (isNaN(d)) return null;
      if (chartGranularity === "weekly") {
        // ISO week: year-W##
        const jan1 = new Date(d.getFullYear(), 0, 1);
        const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
        return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
      }
      if (chartGranularity === "monthly")   return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      if (chartGranularity === "quarterly") return `${d.getFullYear()}-Q${Math.floor(d.getMonth()/3)+1}`;
      if (chartGranularity === "yearly")    return `${d.getFullYear()}`;
      return null;
    };

    // Revenue + costs from trips
    for (const t of trips) {
      const bk = getBucket(t.date);
      if (!bk) continue;
      if (!buckets[bk]) buckets[bk] = { period: bk, revenue: 0, cogs: 0, truckOps: 0, overhead: 0 };
      buckets[bk].revenue  += t.jual  || 0;
      buckets[bk].cogs     += t.total || 0;
    }
    // Expenses
    for (const e of expenses) {
      const bk = getBucket(e.date);
      if (!bk) continue;
      if (!buckets[bk]) buckets[bk] = { period: bk, revenue: 0, cogs: 0, truckOps: 0, overhead: 0 };
      if ((e.expenseType || "truck") === "truck") buckets[bk].truckOps += e.amount || 0;
      else buckets[bk].overhead += e.amount || 0;
    }

    return Object.values(buckets)
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((b) => {
        const gp   = b.revenue - b.cogs;
        const op   = gp - b.truckOps;
        const net  = op - b.overhead;
        const total_exp = b.truckOps + b.overhead;
        return {
          ...b,
          grossProfit: gp,
          operatingProfit: op,
          netProfit: net,
          gpPct:        b.revenue > 0 ? +((gp / b.revenue) * 100).toFixed(1) : 0,
          netPct:       b.revenue > 0 ? +((net / b.revenue) * 100).toFixed(1) : 0,
          opPct:        b.revenue > 0 ? +((op / b.revenue) * 100).toFixed(1) : 0,
          opexPct:      b.revenue > 0 ? +((total_exp / b.revenue) * 100).toFixed(1) : 0,
          // Absolute series for secondary Y-axis (in millions for readability)
          netRevenue:   +(b.revenue / 1000000).toFixed(2),
          grossProfitAbs: +(gp / 1000000).toFixed(2),
        };
      });
  };

  const timeSeries = buildTimeSeries();

  // ── Metric config ─────────────────────────────────────────────────────────
  const METRIC_CONFIG = [
    { key: "gpPct",    label: "Gross Profit %",    color: "#34d399", unit: "%", ideal: "> 30%",  good: v => v >= 30,  yAxisId: "left" },
    { key: "opPct",    label: "Operating Margin %", color: "#60a5fa", unit: "%", ideal: "> 20%",  good: v => v >= 20, yAxisId: "left" },
    { key: "netPct",   label: "Net Margin %",       color: "#a78bfa", unit: "%", ideal: "> 15%",  good: v => v >= 15, yAxisId: "left" },
    { key: "opexPct",  label: "OpEx / Revenue %",   color: "#f59e0b", unit: "%", ideal: "< 50%",  good: v => v <= 50, yAxisId: "left" },
  ];

  const ABS_METRIC_CONFIG = [
    { key: "netRevenue",     label: "Net Revenue (M)",    color: "#60a5fa", unit: "M" },
    { key: "grossProfitAbs", label: "Gross Profit (M)",   color: "#34d399", unit: "M" },
  ];

  const toggleAbsMetric = (key) => {
    setActiveAbsMetrics(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const RATIO_CARDS = [
    {
      label: "Gross Profit Margin",
      value: gpPct,
      unit: "%",
      ideal: "> 30%",
      good: v => v >= 30,
      color: "#34d399",
      desc: "Revenue kept after paying drivers & direct trip costs",
      formula: "Gross Profit / Revenue",
    },
    {
      label: "Operating Margin",
      value: opPct,
      unit: "%",
      ideal: "> 20%",
      good: v => v >= 20,
      color: "#60a5fa",
      desc: "Profit after truck operating expenses",
      formula: "(GP − Truck Ops) / Revenue",
    },
    {
      label: "Net Profit Margin",
      value: netPct,
      unit: "%",
      ideal: "> 15%",
      good: v => v >= 15,
      color: "#a78bfa",
      desc: "What you actually keep after all costs",
      formula: "Net Profit / Revenue",
    },
    {
      label: "COGS %",
      value: cogs_pct,
      unit: "%",
      ideal: "< 60%",
      good: v => v <= 60,
      color: "#ec4899",
      desc: "Direct trip costs as % of revenue",
      formula: "Trip Costs / Revenue",
    },
    {
      label: "Debt-to-Asset Ratio",
      value: debtToAsset,
      unit: "%",
      ideal: "< 50%",
      good: v => v <= 50,
      color: "#f87171",
      desc: "How much of your assets are financed by debt",
      formula: "Total Debt / Total Assets",
      cumulative: true,
    },
    {
      label: "Debt-to-Equity",
      value: debtToEquity,
      unit: "%",
      ideal: "< 200%",
      good: v => v <= 200,
      color: "#f59e0b",
      desc: "Leverage — how much debt vs owner's equity",
      formula: "Total Debt / Equity",
      cumulative: true,
    },
    {
      label: "Liquidity Ratio",
      value: currentRatio,
      unit: "x",
      ideal: "> 1.5x",
      good: v => v >= 1.5,
      color: "#06b6d4",
      desc: "Cash on hand vs monthly operating costs",
      formula: "Cash Balance / Monthly OpEx",
      cumulative: true,
    },
    {
      label: "Revenue per Trip",
      value: revenuePerTrip,
      unit: "Rp",
      ideal: "maximise",
      good: () => true,
      color: "#c8a86b",
      desc: "Average invoiced amount per delivery",
      formula: "Total Revenue / # Trips",
    },
    {
      label: "Profit per Trip",
      value: profitPerTrip,
      unit: "Rp",
      ideal: "maximise",
      good: v => v > 0,
      color: "#34d399",
      desc: "Average net profit per delivery",
      formula: "Net Profit / # Trips",
    },
  ];

  const fmtVal = (v, unit) => {
    if (v === null || isNaN(v)) return "N/A";
    if (unit === "Rp") return fmt(Math.round(v));
    if (unit === "x") return `${v.toFixed(2)}x`;
    return `${v.toFixed(1)}%`;
  };

  const toggleMetric = (key) => {
    setActiveMetrics(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const COLORS = { "#34d399": "#34d399", "#60a5fa": "#60a5fa", "#a78bfa": "#a78bfa", "#f59e0b": "#f59e0b" };

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "10px 14px", fontSize: 11 }}>
        <div style={{ color: "#c8a86b", fontWeight: 700, marginBottom: 6 }}>{label}</div>
        {payload.map((p, i) => {
          const isAbs = ABS_METRIC_CONFIG.some(m => m.key === p.dataKey);
          const displayVal = isAbs ? `${p.value?.toFixed(2)}M` : `${p.value?.toFixed(1)}%`;
          return (
            <div key={i} style={{ color: p.color, marginBottom: 2 }}>
              {p.name}: <strong>{displayVal}</strong>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h3 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 14, color: "#c8a86b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Business Metrics
            </h3>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 3 }}>Ratios for {periodLabel} · Balance sheet ratios always cumulative</div>
          </div>
        </div>

        {/* Ratio Cards Grid */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 24 }}>
          {RATIO_CARDS.map((m) => {
            const val = m.value;
            const isGood = val !== null && !isNaN(val) && m.good(val);
            const na = val === null || isNaN(val);
            const statusColor = na ? "rgba(255,255,255,0.45)" : isGood ? "#34d399" : "#f87171";
            return (
              <div key={m.label} style={{ background: "#0c1420", border: `1px solid ${statusColor}33`, borderRadius: 8, padding: 16, position: "relative" }}>
                {m.cumulative && (
                  <div style={{ position: "absolute", top: 8, right: 8, fontSize: 9, color: "rgba(255,255,255,0.45)", background: "#1e2d3e", padding: "1px 5px", borderRadius: 2 }}>ALL-TIME</div>
                )}
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{m.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: statusColor, marginBottom: 4 }}>
                  {na ? "—" : fmtVal(val, m.unit)}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>Ideal: {m.ideal}</span>
                  {!na && (
                    <span style={{ fontSize: 10, background: statusColor + "22", color: statusColor, padding: "1px 6px", borderRadius: 3, fontWeight: 600 }}>
                      {isGood ? "✓ Good" : "⚠ Review"}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 3 }}>{m.desc}</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>{m.formula}</div>
              </div>
            );
          })}
        </div>

        {/* Trend Chart */}
        <div style={{ background: "#0c1420", borderRadius: 6, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 12, color: "#c8a86b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Margin Trends Over Time
            </div>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              {/* Granularity selector */}
              <div style={{ display: "flex", gap: 4 }}>
                {["weekly", "monthly", "quarterly", "yearly"].map((g) => (
                  <button key={g} onClick={() => setChartGranularity(g)} style={{
                    background: chartGranularity === g ? "#c8a86b" : "transparent",
                    color: chartGranularity === g ? "#0c1420" : "rgba(255,255,255,0.45)",
                    border: `1px solid ${chartGranularity === g ? "#c8a86b" : "rgba(255,255,255,0.12)"}`,
                    padding: "4px 10px", borderRadius: 3, fontSize: 11, fontWeight: 600, cursor: "pointer", textTransform: "capitalize",
                  }}>
                    {g === "weekly" ? "Wk" : g === "monthly" ? "Mo" : g === "quarterly" ? "Qtr" : "Yr"}
                  </button>
                ))}
              </div>
              {/* Metric toggles */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {METRIC_CONFIG.map((m) => (
                  <button key={m.key} onClick={() => toggleMetric(m.key)} style={{
                    background: activeMetrics.includes(m.key) ? m.color + "22" : "transparent",
                    color: activeMetrics.includes(m.key) ? m.color : "rgba(255,255,255,0.45)",
                    border: `1px solid ${activeMetrics.includes(m.key) ? m.color + "66" : "rgba(255,255,255,0.12)"}`,
                    padding: "4px 10px", borderRadius: 3, fontSize: 11, cursor: "pointer", fontWeight: activeMetrics.includes(m.key) ? 600 : 400,
                  }}>
                    {m.label}
                  </button>
                ))}
                <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, padding: "4px 2px" }}>|</span>
                {ABS_METRIC_CONFIG.map((m) => (
                  <button key={m.key} onClick={() => toggleAbsMetric(m.key)} style={{
                    background: activeAbsMetrics.includes(m.key) ? m.color + "22" : "transparent",
                    color: activeAbsMetrics.includes(m.key) ? m.color : "rgba(255,255,255,0.45)",
                    border: `1px solid ${activeAbsMetrics.includes(m.key) ? m.color + "66" : "rgba(255,255,255,0.12)"}`,
                    padding: "4px 10px", borderRadius: 3, fontSize: 11, cursor: "pointer", fontWeight: activeAbsMetrics.includes(m.key) ? 600 : 400,
                  }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {timeSeries.length < 2 ? (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.45)", fontSize: 12, padding: "40px 0" }}>
              Not enough data to draw a trend yet — import more months to see trends.
            </div>
          ) : (
            <>
              {activeAbsMetrics.length > 0 && (
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 4, textAlign: "right" }}>
                  Left axis: % · Right axis: millions (Rp)
                </div>
              )}
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={timeSeries} margin={{ top: 5, right: activeAbsMetrics.length > 0 ? 50 : 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2d3e" />
                  <XAxis dataKey="period" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} unit="%" domain={["auto", "auto"]} />
                  {activeAbsMetrics.length > 0 && (
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} unit="M" domain={["auto", "auto"]} />
                  )}
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }} />
                  <ReferenceLine yAxisId="left" y={0} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 2" />
                  {METRIC_CONFIG.filter(m => activeMetrics.includes(m.key)).map((m) => (
                    <Line
                      key={m.key}
                      yAxisId="left"
                      type="monotone"
                      dataKey={m.key}
                      name={m.label}
                      stroke={m.color}
                      strokeWidth={2}
                      dot={{ fill: m.color, r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  ))}
                  {ABS_METRIC_CONFIG.filter(m => activeAbsMetrics.includes(m.key)).map((m) => (
                    <Line
                      key={m.key}
                      yAxisId="right"
                      type="monotone"
                      dataKey={m.key}
                      name={m.label}
                      stroke={m.color}
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      dot={{ fill: m.color, r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </>
          )}

          {/* Revenue vs Cost bars */}
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 10 }}>Net Revenue vs Costs (Rp)</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={timeSeries} margin={{ top: 0, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d3e" />
                <XAxis dataKey="period" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} tickFormatter={(v) => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : `${(v/1000).toFixed(0)}K`} />
                <Tooltip
                  formatter={(v, name, props) => {
                    const row = props?.payload || {};
                    if (name === "Net Revenue" && row.revenue > 0) {
                      const gm = ((row.grossProfit / row.revenue) * 100).toFixed(1);
                      return [`${fmt(v)} (Gross Margin: ${gm}%)`, name];
                    }
                    return [fmt(v), name];
                  }}
                  contentStyle={{ background: "#0d1e30", border: "1px solid rgba(255,255,255,0.08)", fontSize: 11 }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }} />
                <Bar dataKey="revenue"      name="Net Revenue"  fill="#34d399" radius={[3,3,0,0]} />
                <Bar dataKey="grossProfit"  name="Gross Profit" fill="#60a5fa" radius={[3,3,0,0]} />
                <Bar dataKey="cogs"         name="Trip Costs"   fill="#f87171" radius={[3,3,0,0]} />
                <Bar dataKey="truckOps"     name="Truck Ops"    fill="#f59e0b" radius={[3,3,0,0]} />
                <Bar dataKey="overhead"     name="Overhead"     fill="#ec4899" radius={[3,3,0,0]} />
                <Bar dataKey="netProfit"    name="Net Profit"   fill="#a78bfa" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── REPORTS ──────────────────────────────────────────────────────────────────
function Reports({ trips, expenses, kas, capital, loans, assets, loanPayments, grossProfit, netProfit, totalRevenue, totalExpenses, truckOpsExpenses, overheadExpenses, tripCosts, totalCapitalInjected, totalLoansReceived, totalLoanPrincipalRemaining, totalLoanPaymentsMade, totalAssetsValue }) {
  const isMobile = useIsMobile();
  // ── Date range state ───────────────────────────────────────────────────────
  const todayDate = new Date();
  const firstDayThisMonth = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1).toISOString().slice(0, 10);
  const lastDayThisMonth = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [preset, setPreset] = useState("all");

  const applyPreset = (key) => {
    setPreset(key);
    const now = new Date();
    let from = "", to = "";
    if (key === "all") { from = ""; to = ""; }
    else if (key === "thisMonth") {
      from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    }
    else if (key === "lastMonth") {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
      to = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
    }
    else if (key === "thisQuarter") {
      const q = Math.floor(now.getMonth() / 3);
      from = new Date(now.getFullYear(), q * 3, 1).toISOString().slice(0, 10);
      to = new Date(now.getFullYear(), q * 3 + 3, 0).toISOString().slice(0, 10);
    }
    else if (key === "ytd") {
      from = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
      to = new Date(now.getFullYear(), 11, 31).toISOString().slice(0, 10);
    }
    else if (key === "lastYear") {
      from = new Date(now.getFullYear() - 1, 0, 1).toISOString().slice(0, 10);
      to = new Date(now.getFullYear() - 1, 11, 31).toISOString().slice(0, 10);
    }
    setDateFrom(from);
    setDateTo(to);
  };

  const inRange = (dateStr) => {
    if (!dateStr) return true;
    if (dateFrom && dateStr < dateFrom) return false;
    if (dateTo && dateStr > dateTo) return false;
    return true;
  };

  // ── Filter all data by date range ──────────────────────────────────────────
  const fTrips = trips.filter((t) => inRange(t.date));
  const fExpenses = expenses.filter((e) => inRange(e.date));
  const fKas = kas.filter((k) => inRange(k.date));
  const fCapital = capital.filter((c) => inRange(c.date));
  const fLoanPayments = loanPayments.filter((p) => inRange(p.date));
  const fAssets = assets.filter((a) => inRange(a.purchaseDate));

  // ── Filtered aggregates ────────────────────────────────────────────────────
  const fTotalRevenue = fTrips.reduce((s, t) => s + t.jual, 0);
  const fTripCosts = fTrips.reduce((s, t) => s + t.total, 0);
  const fGrossProfit = fTrips.reduce((s, t) => s + t.profit, 0);
  const fTruckOpsExpenses = fExpenses.filter((e) => (e.expenseType || "truck") === "truck").reduce((s, e) => s + e.amount, 0);
  const fOverheadExpenses = fExpenses.filter((e) => e.expenseType === "overhead").reduce((s, e) => s + e.amount, 0);
  const fTotalExpenses = fTruckOpsExpenses + fOverheadExpenses;
  const fNetProfit = fGrossProfit - fTotalExpenses;
  const fCapitalInjected = fCapital.filter((c) => c.type === "capital").reduce((s, c) => s + c.amount, 0);
  const fLoansReceived = fCapital.filter((c) => c.type === "loan").reduce((s, c) => s + c.amount, 0);
  const fLoanPaymentsMade = fLoanPayments.reduce((s, p) => s + p.amount, 0);
  const fAssetsValue = fAssets.reduce((s, a) => s + (a.purchasePrice || 0), 0);
  const fKasIn = fKas.filter((k) => k.type === "in").reduce((s, k) => s + k.amount, 0);
  const fKasOut = fKas.filter((k) => k.type === "out").reduce((s, k) => s + k.amount, 0);
  const fKasBalance = fKasIn - fKasOut;

  const fTruckExpByCategory = {};
  for (const e of fExpenses.filter((x) => (x.expenseType || "truck") === "truck")) fTruckExpByCategory[e.category] = (fTruckExpByCategory[e.category] || 0) + e.amount;
  const fOverheadExpByCategory = {};
  for (const e of fExpenses.filter((x) => x.expenseType === "overhead")) fOverheadExpByCategory[e.category] = (fOverheadExpByCategory[e.category] || 0) + e.amount;

  const periodLabel = (dateFrom || dateTo) ? `${dateFrom || "earliest"} to ${dateTo || "today"}` : "All time";
  const fileLabel = (dateFrom || dateTo) ? `${dateFrom || "all"}_to_${dateTo || "today"}` : "all_time";

  // ── Build individual report builders ───────────────────────────────────────
  const buildPL = () => {
    const operatingProfit = fGrossProfit - fTruckOpsExpenses;
    return [
      ["Kin Kin Trukindo, Ltd. — PROFIT & LOSS STATEMENT"],
      ["Period:", periodLabel],
      ["Generated:", new Date().toLocaleDateString("en-US")],
      [],
      ["", "", "AMOUNT (IDR)"],
      ["REVENUE", "", ""],
      ["  Freight Revenue (Invoiced)", "", fTotalRevenue],
      ["TOTAL REVENUE", "", fTotalRevenue],
      [],
      ["COST OF SERVICES (Direct Trip Costs)", "", ""],
      ["  Driver Allowances", "", fTrips.reduce((s, t) => s + t.sangu, 0)],
      ["  Trip Misc Costs", "", fTrips.reduce((s, t) => s + t.lainAmt, 0)],
      ["TOTAL COST OF SERVICES", "", fTripCosts],
      [],
      ["GROSS PROFIT", "", fGrossProfit],
      ["Gross Margin %", "", fTotalRevenue > 0 ? `${((fGrossProfit / fTotalRevenue) * 100).toFixed(1)}%` : "—"],
      [],
      ["TRUCK OPERATING EXPENSES", "", ""],
      ...Object.entries(fTruckExpByCategory).map(([cat, amt]) => [`  ${cat}`, "", amt]),
      ["TOTAL TRUCK OPS EXPENSES", "", fTruckOpsExpenses],
      [],
      ["OPERATING PROFIT", "", operatingProfit],
      [],
      ["OVERHEAD EXPENSES (SG&A)", "", ""],
      ...Object.entries(fOverheadExpByCategory).map(([cat, amt]) => [`  ${cat}`, "", amt]),
      ["TOTAL OVERHEAD EXPENSES", "", fOverheadExpenses],
      [],
      ["NET PROFIT / (LOSS)", "", fNetProfit],
      ["Net Margin %", "", fTotalRevenue > 0 ? `${((fNetProfit / fTotalRevenue) * 100).toFixed(1)}%` : "—"],
    ];
  };

  const buildIncomeStatement = () => {
    const operatingProfit = fGrossProfit - fTruckOpsExpenses;
    return [
      ["Kin Kin Trukindo, Ltd. — INCOME STATEMENT"],
      ["Period:", periodLabel],
      ["Generated:", new Date().toLocaleDateString("en-US")],
      [],
      ["REVENUE DETAIL (from Trips)", "", "", "", ""],
      ["DATE", "INVOICE NO", "DESTINATION", "TRUCK", "AMOUNT (IDR)"],
      ...fTrips.map((t) => [t.date, t.invNo, t.destination, t.nopol, t.jual]),
      ["TOTAL REVENUE", "", "", "", fTotalRevenue],
      [],
      ["INCOME STATEMENT SUMMARY", "", "", "", ""],
      ["Total Revenue", "", "", "", fTotalRevenue],
      ["Less: Cost of Services", "", "", "", -fTripCosts],
      ["Gross Profit", "", "", "", fGrossProfit],
      ["Less: Truck Operating Expenses", "", "", "", -fTruckOpsExpenses],
      ["Operating Profit", "", "", "", operatingProfit],
      ["Less: Overhead Expenses", "", "", "", -fOverheadExpenses],
      ["Net Profit", "", "", "", fNetProfit],
    ];
  };

  const buildCashFlow = () => {
    const netOperating = fTotalRevenue - fTripCosts - fTruckOpsExpenses - fOverheadExpenses;
    const netInvesting = -fAssetsValue;
    const netFinancing = fCapitalInjected + fLoansReceived - fLoanPaymentsMade;
    return [
      ["Kin Kin Trukindo, Ltd. — CASH FLOW STATEMENT (GAAP)"],
      ["Period:", periodLabel],
      ["Generated:", new Date().toLocaleDateString("en-US")],
      [],
      ["", "", "AMOUNT (IDR)"],
      ["CASH FLOWS FROM OPERATING ACTIVITIES", "", ""],
      ["  Cash received from customers", "", fTotalRevenue],
      ["  Cash paid for trip costs", "", -fTripCosts],
      ["  Cash paid for truck operating expenses", "", -fTruckOpsExpenses],
      ["  Cash paid for overhead (SG&A)", "", -fOverheadExpenses],
      ["NET CASH FROM OPERATIONS", "", netOperating],
      [],
      ["CASH FLOWS FROM INVESTING ACTIVITIES", "", ""],
      ["  Purchase of trucks / equipment", "", -fAssetsValue],
      ["NET CASH FROM INVESTING", "", netInvesting],
      [],
      ["CASH FLOWS FROM FINANCING ACTIVITIES", "", ""],
      ["  Owner capital injection", "", fCapitalInjected],
      ["  Loans received", "", fLoansReceived],
      ["  Loan repayments (installments)", "", -fLoanPaymentsMade],
      ["NET CASH FROM FINANCING", "", netFinancing],
      [],
      ["NET CHANGE IN CASH", "", netOperating + netInvesting + netFinancing],
    ];
  };

  const buildBalanceSheet = () => {
    // Simplified balance sheet
    const totalAssetsAcrossAll = totalAssetsValue; // use ALL assets (B/S is cumulative)
    const netCashAcrossAll = kas.reduce((s, k) => s + (k.type === "in" ? k.amount : -k.amount), 0);
    const allCapital = capital.filter((c) => c.type === "capital").reduce((s, c) => s + c.amount, 0);
    const allLoanPrincipalRemaining = loans.reduce((s, l) => {
      const paid = loanPayments.filter((p) => p.loanId === l.id).reduce((sum, p) => sum + p.amount, 0);
      return s + Math.max(0, l.principal - paid);
    }, 0);
    const totalAssetsBS = totalAssetsAcrossAll + netCashAcrossAll;
    const retainedEarnings = totalAssetsBS - allCapital - allLoanPrincipalRemaining;

    return [
      ["Kin Kin Trukindo, Ltd. — BALANCE SHEET"],
      ["As of:", dateTo || new Date().toISOString().slice(0, 10)],
      ["Generated:", new Date().toLocaleDateString("en-US")],
      ["Note: Balance Sheet shows cumulative position — date range applies to retained earnings calc"],
      [],
      ["", "", "AMOUNT (IDR)"],
      ["ASSETS", "", ""],
      ["  Current Assets", "", ""],
      ["    Cash & Cash Equivalents", "", netCashAcrossAll],
      ["  Fixed Assets", "", ""],
      ["    Trucks & Equipment", "", totalAssetsAcrossAll],
      ["TOTAL ASSETS", "", totalAssetsBS],
      [],
      ["LIABILITIES", "", ""],
      ["  Long-term Loans (Principal Remaining)", "", allLoanPrincipalRemaining],
      ["TOTAL LIABILITIES", "", allLoanPrincipalRemaining],
      [],
      ["EQUITY", "", ""],
      ["  Owner Capital (Total Injected)", "", allCapital],
      ["  Retained Earnings (Derived)", "", retainedEarnings],
      ["TOTAL EQUITY", "", allCapital + retainedEarnings],
      [],
      ["TOTAL LIABILITIES + EQUITY", "", allLoanPrincipalRemaining + allCapital + retainedEarnings],
    ];
  };

  const buildTripLog = () => [
    ["Kin Kin Trukindo, Ltd. — TRIP LOG"],
    ["Period:", periodLabel],
    [],
    ["DATE", "INV NO", "DESTINATION", "PLATE", "CONTAINER", "DRIVER ALLOW.", "MISC LABEL", "MISC AMT", "TOTAL COST", "INVOICED", "PROFIT"],
    ...fTrips.map((t) => [t.date, t.invNo, t.destination, t.nopol, t.contNo, t.sangu, t.lainLabel, t.lainAmt, t.total, t.jual, t.profit]),
    [],
    ["TOTALS", "", "", "", "", fTrips.reduce((s, t) => s + t.sangu, 0), "", fTrips.reduce((s, t) => s + t.lainAmt, 0), fTripCosts, fTotalRevenue, fGrossProfit],
  ];

  const buildExpenseLog = () => [
    ["Kin Kin Trukindo, Ltd. — EXPENSE LOG"],
    ["Period:", periodLabel],
    [],
    ["DATE", "TYPE", "CATEGORY", "DESCRIPTION", "TRUCK / VENDOR", "AMOUNT"],
    ...fExpenses.map((e) => [e.date, e.expenseType === "overhead" ? "Overhead" : "Truck", e.category, e.description, e.expenseType === "overhead" ? (e.vendor || "") : (e.truck || ""), e.amount]),
    [],
    ["SUBTOTAL — TRUCK OPS", "", "", "", "", fTruckOpsExpenses],
    ["SUBTOTAL — OVERHEAD", "", "", "", "", fOverheadExpenses],
    ["TOTAL", "", "", "", "", fTotalExpenses],
  ];

  // ── Preview + Download state ──────────────────────────────────────────────
  const [reportPreview, setReportPreview] = useState(null); // { title, icon, color, rows, downloadFn }

  const openPreview = (title, icon, color, buildFn, downloadFn) => {
    setReportPreview({ title, icon, color, rows: buildFn(), downloadFn });
  };

  // ── Download functions ────────────────────────────────────────────────────
  const downloadSingle = async (reportName, buildFn, sheetName) => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(buildFn());
    ws["!cols"] = [{ wch: 40 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `KinKin_${reportName}_${fileLabel}.xlsx`);
  };

  const downloadAll = async () => {
    const wb = XLSX.utils.book_new();
    const sheets = [
      ["P&L", buildPL()],
      ["Income Statement", buildIncomeStatement()],
      ["Cash Flow", buildCashFlow()],
      ["Balance Sheet", buildBalanceSheet()],
      ["Trip Log", buildTripLog()],
      ["Expense Log", buildExpenseLog()],
    ];
    for (const [name, data] of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws["!cols"] = [{ wch: 40 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    XLSX.writeFile(wb, `KinKin_Full_Reports_${fileLabel}.xlsx`);
  };

  const Section = ({ title, rows, total, totalLabel = "TOTAL", color = "#34d399" }) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "#c8a86b", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 4, fontWeight: 600 }}>{title}</div>
      {rows.map(([label, amt], i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
          <span>{label}</span><span>{fmt(amt)}</span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, fontWeight: 600, color, borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: 4 }}>
        <span>{totalLabel}</span><span>{fmt(total)}</span>
      </div>
    </div>
  );

  const ReportCard = ({ title, description, buildFn, downloadFn }) => (
    <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 14, color: "#c8a86b", fontWeight: 700, fontFamily: "'Montserrat', sans-serif", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{description}</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
        <button onClick={() => openPreview(title, "", "#c8a86b", buildFn, downloadFn)} style={{ flex: 1, background: "rgba(255,255,255,0.06)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.12)", padding: "8px 12px", borderRadius: 4, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
          Preview
        </button>
        <button onClick={downloadFn} style={{ flex: 1, background: "#c8a86b", color: "#0c1420", border: "none", padding: "8px 12px", borderRadius: 4, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
          Download
        </button>
      </div>
    </div>
  );

  // ── Report Preview Modal ──────────────────────────────────────────────────
  const ReportPreviewModal = () => {
    if (!reportPreview) return null;
    const { title, icon, color, rows, downloadFn } = reportPreview;

    // Determine if a row is a header/total row (empty value or string value in col 2)
    const isSectionHeader = (row) => row.length >= 1 && (row[1] === "" || row[1] == null) && row[2] == null && row[0] && typeof row[0] === "string" && !row[0].startsWith(" ");
    const isTotalRow = (row) => typeof row[0] === "string" && (row[0].toUpperCase().startsWith("TOTAL") || row[0].toUpperCase().startsWith("NET ") || row[0].toUpperCase().startsWith("GROSS ") || row[0].toUpperCase().startsWith("OPERATING "));
    const isEmpty = (row) => row.every((c) => c === "" || c == null);

    return (
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.88)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ background: "#0c1420", border: `1px solid ${color}88`, borderRadius: 10, width: "100%", maxWidth: 900, maxHeight: "92vh", display: "flex", flexDirection: "column" }}>

          {/* Modal header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div>
              <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 18, color: "#c8a86b", fontWeight: 700 }}>{title}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>Period: {periodLabel}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={downloadFn} style={{ background: "#c8a86b", color: "#0c1420", border: "none", padding: "9px 20px", borderRadius: 4, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                Download Excel
              </button>
              <button onClick={() => setReportPreview(null)} style={{ background: "transparent", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)", padding: "8px 14px", borderRadius: 4, fontSize: 12, cursor: "pointer" }}>
                ✕ Close
              </button>
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowY: "auto", padding: "16px 24px", flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <tbody>
                {rows.map((row, i) => {
                  if (isEmpty(row)) return <tr key={i}><td colSpan={6} style={{ padding: "5px 0" }}></td></tr>;

                  const isHeader = isSectionHeader(row);
                  const isTotal = isTotalRow(row);
                  const isTitle = i === 0; // First row is always the report title
                  const isSubLabel = typeof row[0] === "string" && row[0].startsWith("  "); // indented

                  if (isTitle) return (
                    <tr key={i}>
                      <td colSpan={6} style={{ padding: "6px 8px 14px", fontFamily: "'Montserrat', sans-serif", fontSize: 15, color, fontWeight: 700 }}>{row[0]}</td>
                    </tr>
                  );

                  if (isHeader) return (
                    <tr key={i}>
                      <td colSpan={6} style={{ padding: "14px 8px 4px", fontSize: 11, color: "#c8a86b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                        {row[0]}
                      </td>
                    </tr>
                  );

                  // Normal data row — up to 5 columns
                  const cells = Array.from({ length: 5 }, (_, j) => row[j] ?? "");
                  const hasAmount = cells.some((c, j) => j > 0 && typeof c === "number");
                  const lastNumIdx = cells.map((c) => typeof c === "number").lastIndexOf(true);

                  return (
                    <tr key={i} style={{
                      borderBottom: isTotal ? "2px solid rgba(255,255,255,0.12)" : "1px solid rgba(255,255,255,0.05)",
                      background: isTotal ? "#0c1420" : "transparent",
                    }}>
                      {cells.map((cell, j) => {
                        const isNum = typeof cell === "number";
                        const isAmtCol = j === lastNumIdx && isNum;
                        return (
                          <td key={j} style={{
                            padding: isTotal ? "8px 8px" : "5px 8px",
                            textAlign: isNum ? "right" : "left",
                            color: isTotal && isAmtCol
                              ? (cell < 0 ? "#f87171" : "#34d399")
                              : isNum
                              ? (cell < 0 ? "#ef444499" : "rgba(255,255,255,0.45)")
                              : isSubLabel && j === 0 ? "rgba(255,255,255,0.45)" : "#e2e8f0",
                            fontWeight: isTotal ? 700 : 400,
                            fontSize: isTotal ? 13 : 12,
                            paddingLeft: isSubLabel && j === 0 ? 20 : undefined,
                            fontFamily: isNum ? "'Inter', monospace" : "inherit",
                          }}>
                            {isNum
                              ? cell < 0
                                ? `(${fmt(Math.abs(cell))})`
                                : fmt(cell)
                              : cell}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div style={{ padding: "12px 24px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 11, color: "rgba(255,255,255,0.45)", display: "flex", justifyContent: "space-between" }}>
            <span>{rows.filter((r) => !r.every((c) => c === "" || c == null)).length} rows</span>
            <span>Generated {new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
        </div>
      </div>
    );
  };


  const operatingProfit = fGrossProfit - fTruckOpsExpenses;

  return (
    <div>
      {/* Report Preview Modal */}
      <ReportPreviewModal />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 20, color: "#e2e8f0", letterSpacing: 0.3, fontWeight: 700 }}>FINANCIAL REPORTS</h2>
      </div>

      {/* Date Range Picker */}
      <div style={{ background: "#162030", border: "1px solid rgba(200,168,107,0.3)", borderRadius: 8, padding: 20, marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: "#c8a86b", marginBottom: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Report Period</div>

        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {[
            { key: "all", label: "All Time" },
            { key: "thisMonth", label: "This Month" },
            { key: "lastMonth", label: "Last Month" },
            { key: "thisQuarter", label: "This Quarter" },
            { key: "ytd", label: "Year to Date" },
            { key: "lastYear", label: "Last Year" },
            { key: "custom", label: "Custom" },
          ].map((p) => (
            <button key={p.key} onClick={() => applyPreset(p.key)} style={{
              background: preset === p.key ? "#c8a86b" : "#1e2d3e",
              color: preset === p.key ? "#0c1420" : "rgba(255,255,255,0.45)",
              border: `1px solid ${preset === p.key ? "#c8a86b" : "rgba(255,255,255,0.12)"}`,
              padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 600
            }}>
              {p.label}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 2fr", gap: 12, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>FROM DATE</label>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPreset("custom"); }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 4 }}>TO DATE</label>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPreset("custom"); }} />
          </div>
          <div style={{ background: "#0c1420", padding: 10, borderRadius: 4, fontSize: 11, color: "rgba(255,255,255,0.45)", gridColumn: isMobile ? "1 / -1" : "auto" }}>
            <strong style={{ color: "#c8a86b" }}>Active period:</strong> {periodLabel}<br />
            <span style={{ color: "rgba(255,255,255,0.45)" }}>{fTrips.length} trips · {fExpenses.length} expenses</span>
          </div>
        </div>
      </div>

      {/* KPI Summary for filtered period */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>REVENUE</div>
          <div style={{ fontSize: 15, color: "#34d399" }}>{fmt(fTotalRevenue)}</div>
        </div>
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>GROSS PROFIT</div>
          <div style={{ fontSize: 15, color: "#60a5fa" }}>{fmt(fGrossProfit)}</div>
        </div>
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>OPERATING PROFIT</div>
          <div style={{ fontSize: 15, color: "#60a5fa" }}>{fmt(operatingProfit)}</div>
        </div>
        <div style={{ background: "#162030", border: "1px solid rgba(200,168,107,0.3)", borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>NET PROFIT</div>
          <div style={{ fontSize: 15, color: fNetProfit >= 0 ? "#34d399" : "#f87171", fontWeight: 600 }}>{fmt(fNetProfit)}</div>
        </div>
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>NET MARGIN</div>
          <div style={{ fontSize: 15, color: "#c8a86b" }}>{fTotalRevenue > 0 ? `${((fNetProfit / fTotalRevenue) * 100).toFixed(1)}%` : "—"}</div>
        </div>
      </div>


      {/* ── BUSINESS METRICS ────────────────────────────────────────────────── */}
      <BusinessMetrics
        trips={trips}
        expenses={expenses}
        kas={kas}
        loans={loans}
        loanPayments={loanPayments}
        assets={assets}
        capital={capital}
        fTotalRevenue={fTotalRevenue}
        fGrossProfit={fGrossProfit}
        fNetProfit={fNetProfit}
        fTripCosts={fTripCosts}
        fTruckOpsExpenses={fTruckOpsExpenses}
        fOverheadExpenses={fOverheadExpenses}
        fKasBalance={fKasBalance}
        totalAssetsValue={totalAssetsValue}
        totalLoanPrincipalRemaining={totalLoanPrincipalRemaining}
        totalCapitalInjected={totalCapitalInjected}
        periodLabel={periodLabel}
      />

      {/* Individual Report Download Cards */}
      <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <h3 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 14, color: "#c8a86b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Downloadable Reports</h3>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>All reports use the date range above</div>
          </div>
          <button onClick={downloadAll} style={{ background: "#c8a86b", color: "#0c1420", border: "none", padding: "10px 20px", borderRadius: 4, fontWeight: 700, fontSize: 12 }}>
            Download All as One File
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <ReportCard title="Profit & Loss" description="GAAP-structured P&L with revenue, COGS, expenses, net profit" buildFn={buildPL} downloadFn={() => downloadSingle("Profit_Loss", buildPL, "P&L")} />
          <ReportCard title="Income Statement" description="Revenue detail from trips + summary income breakdown" buildFn={buildIncomeStatement} downloadFn={() => downloadSingle("Income_Statement", buildIncomeStatement, "Income Statement")} />
          <ReportCard title="Cash Flow Statement" description="Operating, Investing & Financing activities" buildFn={buildCashFlow} downloadFn={() => downloadSingle("Cash_Flow", buildCashFlow, "Cash Flow")} />
          <ReportCard title="Balance Sheet" description="Assets, liabilities & equity snapshot" buildFn={buildBalanceSheet} downloadFn={() => downloadSingle("Balance_Sheet", buildBalanceSheet, "Balance Sheet")} />
          <ReportCard title="Trip Log" description="Detailed trip-by-trip breakdown with all costs and invoice amounts" buildFn={buildTripLog} downloadFn={() => downloadSingle("Trip_Log", buildTripLog, "Trip Log")} />
          <ReportCard title="Expense Log" description="All truck & overhead expenses itemized by category" buildFn={buildExpenseLog} downloadFn={() => downloadSingle("Expense_Log", buildExpenseLog, "Expense Log")} />
        </div>
      </div>

      {/* Visual P&L Preview */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20 }}>
        <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 24 }}>
          <h3 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 16, color: "#c8a86b", letterSpacing: 0.3, fontWeight: 700, marginBottom: 18 }}>PROFIT & LOSS PREVIEW</h3>
          <Section title="Revenue" rows={[["Freight Revenue", fTotalRevenue]]} total={fTotalRevenue} totalLabel="GROSS REVENUE" />
          <Section title="Cost of Services" rows={[["Driver Allowances", fTrips.reduce((s, t) => s + t.sangu, 0)], ["Misc Trip Costs", fTrips.reduce((s, t) => s + t.lainAmt, 0)]]} total={fTripCosts} totalLabel="TOTAL COGS" color="#f87171" />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 15, fontWeight: 700, color: "#60a5fa", borderTop: "2px solid rgba(255,255,255,0.12)", marginTop: 8 }}>
            <span>GROSS PROFIT</span><span>{fmt(fGrossProfit)}</span>
          </div>
          <Section title="Truck Operating Expenses" rows={Object.entries(fTruckExpByCategory).length ? Object.entries(fTruckExpByCategory) : [["No truck expenses", 0]]} total={fTruckOpsExpenses} totalLabel="TOTAL TRUCK OPS" color="#c8a86b" />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 15, fontWeight: 700, color: "#60a5fa", borderTop: "1px solid rgba(255,255,255,0.12)", marginTop: 8 }}>
            <span>OPERATING PROFIT</span><span>{fmt(operatingProfit)}</span>
          </div>
          <Section title="Overhead (SG&A)" rows={Object.entries(fOverheadExpByCategory).length ? Object.entries(fOverheadExpByCategory) : [["No overhead", 0]]} total={fOverheadExpenses} totalLabel="TOTAL OVERHEAD" color="rgba(255,255,255,0.45)" />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 16, fontWeight: 700, color: fNetProfit >= 0 ? "#34d399" : "#f87171", borderTop: "2px solid rgba(200,168,107,0.35)", marginTop: 8 }}>
            <span>NET PROFIT / (LOSS)</span><span>{fmt(fNetProfit)}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 24 }}>
            <h3 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 16, color: "#c8a86b", letterSpacing: 0.3, fontWeight: 700, marginBottom: 18 }}>CASH FLOW PREVIEW</h3>
            <Section title="Operating Activities" rows={[["Revenue collected", fTotalRevenue], ["Trip costs paid", -fTripCosts], ["Truck ops paid", -fTruckOpsExpenses], ["Overhead paid", -fOverheadExpenses]]} total={fTotalRevenue - fTripCosts - fTruckOpsExpenses - fOverheadExpenses} totalLabel="NET OPERATING" color="#60a5fa" />
            <Section title="Investing Activities" rows={[["Asset purchases", -fAssetsValue]]} total={-fAssetsValue} totalLabel="NET INVESTING" color="#c8a86b" />
            <Section title="Financing Activities" rows={[["Capital injection", fCapitalInjected], ["Loans received", fLoansReceived], ["Loan repayments", -fLoanPaymentsMade]]} total={fCapitalInjected + fLoansReceived - fLoanPaymentsMade} totalLabel="NET FINANCING" color="#ec4899" />
          </div>

          <div style={{ background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 24 }}>
            <h3 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 16, color: "#c8a86b", letterSpacing: 0.3, fontWeight: 700, marginBottom: 18 }}>BALANCE SHEET SNAPSHOT</h3>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 10 }}>Cumulative position (not period-filtered)</div>
            <Section title="Assets" rows={[["Cash", kas.reduce((s, k) => s + (k.type === "in" ? k.amount : -k.amount), 0)], ["Trucks & Equipment", totalAssetsValue]]} total={totalAssetsValue + kas.reduce((s, k) => s + (k.type === "in" ? k.amount : -k.amount), 0)} totalLabel="TOTAL ASSETS" color="#34d399" />
            <Section title="Liabilities" rows={[["Loans Outstanding", totalLoanPrincipalRemaining]]} total={totalLoanPrincipalRemaining} totalLabel="TOTAL LIABILITIES" color="#f87171" />
            <Section title="Equity" rows={[["Owner Capital", capital.filter((c) => c.type === "capital").reduce((s, c) => s + c.amount, 0)]]} total={capital.filter((c) => c.type === "capital").reduce((s, c) => s + c.amount, 0)} totalLabel="TOTAL EQUITY" color="#60a5fa" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
function Settings({ appPassword, setAppPassword, activityLog, kas, expenses, trips, pettyHolders, pettyTopups, loans, loanPayments, kasBalance, showToast, importLogs, undoImport, resetAll }) {
  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confPwd, setConfPwd] = useState("");
  const [pwdErr, setPwdErr] = useState("");
  const [actPage, setActPage] = useState(25);
  const [auditResults, setAuditResults] = useState(null);
  const [auditing, setAuditing] = useState(false);
  const [importHistoryOpen, setImportHistoryOpen] = useState(false);
  const [undoTarget, setUndoTarget] = useState(null);
  const [undoPwd, setUndoPwd] = useState("");
  const [undoErr, setUndoErr] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [resetPwd, setResetPwd] = useState("");
  const [resetErr, setResetErr] = useState("");

  function handleChangePwd(e) {
    e.preventDefault();
    if (curPwd !== appPassword) { setPwdErr("Current password is incorrect."); return; }
    if (newPwd.length < 4) { setPwdErr("New password must be at least 4 characters."); return; }
    if (newPwd !== confPwd) { setPwdErr("New passwords do not match."); return; }
    setAppPassword(newPwd);
    setCurPwd(""); setNewPwd(""); setConfPwd(""); setPwdErr("");
    showToast("Password updated!");
  }

  function runAudit() {
    setAuditing(true);
    setTimeout(() => {
      const results = [];

      // Check 1 — Cash balance integrity
      const computed = kas.reduce((s, k) => s + (k.type === "in" ? k.amount : -k.amount), 0);
      const diff = Math.abs(computed - kasBalance);
      results.push({ label: "Cash Balance Integrity", status: diff < 1 ? "pass" : "fail", detail: diff < 1 ? `Balance matches: ${fmt(kasBalance)}` : `Expected ${fmt(computed)}, stored ${fmt(kasBalance)} — diff ${fmt(diff)}` });

      // Check 2 — Duplicate kas entries
      const dupPairs = [];
      for (let i = 0; i < kas.length; i++) {
        for (let j = i + 1; j < kas.length; j++) {
          if (kas[i].date === kas[j].date && kas[i].amount === kas[j].amount && kas[i].type === kas[j].type) {
            dupPairs.push(`${kas[i].date} · ${fmt(kas[i].amount)} (${kas[i].type}) — "${kas[i].description}" & "${kas[j].description}"`);
          }
        }
      }
      results.push({ label: "Duplicate Cash Entries", status: dupPairs.length === 0 ? "pass" : "warn", detail: dupPairs.length === 0 ? "No duplicates found." : dupPairs });

      // Check 3 — Stale driver-cost entries
      const staleDC = kas.filter((k) => k.description && k.description.startsWith("Driver costs —"));
      results.push({ label: "Stale Driver-Cost Cash Entries", status: staleDC.length === 0 ? "pass" : "warn", detail: staleDC.length === 0 ? "None found." : staleDC.map((k) => `${k.date} · ${fmt(k.amount)} — "${k.description}"`) });

      // Check 4 — Manual expenses without kas entry
      const manualExp = expenses.filter((e) => e.source !== "import" && (e.expenseType === "truck" || e.expenseType === "overhead"));
      const missingKas = manualExp.filter((e) => !kas.some((k) => k.type === "out" && k.amount === e.amount && k.date === e.date));
      results.push({ label: "Manual Expenses Missing Cash Entry", status: missingKas.length === 0 ? "pass" : "warn", detail: missingKas.length === 0 ? "All manual expenses have matching cash entries." : missingKas.map((e) => `${e.date} · ${fmt(e.amount)} — ${e.description}`) });

      // Check 5 — Petty cash reconciliation
      const activeHolders = pettyHolders.filter((h) => h.active);
      const pettyIssues = [];
      for (const h of activeHolders) {
        const topups = pettyTopups.filter((t) => t.holderId === h.id).reduce((s, t) => s + t.amount, 0);
        const spending = expenses.filter((e) => e.holderId === h.id).reduce((s, e) => s + e.amount, 0);
        if (topups - spending < 0) pettyIssues.push(`${h.name}: topups ${fmt(topups)}, spending ${fmt(spending)}, balance ${fmt(topups - spending)}`);
      }
      results.push({ label: "Petty Cash Reconciliation", status: pettyIssues.length === 0 ? "pass" : "warn", detail: pettyIssues.length === 0 ? "All active holders have non-negative balances." : pettyIssues });

      // Check 6 — Unassigned imported expenses
      const unassigned = expenses.filter((e) => e.holderId === "unassigned").length;
      results.push({ label: "Unassigned Imported Expenses", status: unassigned === 0 ? "pass" : "warn", detail: unassigned === 0 ? "No unassigned expenses." : `${unassigned} expense(s) need holder assignment in Petty Cash tab.` });

      // Check 7 — Loan overpayment
      const loanIssues = [];
      for (const loan of loans) {
        const paid = loanPayments.filter((p) => p.loanId === loan.id).reduce((s, p) => s + p.amount, 0);
        if (paid > loan.principal) loanIssues.push(`${loan.lender}: principal ${fmt(loan.principal)}, paid ${fmt(paid)}`);
      }
      results.push({ label: "Loan Overpayment", status: loanIssues.length === 0 ? "pass" : "fail", detail: loanIssues.length === 0 ? "No loans overpaid." : loanIssues });

      setAuditResults(results);
      setAuditing(false);
    }, 0);
  }

  const passed = auditResults ? auditResults.filter((r) => r.status === "pass").length : 0;
  const warned = auditResults ? auditResults.filter((r) => r.status === "warn").length : 0;
  const failed = auditResults ? auditResults.filter((r) => r.status === "fail").length : 0;

  const card = { background: "#162030", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 20, marginBottom: 16 };
  const sectionTitle = { fontSize: 13, color: "#c8a86b", letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, margin: "0 0 16px 0" };
  const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, fontSize: 13, outline: "none", boxSizing: "border-box", marginBottom: 10 };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      {/* Section A — Change Password */}
      <div style={card}>
        <h3 style={sectionTitle}>Change Password</h3>
        <form onSubmit={handleChangePwd}>
          <label style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 3 }}>Current Password</label>
          <input type="password" value={curPwd} onChange={(e) => { setCurPwd(e.target.value); setPwdErr(""); }} style={inputStyle} autoComplete="current-password" />
          <label style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 3 }}>New Password</label>
          <input type="password" value={newPwd} onChange={(e) => { setNewPwd(e.target.value); setPwdErr(""); }} style={inputStyle} autoComplete="new-password" />
          <label style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", display: "block", marginBottom: 3 }}>Confirm New Password</label>
          <input type="password" value={confPwd} onChange={(e) => { setConfPwd(e.target.value); setPwdErr(""); }} style={{ ...inputStyle, marginBottom: 4 }} autoComplete="new-password" />
          {pwdErr && <div style={{ fontSize: 12, color: "#f87171", marginBottom: 10 }}>{pwdErr}</div>}
          <button type="submit" style={{ background: "#c8a86b", color: "#fff", border: "none", padding: "9px 20px", borderRadius: 5, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Update Password</button>
        </form>
      </div>

      {/* Section B — Activity Log */}
      <div style={card}>
        <h3 style={sectionTitle}>Activity Log <span style={{ fontWeight: 400, fontSize: 11, color: "rgba(255,255,255,0.25)" }}>({activityLog ? activityLog.length : 0} entries)</span></h3>
        {(!activityLog || activityLog.length === 0) ? (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>No activity recorded yet.</div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "rgba(255,255,255,0.45)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <th style={{ textAlign: "left", padding: "5px 8px", whiteSpace: "nowrap" }}>TIME</th>
                    <th style={{ textAlign: "left", padding: "5px 8px", whiteSpace: "nowrap" }}>ACTION</th>
                    <th style={{ textAlign: "left", padding: "5px 8px", whiteSpace: "nowrap" }}>TYPE</th>
                    <th style={{ textAlign: "left", padding: "5px 8px" }}>DESCRIPTION</th>
                  </tr>
                </thead>
                <tbody>
                  {[...activityLog].slice(0, actPage).map((entry) => {
                    const bc = entry.action === "add" ? "#34d399" : entry.action === "delete" ? "#f87171" : entry.action === "import" ? "#0d1e30" : entry.action === "undo" ? "#f59e0b" : entry.action === "migration" ? "rgba(255,255,255,0.45)" : "#f59e0b";
                    return (
                      <tr key={entry.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.45)", fontSize: 11, whiteSpace: "nowrap" }}>{new Date(entry.at).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}</td>
                        <td style={{ padding: "6px 8px" }}>
                          <span style={{ background: bc + "22", color: bc, border: `1px solid ${bc}44`, padding: "2px 7px", borderRadius: 3, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{entry.action}</span>
                        </td>
                        <td style={{ padding: "6px 8px", color: "rgba(255,255,255,0.45)", fontSize: 11 }}>{entry.type}</td>
                        <td style={{ padding: "6px 8px", color: "#e2e8f0", fontSize: 12 }}>{entry.description}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {activityLog.length > actPage && (
              <button onClick={() => setActPage((p) => p + 25)} style={{ marginTop: 12, background: "transparent", border: "1px solid rgba(200,168,107,0.3)", color: "#c8a86b", padding: "6px 16px", borderRadius: 4, fontSize: 12, cursor: "pointer" }}>
                Load more ({activityLog.length - actPage} remaining)
              </button>
            )}
          </>
        )}
      </div>

      {/* Section C — Financial Audit */}
      <div style={card}>
        <h3 style={sectionTitle}>Financial Audit</h3>
        <button onClick={runAudit} disabled={auditing} style={{ background: "#0d1e30", color: "#fff", border: "none", padding: "9px 20px", borderRadius: 5, fontSize: 13, fontWeight: 700, cursor: auditing ? "not-allowed" : "pointer", opacity: auditing ? 0.7 : 1, marginBottom: auditResults ? 16 : 0 }}>
          {auditing ? "Running..." : "Run Audit"}
        </button>
        {auditResults && (
          <>
            <div style={{ marginBottom: 12, fontSize: 13 }}>
              <span style={{ color: "#34d399", fontWeight: 700 }}>{passed} passed</span>
              {warned > 0 && <span style={{ color: "#f59e0b", fontWeight: 700 }}> · {warned} warning{warned !== 1 ? "s" : ""}</span>}
              {failed > 0 && <span style={{ color: "#f87171", fontWeight: 700 }}> · {failed} issue{failed !== 1 ? "s" : ""}</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {auditResults.map((r, i) => {
                const statusColor = r.status === "pass" ? "#34d399" : r.status === "warn" ? "#f59e0b" : "#f87171";
                const statusLabel = r.status === "pass" ? "PASS" : r.status === "warn" ? "WARN" : "FAIL";
                const detailArr = Array.isArray(r.detail) ? r.detail : null;
                return (
                  <div key={i} style={{ border: `1px solid ${statusColor}44`, borderRadius: 6, padding: "12px 16px", background: statusColor + "08" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: detailArr ? 8 : 2 }}>
                      <span style={{ background: statusColor, color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: 1, padding: "2px 8px", borderRadius: 3, minWidth: 36, textAlign: "center" }}>{statusLabel}</span>
                      <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>{r.label}</span>
                    </div>
                    {detailArr ? (
                      <ul style={{ margin: "4px 0 0 46px", padding: 0, fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
                        {detailArr.map((d, j) => <li key={j}>{d}</li>)}
                      </ul>
                    ) : (
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginLeft: 46 }}>{r.detail}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Section D — Import History */}
      <div style={{ background:"#162030", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, overflow:"hidden", marginBottom:16 }}>
        <div onClick={() => setImportHistoryOpen(o => !o)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 20px", cursor:"pointer" }}>
          <h3 style={{ fontSize:13, color:"#c8a86b", letterSpacing:1, textTransform:"uppercase", fontWeight:700, margin:0 }}>Import History</h3>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:11, background:"rgba(200,168,107,0.13)", color:"#c8a86b", border:"1px solid rgba(200,168,107,0.3)", padding:"2px 8px", borderRadius:3 }}>
              {importLogs ? importLogs.length : 0} import{(!importLogs || importLogs.length !== 1) ? "s" : ""}
            </span>
            <span style={{ fontSize:13, color:"#c8a86b" }}>{importHistoryOpen ? "▼" : "▶"}</span>
          </div>
        </div>
        {importHistoryOpen && importLogs && importLogs.length > 0 && (
          <div style={{ padding:"0 20px 20px", borderTop:"1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ overflowX:"auto", marginTop:14 }}>
              <table style={{ width:"100%", fontSize:12, borderCollapse:"collapse", minWidth:540 }}>
                <thead>
                  <tr style={{ color:"rgba(255,255,255,0.45)", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
                    <th style={{ textAlign:"left", padding:"6px 8px", whiteSpace:"nowrap" }}>IMPORTED AT</th>
                    <th style={{ textAlign:"left", padding:"6px 8px" }}>PERIOD</th>
                    <th style={{ textAlign:"left", padding:"6px 8px" }}>FILE</th>
                    <th style={{ textAlign:"right", padding:"6px 8px" }}>TRIPS</th>
                    <th style={{ textAlign:"right", padding:"6px 8px" }}>EXPENSES</th>
                    <th style={{ textAlign:"center", padding:"6px 8px" }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {importLogs.map(log => (
                    <tr key={log.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding:"8px", color:"rgba(255,255,255,0.45)", fontSize:11, whiteSpace:"nowrap" }}>
                        {new Date(log.importedAt).toLocaleString("en-US", { dateStyle:"short", timeStyle:"short" })}
                      </td>
                      <td style={{ padding:"8px", color:"#c8a86b", fontWeight:600 }}>{log.monthYear}</td>
                      <td style={{ padding:"8px", color:"rgba(255,255,255,0.45)", fontSize:11 }} title={log.fileName}>
                        {log.fileName.length > 28 ? log.fileName.slice(0,25)+"..." : log.fileName}
                      </td>
                      <td style={{ padding:"8px", textAlign:"right", color:"#34d399" }}>{log.summary.tripCount}</td>
                      <td style={{ padding:"8px", textAlign:"right", color:"#f59e0b" }}>{log.summary.expenseCount}</td>
                      <td style={{ padding:"8px", textAlign:"center" }}>
                        <button
                          onClick={() => setUndoTarget(log.id)}
                          style={{ background:"transparent", border:"1px solid rgba(248,113,113,0.4)", color:"#f87171", padding:"4px 10px", borderRadius:3, fontSize:11, cursor:"pointer" }}
                        >Undo</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {importHistoryOpen && (!importLogs || importLogs.length === 0) && (
          <div style={{ padding:"14px 20px", borderTop:"1px solid rgba(255,255,255,0.08)", fontSize:12, color:"rgba(255,255,255,0.45)" }}>No imports yet.</div>
        )}
      </div>

      {/* Undo confirmation inline */}
      {undoTarget && (
        <div style={{ background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.3)", borderRadius:8, padding:16, marginBottom:16 }}>
          <div style={{ fontSize:13, color:"#f87171", fontWeight:700, marginBottom:10 }}>Confirm undo import</div>
          <input type="password" placeholder="Enter admin code" value={undoPwd} onChange={e => setUndoPwd(e.target.value)}
            style={{ width:"100%", padding:"8px 10px", background:"#0f1c2a", border:`1px solid ${undoErr?"#f87171":"rgba(255,255,255,0.12)"}`, borderRadius:4, color:"#e2e8f0", fontSize:12, boxSizing:"border-box", marginBottom:8, fontFamily:"inherit" }} />
          {undoErr && <div style={{ fontSize:11, color:"#f87171", marginBottom:8 }}>{undoErr}</div>}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => { setUndoTarget(null); setUndoPwd(""); setUndoErr(""); }} style={{ background:"transparent", border:"1px solid rgba(255,255,255,0.12)", color:"rgba(255,255,255,0.5)", padding:"7px 16px", borderRadius:4, fontSize:12, cursor:"pointer" }}>Cancel</button>
            <button onClick={() => {
              if (undoPwd === appPassword) { undoImport(undoTarget); setUndoTarget(null); setUndoPwd(""); setUndoErr(""); showToast("Import undone!"); }
              else setUndoErr("Incorrect code");
            }} style={{ background:"#f87171", border:"none", color:"#fff", padding:"7px 16px", borderRadius:4, fontSize:12, fontWeight:700, cursor:"pointer" }}>Confirm Undo</button>
          </div>
        </div>
      )}

      {/* Section E — Danger Zone */}
      <div style={{ borderTop:"2px solid rgba(248,113,113,0.2)", paddingTop:20 }}>
        <div style={{ fontSize:11, color:"#f87171", fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:12 }}>Danger Zone</div>
        <div style={{ background:"rgba(248,113,113,0.05)", border:"1px solid rgba(248,113,113,0.2)", borderRadius:8, padding:16, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
          <div>
            <div style={{ fontSize:13, color:"#e2e8f0", fontWeight:600 }}>Reset All Data</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.45)", marginTop:4 }}>Permanently delete all trips, expenses, cash entries, loans, assets, capital, and import history.</div>
          </div>
          <button onClick={() => setShowReset(true)} style={{ background:"rgba(248,113,113,0.1)", border:"1px solid rgba(248,113,113,0.4)", color:"#f87171", padding:"10px 20px", borderRadius:6, fontSize:13, fontWeight:700, cursor:"pointer", flexShrink:0 }}>
            Reset All Data
          </button>
        </div>
        {showReset && (
          <div style={{ background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.3)", borderRadius:8, padding:16, marginTop:12 }}>
            <div style={{ fontSize:13, color:"#f87171", fontWeight:700, marginBottom:10 }}>Type admin code to confirm full reset</div>
            <input type="password" placeholder="Admin code" value={resetPwd} onChange={e => setResetPwd(e.target.value)}
              style={{ width:"100%", padding:"8px 10px", background:"#0f1c2a", border:`1px solid ${resetErr?"#f87171":"rgba(255,255,255,0.12)"}`, borderRadius:4, color:"#e2e8f0", fontSize:12, boxSizing:"border-box", marginBottom:8, fontFamily:"inherit" }} />
            {resetErr && <div style={{ fontSize:11, color:"#f87171", marginBottom:8 }}>{resetErr}</div>}
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => { setShowReset(false); setResetPwd(""); setResetErr(""); }} style={{ background:"transparent", border:"1px solid rgba(255,255,255,0.12)", color:"rgba(255,255,255,0.5)", padding:"7px 16px", borderRadius:4, fontSize:12, cursor:"pointer" }}>Cancel</button>
              <button onClick={() => {
                if (resetPwd !== appPassword) { setResetErr("Incorrect code"); return; }
                resetAll();
                showToast("All data has been reset.", "error");
                setShowReset(false); setResetPwd(""); setResetErr("");
              }} style={{ background:"#f87171", border:"none", color:"#fff", padding:"7px 16px", borderRadius:4, fontSize:12, fontWeight:700, cursor:"pointer" }}>Yes, Reset Everything</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const APP_PASSWORD = "808880";

// Module-level ref so LoginGate can always read the current runtime password
// without needing prop threading through App → LoginGate.
let _runtimePassword = APP_PASSWORD;

function LoginGate({ onSuccess }) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [focused, setFocused] = useState(false);

  function submit(e) {
    e.preventDefault();
    if (pwd === _runtimePassword) {
      setErr("");
      onSuccess();
    } else {
      setErr("Invalid code");
      setPwd("");
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0c1420", fontFamily: "'Inter', system-ui, -apple-system, sans-serif", padding: "24px" }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: "380px", display: "flex", flexDirection: "column", alignItems: "center", background: "#111e2e", borderRadius: 16, padding: "48px 36px 40px", boxShadow: "0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(200,168,107,0.15)", border: "none" }}>
        {/* Logo on white card */}
        <div style={{ background: "#fff", borderRadius: 14, padding: "16px 20px", marginBottom: 32, boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
          <img src="/logo-light.png" alt="Kin Kin Trukindo, Ltd." style={{ height: 88, width: "auto", objectFit: "contain", display: "block" }} />
        </div>
        {/* Brand name */}
        <h1 style={{ margin: "0 0 4px 0", fontFamily: "'Montserrat', sans-serif", fontSize: 20, fontWeight: 800, letterSpacing: 1, color: "#e2e8f0", textAlign: "center" }}>
          Kin Kin Trukindo
        </h1>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#c8a86b", letterSpacing: 3, textTransform: "uppercase", marginBottom: 32 }}>
          Freight &amp; Logistics
        </div>
        {/* Divider */}
        <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.07)", marginBottom: 24 }} />
        <p style={{ margin: "0 0 14px 0", color: "rgba(255,255,255,0.35)", fontSize: 11, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", textAlign: "center" }}>
          Authorization Required
        </p>
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus
          placeholder="Enter code"
          style={{
            width: "100%",
            padding: "13px 16px",
            background: "#0c1420",
            border: `1.5px solid ${focused ? "#c8a86b" : "rgba(255,255,255,0.1)"}`,
            borderRadius: 8,
            color: "#e2e8f0",
            fontSize: 16,
            textAlign: "center",
            letterSpacing: 4,
            outline: "none",
            boxSizing: "border-box",
            transition: "border-color 0.15s ease",
            fontFamily: "monospace",
          }}
        />
        {err && <div style={{ color: "#f87171", fontSize: 12, marginTop: 8, textAlign: "center", fontWeight: 600 }}>{err}</div>}
        <button
          type="submit"
          style={{
            width: "100%",
            marginTop: 16,
            padding: "13px",
            background: "linear-gradient(135deg, #c8a86b 0%, #b8945a 100%)",
            color: "#0c1420",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: 2,
            fontFamily: "'Montserrat', sans-serif",
            cursor: "pointer",
            textTransform: "uppercase",
            boxShadow: "0 4px 16px rgba(200,168,107,0.3)",
          }}
        >
          Authorize
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(false);
  if (!authed) return <LoginGate onSuccess={() => setAuthed(true)} />;
  return <KinKinApp />;
}
