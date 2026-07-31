import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import { getFirestore, doc, setDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCmkI1PxYkj5yXJ2k-GBd4zwQ1Hw1K3H1w',
  authDomain: 'bw-fahrtkostenapp.firebaseapp.com',
  projectId: 'bw-fahrtkostenapp',
  storageBucket: 'bw-fahrtkostenapp.firebasestorage.app',
  messagingSenderId: '806301754050',
  appId: '1:806301754050:web:c9c2531613c3927cae515b'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));

let user = null;
let entries = [];
let distance = 75;
let profiles = [];
let journalLoaded = false;
let settingsLoaded = false;
let unsubscribeJournal = null;
let unsubscribeSettings = null;

const journalRef = () => doc(db, 'users', user.uid, 'days', '_journal');
const settingsRef = () => doc(db, 'users', user.uid, 'days', '_settings');
const courses = () => entries.filter((entry) => entry.type === 'lehrgang');

const labels = {
  s6hin: '§ 6 Hinfahrt',
  s6rueck: '§ 6 Rückfahrt',
  s6beide: '§ 6 Hin & zurück',
  urlaub: 'Urlaub',
  sonderurlaub: 'Sonderurlaub',
  lehrgang: 'Lehrgang § 3',
  fahrt: '§ 3 Fahrt',
  homo: 'Lehrgang HomO',
  uebung: 'Übungsplatz',
  dienstreise: 'Dienstreise',
  sonder: 'Sonderdienst',
  kzh: 'KZH',
  bwk: 'BWK',
  krankenfahrt: 'Krankenfahrt',
  familienheimfahrt: 'Familienheimfahrt',
  fvd: 'FvD genommen'
};

const label = (type) => labels[type] || type;
const fmtKm = (km) => `${Number(km || 0).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`;
const defaultProfile = () => profiles.find((profile) => profile.isDefault) || profiles[0] || null;

function activeOn(entry, date) {
  if (!entry?.from) return false;
  const to = entry.to || entry.from;
  if (date < entry.from || date > to) return false;
  return !(Array.isArray(entry.excludedDays) && entry.excludedDays.includes(date));
}

function overlaps(entry, from, to) {
  if (!entry?.from) return false;
  const end = entry.to || entry.from;
  return !(end < from || entry.from > to);
}

function toast(message = 'Gespeichert') {
  const element = $('toast');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  window.setTimeout(() => element.classList.remove('show'), 1600);
}

function openSheet(title, html) {
  $('title').textContent = title;
  $('body').innerHTML = html;
  $('sheetback').hidden = false;
}

function closeSheet() {
  $('sheetback').hidden = true;
  $('body').innerHTML = '';
}

async function saveJournal() {
  if (!user) throw new Error('Nicht angemeldet.');
  await setDoc(journalRef(), {
    entries: entries.map(clean),
    distance,
    updatedAt: serverTimestamp()
  });
  toast();
}

async function saveSettings() {
  if (!user) throw new Error('Nicht angemeldet.');
  await setDoc(settingsRef(), {
    commuteProfiles: profiles.map(clean),
    updatedAt: serverTimestamp()
  });
  toast('Profile gespeichert');
}

function detail(entry) {
  const parts = [];
  if (entry.title) parts.push(entry.title);
  if (entry.type === 'fahrt' && entry.tripKind) {
    parts.push({ anreise: 'Anreise', heimfahrt: 'Heimfahrt', rueckreise: 'Rückreise' }[entry.tripKind] || entry.tripKind);
  }
  return parts.join(' · ');
}

function renderRecommendation() {
  const box = $('recommendation');
  const button = $('recommendAction');
  const text = $('recommendText');
  const profile = defaultProfile();
  const today = iso(new Date());

  if (!box || !button || !text || !profile || entries.some((entry) => entry.type?.startsWith('s6') && entry.from === today)) {
    if (box) box.hidden = true;
    return;
  }

  const last = entries
    .filter((entry) => entry.type?.startsWith('s6'))
    .sort((a, b) => String(b.from).localeCompare(String(a.from)))[0];

  let type = 's6beide';
  let caption = `${profile.name}: Hin & zurück (${fmtKm(profile.km * 2)})`;

  if (last?.type === 's6hin') {
    type = 's6rueck';
    caption = `${profile.name}: Rückfahrt (${fmtKm(profile.km)})`;
  } else if (last?.type === 's6rueck') {
    type = 's6hin';
    caption = `${profile.name}: Hinfahrt (${fmtKm(profile.km)})`;
  }

  text.textContent = caption;
  button.onclick = () => addEntry(type, today, today, {
    km: profile.km * (type === 's6beide' ? 2 : 1),
    title: profile.name
  });
  box.hidden = false;
}

function render() {
  const now = new Date();
  const today = iso(now);
  const hour = now.getHours();
  const firstName = (user?.displayName || '').split(' ')[0];
  const profile = defaultProfile();

  $('greeting').textContent = `Guten ${hour < 11 ? 'Morgen' : hour < 18 ? 'Tag' : 'Abend'}${firstName ? `, ${firstName}` : ''}`;
  $('date').textContent = now.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
  $('driveHint').textContent = profile ? `${profile.name} · ${fmtKm(profile.km)} einfach` : 'Bitte zuerst ein Fahrtprofil anlegen';

  const todayEntries = entries
    .filter((entry) => activeOn(entry, today))
    .sort((a, b) => String(a.type).localeCompare(String(b.type), 'de'));

  $('status').textContent = todayEntries.length ? 'Heute erfasst' : 'Heute offen';
  $('sync').textContent = journalLoaded
    ? `${entries.length} Einträge · synchronisiert`
    : 'Daten werden geladen …';

  $('today').innerHTML = todayEntries.length
    ? todayEntries.map((entry) => `
      <div class="todayItem">
        <span>
          <strong>${esc(label(entry.type))}</strong>
          <small>${esc(detail(entry) || 'Dienstlicher Eintrag')}</small>
        </span>
        <span class="todayMeta">
          ${Number(entry.km) > 0 ? fmtKm(entry.km) : ''}
          <button class="editLink" data-edit="${esc(entry.id)}">Bearbeiten</button>
        </span>
      </div>`).join('')
    : '<span class="muted">Noch keine Einträge für heute.</span>';

  document.querySelectorAll('[data-edit]').forEach((button) => {
    button.onclick = () => {
      location.href = `calendar.html?edit=${encodeURIComponent(button.dataset.edit)}`;
    };
  });

  renderRecommendation();
}

async function addEntry(type, from = iso(new Date()), to = from, extra = {}) {
  if (!from) return;
  to = to || from;

  if (to < from) {
    openSheet('Datum prüfen', '<div class="warn"><strong>Das Bis-Datum liegt vor dem Von-Datum.</strong></div>');
    return;
  }

  const existing = entries.filter((entry) => overlaps(entry, from, to));
  if (existing.length) {
    const exact = existing.some((entry) => entry.type === type && entry.from === from && (entry.to || entry.from) === to);
    const items = existing.slice(0, 10).map((entry) => `<li>${esc(label(entry.type))}${entry.title ? ` · ${esc(entry.title)}` : ''}</li>`).join('');

    openSheet(exact ? 'Möglicher Doppeleintrag' : 'Tag bereits belegt', `
      <div class="warn">
        <strong>${exact ? 'Ein gleichartiger Eintrag besteht bereits.' : 'Im gewählten Zeitraum bestehen bereits Einträge.'}</strong>
        <ul>${items}</ul>
      </div>
      <div class="actions" style="margin-top:10px">
        <button id="cancelDup" class="btn">Abbrechen</button>
        <button id="saveDup" class="btn primary">Trotzdem speichern</button>
      </div>`);

    $('cancelDup').onclick = closeSheet;
    $('saveDup').onclick = () => commitEntry(type, from, to, extra);
    return;
  }

  await commitEntry(type, from, to, extra);
}

async function commitEntry(type, from, to, extra) {
  entries.push(clean({
    id: Date.now(),
    type,
    from,
    to,
    title: extra.title || '',
    km: extra.km,
    courseId: extra.courseId,
    tripKind: extra.tripKind,
    note: '',
    dayTypes: type === 'uebung' ? {} : undefined
  }));

  try {
    await saveJournal();
    render();
    closeSheet();
  } catch (error) {
    entries.pop();
    openSheet('Speichern fehlgeschlagen', `<div class="warn">${esc(error.message)}</div>`);
  }
}

function openDrive() {
  const profile = defaultProfile();
  if (!profile) {
    openProfiles(true);
    return;
  }

  openSheet('§ 6 Fahrt erfassen', `
    <div class="form">
      <div class="field">
        <label>Fahrtprofil</label>
        <select id="driveProfile">
          ${profiles.map((item) => `<option value="${esc(item.id)}"${item.id === profile.id ? ' selected' : ''}>${esc(item.name)} · ${fmtKm(item.km)} einfach</option>`).join('')}
        </select>
      </div>
      <div class="actions">
        <button class="btn" data-trip="s6hin">Hinfahrt</button>
        <button class="btn" data-trip="s6rueck">Rückfahrt</button>
        <button class="btn primary" data-trip="s6beide">Hin & zurück</button>
        <button class="btn" id="family">Familienheimfahrt</button>
      </div>
      <button id="manageProfiles" class="btn wide">Fahrtprofile verwalten</button>
    </div>`);

  document.querySelectorAll('[data-trip]').forEach((button) => {
    button.onclick = () => {
      const selected = profiles.find((item) => item.id === $('driveProfile').value);
      if (!selected) return;
      const type = button.dataset.trip;
      addEntry(type, undefined, undefined, {
        km: selected.km * (type === 's6beide' ? 2 : 1),
        title: selected.name
      });
    };
  });

  $('family').onclick = () => openKmForm('familienheimfahrt', 'Familienheimfahrt');
  $('manageProfiles').onclick = () => openProfiles();
}

function openKmForm(type, title) {
  openSheet(title, `
    <div class="form">
      <div class="field">
        <label>Kilometer</label>
        <input id="km" type="number" min="0" step="0.1" inputmode="decimal">
      </div>
      <button id="kms" class="btn primary wide">Heute speichern</button>
    </div>`);
  $('kms').onclick = () => addEntry(type, undefined, undefined, { km: Number($('km').value) || 0 });
}

function openCourse() {
  const availableCourses = courses();
  if (!availableCourses.length) {
    openSheet('Lehrgang', '<p class="muted">Noch kein Lehrgang angelegt.</p><a class="btn primary wide" style="display:grid;place-items:center" href="calendar.html">Neuen Lehrgang im Kalender anlegen</a>');
    return;
  }

  openSheet('Lehrgang', `
    <div class="form">
      <div class="field">
        <label>Lehrgang</label>
        <select id="course">
          ${availableCourses.map((course) => `<option value="${course.id}">${esc(course.title || 'Lehrgang')}</option>`).join('')}
        </select>
      </div>
      <div class="actions">
        <button class="btn" data-course="anreise">Anreise</button>
        <button class="btn" data-course="heimfahrt">Heimfahrt</button>
        <button class="btn" data-course="rueckreise">Rückreise</button>
        <button class="btn" data-course="homo">HomO heute</button>
      </div>
    </div>`);

  document.querySelectorAll('[data-course]').forEach((button) => {
    button.onclick = () => {
      const course = availableCourses.find((item) => String(item.id) === String($('course').value));
      if (!course) return;
      const kind = button.dataset.course;
      if (kind === 'homo') {
        addEntry('homo', undefined, undefined, { courseId: course.id, title: course.title });
      } else {
        addEntry('fahrt', undefined, undefined, {
          courseId: course.id,
          tripKind: kind,
          km: (Number(course.distance) || 0) * (kind === 'heimfahrt' ? 2 : 1),
          title: course.title
        });
      }
    };
  });
}

function openDuty() {
  openSheet('Dienst', `
    <div class="actions">
      <button class="btn" data-duty="uebung">Übungsplatz</button>
      <button class="btn" data-duty="dienstreise">Dienstreise</button>
      <button class="btn" data-duty="sonder">Sonderdienst heute</button>
      <button class="btn" id="dutyPeriod">Zeitraum</button>
    </div>`);

  document.querySelectorAll('[data-duty]').forEach((button) => {
    button.onclick = () => button.dataset.duty === 'sonder'
      ? addEntry('sonder')
      : openPeriod(button.dataset.duty);
  });
  $('dutyPeriod').onclick = () => openPeriod('uebung');
}

function openAbsence() {
  openSheet('Abwesenheit', `
    <div class="actions">
      <button class="btn" data-absence="urlaub">Urlaub</button>
      <button class="btn" data-absence="sonderurlaub">Sonderurlaub</button>
    </div>`);
  document.querySelectorAll('[data-absence]').forEach((button) => {
    button.onclick = () => openPeriod(button.dataset.absence);
  });
}

function openMore() {
  openSheet('Weitere Vorgänge', `
    <div class="actions">
      <button class="btn" data-more="kzh">KZH heute</button>
      <button class="btn" data-more="bwk">BWK heute</button>
      <button class="btn" data-more="krankenfahrt">Krankenfahrt</button>
      <button class="btn" data-more="fvd">FvD genommen</button>
    </div>`);
  document.querySelectorAll('[data-more]').forEach((button) => {
    button.onclick = () => button.dataset.more === 'krankenfahrt'
      ? openKmForm('krankenfahrt', 'Krankenfahrt')
      : addEntry(button.dataset.more);
  });
}

function openPeriod(defaultType = 'urlaub') {
  const types = [
    ['urlaub', 'Urlaub'],
    ['sonderurlaub', 'Sonderurlaub'],
    ['uebung', 'Übungsplatz'],
    ['dienstreise', 'Dienstreise'],
    ['sonder', 'Sonderdienst'],
    ['kzh', 'KZH'],
    ['bwk', 'BWK']
  ];

  openSheet('Zeitraum erfassen', `
    <div class="form">
      <div class="field"><label>Art</label><select id="periodType">${types.map(([value, text]) => `<option value="${value}"${value === defaultType ? ' selected' : ''}>${text}</option>`).join('')}</select></div>
      <div class="field"><label>Von</label><input id="periodFrom" type="date" value="${iso(new Date())}"></div>
      <div class="field"><label>Bis</label><input id="periodTo" type="date" value="${iso(new Date())}"></div>
      <div class="field"><label>Bezeichnung / Ort</label><input id="periodTitle"></div>
      <button id="periodSave" class="btn primary wide">Speichern</button>
    </div>`);

  $('periodSave').onclick = () => addEntry(
    $('periodType').value,
    $('periodFrom').value,
    $('periodTo').value || $('periodFrom').value,
    { title: $('periodTitle').value.trim() }
  );
}

function openProfiles(firstSetup = false) {
  openSheet('§ 6 Fahrtprofile', `
    <p class="muted">Ein Profil enthält die einfache Strecke. Hin und zurück wird automatisch verdoppelt.</p>
    <div id="profileList" class="profileList"></div>
    <div class="form" style="margin-top:12px">
      <div class="field"><label>Bezeichnung</label><input id="profileName" placeholder="z. B. Stammdienststelle"></div>
      <div class="field"><label>Einfache Strecke in km</label><input id="profileKm" type="number" min="0" step="0.1" inputmode="decimal"></div>
      <button id="profileAdd" class="btn primary wide">Profil hinzufügen</button>
      ${firstSetup ? '<a class="btn wide" style="display:grid;place-items:center" href="calendar.html">Ohne Profil zum Kalender</a>' : ''}
    </div>`);

  renderProfiles();
  $('profileAdd').onclick = async () => {
    const name = $('profileName').value.trim();
    const km = Number($('profileKm').value);
    if (!name || !(km > 0)) {
      alert('Bitte Bezeichnung und Entfernung angeben.');
      return;
    }
    profiles.push({ id: String(Date.now()), name, km, isDefault: profiles.length === 0 });
    try {
      await saveSettings();
      openProfiles();
      render();
    } catch (error) {
      alert(`Profil konnte nicht gespeichert werden: ${error.message}`);
    }
  };
}

function renderProfiles() {
  const box = $('profileList');
  if (!box) return;

  box.innerHTML = profiles.length
    ? profiles.map((profile) => `
      <div class="profile">
        <div class="profileHead"><span><strong>${esc(profile.name)}</strong><br><small>${fmtKm(profile.km)} einfach${profile.isDefault ? ' · Standard' : ''}</small></span></div>
        <div class="profileActions">
          ${profile.isDefault ? '' : `<button class="btn" data-default="${esc(profile.id)}">Als Standard</button>`}
          <button class="btn" data-delete="${esc(profile.id)}">Löschen</button>
        </div>
      </div>`).join('')
    : '<p class="muted">Noch kein Fahrtprofil vorhanden.</p>';

  document.querySelectorAll('[data-default]').forEach((button) => {
    button.onclick = async () => {
      profiles = profiles.map((profile) => ({ ...profile, isDefault: profile.id === button.dataset.default }));
      await saveSettings();
      openProfiles();
      render();
    };
  });

  document.querySelectorAll('[data-delete]').forEach((button) => {
    button.onclick = async () => {
      if (!confirm('Dieses Fahrtprofil löschen?')) return;
      profiles = profiles.filter((profile) => profile.id !== button.dataset.delete);
      if (profiles.length && !profiles.some((profile) => profile.isDefault)) profiles[0].isDefault = true;
      await saveSettings();
      openProfiles();
      render();
    };
  });
}

function maybeShowSetup() {
  if (!user || !settingsLoaded || profiles.length || localStorage.getItem('skipCommuteSetup')) return;
  $('setup').hidden = false;
}

$('setupSave').onclick = async () => {
  const name = $('setupName').value.trim();
  const km = Number($('setupKm').value);
  if (!name || !(km > 0)) {
    alert('Bitte eine Bezeichnung und die einfache Strecke angeben.');
    return;
  }
  profiles = [{ id: String(Date.now()), name, km, isDefault: true }];
  try {
    await saveSettings();
    $('setup').hidden = true;
    render();
  } catch (error) {
    alert(`Fahrtprofil konnte nicht gespeichert werden: ${error.message}`);
  }
};

$('setupLater').onclick = () => {
  localStorage.setItem('skipCommuteSetup', '1');
  $('setup').hidden = true;
};

document.querySelectorAll('[data-q]').forEach((button) => {
  const actions = { drive: openDrive, course: openCourse, duty: openDuty, absence: openAbsence, more: openMore };
  button.onclick = actions[button.dataset.q];
});

$('period').onclick = () => openPeriod();
$('settings').onclick = () => openProfiles();
$('settingsBottom').onclick = () => openProfiles();
$('settingsSide').onclick = () => openProfiles();
$('close').onclick = closeSheet;
$('sheetback').onclick = (event) => {
  if (event.target === $('sheetback')) closeSheet();
};
$('signin').onclick = () => signInWithPopup(auth, provider).catch((error) => alert(error.message));

const logout = () => signOut(auth);
$('logout').onclick = logout;
$('sideLogout').onclick = logout;

onAuthStateChanged(auth, (currentUser) => {
  user = currentUser;
  $('login').hidden = Boolean(currentUser);

  if (unsubscribeJournal) unsubscribeJournal();
  if (unsubscribeSettings) unsubscribeSettings();
  unsubscribeJournal = null;
  unsubscribeSettings = null;

  if (!currentUser) return;

  journalLoaded = false;
  settingsLoaded = false;
  render();

  unsubscribeJournal = onSnapshot(
    journalRef(),
    (snapshot) => {
      const data = snapshot.data() || {};
      entries = Array.isArray(data.entries) ? data.entries : [];
      distance = Number(data.distance) || 75;
      journalLoaded = true;
      render();
    },
    (error) => {
      journalLoaded = false;
      $('sync').textContent = 'Synchronisationsfehler';
      $('today').innerHTML = `<span class="muted">${esc(error.message)}</span>`;
    }
  );

  unsubscribeSettings = onSnapshot(
    settingsRef(),
    (snapshot) => {
      const data = snapshot.data() || {};
      profiles = Array.isArray(data.commuteProfiles) ? data.commuteProfiles : [];
      settingsLoaded = true;
      render();
      maybeShowSetup();
    },
    () => {
      profiles = [];
      settingsLoaded = true;
      render();
      maybeShowSetup();
    }
  );
});
