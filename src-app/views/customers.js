import { sb, state, isManager, isOnline, addCustomer, recordCustomerPayment, refreshCore } from '../store.js';
import { esc, naira, icon, toast, modal, closeModal, formData, fmtDateTime, empty, waLink, METHOD_LABEL } from '../ui.js';
import { toExcel } from '../export.js';

let cq = '', onlyDebtors = false;

export async function renderCustomers(el, ctx) {
  const list = state.customers.filter((c) => c.name !== 'Walk-in customer'
    && (!onlyDebtors || Number(c.balance) > 0)
    && (!cq || c.name.toLowerCase().includes(cq.toLowerCase()) || (c.phone || '').includes(cq)));
  const owed = state.customers.reduce((a, c) => a + Math.max(0, Number(c.balance)), 0);
  const debtors = state.customers.filter((c) => Number(c.balance) > 0).length;

  el.innerHTML = `
  <section class="kpis small">
    <div class="kpi"><div class="kpi-label">Customers</div><div class="kpi-value">${state.customers.length - 1}</div></div>
    <div class="kpi"><div class="kpi-label">Total owed to you</div><div class="kpi-value warn-text">${naira(owed)}</div></div>
    <div class="kpi"><div class="kpi-label">Customers owing</div><div class="kpi-value">${debtors}</div></div>
  </section>
  <div class="toolbar wrap">
    <label class="search">${icon.search}<span class="sr-only">Search</span><input id="c-q" placeholder="Name or phone" value="${esc(cq)}"></label>
    <label class="check"><input type="checkbox" id="c-debt" ${onlyDebtors ? 'checked' : ''}> Only customers who owe</label>
    <div class="grow"></div>
    <button class="btn ghost" id="c-export">${icon.download}<span>Excel</span></button>
    <button class="btn primary" id="c-add">${icon.plus}<span>Add customer</span></button>
  </div>
  <div class="card flush"><div class="scroll"><table class="table stack">
    <thead><tr><th>Customer</th><th>Phone</th><th class="num">Credit limit</th><th class="num">Owes</th><th><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${list.length ? list.map((c) => {
      const bal = Number(c.balance);
      const over = c.credit_limit > 0 && bal > c.credit_limit;
      return `<tr><td><strong>${esc(c.name)}</strong><div class="muted small">${esc(c.address || '')}</div></td>
      <td>${esc(c.phone || '—')}</td><td class="num">${c.credit_limit > 0 ? naira(c.credit_limit) : 'No limit'}</td>
      <td class="num"><strong class="${bal > 0 ? 'warn-text' : ''}">${naira(bal)}</strong>${over ? ' <span class="pill danger">over limit</span>' : ''}</td>
      <td class="actions">
        ${bal > 0 ? `<button class="btn small primary" data-pay="${c.id}">Record payment</button>` : ''}
        ${bal > 0 && c.phone ? `<a class="icon-btn small" target="_blank" rel="noopener" title="WhatsApp reminder" aria-label="Send ${esc(c.name)} a WhatsApp reminder"
          href="${waLink(c.phone, `Hello ${c.name}, this is ${state.settings.business_name}. A friendly reminder that your balance with us is ${naira(bal)}. You can pay by transfer or at the shop. Thank you!`)}">${icon.whatsapp}</a>` : ''}
        <button class="icon-btn small" data-statement="${c.id}" title="Statement" aria-label="Statement for ${esc(c.name)}">${icon.history}</button>
        ${isManager() ? `<button class="icon-btn small" data-edit="${c.id}" title="Edit" aria-label="Edit ${esc(c.name)}">${icon.edit}</button>` : ''}
      </td></tr>`;
    }).join('') : `<tr><td colspan="5">${empty('No customers found')}</td></tr>`}</tbody></table></div></div>`;

  el.querySelector('#c-q').addEventListener('change', (e) => { cq = e.target.value; ctx.rerender(); });
  el.querySelector('#c-debt').addEventListener('change', (e) => { onlyDebtors = e.target.checked; ctx.rerender(); });
  el.querySelector('#c-add').onclick = () => editForm(null, ctx);
  el.querySelector('#c-export').onclick = () => toExcel('customers', [{ name: 'Customers', rows: list.map((c) => ({ Name: c.name, Phone: c.phone, Address: c.address, 'Credit limit': Number(c.credit_limit), Owes: Number(c.balance) })) }]);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pay) payForm(b.dataset.pay, ctx);
    if (b.dataset.edit) editForm(state.customers.find((c) => c.id === b.dataset.edit), ctx);
    if (b.dataset.statement) statement(b.dataset.statement);
  });
}

function payForm(id, ctx) {
  const c = state.customers.find((x) => x.id === id);
  const body = modal(`Payment from ${c.name}`, `<form class="form" id="pf">
    <p>Currently owes <strong>${naira(c.balance)}</strong></p>
    <label>Amount (₦)<input name="amount" type="number" min="1" step="any" max="${c.balance}" value="${c.balance}" required></label>
    <label>Paid by<select name="method"><option value="cash">Cash</option><option value="transfer">Transfer</option><option value="pos">POS</option></select></label>
    <label>Note<input name="note" placeholder="Optional"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save payment</button></div></form>`);
  body.querySelector('#pf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    await recordCustomerPayment(id, f.amount, f.method, f.note);
    closeModal(); toast(`${naira(f.amount)} recorded${isOnline() ? '' : ' offline, will sync'}`); ctx.rerender();
  });
}

function editForm(c, ctx) {
  const isNew = !c; c = c || { name: '', phone: '', address: '', credit_limit: 0 };
  const body = modal(isNew ? 'Add customer' : `Edit ${c.name}`, `<form class="form" id="cf">
    <label>Name<input name="name" value="${esc(c.name)}" required></label>
    <label>Phone<input name="phone" inputmode="tel" value="${esc(c.phone || '')}"></label>
    <label>Address<input name="address" value="${esc(c.address || '')}"></label>
    <label>Credit limit (₦, 0 = no limit)<input name="credit_limit" type="number" min="0" value="${c.credit_limit}"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">${isNew ? 'Add' : 'Save'}</button></div></form>`);
  body.querySelector('#cf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    if (isNew) { await addCustomer(f); }
    else {
      if (!isOnline()) { toast('Editing customers needs a connection.', 'warn'); return; }
      const { error } = await sb.from('customers').update({ name: f.name, phone: f.phone || null, address: f.address || null, credit_limit: Number(f.credit_limit || 0) }).eq('id', c.id);
      if (error) { toast(error.message, 'danger'); return; }
      await refreshCore();
    }
    closeModal(); toast('Saved'); ctx.rerender();
  });
}

async function statement(id) {
  const c = state.customers.find((x) => x.id === id);
  const body = modal(`Statement: ${c.name}`, '<div class="loading">Loading…</div>', { wide: true });
  if (!isOnline()) { body.innerHTML = '<p class="muted">Statements need a connection.</p>'; return; }
  const [s, p] = await Promise.all([
    sb.from('sales').select('id, receipt_no, created_at, total, amount_paid, status, payment_method').eq('customer_id', id).order('created_at', { ascending: false }).limit(100),
    sb.from('customer_payments').select('*').eq('customer_id', id).order('created_at', { ascending: false }).limit(100),
  ]);
  const rows = [
    ...(s.data || []).filter((x) => x.status !== 'void').map((x) => ({ at: x.created_at, what: `Sale #${x.receipt_no} (${METHOD_LABEL[x.payment_method]})`, debit: x.total - x.amount_paid, total: x.total })),
    ...(p.data || []).map((x) => ({ at: x.created_at, what: `Payment · ${METHOD_LABEL[x.method]}${x.note ? ' · ' + x.note : ''}`, credit: x.amount })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  body.innerHTML = `<p>Balance owed: <strong>${naira(c.balance)}</strong></p>
    <div class="scroll"><table class="table stack"><thead><tr><th>Date</th><th>Details</th><th class="num">Sale total</th><th class="num">Added to account</th><th class="num">Paid</th></tr></thead>
    <tbody>${rows.length ? rows.map((r) => `<tr><td>${fmtDateTime(r.at)}</td><td>${esc(r.what)}</td><td class="num">${r.total ? naira(r.total) : ''}</td>
    <td class="num">${r.debit > 0 ? naira(r.debit) : ''}</td><td class="num text-ok">${r.credit ? naira(r.credit) : ''}</td></tr>`).join('') : `<tr><td colspan="5">${empty('No history yet')}</td></tr>`}</tbody></table></div>`;
}
