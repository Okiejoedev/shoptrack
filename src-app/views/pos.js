import { state, sellBranch, stockAt, recordSale, addCustomer, isManager, isOnline } from '../store.js';
import { esc, naira, icon, toast, modal, closeModal, formData, uuid, METHOD_LABEL, empty, fmtQty } from '../ui.js';
import { showReceipt } from './receipt.js';

// cart key = productId|unit  (unit: 'pack' or 'carton')
const pos = { cart: new Map(), discount: '', discountPct: false, customer: '', method: 'cash', paid: '', q: '', cat: 'All' };
const CASHIER_MAX_DISCOUNT = 0.1;

export const cartonPrice = (p) => Number(p.carton_price) > 0 ? Number(p.carton_price) : Number(p.sell_price) * p.packs_per_carton;
const packsOf = (l) => l.qty * (l.unit === 'carton' ? l.ppc : 1);

function totals() {
  let sub = 0, count = 0;
  pos.cart.forEach((l) => { sub += l.qty * l.price; count += l.qty; });
  let disc = Number(pos.discount || 0);
  if (pos.discountPct) disc = (sub * disc) / 100;
  disc = Math.min(Math.max(0, disc), sub);
  const total = sub - disc;
  let paid;
  if (pos.method === 'credit') paid = 0;
  else if (pos.method === 'split') paid = Math.min(Number(pos.paid || 0), total);
  else paid = total;
  const tendered = pos.method === 'cash' && pos.paid !== '' ? Number(pos.paid) : null;
  return { sub, disc, total, paid, count, change: tendered != null ? Math.max(0, tendered - total) : 0, tendered };
}

function packsInCart(pid) {
  let n = 0; pos.cart.forEach((l, k) => { if (k.startsWith(pid + '|')) n += packsOf(l); }); return n;
}

export async function renderPOS(el) {
  const branch = sellBranch();
  el.innerHTML = `
  <div class="pos">
    <section class="pos-products">
      <div class="pos-search">
        <label class="search">${icon.search}<span class="sr-only">Search products</span>
          <input id="pos-q" placeholder="Search products" value="${esc(pos.q)}" autocomplete="off"></label>
      </div>
      <div class="chips" id="pos-cats"></div>
      <div class="product-grid" id="pos-grid"></div>
    </section>
    <aside class="pos-cart card" id="pos-cart" aria-label="Current sale"></aside>
  </div>
  <button class="cart-jump" id="cart-jump"></button>`;

  const grid = el.querySelector('#pos-grid');
  const cats = el.querySelector('#pos-cats');
  const cartEl = el.querySelector('#pos-cart');
  const active = () => state.products.filter((p) => p.active);

  const drawCats = () => {
    const list = ['All', ...[...new Set(active().map((p) => p.category || 'General'))].sort()];
    cats.innerHTML = list.map((c) => `<button class="chip ${c === pos.cat ? 'on' : ''}" data-cat="${esc(c)}" aria-pressed="${c === pos.cat}">${esc(c)}</button>`).join('');
  };
  const drawGrid = () => {
    const q = pos.q.trim().toLowerCase();
    const items = active().filter((p) => (pos.cat === 'All' || (p.category || 'General') === pos.cat)
      && (!q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)));
    grid.innerHTML = items.length ? items.map((p) => {
      const s = stockAt(p.id, branch) - packsInCart(p.id);
      const priced = Number(p.sell_price) > 0;
      const hasCarton = p.packs_per_carton > 1;
      const inCart = packsInCart(p.id);
      return `<div class="product ${inCart ? 'in-cart' : ''} ${s <= 0 ? 'out' : ''}">
        ${p.image_url ? `<img class="p-img" src="${esc(p.image_url)}" alt="" loading="lazy">` : ''}
        <span class="p-name">${esc(p.name)}</span>
        <span class="p-stock ${s <= p.reorder_level ? 'low' : ''}">${s <= 0 ? 'None in store' : fmtQty(s, p.packs_per_carton) + ' in store'}</span>
        ${priced ? `<div class="p-buy">
          <button data-add="${p.id}" data-unit="pack" aria-label="Add one pack of ${esc(p.name)}"><span>+ Pack</span><strong>${naira(p.sell_price)}</strong></button>
          ${hasCarton ? `<button data-add="${p.id}" data-unit="carton" aria-label="Add one carton of ${esc(p.name)}"><span>+ Carton (${p.packs_per_carton})</span><strong>${naira(cartonPrice(p))}</strong></button>` : ''}
        </div>` : `<div class="p-noprice">Price not set yet${isManager() ? ` · <a href="#/products">set it</a>` : ''}</div>`}
        ${inCart ? `<span class="p-badge">${fmtQty(inCart, p.packs_per_carton)}</span>` : ''}
      </div>`;
    }).join('') : empty('No products match', 'Try another name.');
  };

  const jump = el.querySelector('#cart-jump');
  jump.onclick = () => cartEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(([e]) => { jump.style.visibility = e.isIntersecting ? 'hidden' : 'visible'; });
    io.observe(cartEl);
  }

  const drawCart = () => {
    const t = totals();
    jump.classList.toggle('show', t.count > 0);
    jump.innerHTML = `<span>View sale · ${pos.cart.size} line${pos.cart.size === 1 ? '' : 's'}</span><span>${naira(t.total)}</span>`;
    const lines = [...pos.cart.entries()];
    const cust = state.customers.find((c) => c.id === pos.customer);
    const mgr = isManager();
    cartEl.innerHTML = `
      <div class="cart-head"><h2>Current sale</h2>${lines.length ? '<button class="btn ghost small" id="cart-clear">Clear</button>' : ''}</div>
      <div class="cart-customer">
        <label class="grow">Customer
          <select id="cart-cust"><option value="">Walk-in customer</option>
          ${state.customers.filter((c) => c.name !== 'Walk-in customer').map((c) => `<option value="${c.id}" ${c.id === pos.customer ? 'selected' : ''}>${esc(c.name)}${Number(c.balance) > 0 ? ` · owes ${naira(c.balance)}` : ''}</option>`).join('')}
          </select></label>
        <button class="btn ghost small add-cust" id="cart-newcust">${icon.plus}<span>New</span></button>
      </div>
      <div class="cart-lines">${lines.length ? lines.map(([key, l]) => {
        const over = packsInCart(l.pid) > stockAt(l.pid, branch);
        return `<div class="cart-line">
          <div class="cl-info"><div class="cl-name">${esc(l.name)}</div>
            <div class="muted small"><span class="unit-tag ${l.unit}">${l.unit === 'carton' ? `Carton of ${l.ppc}` : 'Pack'}</span>
            ${mgr ? `<label class="inline-price">@ ₦<input type="number" min="0" step="any" value="${l.price}" data-price="${key}" aria-label="Price for ${esc(l.name)}"></label>` : '@ ' + naira(l.price)}
            ${over ? ' · <span class="text-danger">more than in store</span>' : ''}</div></div>
          <div class="qty">
            <button class="icon-btn small" data-dec="${key}" aria-label="One less">${icon.minus}</button>
            <input type="number" min="1" value="${l.qty}" data-qty="${key}" aria-label="Quantity of ${esc(l.name)}">
            <button class="icon-btn small" data-inc="${key}" aria-label="One more">${icon.plus}</button>
          </div>
          <div class="cl-total">${naira(l.qty * l.price)}</div>
        </div>`;
      }).join('') : `<div class="cart-empty">Tap <strong>+ Pack</strong> or <strong>+ Carton</strong> on a product to add it.</div>`}</div>
      <div class="cart-foot">
        <div class="row between"><span class="muted">Subtotal</span><span>${naira(t.sub)}</span></div>
        <div class="row between discount-row">
          <label class="row gap-s">Discount
            <input type="number" min="0" step="any" id="cart-disc" value="${esc(pos.discount)}" placeholder="0" aria-label="Discount">
            <button class="btn ghost small" id="disc-mode" aria-label="Switch discount between naira and percent">${pos.discountPct ? '%' : '₦'}</button></label>
          <span>${t.disc ? '−' + naira(t.disc) : '—'}</span></div>
        <div class="row between cart-total"><span>Total</span><strong>${naira(t.total)}</strong></div>
        <div class="seg methods" role="group" aria-label="Payment method">
          ${['cash', 'transfer', 'pos', 'split', 'credit'].map((m) => `<button data-method="${m}" class="${pos.method === m ? 'on' : ''}" aria-pressed="${pos.method === m}">${METHOD_LABEL[m]}</button>`).join('')}
        </div>
        ${pos.method === 'cash' ? `<label class="row between">Cash received <input type="number" min="0" id="cart-paid" value="${esc(pos.paid)}" placeholder="${t.total}"></label>
          ${t.tendered != null && t.tendered >= t.total ? `<div class="row between change"><span>Change</span><strong>${naira(t.change)}</strong></div>` : ''}
          ${t.tendered != null && t.tendered < t.total ? `<div class="text-danger small">Not enough cash. Use Part-paid to put the rest on the customer's account.</div>` : ''}` : ''}
        ${pos.method === 'split' ? `<label class="row between">Amount paid now <input type="number" min="0" id="cart-paid" value="${esc(pos.paid)}" placeholder="0"></label>
          <div class="row between"><span class="muted">Goes on account</span><strong>${naira(t.total - t.paid)}</strong></div>` : ''}
        ${pos.method === 'credit' ? `<div class="row between"><span class="muted">Full amount on account</span><strong>${naira(t.total)}</strong></div>` : ''}
        ${(pos.method === 'split' || pos.method === 'credit') && !cust ? '<div class="text-danger small">Choose a customer for a credit or part-paid sale.</div>' : ''}
        ${cust && cust.credit_limit > 0 && Number(cust.balance) + (t.total - t.paid) > cust.credit_limit && t.total - t.paid > 0 ? `<div class="alert warn small">${esc(cust.name)} will be over their ${naira(cust.credit_limit)} credit limit.</div>` : ''}
        <button class="btn primary block big" id="cart-pay" ${lines.length ? '' : 'disabled'}>${isOnline() ? 'Complete sale' : 'Complete sale (save offline)'} · ${naira(t.total)}</button>
      </div>`;
  };

  const add = (pid, unit, n = 1) => {
    const p = state.products.find((x) => x.id === pid); if (!p) return;
    const key = pid + '|' + unit;
    const l = pos.cart.get(key) || { pid, unit, name: p.name, qty: 0, ppc: p.packs_per_carton, price: unit === 'carton' ? cartonPrice(p) : Number(p.sell_price) };
    l.qty += n;
    if (l.qty <= 0) pos.cart.delete(key); else pos.cart.set(key, l);
    drawGrid(); drawCart();
  };

  drawCats(); drawGrid(); drawCart();

  const q = el.querySelector('#pos-q');
  q.addEventListener('input', () => { pos.q = q.value; drawGrid(); });
  cats.addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (b) { pos.cat = b.dataset.cat; drawCats(); drawGrid(); } });
  grid.addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (b) add(b.dataset.add, b.dataset.unit); });

  cartEl.addEventListener('click', async (e) => {
    const t = e.target;
    const inc = t.closest('[data-inc]'), dec = t.closest('[data-dec]');
    if (inc) { const l = pos.cart.get(inc.dataset.inc); add(l.pid, l.unit, 1); }
    if (dec) { const l = pos.cart.get(dec.dataset.dec); add(l.pid, l.unit, -1); }
    if (t.closest('#cart-clear')) { reset(); drawGrid(); drawCart(); }
    if (t.closest('#disc-mode')) { pos.discountPct = !pos.discountPct; drawCart(); }
    if (t.closest('[data-method]')) { pos.method = t.closest('[data-method]').dataset.method; pos.paid = ''; drawCart(); }
    if (t.closest('#cart-newcust')) newCustomer(() => drawCart());
    if (t.closest('#cart-pay')) await complete(branch, () => { drawGrid(); drawCart(); });
  });
  cartEl.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'cart-cust') { pos.customer = t.value; drawCart(); }
    if (t.dataset.qty) { const l = pos.cart.get(t.dataset.qty); const v = Math.max(0, parseInt(t.value || '0', 10)); if (v === 0) pos.cart.delete(t.dataset.qty); else l.qty = v; drawGrid(); drawCart(); }
    if (t.dataset.price) { const l = pos.cart.get(t.dataset.price); l.price = Math.max(0, Number(t.value || 0)); drawCart(); }
    if (t.id === 'cart-disc') { pos.discount = t.value; drawCart(); }
    if (t.id === 'cart-paid') { pos.paid = t.value; drawCart(); }
  });
}

function reset() { pos.cart.clear(); pos.discount = ''; pos.customer = ''; pos.method = 'cash'; pos.paid = ''; }

async function complete(branch, redraw) {
  const t = totals();
  if (!pos.cart.size) return;
  const cust = state.customers.find((c) => c.id === pos.customer) || null;
  if ((pos.method === 'credit' || (pos.method === 'split' && t.paid < t.total)) && !cust) { toast('Choose a customer first.', 'warn'); return; }
  if (pos.method === 'cash' && t.tendered != null && t.tendered < t.total) { toast('Cash received is less than the total.', 'warn'); return; }
  if (!isManager() && t.disc > t.sub * CASHIER_MAX_DISCOUNT + 0.01) { toast(`Cashiers can give up to ${CASHIER_MAX_DISCOUNT * 100}% discount. Ask a manager.`, 'warn'); return; }

  const lines = [...pos.cart.values()];
  const method = pos.method === 'split' && t.paid >= t.total ? 'cash' : pos.method;
  const sale = {
    p_id: uuid(), p_branch: branch, p_method: method, p_amount_paid: t.paid, p_discount: t.disc, p_customer: cust?.id || null,
    p_items: lines.map((l) => ({ product_id: l.pid, unit: l.unit, qty: l.qty, unit_price: l.price, packs: packsOf(l) })),
    meta: { total: t.total, totalText: naira(t.total), items: lines.map((l) => ({ name: `${l.name} (${l.unit})`, qty: l.qty })), customer: cust?.name || null },
  };
  const btn = document.getElementById('cart-pay'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const res = await recordSale(sale);
  if (res.failed) toast('The server refused this sale: ' + res.failed + '. Open the sync panel to review it.', 'danger');
  (res.warnings || []).forEach((w) => toast(w, 'warn'));
  const receipt = {
    id: sale.p_id, receipt_no: res.receipt_no, created_at: new Date().toISOString(), branch_id: branch, cashier: state.profile?.full_name,
    items: lines.map((l) => ({ name: l.unit === 'carton' ? `${l.name} (carton of ${l.ppc})` : `${l.name} (pack)`, qty: l.qty, unit_price: l.price })),
    subtotal: t.sub, discount: t.disc, total: t.total, amount_paid: t.paid, method, customer: cust, pending: res.offline, change: t.change,
  };
  reset(); redraw();
  showReceipt(receipt, { onNew: () => document.getElementById('pos-q')?.focus() });
}

function newCustomer(done) {
  const body = modal('New customer', `<form id="nc" class="form">
    <label>Name<input name="name" required></label>
    <label>Phone (for WhatsApp receipts)<input name="phone" inputmode="tel" placeholder="0803 000 0000"></label>
    <label>Address<input name="address"></label>
    <label>Credit limit (₦, 0 = no limit)<input name="credit_limit" type="number" min="0" value="0"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Add customer</button></div></form>`);
  body.querySelector('#nc').addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = await addCustomer(formData(e.target));
    pos.customer = c.id; closeModal(); toast(`${c.name} added`); done();
  });
}
