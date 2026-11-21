// Data layer: Supabase client, offline cache and the sync outbox
import { createClient } from '@supabase/supabase-js';
import { get, set } from 'idb-keyval';
import { uuid } from './ui.js';

export const SUPABASE_URL = 'https://jefqyihoipkqlwbjapqt.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_C7HygMpfsyDy9LQoWtDLwg_WZbJdqqG';
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

export const state = {
  session: null,
  profile: null,
  settings: { business_name: 'ShopTrack', receipt_footer: '' },
  branches: [],
  branch: null,          // selected branch id, or 'all' (owner/manager)
  products: [],
  levels: {},            // levels[productId][branchId] = qty
  customers: [],
  outbox: [],
  forceOffline: false,
  syncing: false,
  lastSync: null,
  cacheSavedAt: null,
};

export const role = () => state.profile?.role || 'cashier';
export const isManager = () => ['owner', 'manager'].includes(role());
export const isOwner = () => role() === 'owner';
export const isOnline = () => navigator.onLine && !state.forceOffline;
export const branchName = (id) => state.branches.find((b) => b.id === id)?.name || '—';
export const sellBranch = () => (state.branch && state.branch !== 'all' ? state.branch : state.profile?.branch_id || state.branches[0]?.id);
export const stockAt = (pid, bid) => {
  const l = state.levels[pid] || {};
  if (!bid || bid === 'all') return Object.values(l).reduce((a, b) => a + b, 0);
  return l[bid] || 0;
};

// ---------- persistence ----------
async function saveCache() {
  state.cacheSavedAt = new Date().toISOString();
  try {
    await set('st-cache-v1', {
      profile: state.profile, settings: state.settings, branches: state.branches, products: state.products,
      levels: state.levels, customers: state.customers, savedAt: state.cacheSavedAt, lastSync: state.lastSync,
    });
  } catch (e) { console.warn('cache save failed', e); }
}
async function saveOutbox() { try { await set('st-outbox-v1', state.outbox); } catch (e) { console.warn(e); } }
export async function savePrefs() {
  try { await set('st-prefs-v1', { branch: state.branch, forceOffline: state.forceOffline }); } catch (e) { /* ignore */ }
}

export async function loadLocal() {
  try {
    const c = await get('st-cache-v1');
    if (c) Object.assign(state, { profile: c.profile, settings: c.settings || state.settings, branches: c.branches || [],
      products: c.products || [], levels: c.levels || {}, customers: c.customers || [], cacheSavedAt: c.savedAt, lastSync: c.lastSync });
    state.outbox = (await get('st-outbox-v1')) || [];
    const p = await get('st-prefs-v1');
    if (p) { state.branch = p.branch ?? state.branch; state.forceOffline = !!p.forceOffline; }
  } catch (e) { console.warn('local load failed', e); }
}

// ---------- fetch everything the counter needs ----------
export async function refreshCore() {
  if (!isOnline() || !state.session) return false;
  const uid = state.session.user.id;
  const [prof, settings, branches, products, levels, customers] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).single(),
    sb.from('settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('branches').select('*').eq('active', true).order('name'),
    sb.from('products').select('*').order('name'),
    sb.from('stock_levels').select('*'),
    sb.from('customers').select('*').order('name'),
  ]);
  if (prof.error) throw prof.error;
  state.profile = prof.data;
  if (settings.data) state.settings = settings.data;
  state.branches = branches.data || [];
  state.products = products.data || [];
  state.customers = customers.data || [];
  const lv = {};
  (levels.data || []).forEach((r) => { (lv[r.product_id] ||= {})[r.branch_id] = r.qty; });
  // keep local deductions for sales that are still waiting in the outbox
  state.outbox.filter((o) => o.type === 'sale').forEach((o) => {
    o.payload.p_items.forEach((it) => {
      (lv[it.product_id] ||= {})[o.payload.p_branch] = (lv[it.product_id][o.payload.p_branch] || 0) - it.qty;
    });
  });
  state.outbox.filter((o) => o.type === 'restock').forEach((o) => {
    (lv[o.payload.p_product] ||= {})[o.payload.p_branch] = (lv[o.payload.p_product][o.payload.p_branch] || 0) + o.payload.p_change;
  });
  state.levels = lv;
  // re-apply customer changes still waiting to sync
  state.outbox.forEach((o) => {
    if (o.type === 'customer' && !state.customers.find((c) => c.id === o.payload.id)) state.customers.push({ ...o.payload, balance: 0 });
    if (o.type === 'customer_payment') {
      const c = state.customers.find((x) => x.id === o.payload.p_customer); if (c) c.balance = Number(c.balance) - o.payload.p_amount;
    }
    if (o.type === 'sale' && o.payload.p_customer && o.meta) {
      const unpaid = o.meta.total - (o.payload.p_amount_paid ?? o.meta.total);
      const c = state.customers.find((x) => x.id === o.payload.p_customer); if (c && unpaid > 0) c.balance = Number(c.balance) + unpaid;
    }
  });
  if (!state.branch || (state.branch !== 'all' && !state.branches.find((b) => b.id === state.branch))) {
    state.branch = state.profile.role === 'cashier' ? state.profile.branch_id : (state.profile.branch_id || 'all');
  }
  if (state.profile.role === 'cashier') state.branch = state.profile.branch_id;
  await saveCache();
  emit();
  return true;
}

// ---------- outbox ----------
function queue(type, payload, label) {
  const op = { id: uuid(), type, payload, label, created_at: new Date().toISOString(), status: 'pending', error: null };
  state.outbox.push(op);
  saveOutbox();
  emit();
  return op;
}

const RPC = {
  sale: (p) => sb.rpc('record_sale', p),
  restock: (p) => sb.rpc('record_stock_movement', p),
  customer_payment: (p) => sb.rpc('record_customer_payment', p),
  customer: (p) => sb.from('customers').upsert(p, { onConflict: 'id', ignoreDuplicates: true }),
};

const results = new Map();
const isNetworkError = (err) => !err?.code && /fetch|network|Load failed|timeout/i.test(err?.message || String(err));

export async function flushOutbox() {
  if (state.syncing || !isOnline() || !state.session) return { synced: 0 };
  const pending = state.outbox.filter((o) => o.status === 'pending');
  if (!pending.length) return { synced: 0 };
  state.syncing = true; emit();
  let synced = 0; const warnings = [];
  try {
    for (const op of pending) {
      let res;
      try { res = await RPC[op.type](op.payload); } catch (e) { res = { error: e }; }
      if (res.error) {
        if (isNetworkError(res.error)) break;          // try again later
        op.status = 'failed'; op.error = res.error.message;   // needs a human to look at it
        continue;
      }
      if (op.type === 'sale' && res.data?.oversold?.length) {
        warnings.push(...res.data.oversold.map((o) => `${o.product} oversold by ${o.short_by}`));
      }
      if (op.type === 'sale' && res.data?.warning) warnings.push(res.data.warning);
      results.set(op.id, res.data);
      state.outbox = state.outbox.filter((o) => o.id !== op.id);
      synced++;
    }
  } finally {
    state.syncing = false;
    if (synced) state.lastSync = new Date().toISOString();
    await saveOutbox();
    if (synced) await refreshCore().catch(() => {});
    await saveCache();
    emit();
  }
  return { synced, warnings };
}
export function retryFailed(id) {
  state.outbox.forEach((o) => { if (!id || o.id === id) { if (o.status === 'failed') { o.status = 'pending'; o.error = null; } } });
  saveOutbox(); emit();
}
export function discardOp(id) {
  const op = state.outbox.find((o) => o.id === id);
  if (op?.type === 'sale') {
    op.payload.p_items.forEach((it) => {
      const l = (state.levels[it.product_id] ||= {});
      l[op.payload.p_branch] = (l[op.payload.p_branch] || 0) + it.qty;
    });
  }
  state.outbox = state.outbox.filter((o) => o.id !== id);
  saveOutbox(); saveCache(); emit();
}

// ---------- actions that work offline ----------
export async function recordSale(sale) {
  // sale: { p_id, p_branch, p_items:[{product_id, qty, unit_price}], p_method, p_amount_paid, p_discount, p_customer, p_note, meta }
  const payload = {
    p_id: sale.p_id, p_branch: sale.p_branch, p_items: sale.p_items, p_method: sale.p_method,
    p_amount_paid: sale.p_amount_paid, p_discount: sale.p_discount || 0, p_customer: sale.p_customer || null,
    p_created_at: new Date().toISOString(), p_offline: !isOnline(), p_device: navigator.userAgent.slice(0, 80), p_note: sale.p_note || null,
  };
  // optimistic stock deduction
  payload.p_items.forEach((it) => {
    const l = (state.levels[it.product_id] ||= {});
    l[payload.p_branch] = (l[payload.p_branch] || 0) - it.qty;
  });
  const unpaid = sale.meta.total - (payload.p_amount_paid ?? sale.meta.total);
  if (payload.p_customer && unpaid > 0) {
    const c = state.customers.find((x) => x.id === payload.p_customer);
    if (c) c.balance = Number(c.balance) + unpaid;
  }
  const op = queue('sale', payload, `Sale ${sale.meta.totalText}`);
  op.meta = sale.meta;
  await saveOutbox(); await saveCache();
  if (isOnline()) {
    const r = await flushOutbox();
    const still = state.outbox.find((o) => o.id === op.id);
    return { offline: !!still && still.status === 'pending', failed: still?.status === 'failed' ? still.error : null, warnings: r.warnings || [], receipt_no: results.get(op.id)?.receipt_no || null };
  }
  return { offline: true, warnings: [] };
}

export async function recordRestock(productId, branchId, qty, note) {
  const payload = { p_id: uuid(), p_product: productId, p_branch: branchId, p_change: qty, p_reason: 'restock', p_note: note || null, p_created_at: new Date().toISOString() };
  const l = (state.levels[productId] ||= {});
  l[branchId] = (l[branchId] || 0) + qty;
  const name = state.products.find((p) => p.id === productId)?.name || 'item';
  queue('restock', payload, `Restock ${name} +${qty}`);
  await saveCache();
  if (isOnline()) await flushOutbox();
}

export async function addCustomer(c) {
  const row = { id: uuid(), name: c.name, phone: c.phone || null, address: c.address || null, credit_limit: Number(c.credit_limit || 0), balance: 0 };
  state.customers.push(row);
  state.customers.sort((a, b) => a.name.localeCompare(b.name));
  queue('customer', { id: row.id, name: row.name, phone: row.phone, address: row.address, credit_limit: row.credit_limit }, `New customer ${row.name}`);
  await saveCache();
  if (isOnline()) await flushOutbox();
  return row;
}

export async function recordCustomerPayment(customerId, amount, method, note) {
  const payload = { p_id: uuid(), p_customer: customerId, p_amount: Number(amount), p_method: method, p_branch: sellBranch(), p_note: note || null };
  const c = state.customers.find((x) => x.id === customerId);
  if (c) c.balance = Number(c.balance) - Number(amount);
  queue('customer_payment', payload, `Payment from ${c?.name || 'customer'}`);
  await saveCache();
  if (isOnline()) await flushOutbox();
}

export function pendingSales() {
  return state.outbox.filter((o) => o.type === 'sale');
}

export function setForceOffline(v) {
  state.forceOffline = v; savePrefs(); emit();
  if (!v) flushOutbox();
}
export function setBranch(id) { state.branch = id; savePrefs(); emit(); }

// Cached copies of online-only screens, so the owner still sees the last numbers offline
export async function cachePut(key, value) { try { await set('st-view-' + key, { value, at: new Date().toISOString() }); } catch (e) { /* ignore */ } }
export async function cacheGet(key) { try { return await get('st-view-' + key); } catch (e) { return null; } }
export { emit };
