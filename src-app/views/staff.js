import { sb, state, isOnline, branchName } from '../store.js';
import { esc, icon, toast, modal, closeModal, formData, fmtDateTime, empty, needsOnline } from '../ui.js';

const ROLE_INFO = {
  owner: 'Everything, including staff, settings and all profit figures',
  manager: 'Products and prices, warehouses, moving stock, suppliers, porter fees, expenses, reports and voiding sales. Can see bank balances but not add accounts. No staff or settings.',
  cashier: 'Recording sales at the Store, customers, and receiving stock into the Store. No cost prices, profit, bank or supplier figures.',
};

async function call(body) {
  const { data, error } = await sb.functions.invoke('manage-staff', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch (e) { /* keep message */ }
    throw new Error(msg);
  }
  return data;
}

export async function renderStaff(el, ctx) {
  if (!isOnline()) { el.innerHTML = needsOnline('Staff management'); return; }
  const [p, a] = await Promise.all([
    sb.from('profiles').select('*').order('role').order('full_name'),
    sb.from('activity_log').select('*, profiles(full_name)').order('created_at', { ascending: false }).limit(40),
  ]);
  if (p.error) throw p.error;
  if (!ctx.isCurrent()) return;
  const people = p.data;

  el.innerHTML = `
  <div class="grid-2">
    <section class="card span-2 flush">
      <div class="card-head pad"><h2>Team</h2><button class="btn primary" id="st-add">${icon.plus}<span>Add staff</span></button></div>
      <div class="scroll"><table class="table stack"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Location</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${people.map((x) => `<tr><td><strong>${esc(x.full_name)}</strong>${x.id === state.profile.id ? ' <span class="muted small">(you)</span>' : ''}</td><td>${esc(x.email || '')}</td>
        <td><span class="pill ${x.role === 'owner' ? 'ok' : ''}">${esc(x.role)}</span></td><td>${esc(x.branch_id ? branchName(x.branch_id) : 'All')}</td>
        <td>${x.active ? '<span class="pill ok">Active</span>' : '<span class="pill danger">Inactive</span>'}</td>
        <td class="actions"><button class="btn small" data-edit="${x.id}">Edit</button><button class="btn small ghost" data-pw="${x.id}">Reset password</button></td></tr>`).join('')}</tbody></table></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>What each role can do</h2></div>
      ${Object.entries(ROLE_INFO).map(([k, v]) => `<div class="role-row"><strong>${k[0].toUpperCase() + k.slice(1)}</strong><span class="muted">${v}</span></div>`).join('')}
    </section>
    <section class="card">
      <div class="card-head"><h2>Activity log</h2></div>
      ${(a.data || []).length ? `<div class="list">${a.data.map((x) => `<div class="list-row"><div><strong>${esc(x.action)}</strong> <span class="muted small">${esc(x.detail || '')}</span>
        <div class="muted small">${esc(x.profiles?.full_name || 'System')} · ${fmtDateTime(x.created_at)}</div></div></div>`).join('')}</div>` : empty('Nothing logged yet')}
    </section>
  </div>`;

  const form = (x) => {
    const isNew = !x; x = x || { role: 'cashier', branch_id: state.branches[0]?.id, active: true };
    const body = modal(isNew ? 'Add staff member' : `Edit ${x.full_name}`, `<form class="form" id="sf">
      <label>Full name<input name="full_name" value="${esc(x.full_name || '')}" required></label>
      ${isNew ? `<label>Email (used to sign in)<input name="email" type="email" required></label>
      <label>Starting password (8+ characters)<input name="password" type="text" minlength="8" required autocomplete="off"></label>` : ''}
      <div class="row gap"><label class="grow">Role<select name="role">${Object.keys(ROLE_INFO).map((r) => `<option ${r === x.role ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label class="grow">Location<select name="branch_id"><option value="">All locations</option>${state.branches.map((b) => `<option value="${b.id}" ${b.id === x.branch_id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label></div>
      ${!isNew ? `<label class="check"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}> Active (untick to block sign-in)</label>` : ''}
      <p class="muted small">Cashiers sell at the Store.</p>
      <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">${isNew ? 'Create account' : 'Save'}</button></div></form>`);
    body.querySelector('#sf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      if (f.role === 'cashier' && !f.branch_id) { toast('Pick the Store for a cashier.', 'warn'); return; }
      try {
        if (isNew) await call({ action: 'create', ...f });
        else await call({ action: 'update', id: x.id, full_name: f.full_name, role: f.role, branch_id: f.branch_id || null, active: !!f.active });
        closeModal(); toast(isNew ? `Account created for ${f.full_name}. Share the email and password with them.` : 'Saved'); ctx.rerender();
      } catch (err) { toast(err.message, 'danger'); }
    });
  };
  el.querySelector('#st-add').onclick = () => form(null);
  el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => form(people.find((x) => x.id === b.dataset.edit)));
  el.querySelectorAll('[data-pw]').forEach((b) => b.onclick = () => {
    const x = people.find((y) => y.id === b.dataset.pw);
    const body = modal(`New password for ${x.full_name}`, `<form class="form" id="pw">
      <label>New password (8+ characters)<input name="password" type="text" minlength="8" required autocomplete="off"></label>
      <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Set password</button></div></form>`);
    body.querySelector('#pw').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await call({ action: 'reset_password', id: x.id, password: e.target.password.value }); closeModal(); toast('Password updated'); }
      catch (err) { toast(err.message, 'danger'); }
    });
  });
}
