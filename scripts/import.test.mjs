import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function parseCSV('), source.indexOf('// ── XLSX download helper'));
const context = vm.createContext({});
vm.runInContext(`let nextId = 0; function genId() { return String(++nextId); }\n${helpers}`, context);
const { parseMonthlySheet, planMonthlyImport, selectMonthlyRows } = vm.runInContext('({parseMonthlySheet, planMonthlyImport, selectMonthlyRows})', context);

function sheet({ amount = 500, extra = 50, container = 'TEST1', date = '2026-08-03' } = {}) {
  return [
    ['NO', 'TANGGAL MUAT', 'NO INV', 'TUJUAN', 'NOPOL', 'NO CONT', 'SANGU', 'LAIN-LAIN', '', 'TOTAL', 'JUAL', 'PROFIT'],
    [1, date, '001/KK/VIII/2026', 'Depot', 'TEST-A', container, amount, 'TOLL', extra, 999, 1000, 1],
    ['', 'TOTAL'],
  ];
}
const parse = (rows) => parseMonthlySheet(rows, '2026-08-01');

test('costs and profit come from source components rather than stale cached totals', () => {
  const p = parse(sheet());
  assert.equal(p.trips[0].total, 550);
  assert.equal(p.trips[0].profit, 450);
});

test('legacy driver key formats all match current values without reinsertion', () => {
  const p = parse(sheet());
  for (const key of ['DRIVER:2026-08-03|SANGU|TEST-A|500', 'DRIVER:2026-08-03|SANGU|TEST-A|TEST1|500', 'DRIVER:2026-08-03|SANGU|TEST-A|TEST1|0|500']) {
    const existing = p.expenses.map((e) => ({ ...e, _importLineKey: undefined, _fpKey: key }));
    const plan = planMonthlyImport(p.trips, existing, parse(sheet()));
    assert.ok(plan.expensePlan.every((e) => e.action === 'skip'));
    assert.ok(plan.tripPlan.every((t) => t.action === 'skip'));
  }
});

test('re-import of corrected trip costs plans update and retains matching expenses', () => {
  const p = parse(sheet());
  const old = { ...p.trips[0], total: 500, profit: 500, lainAmt: 0, lainItems: [] };
  const plan = planMonthlyImport([old], p.expenses, p);
  assert.equal(plan.tripPlan[0].action, 'update');
  assert.equal(plan.tripPlan[0].before.id, old.id);
  assert.ok(plan.expensePlan.every((e) => e.action === 'skip'));
});

test('same-day equal expenses on separate containers are preserved by occurrence count', () => {
  const a = parse(sheet()); const b = parse(sheet({ container: 'TEST2' }));
  const both = { trips: [...a.trips, ...b.trips], expenses: [...a.expenses, ...b.expenses] };
  const first = planMonthlyImport(a.trips, a.expenses, both);
  assert.equal(first.expensePlan.filter((e) => e.action === 'add').length, 2);
  const second = planMonthlyImport(both.trips, both.expenses, both);
  assert.ok(second.expensePlan.every((e) => e.action === 'skip'));
});

test('known imported line gets an amount update rather than a duplicate', () => {
  const old = parse(sheet()); const updated = parse(sheet({ extra: 60 }));
  const p = planMonthlyImport(old.trips, old.expenses, updated);
  assert.equal(p.expensePlan[1].action, 'update');
  assert.equal(p.expensePlan[1].before.id, old.expenses[1].id);
});

test('ambiguous changed legacy amounts block the whole import', () => {
  const old = parse(sheet()); const updated = parse(sheet({ extra: 60 }));
  const legacy = old.expenses.map((e) => ({ ...e, _importLineKey: undefined }));
  assert.throws(() => planMonthlyImport(old.trips, legacy, updated), /Changed legacy expense/);
});

test('selects the requested monthly tab instead of the first invoice tab', () => {
  const rows = sheet();
  assert.equal(selectMonthlyRows([{ name: 'KK001', rows: [['INVOICE']] }, { name: 'AGST 2026', rows }, { name: 'SEPT 2026', rows: sheet({ date: '2026-09-03' }) }], '2026-08'), rows);
});

test('wrong-year, wrong-month and missing dates block import', () => {
  for (const date of ['2024-08-03', '2026-09-03', '']) assert.throws(() => parse(sheet({ date })), /date/);
});

test('repeated trip identifiers in one upload or database block import', () => {
  const p = parse(sheet());
  assert.throws(() => planMonthlyImport([], [], { ...p, trips: [...p.trips, ...p.trips] }), /Repeated trip/);
  assert.throws(() => planMonthlyImport([...p.trips, ...p.trips], [], p), /Multiple existing trips/);
});

 test('reordered equal expenses do not steal another container stable identity', () => {
  const a = parse(sheet()); const b = parse(sheet({ container: 'TEST2' }));
  const plan = planMonthlyImport(a.trips, a.expenses, { trips: [...b.trips, ...a.trips], expenses: [...b.expenses, ...a.expenses] });
  assert.deepEqual(Array.from(plan.expensePlan, (e) => e.action), ['add', 'add', 'skip', 'skip']);
});

const profitTrips = [{ date: '2026-08-03', nopol: 'TEST-A', jual: 1500, total: 500, profit: 1000 }];
const profitExpenses = [
  { date: '2026-08-03', truck: 'TEST-A', expenseType: 'driver', amount: 500 },
  { date: '2026-08-03', truck: 'TEST-A', expenseType: 'driver', amount: 500 },
  { date: '2026-08-01', truck: 'TEST-A', expenseType: 'truck', amount: 100 },
  { date: '2026-08-01', expenseType: 'overhead', amount: 50 },
];

test('truck profit does not deduct mirrored driver expenses or their duplicates', () => {
  const start = source.indexOf('  const truckStats = trucks.map');
  const calculation = source.slice(start, source.indexOf('  const expByCategory', start));
  const rows = vm.runInNewContext(`${calculation}\ntruckStats;`, { trips: profitTrips, expenses: profitExpenses, trucks: ['TEST-A'] });
  assert.equal(rows[0].profit, 900);
});

test('profit trend agrees with P&L after driver costs are counted once', () => {
  const start = source.indexOf('  const buildTimeSeries = () =>');
  const calculation = source.slice(start, source.indexOf('  const timeSeries =', start));
  const rows = vm.runInNewContext(`${calculation}\nbuildTimeSeries();`, { trips: profitTrips, expenses: profitExpenses, chartGranularity: 'monthly' });
  assert.equal(rows[0].grossProfit, 1000);
  assert.equal(rows[0].overhead, 50);
  assert.equal(rows[0].netProfit, 850);
});

const planTopupChange = vm.runInContext('planTopupChange', context);
const topups = [{ id: 't1', kasId: 'c1', holderId: 'h1', date: '2026-09-08', amount: 5000000 }];
const cashEntries = [{ id: 'c1', type: 'out', date: '2026-09-08', amount: 5000000 }, { id: 'receipt', type: 'in', amount: 100 }];
test('top-up edits synchronize date and amount without changing customer receipts', () => {
  const next = planTopupChange(topups, cashEntries, 't1', { date: '2026-09-09', amount: 2500000, note: 'Corrected', description: 'Petty cash top-up — test' });
  assert.equal(next.topups[0].amount, 2500000);
  assert.equal(next.cashEntries[0].amount, 2500000);
  assert.equal(next.cashEntries[0].date, next.topups[0].date);
  assert.equal(next.topups[0].kasId, 'c1');
  assert.deepEqual(next.cashEntries[1], cashEntries[1]);
  assert.equal(topups[0].amount, 5000000);
});
test('top-up deletion removes only the linked cash entry', () => {
  const next = planTopupChange(topups, cashEntries, 't1', null);
  assert.equal(next.topups.length, 0);
  assert.equal(next.cashEntries.length, 1);
  assert.equal(next.cashEntries[0].id, 'receipt');
});
test('missing, conflicting or reused cash links block mutations', () => {
  assert.throws(() => planTopupChange([{ ...topups[0], kasId: undefined }], cashEntries, 't1', null), /linked/);
  assert.throws(() => planTopupChange(topups, [{ ...cashEntries[0], amount: 1 }], 't1', null), /differ/);
  assert.throws(() => planTopupChange([...topups, { ...topups[0], id: 't2' }], cashEntries, 't1', null), /linked/);
});
test('invalid top-up amounts do not mutate either ledger', () => {
  for (const amount of [0, -1, NaN, Infinity]) assert.throws(() => planTopupChange(topups, cashEntries, 't1', { date: '2026-09-08', amount }), /positive/);
});

const { parseStructuredImport, readImportControls, buildImportReview } = vm.runInContext('({parseStructuredImport, readImportControls, buildImportReview})', context);
function structured() {
  return [
    {name:'Trips',rows:[['trip_id','date','invoice','truck','container','destination','revenue'],['T1','2026-08-03','001','TEST-A','C1','Depot',1000]]},
    {name:'Expenses',rows:[['expense_id','date','trip_id','truck','description','category','amount','paid_by','holder_id','cash_entry_id'],['E1','2026-08-03','T1','TEST-A','Fuel','Fuel',100,'petty_cash','h1','']]},
    {name:'Month Control',rows:[['month','holder_id','coverage_through','opening','transfers','spending','closing'],['2026-08','h1','2026-08-13',0,500,100,400]]},
  ];
}
function reviewInput() {
  const sheets=structured();
  return {trips:[],expenses:[],pettyTopups:[{id:'p1',holderId:'h1',date:'2026-08-01',amount:500,kasId:'k1'}],kas:[{id:'k1',type:'out',date:'2026-08-01',amount:500}],pettyHolders:[{id:'h1',active:true}],assets:[{nopol:'TEST-A'}],parsed:parseStructuredImport(sheets,'2026-08'),month:'2026-08',controls:readImportControls(sheets,'2026-08'),importLogs:[],acknowledged:true};
}
test('structured balanced import requires acknowledgment and repeats without inserts',()=>{
 const a=reviewInput(); assert.equal(buildImportReview({...a,acknowledged:false}).ready,false);
 const r=buildImportReview(a); assert.equal(r.ready,true, r.errors.join(';'));
 const repeated=buildImportReview({...a,trips:r.projectedTrips,expenses:r.projectedExpenses});
 assert.equal(repeated.ready,true);assert.ok([...repeated.plan.tripPlan,...repeated.plan.expensePlan].every(p=>p.action==='skip'));
});
test('control blank, arithmetic, source detail, opening and funding mismatches block',()=>{
 for(const controls of [{spending:''},{closing:401},{spending:101,closing:399},{opening:1,closing:401},{transfers:600,closing:500}]){
  const a=reviewInput();const r=buildImportReview({...a,controls:{...a.controls,...controls}});assert.equal(r.ready,false);assert.ok(r.errors.length);
 }
 assert.equal(buildImportReview({...reviewInput(),controls:null}).ready,true);
});
test('duplicate permanent IDs, malformed dates and missing trip references fail parsing',()=>{
 for(const mutate of [s=>s[1].rows.push([...s[1].rows[1]]),s=>s[0].rows[1][1]='2026-02-30',s=>s[1].rows[1][2]='missing',s=>s[1].rows[1][6]='oops']){
 const s=structured();mutate(s);assert.throws(()=>parseStructuredImport(s,'2026-08'));
 }
});
test('stable IDs update corrected values without duplication and reject cross-month moves',()=>{
 const a=reviewInput();const old=a.parsed;
 const sheets=structured();sheets[1].rows[1][6]=120;
 const corrected=parseStructuredImport(sheets,'2026-08');
 const p=planMonthlyImport(old.trips,old.expenses,corrected);
 assert.equal(p.tripPlan[0].action,'update');assert.equal(p.expensePlan[0].action,'update');
 assert.throws(()=>planMonthlyImport(old.trips.map(t=>({...t,date:'2026-07-03'})),old.expenses,corrected),/between months/);
});
test('unknown fleet, holder conflicts and transactions beyond cutoff block',()=>{
 const a=reviewInput();
 assert.equal(buildImportReview({...a,assets:[]}).ready,false);
 assert.equal(buildImportReview({...a,holderId:'other'}).ready,false);
 assert.equal(buildImportReview({...a,controls:{...a.controls,through:'2026-08-02'}}).ready,false);
});
test('partial imports retain later records without affecting period controls',()=>{
 const a=reviewInput();const later={id:'later',date:'2026-08-20',amount:50,holderId:'h1'};
 const r=buildImportReview({...a,expenses:[later]});assert.equal(r.ready,true);assert.ok(r.projectedExpenses.includes(later));
});
test('transfer date mismatch and reused cash links block even with equal totals',()=>{
 const a=reviewInput();assert.equal(buildImportReview({...a,controls:{...a.controls,transferRows:[{date:'2026-08-02',amount:500}]}}).ready,false);
 a.parsed.expenses[0]={...a.parsed.expenses[0],paidBy:'main_cash',holderId:'',cashEntryId:'k2'};
 a.controls={...a.controls,spending:0,closing:500};a.kas.push({id:'k2',type:'out',date:'2026-08-03',amount:100});
 assert.equal(buildImportReview(a).ready,true);
 assert.equal(buildImportReview({...a,expenses:[{id:'other',cashEntryId:'k2'}]}).ready,false);
});
test('negative balances require a reason but legacy format alone does not',()=>{
 const a=reviewInput();a.pettyTopups=[];a.kas=[];a.controls={...a.controls,transfers:0,closing:-100};
 assert.equal(buildImportReview(a).ready,false);assert.equal(buildImportReview({...a,reason:'Owner advance pending reconciliation'}).ready,true);
 const b=reviewInput();b.parsed.structured=false;
 assert.equal(buildImportReview(b).ready,true);assert.equal(buildImportReview(b).warnings.length,0);
});

test('trip-only imports remain unreconciled and repeat without duplicates',()=>{
 const a=reviewInput();a.controls=null;a.parsed.structured=false;
 const first=buildImportReview(a);assert.equal(first.ready,true);assert.equal(first.amounts,null);assert.equal(first.warnings.length,0);
 const trips=first.projectedTrips.map((t,i)=>({...t,id:`trip-${i}`}));
 const expenses=first.projectedExpenses.map((e,i)=>({...e,id:`expense-${i}`}));
 const second=buildImportReview({...a,trips,expenses,importLogs:[{monthYear:a.month,reconciliation:{holderId:'h1',amounts:null,status:'not_reconciled'}}]});
 assert.equal(second.ready,true);assert.ok([...second.plan.tripPlan,...second.plan.expensePlan].every(p=>p.action==='skip'));
 assert.equal(buildImportReview({...a,acknowledged:false}).ready,false);
});
test('trip-only edits to a reconciled month still require a reason',()=>{
 const a=reviewInput();a.controls=null;a.importLogs=[{monthYear:a.month,reconciliation:{holderId:'h1',amounts:{closing:400}}}];
 assert.equal(buildImportReview(a).ready,false);
 assert.equal(buildImportReview({...a,reason:'Corrected source trip costs'}).ready,true);
});
