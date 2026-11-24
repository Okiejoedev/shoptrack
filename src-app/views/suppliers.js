import { sb, isOnline } from '../store.js';
import { esc, naira, icon, toast, modal, closeModal, formData, fmtDateTime, empty, needsOnline, METHOD_LABEL, waLink } from '../ui.js';
import { toExcel } from '../export.js';
import { bankOptions } from './inventory.js';

let sq = '';

export async function renderSuppliers(el, ctx) {
  if (!isOnline()) { el.innerHTML = needsOnline('Suppliers'); return; }
  const { data, error } = await sb.from('suppliers').select('*').order('balance', { ascending: false }).order('name');
  if (error) throw error;
  if (!ctx.isCurrent()) return;
  const list = data.filter((s) => !sq || s.name.toLowerCase().includes(sq.toLowerCase()));
  const owed = data.reduce((a, s) => a + Math.max(0, Number(s.balance)), 0);
  const owing = data.filter((s) => Number(s.balance) > 0).length;

  el.innerHTML = `
  <section class="kpis small">
    <div class="kpi big-kpi"><div class="kpi-label">Total you owe suppliers</div><div class="kpi-value warn-text">${naira(owed)}</div><div class="muted small">across ${owing} supplier${owing === 1 ? '' : 's'}</div></div>
    <div class="kpi"><div class="kpi-label">Suppliers</div><div class="kpi-value">${data.length}</div></div>
  </section>
  <div class="toolbar wrap">
    <label class="search">${icon.search}<span class="sr-only">Search</span><input id="sp-q" placeholder="Search suppliers" value="${esc(sq)}"></label>
    <div class="grow"></div>
    <button class="btn ghost" id="sp-xlsx">${icon.download}<span>Excel</span></button>
    <button class="btn primary" id="sp-add">${icon.plus}<span>Add supplier</span></button>
  </div>
  <div class="card flush"><div class="scroll"><table class="table stack">
    <thead><tr><th>Supplier</th><th>Phone</th><th class="num">You owe</th><th><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${list.length ? list.map((s) => `<tr>
      <td><strong>${esc(s.name)}</strong><div class="muted small">${esc([s.contact_person, s.address].filter(Boolean).join(' · '))}</div></td>
      <td>${esc(s.phone || '—')}</td>
      <td class="num"><strong class="${s.balance > 0 ? 'warn-text' : ''}">${naira(s.balance)}</strong></td>
      <td class="actions">
        <button class="btn small" data-debt="${s.id}">${icon.plus}<span>Add debt</span></button>
        ${s.balance > 0 ? `<button class="btn small primary" data-pay="${s.id}">Pay</button>` : ''}
        <button class="icon-btn small" data-ledger="${s.id}" title="History" aria-label="History with ${esc(s.name)}">${icon.history}</button>
        <button class="icon-btn small" data-edit="${s.id}" title="Edit" aria-label="Edit ${esc(s.name)}">${icon.edit}</button>
      </td></tr>`).join('') : `<tr><td colspan="4">${empty('No suppliers yet', 'Add each supplier with how much you owe them today.')}</td></tr>`}</tbody></table></div></div>`;

  el.querySelector('#sp-q').onchange = (e) => { sq = e.target.value; ctx.rerender(); };
  el.querySelector('#sp-add').onclick = () => form(null, ctx);
  el.querySelector('#sp-xlsx').onclick = () => toExcel('suppliers', [{ name: 'Suppliers', rows: data.map((s) => ({ Supplier: s.name, Contact: s.contact_person, Phone: s.phone, 'You owe': Number(s.balance) })) }]);
  el.querySelectorAll('[data-debt]').forEach((b) => b.onclick = () => debtForm(data.find((s) => s.id === b.dataset.debt), ctx));
  el.querySelectorAll('[data-pay]').forEach((b) => b.onclick = () => payForm(data.find((s) => s.id === b.dataset.pay), ctx));
  el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => form(data.find((s) => s.id === b.dataset.edit), ctx));
  el.querySelectorAll('[data-ledger]').forEach((b) => b.onclick = () => ledger(data.find((s) => s.id === b.dataset.ledger)));
}

function form(s, ctx) {
  const isNew = !s; s = s || {};
  const body = modal(isNew ? 'Add supplier' : `Edit ${s.name}`, `<form class="form" id="sf">
    <label>Supplier name<input name="name" value="${esc(s.name || '')}" required></label>
    <div class="row gap wrap"><label class="grow">Contact person<input name="contact_person" value="${esc(s.contact_person || '')}"></label>
      <label class="grow">Phone<input name="phone" inputmode="tel" value="${esc(s.phone || '')}"></label></div>
    <label>Address<input name="address" value="${esc(s.address || '')}"></label>
    ${isNew ? '<label>How much do you owe them right now? (₦)<input name="opening" type="number" min="0" step="any" value="0"></label>' : ''}
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">${isNew ? 'Add supplier' : 'Save'}</button></div></form>`);
  body.querySelector('#sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const row = { name: f.name.trim(), contact_person: f.contact_person || null, phone: f.phone || null, address: f.address || null };
    if (isNew) {
      const { data, error } = await sb.from('suppliers').insert(row).select().single();
      if (error) { toast(error.message, 'danger'); return; }
      if (Number(f.opening) > 0) await sb.rpc('add_supplier_debt', { p_supplier: data.id, p_amount: Number(f.opening), p_note: 'Opening balance' });
    } else {
      const { error } = await sb.from('suppliers').update(row).eq('id', s.id);
      if (error) { toast(error.message, 'danger'); return; }
    }
    closeModal(); toast('Saved'); ctx.rerender();
  });
}

function debtForm(s, ctx) {
  const body = modal(`Add to what you owe ${s.name}`, `<form class="form" id="df">
    <p class="muted">Use this when you collect goods on credit without a purchase order.</p>
    <label>Amount (₦)<input name="amount" type="number" min="1" step="any" required></label>
    <label>What for?<input name="note" placeholder="e.g. 20 cartons Colgate Herbal, invoice 4471"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Add debt</button></div></form>`);
  body.querySelector('#df').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const { error } = await sb.rpc('add_supplier_debt', { p_supplier: s.id, p_amount: Number(f.amount), p_note: f.note || null });
    if (error) { toast(error.message, 'danger'); return; }
    closeModal(); toast(`${naira(f.amount)} added to ${s.name}`); ctx.rerender();
  });
}

async function payForm(s, ctx) {
  const banks = await bankOptions();
  const body = modal(`Pay ${s.name}`, `<form class="form" id="pf">
    <p>You owe <strong>${naira(s.balance)}</strong></p>
    <label>Amount (₦)<input name="amount" type="number" min="1" step="any" value="${s.balance}" required></label>
    <div class="row gap wrap"><label class="grow">Method<select name="method">${['transfer', 'cash', 'pos'].map((m) => `<option value="${m}">${METHOD_LABEL[m]}</option>`).join('')}</select></label>
      <label class="grow">From bank account<select name="bank"><option value="">Not from a bank account (cash)</option>
        ${banks.map((b) => `<option value="${b.id}">${esc(b.name)} (${naira(b.balance)})</option>`).join('')}</select></label></div>
    <label>Reference / note<input name="note"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Record payment</button></div></form>`);
  const f = body.querySelector('#pf');
  f.method.addEventListener('change', () => { if (f.method.value === 'cash') f.bank.value = ''; else if (!f.bank.value && banks[0]) f.bank.value = banks[0].id; });
  if (banks[0]) f.bank.value = banks[0].id;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(f);
    const { error } = await sb.rpc('pay_supplier', { p_supplier: s.id, p_amount: Number(d.amount), p_method: d.method, p_note: d.note || null, p_bank: d.bank || null });
    if (error) { toast(error.message, 'danger'); return; }
    closeModal(); toast(`Paid ${naira(d.amount)} to ${s.name}`); ctx.rerender();
  });
}

async function ledger(s) {
  const body = modal(`${s.name}: history`, '<div class="loading">Loading…</div>', { wide: true });
  const { data } = await sb.from('supplier_ledger').select('*, bank_accounts(name)').eq('supplier_id', s.id).order('created_at', { ascending: false }).limit(200);
  body.innerHTML = `<p>You owe <strong>${naira(s.balance)}</strong>${s.phone && s.balance > 0 ? ` · <a target="_blank" rel="noopener" href="${waLink(s.phone, `Hello ${s.name}, our records show a balance of ${naira(s.balance)} with you. Please confirm.`)}">Confirm balance on WhatsApp</a>` : ''}</p>
    ${data?.length ? `<div class="scroll"><table class="table stack"><thead><tr><th>Date</th><th>Details</th><th class="num">Owed more</th><th class="num">Paid</th></tr></thead>
    <tbody>${data.map((x) => `<tr><td>${fmtDateTime(x.created_at)}</td><td>${esc(x.note || (x.kind === 'payment' ? 'Payment' : 'Debt'))}${x.kind === 'payment' ? ` <span class="muted small">· ${esc(METHOD_LABEL[x.method] || '')}${x.bank_accounts ? ' from ' + esc(x.bank_accounts.name) : ''}</span>` : ''}</td>
      <td class="num">${x.kind === 'debt' ? naira(x.amount) : ''}</td><td class="num text-ok">${x.kind === 'payment' ? naira(x.amount) : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('No history yet')}`;
}
