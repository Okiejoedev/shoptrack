import { sb, state, isManager, isOnline, pendingSales, branchName, refreshCore } from '../store.js';
import { esc, naira, icon, toast, modal, closeModal, fmtDateTime, todayISO, daysAgoISO, METHOD_LABEL, empty, needsOnline } from '../ui.js';
import { showReceipt } from './receipt.js';
import { toExcel, toPDF, invoicePDF } from '../export.js';

const f = { from: daysAgoISO(6), to: todayISO(), method: '', status: '', q: '' };
METHOD_LABEL.mixed = 'Mixed';
const STATUS = { paid: ['Paid', 'ok'], partial: ['Part-paid', 'warn'], credit: ['On credit', 'warn'], void: ['Void', 'danger'] };

export async function renderSales(el, ctx) {
  const pend = pendingSales();
  const pendingHtml = pend.length ? `<section class="card">
    <div class="card-head"><h2>Saved on this device, waiting to sync</h2><span class="pill warn">${pend.length}</span></div>
    <table class="table stack"><thead><tr><th>Time</th><th>Items</th><th>Customer</th><th>Method</th><th class="num">Total</th></tr></thead><tbody>
    ${pend.map((o) => `<tr><td>${fmtDateTime(o.created_at)}</td><td>${esc((o.meta?.items || []).map((i) => `${i.name} ×${i.qty}`).join(', '))}</td>
      <td>${esc(o.meta?.customer || 'Walk-in')}</td><td>${METHOD_LABEL[o.payload.p_method]}</td><td class="num"><strong>${esc(o.meta?.totalText || '')}</strong>
      ${o.status === 'failed' ? `<div class="text-danger small">${esc(o.error)}</div>` : ''}</td></tr>`).join('')}</tbody></table></section>` : '';

  if (!isOnline()) { el.innerHTML = pendingHtml + needsOnline('The full sales history'); return; }

  let q = sb.from('sales').select('*, customers(name, phone, address), profiles(full_name)')
    .gte('created_at', f.from + 'T00:00:00+01:00').lte('created_at', f.to + 'T23:59:59+01:00')
    .order('created_at', { ascending: false }).limit(500);
  if (state.branch !== 'all') q = q.eq('branch_id', state.branch);
  if (f.method) q = q.eq('payment_method', f.method);
  if (f.status) q = q.eq('status', f.status);
  const { data, error } = await q;
  if (error) throw error;
  if (!ctx.isCurrent()) return;
  const list = data.filter((s) => !f.q || String(s.receipt_no).includes(f.q) || (s.customers?.name || '').toLowerCase().includes(f.q.toLowerCase()));
  const live = list.filter((s) => s.status !== 'void');
  const tot = live.reduce((a, s) => a + Number(s.total), 0);
  const mgr = isManager();

  el.innerHTML = pendingHtml + `
  <div class="toolbar wrap">
    <label>From <input type="date" id="s-from" value="${f.from}"></label>
    <label>To <input type="date" id="s-to" value="${f.to}"></label>
    <select id="s-method" aria-label="Payment method"><option value="">All methods</option>${Object.entries(METHOD_LABEL).map(([k, v]) => `<option value="${k}" ${f.method === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <select id="s-status" aria-label="Status"><option value="">All statuses</option>${Object.entries(STATUS).map(([k, [v]]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <label class="search">${icon.search}<span class="sr-only">Search</span><input id="s-q" placeholder="Receipt # or customer" value="${esc(f.q)}"></label>
    <div class="grow"></div>
    <button class="btn ghost" id="s-xlsx">${icon.download}<span>Excel</span></button>
    <button class="btn ghost" id="s-pdf">${icon.download}<span>PDF</span></button>
  </div>
  <div class="summary-line"><strong>${live.length}</strong> sales · <strong>${naira(tot)}</strong>${mgr ? ` · profit <strong>${naira(live.reduce((a, s) => a + Number(s.profit), 0))}</strong>` : ''}${data.length >= 500 ? ' · showing the latest 500' : ''}</div>
  <div class="card flush"><div class="scroll"><table class="table stack clickable">
    <thead><tr><th>Receipt</th><th>Date</th><th>Type</th><th>Customer</th><th>Cashier</th><th>Method</th><th>Status</th><th class="num">Total</th>${mgr ? '<th class="num">Profit</th>' : ''}</tr></thead>
    <tbody>${list.length ? list.map((s) => `<tr data-sale="${s.id}" tabindex="0">
      <td><strong>#${s.receipt_no}</strong>${s.recorded_offline ? ' <span class="pill small" title="Recorded while offline">offline</span>' : ''}</td>
      <td>${fmtDateTime(s.created_at)}</td><td>${s.sale_mode === 'invoice' ? '<span class="pill">Invoice</span>' : 'Express'}</td><td>${esc(s.customers?.name || s.customer_name || 'Walk-in')}</td><td>${esc(s.profiles?.full_name || '')}</td>
      <td>${METHOD_LABEL[s.payment_method] || s.payment_method}</td><td><span class="pill ${STATUS[s.status][1]}">${STATUS[s.status][0]}</span></td>
      <td class="num"><strong>${naira(s.total)}</strong></td>${mgr ? `<td class="num">${naira(s.profit)}</td>` : ''}</tr>`).join('')
      : `<tr><td colspan="9">${empty('No sales in this range')}</td></tr>`}</tbody></table></div></div>`;

  const go = () => ctx.rerender();
  el.querySelector('#s-from').onchange = (e) => { f.from = e.target.value; go(); };
  el.querySelector('#s-to').onchange = (e) => { f.to = e.target.value; go(); };
  el.querySelector('#s-method').onchange = (e) => { f.method = e.target.value; go(); };
  el.querySelector('#s-status').onchange = (e) => { f.status = e.target.value; go(); };
  el.querySelector('#s-q').onchange = (e) => { f.q = e.target.value; go(); };
  const exportRows = () => list.map((s) => ({ Receipt: s.receipt_no, Date: fmtDateTime(s.created_at), Branch: branchName(s.branch_id), Customer: s.customers?.name || s.customer_name || 'Walk-in', Type: s.sale_mode === 'invoice' ? 'Invoice' : 'Express', 'Cash': Number(s.amount_paid) - Number(s.transfer_amount || 0), 'Transfer/POS': Number(s.transfer_amount || 0),
    Cashier: s.profiles?.full_name || '', Method: METHOD_LABEL[s.payment_method], Status: STATUS[s.status][0], Subtotal: Number(s.subtotal), Discount: Number(s.discount),
    Total: Number(s.total), Paid: Number(s.amount_paid), ...(mgr ? { Profit: Number(s.profit) } : {}) }));
  el.querySelector('#s-xlsx').onclick = () => toExcel(`sales-${f.from}-to-${f.to}`, [{ name: 'Sales', rows: exportRows() }]);
  el.querySelector('#s-pdf').onclick = () => toPDF(`sales-${f.from}-to-${f.to}`, 'Sales register', `${f.from} to ${f.to} · ${state.branch === 'all' ? 'All branches' : branchName(state.branch)}`,
    [{ header: '#', key: 'Receipt' }, { header: 'Date', key: 'Date' }, { header: 'Customer', key: 'Customer' }, { header: 'Method', key: 'Method' }, { header: 'Status', key: 'Status' }, { header: 'Total', key: 'TotalT', align: 'right' }],
    exportRows().map((r) => ({ ...r, TotalT: naira(r.Total) })), [['Sales', live.length], ['Revenue', naira(tot)], ['Average', naira(live.length ? tot / live.length : 0)]]);

  const open = (id) => openSale(data.find((s) => s.id === id), ctx);
  el.querySelectorAll('[data-sale]').forEach((r) => {
    r.addEventListener('click', () => open(r.dataset.sale));
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(r.dataset.sale); });
  });
}

async function openSale(s, ctx) {
  const { data: items } = await sb.from('sale_items').select('*').eq('sale_id', s.id);
  const r = { id: s.id, receipt_no: s.receipt_no, created_at: s.created_at, branch_id: s.branch_id, cashier: s.profiles?.full_name,
    items: (items || []).map((i) => ({ name: `${i.product_name} (${i.sold_unit || 'pack'})`, unit: i.sold_unit, qty: i.sold_qty ?? i.qty, unit_price: Number(i.sold_unit_price ?? i.unit_price) })),
    subtotal: Number(s.subtotal), discount: Number(s.discount), porter: Number(s.porter_charge || 0), total: Number(s.total) + Number(s.porter_charge || 0), amount_paid: Number(s.amount_paid), method: s.payment_method,
    methodText: s.payment_method === 'mixed' ? `Cash ${naira(Number(s.amount_paid) - Number(s.transfer_amount))} + transfer ${naira(s.transfer_amount)}` : null,
    customer: s.customers ? { name: s.customers.name, phone: s.customers.phone, address: s.customers.address } : (s.customer_name || s.customer_phone ? { name: s.customer_name || 'Customer', phone: s.customer_phone } : null),
    status: s.status, notes: s.note };
  showReceipt(r);
  const acts = document.querySelector('.receipt-actions');
  const inv = document.createElement('button'); inv.className = 'btn ghost'; inv.innerHTML = `${icon.download}<span>Invoice PDF</span>`;
  inv.onclick = () => invoicePDF(r); acts.prepend(inv);
  if (isManager() && s.status !== 'void') {
    const actions = document.querySelector('.receipt-actions');
    const b = document.createElement('button'); b.className = 'btn danger'; b.innerHTML = `${icon.trash}<span>Void sale</span>`;
    actions.prepend(b);
    b.onclick = () => voidSale(s, ctx);
  }
}

function voidSale(s, ctx) {
  const body = modal(`Void receipt #${s.receipt_no}?`, `<form class="form" id="vf">
    <p class="muted">Items go back into stock and any amount the customer owes for this sale is removed. This is logged.</p>
    <label>Reason<input name="reason" required placeholder="e.g. wrong item rung up"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn danger">Void sale</button></div></form>`);
  body.querySelector('#vf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await sb.rpc('void_sale', { p_sale: s.id, p_reason: e.target.reason.value });
    if (error) { toast(error.message, 'danger'); return; }
    await refreshCore(); closeModal(); toast(`Receipt #${s.receipt_no} voided`); ctx.rerender();
  });
}
