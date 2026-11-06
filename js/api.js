import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kj-auth' }
});

const must = ({ data, error }) => { if (error) throw error; return data; };

// ---------- Auth ----------
export const auth = {
  async session() { return (await sb.auth.getSession()).data.session; },
  signIn: (email, password) => sb.auth.signInWithPassword({ email, password }).then(must),
  signUp: (email, password, full_name) => sb.auth.signUp({
    email, password,
    options: { data: { app: 'korjournal', full_name }, emailRedirectTo: location.origin + location.pathname }
  }).then(must),
  signOut: () => sb.auth.signOut(),
  resetPassword: email => sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }).then(must),
  updatePassword: password => sb.auth.updateUser({ password }).then(must),
  onChange: cb => sb.auth.onAuthStateChange(cb)
};

// ---------- Profiler ----------
export const profiles = {
  async me() {
    const uid = (await auth.session())?.user.id;
    if (!uid) return null;
    return must(await sb.from('kj_profiles').select('*').eq('id', uid).maybeSingle());
  },
  list: async () => must(await sb.from('kj_profiles').select('*').order('status').order('full_name')),
  update: async (id, patch) => must(await sb.from('kj_profiles').update(patch).eq('id', id).select().single())
};

// ---------- Fordon ----------
export const vehicles = {
  list: async (all = false) => {
    let q = sb.from('kj_vehicles').select('*').order('reg_no');
    if (!all) q = q.eq('active', true);
    return must(await q);
  },
  add: async v => must(await sb.from('kj_vehicles').insert(v).select().single()),
  update: async (id, patch) => must(await sb.from('kj_vehicles').update(patch).eq('id', id).select().single()),
  remove: async id => must(await sb.from('kj_vehicles').delete().eq('id', id)),
  last: async id => (must(await sb.rpc('kj_vehicle_last', { p_vehicle: id })) || [])[0] || { last_odo: 0, last_place: '' }
};

// ---------- Resor ----------
const TRIP_COLS = '*, vehicle:kj_vehicles(reg_no,name), driver:kj_profiles(full_name,email)';
export const trips = {
  async list({ from, to, vehicleId, driverId, type, mineOnly } = {}) {
    let q = sb.from('kj_trips').select(TRIP_COLS).order('trip_date', { ascending: false }).order('start_odo', { ascending: false });
    if (from) q = q.gte('trip_date', from);
    if (to) q = q.lte('trip_date', to);
    if (vehicleId) q = q.eq('vehicle_id', vehicleId);
    if (driverId) q = q.eq('driver_id', driverId);
    if (type) q = q.eq('trip_type', type);
    if (mineOnly) q = q.eq('driver_id', (await auth.session()).user.id);
    return must(await q);
  },
  get: async id => must(await sb.from('kj_trips').select(TRIP_COLS).eq('id', id).single()),
  insert: async t => must(await sb.from('kj_trips').insert(t).select().single()),
  update: async (id, t) => must(await sb.from('kj_trips').update(t).eq('id', id).select().single()),
  remove: async id => must(await sb.from('kj_trips').delete().eq('id', id))
};

// ---------- Offline-kö ----------
// Resor som sparas utan nät läggs i kö och skickas när nätet är tillbaka.
const QKEY = 'kj-queue';
const readQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } };
const writeQ = q => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch {} };
export const queue = {
  size: () => readQ().length,
  add: t => writeQ([...readQ(), t]),
  async flush() {
    const q = readQ(); if (!q.length || !navigator.onLine) return { sent: 0, failed: [] };
    const left = [], failed = [];
    let sent = 0;
    for (const t of q) {
      try { await trips.insert(t); sent++; }
      catch (e) { if (isNetworkError(e)) left.push(t); else failed.push({ trip: t, error: e.message }); }
    }
    writeQ(left);
    return { sent, failed };
  }
};
export const isNetworkError = e => !navigator.onLine || /fetch|network|Failed to fetch|Load failed/i.test(e?.message || '');
