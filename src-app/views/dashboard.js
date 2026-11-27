import { sb, state, isOnline, isManager, cachePut, cacheGet, parkedCount } from '../store.js';
import { esc, naira, short, num, todayISO, daysAgoISO, monthStartISO, icon, fmtDateTime, fmtTime, METHOD_LABEL, empty, fmtQty } from '../ui.js';

let period = 'today';
const PERIODS = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', month: 'This month' };
const range = () => {
  const to = todayISO();
  if (period === 'today') return [to, to];
  if (period === '30d') return [daysAgoISO(29), to];
  if (period === 'month') return [monthStartISO(), to];
  return [daysAgoISO(6), to];
};
const delta = (cur, prev, label = 'vs previous period') => {
  if (!prev) return '';
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  return `<span class="delta ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}%</span> <span class="muted small">${label}</span>`;
};
const mLabel = (m) => METHOD_LABEL[m] || (m === 'mixed' ? 'Mixed' : m);

export async function renderDashboard(el, ctx) {
  const [from, to] = range();
  const key = `dash2-${period}`;
  let d, d7, reorder, stale = null;
  if (isOnline()) {
    const [a, w, b] = await Promise.all([
      sb.rpc('dashboard_summary', { p_from: from, p_to: to, p_branch: null }),
      period === 'today' ? sb.rpc('dashboard_summary', { p_from: daysAgoISO(6), p_to: todayISO(), p_branch: null }) : Promise.resolve({ data: null }),
      sb.rpc('reorder_suggestions', { p_branch: null }),
    ]);
    if (a.error) throw a.error;
    d = a.data; d7 = w.data || d; reorder = b.data || [];
    cachePut(key, { d, d7, reorder });
  } else {
    const c = await cacheGet(key);
    if (c) { d = c.value.d; d7 = c.value.d7; reorder = c.value.reorder; stale = c.at; }
  }
  if (!ctx.isCurrent()) return;
  const mgr = isManager();
  const label = period === 'today' ? 'vs yesterday' : 'vs previous period';

  const head = `<div class="toolbar">
    <div class="seg" role="group" aria-label="Period">${Object.entries(PERIODS).map(([k, v]) =>
      `<button class="${k === period ? 'on' : ''}" data-period="${k}" aria-pressed="${k === period}">${v}</button>`).join('')}</div>
    <div class="grow"></div>
    <a class="btn primary" href="#/pos">${icon.pos}<span>New sale</span></a></div>
    ${stale ? `<div class="alert warn">${icon.wifiOff}<span>You're offline. These figures were last updated ${fmtDateTime(stale)}.</span></div>` : ''}`;
  if (!d) { el.innerHTML = head + empty('No dashboard saved on this device yet', 'Connect once to load your figures.'); bind(el, ctx); return; }

  const days = d7?.by_day || [];
  const maxDay = Math.max(1, ...days.map((x) => Number(x.revenue)));
  const methods = (d.by_method || []).sort((a, b) => b.revenue - a.revenue);
  const methodTotal = methods.reduce((a, m) => a + Number(m.revenue), 0) || 1;
  const top = d.top || [];
  const parked = parkedCount();
  const alerts = [];
  if (d.low_stock) alerts.push(['warn', `${d.low_stock} product${d.low_stock === 1 ? ' is' : 's are'} running low in the store.`, '#/inventory']);
  if (d.out_of_stock) alerts.push(['danger', `${d.out_of_stock} product${d.out_of_stock === 1 ? ' is' : 's are'} out of stock in the store.`, '#/inventory']);
  if (reorder?.[0]?.days_left != null) alerts.push(['info', `${reorder[0].name} runs out in about ${reorder[0].days_left} days. Order ${reorder[0].suggested_cartons} carton${reorder[0].suggested_cartons === 1 ? '' : 's'}.`, mgr ? '#/purchasing?from=reorder' : '#/inventory']);
  if (Number(d.receivables) > 0) alerts.push(['info', `Customers owe you ${naira(d.receivables)}.`, '#/customers']);
  if (mgr && Number(d.payables) > 0) alerts.push(['info', `You owe suppliers ${naira(d.payables)}.`, '#/suppliers']);
  if (parked) alerts.push(['warn', `${parked} parked sale${parked === 1 ? '' : 's'} waiting to be completed.`, '#/parked']);
  const priceless = state.products.filter((p) => p.active && !(Number(p.sell_price) > 0)).length;
  if (mgr && priceless) alerts.push(['warn', `${priceless} product${priceless === 1 ? ' has' : 's have'} no price yet.`, '#/products']);

  el.innerHTML = head + `
  <section class="kpi-row">
    <div class="kpi"><div class="kpi-ico green">${icon.pos}</div><div class="kpi-label">${period === 'today' ? "Today's sales" : 'Sales'}</div><div class="kpi-value">${naira(d.revenue)}</div><div>${delta(Number(d.revenue), Number(d.prev_revenue), label)}</div></div>
    <div class="kpi"><div class="kpi-ico blue">${icon.sales}</div><div class="kpi-label">Transactions</div><div class="kpi-value">${num(d.transactions)}</div><div>${delta(Number(d.transactions), Number(d.prev_transactions), label)}</div></div>
    <div class="kpi"><div class="kpi-ico purple">${icon.expenses}</div><div class="kpi-label">Cash received</div><div class="kpi-value">${naira(d.cash_received)}</div></div>
    <div class="kpi"><div class="kpi-ico blue">${icon.bank}</div><div class="kpi-label">Transfers / POS received</div><div class="kpi-value">${naira(d.transfer_received)}</div></div>
    <div class="kpi"><div class="kpi-ico amber">${icon.customers}</div><div class="kpi-label">Credit sales</div><div class="kpi-value">${naira(d.credit_given)}</div></div>
  </section>

  <div class="dash-grid">
    <section class="card quick">
      <div class="card-title">${icon.sparkle}<span>Quick actions</span></div>
      <a class="btn primary block" href="#/pos">${icon.pos}<span>New sale (POS)</span></a>
      <div class="quick-grid">
        <a class="btn ghost" href="#/invoice">${icon.sales}<span>Invoice sale</span></a>
        <a class="btn ghost" href="#/inventory">${icon.inventory}<span>Receive stock</span></a>
        ${mgr ? `<a class="btn ghost" href="#/products">${icon.tag}<span>Add product</span></a>
        <a class="btn ghost" href="#/porter">${icon.porter}<span>Porter fee</span></a>
        <a class="btn ghost" href="#/purchasing">${icon.purchasing}<span>Record purchase</span></a>
        <a class="btn ghost" href="#/expenses">${icon.expenses}<span>Expense</span></a>` : `<a class="btn ghost" href="#/customers">${icon.customers}<span>Customers</span></a>
        <a class="btn ghost" href="#/parked">${icon.history}<span>Parked sales</span></a>`}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Sales trend (last 7 days)</h2></div>
      ${days.length ? `<div class="bars" style="--n:${days.length}">${days.map((x, i) => {
        const h = Math.round((Number(x.revenue) / maxDay) * 100);
        const lab = i === days.length - 1 && period === 'today' ? 'Today' : new Date(x.day + 'T12:00:00').toLocaleDateString('en-GB', days.length > 10 ? { day: 'numeric' } : { weekday: 'short' });
        return `<div class="bar-col" title="${lab}: ${naira(x.revenue)} · ${x.tx} sales"><div class="bar-val">${short(x.revenue)}</div><div class="bar" style="height:${Math.max(2, h)}%"></div><div class="bar-label">${lab}</div></div>`;
      }).join('')}</div>` : empty('No sales yet')}
    </section>

    <section class="card">
      <div class="card-head"><h2>Sales by payment method</h2></div>
      ${methods.length ? methods.map((m) => `<div class="meter-row"><div class="row between"><span>${mLabel(m.method)}</span>
        <span><strong>${naira(m.revenue)}</strong> <span class="muted small">${Math.round((m.revenue / methodTotal) * 100)}%</span></span></div>
        <div class="meter"><div style="width:${(m.revenue / methodTotal) * 100}%"></div></div></div>`).join('') : empty('No sales yet')}
    </section>

    <section class="card alerts">
      <div class="card-title">${icon.alert}<span>Alerts &amp; reminders</span></div>
      ${alerts.length ? alerts.map(([k, t, href]) => `<a class="alert-row ${k}" href="${href}"><span>${esc(t)}</span><span aria-hidden="true">›</span></a>`).join('') : '<p class="muted small">Nothing needs your attention.</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>Top selling products</h2><span class="muted small">${PERIODS[period]}</span></div>
      ${top.length ? `<table class="table compact"><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Sales</th></tr></thead><tbody>
        ${top.map((x) => `<tr><td>${esc(x.name)} <span class="muted small">(${x.unit === 'carton' ? 'carton' : 'pack'})</span></td><td class="num">${num(x.qty)}</td><td class="num">${naira(x.revenue)}</td></tr>`).join('')}</tbody></table>` : empty('No sales yet')}
    </section>

    <section class="card">
      <div class="card-head"><h2>Stock status (store)</h2><a class="small" href="#/inventory">Inventory</a></div>
      ${(() => { const tot = Math.max(1, d.product_count || 0); const ok = Math.max(0, tot - d.low_stock - d.out_of_stock);
        return [['In stock', ok, ''], ['Low stock', d.low_stock, 'warn'], ['Out of stock', d.out_of_stock, 'danger']].map(([l, v, k]) => `<div class="meter-row">
          <div class="row between"><span>${l}</span><span><strong>${v}</strong> <span class="muted small">${((v / tot) * 100).toFixed(0)}%</span></span></div>
          <div class="meter ${k}"><div style="width:${(v / tot) * 100}%"></div></div></div>`).join(''); })()}
      ${mgr ? `<div class="row between small"><span class="muted">Total stock value (at cost)</span><strong>${naira(d.stock_value)}</strong></div>` : ''}
    </section>

    ${mgr ? `<section class="card">
      <div class="card-head"><h2>Profit overview</h2><span class="muted small">${PERIODS[period]}</span></div>
      <div class="profit-tiles">
        <div><span>Sales</span><strong>${naira(d.revenue)}</strong></div>
        <div class="cost"><span>Cost of goods</span><strong>${naira(Number(d.revenue) - Number(d.profit))}</strong></div>
        <div class="gp"><span>Gross profit</span><strong>${naira(d.profit)}</strong></div>
      </div>
      <div class="row between small"><span class="muted">Margin</span><strong>${d.revenue ? ((d.profit / d.revenue) * 100).toFixed(1) : 0}%</strong></div>
      <div class="row between small"><span class="muted">Expenses + shop-paid porter</span><strong>−${naira(Number(d.expenses) + Number(d.porter))}</strong></div>
      <div class="row between"><span>Net profit</span><strong class="${d.net_profit < 0 ? 'text-danger' : 'text-ok'}">${naira(d.net_profit)}</strong></div>
      ${state.settings.show_bank ? `<div class="row between small"><span class="muted">Money in the bank</span><a href="#/bank"><strong>${naira(d.bank_total)}</strong></a></div>` : ''}
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h2>Recent sales</h2><a class="small" href="#/sales">View all</a></div>
      ${(d.recent || []).length ? `<table class="table compact"><thead><tr><th>Receipt</th><th>Time</th><th class="num">Amount</th><th>Payment</th></tr></thead><tbody>
        ${d.recent.map((x) => `<tr><td>#${x.receipt_no}${x.sale_mode === 'invoice' ? ' <span class="pill small">invoice</span>' : ''}${x.status === 'void' ? ' <span class="pill danger small">void</span>' : ''}<div class="muted small">${esc(x.customer || 'Walk-in')}</div></td>
          <td>${fmtTime(x.created_at)}</td><td class="num">${naira(x.amount)}</td><td><span class="pill ${x.payment_method === 'cash' ? 'ok' : ''}">${mLabel(x.payment_method)}</span></td></tr>`).join('')}</tbody></table>` : empty('No sales yet')}
    </section>

    ${reorder?.length && mgr ? `<section class="card span-2">
      <div class="card-head"><h2>Smart reorder suggestions</h2><a class="btn small primary" href="#/purchasing?from=reorder">Create purchase order</a></div>
      <div class="scroll"><table class="table stack"><thead><tr><th>Product</th><th class="num">In stock (all)</th><th class="num">Packs sold / day</th><th class="num">Days left</th><th class="num">Order</th><th class="num">Est. cost</th></tr></thead>
      <tbody>${reorder.slice(0, 8).map((r) => `<tr><td><strong>${esc(r.name)}</strong></td><td class="num">${fmtQty(r.stock, r.packs_per_carton)}</td><td class="num">${r.daily_sales}</td>
        <td class="num">${r.days_left == null ? '—' : `<span class="pill ${r.days_left < 5 ? 'danger' : 'warn'}">${r.days_left} days</span>`}</td>
        <td class="num"><strong>${num(r.suggested_cartons)}</strong> ctn</td><td class="num">${naira(r.est_cost)}</td></tr>`).join('')}</tbody></table></div>
    </section>` : ''}
  </div>`;
  bind(el, ctx);
}

function bind(el, ctx) {
  el.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => { period = b.dataset.period; ctx.rerender(); }));
}
