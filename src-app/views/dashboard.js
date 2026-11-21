import { sb, state, isOnline, isManager, cachePut, cacheGet, branchName } from '../store.js';
import { esc, naira, short, num, todayISO, daysAgoISO, monthStartISO, icon, fmtDateTime, METHOD_LABEL, empty } from '../ui.js';

let period = '7d';
const PERIODS = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', month: 'This month' };
const range = () => {
  const to = todayISO();
  if (period === 'today') return [to, to];
  if (period === '30d') return [daysAgoISO(29), to];
  if (period === 'month') return [monthStartISO(), to];
  return [daysAgoISO(6), to];
};

const delta = (cur, prev) => {
  if (!prev) return '';
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  const up = p >= 0;
  return `<span class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}%</span><span class="muted small"> vs previous period</span>`;
};

export async function renderDashboard(el, ctx) {
  const [from, to] = range();
  const branch = state.branch === 'all' ? null : state.branch;
  const key = `dash-${period}-${branch || 'all'}`;
  let d, reorder, stale = null;
  if (isOnline()) {
    const [a, b] = await Promise.all([
      sb.rpc('dashboard_summary', { p_from: from, p_to: to, p_branch: branch }),
      sb.rpc('reorder_suggestions', { p_branch: branch }),
    ]);
    if (a.error) throw a.error;
    d = a.data; reorder = b.data || [];
    cachePut(key, { d, reorder });
  } else {
    const c = await cacheGet(key);
    if (c) { d = c.value.d; reorder = c.value.reorder; stale = c.at; }
  }
  if (!ctx.isCurrent()) return;

  const head = `<div class="toolbar">
    <div class="seg" role="group" aria-label="Period">${Object.entries(PERIODS).map(([k, v]) =>
      `<button class="${k === period ? 'on' : ''}" data-period="${k}" aria-pressed="${k === period}">${v}</button>`).join('')}</div>
    <div class="muted small">${esc(state.branch === 'all' ? 'All branches' : branchName(state.branch))}</div>
    <div class="grow"></div>
    <a class="btn primary" href="#/pos">${icon.plus}<span>Record a sale</span></a></div>
    ${stale ? `<div class="alert warn">${icon.wifiOff}<span>You're offline. These figures were last updated ${fmtDateTime(stale)}.</span></div>` : ''}`;

  if (!d) {
    el.innerHTML = head + empty('No dashboard saved on this device yet', 'Connect once to load your figures. Sales you record now are saved and will appear after syncing.');
    bind(el, ctx); return;
  }

  const mgr = isManager();
  const days = d.by_day || [];
  const maxDay = Math.max(1, ...days.map((x) => Number(x.revenue)));
  const methods = (d.by_method || []).sort((a, b) => b.revenue - a.revenue);
  const methodTotal = methods.reduce((a, m) => a + Number(m.revenue), 0) || 1;
  const top = d.top || [];
  const topMax = Math.max(1, ...top.map((t) => Number(t.revenue)));
  const hours = Array.from({ length: 15 }, (_, i) => i + 7).map((h) => ({ h, v: Number((d.by_hour || []).find((x) => x.hour === h)?.revenue || 0) }));
  const hourMax = Math.max(1, ...hours.map((x) => x.v));
  const busiest = hours.reduce((a, b) => (b.v > a.v ? b : a), hours[0]);
  const lowCount = state.products.filter((p) => p.active && (state.branch === 'all'
    ? Object.values(state.levels[p.id] || {}).reduce((a, b) => a + b, 0) : (state.levels[p.id]?.[state.branch] || 0)) <= p.reorder_level).length;
  const margin = d.revenue ? (Number(d.profit) / Number(d.revenue)) * 100 : 0;

  const insights = [];
  if (reorder?.[0]?.days_left != null) insights.push(`<strong>${esc(reorder[0].name)}</strong> runs out in about ${reorder[0].days_left} days at the current pace. Order ${reorder[0].suggested_qty} ${esc(reorder[0].unit)}s.`);
  if (busiest?.v) insights.push(`Your busiest hour is <strong>${busiest.h}:00–${busiest.h + 1}:00</strong>. Keep your best cashier on the till then.`);
  if (Number(d.receivables) > 0) insights.push(`Customers owe you <strong>${naira(d.receivables)}</strong>. Send WhatsApp reminders from Customers.`);
  if (mgr && d.prev_profit && Number(d.profit) < Number(d.prev_profit)) insights.push(`Profit is down on the previous period. Check discounts (${naira(d.discounts)}) and the price margins in Inventory.`);

  el.innerHTML = head + `
  <section class="kpis">
    <div class="kpi"><div class="kpi-label">Revenue</div><div class="kpi-value">${naira(d.revenue)}</div><div>${delta(Number(d.revenue), Number(d.prev_revenue))}</div></div>
    ${mgr ? `<div class="kpi"><div class="kpi-label">Gross profit</div><div class="kpi-value accent">${naira(d.profit)}</div><div class="muted small">${margin.toFixed(1)}% margin · ${delta(Number(d.profit), Number(d.prev_profit))}</div></div>
    <div class="kpi"><div class="kpi-label">Net profit after expenses</div><div class="kpi-value">${naira(d.net_profit)}</div><div class="muted small">Expenses ${naira(d.expenses)}</div></div>` : ''}
    <div class="kpi"><div class="kpi-label">Transactions</div><div class="kpi-value">${num(d.transactions)}</div><div class="muted small">Avg basket ${naira(d.avg_basket)} · ${num(d.items)} items</div></div>
    <div class="kpi"><div class="kpi-label">Owed by customers</div><div class="kpi-value">${naira(d.receivables)}</div><div class="muted small">${naira(d.credit_given)} credit given this period</div></div>
    ${mgr ? `<div class="kpi"><div class="kpi-label">Stock value (at cost)</div><div class="kpi-value">${naira(d.stock_value)}</div><div class="muted small">${lowCount} item${lowCount === 1 ? '' : 's'} at or below reorder level</div></div>` : ''}
  </section>

  ${insights.length ? `<section class="card insights"><div class="card-title">${icon.sparkle}<span>What needs your attention</span></div>
    <ul>${insights.map((i) => `<li>${i}</li>`).join('')}</ul></section>` : ''}

  <div class="grid-2">
    <section class="card span-2">
      <div class="card-head"><h2>Revenue by day</h2><span class="muted small">${esc(PERIODS[period])}</span></div>
      ${days.length > 1 ? `<div class="bars" style="--n:${days.length}">
        ${days.map((x) => {
          const h = Math.round((Number(x.revenue) / maxDay) * 100);
          const label = new Date(x.day + 'T12:00:00').toLocaleDateString('en-GB', days.length > 10 ? { day: 'numeric' } : { weekday: 'short', day: 'numeric' });
          return `<div class="bar-col" title="${esc(label)}: ${naira(x.revenue)} · ${x.tx} sales">
            <div class="bar-val">${short(x.revenue)}</div>
            <div class="bar" style="height:${Math.max(2, h)}%"></div>
            <div class="bar-label">${esc(label)}</div></div>`;
        }).join('')}</div>` : `<div class="big-number">${naira(d.revenue)}<span class="muted small"> today from ${d.transactions} sales</span></div>`}
    </section>

    <section class="card">
      <div class="card-head"><h2>How customers paid</h2></div>
      ${methods.length ? methods.map((m) => `<div class="meter-row">
        <div class="row between"><span>${METHOD_LABEL[m.method] || m.method}</span><span><strong>${naira(m.revenue)}</strong> <span class="muted small">${Math.round((m.revenue / methodTotal) * 100)}%</span></span></div>
        <div class="meter"><div style="width:${(m.revenue / methodTotal) * 100}%"></div></div></div>`).join('') : empty('No sales yet')}
    </section>

    <section class="card">
      <div class="card-head"><h2>Top products</h2></div>
      ${top.length ? top.map((t) => `<div class="meter-row">
        <div class="row between"><span>${esc(t.name)}</span><span><strong>${naira(t.revenue)}</strong> <span class="muted small">${num(t.qty)} sold</span></span></div>
        <div class="meter"><div style="width:${(t.revenue / topMax) * 100}%"></div></div></div>`).join('') : empty('No sales yet')}
    </section>

    <section class="card">
      <div class="card-head"><h2>Busiest hours</h2><span class="muted small">7am – 10pm</span></div>
      <div class="hours">${hours.map((x) => `<div class="hour" title="${x.h}:00 · ${naira(x.v)}">
        <div class="hour-bar" style="height:${Math.max(3, (x.v / hourMax) * 100)}%"></div><span>${x.h % 3 === 1 ? x.h : ''}</span></div>`).join('')}</div>
    </section>

    ${state.branch === 'all' && (d.by_branch || []).length > 1 ? `<section class="card">
      <div class="card-head"><h2>Branches</h2></div>
      ${(() => { const bm = Math.max(1, ...d.by_branch.map((b) => Number(b.revenue))); return d.by_branch.map((b) => `<div class="meter-row">
        <div class="row between"><span>${esc(b.name)}</span><span><strong>${naira(b.revenue)}</strong> <span class="muted small">${b.tx} sales</span></span></div>
        <div class="meter"><div style="width:${(b.revenue / bm) * 100}%"></div></div></div>`).join(''); })()}
    </section>` : ''}

    ${mgr && d.by_staff ? `<section class="card">
      <div class="card-head"><h2>Staff performance</h2></div>
      <table class="table compact"><thead><tr><th>Staff</th><th class="num">Sales</th><th class="num">Revenue</th></tr></thead>
      <tbody>${d.by_staff.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${s.tx}</td><td class="num">${naira(s.revenue)}</td></tr>`).join('')}</tbody></table>
    </section>` : ''}

    <section class="card span-2">
      <div class="card-head"><h2>Smart reorder suggestions</h2><span class="muted small">Based on the last 14 days of sales</span>
        ${mgr && reorder?.length ? `<a class="btn small primary" href="#/purchasing?from=reorder">Create purchase order</a>` : ''}</div>
      ${reorder?.length ? `<div class="scroll"><table class="table stack"><thead><tr><th>Product</th><th class="num">In stock</th><th class="num">Sells per day</th><th class="num">Days left</th><th class="num">Order</th>${mgr ? '<th class="num">Est. cost</th>' : ''}</tr></thead>
      <tbody>${reorder.slice(0, 8).map((r) => `<tr>
        <td><strong>${esc(r.name)}</strong> <span class="muted small">${esc(r.sku || '')}</span></td>
        <td class="num">${num(r.stock)}</td><td class="num">${r.daily_sales}</td>
        <td class="num">${r.days_left == null ? '—' : `<span class="pill ${r.days_left < 5 ? 'danger' : 'warn'}">${r.days_left} days</span>`}</td>
        <td class="num"><strong>${num(r.suggested_qty)}</strong> ${esc(r.unit)}s</td>${mgr ? `<td class="num">${naira(r.est_cost)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
        : empty('Stock levels look healthy', 'Nothing is close to running out.')}
    </section>
  </div>`;
  bind(el, ctx);
}

function bind(el, ctx) {
  el.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => { period = b.dataset.period; ctx.rerender(); }));
}
