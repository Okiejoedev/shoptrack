import { sb, state, stockAt, isManager, isOnline, recordRestock, refreshCore, branchName, sellBranch } from '../store.js';
import { esc, naira, num, icon, toast, modal, closeModal, formData, fmtDateTime, empty, uuid } from '../ui.js';
import { toExcel } from '../export.js';

const inv = { q: '', filter: 'all', cat: 'All' };
const REASON = { opening: 'Opening stock', sale: 'Sale', restock: 'Restock', adjustment: 'Adjustment / count', purchase: 'Purchase received', transfer_in: 'Transfer in', transfer_out: 'Transfer out', return: 'Return / void' };

export async function renderInventory(el, ctx) {
  const mgr = isManager();
  const all = state.branch === 'all';
  const branches = state.branches;
  const view = all ? null : state.branch;

  const rows = () => {
    const q = inv.q.toLowerCase();
    return state.products.filter((p) => {
      if (!p.active && inv.filter !== 'inactive') return false;
      if (inv.filter === 'inactive' && p.active) return false;
      const s = stockAt(p.id, view);
      if (inv.filter === 'low' && s > p.reorder_level) return false;
      if (inv.filter === 'out' && s > 0) return false;
      if (inv.cat !== 'All' && (p.category || 'General') !== inv.cat) return false;
      return !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q);
    });
  };
  const cats = ['All', ...new Set(state.products.map((p) => p.category || 'General'))];

  const totalValue = state.products.filter((p) => p.active).reduce((a, p) => a + Math.max(0, stockAt(p.id, view)) * Number(p.cost_price), 0);
  const retailValue = state.products.filter((p) => p.active).reduce((a, p) => a + Math.max(0, stockAt(p.id, view)) * Number(p.sell_price), 0);
  const low = state.products.filter((p) => p.active && stockAt(p.id, view) <= p.reorder_level).length;

  el.innerHTML = `
  <section class="kpis small">
    <div class="kpi"><div class="kpi-label">Products</div><div class="kpi-value">${state.products.filter((p) => p.active).length}</div></div>
    ${mgr ? `<div class="kpi"><div class="kpi-label">Stock value at cost</div><div class="kpi-value">${naira(totalValue)}</div></div>` : ''}
    <div class="kpi"><div class="kpi-label">Stock value at selling price</div><div class="kpi-value">${naira(retailValue)}</div></div>
    <div class="kpi"><div class="kpi-label">Low or out of stock</div><div class="kpi-value ${low ? 'warn-text' : ''}">${low}</div></div>
  </section>
  <div class="toolbar wrap">
    <label class="search">${icon.search}<span class="sr-only">Search</span><input id="inv-q" placeholder="Search name or SKU" value="${esc(inv.q)}"></label>
    <select id="inv-filter" aria-label="Filter">
      ${[['all', 'All active'], ['low', 'Low stock'], ['out', 'Out of stock'], ['inactive', 'Archived']].map(([k, v]) => `<option value="${k}" ${inv.filter === k ? 'selected' : ''}>${v}</option>`).join('')}
    </select>
    <select id="inv-cat" aria-label="Category">${cats.map((c) => `<option ${c === inv.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <div class="grow"></div>
    <button class="btn ghost" id="inv-export">${icon.download}<span>Excel</span></button>
    ${mgr ? `<button class="btn ghost" id="inv-transfer" ${isOnline() ? '' : 'disabled'}>${icon.transfer}<span>Transfer</span></button>
    <button class="btn primary" id="inv-add" ${isOnline() ? '' : 'disabled'}>${icon.plus}<span>Add product</span></button>` : ''}
  </div>
  <div class="card flush"><div class="scroll"><table class="table stack" id="inv-table"></table></div></div>`;

  const table = el.querySelector('#inv-table');
  const draw = () => {
    const list = rows();
    table.innerHTML = `<thead><tr><th>Product</th><th>Category</th>${mgr ? '<th class="num">Cost</th>' : ''}<th class="num">Price</th>${mgr ? '<th class="num">Margin</th>' : ''}
      ${all ? branches.map((b) => `<th class="num">${esc(b.name)}</th>`).join('') : ''}<th class="num">${all ? 'Total' : 'In stock'}</th><th class="num">Reorder at</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${list.length ? list.map((p) => {
        const s = stockAt(p.id, view);
        const m = Number(p.sell_price) - Number(p.cost_price);
        const status = s <= 0 ? '<span class="pill danger">Out</span>' : s <= p.reorder_level ? '<span class="pill warn">Low</span>' : '';
        return `<tr>
          <td><strong>${esc(p.name)}</strong> ${status}<div class="muted small">${esc(p.sku || '')} · per ${esc(p.unit)}</div></td>
          <td>${esc(p.category || 'General')}</td>
          ${mgr ? `<td class="num">${naira(p.cost_price)}</td>` : ''}<td class="num">${naira(p.sell_price)}</td>
          ${mgr ? `<td class="num">${naira(m)} <span class="muted small">${p.sell_price > 0 ? Math.round((m / p.sell_price) * 100) : 0}%</span></td>` : ''}
          ${all ? branches.map((b) => `<td class="num">${num(stockAt(p.id, b.id))}</td>`).join('') : ''}
          <td class="num"><strong>${num(s)}</strong></td><td class="num">${num(p.reorder_level)}</td>
          <td class="actions">
            <button class="btn small" data-restock="${p.id}">Restock</button>
            ${mgr ? `<button class="icon-btn small" data-count="${p.id}" aria-label="Stock count for ${esc(p.name)}" title="Stock count">${icon.check}</button>
            <button class="icon-btn small" data-edit="${p.id}" aria-label="Edit ${esc(p.name)}" title="Edit">${icon.edit}</button>` : ''}
            <button class="icon-btn small" data-history="${p.id}" aria-label="Stock history for ${esc(p.name)}" title="Stock history">${icon.history}</button>
          </td></tr>`;
      }).join('') : `<tr><td colspan="12">${empty('No products match this filter')}</td></tr>`}</tbody>`;
  };
  draw();

  el.querySelector('#inv-q').addEventListener('input', (e) => { inv.q = e.target.value; draw(); });
  el.querySelector('#inv-filter').addEventListener('change', (e) => { inv.filter = e.target.value; draw(); });
  el.querySelector('#inv-cat').addEventListener('change', (e) => { inv.cat = e.target.value; draw(); });
  el.querySelector('#inv-export').addEventListener('click', () => toExcel(`stock-${new Date().toISOString().slice(0, 10)}`, [{
    name: 'Stock', rows: rows().map((p) => ({
      Product: p.name, SKU: p.sku, Category: p.category, Unit: p.unit,
      ...(mgr ? { 'Cost price': Number(p.cost_price) } : {}), 'Selling price': Number(p.sell_price),
      ...Object.fromEntries(branches.map((b) => [b.name, stockAt(p.id, b.id)])), Total: stockAt(p.id, null), 'Reorder level': p.reorder_level,
      ...(mgr ? { 'Value at cost': Math.max(0, stockAt(p.id, null)) * Number(p.cost_price) } : {}),
    })),
  }]));
  el.querySelector('#inv-add')?.addEventListener('click', () => productForm(null, ctx));
  el.querySelector('#inv-transfer')?.addEventListener('click', () => transferForm(null, ctx));

  table.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.restock) restockForm(b.dataset.restock, ctx);
    if (b.dataset.count) countForm(b.dataset.count, ctx);
    if (b.dataset.edit) productForm(state.products.find((p) => p.id === b.dataset.edit), ctx);
    if (b.dataset.history) history(b.dataset.history);
  });
}

function branchOptions(selected) {
  return state.branches.map((b) => `<option value="${b.id}" ${b.id === selected ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
}

function restockForm(pid, ctx) {
  const p = state.products.find((x) => x.id === pid);
  const body = modal(`Restock ${p.name}`, `<form class="form" id="rs">
    <label>Branch<select name="branch" ${state.profile.role === 'cashier' ? 'disabled' : ''}>${branchOptions(sellBranch())}</select></label>
    <label>Quantity received (${esc(p.unit)}s)<input name="qty" type="number" min="1" required></label>
    <label>Note (supplier, invoice no.)<input name="note" placeholder="Optional"></label>
    <p class="muted small">Works offline. For goods from a supplier with a price, use a purchase order so the cost is recorded.</p>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Add to stock</button></div></form>`);
  body.querySelector('#rs').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    await recordRestock(pid, f.branch || sellBranch(), parseInt(f.qty, 10), f.note);
    closeModal(); toast(`${p.name} +${f.qty} ${isOnline() ? 'added' : 'saved offline, will sync'}`); ctx.rerender();
  });
}

function countForm(pid, ctx) {
  const p = state.products.find((x) => x.id === pid);
  const b0 = state.branch === 'all' ? sellBranch() : state.branch;
  const body = modal(`Stock count: ${p.name}`, `<form class="form" id="sc">
    <label>Branch<select name="branch" id="sc-b">${branchOptions(b0)}</select></label>
    <div class="muted" id="sc-sys">System says: <strong>${num(stockAt(pid, b0))}</strong></div>
    <label>Counted on the shelf<input name="counted" type="number" min="0" required></label>
    <label>Reason<select name="note"><option>Stock count</option><option>Damaged / expired</option><option>Theft / missing</option><option>Correction</option></select></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" ${isOnline() ? '' : 'disabled'}>Save count</button></div>
    ${isOnline() ? '' : '<p class="muted small">Stock counts need a connection.</p>'}</form>`);
  body.querySelector('#sc-b').addEventListener('change', (e) => { body.querySelector('#sc-sys').innerHTML = `System says: <strong>${num(stockAt(pid, e.target.value))}</strong>`; });
  body.querySelector('#sc').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const { data, error } = await sb.rpc('set_stock_count', { p_product: pid, p_branch: f.branch, p_counted: parseInt(f.counted, 10), p_note: f.note });
    if (error) { toast(error.message, 'danger'); return; }
    await refreshCore(); closeModal();
    toast(data.diff ? `Adjusted by ${data.diff > 0 ? '+' : ''}${data.diff}` : 'Count matches the system'); ctx.rerender();
  });
}

function transferForm(pid, ctx) {
  const [b1, b2] = state.branches;
  const body = modal('Transfer stock between branches', `<form class="form" id="tf">
    <label>Product<select name="product" required>${state.products.filter((p) => p.active).map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <div class="row gap"><label class="grow">From<select name="from">${branchOptions(b1?.id)}</select></label><label class="grow">To<select name="to">${branchOptions(b2?.id)}</select></label></div>
    <label>Quantity<input name="qty" type="number" min="1" required></label>
    <label>Note<input name="note" placeholder="e.g. driver name"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Transfer</button></div></form>`);
  body.querySelector('#tf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const { error } = await sb.rpc('transfer_stock', { p_product: f.product, p_from: f.from, p_to: f.to, p_qty: parseInt(f.qty, 10), p_note: f.note || null });
    if (error) { toast(error.message, 'danger'); return; }
    await refreshCore(); closeModal(); toast('Transfer recorded'); ctx.rerender();
  });
}

function productForm(p, ctx) {
  const isNew = !p;
  p = p || { name: '', sku: '', category: '', unit: 'unit', cost_price: '', sell_price: '', reorder_level: 5, active: true };
  const cats = [...new Set(state.products.map((x) => x.category).filter(Boolean))];
  const body = modal(isNew ? 'Add product' : `Edit ${p.name}`, `<form class="form" id="pf">
    <label>Name<input name="name" value="${esc(p.name)}" required></label>
    <div class="row gap"><label class="grow">SKU / barcode<input name="sku" value="${esc(p.sku || '')}"></label>
      <label class="grow">Category<input name="category" list="cats" value="${esc(p.category || '')}"><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label></div>
    <div class="row gap"><label class="grow">Unit<input name="unit" value="${esc(p.unit)}" placeholder="pack, bottle, bag"></label>
      <label class="grow">Reorder level<input name="reorder_level" type="number" min="0" value="${p.reorder_level}"></label></div>
    <div class="row gap"><label class="grow">Cost price (₦)<input name="cost_price" type="number" min="0" step="any" value="${p.cost_price}" required></label>
      <label class="grow">Selling price (₦)<input name="sell_price" type="number" min="0" step="any" value="${p.sell_price}" required></label></div>
    <div class="muted small" id="pf-margin"></div>
    ${isNew ? `<fieldset><legend>Opening stock</legend><div class="row gap">${state.branches.map((b) => `<label class="grow">${esc(b.name)}<input name="open_${b.id}" type="number" min="0" value="0"></label>`).join('')}</div></fieldset>`
      : `<label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Active (untick to archive)</label>`}
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">${isNew ? 'Add product' : 'Save changes'}</button></div></form>`);
  const form = body.querySelector('#pf');
  const m = () => {
    const c = Number(form.cost_price.value || 0), s = Number(form.sell_price.value || 0);
    body.querySelector('#pf-margin').textContent = s ? `Margin ${naira(s - c)} per ${form.unit.value || 'unit'} (${Math.round(((s - c) / s) * 100)}%)${s < c ? ' · selling below cost!' : ''}` : '';
  };
  form.addEventListener('input', m); m();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(form);
    const row = { name: f.name.trim(), sku: f.sku.trim() || null, category: f.category.trim() || 'General', unit: f.unit.trim() || 'unit',
      cost_price: Number(f.cost_price), sell_price: Number(f.sell_price), reorder_level: parseInt(f.reorder_level || '0', 10) };
    if (isNew) {
      const { data, error } = await sb.from('products').insert(row).select().single();
      if (error) { toast(error.message.includes('duplicate') ? 'That SKU is already used.' : error.message, 'danger'); return; }
      for (const b of state.branches) {
        const q = parseInt(f['open_' + b.id] || '0', 10);
        if (q > 0) await sb.rpc('record_stock_movement', { p_id: uuid(), p_product: data.id, p_branch: b.id, p_change: q, p_reason: 'opening', p_note: 'Opening stock' });
      }
    } else {
      row.active = !!f.active; row.updated_at = new Date().toISOString();
      const { error } = await sb.from('products').update(row).eq('id', p.id);
      if (error) { toast(error.message, 'danger'); return; }
    }
    await refreshCore(); closeModal(); toast(isNew ? 'Product added' : 'Saved'); ctx.rerender();
  });
}

async function history(pid) {
  const p = state.products.find((x) => x.id === pid);
  const body = modal(`Stock history: ${p.name}`, '<div class="loading">Loading…</div>', { wide: true });
  if (!isOnline()) { body.innerHTML = '<p class="muted">Stock history needs a connection.</p>'; return; }
  let q = sb.from('stock_movements').select('*, profiles(full_name)').eq('product_id', pid).order('created_at', { ascending: false }).limit(80);
  if (state.branch !== 'all') q = q.eq('branch_id', state.branch);
  const { data, error } = await q;
  if (error) { body.innerHTML = `<p class="text-danger">${esc(error.message)}</p>`; return; }
  body.innerHTML = `<div class="scroll"><table class="table stack"><thead><tr><th>When</th><th>Branch</th><th>What</th><th class="num">Change</th><th>By</th><th>Note</th></tr></thead>
    <tbody>${data.map((m) => `<tr><td>${fmtDateTime(m.created_at)}</td><td>${esc(branchName(m.branch_id))}</td><td>${REASON[m.reason] || m.reason}</td>
    <td class="num ${m.change < 0 ? 'text-danger' : 'text-ok'}"><strong>${m.change > 0 ? '+' : ''}${m.change}</strong></td><td>${esc(m.profiles?.full_name || '')}</td><td>${esc(m.note || '')}</td></tr>`).join('')}</tbody></table></div>`;
}
