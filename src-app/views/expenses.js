import { sb, state, isOwner, isOnline, branchName, sellBranch } from '../store.js';
import { esc, naira, icon, toast, modal, closeModal, formData, fmtDate, todayISO, monthStartISO, empty, needsOnline, confirmBox, METHOD_LABEL } from '../ui.js';
import { toExcel } from '../export.js';
import { bankOptions } from './inventory.js';

const CATS = ['Shop rent', 'Warehouse rent', 'Rent', 'Salaries', 'Diesel & power', 'Utilities', 'Transport', 'Repairs', 'Marketing', 'Bank charges', 'Taxes & levies', 'Miscellaneous'];
const r = { from: monthStartISO(), to: todayISO() };

export async function renderExpenses(el, ctx) {
  if (!isOnline()) { el.innerHTML = needsOnline('Expenses'); return; }
  let q = sb.from('expenses').select('*, profiles(full_name), bank_accounts(name)').gte('spent_on', r.from).lte('spent_on', r.to).order('spent_on', { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  if (!ctx.isCurrent()) return;
  const total = data.reduce((a, x) => a + Number(x.amount), 0);
  const byCat = Object.entries(data.reduce((m, x) => ((m[x.category] = (m[x.category] || 0) + Number(x.amount)), m), {})).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...byCat.map((c) => c[1]));

  el.innerHTML = `
  <div class="toolbar wrap">
    <label>From <input type="date" id="e-from" value="${r.from}"></label>
    <label>To <input type="date" id="e-to" value="${r.to}"></label>
    <div class="grow"></div>
    <button class="btn ghost" id="e-xlsx">${icon.download}<span>Excel</span></button>
    <button class="btn primary" id="e-add">${icon.plus}<span>Record expense</span></button>
  </div>
  <div class="grid-2">
    <section class="card">
      <div class="card-head"><h2>By category</h2><strong>${naira(total)}</strong></div>
      ${byCat.length ? byCat.map(([c, v]) => `<div class="meter-row"><div class="row between"><span>${esc(c)}</span><strong>${naira(v)}</strong></div>
        <div class="meter"><div style="width:${(v / max) * 100}%"></div></div></div>`).join('') : empty('No expenses in this range')}
    </section>
    <section class="card flush span-2"><div class="scroll"><table class="table stack">
      <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Location</th><th>Method</th><th>By</th><th class="num">Amount</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${data.length ? data.map((x) => `<tr><td>${fmtDate(x.spent_on)}</td><td>${esc(x.category)}</td><td>${esc(x.description || '')}</td>
        <td>${esc(branchName(x.branch_id))}</td><td>${METHOD_LABEL[x.method]}${x.bank_accounts ? ' · ' + esc(x.bank_accounts.name) : ''}</td><td>${esc(x.profiles?.full_name || '')}</td><td class="num"><strong>${naira(x.amount)}</strong></td>
        <td class="actions">${isOwner() ? `<button class="icon-btn small" data-del="${x.id}" aria-label="Delete expense">${icon.trash}</button>` : ''}</td></tr>`).join('')
        : `<tr><td colspan="8">${empty('No expenses recorded')}</td></tr>`}</tbody></table></div></section>
  </div>`;

  el.querySelector('#e-from').onchange = (e) => { r.from = e.target.value; ctx.rerender(); };
  el.querySelector('#e-to').onchange = (e) => { r.to = e.target.value; ctx.rerender(); };
  el.querySelector('#e-xlsx').onclick = () => toExcel(`expenses-${r.from}-to-${r.to}`, [{ name: 'Expenses', rows: data.map((x) => ({ Date: x.spent_on, Category: x.category, Description: x.description, Branch: branchName(x.branch_id), Method: METHOD_LABEL[x.method], Amount: Number(x.amount) })) }]);
  el.querySelector('#e-add').onclick = async () => {
    const banks = await bankOptions();
    const body = modal('Record expense', `<form class="form" id="ef">
      <div class="row gap"><label class="grow">Category<input name="category" list="ecats" required><datalist id="ecats">${CATS.map((c) => `<option value="${c}">`).join('')}</datalist></label>
      <label class="grow">Amount (₦)<input name="amount" type="number" min="1" step="any" required></label></div>
      <label>Description<input name="description" placeholder="e.g. 50 litres of diesel"></label>
      <div class="row gap"><label class="grow">Date<input name="spent_on" type="date" value="${todayISO()}"></label>
      <label class="grow">Paid by<select name="method"><option value="cash">Cash</option><option value="transfer">Transfer</option><option value="pos">POS</option></select></label>
      <label class="grow">Location<select name="branch_id">${state.branches.map((b) => `<option value="${b.id}" ${b.id === sellBranch() ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label></div>
      ${banks.length ? `<label>From bank account<select name="bank_account_id"><option value="">Not from a bank account (cash)</option>${banks.map((b) => `<option value="${b.id}">${esc(b.name)} (${naira(b.balance)})</option>`).join('')}</select></label>
      <p class="muted small">Pick an account and the money comes off its balance automatically.</p>` : ''}
      <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save expense</button></div></form>`);
    body.querySelector('#ef').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const { error } = await sb.from('expenses').insert({ ...f, amount: Number(f.amount), bank_account_id: f.bank_account_id || null });
      if (error) { toast(error.message, 'danger'); return; }
      closeModal(); toast('Expense saved'); ctx.rerender();
    });
  };
  el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!(await confirmBox('Delete this expense?', 'It will be removed from your profit and loss.', 'Delete', true))) return;
    const { error } = await sb.from('expenses').delete().eq('id', b.dataset.del);
    if (error) { toast(error.message, 'danger'); return; }
    ctx.rerender();
  });
}
