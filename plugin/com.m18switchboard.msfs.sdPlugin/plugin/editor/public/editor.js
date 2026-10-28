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
  presets: [],
  clipboard: null,
};

// ---------- helpers ----------

async function api(method, url, body) {
  const res = await fetch(url, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {},
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
const page = () => S.profile.pages[S.page];
const keys = () => (page().keys = page().keys || {});
const rc = slot => [Math.floor(slot / COLS), slot % COLS];
const slotOf = (r, c) => (r >= 0 && r < 3 && c >= 0 && c < COLS ? r * COLS + c : null);
const parseVal = v => (v === '' || v === undefined ? undefined : isNaN(Number(v)) ? v : Number(v));

function setDirty(d = true) {
  S.dirty = d;
  $('#dirty').hidden = !d;
}

function changed() {
  setDirty(true);
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

// Drops empty optional tables the inspector creates while editing.
function cleaned(profile) {
  const p = clone(profile);
  for (const pg of p.pages || []) {
    for (const key of Object.values(pg.keys || {})) {
      for (const m of ['text', 'valueIcons']) {
        if (key[m]) for (const [k, v] of Object.entries(key[m])) if (v === '') delete key[m][k];
        if (key[m] && !Object.keys(key[m]).length) delete key[m];
      }
    }
  }
  return p;
}

async function save() {
  try {
    S.profile = cleaned(S.profile);
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

// ---------- profile settings ----------

function renderSettings() {
  const p = S.profile;
  $('#pId').value = p.id || '';
  $('#pName').value = p.name || '';
  $('#pBanner1').value = (p.banner || [])[0] || '';
  $('#pBanner2').value = (p.banner || [])[1] || '';
  $('#pFallback').checked = !!p.fallback;
  $('#matchFields').disabled = !!p.fallback;
  const m = p.match || {};
  $('#mPath').value = (m.path || []).join('\n');
  $('#mTitle').value = (m.title || []).join('\n');
  $('#mAtc').value = (m.atcModel || []).join('\n');
}

function bindSettings() {
  const lines = v => v.split('\n').map(s => s.trim()).filter(Boolean);
  const upd = () => {
    const p = S.profile;
    p.id = $('#pId').value.trim();
    p.name = $('#pName').value;
    const banner = [$('#pBanner1').value.trim(), $('#pBanner2').value.trim()].filter(Boolean);
    if (banner.length) p.banner = banner; else delete p.banner;
    if ($('#pFallback').checked) { p.fallback = true; delete p.match; } else {
      delete p.fallback;
      p.match = {};
      for (const [field, id] of [['path', '#mPath'], ['title', '#mTitle'], ['atcModel', '#mAtc']]) {
        const l = lines($(id).value);
        if (l.length) p.match[field] = l;
      }
    }
    $('#matchFields').disabled = !!p.fallback;
    setDirty(true);
  };
  for (const id of ['#pId', '#pName', '#pBanner1', '#pBanner2', '#pFallback', '#mPath', '#mTitle', '#mAtc']) {
    $(id).addEventListener('input', upd);
  }
  $('#fillMatch').addEventListener('click', () => {
    const a = S.sim.aircraft || {};
    if (!a.title) return status('No aircraft loaded in MSFS', 'bad');
    // The aircraft's folder under SimObjects\Airplanes names it best.
    const m = /simobjects[\\/]+airplanes[\\/]+([^\\/]+)/i.exec(a.path || '');
    $('#mPath').value = m ? m[1].toLowerCase() : '';
    $('#mTitle').value = m ? '' : a.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    upd();
    status(m ? `Matches aircraft folder "${m[1]}"` : 'No file path known; matching the title instead');
  });
  $('#previewAnnouncement').addEventListener('click', async () => {
    const { images } = await api('POST', '/api/render-announcement', S.profile);
    showImages(images);
    setTimeout(renderGrid, 3000);
  });
}

// ---------- pages ----------

function renderTabs() {
  const tabs = $('#pageTabs');
  tabs.innerHTML = '';
  S.profile.pages.forEach((p, i) => {
    const onDock = S.live.profile === S.profile.id && S.live.pageIndex === i;
    tabs.append(el('div', {
      class: `tab ${i === S.page ? 'active' : ''}`,
      on: { click: () => { S.page = i; S.selected.clear(); renderAll(); } },
    }, p.name || `Page ${i + 1}`, i === 0 ? el('span', { class: 'muted' }, ' (main)') : null,
    onDock ? el('span', { class: 'ondock' }, '● on dock') : null));
  });
}

function bindPages() {
  $('#addPage').addEventListener('click', () => {
    const name = prompt('Page name', `Page ${S.profile.pages.length + 1}`);
    if (!name) return;
    S.profile.pages.push({ name, keys: {} });
    S.page = S.profile.pages.length - 1;
    S.selected.clear();
    setDirty(); renderAll();
  });
  $('#renamePage').addEventListener('click', () => {
    const name = prompt('Page name', page().name);
    if (!name) return;
    page().name = name;
    setDirty(); renderTabs();
  });
  $('#delPage').addEventListener('click', () => {
    if (S.profile.pages.length === 1) return status('A profile needs at least one page', 'bad');
    if (!confirm(`Delete page "${page().name}"?`)) return;
    S.profile.pages.splice(S.page, 1);
    S.page = Math.max(0, S.page - 1);
    setDirty(); renderAll();
  });
  const move = d => {
    const to = S.page + d;
    if (to < 0 || to >= S.profile.pages.length) return;
    const ps = S.profile.pages;
    [ps[S.page], ps[to]] = [ps[to], ps[S.page]];
    S.page = to;
    setDirty(); renderAll();
  };
  $('#movePageLeft').addEventListener('click', () => move(-1));
  $('#movePageRight').addEventListener('click', () => move(1));
  $('#showOnDock').addEventListener('click', async () => {
    if (S.dirty) return status('Save first, then show it on the dock', 'bad');
    try { await api('POST', '/api/show', { id: S.profile.id, page: S.page }); status('Showing on the dock', 'good'); } catch (e) { status(e.message, 'bad'); }
  });
}

// ---------- grid ----------

let renderSeq = 0;
async function renderGrid() {
  if (!S.profile) return;
  const seq = ++renderSeq;
  const k = keys();
  const live = isLivePage();
  const values = {};
  for (const slot of Object.keys(k)) {
    const typed = S.previewValues[`${S.page}:${slot}`];
    values[slot] = typed !== undefined && typed !== '' ? typed : live ? S.live.values[slot] : defaultPreview(k[slot]);
  }
  $('#liveNote').textContent = live ? 'Showing live values from the sim.' : '';
  const { images } = await api('POST', '/api/render', { keys: k, values });
  if (seq !== renderSeq) return;
  showImages(images);
}

// A value that shows the key in its "on" look when nothing else is known.
function defaultPreview(key) {
  if (!key) return undefined;
  const on = Object.entries(key.states || {}).find(([, s]) => s === 'on');
  if (on) return on[0];
  const firstText = Object.keys(key.text || key.valueIcons || {})[0];
  return firstText;
}

function showImages(images) {
  const grid = $('#grid');
  grid.innerHTML = '';
  for (let slot = 0; slot < SLOTS; slot++) {
    const has = !!keys()[slot];
    const cell = el('div', {
      class: `slot ${has ? '' : 'empty'} ${S.selected.has(slot) ? 'selected' : ''}`,
      draggable: has ? 'true' : null,
      'data-slot': slot,
      on: {
        click: e => select(slot, e.ctrlKey || e.metaKey || e.shiftKey),
        dragstart: e => { e.dataTransfer.setData('text/plain', String(slot)); },
        dragover: e => { e.preventDefault(); cell.classList.add('drop'); },
        dragleave: () => cell.classList.remove('drop'),
        drop: e => { e.preventDefault(); cell.classList.remove('drop'); moveKey(Number(e.dataTransfer.getData('text/plain')), slot); },
      },
    }, el('span', { class: 'num' }, String(slot)));
    if (images[slot]) cell.prepend(el('img', { src: images[slot], alt: '' }));
    grid.append(cell);
  }
}

function select(slot, add) {
  if (add) { if (S.selected.has(slot)) S.selected.delete(slot); else S.selected.add(slot); } else { S.selected.clear(); S.selected.add(slot); }
  renderGrid();
  renderInspector();
}

function moveKey(from, to) {
  if (from === to || Number.isNaN(from)) return;
  const k = keys();
  const a = k[from];
  const b = k[to];
  if (a) k[to] = a; else delete k[to];
  if (b) k[from] = b; else delete k[from];
  const pv = S.previewValues;
  [pv[`${S.page}:${from}`], pv[`${S.page}:${to}`]] = [pv[`${S.page}:${to}`], pv[`${S.page}:${from}`]];
  S.selected = new Set([to]);
  changed();
  renderInspector();
}

// ---------- copy / paste / presets ----------

// Keys of the selection, positioned relative to its top-left corner.
function selectionGroup() {
  const slots = [...S.selected].filter(s => keys()[s]).sort((a, b) => a - b);
  if (!slots.length) return null;
  const minR = Math.min(...slots.map(s => rc(s)[0]));
  const minC = Math.min(...slots.map(s => rc(s)[1]));
  return slots.map(s => ({ dr: rc(s)[0] - minR, dc: rc(s)[1] - minC, key: clone(keys()[s]) }));
}

// Places a group with its top-left at the anchor slot. Keys that would fall off the panel are dropped.
function placeGroup(group, anchor, renameFrom, renameTo) {
  const [r0, c0] = rc(anchor);
  let placed = 0;
  for (const g of group) {
    const slot = slotOf(r0 + g.dr, c0 + g.dc);
    if (slot === null) continue;
    let key = clone(g.key);
    if (renameFrom) key = renameSource(key, renameFrom, renameTo);
    keys()[slot] = key;
    placed++;
  }
  if (placed < group.length) status(`${group.length - placed} key(s) did not fit and were left out`, 'bad');
  changed();
}

function renameSource(key, from, to) {
  if (key.read && key.read.input === from) key.read.input = to;
  if (key.read && key.read.var === from) key.read.var = to;
  if (key.press && key.press.input === from) key.press.input = to;
  return key;
}

function sourcesIn(group) {
  const set = new Set();
  for (const g of group) {
    if (g.key.read) set.add(g.key.read.input || g.key.read.var);
    if (g.key.press && g.key.press.input) set.add(g.key.press.input);
  }
  return [...set].filter(Boolean);
}

function copySel() {
  const g = selectionGroup();
  if (!g) return;
  S.clipboard = g;
  try { localStorage.setItem('switchboard.clipboard', JSON.stringify(g)); } catch { /* optional */ }
  status(`Copied ${g.length} key(s)`);
}

function paste() {
  let g = S.clipboard;
  if (!g) { try { g = JSON.parse(localStorage.getItem('switchboard.clipboard') || 'null'); } catch { g = null; } }
  if (!g || !S.selected.size) return;
  placeGroup(g, Math.min(...S.selected));
  renderInspector();
}

function deleteSel() {
  for (const s of S.selected) delete keys()[s];
  changed();
  renderInspector();
}

async function loadPresets() {
  S.presets = await api('GET', '/api/presets');
  renderPresets();
}

function renderPresets() {
  const list = $('#presetList');
  list.innerHTML = '';
  if (!S.presets.length) list.append(el('div', { class: 'muted' }, 'No presets yet. Select keys, then save them as a preset.'));
  S.presets.forEach((p, i) => list.append(el('div', { class: 'preset' },
    el('span', { class: 'name' }, `${p.name} `, el('span', { class: 'muted' }, `(${p.keys.length} keys)`)),
    el('button', { on: { click: () => insertPreset(p) } }, 'Insert at selected key'),
    el('button', { on: { click: async () => {
      if (!confirm(`Delete preset "${p.name}"?`)) return;
      S.presets.splice(i, 1);
      await api('PUT', '/api/presets', S.presets);
      renderPresets();
    } } }, '✕'))));
}

async function savePreset() {
  const g = selectionGroup();
  if (!g) return status('Select the keys to save first', 'bad');
  const name = prompt('Preset name', 'Magneto set');
  if (!name) return;
  S.presets.push({ name, keys: g });
  await api('PUT', '/api/presets', S.presets);
  renderPresets();
  status(`Saved preset "${name}"`, 'good');
}

function insertPreset(p) {
  if (!S.selected.size) return status('Click the key where the preset should start (its top-left)', 'bad');
  const sources = sourcesIn(p.keys);
  let from = null;
  let to = null;
  if (sources.length === 1) {
    const answer = prompt(`This preset uses "${sources[0]}". Use a different input event or simvar for this aircraft? (leave as is to keep)`, sources[0]);
    if (answer === null) return;
    if (answer && answer !== sources[0]) { from = sources[0]; to = answer; }
  }
  placeGroup(p.keys, Math.min(...S.selected), from, to);
  renderInspector();
}

// ---------- inspector ----------

function field(label, control, note) {
  return el('label', { class: 'field' }, el('span', {}, label), control, note ? el('span', {}) : null, note ? el('span', { class: 'muted' }, note) : null);
}

function input(value, onInput, attrs = {}) {
  return el('input', { value: value ?? '', ...attrs, on: { input: e => onInput(e.target.value) } });
}

function select_(options, value, onChange) {
  const s = el('select', { on: { change: e => onChange(e.target.value) } },
    options.map(([v, l]) => el('option', { value: v, selected: String(v) === String(value) ? true : null }, l)));
  return s;
}

function iconThumb(name) {
  return name ? el('img', { src: `/icons/${encodeURIComponent(name)}.png`, alt: name, onerror: "this.style.display='none'" }) : null;
}

// Editable table for a value -> something map (states, text, valueIcons).
function mapEditor(obj, render, empty) {
  const table = el('table', { class: 'map-table' });
  const draw = () => {
    table.innerHTML = '';
    table.append(el('tr', {}, el('td', { class: 'muted' }, 'sim value'), el('td', { class: 'muted' }, empty.label), el('td')));
    for (const [k, v] of Object.entries(obj)) {
      let current = k;
      table.append(el('tr', {},
        el('td', {}, input(k, nv => {
          if (nv === '' || nv === current || nv in obj) return;
          const val = obj[current];
          delete obj[current];
          obj[nv] = val;
          current = nv;
          changed();
        }, { style: 'width:70px' })),
        el('td', {}, render(v, nv => { obj[current] = nv; changed(); })),
        el('td', {}, el('button', { on: { click: () => { delete obj[current]; changed(); draw(); } } }, '✕'))));
    }
    table.append(el('tr', {}, el('td', { colspan: 3 }, el('button', { on: { click: () => {
      let n = 0;
      while (String(n) in obj) n++;
      obj[String(n)] = empty.value;
      changed(); draw();
    } } }, '+ value'))));
  };
  draw();
  return table;
}

function renderInspector() {
  const box = $('#inspector');
  box.innerHTML = '';
  if (!S.profile) return;
  const sel = [...S.selected];
  if (!sel.length) {
    box.append(el('h3', {}, 'No key selected'), el('p', { class: 'muted' }, 'Click a key on the dock picture to edit it.'));
    return;
  }
  if (sel.length > 1) {
    const g = selectionGroup() || [];
    const sources = sourcesIn(g);
    box.append(el('h3', {}, `${sel.length} keys selected`),
      el('p', { class: 'muted' }, 'Copy (Ctrl+C), delete, or save them as a preset.'));
    if (sources.length) {
      let from = sources[0];
      let to = '';
      box.append(el('h4', {}, 'Change the source of these keys'),
        field('Replace', select_(sources.map(s => [s, s]), from, v => { from = v; })),
        field('With', input('', v => { to = v; }, { list: 'inputList', placeholder: 'input event or simvar' })),
        el('button', { on: { click: () => {
          if (!to) return;
          for (const s of S.selected) if (keys()[s]) keys()[s] = renameSource(keys()[s], from, to);
          changed(); renderInspector();
        } } }, 'Replace'));
    }
    return;
  }
  const slot = sel[0];
  const key = keys()[slot];
  if (!key) {
    box.append(el('h3', {}, `Key ${slot}: empty`),
      el('button', { class: 'primary', on: { click: () => { keys()[slot] = { type: 'button', label: 'NEW' }; changed(); renderInspector(); } } }, 'Add a key here'),
      S.clipboard ? el('button', { on: { click: paste } }, ' Paste') : null);
    return;
  }

  const redraw = () => { changed(); renderInspector(); };
  box.append(el('h3', {}, `Key ${slot}`));

  box.append(field('Type', select_([['switch', 'Switch (on/off look)'], ['readout', 'Readout (live value)'], ['button', 'Button']], key.type, v => {
    key.type = v;
    if (v === 'switch' && !key.states) key.states = { 0: 'off', 1: 'on' };
    redraw();
  })));
  box.append(field('Label', el('textarea', { rows: 2, on: { input: e => { key.label = e.target.value; changed(); } } }, key.label || ''),
    'Shown on drawn tiles. A new line starts a second line.'));

  // Icon
  const iconMode = key.type === 'switch' ? 'switch' : 'any';
  box.append(field('Icon', el('div', { class: 'icon-chip' },
    iconThumb(key.icon ? (key.type === 'switch' ? `${key.icon}_on` : key.icon) : null),
    el('span', {}, key.icon || 'none (drawn tile)'),
    el('button', { on: { click: () => pickIcon(iconMode, name => { if (name) key.icon = name; else delete key.icon; redraw(); }) } }, 'Choose…')),
  key.type === 'switch' ? 'Switch icons use the icon\'s on / off / clear versions.'
    : key.type === 'readout' ? 'Drawn above the value, scaled to fit.' : null));

  // Source
  box.append(el('h4', {}, 'Reads from the sim'));
  const kind = !key.read ? 'none' : key.read.input !== undefined ? 'input' : 'var';
  box.append(field('Source', select_([['none', 'Nothing'], ['input', 'Input event'], ['var', 'Simvar']], kind, v => {
    if (v === 'none') delete key.read;
    else if (v === 'input') key.read = { input: '' };
    else key.read = { var: '', unit: 'number' };
    redraw();
  })));
  if (kind === 'input') {
    const inp = input(key.read.input, v => { key.read.input = v; changed(); }, { list: 'inputList', placeholder: 'e.g. ELECTRICAL_BATTERY_1' });
    box.append(field('Input event', el('div', { class: 'inline' }, inp,
      el('button', { title: 'Then move the control in the cockpit', on: { click: () => learnInto(inp, v => { key.read.input = v; redraw(); }) } }, 'Learn'))));
  } else if (kind === 'var') {
    box.append(field('Simvar', input(key.read.var, v => { key.read.var = v; changed(); }, { placeholder: 'e.g. KOHLSMAN SETTING MB:1' })));
    box.append(field('Unit', input(key.read.unit, v => { key.read.unit = v; changed(); }, { list: 'unitList' })));
  }

  // Look per value
  if (key.type === 'switch') {
    box.append(el('h4', {}, 'Look per value'));
    key.states = key.states || {};
    box.append(mapEditor(key.states, (v, set) => select_([['on', 'on (green)'], ['off', 'off (red)'], ['clear', 'clear (outline)']], v, set),
      { label: 'shows', value: 'off' }));
    box.append(field('Other values', select_([['', 'clear'], ['on', 'on'], ['off', 'off']], key.otherwise || '', v => { if (v) key.otherwise = v; else delete key.otherwise; changed(); })));
  }
  if (key.type !== 'button') {
    box.append(el('h4', {}, key.type === 'switch' ? 'Word under the label (drawn tiles)' : 'Text per value'));
    key.text = key.text || {};
    box.append(mapEditor(key.text, (v, set) => input(v, set), { label: 'text', value: '' }));
    box.append(el('h4', {}, 'Icon per value (replaces the whole key)'));
    key.valueIcons = key.valueIcons || {};
    box.append(mapEditor(key.valueIcons, (v, set) => el('div', { class: 'inline' }, iconThumb(v), el('span', {}, v || '—'),
      el('button', { on: { click: () => pickIcon('any', n => { set(n || ''); renderInspector(); }) } }, '…')), { label: 'icon', value: '' }));
  }
  if (key.type === 'readout') {
    box.append(field('Decimals', input(key.decimals, v => { if (v === '') delete key.decimals; else key.decimals = Number(v); changed(); }, { type: 'number', min: 0, max: 6 })));
    box.append(field('Pad to digits', input(key.pad, v => { if (v === '') delete key.pad; else key.pad = Number(v); changed(); }, { type: 'number', min: 0, max: 8 }), 'e.g. 4 shows 7 as 0007'));
  }

  // Press
  box.append(el('h4', {}, 'When pressed'));
  const p = key.press || {};
  const pkind = !key.press ? 'none' : p.event ? 'event' : p.cycle ? 'cycle' : p.step !== undefined ? 'step' : p.hold !== undefined ? 'hold' : p.set !== undefined ? 'set' : 'none';
  box.append(field('Action', select_([['none', 'Nothing'], ['cycle', 'Toggle / cycle values'], ['step', 'Step up or down'], ['hold', 'Hold (spring-loaded)'], ['set', 'Set a value'], ['event', 'Send a sim event']], pkind, v => {
    const target = p.input;
    key.press = { cycle: { cycle: [0, 1] }, step: { step: 1 }, hold: { hold: 1, release: 0 }, set: { set: 1 }, event: { event: '' } }[v];
    if (!key.press) delete key.press; else if (target) key.press.input = target;
    redraw();
  })));
  const num = v => (v === '' ? undefined : Number(v));
  const setP = (k, v) => { if (v === undefined || Number.isNaN(v)) delete key.press[k]; else key.press[k] = v; changed(); };
  if (pkind === 'cycle') box.append(field('Values in order', input(p.cycle.join(', '), v => { key.press.cycle = v.split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n)); changed(); }), 'e.g. 0, 1 toggles; the next value after the current one is set'));
  if (pkind === 'step') {
    box.append(field('Step', input(p.step, v => setP('step', num(v)), { type: 'number' }), '1 = up, -1 = down'));
    box.append(field('Minimum', input(p.min, v => setP('min', num(v)), { type: 'number' })));
    box.append(field('Maximum', input(p.max, v => setP('max', num(v)), { type: 'number' })));
  }
  if (pkind === 'hold') {
    box.append(field('While held', input(p.hold, v => setP('hold', num(v)), { type: 'number' })));
    box.append(field('On release', input(p.release, v => setP('release', num(v)), { type: 'number' })));
    box.append(field('Repeat every ms', input(p.repeatMs, v => setP('repeatMs', num(v)), { type: 'number', min: 0 }), 'Re-sends while held, for positions the aircraft drops (e.g. START). Empty = once.'));
  }
  if (pkind === 'set') box.append(field('Value', input(p.set, v => setP('set', num(v)), { type: 'number' })));
  if (pkind === 'event') {
    box.append(field('Event', input(p.event, v => { key.press.event = v; changed(); }, { placeholder: 'e.g. BAROMETRIC' })));
    box.append(field('Value', input(p.value, v => setP('value', num(v)), { type: 'number' })));
    box.append(field('Send 1/0 opposite of current', el('input', { type: 'checkbox', checked: p.toggleValue ? true : null, on: { change: e => setP('toggleValue', e.target.checked || undefined) } })));
  }
  if (['cycle', 'step', 'hold', 'set'].includes(pkind)) {
    box.append(field('Acts on', input(p.input, v => setP('input', v || undefined), { list: 'inputList', placeholder: key.read && key.read.input ? `(same as source: ${key.read.input})` : 'input event' })));
  }

  // Preview value
  box.append(el('h4', {}, 'Preview'));
  const pvKey = `${S.page}:${slot}`;
  box.append(field('Preview value', input(S.previewValues[pvKey], v => { S.previewValues[pvKey] = v; renderGrid(); }, { placeholder: isLivePage() ? 'live from sim' : `default: ${defaultPreview(key) ?? 'unknown'}` }),
    'Try values to see each look. Empty = live value (when this page is on the dock) or a default.'));

  // Raw JSON
  const raw = el('details', {}, el('summary', {}, 'Advanced: edit as JSON'));
  const ta = el('textarea', { class: 'json' }, JSON.stringify(key, null, 2));
  raw.append(ta, el('button', { on: { click: () => {
    try { keys()[slot] = JSON.parse(ta.value); redraw(); } catch (e) { status(`JSON error: ${e.message}`, 'bad'); }
  } } }, 'Apply JSON'));
  box.append(raw);
  box.append(el('p', {}, el('button', { on: { click: deleteSel } }, 'Delete this key')));
}

async function learnInto(inputEl, apply) {
  status('Learning: move the control in the cockpit now (30 s)…');
  inputEl.disabled = true;
  try {
    const { name, value } = await api('POST', '/api/learn');
    apply(name);
    status(`Learned ${name} (now ${value})`, 'good');
  } catch (e) {
    status(`Learn failed: ${e.message}`, 'bad');
  } finally {
    inputEl.disabled = false;
  }
}

// ---------- icon picker ----------

let pickCallback = null;
let pickMode = 'any';
function pickIcon(mode, cb) {
  pickCallback = cb;
  pickMode = mode;
  $('#iconSearch').value = '';
  drawIcons();
  $('#iconDialog').showModal();
  $('#iconSearch').focus();
}

function drawIcons() {
  const q = $('#iconSearch').value.trim().toLowerCase();
  let names;
  if (pickMode === 'switch') {
    // Bases that have on/off versions; show the "on" version.
    const bases = new Set(S.icons.filter(i => i.state === 'on').map(i => i.base));
    names = [...bases].map(b => ({ name: b, thumb: `${b}_on` }));
  } else {
    names = S.icons.map(i => ({ name: i.name, thumb: i.name }));
  }
  names = names.filter(n => !q || n.name.includes(q)).slice(0, 400);
  const grid = $('#iconGrid');
  grid.innerHTML = '';
  for (const n of names) {
    grid.append(el('div', { class: 'icon-cell', on: { click: () => { $('#iconDialog').close(); pickCallback(n.name); } } },
      el('img', { src: `/icons/${encodeURIComponent(n.thumb)}.png`, loading: 'lazy', alt: '' }), el('span', {}, n.name)));
  }
  if (!names.length) grid.append(el('p', { class: 'muted' }, 'No icons match.'));
}

// ---------- profiles: new / duplicate / delete ----------

function fileFor(id) {
  return `${id.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}.json`;
}

async function newProfile(base) {
  const id = prompt('Profile ID (short, e.g. baron-58)', base ? `${base.id}-copy` : '');
  if (!id) return;
  const file = fileFor(id);
  if (S.files.some(f => f.file === file)) return status(`${file} already exists`, 'bad');
  const profile = base ? { ...clone(base), id, name: `${base.name || base.id} (copy)` }
    : { id, name: id, match: { title: [id] }, pages: [{ name: 'Main', keys: {} }] };
  if (base && base.fallback) { delete profile.fallback; profile.match = { title: [id] }; }
  try {
    await api('PUT', `/api/profiles/${encodeURIComponent(file)}`, profile);
    setDirty(false);
    await loadFiles(file);
    $('#profileSettings').open = true;
    status(`Created ${file}. Set what it matches under Profile settings.`, 'good');
  } catch (e) { status(e.message, 'bad'); }
}

// ---------- wiring ----------

function renderAll() {
  renderSettings();
  renderTabs();
  renderGrid();
  renderInspector();
}

async function loadInputs() {
  try {
    const { inputs } = await api('GET', '/api/inputs');
    S.inputs = inputs;
    $('#inputList').innerHTML = '';
    for (const n of inputs) $('#inputList').append(el('option', { value: n }));
  } catch { /* sim may be away */ }
}

async function init() {
  bindSettings();
  bindPages();
  $('#profileSelect').addEventListener('change', e => openFile(e.target.value));
  $('#saveProfile').addEventListener('click', save);
  $('#newProfile').addEventListener('click', () => newProfile(null));
  $('#dupProfile').addEventListener('click', () => newProfile(S.profile));
  $('#delProfile').addEventListener('click', async () => {
    if (!confirm(`Delete ${S.file}? A .bak copy is kept in the profile folder.`)) return;
    await api('DELETE', `/api/profiles/${encodeURIComponent(S.file)}`);
    S.file = null;
    setDirty(false);
    loadFiles();
  });
  $('#savePreset').addEventListener('click', savePreset);
  $('#iconSearch').addEventListener('input', drawIcons);
  $('#iconClose').addEventListener('click', () => $('#iconDialog').close());
  $('#iconNone').addEventListener('click', () => { $('#iconDialog').close(); pickCallback(null); });
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') copySel();
    else if ((e.ctrlKey || e.metaKey) && e.key === 'v') paste();
    else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
  });
  window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

  S.sim = await api('GET', '/api/state');
  $('#folderNote').textContent = `Profiles and presets are saved in ${S.sim.profilesDir}`;
  S.icons = await api('GET', '/api/icons');
  await loadFiles();
  loadPresets();
  loadInputs();
  pollState();
  setInterval(pollState, 1500);
  setInterval(loadInputs, 15000);
}

init().catch(e => status(`Editor failed to start: ${e.message}`, 'bad'));
