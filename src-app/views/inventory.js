import { sb, state, stockAt, isManager, isOnline, recordRestock, refreshCore, branchName, storeId, warehouses, isWarehouse } from '../store.js';
import { esc, naira, icon, toast, modal, closeModal, formData, fmtDateTime, empty, fmtQty } from '../ui.js';
import { toExcel } from '../export.js';

const inv = { q: '', filter: 'all', cat: 'All' };
const REASON = { opening: 'Opening stock', sale: 'Sale', restock: 'Stock received', adjustment: 'Count / adjustment', purchase: 'Purchase order received',
  transfer_in: 'Moved in', transfer_out: 'Moved out', return: 'Returned / void' };

export async function bankOptions() {
  if (!isOnline() || !isManager()) return [];
  const { data } = await sb.from('bank_accounts').select('id, name, bank_name, balance').eq('active', true).order('name');
  return data || [];
}
export function paidFromSelect(banks, name = 'paid_from') {
  return `<label class="grow">Paid from<select name="${name}"><option value="">Cash</option>
    ${banks.map((b) => `<option value="${b.id}">${esc(b.name)}${b.bank_name ? ' · ' + esc(b.bank_name) : ''} (${naira(b.balance)})</option>`).join('')}</select></label>`;
}

export async function renderInventory(el, ctx) {
  const mgr = isManager();
  const locs = [...warehouses(), ...state.branches.filter((b) => b.kind === 'store')];
  const store = storeId();

  const rows = () => {
    const q = inv.q.toLowerCase();
    return state.products.filter((p) => {
      if (inv.filter === 'inactive') { if (p.active) return false; } else if (!p.active) return false;
      const total = stockAt(p.id, null);
      if (inv.filter === 'low' && stockAt(p.id, store) > p.reorder_level) return false;
      if (inv.filter === 'out' && total > 0) return false;
      if (inv.filter === 'noprice' && Number(p.sell_price) > 0) return false;
      if (inv.cat !== 'All' && (p.category || 'General') !== inv.cat) return false;
      return !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q);
    });
  };
  const cats = ['All', ...[...new Set(state.products.map((p) => p.category || 'General'))].sort()];
  const act = state.products.filter((p) => p.active);
  const valueAt = (bid) => act.reduce((a, p) => a + Math.max(0, stockAt(p.id, bid)) * Number(p.cost_price), 0);
  const cartonsAt = (bid) => act.reduce((a, p) => a + Math.floor(Math.max(0, stockAt(p.id, bid)) / p.packs_per_carton), 0);
  const lowStore = act.filter((p) => stockAt(p.id, store) <= p.reorder_level).length;

  el.innerHTML = `
  <section class="kpis small">
    ${locs.map((b) => `<div class="kpi"><div class="kpi-label">${esc(b.name)}</div><div class="kpi-value">${cartonsAt(b.id).toLocaleString()} ctn</div>
      <div class="muted small">${mgr ? naira(valueAt(b.id)) + ' at cost' : (b.kind === 'warehouse' ? 'Cartons only' : 'Cartons and packs')}</div></div>`).join('')}
    <div class="kpi"><div class="kpi-label">Store running low</div><div class="kpi-value ${lowStore ? 'warn-text' : ''}">${lowStore}</div><div class="muted small">at or below reorder level</div></div>
  </section>
  <div class="toolbar wrap">
    <label class="search">${icon.search}<span class="sr-only">Search</span><input id="inv-q" placeholder="Search products" value="${esc(inv.q)}"></label>
    <select id="inv-filter" aria-label="Filter">
      ${[['all', 'All products'], ['low', 'Low in store'], ['out', 'Out everywhere'], ['noprice', 'Price not set'], ['inactive', 'Archived']].map(([k, v]) => `<option value="${k}" ${inv.filter === k ? 'selected' : ''}>${v}</option>`).join('')}
    </select>
    <select id="inv-cat" aria-label="Category">${cats.map((c) => `<option ${c === inv.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <div class="grow"></div>
    <button class="btn ghost" id="inv-export">${icon.download}<span>Excel</span></button>
    ${mgr ? `<a class="btn primary" href="#/products">${icon.plus}<span>Add product</span></a>` : ''}
  </div>
  <div class="card flush"><div class="scroll"><table class="table stack" id="inv-table"></table></div></div>`;

  const table = el.querySelector('#inv-table');
  const draw = () => {
    const list = rows();
    table.innerHTML = `<thead><tr><th>Product</th><th class="num">Per carton</th>
      ${locs.map((b) => `<th class="num">${esc(b.name)}</th>`).join('')}<th class="num">Total</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${list.length ? list.map((p) => {
        const sStore = stockAt(p.id, store);
        const status = sStore <= 0 ? '<span class="pill danger">None in store</span>' : sStore <= p.reorder_level ? '<span class="pill warn">Low in store</span>' : '';
        return `<tr>
          <td><div class="row gap-s">${p.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt="">` : ''}<div><strong>${esc(p.name)}</strong> ${status}
            <div class="muted small">${esc(p.category || 'General')}${Number(p.sell_price) > 0 ? ` · ${naira(p.sell_price)}/pack` : ' · <span class="warn-text">price not set</span>'}</div></div></div></td>
          <td class="num">${p.packs_per_carton} pk</td>
          ${locs.map((b) => `<td class="num">${fmtQty(stockAt(p.id, b.id), p.packs_per_carton, b.kind === 'warehouse')}</td>`).join('')}
          <td class="num"><strong>${fmtQty(stockAt(p.id, null), p.packs_per_carton)}</strong></td>
          <td class="actions">
            <button class="btn small" data-receive="${p.id}">Receive</button>
            ${mgr ? `<button class="btn small" data-move="${p.id}">${icon.transfer}<span>Move</span></button>
            <button class="icon-btn small" data-count="${p.id}" aria-label="Stock count for ${esc(p.name)}" title="Stock count">${icon.check}</button>` : ''}
            <button class="icon-btn small" data-history="${p.id}" aria-label="Stock history for ${esc(p.name)}" title="Stock history">${icon.history}</button>
          </td></tr>`;
      }).join('') : `<tr><td colspan="9">${empty('No products match this filter')}</td></tr>`}</tbody>`;
  };
  draw();

  el.querySelector('#inv-q').addEventListener('input', (e) => { inv.q = e.target.value; draw(); });
  el.querySelector('#inv-filter').addEventListener('change', (e) => { inv.filter = e.target.value; draw(); });
  el.querySelector('#inv-cat').addEventListener('change', (e) => { inv.cat = e.target.value; draw(); });
  el.querySelector('#inv-export').addEventListener('click', () => toExcel(`stock-${new Date().toISOString().slice(0, 10)}`, [{
    name: 'Stock', rows: rows().map((p) => ({
      Product: p.name, Category: p.category, 'Packs per carton': p.packs_per_carton,
      ...Object.fromEntries(locs.map((b) => [`${b.name} (cartons)`, Math.floor(stockAt(p.id, b.id) / p.packs_per_carton)])),
      ...Object.fromEntries(locs.filter((b) => b.kind === 'store').map((b) => [`${b.name} (loose packs)`, stockAt(p.id, b.id) % p.packs_per_carton])),
      'Total packs': stockAt(p.id, null), 'Pack price': Number(p.sell_price),
      ...(mgr ? { 'Cost per carton': Number(p.cost_price) * p.packs_per_carton, 'Value at cost': Math.max(0, stockAt(p.id, null)) * Number(p.cost_price) } : {}),
    })),
  }]));

  table.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.receive) receiveForm(b.dataset.receive, ctx);
    if (b.dataset.move) moveForm(b.dataset.move, ctx);
    if (b.dataset.count) countForm(b.dataset.count, ctx);
    if (b.dataset.history) history(b.dataset.history);
  });
}

function locationOptions(selected, { onlyStore = false } = {}) {
  const locs = state.branches.filter((b) => !onlyStore || b.kind === 'store');
  return locs.map((b) => `<option value="${b.id}" ${b.id === selected ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
}

function receiveForm(pid, ctx) {
  const p = state.products.find((x) => x.id === pid);
  const mgr = isManager();
  const body = modal(`Receive stock: ${p.name}`, `<form class="form" id="rs">
    <label>Into<select name="loc" id="rs-loc">${locationOptions(mgr ? warehouses()[0]?.id : storeId(), { onlyStore: !mgr })}</select></label>
    <div class="row gap"><label class="grow">Cartons (${p.packs_per_carton} packs each)<input name="cartons" type="number" min="0" value="0"></label>
    <label class="grow" id="rs-packs-wrap">Loose packs<input name="packs" type="number" min="0" value="0"></label></div>
    <div class="muted small" id="rs-hint"></div>
    <label>Note (supplier, waybill no.)<input name="note" placeholder="Optional"></label>
    <p class="muted small">Goods bought on credit from a supplier? Use a purchase order instead so the debt is recorded.</p>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Add to stock</button></div></form>`);
  const f = body.querySelector('#rs');
  const sync = () => {
    const wh = isWarehouse(f.loc.value);
    body.querySelector('#rs-packs-wrap').style.display = wh || p.packs_per_carton === 1 ? 'none' : '';
    if (wh) f.packs.value = 0;
    const total = Number(f.cartons.value || 0) * p.packs_per_carton + Number(f.packs.value || 0);
    body.querySelector('#rs-hint').textContent = `${wh ? 'Warehouses hold full cartons only. ' : ''}Adds ${total} pack${total === 1 ? '' : 's'}.`;
  };
  f.addEventListener('input', sync); f.loc.addEventListener('change', sync); sync();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(f);
    const packs = Number(d.cartons || 0) * p.packs_per_carton + (isWarehouse(d.loc) ? 0 : Number(d.packs || 0));
    if (packs <= 0) { toast('Enter how many cartons or packs.', 'warn'); return; }
    await recordRestock(pid, d.loc, packs, d.note);
    closeModal(); toast(`${p.name}: +${fmtQty(packs, p.packs_per_carton)} into ${branchName(d.loc)}${isOnline() ? '' : ' (saved offline)'}`); ctx.rerender();
  });
}

async function moveForm(pid, ctx) {
  if (!isOnline()) { toast('Moving stock needs a connection.', 'warn'); return; }
  const p = state.products.find((x) => x.id === pid);
  const banks = await bankOptions();
  const [w1] = warehouses();
  const body = modal(`Move ${p.name}`, `<form class="form" id="mv">
    <div class="row gap"><label class="grow">From<select name="from" id="mv-from">${locationOptions(w1?.id)}</select></label>
      <label class="grow">To<select name="to">${locationOptions(storeId())}</select></label></div>
    <div class="muted small" id="mv-have"></div>
    <label>Cartons to move (${p.packs_per_carton} packs each)<input name="cartons" type="number" min="1" required></label>
    <fieldset><legend>Market porter (optional)</legend>
      <div class="row gap wrap"><label class="grow">Porter / mallam name<input name="porter" placeholder="e.g. Mallam Musa"></label>
      <label class="grow">Amount paid (₦)<input name="fee" type="number" min="0" step="any" placeholder="0"></label>
      ${paidFromSelect(banks, 'bank')}</div></fieldset>
    <label>Note<input name="note" placeholder="Optional"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Move stock</button></div></form>`);
  const f = body.querySelector('#mv');
  const have = () => { body.querySelector('#mv-have').textContent = `${branchName(f.from.value)} has ${fmtQty(stockAt(pid, f.from.value), p.packs_per_carton)}.`; };
  f.from.addEventListener('change', have); have();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(f);
    const { error } = await sb.rpc('transfer_stock', { p_product: pid, p_from: d.from, p_to: d.to, p_cartons: parseInt(d.cartons, 10), p_note: d.note || null,
      p_porter_fee: d.fee ? Number(d.fee) : null, p_porter: d.porter || null, p_bank: d.bank || null });
    if (error) { toast(error.message, 'danger'); return; }
    await refreshCore(); closeModal();
    toast(`Moved ${d.cartons} ctn ${branchName(d.from)} → ${branchName(d.to)}${d.fee ? ` · porter ${naira(d.fee)} recorded` : ''}`); ctx.rerender();
  });
}

function countForm(pid, ctx) {
  const p = state.products.find((x) => x.id === pid);
  const body = modal(`Stock count: ${p.name}`, `<form class="form" id="sc">
    <label>Location<select name="loc" id="sc-loc">${locationOptions(storeId())}</select></label>
    <div class="muted" id="sc-sys"></div>
    <div class="row gap"><label class="grow">Cartons counted<input name="cartons" type="number" min="0" value="0"></label>
    <label class="grow" id="sc-packs-wrap">Loose packs counted<input name="packs" type="number" min="0" value="0"></label></div>
    <label>Reason<select name="note"><option>Stock count</option><option>Damaged / expired</option><option>Missing</option><option>Correction</option></select></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" ${isOnline() ? '' : 'disabled'}>Save count</button></div>
    ${isOnline() ? '' : '<p class="muted small">Stock counts need a connection.</p>'}</form>`);
  const f = body.querySelector('#sc');
  const sync = () => {
    const wh = isWarehouse(f.loc.value);
    body.querySelector('#sc-packs-wrap').style.display = wh || p.packs_per_carton === 1 ? 'none' : '';
    body.querySelector('#sc-sys').innerHTML = `System says: <strong>${fmtQty(stockAt(pid, f.loc.value), p.packs_per_carton)}</strong>`;
  };
  f.loc.addEventListener('change', sync); sync();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(f);
    const counted = Number(d.cartons || 0) * p.packs_per_carton + (isWarehouse(d.loc) ? 0 : Number(d.packs || 0));
    const { data, error } = await sb.rpc('set_stock_count', { p_product: pid, p_branch: d.loc, p_counted: counted, p_note: d.note });
    if (error) { toast(error.message, 'danger'); return; }
    await refreshCore(); closeModal();
    toast(data.diff ? `Adjusted by ${data.diff > 0 ? '+' : ''}${data.diff} packs` : 'Count matches the system'); ctx.rerender();
  });
}

async function history(pid) {
  const p = state.products.find((x) => x.id === pid);
  const body = modal(`Stock history: ${p.name}`, '<div class="loading">Loading…</div>', { wide: true });
  if (!isOnline()) { body.innerHTML = '<p class="muted">Stock history needs a connection.</p>'; return; }
  const { data, error } = await sb.from('stock_movements').select('*, profiles(full_name)').eq('product_id', pid).order('created_at', { ascending: false }).limit(100);
  if (error) { body.innerHTML = `<p class="text-danger">${esc(error.message)}</p>`; return; }
  body.innerHTML = data.length ? `<div class="scroll"><table class="table stack"><thead><tr><th>When</th><th>Location</th><th>What</th><th class="num">Change</th><th>By</th><th>Note</th></tr></thead>
    <tbody>${data.map((m) => `<tr><td>${fmtDateTime(m.created_at)}</td><td>${esc(branchName(m.branch_id))}</td><td>${REASON[m.reason] || m.reason}</td>
    <td class="num ${m.change < 0 ? 'text-danger' : 'text-ok'}"><strong>${m.change > 0 ? '+' : '−'}${fmtQty(Math.abs(m.change), p.packs_per_carton)}</strong></td><td>${esc(m.profiles?.full_name || '')}</td><td>${esc(m.note || '')}</td></tr>`).join('')}</tbody></table></div>`
    : empty('No stock movements yet');
}
