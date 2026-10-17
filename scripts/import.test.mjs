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
