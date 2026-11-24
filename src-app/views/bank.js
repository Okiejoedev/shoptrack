import { sb, isOnline, isOwner } from '../store.js';
import { esc, naira, icon, toast, modal, closeModal, formData, fmtDateTime, empty, needsOnline } from '../ui.js';
import { toExcel } from '../export.js';

let acct = 'all';
const CAT = { opening: 'Opening balance', sale: 'Sale (transfer / POS)', sale_void: 'Voided sale', customer_payment: 'Customer paid', supplier_payment: 'Paid supplier',
  expense: 'Expense', porter: 'Market porter', deposit: 'Deposit', withdrawal: 'Withdrawal', reversal: 'Reversal', other: 'Other' };

export async function renderBank(el, ctx) {
  if (!isOnline()) { el.innerHTML = needsOnline('Bank accounts'); return; }
  const accounts = (await sb.from('bank_accounts').select('*').order('name')).data || [];
  let q = sb.from('bank_transactions').select('*, bank_accounts(name)').order('created_at', { ascending: false }).limit(300);
  if (acct !== 'all') q = q.eq('account_id', acct);
  const { data: txs, error } = await q;
  if (error) throw error;
  if (!ctx.isCurrent()) return;
  const live = accounts.filter((a) => a.active);
  const total = live.reduce((a, b) => a + Number(b.balance), 0);
  const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const month = (txs || []).filter((t) => new Date(t.created_at) >= monthStart && t.category !== 'opening');
  const inM = month.filter((t) => t.direction === 'in').reduce((a, t) => a + Number(t.amount), 0);
  const outM = month.filter((t) => t.direction === 'out').reduce((a, t) => a + Number(t.amount), 0);
  const owner = isOwner();

  el.innerHTML = `
  <section class="kpis small">
    <div class="kpi big-kpi"><div class="kpi-label">Total money in the bank</div><div class="kpi-value accent">${naira(total)}</div><div class="muted small">${live.length} account${live.length === 1 ? '' : 's'}</div></div>
    <div class="kpi"><div class="kpi-label">In this month${acct !== 'all' ? ' (this account)' : ''}</div><div class="kpi-value text-ok">+${naira(inM)}</div></div>
    <div class="kpi"><div class="kpi-label">Out this month${acct !== 'all' ? ' (this account)' : ''}</div><div class="kpi-value text-danger">−${naira(outM)}</div></div>
  </section>
  ${live.length ? `<div class="bank-cards">${live.map((a) => `<button class="bank-card ${acct === a.id ? 'on' : ''}" data-acct="${a.id}" aria-pressed="${acct === a.id}">
    <span class="bc-name">${esc(a.name)}</span><span class="muted small">${esc(a.bank_name || '')}${a.last4 ? ' · ••••' + esc(a.last4) : ''}</span>
    <span class="bc-bal">${naira(a.balance)}</span>${a.receives_sales ? '<span class="pill ok small">Transfer & POS sales land here</span>' : ''}</button>`).join('')}
    ${acct !== 'all' ? '<button class="btn ghost small" data-acct="all">Show all accounts</button>' : ''}</div>`
    : `<div class="card">${empty('No bank accounts yet', owner ? 'Add your business accounts with today\'s balance. Transfer and POS sales, supplier payments and expenses will then move the balance automatically.' : 'The owner adds bank accounts.')}</div>`}
  <div class="toolbar wrap">
    <h2 class="grow">Money in and out${acct !== 'all' ? ': ' + esc(accounts.find((a) => a.id === acct)?.name || '') : ''}</h2>
    <button class="btn ghost" id="bk-xlsx">${icon.download}<span>Excel</span></button>
    ${owner && live.length ? `<button class="btn ghost" id="bk-entry">${icon.transfer}<span>Deposit / withdrawal</span></button>` : ''}
    ${owner ? `<button class="btn primary" id="bk-add">${icon.plus}<span>Add bank account</span></button>` : ''}
  </div>
  <div class="card flush"><div class="scroll"><table class="table stack">
    <thead><tr><th>Date</th><th>Account</th><th>Type</th><th>Details</th><th class="num">In</th><th class="num">Out</th><th class="num">Balance after</th></tr></thead>
    <tbody>${txs?.length ? txs.map((t) => `<tr><td>${fmtDateTime(t.created_at)}</td><td>${esc(t.bank_accounts?.name || '')}</td><td>${CAT[t.category] || t.category}</td>
      <td>${esc(t.description || '')}</td><td class="num text-ok">${t.direction === 'in' ? naira(t.amount) : ''}</td><td class="num text-danger">${t.direction === 'out' ? naira(t.amount) : ''}</td>
      <td class="num"><strong>${t.balance_after != null ? naira(t.balance_after) : ''}</strong></td></tr>`).join('') : `<tr><td colspan="7">${empty('No bank movements yet')}</td></tr>`}</tbody></table></div></div>`;

  el.querySelectorAll('[data-acct]').forEach((b) => b.onclick = () => { acct = acct === b.dataset.acct ? 'all' : b.dataset.acct; ctx.rerender(); });
  el.querySelector('#bk-xlsx').onclick = () => toExcel('bank-transactions', [{ name: 'Bank', rows: (txs || []).map((t) => ({ Date: fmtDateTime(t.created_at), Account: t.bank_accounts?.name,
    Type: CAT[t.category] || t.category, Details: t.description, In: t.direction === 'in' ? Number(t.amount) : '', Out: t.direction === 'out' ? Number(t.amount) : '', 'Balance after': Number(t.balance_after) })) }]);
  el.querySelector('#bk-add')?.addEventListener('click', () => {
    const body = modal('Add bank account', `<form class="form" id="ba">
      <label>Account name<input name="name" required placeholder="e.g. Anayo 5PS main account"></label>
      <div class="row gap wrap"><label class="grow">Bank<input name="bank" placeholder="e.g. GTBank, Moniepoint, Opay"></label>
        <label class="grow">Last 4 digits (optional)<input name="last4" inputmode="numeric" pattern="[0-9]{4}" maxlength="4"></label></div>
      <label>Balance right now (₦)<input name="opening" type="number" min="0" step="any" value="0"></label>
      <label class="check"><input type="checkbox" name="sales" ${live.some((a) => a.receives_sales) ? '' : 'checked'}> Transfer and POS sales go into this account</label>
      <p class="muted small">Only the last 4 digits are kept. Never store full account numbers or PINs here.</p>
      <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Add account</button></div></form>`);
    body.querySelector('#ba').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const { error: err } = await sb.rpc('add_bank_account', { p_name: f.name, p_bank: f.bank || '', p_last4: f.last4 || '', p_opening: Number(f.opening || 0), p_receives_sales: !!f.sales });
      if (err) { toast(err.message, 'danger'); return; }
      closeModal(); toast('Bank account added'); ctx.rerender();
    });
  });
  el.querySelector('#bk-entry')?.addEventListener('click', () => {
    const body = modal('Deposit or withdrawal', `<form class="form" id="be">
      <label>Account<select name="account">${live.map((a) => `<option value="${a.id}" ${a.id === acct ? 'selected' : ''}>${esc(a.name)} (${naira(a.balance)})</option>`).join('')}</select></label>
      <div class="seg" role="radiogroup"><label class="check"><input type="radio" name="dir" value="in" checked> Money in (deposit)</label><label class="check"><input type="radio" name="dir" value="out"> Money out (withdrawal)</label></div>
      <label>Amount (₦)<input name="amount" type="number" min="1" step="any" required></label>
      <label>Details<input name="desc" required placeholder="e.g. Cash sales deposited, bank charges, owner's withdrawal"></label>
      <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
    body.querySelector('#be').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const { error: err } = await sb.rpc('bank_entry', { p_account: f.account, p_direction: f.dir, p_amount: Number(f.amount), p_description: f.desc });
      if (err) { toast(err.message, 'danger'); return; }
      closeModal(); toast('Saved'); ctx.rerender();
    });
  });
}
