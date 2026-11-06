import { auth, profiles, vehicles, trips, sb } from './api.js';

const $ = s => document.querySelector(s);
const page = $('#page');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const km = n => Number(n || 0).toLocaleString('sv-SE');
const today = () => new Date().toLocaleDateString('sv-SE');
const monthStart = (d = today()) => d.slice(0, 8) + '01';
const monthEnd = (d = today()) => { const [y, m] = d.split('-').map(Number); return new Date(y, m, 0).toLocaleDateString('sv-SE'); };
const typeLabel = t => t === 'tjanst' ? 'Tjänst' : 'Privat';
const statusLbl = { pending: 'Väntar', approved: 'Godkänd', blocked: 'Spärrad' };
const errMsg = e => {
  const m = e?.message || String(e);
  if (/Invalid login/i.test(m)) return 'Fel e-post eller lösenord.';
  if (/kj_trips_purpose_required/.test(m)) return 'Ärende krävs för tjänsteresor.';
  if (/kj_trips_odo_order/.test(m)) return 'Mätarställning slut måste vara större än start.';
  if (/reg_no/i.test(m) && /duplicate/i.test(m)) return 'Det registreringsnumret finns redan.';
  return m;
};

let me = null;
const F = { from: monthStart(), to: monthEnd(), vehicleId: '', driverId: '', type: '', q: '' };
let sort = { key: 'trip_date', dir: -1 };

// ---------- Inloggning ----------
function showLogin(msg = '') {
  $('#shell').hidden = true;
  $('#login').innerHTML = `<form class="card" id="lf"><div class="brand login-brand"><h1>Körjournal – SmartLabs Ai™</h1><small>Licensierad till <b>Skånebutiken</b></small></div><h2 style="margin-top:16px">Admin – logga in</h2>
    <label>E-post</label><input name="email" type="email" required autocomplete="email">
    <label>Lösenord</label><input name="password" type="password" required autocomplete="current-password">
    <div class="err" id="err">${esc(msg)}</div><button class="btn block">Logga in</button></form>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    try { await auth.signIn(e.target.email.value.trim(), e.target.password.value); boot(); }
    catch (ex) { $('#err').textContent = errMsg(ex); }
  };
}

async function boot() {
  const s = await auth.session();
  if (!s) return showLogin();
  me = await profiles.me();
  if (!me || me.role !== 'admin' || me.status !== 'approved') {
    await auth.signOut();
    return showLogin('Det här kontot har inte administratörsbehörighet.');
  }
  $('#login').innerHTML = '';
  $('#shell').hidden = false;
  $('#who').textContent = me.full_name || me.email;
  route();
}
$('#out').onclick = async () => { await auth.signOut(); location.hash = ''; boot(); };
window.addEventListener('hashchange', () => me && route());

// ---------- Router ----------
const pages = { overview, trips: tripsPage, drivers, vehicles: vehiclesPage };
async function route() {
  const p = (location.hash.slice(1) || 'overview');
  const name = pages[p] ? p : 'overview';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.p === name));
  page.innerHTML = '<p class="muted">Laddar…</p>';
  try { await pages[name](); } catch (e) { page.innerHTML = `<div class="card"><p class="err">${esc(errMsg(e))}</p></div>`; }
  refreshBadge();
}
async function refreshBadge() {
  try {
    const { count } = await sb.from('kj_profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    const b = $('#pendBadge'); b.hidden = !count; b.textContent = count || '';
  } catch {}
}

function modal(html) {
  const m = $('#modal'); m.innerHTML = `<div class="box">${html}</div>`; m.hidden = false;
  m.onclick = e => { if (e.target === m) closeModal(); };
  return m;
}
const closeModal = () => { $('#modal').hidden = true; $('#modal').innerHTML = ''; };
const downloadCSV = (name, head, rows) => {
  const csv = '﻿' + [head, ...rows].map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ---------- Översikt ----------
async function overview() {
  const from = monthStart(), to = monthEnd();
  const [vs, ps, month, recent, all] = await Promise.all([
    vehicles.list(true), profiles.list(), trips.list({ from, to }),
    sb.from('kj_trips').select('*, vehicle:kj_vehicles(reg_no,name), driver:kj_profiles(full_name)').order('created_at', { ascending: false }).limit(10).then(r => { if (r.error) throw r.error; return r.data; }),
    sb.from('kj_trips').select('vehicle_id,end_odo').then(r => { if (r.error) throw r.error; return r.data; })
  ]);
  const sum = t => month.filter(x => x.trip_type === t).reduce((a, x) => a + x.distance, 0);
  const pend = ps.filter(p => p.status === 'pending');
  const lastOdo = id => Math.max(vs.find(v => v.id === id)?.start_odometer || 0, ...all.filter(t => t.vehicle_id === id).map(t => t.end_odo));
  const perVeh = vs.filter(v => v.active).map(v => {
    const ts = month.filter(t => t.vehicle_id === v.id);
    return { v, n: ts.length, tj: ts.filter(t => t.trip_type === 'tjanst').reduce((a, t) => a + t.distance, 0), pr: ts.filter(t => t.trip_type === 'privat').reduce((a, t) => a + t.distance, 0), odo: lastOdo(v.id) };
  });
  page.innerHTML = `
    <div class="page-head"><h2>Översikt – ${new Date().toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' })}</h2></div>
    ${pend.length ? `<div class="card warn"><div class="row"><span><b>${pend.length}</b> förare väntar på godkännande</span><a class="btn small" href="#drivers" style="text-decoration:none">Granska</a></div></div>` : ''}
    <div class="cards4">
      <div class="kpi"><b>${km(sum('tjanst'))}</b><span class="muted">km tjänst</span></div>
      <div class="kpi"><b>${km(sum('privat'))}</b><span class="muted">km privat</span></div>
      <div class="kpi"><b>${month.length}</b><span class="muted">resor</span></div>
      <div class="kpi"><b>${ps.filter(p => p.status === 'approved').length}</b><span class="muted">aktiva förare</span></div>
    </div>
    <div class="two">
      <div><h2>Per fordon (denna månad)</h2><div class="tablewrap"><table class="t">
        <thead><tr><th>Fordon</th><th class="num">Resor</th><th class="num">Tjänst</th><th class="num">Privat</th><th class="num">Mätare</th></tr></thead>
        <tbody>${perVeh.map(r => `<tr><td>${esc(r.v.reg_no)} <span class="muted">${esc(r.v.name)}</span></td><td class="num">${r.n}</td><td class="num">${km(r.tj)}</td><td class="num">${km(r.pr)}</td><td class="num">${km(r.odo)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Inga fordon</td></tr>'}</tbody></table></div></div>
      <div><h2>Senast registrerade</h2><div class="tablewrap"><table class="t">
        <tbody>${recent.map(t => `<tr><td>${t.trip_date}</td><td>${esc(t.vehicle?.reg_no)}</td><td>${esc(t.driver?.full_name)}</td><td class="num">${km(t.distance)} km</td></tr>`).join('') || '<tr><td class="muted">Inga resor än</td></tr>'}</tbody></table></div></div>
    </div>`;
}

// ---------- Resor ----------
let tripRows = [];
async function tripsPage() {
  const [vs, ps] = await Promise.all([vehicles.list(true), profiles.list()]);
  page.innerHTML = `
    <div class="page-head no-print"><h2>Resor</h2>
      <div style="display:flex;gap:8px"><button class="btn ghost" id="csv">Excel (CSV)</button><button class="btn" id="prt">Skriv ut / PDF</button></div></div>
    <div class="toolbar no-print">
      <div><label>Från</label><input type="date" id="fFrom" value="${F.from}"></div>
      <div><label>Till</label><input type="date" id="fTo" value="${F.to}"></div>
      <div><label>Fordon</label><select id="fVeh"><option value="">Alla</option>${vs.map(v => `<option value="${v.id}" ${v.id === F.vehicleId ? 'selected' : ''}>${esc(v.reg_no)}</option>`).join('')}</select></div>
      <div><label>Förare</label><select id="fDrv"><option value="">Alla</option>${ps.filter(p => p.status !== 'pending').map(p => `<option value="${p.id}" ${p.id === F.driverId ? 'selected' : ''}>${esc(p.full_name || p.email)}</option>`).join('')}</select></div>
      <div><label>Typ</label><select id="fType"><option value="">Alla</option><option value="tjanst" ${F.type === 'tjanst' ? 'selected' : ''}>Tjänst</option><option value="privat" ${F.type === 'privat' ? 'selected' : ''}>Privat</option></select></div>
      <div style="flex:1;min-width:180px"><label>Sök</label><input id="fQ" value="${esc(F.q)}" placeholder="Plats, ärende, besökt…"></div>
    </div>
    <div class="tablewrap no-print"><table class="t" id="tt"></table></div>
    <section id="printArea" class="print-only"></section>`;
  const bind = (id, k) => $(id).onchange = e => { F[k] = e.target.value; tripsPage(); };
  bind('#fFrom', 'from'); bind('#fTo', 'to'); bind('#fVeh', 'vehicleId'); bind('#fDrv', 'driverId'); bind('#fType', 'type');
  let tm; $('#fQ').oninput = e => { F.q = e.target.value; clearTimeout(tm); tm = setTimeout(renderTrips, 150); };
  $('#csv').onclick = exportTripsCSV;
  $('#prt').onclick = () => window.print();

  tripRows = await trips.list({ from: F.from, to: F.to, vehicleId: F.vehicleId || undefined, driverId: F.driverId || undefined, type: F.type || undefined });
  window.__vs = vs; window.__ps = ps;
  renderTrips();
}

const visibleTrips = () => {
  const q = F.q.trim().toLowerCase();
  let r = q ? tripRows.filter(t => [t.from_place, t.to_place, t.purpose, t.visited, t.note, t.driver?.full_name, t.vehicle?.reg_no].join(' ').toLowerCase().includes(q)) : [...tripRows];
  const val = t => sort.key === 'vehicle' ? t.vehicle?.reg_no : sort.key === 'driver' ? t.driver?.full_name : t[sort.key];
  return r.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir || b.start_odo - a.start_odo);
};

function renderTrips() {
  const rows = visibleTrips();
  const tj = rows.filter(t => t.trip_type === 'tjanst').reduce((a, t) => a + t.distance, 0);
  const pr = rows.filter(t => t.trip_type === 'privat').reduce((a, t) => a + t.distance, 0);
  const cols = [['trip_date', 'Datum'], ['vehicle', 'Fordon'], ['driver', 'Förare'], ['start_odo', 'Start', 1], ['end_odo', 'Slut', 1], ['distance', 'Km', 1], ['from_place', 'Från'], ['to_place', 'Till'], ['purpose', 'Ärende'], ['trip_type', 'Typ']];
  $('#tt').innerHTML = `<thead><tr>${cols.map(([k, l, n]) => `<th data-k="${k}" class="${n ? 'num' : ''}">${l}${sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(t => `<tr class="click" data-id="${t.id}"><td>${t.trip_date}</td><td>${esc(t.vehicle?.reg_no)}</td><td>${esc(t.driver?.full_name)}</td><td class="num">${km(t.start_odo)}</td><td class="num">${km(t.end_odo)}</td><td class="num">${km(t.distance)}</td><td>${esc(t.from_place)}</td><td>${esc(t.to_place)}</td><td>${esc(t.purpose)}${t.visited ? ' – ' + esc(t.visited) : ''}</td><td>${typeLabel(t.trip_type)}</td></tr>`).join('') || `<tr><td colspan="10" class="muted">Inga resor för valda filter.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="5">${rows.length} resor · tjänst ${km(tj)} km · privat ${km(pr)} km</td><td class="num">${km(tj + pr)}</td><td colspan="4"></td></tr></tfoot>`;
  $('#tt').querySelectorAll('th').forEach(th => th.onclick = () => { sort = { key: th.dataset.k, dir: sort.key === th.dataset.k ? -sort.dir : 1 }; renderTrips(); });
  $('#tt').querySelectorAll('tr.click').forEach(tr => tr.onclick = () => editTrip(tr.dataset.id));
  $('#csv').disabled = $('#prt').disabled = !rows.length;
  $('#printArea').innerHTML = printHTML(rows, tj, pr);
}

function printHTML(rows, tj, pr) {
  const vs = window.__vs, ps = window.__ps;
  const veh = F.vehicleId ? vs.find(v => v.id === F.vehicleId) : null, drv = F.driverId ? ps.find(p => p.id === F.driverId) : null;
  const by = {};
  rows.forEach(t => { const k = t.vehicle?.reg_no || '?'; by[k] ??= { n: 0, tjanst: 0, privat: 0 }; by[k].n++; by[k][t.trip_type] += t.distance; });
  const ordered = [...rows].sort((a, b) => (a.vehicle?.reg_no || '').localeCompare(b.vehicle?.reg_no || '') || a.trip_date.localeCompare(b.trip_date) || a.start_odo - b.start_odo);
  return `<header class="p-head"><h1>Körjournal – SmartLabs Ai™</h1><div class="p-small">Licensierad till Skånebutiken</div><div>Period: <b>${F.from} – ${F.to}</b></div>
    <div>Fordon: ${veh ? esc(veh.reg_no) : 'Alla'} · Förare: ${drv ? esc(drv.full_name) : 'Alla'} · Typ: ${F.type ? typeLabel(F.type) : 'Alla'}</div>
    <div class="p-small">Utskriven ${new Date().toLocaleString('sv-SE')} av ${esc(me.full_name)}</div></header>
    <table class="p-sum"><thead><tr><th>Fordon</th><th>Resor</th><th>Km tjänst</th><th>Km privat</th><th>Km totalt</th></tr></thead>
    <tbody>${Object.entries(by).map(([r, v]) => `<tr><td>${esc(r)}</td><td>${v.n}</td><td>${km(v.tjanst)}</td><td>${km(v.privat)}</td><td>${km(v.tjanst + v.privat)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Totalt</td><td>${rows.length}</td><td>${km(tj)}</td><td>${km(pr)}</td><td>${km(tj + pr)}</td></tr></tfoot></table>
    <table class="p-trips"><thead><tr><th>Datum</th><th>Fordon</th><th>Förare</th><th>Mätare start</th><th>Mätare slut</th><th>Km</th><th>Från</th><th>Till</th><th>Ärende / besökt</th><th>Typ</th></tr></thead>
    <tbody>${ordered.map(t => `<tr><td>${t.trip_date}</td><td>${esc(t.vehicle?.reg_no)}</td><td>${esc(t.driver?.full_name)}</td><td>${km(t.start_odo)}</td><td>${km(t.end_odo)}</td><td>${km(t.distance)}</td><td>${esc(t.from_place)}</td><td>${esc(t.to_place)}</td><td>${esc(t.purpose)}${t.visited ? ' – ' + esc(t.visited) : ''}</td><td>${typeLabel(t.trip_type)}</td></tr>`).join('')}</tbody></table>
    <div class="p-sign"><div>Attesterad av: ______________________</div><div>Datum: ____________</div></div>`;
}

function exportTripsCSV() {
  const rows = visibleTrips().sort((a, b) => a.trip_date.localeCompare(b.trip_date) || a.start_odo - b.start_odo);
  downloadCSV(`korjournal_${F.from}_${F.to}.csv`,
    ['Datum', 'Regnr', 'Fordon', 'Förare', 'Mätare start', 'Mätare slut', 'Km', 'Från', 'Till', 'Ärende', 'Besökt', 'Typ', 'Anteckning'],
    rows.map(t => [t.trip_date, t.vehicle?.reg_no, t.vehicle?.name, t.driver?.full_name, t.start_odo, t.end_odo, t.distance, t.from_place, t.to_place, t.purpose, t.visited, typeLabel(t.trip_type), t.note]));
}

async function editTrip(id) {
  const t = tripRows.find(x => x.id === id), vs = window.__vs;
  modal(`<form id="ef"><h2>Redigera resa</h2><p class="muted">Förare: ${esc(t.driver?.full_name)}</p>
    <div class="seg"><input type="radio" name="trip_type" id="eT" value="tjanst" ${t.trip_type === 'tjanst' ? 'checked' : ''}><label for="eT">Tjänst</label>
      <input type="radio" name="trip_type" id="eP" value="privat" ${t.trip_type === 'privat' ? 'checked' : ''}><label for="eP">Privat</label></div>
    <div class="grid2"><div><label>Datum</label><input type="date" name="trip_date" value="${t.trip_date}" required></div>
      <div><label>Fordon</label><select name="vehicle_id">${vs.map(v => `<option value="${v.id}" ${v.id === t.vehicle_id ? 'selected' : ''}>${esc(v.reg_no)}</option>`).join('')}</select></div></div>
    <div class="grid2"><div><label>Mätare start</label><input type="number" name="start_odo" value="${t.start_odo}" required></div>
      <div><label>Mätare slut</label><input type="number" name="end_odo" value="${t.end_odo}" required></div></div>
    <div class="grid2"><div><label>Från</label><input name="from_place" value="${esc(t.from_place)}" required></div>
      <div><label>Till</label><input name="to_place" value="${esc(t.to_place)}" required></div></div>
    <label>Ärende</label><input name="purpose" value="${esc(t.purpose)}">
    <label>Besökt</label><input name="visited" value="${esc(t.visited)}">
    <label>Anteckning</label><input name="note" value="${esc(t.note)}">
    <div class="err" id="eerr"></div>
    <div class="btnrow"><button type="button" class="btn danger" id="edel">Ta bort</button><button type="button" class="btn ghost" id="ecan">Avbryt</button><button class="btn">Spara</button></div></form>`);
  $('#ecan').onclick = closeModal;
  $('#ef').onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const rec = { ...d, start_odo: Number(d.start_odo), end_odo: Number(d.end_odo) };
    if (rec.trip_type === 'privat') { rec.purpose = ''; rec.visited = ''; }
    try { await trips.update(id, rec); closeModal(); tripsPage(); } catch (ex) { $('#eerr').textContent = errMsg(ex); }
  };
  $('#edel').onclick = async () => {
    if (!confirm('Ta bort resan permanent? Det går inte att ångra.')) return;
    try { await trips.remove(id); closeModal(); tripsPage(); } catch (ex) { $('#eerr').textContent = errMsg(ex); }
  };
}

// ---------- Förare ----------
async function drivers() {
  const [ps, all] = await Promise.all([profiles.list(), sb.from('kj_trips').select('driver_id,distance').then(r => { if (r.error) throw r.error; return r.data; })]);
  const stat = id => { const t = all.filter(x => x.driver_id === id); return { n: t.length, km: t.reduce((a, x) => a + x.distance, 0) }; };
  page.innerHTML = `<div class="page-head"><h2>Förare</h2></div>
    <div class="tablewrap"><table class="t"><thead><tr><th>Namn</th><th>E-post</th><th>Roll</th><th>Status</th><th class="num">Resor</th><th class="num">Km totalt</th><th></th></tr></thead>
    <tbody>${ps.map(p => { const s = stat(p.id); return `<tr><td>${esc(p.full_name || '–')}</td><td>${esc(p.email)}</td><td>${p.role === 'admin' ? 'Admin' : 'Förare'}</td><td><span class="pill ${p.status}">${statusLbl[p.status]}</span></td><td class="num">${s.n}</td><td class="num">${km(s.km)}</td>
      <td>${p.id === me.id ? '' : `<select data-a="${p.id}" class="small-select"><option value="">Åtgärd…</option>
        ${p.status !== 'approved' ? '<option value="approve">Godkänn</option>' : ''}${p.status !== 'blocked' ? '<option value="block">Spärra</option>' : ''}
        <option value="${p.role === 'admin' ? 'driver' : 'admin'}">${p.role === 'admin' ? 'Gör till förare' : 'Gör till admin'}</option><option value="rename">Byt namn</option></select>`}</td></tr>`; }).join('')}</tbody></table></div>`;
  page.querySelectorAll('[data-a]').forEach(sel => sel.onchange = async () => {
    const id = sel.dataset.a, p = ps.find(x => x.id === id), a = sel.value; sel.value = '';
    try {
      if (a === 'approve') await profiles.update(id, { status: 'approved' });
      else if (a === 'block') { if (!confirm(`Spärra ${p.full_name}?`)) return; await profiles.update(id, { status: 'blocked' }); }
      else if (a === 'admin') { if (!confirm(`Ge ${p.full_name} administratörsbehörighet?`)) return; await profiles.update(id, { role: 'admin' }); }
      else if (a === 'driver') await profiles.update(id, { role: 'driver' });
      else if (a === 'rename') { const n = prompt('Nytt namn', p.full_name); if (!n?.trim()) return; await profiles.update(id, { full_name: n.trim() }); }
      else return;
      drivers(); refreshBadge();
    } catch (e) { alert(errMsg(e)); }
  });
}

// ---------- Fordon ----------
async function deleteVehicle(v, after) {
  if (!confirm(`Ta bort ${v.reg_no}${v.name ? ' (' + v.name + ')' : ''} permanent? Det går inte att ångra.`)) return;
  try { await vehicles.remove(v.id); after(); }
  catch (e) { alert(/foreign key|violates/i.test(e.message) ? `${v.reg_no} har registrerade resor och kan inte tas bort. Inaktivera fordonet i stället.` : errMsg(e)); }
}

async function vehiclesPage() {
  const vs = await vehicles.list(true);
  page.innerHTML = `<div class="page-head"><h2>Fordon</h2></div>
    <div class="tablewrap"><table class="t"><thead><tr><th>Regnr</th><th>Benämning</th><th class="num">Startmätare</th><th>Status</th><th></th></tr></thead>
    <tbody>${vs.map(v => `<tr><td><b>${esc(v.reg_no)}</b></td><td>${esc(v.name)}</td><td class="num">${km(v.start_odometer)}</td><td>${v.active ? 'Aktivt' : 'Inaktivt'}</td>
      <td><button class="btn small ghost" data-e="${v.id}">Ändra</button> <button class="btn small ghost" data-t="${v.id}">${v.active ? 'Inaktivera' : 'Aktivera'}</button> <button class="btn small danger" data-d="${v.id}">Ta bort</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Inga fordon</td></tr>'}</tbody></table></div>
    <form class="card" id="vf" style="max-width:560px;margin-top:16px"><h2>Lägg till fordon</h2>
      <div class="grid2"><div><label>Regnr</label><input name="reg_no" required placeholder="ABC123"></div><div><label>Benämning</label><input name="name"></div></div>
      <label>Aktuell mätarställning (km)</label><input type="number" name="start_odometer" min="0" required><div class="err" id="verr"></div>
      <button class="btn block">Lägg till</button></form>`;
  page.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => { const v = vs.find(x => x.id === b.dataset.t); try { await vehicles.update(v.id, { active: !v.active }); vehiclesPage(); } catch (e) { alert(errMsg(e)); } });
  page.querySelectorAll('[data-d]').forEach(b => b.onclick = () => deleteVehicle(vs.find(x => x.id === b.dataset.d), vehiclesPage));
  page.querySelectorAll('[data-e]').forEach(b => b.onclick = () => {
    const v = vs.find(x => x.id === b.dataset.e);
    modal(`<form id="vef"><h2>Ändra ${esc(v.reg_no)}</h2><label>Benämning</label><input name="name" value="${esc(v.name)}">
      <label>Startmätare (km)</label><input type="number" name="start_odometer" min="0" value="${v.start_odometer}" required>
      <div class="btnrow"><button type="button" class="btn ghost" id="vc">Avbryt</button><button class="btn">Spara</button></div></form>`);
    $('#vc').onclick = closeModal;
    $('#vef').onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); try { await vehicles.update(v.id, { name: d.name.trim(), start_odometer: Number(d.start_odometer) }); closeModal(); vehiclesPage(); } catch (ex) { alert(errMsg(ex)); } };
  });
  $('#vf').onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    try { await vehicles.add({ reg_no: d.reg_no.toUpperCase().replace(/[\s-]/g, ''), name: d.name.trim(), start_odometer: Number(d.start_odometer) }); vehiclesPage(); }
    catch (ex) { $('#verr').textContent = errMsg(ex); }
  };
}

boot();
