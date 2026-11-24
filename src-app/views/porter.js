import { sb, state, isOnline, isOwner } from '../store.js';
import { esc, naira, num, icon, toast, modal, closeModal, formData, fmtDate, todayISO, monthStartISO, empty, needsOnline, confirmBox } from '../ui.js';
import { toExcel } from '../export.js';
import { bankOptions, paidFromSelect } from './inventory.js';

const r = { from: monthStartISO(), to: todayISO() };

export async function renderPorter(el, ctx) {
  if (!isOnline()) { el.innerHTML = needsOnline('Market porter records'); return; }
  const [{ data, error }, banks] = await Promise.all([
    sb.from('porter_fees').select('*, bank_accounts(name)').gte('fee_date', r.from).lte('fee_date', r.to).order('fee_date', { ascending: false }).order('created_at', { ascending: false }),
    bankOptions(),
  ]);
  if (error) throw error;
  if (!ctx.isCurrent()) return;
  const total = data.reduce((a, x) => a + Number(x.amount), 0);
  const cartons = data.reduce((a, x) => a + Number(x.cartons || 0), 0);
  const byPorter = Object.entries(data.reduce((m, x) => { const k = x.porter_name || 'Not named'; m[k] = (m[k] || 0) + Number(x.amount); return m; }, {})).sort((a, b) => b[1] - a[1]);

  el.innerHTML = `
  <p class="muted">What the mallam or porter collects for carrying goods: offloading supplier deliveries, moving cartons between the warehouses and the store, or delivering to customers. It counts as a business cost in your profit and loss.</p>
  <section class="kpis small">
    <div class="kpi"><div class="kpi-label">Paid to porters</div><div class="kpi-value warn-text">${naira(total)}</div><div class="muted small">${fmtDate(r.from)} to ${fmtDate(r.to)}</div></div>
    <div class="kpi"><div class="kpi-label">Trips recorded</div><div class="kpi-value">${data.length}</div></div>
    <div class="kpi"><div class="kpi-label">Cartons carried</div><div class="kpi-value">${num(cartons)}</div><div class="muted small">${cartons ? `about ${naira(total / cartons)} per carton` : ''}</div></div>
  </section>
  <div class="toolbar wrap">
    <label>From <input type="date" id="pt-from" value="${r.from}"></label>
    <label>To <input type="date" id="pt-to" value="${r.to}"></label>
    <div class="grow"></div>
    <button class="btn ghost" id="pt-xlsx">${icon.download}<span>Excel</span></button>
    <button class="btn primary" id="pt-add">${icon.plus}<span>Record porter fee</span></button>
  </div>
  <div class="grid-2">
    <section class="card flush span-2"><div class="scroll"><table class="table stack">
      <thead><tr><th>Date</th><th>Porter</th><th>What was carried</th><th class="num">Cartons</th><th>Paid from</th><th class="num">Amount</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${data.length ? data.map((x) => `<tr><td>${fmtDate(x.fee_date)}</td><td>${esc(x.porter_name || '—')}</td><td>${esc(x.description)}</td>
        <td class="num">${x.cartons ?? '—'}</td><td>${x.paid_from === 'bank' ? esc(x.bank_accounts?.name || 'Bank') : 'Cash'}</td><td class="num"><strong>${naira(x.amount)}</strong></td>
        <td class="actions">${isOwner() ? `<button class="icon-btn small" data-del="${x.id}" aria-label="Delete porter fee">${icon.trash}</button>` : ''}</td></tr>`).join('')
        : `<tr><td colspan="7">${empty('No porter fees in this period', 'They are also added automatically when you move stock or receive a purchase order with a porter fee.')}</td></tr>`}</tbody></table></div></section>
    ${byPorter.length ? `<section class="card"><div class="card-head"><h2>By porter</h2></div>
      ${byPorter.map(([n, v]) => `<div class="row between list-row"><span>${esc(n)}</span><strong>${naira(v)}</strong></div>`).join('')}</section>` : ''}
  </div>`;

  el.querySelector('#pt-from').onchange = (e) => { r.from = e.target.value; ctx.rerender(); };
  el.querySelector('#pt-to').onchange = (e) => { r.to = e.target.value; ctx.rerender(); };
  el.querySelector('#pt-xlsx').onclick = () => toExcel(`market-porter-${r.from}-to-${r.to}`, [{ name: 'Market porter', rows: data.map((x) => ({
    Date: x.fee_date, Porter: x.porter_name, Description: x.description, Cartons: x.cartons, 'Paid from': x.paid_from === 'bank' ? x.bank_accounts?.name : 'Cash', Amount: Number(x.amount) })) }]);
  el.querySelector('#pt-add').onclick = () => {
    const body = modal('Record porter fee', `<form class="form" id="pf">
      <div class="row gap wrap"><label class="grow">Porter / mallam name<input name="porter" placeholder="e.g. Mallam Musa"></label>
        <label class="grow">Date<input name="date" type="date" value="${todayISO()}"></label></div>
      <label>What did they carry?<input name="desc" required placeholder="e.g. Offloaded Colgate delivery into Warehouse 1"></label>
      <div class="row gap wrap"><label class="grow">Cartons carried<input name="cartons" type="number" min="0" placeholder="Optional"></label>
        <label class="grow">Amount paid (₦)<input name="amount" type="number" min="1" step="any" required></label></div>
      <div class="row gap">${paidFromSelect(banks, 'bank')}</div>
      <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
    body.querySelector('#pf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const { error: err } = await sb.rpc('record_porter_fee', { p_desc: f.desc, p_amount: Number(f.amount), p_porter: f.porter || null,
        p_cartons: f.cartons ? parseInt(f.cartons, 10) : null, p_bank: f.bank || null, p_date: f.date || null, p_ref: null });
      if (err) { toast(err.message, 'danger'); return; }
      closeModal(); toast('Porter fee saved'); ctx.rerender();
    });
  };
  el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!(await confirmBox('Delete this porter fee?', 'If it was paid from a bank account, the money is put back on that account.', 'Delete', true))) return;
    const { error: err } = await sb.rpc('delete_porter_fee', { p_id: b.dataset.del });
    if (err) { toast(err.message, 'danger'); return; }
    ctx.rerender();
  });
}
