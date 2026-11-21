// Small UI helpers shared by every screen
export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const naira = (n, opts = {}) => {
  const v = Number(n || 0);
  const s = Math.abs(v).toLocaleString('en-NG', { maximumFractionDigits: opts.dp ?? 0, minimumFractionDigits: opts.dp ?? 0 });
  return (v < 0 ? '−' : '') + '₦' + s;
};
export const short = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return '₦' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'm';
  if (Math.abs(v) >= 1e3) return '₦' + Math.round(v / 1e3) + 'k';
  return '₦' + Math.round(v);
};
export const num = (n) => Number(n || 0).toLocaleString('en-NG');

const TZ = 'Africa/Lagos';
export const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
export const fmtTime = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
export const fmtDateTime = (d) => fmtDate(d) + ', ' + fmtTime(d);
export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export const daysAgoISO = (n) => {
  const d = new Date(todayISO() + 'T12:00:00');
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
export const monthStartISO = () => todayISO().slice(0, 8) + '01';
export const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

export const METHOD_LABEL = { cash: 'Cash', transfer: 'Transfer', pos: 'POS', credit: 'Credit', split: 'Part-paid' };

const I = (d, extra = '') =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const icon = {
  dashboard: I('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'),
  pos: I('<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a1.5 1.5 0 0 0 1.5 1.1h8.8a1.5 1.5 0 0 0 1.5-1.2L21 7H6"/>'),
  inventory: I('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),
  sales: I('<path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z"/><path d="M9 7h6M9 11h6M9 15h4"/>'),
  customers: I('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M17 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>'),
  purchasing: I('<path d="M3 7h13v10H3z"/><path d="M16 10h4l2 3v4h-6"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>'),
  expenses: I('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>'),
  reports: I('<path d="M4 4h16v16H4z"/><path d="M8 16v-5M12 16V8M16 16v-3"/>'),
  staff: I('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  settings: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  wifi: I('<path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M1.4 9a16 16 0 0 1 21.2 0"/><path d="M8.5 16.1a6 6 0 0 1 7 0"/><circle cx="12" cy="20" r="1"/>'),
  wifiOff: I('<path d="M2 2l20 20"/><path d="M8.5 16.1a6 6 0 0 1 7 0"/><path d="M5 12.55a11 11 0 0 1 5.2-2.4"/><path d="M19 12.55a11 11 0 0 0-2.6-1.6"/><circle cx="12" cy="20" r="1"/>'),
  sync: I('<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  minus: I('<path d="M5 12h14"/>'),
  x: I('<path d="M18 6L6 18M6 6l12 12"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  menu: I('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  logout: I('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>'),
  download: I('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
  print: I('<path d="M6 9V2h12v7"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v8H6z"/>'),
  whatsapp: I('<path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3L3 21z"/><path d="M9 9.5c.3 1.8 2.2 4 4.5 4.6l1.2-1.2 1.8.8c-.2 1.1-1.1 1.8-2.2 1.8C11 15.5 8 12.6 8 9.4c0-1.1.8-2 1.8-2.2l.8 1.8L9 9.5z"/>'),
  edit: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>'),
  history: I('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
  transfer: I('<path d="M7 7h13l-4-4M17 17H4l4 4"/>'),
  sparkle: I('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/>'),
  trash: I('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
  check: I('<path d="M20 6L9 17l-5-5"/>'),
  alert: I('<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4M12 18h.01"/>'),
};

// ---------- toast ----------
let toastTimer;
export function toast(msg, kind = 'info') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.className = 'toast show ' + kind;
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
}

// ---------- modal ----------
export function modal(title, bodyHtml, { wide = false, onClose } = {}) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.id = 'modal';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-head"><h2 id="modal-title">${esc(title)}</h2>
    <button class="icon-btn" data-close aria-label="Close">${icon.x}</button></div>
    <div class="modal-body">${bodyHtml}</div></div>`;
  document.body.appendChild(wrap);
  const close = () => { closeModal(); onClose && onClose(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  setTimeout(() => wrap.querySelector('input,select,textarea,button:not([data-close])')?.focus(), 30);
  return wrap.querySelector('.modal-body');
}
export function closeModal() { document.getElementById('modal')?.remove(); }

export function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    const body = modal(title, `<p class="muted">${esc(text)}</p>
      <div class="row end gap"><button class="btn ghost" data-close>Cancel</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" id="cb-ok">${esc(okLabel)}</button></div>`, { onClose: () => resolve(false) });
    body.querySelector('#cb-ok').onclick = () => { closeModal(); resolve(true); };
  });
}

export const formData = (form) => Object.fromEntries(new FormData(form).entries());

export function empty(text, sub = '') {
  return `<div class="empty"><div class="empty-title">${esc(text)}</div>${sub ? `<div class="muted">${esc(sub)}</div>` : ''}</div>`;
}

export function needsOnline(what = 'This page') {
  return `<div class="card offline-card">${icon.wifiOff}<div><strong>${esc(what)} needs an internet connection.</strong>
  <div class="muted">Selling, restocking and collecting customer payments still work offline and sync automatically.</div></div></div>`;
}

export function pill(text, kind = '') { return `<span class="pill ${kind}">${esc(text)}</span>`; }

export function waLink(phone, text) {
  let p = String(phone || '').replace(/\D/g, '');
  if (p.startsWith('0')) p = '234' + p.slice(1);
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

export function debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
