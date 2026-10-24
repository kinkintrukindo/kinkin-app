import { lookupCopy, supportedLanguage } from './lookup-copy.mjs';
const form = document.querySelector('#lookup');
const input = document.querySelector('#container');
const result = document.querySelector('#result');
const empty = document.querySelector('#empty');
const heading = document.querySelector('.results-head');
const count = document.querySelector('#count');
result.querySelector('tbody').replaceChildren();
empty.replaceChildren();
let generation = 0;
let language = supportedLanguage(new URLSearchParams(location.search).get('lang'));
let statusKey = '';
let resultRows = null;
const copy = () => lookupCopy[language];
function setStatus(key) { statusKey = key; empty.textContent = copy()[key]; }
function updateUrl() {
  const params = new URLSearchParams(location.search);
  params.set('lang', language);
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
function localize() {
  const t = copy();
  document.documentElement.lang = language;
  document.title = t.title;
  document.querySelectorAll('[data-copy]').forEach(el => { el.textContent = t[el.dataset.copy]; });
  input.placeholder = t.placeholder;
  document.querySelector('#back-link').textContent = t.back;
  document.querySelector('#back-link').href = `/?lang=${language}`;
  document.querySelector('.brand').href = `/?lang=${language}`;
  document.querySelectorAll('th').forEach((el, i) => { el.textContent = t.columns[i]; });
  document.querySelector('#lookup-language').value = language;
  if (statusKey) empty.textContent = t[statusKey];
  if (resultRows) count.textContent = t.found(resultRows.length);
  result.querySelectorAll('button').forEach(button => { button.textContent = button.dataset.pending === 'true' ? t.pending : t.download; });
}
document.querySelector('#lookup-language').addEventListener('change', event => {
  language = supportedLanguage(event.target.value); updateUrl(); localize();
});
localize();
const normalize = value => value.replace(/[\s-]/g, '').toUpperCase();
async function search() {
  const current = ++generation;
  const container = normalize(input.value);
  input.value = container;
  heading.hidden = false;
  result.hidden = true;
  empty.hidden = false;
  count.textContent = '';
  resultRows = null;
  if (!/^[A-Z0-9]{6,20}$/.test(container)) {
    setStatus('invalid');
    return;
  }
  setStatus('loading');
  history.replaceState(null, '', `${location.pathname}?container=${encodeURIComponent(container)}&lang=${language}`);
  try {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Unavailable');
    const response = await fetch(`${url}/rest/v1/rpc/kinkin_lookup_container`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_container: container }),
    });
    if (!response.ok) throw new Error('Unavailable');
    const rows = await response.json();
    if (current !== generation) return;
    if (!Array.isArray(rows)) throw new Error('Invalid response');
    resultRows = rows;
    count.textContent = copy().found(rows.length);
    setStatus('empty');
    empty.hidden = rows.length > 0;
    result.hidden = rows.length === 0;
    const tbody = result.querySelector('tbody');
    tbody.replaceChildren();
    for (const journey of rows) {
      const tr = document.createElement('tr');
      for (const value of [journey.date, journey.destination, journey.container, journey.plate, `Rp ${Number(journey.invoiced).toLocaleString('id-ID')}`]) {
        const td = document.createElement('td'); td.textContent = value || '—'; tr.append(td);
      }
      const td = document.createElement('td');
      const button = document.createElement('button');
      button.className = 'download'; button.dataset.pending = String(!journey.invoice); button.textContent = journey.invoice ? copy().download : copy().pending;
      button.disabled = !journey.invoice;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const { createInvoicePdf } = await import('./invoice.mjs');
          const assets = await Promise.all(['/logo-transparent.png', '/invoice-signature.png'].map(async path => {
            const asset = await fetch(path); if (!asset.ok) throw new Error('Missing invoice asset'); return asset.arrayBuffer();
          }));
          const bytes = await createInvoicePdf(journey, assets[0], { signatureBytes: assets[1] });
          const link = document.createElement('a'); const href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
          link.href = href; link.download = `Invoice-${journey.container}-${journey.date}.pdf`; link.click();
          setTimeout(() => URL.revokeObjectURL(href), 30000);
        } catch { empty.hidden = false; setStatus('downloadError'); }
        finally { button.disabled = false; }
      });
      td.append(button); tr.append(td); tbody.append(tr);
    }
  } catch {
    if (current !== generation) return;
    setStatus('unavailable');
  }
}
form.addEventListener('submit', event => { event.preventDefault(); search(); });
const initial = new URLSearchParams(location.search).get('container');
if (initial) { input.value = initial; search(); }
