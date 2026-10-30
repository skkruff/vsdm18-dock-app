// Switchboard editor. Edits the profile JSON files in the user's profile folder through the
// plugin's local API. Previews are drawn by the plugin's own renderer, so they match the dock.
'use strict';

const $ = sel => document.querySelector(sel);
const COLS = 5;
const SLOTS = 15;

const S = {
  files: [],
  file: null,
  profile: null,
  dirty: false,
  page: 0,
  selected: new Set(),
  previewValues: {}, // `${page}:${slot}` -> value typed in the inspector
  live: { profile: null, pageIndex: null, values: {} },
  sim: {},
  icons: [],
  inputs: [],
  library: [],
  clipboard: null,
  keypad: null, // the keypad layout, edited as a page of its own: { name, keys, builtIn, problems }
  kpDirty: false,
};
const KP = 'kp'; // S.page while the keypad layout is being edited

// ---------- helpers ----------

async function api(method, url, body) {
  const res = await fetch(url, {
    // X-Switchboard: the server only takes changes carrying it (blocks other websites).
    method, headers: { 'X-Switchboard': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

let statusTimer = null;
function status(msg, kind = '') {
  const el = $('#status');
  el.textContent = msg;
  el.className = `status show ${kind}`;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.className = 'status'; }, kind === 'bad' ? 8000 : 2500);
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === 'class') e.className = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}

const clone = o => JSON.parse(JSON.stringify(o));
const page = () => (S.page === KP ? S.keypad : S.profile.pages[S.page]);
const keys = () => (page().keys = page().keys || {});
const rc = slot => [Math.floor(slot / COLS), slot % COLS];
const slotOf = (r, c) => (r >= 0 && r < 3 && c >= 0 && c < COLS ? r * COLS + c : null);
const parseVal = v => (v === '' || v === undefined ? undefined : isNaN(Number(v)) ? v : Number(v));

function setDirty(d = true) {
  S.dirty = d;
  $('#dirty').hidden = !(S.dirty || S.kpDirty);
}

// An edit: to the keypad layout while its tab is open, otherwise to the profile.
function changed() {
  if (S.page === KP) { S.kpDirty = true; setDirty(S.dirty); } else setDirty(true);
  renderGrid();
}

// ---------- loading ----------

async function loadFiles(selectFile) {
  const { profiles, errors } = await api('GET', '/api/profiles');
  S.files = profiles;
  const sel = $('#profileSelect');
  sel.innerHTML = '';
  for (const p of profiles) {
    sel.append(el('option', { value: p.file }, p.error ? `${p.file} (unreadable)` : `${p.name || p.id} (${p.file})`));
  }
  if (errors.length) status(`Some profiles have problems: ${errors.join(' | ')}`, 'bad');
  const pick = selectFile || S.file || (profiles.find(p => p.id === S.sim.activeProfile) || profiles[0] || {}).file;
  if (pick) await openFile(pick);
}

async function openFile(file) {
  if (S.dirty && !confirm('Discard unsaved changes?')) { $('#profileSelect').value = S.file; return; }
  S.file = file;
  S.profile = await api('GET', `/api/profiles/${encodeURIComponent(file)}`);
  S.page = S.sim.activeProfile === S.profile.id ? Math.min(S.sim.pageIndex || 0, S.profile.pages.length - 1) : 0;
  S.selected.clear();
  $('#profileSelect').value = file;
  setDirty(false);
  renderAll();
}

// Drops empty optional tables the inspector creates while editing. Works in place: the open
// inspector holds references into the profile, and replacing it with a copy made later edits
// go to the copy nobody saves (user report 2026-10-28: a face layer stopped taking edits).
function clean(p) {
  for (const pg of p.pages || []) {
    for (const key of Object.values(pg.keys || {})) {
      if (key.sublabel === '') delete key.sublabel;
      for (const m of ['text', 'sublabels', 'valueIcons']) {
        if (key[m]) for (const [k, v] of Object.entries(key[m])) if (v === '') delete key[m][k];
        if (key[m] && !Object.keys(key[m]).length) delete key[m];
      }
      if (key.valueFaces && !Object.keys(key.valueFaces).length) delete key.valueFaces;
      for (const f of [key.face, ...Object.values(key.valueFaces || {})].filter(Boolean)) {
        for (const L of f.layers || []) if (L.sublabels) for (const [k, v] of Object.entries(L.sublabels)) if (v === '') delete L.sublabels[k];
      }
    }
  }
}

async function save() {
  if (S.kpDirty) {
    try {
      clean({ pages: [S.keypad] });
      const r = await api('PUT', '/api/keypad', { keys: S.keypad.keys });
      S.kpDirty = false;
      S.keypad.builtIn = false;
      S.keypad.problems = r.problems;
      setDirty(S.dirty);
      status(r.problems.length ? `Keypad saved, but: ${r.problems.join('; ')}` : 'Keypad saved: every keypad uses it now.', r.problems.length ? 'bad' : 'good');
      renderTabs();
    } catch (e) {
      return status(`Keypad not saved: ${e.message}`, 'bad');
    }
    if (!S.dirty) return;
  }
  try {
    clean(S.profile);
    await api('PUT', `/api/profiles/${encodeURIComponent(S.file)}`, S.profile);
    setDirty(false);
    status('Saved. The dock picks it up within a second.', 'good');
    loadFilesQuiet();
  } catch (e) {
    status(`Not saved: ${e.message}`, 'bad');
  }
}

async function loadFilesQuiet() {
  const { profiles } = await api('GET', '/api/profiles');
  S.files = profiles;
}

// ---------- header / sim status ----------

async function pollState() {
  try {
    bindLook();
  await loadLook();
  S.sim = await api('GET', '/api/state');
    const a = S.sim.aircraft || {};
    $('#simStatus').innerHTML = '';
    $('#simStatus').append(
      S.sim.connected ? el('span', { class: 'on' }, 'MSFS connected') : el('span', {}, 'MSFS not connected'),
      a.title ? ` · ${a.title}` : '',
      S.sim.activeProfile ? ` · profile in use: ${S.sim.activeProfile}` : '',
    );
    const live = await api('GET', '/api/live');
    // Redraw only when something on screen could have changed.
    const sig = JSON.stringify([live, S.sim.activeProfile, S.sim.connected]);
    S.live = live;
    if (sig !== S.lastSig) {
      S.lastSig = sig;
      renderTabs();
      renderGrid();
    }
  } catch (e) {
    $('#simStatus').textContent = 'Plugin not reachable (is VSD Craft running?)';
  }
}

function isLivePage() {
  return S.profile && S.live.profile === S.profile.id && S.live.pageIndex === S.page && !S.dirty;
}
