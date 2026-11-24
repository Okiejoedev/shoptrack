import { sb, state, isOnline, refreshCore, warehouses, storeId, stockAt } from '../store.js';
import { esc, naira, icon, toast, modal, closeModal, formData, empty, needsOnline, uuid, fmtQty } from '../ui.js';

let mode = 'list';   // 'list' | 'prices'
let q = '';
let onlyUnpriced = false;

const cartonCost = (p) => Number(p.cost_price) * p.packs_per_carton;
const cartonPrice = (p) => Number(p.carton_price) > 0 ? Number(p.carton_price) : Number(p.sell_price) * p.packs_per_carton;

export async function renderProducts(el, ctx) {
  if (!isOnline()) { el.innerHTML = needsOnline('Adding and editing products'); return; }
  const list = state.products
    .filter((p) => (!q || p.name.toLowerCase().includes(q.toLowerCase())) && (!onlyUnpriced || !(Number(p.sell_price) > 0)))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const unpriced = state.products.filter((p) => p.active && !(Number(p.sell_price) > 0)).length;

  el.innerHTML = `
  ${unpriced ? `<div class="alert warn">${icon.alert}<span><strong>${unpriced} product${unpriced === 1 ? '' : 's'}</strong> ${unpriced === 1 ? 'has' : 'have'} no selling price yet, so ${unpriced === 1 ? 'it' : 'they'} can't be sold. Use <strong>Quick price entry</strong> to fill them in fast.</span></div>` : ''}
  <div class="toolbar wrap">
    <div class="seg" role="tablist">
      <button role="tab" data-mode="list" class="${mode === 'list' ? 'on' : ''}" aria-selected="${mode === 'list'}">Products</button>
      <button role="tab" data-mode="prices" class="${mode === 'prices' ? 'on' : ''}" aria-selected="${mode === 'prices'}">Quick price entry</button>
    </div>
    <label class="search">${icon.search}<span class="sr-only">Search</span><input id="pr-q" placeholder="Search products" value="${esc(q)}"></label>
    <label class="check"><input type="checkbox" id="pr-unpriced" ${onlyUnpriced ? 'checked' : ''}> Only without a price</label>
    <div class="grow"></div>
    <button class="btn primary" id="pr-add">${icon.plus}<span>Add new product</span></button>
  </div>
  <div id="pr-body"></div>`;
  const body = el.querySelector('#pr-body');

  if (mode === 'list') {
    body.innerHTML = list.length ? `<div class="product-admin-grid">${list.map((p) => `
      <article class="pa-card ${p.active ? '' : 'archived'}">
        <div class="pa-img">${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">` : `<span class="pa-noimg">${icon.image}<span>No picture</span></span>`}</div>
        <div class="pa-info">
          <strong>${esc(p.name)}</strong>
          <span class="muted small">${esc(p.category || 'General')} · ${p.packs_per_carton} pack${p.packs_per_carton === 1 ? '' : 's'} per carton${p.active ? '' : ' · archived'}</span>
          ${Number(p.sell_price) > 0
            ? `<span class="small">Pack <strong>${naira(p.sell_price)}</strong>${p.packs_per_carton > 1 ? ` · Carton <strong>${naira(cartonPrice(p))}</strong>` : ''}</span>
               <span class="small muted">Cost ${naira(cartonCost(p))}/carton · margin ${naira(Number(p.sell_price) - Number(p.cost_price))}/pack</span>`
            : '<span class="pill warn">Price not set</span>'}
          <span class="small muted">In stock: ${fmtQty(stockAt(p.id, null), p.packs_per_carton)}</span>
        </div>
        <button class="btn small" data-edit="${p.id}">${icon.edit}<span>Edit</span></button>
      </article>`).join('')}</div>` : empty('No products match');
  } else {
    body.innerHTML = `<form id="qp"><div class="card flush"><div class="scroll"><table class="table price-table">
      <thead><tr><th>Product</th><th class="num">Packs / carton</th><th class="num">Cost per carton (₦)</th><th class="num">Pack price (₦)</th><th class="num">Carton price (₦)</th><th class="num">Margin / pack</th></tr></thead>
      <tbody>${list.map((p) => `<tr data-id="${p.id}">
        <td><strong>${esc(p.name)}</strong></td>
        <td class="num"><input type="number" min="1" name="ppc" value="${p.packs_per_carton}" aria-label="Packs per carton for ${esc(p.name)}"></td>
        <td class="num"><input type="number" min="0" step="any" name="ccost" value="${cartonCost(p) || ''}" placeholder="0" aria-label="Cost per carton for ${esc(p.name)}"></td>
        <td class="num"><input type="number" min="0" step="any" name="pprice" value="${Number(p.sell_price) || ''}" placeholder="0" aria-label="Pack price for ${esc(p.name)}"></td>
        <td class="num"><input type="number" min="0" step="any" name="cprice" value="${Number(p.carton_price) || ''}" placeholder="auto" aria-label="Carton price for ${esc(p.name)}"></td>
        <td class="num margin-cell"></td></tr>`).join('')}</tbody></table></div></div>
      <div class="sticky-save"><span class="muted small" id="qp-status">Leave carton price empty to charge pack price × packs per carton.</span>
      <button class="btn primary" id="qp-save">Save prices</button></div></form>`;
    const form = body.querySelector('#qp');
    const recalc = (tr) => {
      const ppc = Math.max(1, Number(tr.querySelector('[name=ppc]').value || 1));
      const cc = Number(tr.querySelector('[name=ccost]').value || 0), pp = Number(tr.querySelector('[name=pprice]').value || 0);
      const m = pp - cc / ppc;
      tr.querySelector('.margin-cell').innerHTML = pp ? `<span class="${m < 0 ? 'text-danger' : 'text-ok'}">${naira(m)}</span>` : '—';
      tr.querySelector('[name=cprice]').placeholder = pp ? String(pp * ppc) : 'auto';
      tr.dataset.dirty = '1';
    };
    form.querySelectorAll('tbody tr').forEach((tr) => { recalc(tr); delete tr.dataset.dirty; });
    form.addEventListener('input', (e) => { const tr = e.target.closest('tr'); if (tr) recalc(tr); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dirty = [...form.querySelectorAll('tbody tr[data-dirty]')];
      if (!dirty.length) { toast('No changes to save.'); return; }
      const btn = body.querySelector('#qp-save'); btn.disabled = true; btn.textContent = `Saving ${dirty.length}…`;
      let failed = 0;
      for (const tr of dirty) {
        const ppc = Math.max(1, parseInt(tr.querySelector('[name=ppc]').value || '1', 10));
        const row = { packs_per_carton: ppc, cost_price: Number(tr.querySelector('[name=ccost]').value || 0) / ppc,
          sell_price: Number(tr.querySelector('[name=pprice]').value || 0), carton_price: Number(tr.querySelector('[name=cprice]').value || 0), updated_at: new Date().toISOString() };
        const { error } = await sb.from('products').update(row).eq('id', tr.dataset.id);
        if (error) failed++;
      }
      await refreshCore();
      toast(failed ? `${failed} row(s) could not be saved.` : `Saved ${dirty.length} product${dirty.length === 1 ? '' : 's'}.`, failed ? 'danger' : 'info');
      ctx.rerender();
    });
  }

  el.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { mode = b.dataset.mode; ctx.rerender(); });
  el.querySelector('#pr-q').addEventListener('change', (e) => { q = e.target.value; ctx.rerender(); });
  el.querySelector('#pr-unpriced').addEventListener('change', (e) => { onlyUnpriced = e.target.checked; ctx.rerender(); });
  el.querySelector('#pr-add').onclick = () => productForm(null, ctx);
  body.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => productForm(state.products.find((p) => p.id === b.dataset.edit), ctx));
}

// shrink pictures before upload so they load fast on phones
async function shrink(file, max = 800) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
}

function productForm(p, ctx) {
  const isNew = !p;
  p = p || { name: '', category: '', packs_per_carton: 12, cost_price: 0, sell_price: '', carton_price: '', reorder_level: 12, active: true, image_url: null };
  const cats = [...new Set(state.products.map((x) => x.category).filter(Boolean))].sort();
  let newImage = null;
  const body = modal(isNew ? 'Add new product' : `Edit ${p.name}`, `<form class="form" id="pf">
    <div class="img-pick">
      <div class="img-preview" id="pf-prev">${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : icon.image}</div>
      <label class="btn ghost small file-btn">${icon.image}<span>${p.image_url ? 'Change picture' : 'Add picture'}</span>
        <input type="file" accept="image/*" id="pf-file" class="sr-only"></label>
      <span class="muted small">Take a photo or pick one. It shows on the sales screen.</span>
    </div>
    <label>Product name<input name="name" value="${esc(p.name)}" required></label>
    <div class="row gap wrap"><label class="grow">Category<input name="category" list="cats" value="${esc(p.category || '')}" placeholder="e.g. Soap"><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="grow">Packs in one carton<input name="ppc" type="number" min="1" value="${p.packs_per_carton}" required></label></div>
    <div class="row gap wrap"><label class="grow">Cost per carton (₦)<input name="ccost" type="number" min="0" step="any" value="${cartonCost(p) || ''}" placeholder="What you pay the supplier"></label>
      <label class="grow">Selling price per pack (₦)<input name="pprice" type="number" min="0" step="any" value="${Number(p.sell_price) || ''}" required></label>
      <label class="grow">Selling price per carton (₦)<input name="cprice" type="number" min="0" step="any" value="${Number(p.carton_price) || ''}" placeholder="auto"></label></div>
    <div class="muted small" id="pf-margin"></div>
    <label>Warn me when the Store has fewer than (packs)<input name="reorder" type="number" min="0" value="${p.reorder_level}"></label>
    ${isNew ? `<fieldset><legend>Opening stock</legend><div class="row gap wrap">
      ${warehouses().map((b) => `<label class="grow">${esc(b.name)} (cartons)<input name="open_${b.id}" type="number" min="0" value="0"></label>`).join('')}
      <label class="grow">Store (cartons)<input name="open_store_c" type="number" min="0" value="0"></label>
      <label class="grow">Store (loose packs)<input name="open_store_p" type="number" min="0" value="0"></label></div></fieldset>`
      : `<label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Active (untick to hide it from sales)</label>`}
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" id="pf-save">${isNew ? 'Add product' : 'Save changes'}</button></div></form>`, { wide: true });
  const form = body.querySelector('#pf');
  const m = () => {
    const ppc = Math.max(1, Number(form.ppc.value || 1)); const cc = Number(form.ccost.value || 0); const pp = Number(form.pprice.value || 0);
    form.cprice.placeholder = pp ? `auto: ${pp * ppc}` : 'auto';
    body.querySelector('#pf-margin').textContent = pp ? `Cost per pack ${naira(cc / ppc, { dp: cc % ppc ? 2 : 0 })} · margin ${naira(pp - cc / ppc)} per pack${pp < cc / ppc ? ' · selling below cost!' : ''}` : '';
  };
  form.addEventListener('input', m); m();
  body.querySelector('#pf-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    newImage = await shrink(file);
    body.querySelector('#pf-prev').innerHTML = `<img src="${URL.createObjectURL(newImage)}" alt="">`;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = body.querySelector('#pf-save'); btn.disabled = true; btn.textContent = 'Saving…';
    const f = formData(form);
    const ppc = Math.max(1, parseInt(f.ppc, 10));
    const row = { name: f.name.trim(), category: f.category.trim() || 'General', unit: 'pack', packs_per_carton: ppc,
      cost_price: Number(f.ccost || 0) / ppc, sell_price: Number(f.pprice || 0), carton_price: Number(f.cprice || 0),
      reorder_level: parseInt(f.reorder || '0', 10), updated_at: new Date().toISOString() };
    if (!isNew) row.active = !!f.active;
    const id = isNew ? uuid() : p.id;
    if (newImage) {
      const path = `${id}/${Date.now()}.jpg`;
      const up = await sb.storage.from('product-images').upload(path, newImage, { contentType: 'image/jpeg', upsert: true });
      if (up.error) { toast('Picture upload failed: ' + up.error.message, 'danger'); btn.disabled = false; btn.textContent = 'Try again'; return; }
      row.image_url = sb.storage.from('product-images').getPublicUrl(path).data.publicUrl;
    }
    const res = isNew ? await sb.from('products').insert({ id, ...row }) : await sb.from('products').update(row).eq('id', p.id);
    if (res.error) { toast(res.error.message, 'danger'); btn.disabled = false; btn.textContent = 'Try again'; return; }
    if (isNew) {
      const opening = [...warehouses().map((b) => [b.id, Number(f['open_' + b.id] || 0) * ppc]),
        [storeId(), Number(f.open_store_c || 0) * ppc + Number(f.open_store_p || 0)]];
      for (const [bid, packs] of opening) {
        if (packs > 0) await sb.rpc('record_stock_movement', { p_id: uuid(), p_product: id, p_branch: bid, p_change: packs, p_reason: 'opening', p_note: 'Opening stock' });
      }
    }
    await refreshCore(); closeModal(); toast(isNew ? `${row.name} added` : 'Saved'); ctx.rerender();
  });
}
