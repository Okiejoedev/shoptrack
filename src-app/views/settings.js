import { sb, state, isOnline, refreshCore } from '../store.js';
import { esc, icon, toast, modal, closeModal, formData, needsOnline } from '../ui.js';

export async function renderSettings(el, ctx) {
  if (!isOnline()) { el.innerHTML = needsOnline('Settings'); return; }
  const { data: branches } = await sb.from('branches').select('*').order('name');
  if (!ctx.isCurrent()) return;
  const s = state.settings;
  el.innerHTML = `
  <div class="grid-2">
    <section class="card">
      <div class="card-head"><h2>Business details</h2></div>
      <form class="form" id="bf">
        <label>Business name<input name="business_name" value="${esc(s.business_name || '')}" required></label>
        <label>Phone on receipts<input name="phone" value="${esc(s.phone || '')}"></label>
        <label>Receipt footer<input name="receipt_footer" value="${esc(s.receipt_footer || '')}"></label>
        <label>Currency<input value="Nigerian naira (₦)" disabled></label>
        <div class="row end"><button class="btn primary">Save</button></div>
      </form>
    </section>
    <section class="card">
      <div class="card-head"><h2>Branches</h2><button class="btn small primary" id="br-add">${icon.plus}<span>Add branch</span></button></div>
      <div class="list">${(branches || []).map((b) => `<div class="list-row"><div><strong>${esc(b.name)}</strong> ${b.active ? '' : '<span class="pill danger">Closed</span>'}
        <div class="muted small">${esc(b.address || '')}${b.phone ? ' · ' + esc(b.phone) : ''}</div></div>
        <button class="btn small" data-br="${b.id}">Edit</button></div>`).join('')}</div>
    </section>
    <section class="card span-2">
      <div class="card-head"><h2>Install on phones and tills</h2></div>
      <p>ShopTrack installs like an app and keeps working with no internet. On Android Chrome, open the menu and tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>). On iPhone Safari, tap <strong>Share → Add to Home Screen</strong>. On a laptop, click the install icon in the address bar.</p>
      <p class="muted">Each device keeps its own copy of products, prices and stock. Sales made offline sync automatically when the connection returns, and nothing is lost if the app is closed.</p>
    </section>
  </div>`;
  el.querySelector('#bf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const { error } = await sb.from('settings').update({ ...f, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) { toast(error.message, 'danger'); return; }
    await refreshCore(); toast('Saved'); ctx.rerender();
  });
  const form = (b) => {
    const isNew = !b; b = b || { active: true };
    const body = modal(isNew ? 'Add branch' : `Edit ${b.name}`, `<form class="form" id="brf">
      <label>Name<input name="name" value="${esc(b.name || '')}" required></label>
      <label>Address<input name="address" value="${esc(b.address || '')}"></label>
      <label>Phone<input name="phone" value="${esc(b.phone || '')}"></label>
      ${!isNew ? `<label class="check"><input type="checkbox" name="active" ${b.active ? 'checked' : ''}> Open</label>` : ''}
      <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
    body.querySelector('#brf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const row = { name: f.name, address: f.address || null, phone: f.phone || null, ...(isNew ? {} : { active: !!f.active }) };
      const { error } = isNew ? await sb.from('branches').insert(row) : await sb.from('branches').update(row).eq('id', b.id);
      if (error) { toast(error.message, 'danger'); return; }
      await refreshCore(); closeModal(); toast('Saved'); ctx.rerender();
    });
  };
  el.querySelector('#br-add').onclick = () => form(null);
  el.querySelectorAll('[data-br]').forEach((x) => x.onclick = () => form((branches || []).find((b) => b.id === x.dataset.br)));
}
