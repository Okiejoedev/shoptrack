import { sb, state, isOnline, stockAt, branchName } from '../store.js';
import { esc, naira, num, icon, todayISO, monthStartISO, daysAgoISO, empty, needsOnline } from '../ui.js';
import { toExcel, toPDF } from '../export.js';

let tab = 'pnl';
const r = { from: monthStartISO(), to: todayISO() };
const TABS = { pnl: 'Profit & loss', items: 'Sales by item', stock: 'Stock valuation', staff: 'Staff performance' };

export async function renderReports(el, ctx) {
  const br = state.branch === 'all' ? null : state.branch;
  const scope = `${r.from} to ${r.to} · ${br ? branchName(br) + ' branch' : 'All branches'}`;
  el.innerHTML = `<div class="toolbar wrap">
    <div class="seg" role="tablist">${Object.entries(TABS).map(([k, v]) => `<button role="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}">${v}</button>`).join('')}</div>
    <div class="grow"></div>
    ${tab !== 'stock' ? `<label>From <input type="date" id="r-from" value="${r.from}"></label><label>To <input type="date" id="r-to" value="${r.to}"></label>
    <div class="seg small">${[['Month', monthStartISO()], ['30d', daysAgoISO(29)], ['7d', daysAgoISO(6)]].map(([l, d]) => `<button data-quick="${d}">${l}</button>`).join('')}</div>` : ''}
    <button class="btn ghost" id="r-xlsx">${icon.download}<span>Excel</span></button><button class="btn ghost" id="r-pdf">${icon.download}<span>PDF</span></button>
  </div><div id="r-body"><div class="loading">Loading…</div></div>`;
  el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; ctx.rerender(); });
  el.querySelector('#r-from')?.addEventListener('change', (e) => { r.from = e.target.value; ctx.rerender(); });
  el.querySelector('#r-to')?.addEventListener('change', (e) => { r.to = e.target.value; ctx.rerender(); });
  el.querySelectorAll('[data-quick]').forEach((b) => b.onclick = () => { r.from = b.dataset.quick; r.to = todayISO(); ctx.rerender(); });
  const body = el.querySelector('#r-body');
  let exp = null;

  if (tab === 'stock') {
    const rows = state.products.filter((p) => p.active).map((p) => {
      const q = Math.max(0, stockAt(p.id, br));
      return { Product: p.name, SKU: p.sku, Category: p.category, Qty: q, 'Unit cost': Number(p.cost_price), 'Value at cost': q * p.cost_price, 'Value at price': q * p.sell_price };
    }).sort((a, b) => b['Value at cost'] - a['Value at cost']);
    const tc = rows.reduce((a, x) => a + x['Value at cost'], 0), tp = rows.reduce((a, x) => a + x['Value at price'], 0);
    body.innerHTML = `<section class="kpis small"><div class="kpi"><div class="kpi-label">At cost</div><div class="kpi-value">${naira(tc)}</div></div>
      <div class="kpi"><div class="kpi-label">At selling price</div><div class="kpi-value">${naira(tp)}</div></div>
      <div class="kpi"><div class="kpi-label">Potential profit in stock</div><div class="kpi-value accent">${naira(tp - tc)}</div></div></section>
      <div class="card flush"><div class="scroll"><table class="table stack"><thead><tr><th>Product</th><th>Category</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Value at cost</th><th class="num">Value at price</th></tr></thead>
      <tbody>${rows.map((x) => `<tr><td><strong>${esc(x.Product)}</strong></td><td>${esc(x.Category)}</td><td class="num">${num(x.Qty)}</td><td class="num">${naira(x['Unit cost'])}</td><td class="num">${naira(x['Value at cost'])}</td><td class="num">${naira(x['Value at price'])}</td></tr>`).join('')}</tbody></table></div></div>`;
    exp = { name: 'stock-valuation', title: 'Stock valuation', sub: `As at ${todayISO()} · ${br ? branchName(br) : 'All branches'}`, rows,
      cols: [{ header: 'Product', key: 'Product' }, { header: 'Qty', key: 'Qty', align: 'right' }, { header: 'Unit cost', key: 'uc', align: 'right' }, { header: 'Value at cost', key: 'vc', align: 'right' }],
      pdfRows: rows.map((x) => ({ ...x, uc: naira(x['Unit cost']), vc: naira(x['Value at cost']) })), summary: [['At cost', naira(tc)], ['At price', naira(tp)], ['Potential profit', naira(tp - tc)]] };
  } else if (!isOnline()) {
    body.innerHTML = needsOnline('This report');
  } else if (tab === 'pnl') {
    const { data: p, error } = await sb.rpc('profit_and_loss', { p_from: r.from, p_to: r.to, p_branch: br });
    if (error) throw error;
    if (!ctx.isCurrent()) return;
    const pct = (v) => (p.net_sales ? ((v / p.net_sales) * 100).toFixed(1) + '%' : '');
    body.innerHTML = `<section class="card pnl">
      <div class="card-head"><h2>Profit and loss</h2><span class="muted small">${esc(scope)}</span></div>
      <table class="table pnl-table"><tbody>
        <tr><td>Gross sales</td><td class="num">${naira(p.gross_sales)}</td><td></td></tr>
        <tr><td class="indent">Less discounts</td><td class="num">−${naira(p.discounts)}</td><td></td></tr>
        <tr class="sub"><td>Net sales</td><td class="num">${naira(p.net_sales)}</td><td class="num muted">100%</td></tr>
        <tr><td class="indent">Cost of goods sold</td><td class="num">−${naira(p.cogs)}</td><td class="num muted">${pct(p.cogs)}</td></tr>
        <tr class="sub"><td>Gross profit</td><td class="num">${naira(p.gross_profit)}</td><td class="num muted">${pct(p.gross_profit)}</td></tr>
        ${p.expenses.map((e) => `<tr><td class="indent">${esc(e.category)}</td><td class="num">−${naira(e.amount)}</td><td class="num muted">${pct(e.amount)}</td></tr>`).join('')}
        <tr class="sub"><td>Total expenses</td><td class="num">−${naira(p.total_expenses)}</td><td class="num muted">${pct(p.total_expenses)}</td></tr>
        <tr class="grand ${p.net_profit < 0 ? 'neg' : ''}"><td>Net profit</td><td class="num">${naira(p.net_profit)}</td><td class="num">${pct(p.net_profit)}</td></tr>
      </tbody></table></section>`;
    const rows = [['Gross sales', p.gross_sales], ['Discounts', -p.discounts], ['Net sales', p.net_sales], ['Cost of goods sold', -p.cogs], ['Gross profit', p.gross_profit],
      ...p.expenses.map((e) => [e.category, -e.amount]), ['Total expenses', -p.total_expenses], ['Net profit', p.net_profit]].map(([Line, Amount]) => ({ Line, Amount: Number(Amount) }));
    exp = { name: 'profit-and-loss', title: 'Profit and loss', sub: scope, rows, cols: [{ header: 'Line', key: 'Line' }, { header: 'Amount', key: 'A', align: 'right' }],
      pdfRows: rows.map((x) => ({ ...x, A: naira(x.Amount) })), summary: [['Net sales', naira(p.net_sales)], ['Gross profit', naira(p.gross_profit)], ['Net profit', naira(p.net_profit)]] };
  } else if (tab === 'items') {
    const { data, error } = await sb.rpc('item_sales_report', { p_from: r.from, p_to: r.to, p_branch: br });
    if (error) throw error;
    if (!ctx.isCurrent()) return;
    const tot = data.reduce((a, x) => a + Number(x.revenue), 0);
    body.innerHTML = data.length ? `<div class="card flush"><div class="scroll"><table class="table stack"><thead><tr><th>Product</th><th>Category</th><th class="num">Qty sold</th><th class="num">Revenue</th><th class="num">Share</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead>
      <tbody>${data.map((x) => `<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.category)}</td><td class="num">${num(x.qty)}</td><td class="num">${naira(x.revenue)}</td>
      <td class="num">${tot ? ((x.revenue / tot) * 100).toFixed(1) : 0}%</td><td class="num">${naira(x.profit)}</td><td class="num">${x.revenue ? ((x.profit / x.revenue) * 100).toFixed(1) : 0}%</td></tr>`).join('')}</tbody></table></div></div>`
      : empty('No sales in this range');
    const rows = data.map((x) => ({ Product: x.name, Category: x.category, 'Qty sold': Number(x.qty), Revenue: Number(x.revenue), Cost: Number(x.cost), Profit: Number(x.profit) }));
    exp = { name: 'sales-by-item', title: 'Sales by item', sub: scope, rows,
      cols: [{ header: 'Product', key: 'Product' }, { header: 'Qty', key: 'Qty sold', align: 'right' }, { header: 'Revenue', key: 'R', align: 'right' }, { header: 'Profit', key: 'P', align: 'right' }],
      pdfRows: rows.map((x) => ({ ...x, R: naira(x.Revenue), P: naira(x.Profit) })), summary: [['Revenue', naira(tot)], ['Products sold', data.length]] };
  } else if (tab === 'staff') {
    const { data, error } = await sb.rpc('dashboard_summary', { p_from: r.from, p_to: r.to, p_branch: br });
    if (error) throw error;
    if (!ctx.isCurrent()) return;
    const st = data.by_staff || [];
    const max = Math.max(1, ...st.map((s) => Number(s.revenue)));
    body.innerHTML = st.length ? `<section class="card"><div class="card-head"><h2>Revenue by staff member</h2><span class="muted small">${esc(scope)}</span></div>
      ${st.map((s) => `<div class="meter-row"><div class="row between"><span><strong>${esc(s.name)}</strong> <span class="muted small">${s.tx} sales · avg ${naira(s.revenue / s.tx)}</span></span><strong>${naira(s.revenue)}</strong></div>
      <div class="meter"><div style="width:${(s.revenue / max) * 100}%"></div></div></div>`).join('')}</section>` : empty('No sales in this range');
    const rows = st.map((s) => ({ Staff: s.name, Sales: s.tx, Revenue: Number(s.revenue), 'Average sale': Math.round(s.revenue / s.tx) }));
    exp = { name: 'staff-performance', title: 'Staff performance', sub: scope, rows,
      cols: [{ header: 'Staff', key: 'Staff' }, { header: 'Sales', key: 'Sales', align: 'right' }, { header: 'Revenue', key: 'R', align: 'right' }],
      pdfRows: rows.map((x) => ({ ...x, R: naira(x.Revenue) })), summary: [] };
  }

  el.querySelector('#r-xlsx').onclick = () => exp && toExcel(exp.name + '-' + todayISO(), [{ name: exp.title, rows: exp.rows }]);
  el.querySelector('#r-pdf').onclick = () => exp && toPDF(exp.name + '-' + todayISO(), exp.title, exp.sub, exp.cols, exp.pdfRows, exp.summary);
}
