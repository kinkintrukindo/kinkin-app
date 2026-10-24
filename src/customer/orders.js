const form = document.querySelector('#lookup');
const input = document.querySelector('#container');
const result = document.querySelector('#result');
const empty = document.querySelector('#empty');
const heading = document.querySelector('.results-head');
const count = document.querySelector('#count');
result.querySelector('tbody').replaceChildren();
empty.replaceChildren();
let generation = 0;
const normalize = value => value.replace(/[\s-]/g, '').toUpperCase();
async function search() {
  const current = ++generation;
  const container = normalize(input.value);
  input.value = container;
  heading.hidden = false;
  result.hidden = true;
  empty.hidden = false;
  count.textContent = '';
  if (!/^[A-Z0-9]{6,20}$/.test(container)) {
    empty.textContent = 'Please enter your full container number.';
    return;
  }
  empty.textContent = 'Finding your journey…';
  history.replaceState(null, '', `${location.pathname}?container=${encodeURIComponent(container)}`);
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
    count.textContent = `${rows.length} ${rows.length === 1 ? 'journey' : 'journeys'} found`;
    empty.textContent = 'No journey found. Check your container number or contact us for help.';
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
      button.className = 'download'; button.textContent = journey.invoice ? '↓ Download invoice' : 'Invoice pending';
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
        } catch { empty.hidden = false; empty.textContent = 'We could not create your invoice. Please try again or contact us.'; }
        finally { button.disabled = false; }
      });
      td.append(button); tr.append(td); tbody.append(tr);
    }
  } catch {
    if (current !== generation) return;
    empty.textContent = 'Order lookup is currently unavailable. Please try again later or contact us on WhatsApp.';
  }
}
form.addEventListener('submit', event => { event.preventDefault(); search(); });
const initial = new URLSearchParams(location.search).get('container');
if (initial) { input.value = initial; search(); }
