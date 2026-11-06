import { auth, profiles, vehicles, trips, queue, isNetworkError } from './api.js';

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const userBox = document.getElementById('userBox');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toLocaleDateString('sv-SE');
const km = n => Number(n || 0).toLocaleString('sv-SE');
const monthStart = (d = today()) => d.slice(0, 8) + '01';
const monthEnd = (d = today()) => { const [y, m] = d.split('-').map(Number); return new Date(y, m, 0).toLocaleDateString('sv-SE'); };
const typeLabel = t => t === 'tjanst' ? 'Tjänst' : 'Privat';
const errMsg = e => {
  const m = e?.message || String(e);
  if (/Invalid login/i.test(m)) return 'Fel e-post eller lösenord.';
  if (/Email not confirmed/i.test(m)) return 'E-postadressen är inte bekräftad. Kolla din inkorg.';
  if (/already registered/i.test(m)) return 'E-postadressen är redan registrerad.';
  if (/same as the old|different from the old/i.test(m)) return 'Det nya lösenordet måste skilja sig från det gamla.';
  if (/Password/i.test(m) && /(character|weak|pwned|compromised|leaked)/i.test(m)) return 'Lösenordet godkänns inte: ' + m;
  if (/kj_trips_purpose_required/.test(m)) return 'Ärende krävs för tjänsteresor.';
  if (/kj_trips_odo_order/.test(m)) return 'Mätarställning slut måste vara större än start.';
  if (/duplicate key.*reg_no/i.test(m)) return 'Det registreringsnumret finns redan.';
  return m;
};

let me = null;

function toast(msg, bad) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : ''); el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
const loading = () => view.innerHTML = '<p class="muted center">Laddar…</p>';

// ---------- Navigering ----------
const routes = {};
let current = 'trips';
async function go(route, arg) {
  current = route;
  tabbar.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.route === route));
  loading();
  try { await routes[route](arg); }
  catch (e) { view.innerHTML = `<div class="card"><p class="err">${esc(isNetworkError(e) ? 'Ingen anslutning. Försök igen när du har nät.' : errMsg(e))}</p><button class="btn ghost block" id="retry">Försök igen</button></div>`; document.getElementById('retry').onclick = () => go(route, arg); }
  window.scrollTo(0, 0);
}

const svg = p => `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICONS = {
  trips: svg('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  new: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  report: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  admin: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M17 5.5a3 3 0 0 1 0 5M19 14.5c1.8.7 3 2.4 3 5.5"/>'),
  profile: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>')
};

function buildTabs() {
  const tabs = [['trips', 'Mina resor'], ['new', 'Ny resa']];
  if (me?.role === 'admin') tabs.push(['report', 'Rapport'], ['admin', 'Admin']);
  tabs.push(['profile', 'Profil']);
  tabbar.style.gridTemplateColumns = `repeat(${tabs.length},1fr)`;
  tabbar.innerHTML = tabs.map(([r, l]) => `<button data-route="${r}">${ICONS[r]}<span>${l}</span></button>`).join('');
  tabbar.querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.route));
  tabbar.hidden = false;
}

// ---------- Start / inloggningsflöde ----------
async function boot() {
  tabbar.hidden = true; userBox.textContent = '';
  if (location.hash.includes('type=recovery')) return renderNewPassword();
  const s = await auth.session();
  if (!s) return renderAuth();
  try { me = await profiles.me(); } catch (e) { if (isNetworkError(e)) return offlineStart(); throw e; }
  if (!me) return renderNoProfile();
  if (me.status === 'pending') return renderPending();
  if (me.status === 'blocked') return renderBlocked();
  userBox.textContent = me.full_name || me.email;
  buildTabs();
  flushQueue();
  go('trips');
}

function offlineStart() {
  view.innerHTML = `<div class="card"><h2>Ingen anslutning</h2><p class="muted">Appen behöver nät för att starta. Försök igen.</p><button class="btn block" id="r">Försök igen</button></div>`;
  document.getElementById('r').onclick = boot;
}

function renderAuth(mode = 'login') {
  const reg = mode === 'register', reset = mode === 'reset';
  view.innerHTML = `
    <form class="card auth" id="af">
      <h2>${reg ? 'Skapa konto' : reset ? 'Glömt lösenord' : 'Logga in'}</h2>
      ${reg ? '<label>Namn</label><input name="name" required autocomplete="name">' : ''}
      <label>E-post</label><input name="email" type="email" required autocomplete="email">
      ${reset ? '' : `<label>Lösenord</label><input name="password" type="password" required minlength="6" autocomplete="${reg ? 'new-password' : 'current-password'}">`}
      <div class="err" id="err"></div>
      <button class="btn block">${reg ? 'Skapa konto' : reset ? 'Skicka återställningslänk' : 'Logga in'}</button>
      <div class="links">
        ${reg || reset ? '<a href="#" data-m="login">Har redan konto? Logga in</a>' : '<a href="#" data-m="register">Ny förare? Skapa konto</a><a href="#" data-m="reset">Glömt lösenord?</a>'}
      </div>
    </form>`;
  view.querySelectorAll('[data-m]').forEach(a => a.onclick = e => { e.preventDefault(); renderAuth(a.dataset.m); });
  const f = document.getElementById('af');
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true;
    const err = document.getElementById('err'); err.textContent = '';
    try {
      if (reg) {
        const r = await auth.signUp(f.email.value.trim(), f.password.value, f.name.value.trim());
        if (!r.session) {
          view.innerHTML = `<div class="card"><h2>Kolla din e-post</h2><p>Vi har skickat en bekräftelselänk till <b>${esc(f.email.value)}</b>. Klicka på den och logga sedan in.</p><p class="muted">Efter det måste en administratör godkänna ditt konto.</p><button class="btn block" id="b">Till inloggning</button></div>`;
          document.getElementById('b').onclick = () => renderAuth();
          return;
        }
      } else if (reset) {
        await auth.resetPassword(f.email.value.trim());
        err.className = 'ok'; err.textContent = 'Om adressen finns har en länk skickats.';
        btn.disabled = false; return;
      } else {
        await auth.signIn(f.email.value.trim(), f.password.value);
      }
      boot();
    } catch (ex) { err.textContent = errMsg(ex); btn.disabled = false; }
  };
}

function renderNewPassword() {
  view.innerHTML = `<form class="card" id="pf"><h2>Nytt lösenord</h2>
    <label>Nytt lösenord</label><input type="password" name="pw" minlength="6" required autocomplete="new-password">
    <div class="err" id="err"></div><button class="btn block">Spara</button></form>`;
  const f = document.getElementById('pf');
  f.onsubmit = async e => {
    e.preventDefault();
    try { await auth.updatePassword(f.pw.value); history.replaceState(null, '', location.pathname); toast('Lösenordet är bytt'); boot(); }
    catch (ex) { document.getElementById('err').textContent = errMsg(ex); }
  };
}

function statusScreen(title, text) {
  view.innerHTML = `<div class="card"><h2>${title}</h2><p>${text}</p>
    <button class="btn block" id="chk">Kontrollera igen</button><button class="btn ghost block" id="out">Logga ut</button></div>`;
  document.getElementById('chk').onclick = boot;
  document.getElementById('out').onclick = logout;
}
const renderPending = () => statusScreen('Väntar på godkännande', `Hej ${esc(me.full_name)}! Ditt konto är skapat men måste godkännas av en administratör innan du kan registrera resor.`);
const renderBlocked = () => statusScreen('Kontot är spärrat', 'Kontakta administratören om du tror att detta är fel.');
const renderNoProfile = () => statusScreen('Inget körjournalskonto', 'Det här kontot är inte registrerat i körjournalen. Logga ut och skapa ett konto via "Ny förare".');
async function logout() { await auth.signOut(); me = null; boot(); }

// ---------- Offline-kö ----------
async function flushQueue() {
  if (!queue.size()) return;
  const { sent, failed } = await queue.flush();
  if (sent) toast(`${sent} resa/resor från offline-kön skickade`);
  if (failed.length) alert('Några offline-resor kunde inte sparas och måste läggas in igen:\n\n' +
    failed.map(f => `${f.trip.trip_date} ${f.trip.from_place} → ${f.trip.to_place} (${f.trip.start_odo}–${f.trip.end_odo}): ${errMsg({ message: f.error })}`).join('\n'));
  if (current === 'trips' && (sent || failed.length)) go('trips');
}
window.addEventListener('online', flushQueue);

// ---------- Mina resor ----------
let myMonth = today().slice(0, 7);
routes.trips = async () => {
  const list = await trips.list({ mineOnly: true, from: myMonth + '-01', to: monthEnd(myMonth + '-01') });
  const sum = t => list.filter(x => x.trip_type === t).reduce((a, x) => a + x.distance, 0);
  const q = queue.size();
  view.innerHTML = `
    ${q ? `<div class="card warn">${q} resa/resor väntar på att skickas (ingen anslutning). <button class="btn small" id="fl">Skicka nu</button></div>` : ''}
    <input type="month" id="fMonth" value="${myMonth}" style="margin-bottom:12px">
    <div class="stats">
      <div><b>${km(sum('tjanst'))}</b><span class="muted">km tjänst</span></div>
      <div><b>${km(sum('privat'))}</b><span class="muted">km privat</span></div>
      <div><b>${list.length}</b><span class="muted">resor</span></div>
    </div>
    ${list.length ? list.map(tripCard).join('') : '<p class="muted center">Inga resor denna månad.</p>'}`;
  document.getElementById('fMonth').onchange = e => { myMonth = e.target.value || today().slice(0, 7); go('trips'); };
  view.querySelectorAll('.card[data-id]').forEach(c => c.onclick = () => go('new', c.dataset.id));
  const fl = document.getElementById('fl'); if (fl) fl.onclick = flushQueue;
};

const tripCard = t => `<div class="card trip" data-id="${t.id}">
  <div class="row"><b>${esc(t.from_place)} → ${esc(t.to_place)}</b><span class="tag ${t.trip_type}">${typeLabel(t.trip_type)}</span></div>
  <div class="muted">${t.trip_date} · ${esc(t.vehicle?.reg_no)} · ${km(t.distance)} km (${km(t.start_odo)}–${km(t.end_odo)})${me.role === 'admin' && t.driver ? ' · ' + esc(t.driver.full_name) : ''}</div>
  ${t.purpose ? `<div class="sub">${esc(t.purpose)}${t.visited ? ' – ' + esc(t.visited) : ''}</div>` : ''}
</div>`;

// ---------- Ny / redigera resa ----------
let lastVehicle = null;
try { lastVehicle = localStorage.getItem('kj-last-vehicle'); } catch {}

routes.new = async id => {
  const vs = await vehicles.list();
  if (!vs.length) {
    view.innerHTML = `<div class="card"><h2>Inga fordon</h2><p class="muted">${me.role === 'admin' ? 'Lägg till fordon under Admin.' : 'Administratören har inte lagt in några fordon än.'}</p></div>`;
    return;
  }
  const existing = id ? await trips.get(id) : null;
  const vId = existing?.vehicle_id || (vs.some(v => v.id === lastVehicle) ? lastVehicle : vs[0].id);
  let last = existing ? null : await vehicles.last(vId);
  const t = existing || { trip_date: today(), vehicle_id: vId, start_odo: last.last_odo, end_odo: '', from_place: last.last_place, to_place: '', purpose: '', visited: '', note: '', trip_type: 'tjanst' };
  const canDelete = existing && me.role === 'admin';

  view.innerHTML = `
    <form class="card" id="tf">
      <h2>${existing ? 'Redigera resa' : 'Ny resa'}</h2>
      ${existing && existing.driver ? `<p class="muted">Förare: ${esc(existing.driver.full_name)}</p>` : ''}
      <div class="seg">
        <input type="radio" name="trip_type" id="tTj" value="tjanst" ${t.trip_type === 'tjanst' ? 'checked' : ''}><label for="tTj">Tjänst</label>
        <input type="radio" name="trip_type" id="tPr" value="privat" ${t.trip_type === 'privat' ? 'checked' : ''}><label for="tPr">Privat</label>
      </div>
      <div class="grid2">
        <div><label>Datum</label><input type="date" name="trip_date" value="${t.trip_date}" required></div>
        <div><label>Fordon</label><select name="vehicle_id">${vs.map(v => `<option value="${v.id}" ${v.id === t.vehicle_id ? 'selected' : ''}>${esc(v.reg_no)}${v.name ? ' – ' + esc(v.name) : ''}</option>`).join('')}</select></div>
      </div>
      <div class="grid2">
        <div><label>Mätare start (km)</label><input type="number" inputmode="numeric" name="start_odo" value="${t.start_odo}" required min="0"></div>
        <div><label>Mätare slut (km)</label><input type="number" inputmode="numeric" name="end_odo" value="${t.end_odo}" required min="0"></div>
      </div>
      <div class="muted" id="dist"></div>
      <div class="warn-text" id="gap"></div>
      <label>Från</label><input name="from_place" value="${esc(t.from_place)}" placeholder="Startadress" required>
      <label>Till</label><input name="to_place" value="${esc(t.to_place)}" placeholder="Resmål" required>
      <div class="biz">
        <label>Ärende / syfte</label><input name="purpose" value="${esc(t.purpose)}" placeholder="T.ex. kundbesök, leverans">
        <label>Besökt företag/person</label><input name="visited" value="${esc(t.visited)}">
      </div>
      <label>Anteckning</label><input name="note" value="${esc(t.note)}">
      <div class="err" id="err"></div>
      <button class="btn block" id="save">${existing ? 'Spara ändringar' : 'Spara resa'}</button>
      ${existing ? '<button type="button" class="btn ghost block" id="cancel">Avbryt</button>' : ''}
      ${canDelete ? '<button type="button" class="btn danger block" id="del">Ta bort resa</button>' : ''}
    </form>`;

  const f = document.getElementById('tf');
  const upd = () => {
    const d = Number(f.end_odo.value) - Number(f.start_odo.value);
    document.getElementById('dist').textContent = f.end_odo.value ? `Körsträcka: ${km(d)} km` : '';
    document.getElementById('gap').textContent = last && f.start_odo.value && Number(f.start_odo.value) !== Number(last.last_odo)
      ? `Obs: senaste registrerade mätarställning för fordonet är ${km(last.last_odo)} km.` : '';
    f.querySelector('.biz').hidden = f.trip_type.value !== 'tjanst';
  };
  f.oninput = upd; upd();
  f.vehicle_id.onchange = async () => {
    if (existing) return;
    try { last = await vehicles.last(f.vehicle_id.value); f.start_odo.value = last.last_odo; f.from_place.value = last.last_place; upd(); } catch {}
  };
  const cancel = document.getElementById('cancel'); if (cancel) cancel.onclick = () => go(me.role === 'admin' && existing.driver_id !== me.id ? 'report' : 'trips');

  f.onsubmit = async e => {
    e.preventDefault();
    const err = document.getElementById('err'); err.textContent = '';
    const d = Object.fromEntries(new FormData(f));
    const rec = {
      trip_date: d.trip_date, vehicle_id: d.vehicle_id, trip_type: d.trip_type,
      start_odo: Number(d.start_odo), end_odo: Number(d.end_odo),
      from_place: d.from_place.trim(), to_place: d.to_place.trim(),
      purpose: d.trip_type === 'tjanst' ? d.purpose.trim() : '', visited: d.trip_type === 'tjanst' ? d.visited.trim() : '',
      note: d.note.trim()
    };
    if (rec.end_odo <= rec.start_odo) return err.textContent = 'Mätarställning slut måste vara större än start.';
    if (rec.trip_type === 'tjanst' && !rec.purpose) return err.textContent = 'Ärende krävs för tjänsteresor (Skatteverkets krav).';
    const btn = document.getElementById('save'); btn.disabled = true;
    try {
      if (existing) await trips.update(existing.id, rec); else await trips.insert(rec);
      try { localStorage.setItem('kj-last-vehicle', rec.vehicle_id); } catch {}
      lastVehicle = rec.vehicle_id;
      toast('Resan sparad');
      go(existing && me.role === 'admin' && existing.driver_id !== me.id ? 'report' : 'trips');
    } catch (ex) {
      if (!existing && isNetworkError(ex)) {
        queue.add(rec); toast('Ingen anslutning – resan skickas när du har nät'); go('trips'); return;
      }
      err.textContent = errMsg(ex); btn.disabled = false;
    }
  };
  const del = document.getElementById('del');
  if (del) del.onclick = async () => {
    if (!confirm('Ta bort resan permanent?')) return;
    try { await trips.remove(existing.id); toast('Resan borttagen'); go('report'); } catch (ex) { toast(errMsg(ex), true); }
  };
};

// ---------- Profil ----------
routes.profile = async () => {
  view.innerHTML = `
    <div class="card"><h2>Profil</h2>
      <p><b>${esc(me.full_name)}</b><br><span class="muted">${esc(me.email)}</span></p>
      <p class="muted">Roll: ${me.role === 'admin' ? 'Administratör' : 'Förare'}</p>
    </div>
    <form class="card" id="pw"><h2>Byt lösenord</h2>
      <label>Nytt lösenord</label><input type="password" name="pw" minlength="6" required autocomplete="new-password">
      <button class="btn block">Byt lösenord</button></form>
    <button class="btn ghost block" id="out">Logga ut</button>
    <p class="muted center" style="margin-top:20px">${installHint()}</p>`;
  document.getElementById('out').onclick = logout;
  document.getElementById('pw').onsubmit = async e => {
    e.preventDefault();
    try { await auth.updatePassword(e.target.pw.value); e.target.reset(); toast('Lösenordet är bytt'); } catch (ex) { toast(errMsg(ex), true); }
  };
};
const installHint = () => matchMedia('(display-mode: standalone)').matches ? 'Appen är installerad.'
  : /iphone|ipad/i.test(navigator.userAgent) ? 'Installera: tryck Dela → "Lägg till på hemskärmen".'
  : 'Installera: webbläsarens meny → "Installera app".';

// ---------- Admin ----------
routes.admin = async () => {
  const [ps, vs] = await Promise.all([profiles.list(), vehicles.list(true)]);
  const pending = ps.filter(p => p.status === 'pending');
  const statusLbl = { pending: 'Väntar', approved: 'Godkänd', blocked: 'Spärrad' };
  view.innerHTML = `
    ${pending.length ? `<div class="card warn"><h2>Väntar på godkännande (${pending.length})</h2>
      ${pending.map(p => `<div class="row item"><div><b>${esc(p.full_name || '–')}</b><div class="muted">${esc(p.email)}</div></div>
        <div class="actions"><button class="btn small" data-approve="${p.id}">Godkänn</button><button class="btn small danger" data-block="${p.id}">Neka</button></div></div>`).join('')}
    </div>` : ''}

    <div class="card"><h2>Förare</h2>
      ${ps.filter(p => p.status !== 'pending').map(p => `<div class="row item"><div><b>${esc(p.full_name || '–')}</b>
        <div class="muted">${esc(p.email)} · ${statusLbl[p.status]}${p.role === 'admin' ? ' · Admin' : ''}</div></div>
        ${p.id === me.id ? '' : `<select data-act="${p.id}" class="small-select">
          <option value="">Åtgärd…</option>
          ${p.status === 'blocked' ? '<option value="approve">Återaktivera</option>' : '<option value="block">Spärra</option>'}
          ${p.role === 'admin' ? '<option value="driver">Gör till förare</option>' : '<option value="admin">Gör till admin</option>'}
          <option value="rename">Byt namn</option>
        </select>`}</div>`).join('')}
    </div>

    <div class="card"><h2>Fordon</h2>
      ${vs.map(v => `<div class="row item ${v.active ? '' : 'inactive'}"><div><b>${esc(v.reg_no)}</b> <span class="muted">${esc(v.name)}</span>
        <div class="muted">Startmätare ${km(v.start_odometer)} km${v.active ? '' : ' · Inaktivt'}</div></div>
        <div class="actions"><button class="btn small ghost" data-vedit="${v.id}">Ändra</button>
        <button class="btn small ghost" data-vtoggle="${v.id}">${v.active ? 'Inaktivera' : 'Aktivera'}</button>
        <button class="btn small danger" data-vdel="${v.id}">Ta bort</button></div></div>`).join('') || '<p class="muted">Inga fordon än.</p>'}
      <form id="vf" class="addform">
        <h2 style="margin-top:16px">Lägg till fordon</h2>
        <div class="grid2"><div><label>Regnr</label><input name="reg_no" required placeholder="ABC123"></div>
        <div><label>Benämning</label><input name="name" placeholder="T.ex. Volvo V70"></div></div>
        <label>Aktuell mätarställning (km)</label><input type="number" inputmode="numeric" name="start_odometer" min="0" required>
        <button class="btn block">Lägg till fordon</button>
      </form>
    </div>`;

  const act = async (fn, msg) => { try { await fn(); toast(msg); go('admin'); } catch (e) { toast(errMsg(e), true); } };
  view.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => act(() => profiles.update(b.dataset.approve, { status: 'approved' }), 'Föraren är godkänd'));
  view.querySelectorAll('[data-block]').forEach(b => b.onclick = () => confirm('Neka/spärra kontot?') && act(() => profiles.update(b.dataset.block, { status: 'blocked' }), 'Kontot är spärrat'));
  view.querySelectorAll('[data-act]').forEach(s => s.onchange = () => {
    const id = s.dataset.act, p = ps.find(x => x.id === id);
    const a = s.value; s.value = '';
    if (a === 'approve') act(() => profiles.update(id, { status: 'approved' }), 'Återaktiverad');
    if (a === 'block' && confirm(`Spärra ${p.full_name}?`)) act(() => profiles.update(id, { status: 'blocked' }), 'Spärrad');
    if (a === 'admin' && confirm(`Ge ${p.full_name} administratörsbehörighet?`)) act(() => profiles.update(id, { role: 'admin' }), 'Nu admin');
    if (a === 'driver') act(() => profiles.update(id, { role: 'driver' }), 'Nu förare');
    if (a === 'rename') { const n = prompt('Nytt namn', p.full_name); if (n?.trim()) act(() => profiles.update(id, { full_name: n.trim() }), 'Namn ändrat'); }
  });
  view.querySelectorAll('[data-vtoggle]').forEach(b => b.onclick = () => {
    const v = vs.find(x => x.id === b.dataset.vtoggle);
    act(() => vehicles.update(v.id, { active: !v.active }), v.active ? 'Fordonet inaktiverat' : 'Fordonet aktiverat');
  });
  view.querySelectorAll('[data-vdel]').forEach(b => b.onclick = async () => {
    const v = vs.find(x => x.id === b.dataset.vdel);
    if (!confirm(`Ta bort ${v.reg_no} permanent? Det går inte att ångra.`)) return;
    try { await vehicles.remove(v.id); toast('Fordonet borttaget'); go('admin'); }
    catch (e) { toast(/foreign key|violates/i.test(e.message) ? `${v.reg_no} har resor och kan inte tas bort. Inaktivera i stället.` : errMsg(e), true); }
  });
  view.querySelectorAll('[data-vedit]').forEach(b => b.onclick = () => {
    const v = vs.find(x => x.id === b.dataset.vedit);
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<form class="box"><h2>Ändra ${esc(v.reg_no)}</h2>
      <label>Benämning</label><input name="name" value="${esc(v.name)}">
      <label>Startmätare (km)</label><input type="number" inputmode="numeric" name="start_odometer" min="0" value="${v.start_odometer}" required>
      <div class="err" id="verr"></div>
      <div class="btnrow"><button type="button" class="btn ghost" id="vcan">Avbryt</button><button class="btn">Spara</button></div></form>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.onclick = e => { if (e.target === m) close(); };
    m.querySelector('#vcan').onclick = close;
    m.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      try {
        await vehicles.update(v.id, { name: d.name.trim(), start_odometer: Number(d.start_odometer) });
        close(); toast('Fordonet uppdaterat'); go('admin');
      } catch (ex) { m.querySelector('#verr').textContent = errMsg(ex); }
    };
  });
  document.getElementById('vf').onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    act(() => vehicles.add({ reg_no: d.reg_no.toUpperCase().replace(/[\s-]/g, ''), name: d.name.trim(), start_odometer: Number(d.start_odometer) }), 'Fordonet tillagt');
  };
};

// ---------- Rapport ----------
const rf = { from: monthStart(), to: monthEnd(), vehicleId: '', driverId: '', type: '' };
let reportData = [];

routes.report = async () => {
  const [vs, ps] = await Promise.all([vehicles.list(true), profiles.list()]);
  reportData = await trips.list({ from: rf.from, to: rf.to, vehicleId: rf.vehicleId || undefined, driverId: rf.driverId || undefined, type: rf.type || undefined });

  const byVehicle = {};
  for (const t of reportData) {
    const k = t.vehicle?.reg_no || '?';
    byVehicle[k] ??= { tjanst: 0, privat: 0, n: 0 };
    byVehicle[k][t.trip_type] += t.distance; byVehicle[k].n++;
  }
  const tot = Object.values(byVehicle).reduce((a, v) => ({ tjanst: a.tjanst + v.tjanst, privat: a.privat + v.privat, n: a.n + v.n }), { tjanst: 0, privat: 0, n: 0 });

  view.innerHTML = `
    <div class="card no-print">
      <h2>Rapport</h2>
      <div class="grid2">
        <div><label>Från</label><input type="date" id="rFrom" value="${rf.from}"></div>
        <div><label>Till</label><input type="date" id="rTo" value="${rf.to}"></div>
      </div>
      <div class="quick">
        <button class="btn small ghost" data-q="month">Denna månad</button>
        <button class="btn small ghost" data-q="prev">Förra månaden</button>
        <button class="btn small ghost" data-q="year">I år</button>
      </div>
      <div class="grid3">
        <div><label>Fordon</label><select id="rVeh"><option value="">Alla</option>${vs.map(v => `<option value="${v.id}" ${v.id === rf.vehicleId ? 'selected' : ''}>${esc(v.reg_no)}</option>`).join('')}</select></div>
        <div><label>Förare</label><select id="rDrv"><option value="">Alla</option>${ps.filter(p => p.status !== 'pending').map(p => `<option value="${p.id}" ${p.id === rf.driverId ? 'selected' : ''}>${esc(p.full_name || p.email)}</option>`).join('')}</select></div>
        <div><label>Typ</label><select id="rType"><option value="">Alla</option><option value="tjanst" ${rf.type === 'tjanst' ? 'selected' : ''}>Tjänst</option><option value="privat" ${rf.type === 'privat' ? 'selected' : ''}>Privat</option></select></div>
      </div>
      <div class="grid2" style="margin-top:12px">
        <button class="btn" id="pdf" ${reportData.length ? '' : 'disabled'}>Skriv ut / PDF</button>
        <button class="btn ghost" id="csv" ${reportData.length ? '' : 'disabled'}>Excel (CSV)</button>
      </div>
    </div>

    <div class="stats no-print">
      <div><b>${km(tot.tjanst)}</b><span class="muted">km tjänst</span></div>
      <div><b>${km(tot.privat)}</b><span class="muted">km privat</span></div>
      <div><b>${tot.n}</b><span class="muted">resor</span></div>
    </div>

    <div class="no-print">${reportData.length ? reportData.map(tripCard).join('') : '<p class="muted center">Inga resor för valda filter.</p>'}</div>

    <section id="printArea" class="print-only">${printHTML(byVehicle, tot, vs, ps)}</section>`;

  const reload = () => go('report');
  const bind = (id, key) => document.getElementById(id).onchange = e => { rf[key] = e.target.value; reload(); };
  bind('rFrom', 'from'); bind('rTo', 'to'); bind('rVeh', 'vehicleId'); bind('rDrv', 'driverId'); bind('rType', 'type');
  view.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
    const d = new Date();
    if (b.dataset.q === 'month') { rf.from = monthStart(); rf.to = monthEnd(); }
    if (b.dataset.q === 'prev') { const p = new Date(d.getFullYear(), d.getMonth() - 1, 1).toLocaleDateString('sv-SE'); rf.from = p; rf.to = monthEnd(p); }
    if (b.dataset.q === 'year') { rf.from = `${d.getFullYear()}-01-01`; rf.to = `${d.getFullYear()}-12-31`; }
    reload();
  });
  view.querySelectorAll('.card[data-id]').forEach(c => c.onclick = () => go('new', c.dataset.id));
  document.getElementById('pdf').onclick = () => window.print();
  document.getElementById('csv').onclick = () => exportCSV(reportData);
};

function printHTML(byVehicle, tot, vs, ps) {
  const veh = rf.vehicleId ? vs.find(v => v.id === rf.vehicleId) : null;
  const drv = rf.driverId ? ps.find(p => p.id === rf.driverId) : null;
  const rows = [...reportData].sort((a, b) => (a.vehicle?.reg_no || '').localeCompare(b.vehicle?.reg_no || '') || a.trip_date.localeCompare(b.trip_date) || a.start_odo - b.start_odo);
  return `
    <header class="p-head">
      <h1>Körjournal – SmartLabs Ai™</h1><div class="p-small">Licensierad till Skånebutiken</div>
      <div>Period: <b>${rf.from} – ${rf.to}</b></div>
      <div>Fordon: ${veh ? esc(veh.reg_no + (veh.name ? ' ' + veh.name : '')) : 'Alla'} · Förare: ${drv ? esc(drv.full_name) : 'Alla'} · Typ: ${rf.type ? typeLabel(rf.type) : 'Alla'}</div>
      <div class="p-small">Utskriven ${new Date().toLocaleString('sv-SE')} av ${esc(me.full_name)}</div>
    </header>
    <table class="p-sum"><thead><tr><th>Fordon</th><th>Resor</th><th>Km tjänst</th><th>Km privat</th><th>Km totalt</th></tr></thead>
      <tbody>${Object.entries(byVehicle).map(([r, v]) => `<tr><td>${esc(r)}</td><td>${v.n}</td><td>${km(v.tjanst)}</td><td>${km(v.privat)}</td><td>${km(v.tjanst + v.privat)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Totalt</td><td>${tot.n}</td><td>${km(tot.tjanst)}</td><td>${km(tot.privat)}</td><td>${km(tot.tjanst + tot.privat)}</td></tr></tfoot></table>
    <table class="p-trips"><thead><tr><th>Datum</th><th>Fordon</th><th>Förare</th><th>Mätare start</th><th>Mätare slut</th><th>Km</th><th>Från</th><th>Till</th><th>Ärende / besökt</th><th>Typ</th></tr></thead>
      <tbody>${rows.map(t => `<tr><td>${t.trip_date}</td><td>${esc(t.vehicle?.reg_no)}</td><td>${esc(t.driver?.full_name)}</td><td>${km(t.start_odo)}</td><td>${km(t.end_odo)}</td><td>${km(t.distance)}</td><td>${esc(t.from_place)}</td><td>${esc(t.to_place)}</td><td>${esc(t.purpose)}${t.visited ? ' – ' + esc(t.visited) : ''}</td><td>${typeLabel(t.trip_type)}</td></tr>`).join('')}</tbody></table>
    <div class="p-sign"><div>Attesterad av: ______________________</div><div>Datum: ____________</div></div>`;
}

function exportCSV(list) {
  const head = ['Datum', 'Regnr', 'Fordon', 'Förare', 'Mätare start', 'Mätare slut', 'Km', 'Från', 'Till', 'Ärende', 'Besökt', 'Typ', 'Anteckning'];
  const rows = [...list].reverse().map(t => [t.trip_date, t.vehicle?.reg_no, t.vehicle?.name, t.driver?.full_name, t.start_odo, t.end_odo, t.distance,
    t.from_place, t.to_place, t.purpose, t.visited, typeLabel(t.trip_type), t.note]);
  const csv = '﻿' + [head, ...rows].map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `korjournal_${rf.from}_${rf.to}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- PWA ----------
let deferred;
const installBtn = document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; installBtn.hidden = false; });
installBtn.onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; installBtn.hidden = true; };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

auth.onChange(ev => { if (ev === 'SIGNED_OUT') { me = null; } if (ev === 'PASSWORD_RECOVERY') renderNewPassword(); });
boot();
