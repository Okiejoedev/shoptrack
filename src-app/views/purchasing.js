import { sb, state, isOnline, refreshCore, branchName, sellBranch } from '../store.js';
import { esc, naira, num, icon, toast, modal, closeModal, formData, fmtDate, fmtDateTime, empty, needsOnline, confirmBox, waLink, METHOD_LABEL } from '../ui.js';
import { toPDF } from '../export.js';

let tab = 'orders';
const PO_STATUS = { draft: ['Draft', ''], ordered: ['Ordered', 'warn'], received: ['Received', 'ok'], cancelled: ['Cancelled', 'danger'] };

export async function renderPurchasing(el, ctx) {
  if (!isOnline()) { el.innerHTML = needsOnline('Purchasing'); return; }
  const fromReorder = location.hash.includes('from=reorder');
  const [pos, sups] = await Promise.all([
    sb.from('purchase_orders').select('*, suppliers(name, phone), purchase_order_items(*, products(name, unit))').order('created_at', { ascending: false }).limit(100),
    sb.from('suppliers').select('*').order('name'),
  ]);
  if (pos.error) throw pos.error;
  if (!ctx.isCurrent()) return;
  const suppliers = sups.data || [];
  const orders = (pos.data || []).filter((p) => state.branch === 'all' || p.branch_id === state.branch);
  const openValue = orders.filter((o) => ['draft', 'ordered'].includes(o.status)).reduce((a, o) => a + Number(o.total), 0);
  const owed = suppliers.reduce((a, s) => a + Math.max(0, Number(s.balance)), 0);

  el.innerHTML = `
  <section class="kpis small">
    <div class="kpi"><div class="kpi-label">Open orders</div><div class="kpi-value">${orders.filter((o) => ['draft', 'ordered'].includes(o.status)).length}</div><div class="muted small">${naira(openValue)} on order</div></div>
    <div class="kpi"><div class="kpi-label">You owe suppliers</div><div class="kpi-value warn-text">${naira(owed)}</div></div>
    <div class="kpi"><div class="kpi-label">Suppliers</div><div class="kpi-value">${suppliers.length}</div></div>
  </section>
  <div class="toolbar">
    <div class="seg" role="tablist">
      <button role="tab" class="${tab === 'orders' ? 'on' : ''}" aria-selected="${tab === 'orders'}" data-tab="orders">Purchase orders</button>
      <button role="tab" class="${tab === 'suppliers' ? 'on' : ''}" aria-selected="${tab === 'suppliers'}" data-tab="suppliers">Suppliers</button>
    </div>
    <div class="grow"></div>
    ${tab === 'orders' ? `<button class="btn ghost" id="po-reorder">${icon.sparkle}<span>From reorder suggestions</span></button>
      <button class="btn primary" id="po-new">${icon.plus}<span>New purchase order</span></button>`
      : `<button class="btn primary" id="sup-new">${icon.plus}<span>Add supplier</span></button>`}
  </div>
  <div id="pur-body"></div>`;
  const body = el.querySelector('#pur-body');

  if (tab === 'orders') {
    body.innerHTML = `<div class="card flush"><div class="scroll"><table class="table stack">
      <thead><tr><th>PO</th><th>Supplier</th><th>Branch</th><th>Items</th><th>Expected</th><th>Status</th><th class="num">Total</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${orders.length ? orders.map((o) => `<tr>
        <td><strong>PO-${o.po_no}</strong><div class="muted small">${fmtDate(o.created_at)}</div></td>
        <td>${esc(o.suppliers?.name)}</td><td>${esc(branchName(o.branch_id))}</td>
        <td class="small">${esc(o.purchase_order_items.map((i) => `${i.products?.name} ×${i.qty}`).join(', '))}</td>
        <td>${o.expected_date ? fmtDate(o.expected_date) : '—'}</td>
        <td><span class="pill ${PO_STATUS[o.status][1]}">${PO_STATUS[o.status][0]}</span></td>
        <td class="num"><strong>${naira(o.total)}</strong></td>
        <td class="actions">
          ${o.status === 'draft' ? `<button class="btn small" data-order="${o.id}">Mark ordered</button>` : ''}
          ${['draft', 'ordered'].includes(o.status) ? `<button class="btn small primary" data-receive="${o.id}">Receive goods</button>` : ''}
          ${o.suppliers?.phone && o.status !== 'received' ? `<a class="icon-btn small" target="_blank" rel="noopener" title="Send to supplier on WhatsApp" aria-label="Send PO-${o.po_no} on WhatsApp" href="${waLink(o.suppliers.phone, poText(o))}">${icon.whatsapp}</a>` : ''}
          <button class="icon-btn small" data-pdf="${o.id}" title="Download PDF" aria-label="Download PO-${o.po_no} as PDF">${icon.download}</button>
          ${['draft', 'ordered'].includes(o.status) ? `<button class="icon-btn small" data-cancel="${o.id}" title="Cancel order" aria-label="Cancel PO-${o.po_no}">${icon.x}</button>` : ''}
        </td></tr>`).join('') : `<tr><td colspan="8">${empty('No purchase orders yet')}</td></tr>`}</tbody></table></div></div>`;
  } else {
    body.innerHTML = `<div class="card flush"><div class="scroll"><table class="table stack">
      <thead><tr><th>Supplier</th><th>Contact</th><th>Phone</th><th class="num">You owe</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${suppliers.length ? suppliers.map((s) => `<tr><td><strong>${esc(s.name)}</strong><div class="muted small">${esc(s.address || '')}</div></td>
        <td>${esc(s.contact_person || '')}</td><td>${esc(s.phone || '')}</td><td class="num"><strong class="${s.balance > 0 ? 'warn-text' : ''}">${naira(s.balance)}</strong></td>
        <td class="actions">${s.balance > 0 ? `<button class="btn small primary" data-paysup="${s.id}">Pay</button>` : ''}
        <button class="icon-btn small" data-editsup="${s.id}" aria-label="Edit ${esc(s.name)}">${icon.edit}</button></td></tr>`).join('')
        : `<tr><td colspan="5">${empty('No suppliers yet')}</td></tr>`}</tbody></table></div></div>`;
  }

  el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; ctx.rerender(); });
  el.querySelector('#po-new')?.addEventListener('click', () => poForm(suppliers, [], ctx));
  el.querySelector('#po-reorder')?.addEventListener('click', () => fromSuggestions(suppliers, ctx));
  el.querySelector('#sup-new')?.addEventListener('click', () => supplierForm(null, ctx));
  if (fromReorder && tab === 'orders') { history.replaceState(null, '', '#/purchasing'); fromSuggestions(suppliers, ctx); }

  body.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const o = orders.find((x) => x.id === (b.dataset.order || b.dataset.receive || b.dataset.pdf || b.dataset.cancel));
    if (b.dataset.order) { await sb.from('purchase_orders').update({ status: 'ordered' }).eq('id', o.id); toast(`PO-${o.po_no} marked as ordered`); ctx.rerender(); }
    if (b.dataset.receive) {
      if (!(await confirmBox(`Receive PO-${o.po_no}?`, `This adds every item on the order to ${branchName(o.branch_id)} stock, updates cost prices and adds ${naira(o.total)} to what you owe ${o.suppliers?.name}.`, 'Receive goods'))) return;
      const { error } = await sb.rpc('receive_purchase_order', { p_po: o.id });
      if (error) { toast(error.message, 'danger'); return; }
      await refreshCore(); toast('Goods received into stock'); ctx.rerender();
    }
    if (b.dataset.cancel) {
      if (!(await confirmBox(`Cancel PO-${o.po_no}?`, 'The order will be kept for your records but marked cancelled.', 'Cancel order', true))) return;
      await sb.from('purchase_orders').update({ status: 'cancelled' }).eq('id', o.id); ctx.rerender();
    }
    if (b.dataset.pdf) {
      toPDF(`PO-${o.po_no}`, `Purchase order PO-${o.po_no}`, `To ${o.suppliers?.name} · deliver to ${branchName(o.branch_id)} branch${o.expected_date ? ' by ' + fmtDate(o.expected_date) : ''}`,
        [{ header: 'Item', key: 'item' }, { header: 'Qty', key: 'qty', align: 'right' }, { header: 'Unit cost', key: 'cost', align: 'right' }, { header: 'Amount', key: 'amt', align: 'right' }],
        o.purchase_order_items.map((i) => ({ item: i.products?.name, qty: `${i.qty} ${i.products?.unit || ''}`, cost: naira(i.unit_cost), amt: naira(i.qty * i.unit_cost) })),
        [['Total', naira(o.total)], ['Status', PO_STATUS[o.status][0]], ['Date', fmtDate(o.created_at)]]);
    }
    if (b.dataset.paysup) paySupplier(suppliers.find((s) => s.id === b.dataset.paysup), ctx);
    if (b.dataset.editsup) supplierForm(suppliers.find((s) => s.id === b.dataset.editsup), ctx);
  });
}

function poText(o) {
  return `Hello ${o.suppliers?.name}, this is ${state.settings.business_name}. Purchase order PO-${o.po_no}:\n` +
    o.purchase_order_items.map((i) => `• ${i.products?.name} × ${i.qty} @ ${naira(i.unit_cost)}`).join('\n') +
    `\nTotal: ${naira(o.total)}\nDeliver to: ${branchName(o.branch_id)} branch${o.expected_date ? ' by ' + fmtDate(o.expected_date) : ''}. Thank you.`;
}

async function fromSuggestions(suppliers, ctx) {
  const br = state.branch === 'all' ? sellBranch() : state.branch;
  const { data } = await sb.rpc('reorder_suggestions', { p_branch: br });
  const lines = (data || []).filter((r) => r.suggested_qty > 0).map((r) => ({ product_id: r.product_id, qty: r.suggested_qty,
    unit_cost: Number(state.products.find((p) => p.id === r.product_id)?.cost_price || 0) }));
  if (!lines.length) { toast('Nothing needs reordering right now.'); return; }
  poForm(suppliers, lines, ctx, br);
}

function poForm(suppliers, lines, ctx, branch) {
  if (!suppliers.length) { toast('Add a supplier first.', 'warn'); tab = 'suppliers'; ctx.rerender(); return; }
  const prodOpts = (sel) => state.products.filter((p) => p.active).map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const lineHtml = (l = {}) => `<div class="po-line">
    <select name="product" aria-label="Product">${prodOpts(l.product_id)}</select>
    <input name="qty" type="number" min="1" value="${l.qty || 1}" aria-label="Quantity">
    <input name="cost" type="number" min="0" step="any" value="${l.unit_cost ?? ''}" placeholder="Unit cost" aria-label="Unit cost">
    <button type="button" class="icon-btn small" data-rm aria-label="Remove line">${icon.x}</button></div>`;
  const body = modal('New purchase order', `<form class="form" id="po">
    <div class="row gap"><label class="grow">Supplier<select name="supplier">${suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label class="grow">Deliver to<select name="branch">${state.branches.map((b) => `<option value="${b.id}" ${b.id === (branch || sellBranch()) ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
      <label>Expected<input name="expected" type="date"></label></div>
    <div class="po-head"><span>Product</span><span>Qty</span><span>Unit cost (₦)</span><span></span></div>
    <div id="po-lines">${(lines.length ? lines : [{}]).map(lineHtml).join('')}</div>
    <button type="button" class="btn ghost small" id="po-addline">${icon.plus}<span>Add line</span></button>
    <div class="row between"><span class="muted">Order total</span><strong id="po-total">₦0</strong></div>
    <label>Notes<input name="notes"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button>
    <button class="btn" name="as" value="draft">Save draft</button><button class="btn primary" name="as" value="ordered">Save as ordered</button></div></form>`, { wide: true });
  const form = body.querySelector('#po'); const wrap = body.querySelector('#po-lines');
  const fillCost = (row) => { const sel = row.querySelector('[name=product]'); const c = row.querySelector('[name=cost]'); if (!c.value) c.value = state.products.find((p) => p.id === sel.value)?.cost_price || ''; };
  const total = () => {
    let t = 0; wrap.querySelectorAll('.po-line').forEach((r) => { t += Number(r.querySelector('[name=qty]').value || 0) * Number(r.querySelector('[name=cost]').value || 0); });
    body.querySelector('#po-total').textContent = naira(t);
  };
  wrap.querySelectorAll('.po-line').forEach(fillCost); total();
  body.querySelector('#po-addline').onclick = () => { wrap.insertAdjacentHTML('beforeend', lineHtml()); fillCost(wrap.lastElementChild); total(); };
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-rm]') && wrap.children.length > 1) { e.target.closest('.po-line').remove(); total(); } });
  wrap.addEventListener('change', (e) => { if (e.target.name === 'product') { const r = e.target.closest('.po-line'); r.querySelector('[name=cost]').value = ''; fillCost(r); } total(); });
  wrap.addEventListener('input', total);
  let submitAs = 'ordered';
  form.querySelectorAll('button[name=as]').forEach((b) => b.addEventListener('click', () => { submitAs = b.value; }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(form);
    const items = [...wrap.querySelectorAll('.po-line')].map((r) => ({ product_id: r.querySelector('[name=product]').value,
      qty: parseInt(r.querySelector('[name=qty]').value || '0', 10), unit_cost: Number(r.querySelector('[name=cost]').value || 0) })).filter((i) => i.qty > 0);
    if (!items.length) { toast('Add at least one item.', 'warn'); return; }
    const tot = items.reduce((a, i) => a + i.qty * i.unit_cost, 0);
    const { data, error } = await sb.from('purchase_orders').insert({ supplier_id: f.supplier, branch_id: f.branch, status: submitAs, expected_date: f.expected || null, notes: f.notes || null, total: tot }).select().single();
    if (error) { toast(error.message, 'danger'); return; }
    const r2 = await sb.from('purchase_order_items').insert(items.map((i) => ({ ...i, po_id: data.id })));
    if (r2.error) { toast(r2.error.message, 'danger'); return; }
    closeModal(); toast(`PO-${data.po_no} created`); tab = 'orders'; ctx.rerender();
  });
}

function supplierForm(s, ctx) {
  const isNew = !s; s = s || {};
  const body = modal(isNew ? 'Add supplier' : `Edit ${s.name}`, `<form class="form" id="sf">
    <label>Business name<input name="name" value="${esc(s.name || '')}" required></label>
    <div class="row gap"><label class="grow">Contact person<input name="contact_person" value="${esc(s.contact_person || '')}"></label>
    <label class="grow">Phone<input name="phone" inputmode="tel" value="${esc(s.phone || '')}"></label></div>
    <label>Address<input name="address" value="${esc(s.address || '')}"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">${isNew ? 'Add supplier' : 'Save'}</button></div></form>`);
  body.querySelector('#sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const row = { name: f.name, contact_person: f.contact_person || null, phone: f.phone || null, address: f.address || null };
    const { error } = isNew ? await sb.from('suppliers').insert(row) : await sb.from('suppliers').update(row).eq('id', s.id);
    if (error) { toast(error.message, 'danger'); return; }
    closeModal(); toast('Saved'); ctx.rerender();
  });
}

function paySupplier(s, ctx) {
  const body = modal(`Pay ${s.name}`, `<form class="form" id="ps">
    <p>You owe <strong>${naira(s.balance)}</strong></p>
    <label>Amount (₦)<input name="amount" type="number" min="1" step="any" value="${s.balance}" required></label>
    <label>Method<select name="method">${['transfer', 'cash', 'pos'].map((m) => `<option value="${m}">${METHOD_LABEL[m]}</option>`).join('')}</select></label>
    <label>Reference / note<input name="note"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Record payment</button></div></form>`);
  body.querySelector('#ps').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const { error } = await sb.rpc('pay_supplier', { p_supplier: s.id, p_amount: Number(f.amount), p_method: f.method, p_note: f.note || null });
    if (error) { toast(error.message, 'danger'); return; }
    closeModal(); toast('Payment recorded'); ctx.rerender();
  });
}
