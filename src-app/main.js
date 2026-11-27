import './style.css';
import { sb, state, loadLocal, loadTickets, parkedCount, refreshCore, flushOutbox, onChange, isOnline, isManager, isOwner, role,
  setForceOffline, setBranch, branchName, retryFailed, discardOp } from './store.js';
import { esc, icon, toast, modal, fmtDateTime, fmtTime } from './ui.js';
import { renderDashboard } from './views/dashboard.js';
import { renderExpress, renderInvoice, renderParked } from './views/sell.js';
import { renderInventory } from './views/inventory.js';
import { renderSales } from './views/sales.js';
import { renderCustomers } from './views/customers.js';
import { renderPurchasing } from './views/purchasing.js';
import { renderExpenses } from './views/expenses.js';
import { renderReports } from './views/reports.js';
import { renderStaff } from './views/staff.js';
import { renderSettings } from './views/settings.js';
import { renderProducts } from './views/products.js';
import { renderSuppliers } from './views/suppliers.js';
import { renderPorter } from './views/porter.js';
import { renderBank } from './views/bank.js';

const ROUTES = [
  { key: 'dashboard', label: 'Dashboard', icon: icon.dashboard, view: renderDashboard, roles: ['owner', 'manager', 'cashier'] },
  { key: 'pos', label: 'Express sale', group: 'Sales (POS)', icon: icon.pos, view: renderExpress, roles: ['owner', 'manager', 'cashier'] },
  { key: 'invoice', label: 'Full invoice sale', group: 'Sales (POS)', icon: icon.sales, view: renderInvoice, roles: ['owner', 'manager', 'cashier'] },
  { key: 'parked', label: 'Parked sales', group: 'Sales (POS)', icon: icon.history, view: renderParked, roles: ['owner', 'manager', 'cashier'] },
  { key: 'sales', label: 'Sales history', group: 'Sales (POS)', icon: icon.reports, view: renderSales, roles: ['owner', 'manager', 'cashier'] },
  { key: 'inventory', label: 'Inventory', icon: icon.inventory, view: renderInventory, roles: ['owner', 'manager', 'cashier'] },
  { key: 'products', label: 'Products (admin)', icon: icon.tag, view: renderProducts, roles: ['owner', 'manager'] },
  { key: 'customers', label: 'Customers', icon: icon.customers, view: renderCustomers, roles: ['owner', 'manager', 'cashier'] },
  { key: 'suppliers', label: 'Suppliers', icon: icon.supplier, view: renderSuppliers, roles: ['owner', 'manager'] },
  { key: 'purchasing', label: 'Purchase orders', icon: icon.purchasing, view: renderPurchasing, roles: ['owner', 'manager'] },
  { key: 'porter', label: 'Market porter', icon: icon.porter, view: renderPorter, roles: ['owner', 'manager'] },
  { key: 'bank', label: 'Bank accounts', icon: icon.bank, view: renderBank, roles: ['owner', 'manager'] },
  { key: 'expenses', label: 'Expenses', icon: icon.expenses, view: renderExpenses, roles: ['owner', 'manager'] },
  { key: 'reports', label: 'Reports', icon: icon.reports, view: renderReports, roles: ['owner', 'manager'] },
  { key: 'staff', label: 'Staff & roles', icon: icon.staff, view: renderStaff, roles: ['owner'] },
  { key: 'settings', label: 'Settings', icon: icon.settings, view: renderSettings, roles: ['owner'] },
];

const app = document.getElementById('app');
// bank accounts stay hidden until a bank is linked (Settings can switch manual tracking on)
const visibleRoutes = () => ROUTES.filter((x) => x.roles.includes(role()) && (x.key !== 'bank' || state.settings.show_bank));

// label table cells so tables can stack into cards on phones
const labeller = new MutationObserver(() => {
  document.querySelectorAll('table.stack td:not([data-l])').forEach((c) => {
    const t = c.closest('table'); const head = t.tHead?.rows[0];
    let i = 0, p = c; while ((p = p.previousElementSibling)) i += p.colSpan;
    c.dataset.l = head?.cells[i]?.textContent.trim() || '';
  });
});
labeller.observe(document.body, { childList: true, subtree: true });
let currentRoute = null;
let renderToken = 0;

function route() {
  const key = (location.hash.replace(/^#\/?/, '') || (role() === 'cashier' ? 'pos' : 'dashboard')).split('?')[0];
  return visibleRoutes().find((r) => r.key === key) || ROUTES[0];
}

// ---------- login ----------
function renderLogin(err = '') {
  app.innerHTML = `
  <div class="login">
    <div class="login-art" aria-hidden="true">
      <div class="brand big"><span class="logo">A</span> Anayo 5PS Enterprises</div>
      <p class="login-tag">Sales, stock and money for Nigerian shops: on the counter, in the store room and on the owner's phone. Even when the network is gone.</p>
      <div class="login-stats">
        <div><strong>Point of sale</strong><span>Works offline</span></div>
        <div><strong>Warehouses &amp; store</strong><span>Cartons and packs</span></div>
        <div><strong>Debtors</strong><span>Credit &amp; part-pay</span></div>
        <div><strong>Reports</strong><span>P&amp;L, Excel, PDF</span></div>
      </div>
    </div>
    <form class="login-form card" id="login-form">
      <h1>Sign in</h1>
      <p class="muted">Use the account your shop owner created for you.</p>
      ${err ? `<div class="alert danger">${esc(err)}</div>` : ''}
      <label>Email<input name="email" type="email" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary block" type="submit">Sign in</button>
      <div class="demo-box">
        <div class="demo-title">Demo accounts</div>
        <button type="button" class="demo-btn" data-demo="owner@example.com|ShopTrack2026!"><strong>Owner</strong><span>Bisi Adeyemi · everything</span></button>
        <button type="button" class="demo-btn" data-demo="manager@example.com|Manager2026!"><strong>Manager</strong><span>Chioma Okafor · all locations</span></button>
        <button type="button" class="demo-btn" data-demo="staff@example.com|Staff2026!"><strong>Cashier</strong><span>Tunde Bello · Store till</span></button>
      </div>
      <p class="tiny muted">Built by Chada Digital</p>
    </form>
  </div>`;
  const form = document.getElementById('login-form');
  form.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => {
    const [e, p] = b.dataset.demo.split('|');
    form.email.value = e; form.password.value = p; form.requestSubmit();
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Signing in…';
    if (!navigator.onLine) { renderLogin('You need internet to sign in the first time on this device.'); return; }
    const { data, error } = await sb.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
    if (error) { renderLogin(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message); return; }
    state.session = data.session;
    state.branch = null;
    try { await refreshCore(); } catch (err) { renderLogin(err.message); return; }
    if (!state.profile?.active) { await sb.auth.signOut(); renderLogin('Your account is not active yet. Ask the owner to activate it.'); return; }
    location.hash = role() === 'cashier' ? '#/pos' : '#/dashboard';
    renderShell();
  });
}

// ---------- app shell ----------
function syncPill() {
  const pending = state.outbox.filter((o) => o.status === 'pending').length;
  const failed = state.outbox.filter((o) => o.status === 'failed').length;
  if (!isOnline()) return `<button class="sync-pill off" id="sync-pill">${icon.wifiOff}<span>Offline${pending ? ` · ${pending} to sync` : ''}</span></button>`;
  if (state.syncing) return `<button class="sync-pill busy" id="sync-pill">${icon.sync}<span>Syncing…</span></button>`;
  if (failed) return `<button class="sync-pill warn" id="sync-pill">${icon.alert}<span>${failed} need attention</span></button>`;
  if (pending) return `<button class="sync-pill busy" id="sync-pill">${icon.sync}<span>${pending} waiting</span></button>`;
  return `<button class="sync-pill on" id="sync-pill">${icon.wifi}<span>Synced${state.lastSync ? ' ' + fmtTime(state.lastSync) : ''}</span></button>`;
}

function branchPicker() { return ''; }

function renderShell() {
  const r = route();
  currentRoute = r.key;
  const nav = visibleRoutes();
  const parked = parkedCount();
  const navHtml = (() => {
    let out = '', open = null;
    nav.forEach((x) => {
      if (x.group !== open) { if (open) out += '</div>'; if (x.group) out += `<div class="nav-group"><div class="nav-group-title">${icon.pos}<span>${x.group}</span></div>`; open = x.group || null; }
      out += `<a href="#/${x.key}" class="nav-link ${x.group ? 'sub' : ''} ${x.key === r.key ? 'active' : ''}" ${x.key === r.key ? 'aria-current="page"' : ''}>${x.icon}<span>${x.label}</span>${x.key === 'parked' && parked ? `<b class="nav-badge">${parked}</b>` : ''}</a>`;
    });
    if (open) out += '</div>';
    return out;
  })();
  app.innerHTML = `
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><span class="logo">A</span><div><div class="brand-name">${esc(state.settings.business_name || 'Anayo 5PS Enterprises')}</div><div class="brand-sub">Sales &amp; inventory</div></div></div>
      <nav aria-label="Main">${navHtml}</nav>
      <div class="sidebar-foot">
        <div class="me"><div class="avatar">${esc((state.profile?.full_name || '?').slice(0, 1))}</div>
        <div><div class="me-name">${esc(state.profile?.full_name || '')}</div><div class="me-role">${esc(role())}</div></div></div>
        <button class="btn ghost small" id="logout">${icon.logout}<span>Sign out</span></button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" id="menu-btn" aria-label="Open menu">${icon.menu}</button>
        <h1 class="page-title">${r.label}</h1>
        <div class="topbar-right">
          ${branchPicker()}
          <span id="sync-slot">${syncPill()}</span>
          <label class="switch" title="Demo: pretend the internet is gone">
            <input type="checkbox" id="offline-toggle" ${state.forceOffline ? 'checked' : ''}>
            <span class="switch-track"></span><span class="switch-label">Simulate offline</span>
          </label>
        </div>
      </header>
      <main id="view" class="view" tabindex="-1"></main>
    </div>
    <div class="scrim" id="scrim"></div>
    <nav class="bottom-nav" aria-label="Quick links">
      ${['dashboard', 'pos', 'sales', 'inventory'].map((k) => { const x = ROUTES.find((y) => y.key === k);
        return `<a href="#/${k}" class="${k === r.key ? 'active' : ''} ${k === 'pos' ? 'sell' : ''}" ${k === r.key ? 'aria-current="page"' : ''}>${x.icon}<span>${k === 'pos' ? 'Sell' : k === 'inventory' ? 'Stock' : k === 'sales' ? 'Sales' : x.label}</span></a>`; }).join('')}
      <button type="button" id="bottom-more">${icon.menu}<span>More</span></button>
    </nav>
  </div>`;

  document.getElementById('logout').onclick = async () => {
    if (state.outbox.filter((o) => o.status === 'pending').length) {
      toast('Sync your pending records before signing out.', 'warn'); return;
    }
    await sb.auth.signOut();
    state.session = null; state.profile = null;
    renderLogin();
  };
  document.getElementById('offline-toggle').addEventListener('change', (e) => {
    setForceOffline(e.target.checked);
    toast(e.target.checked ? 'Offline mode: keep selling, everything saves on this device.' : 'Back online, syncing now…', e.target.checked ? 'warn' : 'info');
    renderView();
  });
  const sidebar = document.getElementById('sidebar'); const scrim = document.getElementById('scrim');
  document.getElementById('menu-btn').onclick = () => { sidebar.classList.add('open'); scrim.classList.add('show'); };
  document.getElementById('bottom-more').onclick = () => { sidebar.classList.add('open'); scrim.classList.add('show'); };
  scrim.onclick = () => { sidebar.classList.remove('open'); scrim.classList.remove('show'); };
  bindSyncPill();
  renderView();
}

function bindSyncPill() {
  document.getElementById('sync-pill')?.addEventListener('click', openSyncPanel);
}

function openSyncPanel() {
  const ops = state.outbox;
  const body = modal('Sync status', `
    <div class="sync-summary">
      <div><span class="muted">Connection</span><strong>${isOnline() ? 'Online' : 'Offline'}</strong></div>
      <div><span class="muted">Last synced</span><strong>${state.lastSync ? fmtDateTime(state.lastSync) : 'Not yet on this device'}</strong></div>
      <div><span class="muted">Waiting</span><strong>${ops.filter((o) => o.status === 'pending').length}</strong></div>
    </div>
    ${ops.length ? `<div class="list">${ops.map((o) => `
      <div class="list-row">
        <div><strong>${esc(o.label)}</strong><div class="muted small">${fmtDateTime(o.created_at)}${o.error ? ` · <span class="text-danger">${esc(o.error)}</span>` : ''}</div></div>
        <div class="row gap">${o.status === 'failed'
          ? `<button class="btn small" data-retry="${o.id}">Retry</button><button class="btn small danger" data-discard="${o.id}">Discard</button>`
          : '<span class="pill warn">Waiting</span>'}</div>
      </div>`).join('')}</div>` : '<p class="muted">Everything recorded on this device is on the server.</p>'}
    <div class="row end gap"><button class="btn primary" id="sync-now" ${isOnline() ? '' : 'disabled'}>${icon.sync}<span>Sync now</span></button></div>`);
  body.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-retry]'); const d = e.target.closest('[data-discard]');
    if (r) { retryFailed(r.dataset.retry); await flushOutbox(); openSyncPanel(); }
    if (d) { discardOp(d.dataset.discard); openSyncPanel(); }
    if (e.target.closest('#sync-now')) { const res = await flushOutbox(); toast(res.synced ? `${res.synced} record(s) synced` : 'Nothing new to sync'); openSyncPanel(); }
  });
}

async function renderView() {
  const r = route();
  if (r.key !== currentRoute) { renderShell(); return; }
  const old = document.getElementById('view');
  if (!old) return;
  const el = old.cloneNode(false);           // fresh node: drops listeners from the previous render
  old.replaceWith(el);
  const token = ++renderToken;
  el.innerHTML = '<div class="loading">Loading…</div>';
  try {
    await r.view(el, { isCurrent: () => token === renderToken, rerender: renderView });
  } catch (err) {
    console.error(err);
    if (token === renderToken) el.innerHTML = `<div class="card"><strong>Something went wrong.</strong><p class="muted">${esc(err.message || err)}</p></div>`;
  }
}

// keep the sync pill fresh without re-rendering whole screens
onChange(() => {
  const slot = document.getElementById('sync-slot');
  if (slot) { slot.innerHTML = syncPill(); bindSyncPill(); }
  const pl = document.querySelector('.nav-link[href="#/parked"]');
  if (pl) { const n = parkedCount(); let b = pl.querySelector('.nav-badge'); if (n) { if (!b) { b = document.createElement('b'); b.className = 'nav-badge'; pl.appendChild(b); } b.textContent = n; } else b?.remove(); }
});

window.addEventListener('hashchange', () => {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('scrim')?.classList.remove('show');
  if (state.profile) renderShell();
});
window.addEventListener('online', async () => { if (!state.forceOffline) { const r = await flushOutbox(); if (r.synced) toast(`Back online · ${r.synced} record(s) synced`); } });
window.addEventListener('offline', () => { toast('Network lost. Keep selling: everything saves on this device.', 'warn'); });
setInterval(() => { if (isOnline()) flushOutbox(); }, 30000);

// ---------- boot ----------
(async function boot() {
  await loadLocal();
  await loadTickets();
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  if (!state.session) { renderLogin(); return; }
  if (state.profile) renderShell();            // instant start from the local cache
  try {
    if (isOnline()) { await refreshCore(); await flushOutbox(); }
    if (!state.profile) { renderLogin('Please sign in again.'); return; }
    if (!state.profile.active) { await sb.auth.signOut(); renderLogin('Your account has been deactivated.'); return; }
    renderShell();
  } catch (e) {
    if (!state.profile) renderLogin(e.message);
  }
  sb.auth.onAuthStateChange((_evt, session) => { if (session) state.session = session; });
})();

// installable app
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
export { isManager, isOwner };
