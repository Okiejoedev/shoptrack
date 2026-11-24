import { sb, state, isOnline, refreshCore, branchName, warehouses, isWarehouse } from '../store.js';
import { esc, naira, icon, toast, modal, closeModal, formData, fmtDate, empty, needsOnline, confirmBox, waLink } from '../ui.js';
import { toPDF } from '../export.js';
import { bankOptions, paidFromSelect } from './inventory.js';

const PO_STATUS = { draft: ['Draft', ''], ordered: ['Ordered', 'warn'], received: ['Received', 'ok'], cancelled: ['Cancelled', 'danger'] };
const itemText = (i) => `${i.products?.name} ×${i.qty} ${i.unit === 'carton' ? 'ctn' : 'pk'}`;

export async function renderPurchasing(el, ctx) {
  if (!isOnline()) { el.innerHTML = needsOnline('Purchase orders'); return; }
  const fromReorder = location.hash.includes('from=reorder');
  const [pos, sups] = await Promise.all([
    sb.from('purchase_orders').select('*, suppliers(name, phone), purchase_order_items(*, products(name, packs_per_carton))').order('created_at', { ascending: false }).limit(100),
    sb.from('suppliers').select('*').order('name'),
  ]);
  if (pos.error) throw pos.error;
  if (!ctx.isCurrent()) return;
  const suppliers = sups.data || [];
  const orders = pos.data || [];
  const open = orders.filter((o) => ['draft', 'ordered'].includes(o.status));

  el.innerHTML = `
  <section class="kpis small">
    <div class="kpi"><div class="kpi-label">Open orders</div><div class="kpi-value">${open.length}</div><div class="muted small">${naira(open.reduce((a, o) => a + Number(o.total), 0))} on order</div></div>
    <div class="kpi"><div class="kpi-label">You owe suppliers</div><div class="kpi-value warn-text">${naira(suppliers.reduce((a, s) => a + Math.max(0, Number(s.balance)), 0))}</div><div class="small"><a href="#/suppliers">See suppliers</a></div></div>
  </section>
  <div class="toolbar">
    <p class="muted grow">Order from a supplier, then press <strong>Receive goods</strong> when it arrives. Stock goes into the warehouse or store, cost prices update and the amount is added to what you owe the supplier.</p>
    <button class="btn ghost" id="po-reorder">${icon.sparkle}<span>From reorder suggestions</span></button>
    <button class="btn primary" id="po-new">${icon.plus}<span>New purchase order</span></button>
  </div>
  <div class="card flush"><div class="scroll"><table class="table stack">
    <thead><tr><th>PO</th><th>Supplier</th><th>Deliver to</th><th>Items</th><th>Expected</th><th>Status</th><th class="num">Total</th><th><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${orders.length ? orders.map((o) => `<tr>
      <td><strong>PO-${o.po_no}</strong><div class="muted small">${fmtDate(o.created_at)}</div></td>
      <td>${esc(o.suppliers?.name)}</td><td>${esc(branchName(o.branch_id))}</td>
      <td class="small">${esc(o.purchase_order_items.map(itemText).join(', '))}</td>
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

  el.querySelector('#po-new').onclick = () => poForm(suppliers, [], ctx);
  el.querySelector('#po-reorder').onclick = () => fromSuggestions(suppliers, ctx);
  if (fromReorder) { history.replaceState(null, '', '#/purchasing'); fromSuggestions(suppliers, ctx); }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const o = orders.find((x) => x.id === (b.dataset.order || b.dataset.receive || b.dataset.pdf || b.dataset.cancel));
    if (!o) return;
    if (b.dataset.order) { await sb.from('purchase_orders').update({ status: 'ordered' }).eq('id', o.id); toast(`PO-${o.po_no} marked as ordered`); ctx.rerender(); }
    if (b.dataset.receive) receiveForm(o, ctx);
    if (b.dataset.cancel) {
      if (!(await confirmBox(`Cancel PO-${o.po_no}?`, 'The order will be kept for your records but marked cancelled.', 'Cancel order', true))) return;
      await sb.from('purchase_orders').update({ status: 'cancelled' }).eq('id', o.id); ctx.rerender();
    }
    if (b.dataset.pdf) {
      toPDF(`PO-${o.po_no}`, `Purchase order PO-${o.po_no}`, `To ${o.suppliers?.name} · deliver to ${branchName(o.branch_id)}${o.expected_date ? ' by ' + fmtDate(o.expected_date) : ''}`,
        [{ header: 'Item', key: 'item' }, { header: 'Qty', key: 'qty', align: 'right' }, { header: 'Unit cost', key: 'cost', align: 'right' }, { header: 'Amount', key: 'amt', align: 'right' }],
        o.purchase_order_items.map((i) => ({ item: i.products?.name, qty: `${i.qty} ${i.unit === 'carton' ? 'cartons' : 'packs'}`, cost: naira(i.unit_cost), amt: naira(i.qty * i.unit_cost) })),
        [['Total', naira(o.total)], ['Status', PO_STATUS[o.status][0]], ['Date', fmtDate(o.created_at)]]);
    }
  });
}

async function receiveForm(o, ctx) {
  const banks = await bankOptions();
  const cartons = o.purchase_order_items.filter((i) => i.unit === 'carton').reduce((a, i) => a + i.qty, 0);
  const body = modal(`Receive PO-${o.po_no}`, `<form class="form" id="rf">
    <p>Adds ${esc(o.purchase_order_items.map(itemText).join(', '))} to <strong>${esc(branchName(o.branch_id))}</strong>, updates cost prices and adds <strong>${naira(o.total)}</strong> to what you owe ${esc(o.suppliers?.name)}.</p>
    <fieldset><legend>Market porter for offloading (optional)</legend>
      <div class="row gap wrap"><label class="grow">Porter / mallam name<input name="porter"></label>
      <label class="grow">Amount paid (₦)<input name="fee" type="number" min="0" step="any" placeholder="0"></label>
      ${paidFromSelect(banks, 'bank')}</div>
      ${cartons ? `<div class="muted small">${cartons} cartons on this order.</div>` : ''}</fieldset>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Receive goods</button></div></form>`);
  body.querySelector('#rf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const { error } = await sb.rpc('receive_purchase_order', { p_po: o.id, p_porter_fee: f.fee ? Number(f.fee) : null, p_porter: f.porter || null, p_bank: f.bank || null });
    if (error) { toast(error.message, 'danger'); return; }
    await refreshCore(); closeModal(); toast('Goods received into stock'); ctx.rerender();
  });
}

function poText(o) {
  return `Hello ${o.suppliers?.name}, this is ${state.settings.business_name}. Purchase order PO-${o.po_no}:\n` +
    o.purchase_order_items.map((i) => `• ${i.products?.name} × ${i.qty} ${i.unit === 'carton' ? 'cartons' : 'packs'} @ ${naira(i.unit_cost)}`).join('\n') +
    `\nTotal: ${naira(o.total)}\nDeliver to: ${branchName(o.branch_id)}${o.expected_date ? ' by ' + fmtDate(o.expected_date) : ''}. Thank you.`;
}

async function fromSuggestions(suppliers, ctx) {
  const { data } = await sb.rpc('reorder_suggestions', { p_branch: null });
  const lines = (data || []).filter((r) => r.suggested_cartons > 0).map((r) => {
    const p = state.products.find((x) => x.id === r.product_id);
    return { product_id: r.product_id, qty: r.suggested_cartons, unit: 'carton', unit_cost: Number(p?.cost_price || 0) * (p?.packs_per_carton || 1) };
  });
  if (!lines.length) { toast('Nothing needs reordering right now.'); return; }
  poForm(suppliers, lines, ctx);
}

function poForm(suppliers, lines, ctx) {
  if (!suppliers.length) { toast('Add a supplier first.', 'warn'); location.hash = '#/suppliers'; return; }
  const prodOpts = (sel) => state.products.filter((p) => p.active).map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} (${p.packs_per_carton}/ctn)</option>`).join('');
  const lineHtml = (l = {}) => `<div class="po-line">
    <select name="product" aria-label="Product">${prodOpts(l.product_id)}</select>
    <input name="qty" type="number" min="1" value="${l.qty || 1}" aria-label="Quantity">
    <select name="unit" aria-label="Unit"><option value="carton" ${l.unit !== 'pack' ? 'selected' : ''}>cartons</option><option value="pack" ${l.unit === 'pack' ? 'selected' : ''}>packs</option></select>
    <input name="cost" type="number" min="0" step="any" value="${l.unit_cost || ''}" placeholder="Cost each" aria-label="Cost per unit">
    <button type="button" class="icon-btn small" data-rm aria-label="Remove line">${icon.x}</button></div>`;
  const wh = warehouses()[0]?.id;
  const body = modal('New purchase order', `<form class="form" id="po">
    <div class="row gap wrap"><label class="grow">Supplier<select name="supplier">${suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label class="grow">Deliver to<select name="branch">${state.branches.map((b) => `<option value="${b.id}" ${b.id === wh ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
      <label>Expected<input name="expected" type="date"></label></div>
    <div class="po-head po5"><span>Product</span><span>Qty</span><span>Unit</span><span>Cost each (₦)</span><span></span></div>
    <div id="po-lines">${(lines.length ? lines : [{}]).map(lineHtml).join('')}</div>
    <button type="button" class="btn ghost small" id="po-addline">${icon.plus}<span>Add line</span></button>
    <div class="row between"><span class="muted">Order total</span><strong id="po-total">₦0</strong></div>
    <div class="muted small" id="po-warn"></div>
    <label>Notes<input name="notes"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button>
    <button class="btn" name="as" value="draft">Save draft</button><button class="btn primary" name="as" value="ordered">Save as ordered</button></div></form>`, { wide: true });
  const form = body.querySelector('#po'); const wrap = body.querySelector('#po-lines');
  const fillCost = (row, force) => {
    const p = state.products.find((x) => x.id === row.querySelector('[name=product]').value);
    const c = row.querySelector('[name=cost]'); const unit = row.querySelector('[name=unit]').value;
    if (p && (force || !c.value)) c.value = Number(p.cost_price) * (unit === 'carton' ? p.packs_per_carton : 1) || '';
  };
  const total = () => {
    let t = 0; wrap.querySelectorAll('.po-line').forEach((r) => { t += Number(r.querySelector('[name=qty]').value || 0) * Number(r.querySelector('[name=cost]').value || 0); });
    body.querySelector('#po-total').textContent = naira(t);
    const packsToWh = isWarehouse(form.branch.value) && [...wrap.querySelectorAll('[name=unit]')].some((u) => u.value === 'pack');
    body.querySelector('#po-warn').textContent = packsToWh ? 'Warehouses take full cartons only. Change packs to cartons or deliver to the Store.' : '';
  };
  wrap.querySelectorAll('.po-line').forEach((r) => fillCost(r)); total();
  body.querySelector('#po-addline').onclick = () => { wrap.insertAdjacentHTML('beforeend', lineHtml()); fillCost(wrap.lastElementChild); total(); };
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-rm]') && wrap.children.length > 1) { e.target.closest('.po-line').remove(); total(); } });
  wrap.addEventListener('change', (e) => { if (['product', 'unit'].includes(e.target.name)) fillCost(e.target.closest('.po-line'), true); total(); });
  wrap.addEventListener('input', total); form.branch.addEventListener('change', total);
  let submitAs = 'ordered';
  form.querySelectorAll('button[name=as]').forEach((b) => b.addEventListener('click', () => { submitAs = b.value; }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(form);
    const items = [...wrap.querySelectorAll('.po-line')].map((r) => ({ product_id: r.querySelector('[name=product]').value, unit: r.querySelector('[name=unit]').value,
      qty: parseInt(r.querySelector('[name=qty]').value || '0', 10), unit_cost: Number(r.querySelector('[name=cost]').value || 0) })).filter((i) => i.qty > 0);
    if (!items.length) { toast('Add at least one item.', 'warn'); return; }
    if (isWarehouse(f.branch) && items.some((i) => i.unit === 'pack')) { toast('Warehouses take full cartons only.', 'warn'); return; }
    const tot = items.reduce((a, i) => a + i.qty * i.unit_cost, 0);
    const { data, error } = await sb.from('purchase_orders').insert({ supplier_id: f.supplier, branch_id: f.branch, status: submitAs, expected_date: f.expected || null, notes: f.notes || null, total: tot }).select().single();
    if (error) { toast(error.message, 'danger'); return; }
    const r2 = await sb.from('purchase_order_items').insert(items.map((i) => ({ ...i, po_id: data.id })));
    if (r2.error) { toast(r2.error.message, 'danger'); return; }
    closeModal(); toast(`PO-${data.po_no} created`); ctx.rerender();
  });
}
