// Selling screen. Two modes share one engine, one inventory and one set of reports:
//   express  – fastest path: tap, adjust, take money, next customer. Several customers can be open at once.
//   invoice  – the same, plus required customer details and an A4 invoice.
import { state, sellBranch, stockAt, recordSale, addCustomer, isManager, isOnline, tickets, activeTicket, newTicket, closeTicket, saveTickets } from '../store.js';
import { esc, naira, icon, toast, modal, closeModal, formData, uuid, empty, fmtQty, todayISO, waLink } from '../ui.js';
import { showReceipt, receiptText } from './receipt.js';
import { invoicePDF } from '../export.js';

export const cartonPrice = (p) => Number(p.carton_price) > 0 ? Number(p.carton_price) : Number(p.sell_price) * p.packs_per_carton;
const listPrice = (p, unit) => (unit === 'carton' ? cartonPrice(p) : Number(p.sell_price));
const packsOf = (l) => l.qty * (l.unit === 'carton' ? l.ppc : 1);
const ui = { q: '', cat: 'All', panel: '', last: { express: null, invoice: null } };
let keyHandler = null;

function totals(t) {
  let sub = 0, cartons = 0, packs = 0;
  t.lines.forEach((l) => { sub += l.qty * l.price; if (l.unit === 'carton') cartons += l.qty; else packs += l.qty; });
  let disc = Number(t.discount || 0);
  if (t.discountPct) disc = (sub * disc) / 100;
  disc = Math.min(Math.max(0, disc), sub);
  const total = sub - disc;
  const porter = Math.max(0, Number(t.porterFee || 0));
  const charge = t.porterCustomerPays ? porter : 0;
  const grand = total + charge;
  let paid = grand, transfer = 0, change = 0, received = null;
  if (t.method === 'cash') { received = t.paid === '' ? null : Number(t.paid); change = received != null ? Math.max(0, received - grand) : 0; }
  if (t.method === 'transfer' || t.method === 'pos') transfer = grand;
  if (t.method === 'mixed') {
    const cash = Math.min(Math.max(0, Number(t.paid || 0)), grand);
    transfer = t.transfer === '' ? grand - cash : Math.min(Math.max(0, Number(t.transfer)), grand - cash);
    paid = cash + transfer;
  }
  if (t.method === 'credit') { paid = Math.min(Math.max(0, Number(t.paid || 0)), grand); transfer = 0; }
  return { sub, disc, total, porter, charge, grand, paid, transfer, change, received, cartons, packs, owed: grand - paid };
}

const qtyText = (c, p) => [c ? `${c} carton${c === 1 ? '' : 's'}` : '', p ? `${p} pack${p === 1 ? '' : 's'}` : ''].filter(Boolean).join(' + ') || '0';

export async function renderSale(el, ctx, mode = 'express') {
  const branch = sellBranch();
  const express = mode === 'express';
  let t = activeTicket(mode);
  const packsInTicket = (pid) => t.lines.filter((l) => l.pid === pid).reduce((a, l) => a + packsOf(l), 0);

  el.innerHTML = `
  <div class="sell ${mode}">
    <section class="sell-products">
      <div class="sell-search">
        <label class="search">${icon.search}<span class="sr-only">Search products</span>
          <input id="s-q" placeholder="Search products (e.g. Dudu Osun, Colgate, Air Pro)" value="${esc(ui.q)}" autocomplete="off" enterkeyhint="search"></label>
        <a class="btn ghost mode-switch" href="#/${express ? 'invoice' : 'pos'}">${express ? `${icon.sales}<span>Full invoice</span>` : `${icon.pos}<span>Express sale</span>`}</a>
      </div>
      <div class="chips" id="s-cats"></div>
      <div class="sell-grid" id="s-grid"></div>
    </section>
    <aside class="sell-cart card" id="s-cart" aria-label="Current sale"></aside>
  </div>
  <button class="cart-jump" id="s-jump"></button>`;

  const grid = el.querySelector('#s-grid'), cats = el.querySelector('#s-cats'), cart = el.querySelector('#s-cart'), jump = el.querySelector('#s-jump');
  const active = () => state.products.filter((p) => p.active);
  const save = () => saveTickets();

  const drawCats = () => {
    const list = ['All', ...[...new Set(active().map((p) => p.category || 'General'))].sort()];
    cats.innerHTML = list.map((c) => `<button class="chip ${c === ui.cat ? 'on' : ''}" data-cat="${esc(c)}" aria-pressed="${c === ui.cat}">${esc(c)}</button>`).join('');
  };
  const matches = () => {
    const q = ui.q.trim().toLowerCase();
    return active().filter((p) => (ui.cat === 'All' || (p.category || 'General') === ui.cat) && (!q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)));
  };
  const drawGrid = () => {
    const items = matches();
    grid.innerHTML = items.length ? items.map((p) => {
      const s = stockAt(p.id, branch) - packsInTicket(p.id);
      const priced = Number(p.sell_price) > 0;
      const inSale = packsInTicket(p.id);
      return `<div class="sp ${inSale ? 'in' : ''} ${s <= 0 ? 'out' : ''}">
        <div class="sp-top">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : ''}
          <div><div class="sp-name">${esc(p.name)}</div><div class="sp-stock ${s <= p.reorder_level ? 'low' : ''}">${s <= 0 ? 'None in store' : 'In store: ' + fmtQty(s, p.packs_per_carton)}</div></div>
          ${inSale ? `<span class="sp-badge">${fmtQty(inSale, p.packs_per_carton)}</span>` : ''}</div>
        ${priced ? `<div class="sp-buy">
          ${p.packs_per_carton > 1 ? `<button data-add="${p.id}" data-unit="carton" aria-label="Add a carton of ${esc(p.name)}"><span>Carton (${p.packs_per_carton})</span><strong>${naira(cartonPrice(p))}</strong><i>${icon.plus}</i></button>` : ''}
          <button data-add="${p.id}" data-unit="pack" aria-label="Add a pack of ${esc(p.name)}"><span>Pack</span><strong>${naira(p.sell_price)}</strong><i>${icon.plus}</i></button>
        </div>` : `<div class="p-noprice">Price not set${isManager() ? ' · <a href="#/products">set it</a>' : ''}</div>`}
      </div>`;
    }).join('') : empty('No products match', 'Try another name.');
  };

  const tabLabel = (x) => x.customerName || state.customers.find((c) => c.id === x.customerId)?.name || x.label;
  const drawCart = () => {
    const tt = totals(t);
    const mine = tickets.list.filter((x) => x.mode === mode);
    const last = ui.last[mode];
    const custSaved = state.customers.find((c) => c.id === t.customerId);
    const needCustomer = !express || t.method === 'credit';
    jump.classList.toggle('show', t.lines.length > 0);
    jump.innerHTML = `<span>${tabLabel(t)} · ${t.lines.length} item${t.lines.length === 1 ? '' : 's'}</span><span>${naira(tt.grand)}</span>`;

    cart.innerHTML = `
      ${express ? `<div class="tickets" role="tablist" aria-label="Open sales">
        ${mine.map((x) => { const v = totals(x).grand; return `<button role="tab" class="ticket ${x.id === t.id ? 'on' : ''}" aria-selected="${x.id === t.id}" data-ticket="${x.id}">
          <span>${esc(tabLabel(x))}</span><small>${x.lines.length ? naira(v) : 'empty'}</small></button>`; }).join('')}
        <button class="ticket add" id="t-new" aria-label="Start a sale for another customer">${icon.plus}<span>Next customer</span></button>
      </div>` : `<div class="cart-head"><h2>Invoice</h2><span class="muted small">INV no. is given when you complete</span></div>`}

      ${last ? `<div class="last-sale">${icon.check}<div class="grow"><strong>${last.pending ? 'Saved offline' : 'Sale #' + (last.receipt_no || '…')}</strong> · ${naira(last.grand)} · ${esc(last.methodText)}
        <div class="small muted">${esc(last.who)}</div></div>
        <button class="btn small ghost" id="l-wa">${icon.whatsapp}<span>WhatsApp</span></button>
        <button class="btn small ghost" id="l-print">${icon.print}<span>Receipt</span></button>
        <button class="btn small ghost" id="l-inv">${icon.download}<span>Invoice</span></button>
        <button class="icon-btn small" id="l-x" aria-label="Dismiss">${icon.x}</button></div>` : ''}

      ${needCustomer ? customerBlock(t, custSaved, true, express) : ''}

      <div class="lines">${t.lines.length ? `<table class="sale-table"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price (₦)</th><th class="num">Amount</th><th></th></tr></thead><tbody>
        ${t.lines.map((l, i) => {
          const diff = l.price - l.list;
          return `<tr>
          <td><div class="li-name">${esc(l.name)}</div><span class="unit-tag ${l.unit}">${l.unit === 'carton' ? `Carton of ${l.ppc}` : 'Pack'}</span>
            ${diff ? `<span class="price-diff ${diff < 0 ? 'down' : 'up'}">${diff < 0 ? '−' : '+'}${naira(Math.abs(diff))} vs ${naira(l.list)}</span>` : ''}</td>
          <td class="num"><div class="qty"><button class="icon-btn small" data-dec="${i}" aria-label="One less">${icon.minus}</button>
            <input type="number" inputmode="numeric" min="1" value="${l.qty}" data-qty="${i}" aria-label="Quantity of ${esc(l.name)}">
            <button class="icon-btn small" data-inc="${i}" aria-label="One more">${icon.plus}</button></div></td>
          <td class="num"><input class="price-in ${diff ? 'changed' : ''}" type="number" inputmode="decimal" min="0" step="any" value="${l.price}" data-price="${i}" aria-label="Selling price for ${esc(l.name)}"></td>
          <td class="num amt">${naira(l.qty * l.price)}</td>
          <td><button class="icon-btn small ghosty" data-rm="${i}" aria-label="Remove ${esc(l.name)}">${icon.trash}</button></td></tr>`;
        }).join('')}</tbody></table>` : `<div class="cart-empty">Tap <strong>Carton</strong> or <strong>Pack</strong> on a product.<br><span class="muted small">Tap a price in the list to change it for this customer.</span></div>`}</div>

      <div class="cart-actions">
        <button class="btn small ghost" id="a-clear" ${t.lines.length ? '' : 'disabled'}>${icon.trash}<span>Clear</span></button>
        ${express ? `<button class="btn small ghost" id="a-park" ${t.lines.length ? '' : 'disabled'}>${icon.history}<span>Park</span></button>` : ''}
        <button class="btn small ghost ${ui.panel === 'disc' ? 'on' : ''}" id="a-disc">%<span>Discount</span></button>
        <button class="btn small ghost ${ui.panel === 'porter' ? 'on' : ''}" id="a-porter">${icon.porter}<span>Porter</span></button>
        ${express && !needCustomer ? `<button class="btn small ghost ${ui.panel === 'cust' ? 'on' : ''}" id="a-cust">${icon.customers}<span>Customer</span></button>` : ''}
      </div>
      ${ui.panel === 'disc' ? `<div class="panel row gap wrap"><label class="grow">Discount on the whole sale
        <span class="row gap-s"><input type="number" min="0" step="any" id="p-disc" value="${esc(t.discount)}" placeholder="0">
        <button class="btn ghost small" id="p-discmode">${t.discountPct ? '%' : '₦'}</button></span></label></div>` : ''}
      ${ui.panel === 'porter' ? `<div class="panel"><div class="row gap wrap">
        <label class="grow">Porter fee (₦)<input type="number" min="0" step="any" id="p-pfee" value="${esc(t.porterFee)}" placeholder="0"></label>
        <label class="grow">Porter / mallam<input id="p-pname" value="${esc(t.porterName)}" placeholder="Optional"></label></div>
        <div class="seg small" role="group" aria-label="Who pays the porter">
          <button data-pcp="1" class="${t.porterCustomerPays ? 'on' : ''}">Customer pays (add to bill)</button>
          <button data-pcp="0" class="${!t.porterCustomerPays ? 'on' : ''}">Shop pays (our cost)</button></div></div>` : ''}
      ${ui.panel === 'cust' && !needCustomer ? customerBlock(t, custSaved, false, express) : ''}

      <div class="summary">
        <div class="sum-lines">
          <div><span>Items</span><strong>${t.lines.length}</strong></div>
          <div><span>Quantity</span><strong>${qtyText(tt.cartons, tt.packs)}</strong></div>
          <div><span>Subtotal</span><strong>${naira(tt.sub)}</strong></div>
          ${tt.disc ? `<div><span>Discount</span><strong class="text-ok">−${naira(tt.disc)}</strong></div>` : ''}
          ${tt.porter ? `<div><span>Porter ${t.porterCustomerPays ? '(on bill)' : '(shop pays)'}</span><strong>${t.porterCustomerPays ? '+' : ''}${naira(tt.porter)}</strong></div>` : ''}
        </div>
        <div class="payable"><span>Total payable</span><strong>${naira(tt.grand)}</strong></div>
      </div>

      <div class="methods5" role="group" aria-label="Payment method">
        ${[['cash', 'Cash'], ['transfer', 'Transfer'], ['pos', 'POS'], ['mixed', 'Mixed'], ['credit', 'Credit']].map(([m, l]) =>
          `<button data-method="${m}" class="${t.method === m ? 'on' : ''}" aria-pressed="${t.method === m}">${l}</button>`).join('')}
      </div>
      <div class="pay-inputs">
        ${t.method === 'cash' ? `<label>Amount received (₦)<input type="number" inputmode="decimal" min="0" id="i-paid" value="${esc(t.paid)}" placeholder="${tt.grand}"></label>
          <div class="change-box ${tt.received != null && tt.received < tt.grand ? 'short' : ''}"><span>${tt.received != null && tt.received < tt.grand ? 'Short by' : 'Change'}</span>
          <strong>${naira(tt.received != null && tt.received < tt.grand ? tt.grand - tt.received : tt.change)}</strong></div>` : ''}
        ${t.method === 'mixed' ? `<label>Cash (₦)<input type="number" inputmode="decimal" min="0" id="i-paid" value="${esc(t.paid)}" placeholder="0"></label>
          <label>Transfer (₦)<input type="number" inputmode="decimal" min="0" id="i-tr" value="${esc(t.transfer)}" placeholder="${Math.max(0, tt.grand - Number(t.paid || 0))}"></label>` : ''}
        ${t.method === 'credit' ? `<label>Paid now (₦)<input type="number" inputmode="decimal" min="0" id="i-paid" value="${esc(t.paid)}" placeholder="0"></label>
          <div class="change-box short"><span>On account</span><strong>${naira(tt.owed)}</strong></div>` : ''}
        ${t.method === 'transfer' || t.method === 'pos' ? `<div class="muted small">Confirm the ${t.method === 'pos' ? 'POS slip' : 'transfer alert'} for ${naira(tt.grand)} before completing.</div>` : ''}
        ${t.method === 'mixed' && Math.round(tt.paid) < Math.round(tt.grand) ? `<div class="text-danger small">Cash + transfer is ${naira(tt.paid)}, ${naira(tt.grand - tt.paid)} short.</div>` : ''}
      </div>
      <button class="btn primary block big" id="s-pay" ${t.lines.length ? '' : 'disabled'}>${icon.check}<span>${express ? 'Complete sale' : 'Complete & create invoice'}${isOnline() ? '' : ' (offline)'}</span></button>
      ${express ? '<div class="shortcuts muted small">Shortcuts: <kbd>/</kbd> search · <kbd>F3</kbd> park · <kbd>F4</kbd> complete</div>' : ''}`;
  };

  function customerBlock(tk, saved, required, isExpress) {
    return `<div class="panel cust ${required ? 'req' : ''}">
      <div class="row between"><strong class="small">${required ? (isExpress ? 'Customer (needed for credit)' : 'Bill to') : 'Customer (optional)'}</strong>
        <button class="btn ghost small" id="c-new">${icon.plus}<span>New customer</span></button></div>
      <label>Saved customer<select id="c-sel"><option value="">${required && tk.method === 'credit' ? 'Choose a customer…' : 'Not a saved customer'}</option>
        ${state.customers.filter((c) => c.name !== 'Walk-in customer').map((c) => `<option value="${c.id}" ${c.id === tk.customerId ? 'selected' : ''}>${esc(c.name)}${Number(c.balance) > 0 ? ` · owes ${naira(c.balance)}` : ''}</option>`).join('')}</select></label>
      ${!saved ? `<div class="row gap wrap"><label class="grow">Name<input id="c-name" value="${esc(tk.customerName)}" placeholder="${required ? 'Customer name' : 'Optional'}"></label>
        <label class="grow">Phone (for WhatsApp)<input id="c-phone" inputmode="tel" value="${esc(tk.customerPhone)}" placeholder="0803…"></label></div>` : ''}
      ${!isExpress ? `<div class="row gap wrap">${!saved ? `<label class="grow">Address<input id="c-addr" value="${esc(tk.customerAddress)}"></label>` : ''}
        <label class="grow">Payment due<input type="date" id="c-due" value="${esc(tk.dueDate)}"></label></div>
        <label>Notes on invoice<input id="c-notes" value="${esc(tk.notes)}" placeholder="e.g. Delivered to Mile 12, driver Sunday"></label>` : ''}
      ${saved && Number(saved.balance) > 0 ? `<div class="small warn-text">${esc(saved.name)} already owes ${naira(saved.balance)}${saved.credit_limit > 0 ? ` (limit ${naira(saved.credit_limit)})` : ''}.</div>` : ''}
    </div>`;
  }

  const add = (pid, unit, n = 1) => {
    const p = state.products.find((x) => x.id === pid); if (!p) return;
    let l = t.lines.find((x) => x.pid === pid && x.unit === unit);
    if (!l) { l = { pid, unit, name: p.name, ppc: p.packs_per_carton, qty: 0, price: listPrice(p, unit), list: listPrice(p, unit) }; t.lines.push(l); }
    l.qty += n;
    if (l.qty <= 0) t.lines = t.lines.filter((x) => x !== l);
    save(); drawGrid(); drawCart();
  };
  const switchTo = (id) => { tickets.active[mode] = id; t = activeTicket(mode); ui.panel = ''; save(); drawGrid(); drawCart(); };

  drawCats(); drawGrid(); drawCart();
  jump.onclick = () => cart.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { jump.style.visibility = e.isIntersecting ? 'hidden' : 'visible'; }).observe(cart);

  const q = el.querySelector('#s-q');
  q.addEventListener('input', () => { ui.q = q.value; drawGrid(); });
  q.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const m = matches(); if (m.length !== 1 || !(Number(m[0].sell_price) > 0)) return;
    add(m[0].id, m[0].packs_per_carton > 1 ? 'carton' : 'pack'); q.select();
  });
  cats.addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (b) { ui.cat = b.dataset.cat; drawCats(); drawGrid(); } });
  grid.addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (b) add(b.dataset.add, b.dataset.unit); });

  cart.addEventListener('click', async (e) => {
    const g = (sel) => e.target.closest(sel);
    if (g('[data-ticket]')) return switchTo(g('[data-ticket]').dataset.ticket);
    if (g('#t-new')) { const empty0 = tickets.list.find((x) => x.mode === mode && !x.lines.length); return switchTo((empty0 || newTicket(mode)).id); }
    if (g('[data-inc]')) { t.lines[+g('[data-inc]').dataset.inc].qty++; save(); drawGrid(); return drawCart(); }
    if (g('[data-dec]')) { const l = t.lines[+g('[data-dec]').dataset.dec]; l.qty--; if (l.qty <= 0) t.lines = t.lines.filter((x) => x !== l); save(); drawGrid(); return drawCart(); }
    if (g('[data-rm]')) { t.lines.splice(+g('[data-rm]').dataset.rm, 1); save(); drawGrid(); return drawCart(); }
    if (g('#a-clear')) { t.lines = []; t.discount = ''; t.porterFee = ''; t.paid = ''; t.transfer = ''; save(); drawGrid(); return drawCart(); }
    if (g('#a-park')) { const nt = tickets.list.find((x) => x.mode === mode && !x.lines.length && x.id !== t.id) || newTicket(mode); toast(`${tabLabel(t)} parked. Tap their tab to come back.`); return switchTo(nt.id); }
    if (g('#a-disc')) { ui.panel = ui.panel === 'disc' ? '' : 'disc'; return drawCart(); }
    if (g('#a-porter')) { ui.panel = ui.panel === 'porter' ? '' : 'porter'; return drawCart(); }
    if (g('#a-cust')) { ui.panel = ui.panel === 'cust' ? '' : 'cust'; return drawCart(); }
    if (g('#p-discmode')) { t.discountPct = !t.discountPct; save(); return drawCart(); }
    if (g('[data-pcp]')) { t.porterCustomerPays = g('[data-pcp]').dataset.pcp === '1'; save(); return drawCart(); }
    if (g('[data-method]')) { t.method = g('[data-method]').dataset.method; t.paid = ''; t.transfer = ''; save(); return drawCart(); }
    if (g('#c-new')) return quickCustomer((c) => { t.customerId = c.id; save(); drawCart(); });
    if (g('#l-x')) { ui.last[mode] = null; return drawCart(); }
    if (g('#l-wa')) return shareLast(ui.last[mode]);
    if (g('#l-print')) return showReceipt(ui.last[mode].receipt);
    if (g('#l-inv')) return invoicePDF(ui.last[mode].receipt);
    if (g('#s-pay')) return complete();
  });
  cart.addEventListener('change', (e) => {
    const x = e.target;
    if (x.dataset.qty) { const l = t.lines[+x.dataset.qty]; const v = Math.max(0, parseInt(x.value || '0', 10)); if (!v) t.lines = t.lines.filter((y) => y !== l); else l.qty = v; save(); drawGrid(); drawCart(); }
    if (x.dataset.price) { const l = t.lines[+x.dataset.price]; l.price = Math.max(0, Number(x.value || 0)); save(); drawCart(); }
    if (x.id === 'c-sel') { t.customerId = x.value; save(); drawCart(); }
  });
  cart.addEventListener('input', (e) => {
    const x = e.target; const map = { 'p-disc': 'discount', 'p-pfee': 'porterFee', 'p-pname': 'porterName', 'i-paid': 'paid', 'i-tr': 'transfer',
      'c-name': 'customerName', 'c-phone': 'customerPhone', 'c-addr': 'customerAddress', 'c-due': 'dueDate', 'c-notes': 'notes' };
    if (!map[x.id]) return;
    t[map[x.id]] = x.value; save();
    if (['p-disc', 'p-pfee', 'i-paid', 'i-tr'].includes(x.id)) {
      // redraw totals without losing the cursor
      const pos = x.selectionStart, id = x.id; drawCart(); const n = cart.querySelector('#' + id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) { /* number inputs */ } }
    }
  });

  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = (e) => {
    if (!document.body.contains(el) || document.getElementById('modal')) return;
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '');
    if (e.key === '/' && !typing) { e.preventDefault(); q.focus(); q.select(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); q.focus(); q.select(); }
    if (e.key === 'F3' && express) { e.preventDefault(); cart.querySelector('#a-park')?.click(); }
    if (e.key === 'F4') { e.preventDefault(); cart.querySelector('#s-pay')?.click(); }
  };
  document.addEventListener('keydown', keyHandler);

  async function complete() {
    const tt = totals(t);
    if (!t.lines.length) return;
    if (t.lines.some((l) => !(l.price > 0))) { toast('One of the items has no price.', 'warn'); return; }
    const saved = state.customers.find((c) => c.id === t.customerId) || null;
    if (!express && !saved && !t.customerName.trim()) { toast('Add the customer name for the invoice.', 'warn'); ui.panel = ''; drawCart(); return; }
    if (tt.owed > 0.5 && !saved) {
      toast(t.method === 'mixed' ? 'Cash + transfer is short. Fix the amounts, or choose Credit with a saved customer.' : 'Choose a saved customer for anything left on account.', 'warn');
      if (express) { ui.panel = 'cust'; t.method = t.method === 'mixed' ? t.method : 'credit'; } drawCart(); return;
    }
    if (t.method === 'cash' && tt.received != null && tt.received < tt.grand) { toast('Amount received is less than the total.', 'warn'); return; }
    const below = t.lines.filter((l) => { const p = state.products.find((x) => x.id === l.pid); const cost = Number(p?.cost_price || 0) * (l.unit === 'carton' ? l.ppc : 1); return cost && l.price < cost; });
    if (below.length && !confirm(`${below.map((l) => l.name).join(', ')} ${below.length === 1 ? 'is' : 'are'} priced below cost. Sell anyway?`)) return;

    const method = t.method === 'credit' ? (tt.paid > 0 ? 'split' : 'credit') : t.method;
    const sale = {
      p_id: uuid(), p_branch: branch, p_method: method, p_amount_paid: tt.paid, p_discount: tt.disc, p_customer: saved?.id || null,
      p_items: t.lines.map((l) => ({ product_id: l.pid, unit: l.unit, qty: l.qty, unit_price: l.price, packs: packsOf(l) })),
      p_mode: mode, p_transfer_amount: tt.transfer, p_porter_fee: tt.porter, p_porter_name: t.porterName || null, p_porter_customer_pays: !!t.porterCustomerPays,
      p_customer_name: saved ? null : (t.customerName || null), p_customer_phone: saved ? null : (t.customerPhone || null),
      p_note: !express ? [t.dueDate ? `Due ${t.dueDate}` : '', t.notes].filter(Boolean).join(' · ') || null : null,
      meta: { total: tt.grand, totalText: naira(tt.grand), items: t.lines.map((l) => ({ name: `${l.name} (${l.unit})`, qty: l.qty })), customer: saved?.name || t.customerName || null },
    };
    const btn = cart.querySelector('#s-pay'); if (btn) { btn.disabled = true; btn.innerHTML = 'Saving…'; }
    const res = await recordSale(sale);
    if (res.failed) toast('The server refused this sale: ' + res.failed + '. Open the sync panel.', 'danger');
    (res.warnings || []).forEach((w) => toast(w, 'warn'));
    const cust = saved ? { name: saved.name, phone: saved.phone, address: saved.address } : (t.customerName || t.customerPhone ? { name: t.customerName || 'Customer', phone: t.customerPhone, address: t.customerAddress } : null);
    const methodText = { cash: 'Cash', transfer: 'Transfer', pos: 'POS', mixed: `Cash ${naira(tt.paid - tt.transfer)} + transfer ${naira(tt.transfer)}`, credit: 'Credit', split: `Part-paid, ${naira(tt.owed)} on account` }[method];
    const receipt = {
      id: sale.p_id, receipt_no: res.receipt_no, created_at: new Date().toISOString(), branch_id: branch, cashier: state.profile?.full_name,
      items: t.lines.map((l) => ({ name: l.unit === 'carton' ? `${l.name} (carton of ${l.ppc})` : `${l.name} (pack)`, qty: l.qty, unit_price: l.price, unit: l.unit })),
      subtotal: tt.sub, discount: tt.disc, porter: tt.charge, total: tt.grand, amount_paid: tt.paid, method, methodText, customer: cust, pending: res.offline,
      change: tt.change, dueDate: t.dueDate, notes: t.notes, mode,
    };
    ui.last[mode] = { receipt, receipt_no: res.receipt_no, grand: tt.grand, methodText, pending: res.offline, who: cust?.name || 'Walk-in customer' };
    closeTicket(t.id);
    t = activeTicket(mode);
    ui.panel = '';
    drawGrid(); drawCart();
    toast(res.offline ? `Saved offline · ${naira(tt.grand)}. It will sync automatically.` : `Sale #${res.receipt_no || ''} done · ${naira(tt.grand)}`);
    if (!express) invoiceDialog(receipt);
    else setTimeout(() => q.focus(), 50);
  }
}

function shareLast(last) {
  if (!last) return;
  const r = last.receipt;
  if (r.customer?.phone) { window.open(waLink(r.customer.phone, receiptText(r)), '_blank', 'noopener'); return; }
  const body = modal('Send receipt on WhatsApp', `<form class="form" id="wa"><label>Customer's WhatsApp number<input name="phone" inputmode="tel" required placeholder="0803 000 0000"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">${icon.whatsapp}<span>Open WhatsApp</span></button></div></form>`);
  body.querySelector('#wa').addEventListener('submit', (e) => { e.preventDefault(); const ph = e.target.phone.value; closeModal(); window.open(waLink(ph, receiptText(r)), '_blank', 'noopener'); });
}

function invoiceDialog(r) {
  const body = modal(r.pending ? 'Invoice saved on this device' : `Invoice INV-${r.receipt_no}`, `
    <p>${esc(r.customer?.name || '')} · <strong>${naira(r.total)}</strong>${r.total - r.amount_paid > 0 ? ` · <span class="warn-text">${naira(r.total - r.amount_paid)} due${r.dueDate ? ' by ' + esc(r.dueDate) : ''}</span>` : ' · paid'}</p>
    ${r.pending ? '<div class="alert warn">The invoice number is given once this device syncs. You can still download it now.</div>' : ''}
    <div class="row gap wrap end">
      <button class="btn primary" id="iv-pdf">${icon.download}<span>Download invoice (PDF)</span></button>
      <button class="btn ghost" id="iv-rc">${icon.print}<span>Receipt</span></button>
      <a class="btn ghost" target="_blank" rel="noopener" href="${waLink(r.customer?.phone || '', receiptText(r))}">${icon.whatsapp}<span>WhatsApp</span></a>
    </div>`);
  body.querySelector('#iv-pdf').onclick = () => invoicePDF(r);
  body.querySelector('#iv-rc').onclick = () => showReceipt(r);
}

function quickCustomer(done) {
  const body = modal('New customer', `<form id="nc" class="form">
    <label>Name<input name="name" required></label>
    <label>Phone (for WhatsApp)<input name="phone" inputmode="tel" placeholder="0803 000 0000"></label>
    <label>Address<input name="address"></label>
    <label>Credit limit (₦, 0 = no limit)<input name="credit_limit" type="number" min="0" value="0"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Add customer</button></div></form>`);
  body.querySelector('#nc').addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = await addCustomer(formData(e.target));
    closeModal(); toast(`${c.name} added`); done(c);
  });
}

export function renderParked(el) {
  const list = tickets.list.filter((t) => t.lines.length);
  el.innerHTML = `<p class="muted">Sales you parked while serving another customer. They stay on this device, even if you close the app, until you complete or delete them.</p>
    ${list.length ? `<div class="parked-grid">${list.map((t) => { const tt = totals(t); return `<article class="parked card">
      <div class="row between"><strong>${esc(t.customerName || state.customers.find((c) => c.id === t.customerId)?.name || t.label)}</strong><span class="pill">${t.mode === 'invoice' ? 'Invoice' : 'Express'}</span></div>
      <div class="big-num">${naira(tt.grand)}</div>
      <div class="muted small">${t.lines.length} item${t.lines.length === 1 ? '' : 's'} · ${qtyText(tt.cartons, tt.packs)} · started ${new Date(t.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
      <div class="small">${esc(t.lines.slice(0, 3).map((l) => `${l.name} ×${l.qty} ${l.unit === 'carton' ? 'ctn' : 'pk'}`).join(', '))}${t.lines.length > 3 ? '…' : ''}</div>
      <div class="row gap end"><button class="btn ghost small" data-del="${t.id}">${icon.trash}<span>Delete</span></button><button class="btn primary small" data-resume="${t.id}">Resume</button></div>
    </article>`; }).join('')}</div>` : `<div class="card">${empty('No parked sales', 'Use Park on the Express sale screen to put a customer on hold.')}</div>`}`;
  el.addEventListener('click', (e) => {
    const r = e.target.closest('[data-resume]'); const d = e.target.closest('[data-del]');
    if (r) { const t = tickets.list.find((x) => x.id === r.dataset.resume); tickets.active[t.mode] = t.id; saveTickets(); location.hash = t.mode === 'invoice' ? '#/invoice' : '#/pos'; }
    if (d && confirm('Delete this parked sale? Nothing has been sold yet, so stock is not affected.')) { closeTicket(d.dataset.del); renderParked(el); }
  });
}

export const renderExpress = (el, ctx) => renderSale(el, ctx, 'express');
export const renderInvoice = (el, ctx) => renderSale(el, ctx, 'invoice');
