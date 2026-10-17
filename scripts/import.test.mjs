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
