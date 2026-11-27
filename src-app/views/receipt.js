import { state, branchName } from '../store.js';
import { esc, naira, fmtDateTime, modal, icon, METHOD_LABEL, waLink, num } from '../ui.js';

// r: { id, receipt_no, created_at, branch_id, cashier, items:[{name, qty, unit_price}], subtotal, discount, total, amount_paid, method, customer, pending, status }
export function receiptText(r) {
  const lines = [
    state.settings.business_name || 'Anayo 5PS Enterprises',
    branchName(r.branch_id),
    `Receipt ${r.receipt_no ? '#' + r.receipt_no : '(pending sync)'} · ${fmtDateTime(r.created_at)}`,
    '',
    ...r.items.map((i) => `${i.qty} × ${i.name} @ ${naira(i.unit_price)} = ${naira(i.qty * i.unit_price)}`),
    '',
    r.discount > 0 ? `Discount: −${naira(r.discount)}` : null,
    r.porter > 0 ? `Porter: ${naira(r.porter)}` : null,
    `TOTAL: ${naira(r.total)}`,
    `Paid (${r.methodText || METHOD_LABEL[r.method] || r.method}): ${naira(r.amount_paid)}`,
    r.total - r.amount_paid > 0 ? `Balance owed: ${naira(r.total - r.amount_paid)}` : null,
    '',
    state.settings.receipt_footer || 'Thank you!',
  ].filter((x) => x !== null);
  return lines.join('\n');
}

export function receiptHtml(r) {
  const owed = r.total - r.amount_paid;
  return `<div class="receipt" id="receipt-print">
    <div class="r-center"><div class="r-shop">${esc(state.settings.business_name || 'Anayo 5PS Enterprises')}</div>
    <div>${esc(branchName(r.branch_id))}${state.settings.phone ? ' · ' + esc(state.settings.phone) : ''}</div>
    <div>${r.receipt_no ? 'Receipt #' + r.receipt_no : 'Receipt · waiting to sync'}</div>
    <div>${fmtDateTime(r.created_at)}${r.cashier ? ' · ' + esc(r.cashier) : ''}</div></div>
    ${r.status === 'void' ? '<div class="r-void">VOID</div>' : ''}
    <table class="r-items">${r.items.map((i) => `<tr><td>${num(i.qty)} × ${esc(i.name)}<div class="r-sub">@ ${naira(i.unit_price)}</div></td><td class="num">${naira(i.qty * i.unit_price)}</td></tr>`).join('')}</table>
    <table class="r-totals">
      ${r.discount > 0 || r.porter > 0 ? `<tr><td>Subtotal</td><td class="num">${naira(r.subtotal)}</td></tr>` : ''}
      ${r.discount > 0 ? `<tr><td>Discount</td><td class="num">−${naira(r.discount)}</td></tr>` : ''}
      ${r.porter > 0 ? `<tr><td>Porter</td><td class="num">${naira(r.porter)}</td></tr>` : ''}
      <tr class="r-total"><td>Total</td><td class="num">${naira(r.total)}</td></tr>
      <tr><td>Paid · ${esc(r.methodText || METHOD_LABEL[r.method] || r.method)}</td><td class="num">${naira(r.amount_paid)}</td></tr>
      ${r.change > 0 ? `<tr><td>Change</td><td class="num">${naira(r.change)}</td></tr>` : ''}
      ${owed > 0 ? `<tr><td><strong>Balance owed</strong></td><td class="num"><strong>${naira(owed)}</strong></td></tr>` : ''}
    </table>
    ${r.customer ? `<div class="r-center">Customer: ${esc(r.customer.name)}</div>` : ''}
    <div class="r-center r-foot">${esc(state.settings.receipt_footer || 'Thank you!')}</div>
  </div>`;
}

export function showReceipt(r, { onNew } = {}) {
  const phone = r.customer?.phone;
  const body = modal(r.pending ? 'Sale saved on this device' : 'Sale complete', `
    ${r.pending ? `<div class="alert warn">${icon.wifiOff}<span>No connection right now. This sale is saved and will sync automatically.</span></div>` : ''}
    ${receiptHtml(r)}
    <div class="row gap wrap end receipt-actions">
      <button class="btn ghost" id="r-print">${icon.print}<span>Print</span></button>
      <a class="btn ghost" target="_blank" rel="noopener" href="${waLink(phone || '', receiptText(r))}">${icon.whatsapp}<span>${phone ? 'WhatsApp customer' : 'Share on WhatsApp'}</span></a>
      ${onNew ? `<button class="btn primary" id="r-new">New sale</button>` : ''}
    </div>`);
  body.querySelector('#r-print').onclick = () => window.print();
  body.querySelector('#r-new')?.addEventListener('click', () => { document.getElementById('modal')?.remove(); onNew(); });
}
