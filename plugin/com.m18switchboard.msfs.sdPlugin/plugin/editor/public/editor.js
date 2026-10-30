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
  for (const slot of Object.keys(k)) values[slot] = previewValueFor(k[slot], slot);
  $('#liveNote').textContent = live ? 'Showing live values from the sim.' : '';
  const { images } = await api('POST', '/api/render', { keys: k, values, sources: previewSources() });
  if (seq !== renderSeq) return;
  showImages(images);
}

// A value that shows the key in its "on" look when nothing else is known.
function defaultPreview(key) {
  if (!key) return undefined;
  if (key.type === 'armable') return 'active';
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
        dragover: e => {
          e.preventDefault();
          if (S.draggingItem) markDrop(S.draggingItem, slot);
          else cell.classList.add('drop');
        },
        dragleave: () => { if (!S.draggingItem) cell.classList.remove('drop'); },
        drop: e => {
          e.preventDefault();
          clearDropMarks();
          S.draggingItem = null;
          const libId = e.dataTransfer.getData('application/x-library');
          if (libId) { const item = S.library.find(i => i.id === libId); if (item) insertItem(item, slot); return; }
          moveKey(Number(e.dataTransfer.getData('text/plain')), slot);
        },
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

async function loadLibrary() {
  S.library = await api('GET', '/api/library');
  renderLibrary();
}

// Thumbnails are drawn by the plugin like any key, in one request.
async function libraryThumbs(items) {
  const keysById = {};
  const values = {};
  items.forEach((item, i) => { keysById[i] = item.keys[0].key; values[i] = defaultPreview(item.keys[0].key); });
  if (!items.length) return {};
  return (await api('POST', '/api/render', { keys: keysById, values })).images;
}

// "Groups" is not a real category: it lists every item with more than one key, wherever it is
// filed (user, 2026-10-28). Items filed under "Groups" by older versions appear only there.
const GROUPS = 'Groups';
const libOpen = new Set([GROUPS]); // categories the user has open, kept across redraws
const isGroup = item => item.keys.length > 1;
const categoriesOf = item => {
  const cats = [];
  if (item.category && item.category !== GROUPS) cats.push(item.category);
  if (isGroup(item)) cats.push(GROUPS);
  return cats.length ? cats : ['Other'];
};

let librarySeq = 0;
async function renderLibrary() {
  // Several redraws can overlap (search, save, look change); only the newest may draw, otherwise
  // each appends its own copy of the list (user report 2026-10-28: categories repeated).
  const seq = ++librarySeq;
  const list = $('#libraryList');
  const q = $('#libSearch').value.trim().toLowerCase();
  const items = S.library.filter(i => !q || `${i.name} ${i.category} ${i.notes || ''}`.toLowerCase().includes(q));
  const thumbs = await libraryThumbs(items);
  if (seq !== librarySeq) return;
  list.innerHTML = '';
  if (!items.length) list.append(el('div', { class: 'muted' }, q ? 'Nothing matches.' : 'The library is empty.'));
  const order = c => (c === GROUPS ? '0' : `1${c}`);
  const cats = [...new Set(items.flatMap(categoriesOf))].sort((a, b) => order(a).localeCompare(order(b)));
  for (const cat of cats) {
    const inCat = items.filter(i => categoriesOf(i).includes(cat));
    const group = el('details', { class: 'lib-cat', 'data-cat': cat, open: q || libOpen.has(cat) ? true : null },
      el('summary', {}, `${cat} (${inCat.length})`));
    group.addEventListener('toggle', () => { if (!q) { if (group.open) libOpen.add(cat); else libOpen.delete(cat); } });
    items.forEach((item, i) => {
      if (!categoriesOf(item).includes(cat)) return;
      group.append(el('div', {
        class: 'lib-item', draggable: 'true', title: item.notes || '',
        on: {
          dragstart: e => { S.draggingItem = item; e.dataTransfer.setData('application/x-library', item.id); },
          dragend: () => { S.draggingItem = null; clearDropMarks(); },
        },
      },
      el('img', { src: thumbs[i], alt: '' }),
      el('div', { class: 'name' }, item.name, item.keys.length > 1 ? el('span', { class: 'muted' }, ` · ${item.keys.length} keys`) : null,
        item.notes ? el('div', { class: 'muted small' }, item.notes) : null),
      el('button', { title: 'Insert at the selected key (or drag onto the dock picture)', on: { click: () => insertItem(item) } }, 'Insert'),
      el('button', { title: 'Rename', on: { click: () => renameItem(item) } }, '✎'),
      el('button', { title: 'Delete from library', on: { click: () => deleteItem(item) } }, '✕')));
    });
    list.append(group);
  }
}

async function saveToLibrary() {
  const g = selectionGroup();
  if (!g) return status('Select the key(s) to save first', 'bad');
  const first = g[0].key;
  const cats = [...new Set(S.library.map(i => i.category).filter(c => c && c !== GROUPS))].sort();
  const name = el('input', { value: g.length > 1 ? 'My group' : (first.label || first.icon || 'My key').replace(/\n/g, ' ') });
  const NEW = '__new__';
  const cat = el('select', {}, ...cats.map(c => el('option', { value: c }, c)), el('option', { value: NEW }, 'New category…'));
  const newCat = el('input', { placeholder: 'New category name', style: 'display:none' });
  const showNew = () => { newCat.style.display = cat.value === NEW ? '' : 'none'; if (cat.value === NEW) newCat.focus(); };
  cat.addEventListener('change', showNew);
  if (!cats.length) { cat.value = NEW; }
  const dlg = el('dialog', { class: 'small-dialog' });
  const close = () => { dlg.close(); dlg.remove(); };
  const ok = async () => {
    const category = cat.value === NEW ? newCat.value.trim() : cat.value;
    if (!name.value.trim()) return name.focus();
    if (!category) return newCat.focus();
    if (category.toLowerCase() === GROUPS.toLowerCase()) { status('"Groups" fills itself with every group; choose another category', 'bad'); return newCat.focus(); }
    close();
    libOpen.add(category);
    await api('POST', '/api/library', { name: name.value.trim(), category, keys: g });
    await loadLibrary();
    status(`"${name.value.trim()}" saved to ${category}${g.length > 1 ? ' (and Groups)' : ''}`, 'good');
  };
  dlg.append(el('h3', {}, `Save ${g.length > 1 ? `a group of ${g.length} keys` : 'this key'} to the library`),
    field('Name', name), field('Category', cat), field('', newCat),
    g.length > 1 ? el('p', { class: 'muted' }, 'Groups also appear under "Groups" automatically.') : null,
    el('div', { class: 'dialog-buttons' }, el('button', { on: { click: close } }, 'Cancel'), el('button', { class: 'primary', id: 'libSaveOk', on: { click: ok } }, 'Save')));
  dlg.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
  document.body.append(dlg);
  dlg.showModal();
  showNew();
  name.select();
}

async function renameItem(item) {
  const name = prompt('Name', item.name);
  if (name === null) return;
  const category = prompt('Category', item.category);
  if (category === null) return;
  await api('PATCH', `/api/library/${encodeURIComponent(item.id)}`, { name, category });
  loadLibrary();
}

async function deleteItem(item) {
  if (!confirm(`Delete "${item.name}" from the library?`)) return;
  await api('DELETE', `/api/library/${encodeURIComponent(item.id)}`);
  loadLibrary();
}

function insertItem(item, anchor) {
  if (anchor === undefined) {
    if (!S.selected.size) return status('Click the key where it should go (top-left for groups), or drag it there', 'bad');
    anchor = Math.min(...S.selected);
  }
  const place = (from, to) => {
    placeGroup(item.keys, anchor, from, to);
    S.selected = new Set([anchor]);
    renderInspector();
  };
  // Input events are aircraft-specific (cockpit controls); simvars are not. Ask only when the item
  // works one input event that the loaded aircraft does not have, with its list to choose from.
  const inputs = inputSourcesIn(item.keys);
  if (inputs.length !== 1 || !S.inputs.length || S.inputs.includes(inputs[0])) return place();
  const src = inputs[0];
  const dlg = el('dialog', { class: 'small-dialog' });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(el('h3', {}, `"${item.name}" works the input event`),
    el('p', { class: 'mono' }, src),
    el('p', { class: 'warn' }, 'The aircraft loaded now does not have this input event. Choose its equivalent, or keep it and fix it later.'),
    el('div', { class: 'dialog-buttons' },
      el('button', { on: { click: () => { close(); place(); } } }, 'Keep'),
      el('button', { class: 'primary', on: { click: () => { close(); browse('inputs', c => place(src, c.name)); } } }, 'Choose from this aircraft…')));
  document.body.append(dlg);
  dlg.showModal();
}

function inputSourcesIn(group) {
  const set = new Set();
  for (const g of group) {
    if (g.key.read && g.key.read.input) set.add(g.key.read.input);
    if (g.key.press && g.key.press.input) set.add(g.key.press.input);
  }
  return [...set];
}

// Drop preview: every key a library item would land on (user, 2026-10-28). Yellow: empty slot;
// orange: a key that would be replaced. Keys that would fall off the panel are counted.
function markDrop(item, anchor) {
  clearDropMarks();
  const [r0, c0] = rc(anchor);
  let off = 0;
  for (const g of item.keys) {
    const slot = slotOf(r0 + g.dr, c0 + g.dc);
    if (slot === null) { off++; continue; }
    const cell = document.querySelector(`.slot[data-slot="${slot}"]`);
    if (cell) cell.classList.add(keys()[slot] ? 'drop-replace' : 'drop');
  }
  $('#liveNote').textContent = off ? `${off} key(s) would not fit here` : '';
  $('#liveNote').classList.toggle('warn', !!off);
}

function clearDropMarks() {
  for (const c of document.querySelectorAll('.slot.drop, .slot.drop-replace')) c.classList.remove('drop', 'drop-replace');
  $('#liveNote').classList.remove('warn');
}

// ---------- inspector ----------

function field(label, control, note, help) {
  return el('label', { class: 'field' }, el('span', {}, label, help ? info(help) : null), control, note ? el('span', {}) : null, note ? el('span', { class: 'muted' }, note) : null);
}

// ⓘ next to a label: the help text on hover, or pinned open by a click (user, 2026-10-29). Texts
// live in HELP so they are easy to find and correct.
const HELP = {
  armable: 'For modes that arm before they engage (APR, GS, NAV/LOC capture, ALT). The key checks its '
    + 'two sources in order: green while the mode is active, white while it is only armed, otherwise '
    + 'the look you choose. HDG, VS, FLC, YD and AP are only on or off: use an ordinary Switch for those.',
  armableActive: 'Checked first. Candidates for the default autopilot (unit bool, is 1): ILS approach: '
    + 'AUTOPILOT APPROACH CAPTURED (localizer within 5°); glideslope: AUTOPILOT GLIDESLOPE ACTIVE; altitude: '
    + 'AUTOPILOT ALTITUDE LOCK. The SDK descriptions are terse and aircraft differ: confirm with Test while flying an approach.',
  armableArmed: 'Checked only when the mode is not active. Candidates: AUTOPILOT APPROACH HOLD (APR selected), '
    + 'AUTOPILOT GLIDESLOPE HOLD (GS selected), AUTOPILOT ALTITUDE ARM. AUTOPILOT APPROACH ARM/ACTIVE are about GPS '
    + 'flight-plan approaches, per the SDK.',
  armableOtherwise: 'Neither active nor armed. Clear (outline) suits autopilot modes.',
  armablePress: 'The source is usually a simvar, so set "Acts on" to the panel button\'s input event. G1000 buttons: '
    + 'Hold, while held 1, on release 0. Softkeys drop a held press unless re-sent every 130 ms or less.',
  actsOn: 'What the press changes. An input event is a cockpit control (switch, button, knob): the usual choice. '
    + 'A simvar can also be written directly, but the sim only keeps values of simvars it lets clients set '
    + '(marked [settable] in Browse), and an aircraft\'s avionics may put their own value back: try it with "Set". '
    + 'Toggle / cycle and step read the simvar\'s current value to work out the next one.',
};

function info(id) {
  const text = HELP[id];
  const tip = el('span', { class: 'info-text' }, text);
  const i = el('span', { class: 'info', title: text, role: 'button', tabindex: '0', 'data-help': id,
    on: { click: e => {
      e.preventDefault(); e.stopPropagation();
      tip.style.left = '';
      if (!i.classList.toggle('open')) return;
      // Keep it inside the panel it opens in.
      const panel = (i.closest('#inspector, dialog, details') || document.body).getBoundingClientRect();
      const r = tip.getBoundingClientRect();
      if (r.right > panel.right - 8) tip.style.left = `${Math.min(0, panel.right - 8 - r.right)}px`;
    } } }, 'ⓘ', tip);
  return i;
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
      el('p', { class: 'muted' }, 'Copy (Ctrl+C), delete, or save them to the library as a group.'),
      el('button', { on: { click: saveToLibrary } }, 'Save to library'));
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
      el('div', { class: 'inline' },
        el('button', { class: 'primary', on: { click: () => { keys()[slot] = { type: 'button', label: 'NEW' }; changed(); renderInspector(); } } }, 'Add key'),
        S.clipboard ? el('button', { on: { click: paste } }, 'Paste') : null));
    return;
  }

  const redraw = () => { changed(); renderInspector(); };
  box.append(el('h3', {}, `Key ${slot}`));

  box.append(field('Type', select_([['switch', 'Switch (on/off look)'], ['armable', 'Switch (armable)'], ['readout', 'Readout (live value)'], ['button', 'Button']], key.type, v => {
    key.type = v;
    if (v === 'switch' && !key.states) key.states = { 0: 'off', 1: 'on' };
    if (v === 'armable' && !key.armed) key.armed = { var: '', unit: 'bool' };
    redraw();
  }), null, key.type === 'armable' ? 'armable' : null));
  box.append(field('Label', el('textarea', { rows: 2, on: { input: e => { key.label = e.target.value; changed(); } } }, key.label || ''),
    'Shown on drawn tiles. A new line starts a second line.'));

  // Icon
  const switchLike = key.type === 'switch' || key.type === 'armable';
  const iconMode = switchLike ? 'switch' : 'any';
  box.append(field('Icon', el('div', { class: 'icon-chip' },
    iconThumb(key.icon ? (switchLike ? `${key.icon}_on` : key.icon) : null),
    el('span', {}, key.icon || 'none (drawn tile)'),
    el('button', { on: { click: () => pickIcon(iconMode, name => { if (name) key.icon = name; else delete key.icon; redraw(); }) } }, 'Choose…')),
  key.type === 'armable' ? 'Uses the icon\'s on / off / clear versions; armed is the clear one with its bar filled white.'
    : key.type === 'switch' ? 'Switch icons use the icon\'s on / off / clear versions.'
    : key.type === 'readout' ? 'Drawn above the value, scaled to fit.' : null));

  box.append(el('h4', {}, 'Face (optional)'));
  box.append(faceDesigner(key, slot));

  if (key.type === 'armable') box.append(armableLadder(key));
  // Source
  if (key.type !== 'armable') box.append(el('h4', {}, 'Reads from the sim'));
  if (key.type !== 'armable') box.append(sourceEditor(key.read, r => {
    if (r) key.read = r; else delete key.read;
    // A simvar chosen from the catalog brings a sensible number format for an unformatted readout.
    if (r && r.hint && key.type === 'readout') {
      for (const k of ['decimals', 'pad', 'format']) if (r.hint[k] !== undefined && key[k] === undefined) key[k] = r.hint[k];
    }
    if (r) delete r.hint;
  }, { allowNone: true }));

  // Look per value
  if (key.type === 'switch') {
    box.append(el('h4', {}, 'Look per value'));
    key.states = key.states || {};
    box.append(mapEditor(key.states, (v, set) => select_([['on', 'on (green)'], ['off', 'off (red)'], ['clear', 'clear (outline)']], v, set),
      { label: 'shows', value: 'off' }));
    box.append(field('Other values', select_([['', 'clear'], ['on', 'on'], ['off', 'off']], key.otherwise || '', v => { if (v) key.otherwise = v; else delete key.otherwise; changed(); })));
  }
  // Sublabel: the smaller line under the label, on every key type, fixed or per sim value
  // (user, 2026-10-28). Switches used `text` for this before; it moves over here.
  if (key.type === 'switch' && key.text && !key.sublabels) { key.sublabels = key.text; delete key.text; }
  box.append(el('h4', {}, 'Sublabel'));
  // A custom face replaces the automatic look, sublabel included, unless it has a Sublabel layer
  // (user report 2026-10-29: ARM did not show on a key with a custom face).
  const missing = facesOf(key).filter(f => !(f.layers || []).some(L => L.kind === 'sublabel'));
  if (missing.length) {
    box.append(el('p', { class: 'warn' }, 'This key has a custom face, which shows the sublabel only where it has a Sublabel layer. ',
      el('button', { on: { click: () => { for (const f of missing) f.layers.push(NEW_LAYER.sublabel()); changed(); renderInspector(); } } }, 'Add it to the face')));
  }
  if (key.type === 'armable') {
    // One per step of the ladder, e.g. LOC when active, ARM when armed.
    for (const [step, name] of [['active', 'When active'], ['armed', 'When armed'], ['otherwise', 'Otherwise']]) {
      box.append(field(name, input(key.sublabels && key.sublabels[step], v => {
        key.sublabels = key.sublabels || {};
        if (v) { key.sublabels[step] = v; ensureSublabelLayer(key); } else delete key.sublabels[step];
        changed();
      })));
    }
  } else box.append(field('Sublabel', input(key.sublabel, v => { if (v) { key.sublabel = v; ensureSublabelLayer(key); } else delete key.sublabel; changed(); }),
    key.read ? 'shown for any value without its own below' : 'smaller text under the label'));
  if (key.read && key.type !== 'armable') {
    key.sublabels = key.sublabels || {};
    box.append(mapEditor(key.sublabels, (v, set) => input(v, x => { set(x); if (x) ensureSublabelLayer(key); }), { label: 'sublabel', value: '' }));
  }
  if (key.type === 'readout') {
    box.append(el('h4', {}, 'Value text per value (replaces the number)'));
    key.text = key.text || {};
    box.append(mapEditor(key.text, (v, set) => input(v, set), { label: 'text', value: '' }));
  }
  if (key.type !== 'button' && key.type !== 'armable') {
    box.append(el('h4', {}, 'Icon per value (replaces the whole key)'));
    key.valueIcons = key.valueIcons || {};
    box.append(mapEditor(key.valueIcons, (v, set) => el('div', { class: 'inline' }, iconThumb(v), el('span', {}, v || '—'),
      el('button', { on: { click: () => pickIcon('any', n => { set(n || ''); renderInspector(); }) } }, '…')), { label: 'icon', value: '' }));
  }
  if (key.type === 'readout') {
    box.append(field('Decimals', input(key.decimals, v => { if (v === '') delete key.decimals; else key.decimals = Number(v); changed(); }, { type: 'number', min: 0, max: 6 })));
    box.append(field('Pad to digits', input(key.pad, v => { if (v === '') delete key.pad; else key.pad = Number(v); changed(); }, { type: 'number', min: 0, max: 8 }), 'e.g. 4 shows 7 as 0007'));
    box.append(field('Show as', select_([['', 'Number'], ['time', 'Time HH:MM (from seconds)']], key.format || '', v => { if (v) key.format = v; else delete key.format; changed(); })));
  }

  // Press
  box.append(el('h4', {}, 'When pressed', key.type === 'armable' ? info('armablePress') : null));
  const p = key.press || {};
  const pkind = !key.press ? 'none' : p.event !== undefined ? 'event' : p.cycle ? 'cycle' : p.step !== undefined ? 'step' : p.hold !== undefined ? 'hold' : p.set !== undefined ? 'set' : 'none';
  box.append(field('Action', select_([['none', 'Nothing'], ['cycle', 'Toggle / cycle values'], ['step', 'Step up or down'], ['hold', 'Hold (spring-loaded)'], ['set', 'Set a value'], ['event', 'Send a sim event']], pkind, v => {
    const target = p.input;
    const targetVar = p.var;
    key.press = { cycle: { cycle: [0, 1] }, step: { step: 1 }, hold: { hold: 1, release: 0 }, set: { set: 1 }, event: { event: '' } }[v];
    if (!key.press) delete key.press;
    else if (v !== 'event') { if (target) key.press.input = target; if (targetVar) key.press.var = targetVar; }
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
    box.append(field('Repeat every ms', input(p.repeatMs, v => setP('repeatMs', num(v)), { type: 'number', min: 0 }), 'Re-sends while held, for positions the aircraft drops. Empty = once. G1000 softkeys need 130 ms or less to stay held; the C172 START works at 250.'));
  }
  if (pkind === 'set') box.append(field('Value', input(p.set, v => setP('set', num(v)), { type: 'number' })));
  if (pkind === 'event') {
    const evInput = input(p.event, v => { key.press.event = v; changed(); }, { placeholder: 'e.g. BAROMETRIC' });
    box.append(field('Event', el('div', { class: 'inline' }, evInput,
      el('button', { on: { click: () => browse('events', choice => { key.press.event = choice.name; if (choice.value !== undefined) key.press.value = choice.value; redraw(); }) } }, 'Browse…'),
      el('button', { title: 'Send it to the sim now, to see what it does', on: { click: async () => {
        try { await api('POST', '/api/send-event', { event: key.press.event, value: key.press.value }); status(`Sent ${key.press.event}`, 'good'); } catch (e) { status(e.message, 'bad'); }
      } } }, 'Send now'))));
    box.append(field('Value', input(p.value, v => setP('value', num(v)), { type: 'number' })));
    box.append(field('Send 1/0 opposite of current', el('input', { type: 'checkbox', checked: p.toggleValue ? true : null, on: { change: e => setP('toggleValue', e.target.checked || undefined) } })));
  }
  if (['cycle', 'step', 'hold', 'set'].includes(pkind)) {
    // What the press changes: an input event (a cockpit control) or a simvar written directly
    // (user, 2026-10-30), e.g. TRANSPONDER STATE:1 where no event sets the mode.
    const onVar = !!p.var;
    box.append(field('Acts on', select_([['input', 'Input event (cockpit control)'], ['var', 'Simvar (written directly)']], onVar ? 'var' : 'input', v => {
      if (v === 'var') {
        delete key.press.input;
        key.press.var = { var: key.read && key.read.var ? key.read.var : '', unit: key.read && key.read.var ? key.read.unit || 'number' : 'number' };
      } else delete key.press.var;
      redraw();
    }), null, 'actsOn'));
    if (!onVar) {
      const actsOn = input(p.input, v => setP('input', v || undefined), { list: 'inputList', placeholder: key.read && key.read.input ? `(same as source: ${key.read.input})` : 'input event' });
      box.append(field('Input event', el('div', { class: 'inline' }, actsOn,
        el('button', { on: { click: () => browse('inputs', c => { setP('input', c.name); renderInspector(); }) } }, 'Browse…'))));
    } else {
      const tv = p.var;
      box.append(field('Simvar', el('div', { class: 'inline' },
        input(tv.var, v => { tv.var = v; changed(); }, { placeholder: 'e.g. TRANSPONDER STATE:1' }),
        el('button', { on: { click: () => browse('simvars', c => { tv.var = c.name; if (c.unit) tv.unit = c.unit; changed(); renderInspector(); }) } }, 'Browse…'))));
      box.append(field('Unit', input(tv.unit, v => { tv.unit = v || 'number'; changed(); }, { list: 'unitList' })));
      // Try a write now and read it back: the sim ignores simvars it does not let clients set.
      const val = input(p.set ?? p.hold ?? (p.cycle ? p.cycle[0] : ''), () => {}, { type: 'number', class: 'narrow' });
      const out = el('span', { class: 'test-out' });
      box.append(field('Set now', el('div', { class: 'inline' }, val,
        el('button', { title: 'Write this value to the simvar now and read it back', on: { click: async e => {
          e.preventDefault();
          out.textContent = '…';
          try {
            const r = await api('POST', '/api/set-var', { var: tv.var, unit: tv.unit, value: val.value });
            out.textContent = r.kept ? `now ${r.value}: kept` : r.value === null ? 'no value read back' : `now ${r.value}: the sim did not keep it`;
            out.className = `test-out ${r.kept ? 'good' : 'bad'}`;
          } catch (err) { out.textContent = err.message; out.className = 'test-out bad'; }
        } } }, 'Set'), out), 'Writes the value once to see if the sim keeps it. Simvars marked [settable] in Browse are the ones the SDK says can be set.'));
    }
  }

  // Preview value
  box.append(el('h4', {}, 'Preview'));
  const pvKey = `${S.page}:${slot}`;
  if (key.type === 'armable') {
    box.append(field('Preview', select_([['', isLivePage() ? 'live from sim' : 'active (default)'], ['active', 'active'], ['armed', 'armed'], ['otherwise', 'otherwise']],
      S.previewValues[pvKey] || '', v => { S.previewValues[pvKey] = v; renderGrid(); renderInspector(); })));
  } else box.append(field('Preview value', input(S.previewValues[pvKey], v => { S.previewValues[pvKey] = v; renderGrid(); renderInspector(); }, { placeholder: isLivePage() ? 'live from sim' : `default: ${defaultPreview(key) ?? 'unknown'}` }),
    'Try values to see each look. Empty = live value (when this page is on the dock) or a default.'));

  // Raw JSON
  const raw = el('details', {}, el('summary', {}, 'Advanced: edit as JSON'));
  const ta = el('textarea', { class: 'json' }, JSON.stringify(key, null, 2));
  raw.append(ta, el('button', { on: { click: () => {
    try { keys()[slot] = JSON.parse(ta.value); redraw(); } catch (e) { status(`JSON error: ${e.message}`, 'bad'); }
  } } }, 'Apply JSON'));
  box.append(raw);
  box.append(el('p', {}, el('button', { on: { click: saveToLibrary } }, 'Save to library'), ' ',
    el('button', { on: { click: deleteSel } }, 'Delete this key')));
}

// Learn: the user moves a control; everything that changed in the next moment comes back. One
// candidate is taken directly; several are listed to choose from (user, 2026-10-28: be sure the
// right one is picked when several inputs fire).
async function learnInto(inputEl, apply) {
  status('Learning: move the control in the cockpit now (30 s)…');
  inputEl.disabled = true;
  try {
    const { candidates } = await api('POST', '/api/learn');
    if (candidates.length === 1) {
      apply(candidates[0].name);
      status(`Learned ${candidates[0].name} (now ${candidates[0].value})`, 'good');
    } else {
      chooseFrom(`${candidates.length} controls changed. Which one is it?`,
        candidates.map(c => ({ name: c.name, detail: `now ${c.value}${c.changes > 1 ? `, changed ${c.changes} times` : ''}` })),
        c => { apply(c.name); status(`Chose ${c.name}`, 'good'); });
    }
  } catch (e) {
    status(`Learn failed: ${e.message}`, 'bad');
  } finally {
    inputEl.disabled = false;
  }
}

// Editor for a sim source: { input } or { var, unit }. onChange(newRead | null).
// Switch (armable): a fixed ladder read top to bottom (user, 2026-10-29). The first step uses the
// key's own source (read), so presses and Learn work as on any key.
function armableLadder(key) {
  const box = el('div', { class: 'ladder' });
  const isField = (k, help) => field('is', input(key[k] ?? 1, v => { if (v === '' || v === '1') delete key[k]; else key[k] = isNaN(Number(v)) ? v : Number(v); changed(); },
    { class: 'narrow' }), null, help);
  box.append(el('h4', {}, 'Look (checked top to bottom)'),
    el('div', { class: 'step' },
      el('div', { class: 'step-head' }, el('span', { class: 'step-n' }, '1'), el('span', { class: 'swatch on' }), 'Green (active) when', info('armableActive')),
      sourceEditor(key.read, r => { if (r) key.read = r; else delete key.read; if (r) delete r.hint; }, { unit: 'bool' }),
      isField('activeIs'), orSources(key, 'activeOr')),
    el('div', { class: 'step' },
      el('div', { class: 'step-head' }, el('span', { class: 'step-n' }, '2'), 'otherwise', el('span', { class: 'swatch armed' }), 'White (armed) when', info('armableArmed')),
      sourceEditor(key.armed, r => { key.armed = r || { var: '', unit: 'bool' }; if (r) delete r.hint; }, { unit: 'bool' }),
      isField('armedIs'), orSources(key, 'armedOr')),
    el('div', { class: 'step' },
      el('div', { class: 'step-head' }, el('span', { class: 'step-n' }, '3'), 'otherwise', info('armableOtherwise')),
      field('shows', select_([['', 'clear (outline)'], ['off', 'off (red)']], key.otherwise || '', v => { if (v) key.otherwise = v; else delete key.otherwise; changed(); }))));
  return box;
}

// More sources for a ladder step, any one of which is enough ("or"), e.g. ILS capture or GPS
// approach active (user, 2026-10-29).
function orSources(key, k) {
  const box = el('div', { class: 'or-sources' });
  (key[k] || []).forEach((o, i) => {
    box.append(el('div', { class: 'or-source' },
      el('div', { class: 'step-head' }, el('span', { class: 'or-word' }, 'or'),
        el('button', { title: 'Remove this "or"', on: { click: () => {
          key[k].splice(i, 1);
          if (!key[k].length) delete key[k];
          changed(); renderInspector();
        } } }, '✕')),
      sourceEditor(o.read, r => { o.read = r || { var: '', unit: 'bool' }; if (r) delete r.hint; }, { unit: 'bool' }),
      field('is', input(o.is ?? 1, v => { if (v === '' || v === '1') delete o.is; else o.is = isNaN(Number(v)) ? v : Number(v); changed(); }, { class: 'narrow' }))));
  });
  box.append(el('button', { class: 'add-or', title: 'Add another source; any one of them is enough', on: { click: () => {
    key[k] = key[k] || [];
    key[k].push({ read: { var: '', unit: 'bool' } });
    changed(); renderInspector();
  } } }, '+ or'));
  return box;
}

function sourceEditor(read, onChange, { allowNone = false, unit = 'number' } = {}) {
  const box = el('div', { class: 'source' });
  const kind = !read ? 'none' : read.input !== undefined ? 'input' : 'var';
  const set = r => { onChange(r); changed(); renderInspector(); };
  const kinds = [['input', 'Input event (cockpit control)'], ['var', 'Simvar (sim value)']];
  box.append(field('Source', select_(allowNone ? [['none', 'Nothing'], ...kinds] : kinds, kind, v => {
    set(v === 'none' ? null : v === 'input' ? { input: '' } : { var: '', unit });
  })));
  if (kind === 'input') {
    const inp = input(read.input, v => { read.input = v; changed(); }, { list: 'inputList', placeholder: 'e.g. ELECTRICAL_BATTERY_1' });
    box.append(field('Input event', el('div', { class: 'inline' }, inp,
      el('button', { title: 'Click, then move the control in the cockpit', on: { click: () => learnInto(inp, v => set({ input: v })) } }, 'Learn'),
      el('button', { title: 'Search this aircraft\'s input events, with their current values', on: { click: () => browse('inputs', c => set({ input: c.name })) } }, 'Browse…'))));
  } else if (kind === 'var') {
    const testOut = el('span', { class: 'muted' });
    box.append(field('Simvar', el('div', { class: 'inline' },
      input(read.var, v => { read.var = v; changed(); }, { placeholder: 'e.g. NAV ACTIVE FREQUENCY:1' }),
      el('button', { title: 'Search common simvars', on: { click: () => browse('simvars', c => set({ var: c.name, unit: c.unit, hint: c })) } }, 'Browse…'))));
    box.append(field('Unit', el('div', { class: 'inline' },
      input(read.unit, v => { read.unit = v; changed(); }, { list: 'unitList' }),
      el('button', { title: 'Read it from the sim once', on: { click: async () => {
        testOut.textContent = 'reading…';
        try { testOut.textContent = `= ${(await api('POST', '/api/test-var', { var: read.var, unit: read.unit })).value}`; } catch (e) { testOut.textContent = e.message; }
      } } }, 'Test'), testOut)));
  }
  return box;
}

// ---------- browse dialog: input events, simvars, events ----------

function chooseFrom(title, rows, onPick) {
  const dlg = el('dialog', { class: 'browse' });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(el('div', { class: 'dialog-head' }, el('strong', {}, title), el('span', { class: 'spacer' }), el('button', { on: { click: close } }, 'Close')),
    el('div', { class: 'browse-list' }, rows.map(r => el('div', { class: 'browse-row', on: { click: () => { close(); onPick(r); } } },
      el('span', { class: 'mono' }, r.name), el('span', { class: 'muted' }, r.detail || '')))));
  document.body.append(dlg);
  dlg.showModal();
}

const browseCache = {};
async function browse(what, onPick) {
  const titles = { inputs: 'Input events of the loaded aircraft', simvars: 'Common simvars', events: 'Common sim events' };
  const dlg = el('dialog', { class: 'browse' });
  const close = () => { dlg.close(); dlg.remove(); };
  const search = el('input', { placeholder: what === 'inputs' ? 'Search (e.g. LIGHTING, FUEL, AVIONICS)' : 'Search by name, description or category (e.g. NAV1, heading, fuel)' });
  const list = el('div', { class: 'browse-list' }, el('p', { class: 'muted' }, 'Loading…'));
  const custom = el('div', { class: 'browse-custom' });
  dlg.append(el('div', { class: 'dialog-head' }, el('strong', {}, titles[what]), search, el('button', { on: { click: close } }, 'Close')), custom, list);
  document.body.append(dlg);
  dlg.showModal();
  search.focus();

  let rows = [];
  try {
    if (what === 'inputs') {
      list.innerHTML = '';
      list.append(el('p', { class: 'muted' }, 'Reading current values from the sim…'));
      const r = await api('GET', '/api/input-values');
      if (!r.connected) { list.innerHTML = ''; list.append(el('p', { class: 'muted' }, 'MSFS is not connected.')); return; }
      rows = r.inputs.map(i => ({ name: i.name, detail: i.value === null ? '' : `now ${i.value}`, search: i.name }));
      custom.append(el('p', { class: 'muted' }, `${rows.length} input events in ${r.aircraft || 'this aircraft'}. Values are as of opening this list; reopen to refresh, or use Learn.`));
    } else {
      browseCache[what] = browseCache[what] || await api('GET', `/api/catalog/${what}`);
      rows = browseCache[what].map(c => ({ ...c, detail: `${c.desc}${c.unit ? ` · ${c.unit}` : ''}`, search: `${c.name} ${c.desc} ${c.cat}` }));
      const name = el('input', { placeholder: what === 'simvars' ? 'or type any simvar name (also L:vars)' : 'or type any event name' });
      const unit = what === 'simvars' ? el('input', { placeholder: 'unit', list: 'unitList', value: 'number', style: 'width:120px' }) : null;
      custom.append(el('div', { class: 'inline' }, name, unit, el('button', { on: { click: () => {
        if (!name.value.trim()) return;
        close();
        onPick({ name: name.value.trim().toUpperCase().replace(/^L:/, 'L:'), unit: unit ? unit.value : undefined });
      } } }, 'Use')),
      el('p', { class: 'muted' }, what === 'simvars'
        ? `All ${rows.length} simvars of the MSFS 2024 SDK; ★ marks common ones, listed first. Use Test to check one gives a value in this aircraft. Third-party aircraft often use their own L:vars instead.`
        : `All ${rows.length} key events of the MSFS 2024 SDK; ★ marks common ones, listed first. "Send" fires it in the sim right away, so you can see what it does.`));
    }
  } catch (e) {
    list.innerHTML = '';
    list.append(el('p', { class: 'muted' }, e.message));
    return;
  }

  const draw = () => {
    const q = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = rows.filter(r => q.every(w => r.search.toLowerCase().includes(w)));
    list.innerHTML = '';
    let cat = null;
    for (const r of shown.slice(0, 300)) {
      if (r.cat && r.cat !== cat) { cat = r.cat; list.append(el('div', { class: 'browse-cat' }, cat)); }
      const out = el('span', { class: 'test-out' });
      const actions = [];
      if (what === 'simvars') {
        actions.push(el('button', { on: { click: async e => {
          e.stopPropagation();
          out.textContent = '…';
          try { out.textContent = `= ${(await api('POST', '/api/test-var', { var: r.name, unit: r.unit })).value}`; } catch (err) { out.textContent = 'no value'; }
        } } }, 'Test'));
      }
      if (what === 'events') {
        actions.push(el('button', { on: { click: async e => {
          e.stopPropagation();
          try { await api('POST', '/api/send-event', { event: r.name, value: r.value || 0 }); out.textContent = 'sent'; } catch (err) { out.textContent = err.message; }
        } } }, 'Send'));
      }
      list.append(el('div', { class: 'browse-row', on: { click: () => { close(); onPick(r); } } },
        el('span', { class: 'mono' }, r.name), el('span', { class: 'muted' }, r.detail), el('span', { class: 'spacer' }), out, ...actions));
    }
    if (!shown.length) list.append(el('p', { class: 'muted' }, 'Nothing matches.'));
    if (shown.length > 300) list.append(el('p', { class: 'muted' }, `${shown.length - 300} more: narrow the search.`));
  };
  search.addEventListener('input', draw);
  draw();
}

// ---------- face designer ----------

// Default colours shown in the colour pickers; layers without their own colour follow the global
// look (Look panel), so changing it there restyles every key.
const COLORS = () => ({ label: lookValue('label', '#ffffff'), value: lookValue('readout', '#4fc3f7') });

// A starting face that looks like the key's automatic look, ready to adjust.
const SUBLABEL_Y = () => Math.round(((S.look && S.look.style && S.look.style.bar) || { y: 93.4 }).y * 0.78);
const hasSublabel = key => !!(key.sublabel || (key.sublabels && Object.values(key.sublabels).some(Boolean)));
const facesOf = key => [key.face, ...Object.values(key.valueFaces || {})].filter(Boolean);

// Every new face carries a Sublabel layer, ready to move, placed where drawn tiles put the
// sublabel (user, 2026-10-29). It draws nothing while the key has no sublabel.
function defaultFace(key) {
  const label = key.label || '';
  const sub = y => ({ kind: 'sublabel', ...(y === undefined ? {} : { x: 72, y }) });
  if (key.type === 'readout') {
    return key.icon
      ? { layers: [{ kind: 'icon', crop: 'auto', x: 6, y: 6, w: 132, h: 62 }, sub(82), { kind: 'value', x: 72, y: 112, size: 40 }] }
      : { layers: [{ kind: 'text', text: label, x: 72, y: 28, size: 24 }, sub(54), { kind: 'value', x: 72, y: 100, size: 42 }] };
  }
  if (key.type === 'switch' || key.type === 'armable') {
    return key.icon
      ? { layers: [{ kind: 'icon', crop: 'full', x: 0, y: 0, w: 144, h: 144 }, sub(76)] }
      : { layers: [hasSublabel(key) ? { kind: 'text', text: label, x: 72, y: 32, size: 26 } : { kind: 'text', text: label, x: 72, y: 45, size: 30 }, sub(), { kind: 'bar' }] };
  }
  return key.icon
    ? { layers: [{ kind: 'icon', crop: 'full', x: 0, y: 0, w: 144, h: 144 }, sub(122)] }
    : { layers: [hasSublabel(key) ? { kind: 'text', text: label, x: 72, y: 58, size: 30 } : { kind: 'text', text: label, x: 72, y: 72, size: 34 }, sub(104)] };
}

// A face made before the key had a sublabel gets the layer when a sublabel is typed.
function ensureSublabelLayer(key) {
  for (const f of facesOf(key)) if (!(f.layers || []).some(L => L.kind === 'sublabel')) f.layers.push(NEW_LAYER.sublabel());
}

const NEW_LAYER = {
  icon: () => ({ kind: 'icon', crop: 'auto', x: 6, y: 6, w: 132, h: 70 }),
  text: () => ({ kind: 'text', text: 'TEXT', x: 72, y: 36, size: 26 }),
  value: () => ({ kind: 'value', x: 72, y: 104, size: 40 }),
  sublabel: () => ({ kind: 'sublabel' }),
  bar: () => ({ kind: 'bar' }),
  rect: () => ({ kind: 'rect', x: 0, y: 0, w: 144, h: 40, color: '#1e2a3a' }),
};
const LAYER_NAMES = { icon: 'Icon', text: 'Text', value: 'Live value', sublabel: 'Sublabel', bar: 'State bar', rect: 'Box' };

let faceLayer = 0; // which layer dragging on the preview moves
let faceTarget = 'default'; // which face is being edited: 'default' or a sim value
let faceTargetKey = null; // the key faceTarget belongs to
let editingValue = null; // value to preview while editing a per-value face

// The value a key's preview shows: typed in the inspector, live from the dock, or a default.
function previewValueFor(key, slot) {
  const pv = S.previewValues[`${S.page}:${slot}`];
  if (pv !== undefined && pv !== '') return pv;
  return isLivePage() ? S.live.values[slot] : defaultPreview(key);
}

// Values of other sources (value layers with their own source), live when available.
function previewSources() {
  return S.live && S.live.sources ? S.live.sources : {};
}

function faceDesigner(key, slot) {
  const box = el('div', { class: 'face' });
  if (faceTargetKey !== key) { faceTargetKey = key; faceTarget = 'default'; faceLayer = 0; }
  const valueFaces = key.valueFaces || {};
  if (faceTarget !== 'default' && !valueFaces[faceTarget]) faceTarget = 'default';
  editingValue = faceTarget === 'default' ? null : faceTarget;

  // Which face: the default one, or one per sim value (e.g. a different look for each magneto
  // position). Values without their own face use the default.
  const armable = key.type === 'armable';
  const addFace = v => {
    key.valueFaces = key.valueFaces || {};
    key.valueFaces[v] = clone(key.face || defaultFace(key));
    faceTarget = v;
    faceLayer = 0;
    changed(); renderInspector();
  };
  const tabs = el('div', { class: 'face-tabs' },
    el('button', { class: faceTarget === 'default' ? 'active' : '', on: { click: () => { faceTarget = 'default'; faceLayer = 0; renderInspector(); } } },
      key.face ? 'Default face' : 'Default (automatic)'),
    armable ? [
      ...Object.keys(valueFaces).map(v => el('button', { class: faceTarget === v ? 'active' : '', on: { click: () => { faceTarget = v; faceLayer = 0; renderInspector(); } } }, `when ${v}`)),
      ...['active', 'armed', 'otherwise'].filter(v => !valueFaces[v]).map(v => el('button', { title: `Design a separate face shown when the key is ${v}`, on: { click: () => addFace(v) } }, `+ face when ${v}`)),
    ] : null,
    ...(armable ? [] : Object.keys(valueFaces)).map(v => el('button', { class: faceTarget === v ? 'active' : '', on: { click: () => { faceTarget = v; faceLayer = 0; renderInspector(); } } },
      `value ${v}${key.text && key.text[v] ? ` (${key.text[v]})` : ''}`)),
    armable ? null : el('button', { title: 'Design a separate face shown when the sim value is this', on: { click: () => {
      const v = prompt('Face for which sim value? (e.g. 0, 1, 3)', String(Object.keys(key.states || key.text || {})[0] ?? '0'));
      if (v === null || v.trim() === '') return;
      addFace(v.trim());
    } } }, '+ face for a value'));
  box.append(tabs);

  const face = faceTarget === 'default' ? key.face : valueFaces[faceTarget];
  if (!face) {
    box.append(el('p', { class: 'muted' }, 'This key uses the automatic look. Design your own to place a library icon, live values, your own text and a state bar exactly where you want.'),
      el('button', { on: { click: () => { key.face = defaultFace(key); faceLayer = 0; changed(); renderInspector(); } } }, 'Design a custom face'));
    return box;
  }
  if (faceTarget !== 'default') box.append(el('p', { class: 'muted' }, armable ? `Shown while the key is ${faceTarget}.` : `Shown while the sim value is ${faceTarget}. The preview shows that value.`));

  const preview = el('img', { class: 'face-preview', alt: 'face preview', draggable: 'false' });
  // Only the newest request may update the picture: answers can arrive out of order while a
  // colour or position is being dragged.
  let seq = 0;
  const refresh = async () => {
    const mine = ++seq;
    const value = editingValue !== null ? editingValue : previewValueFor(key, slot);
    // Without a sublabel yet, the designer shows a placeholder so the Sublabel layer can be placed.
    const shown = hasSublabel(key) ? key : { ...key, sublabel: 'SUBLABEL' };
    const { images } = await api('POST', '/api/render', { keys: { 0: shown }, values: { 0: value }, sources: previewSources() });
    if (mine === seq) preview.src = images[0];
  };
  const update = () => { changed(); refresh(); };

  // Drag on the preview moves the chosen layer (the preview is 2x the key's 144 units).
  let drag = null;
  preview.addEventListener('pointerdown', e => {
    const L = face.layers[faceLayer];
    if (!L) return;
    preview.setPointerCapture(e.pointerId);
    const defaults = L.kind === 'bar' ? S.look.style.bar : L.kind === 'sublabel' ? { x: 72, y: SUBLABEL_Y() } : { x: 0, y: 0 };
    drag = { x: e.clientX, y: e.clientY, lx: Number(L.x ?? defaults.x) || 0, ly: Number(L.y ?? defaults.y) || 0, L };
  });
  preview.addEventListener('pointermove', e => {
    if (!drag) return;
    drag.L.x = Math.round(drag.lx + (e.clientX - drag.x) / 2);
    drag.L.y = Math.round(drag.ly + (e.clientY - drag.y) / 2);
    clearTimeout(drag.timer);
    drag.timer = setTimeout(refresh, 40);
  });
  preview.addEventListener('pointerup', () => { if (drag) { drag = null; changed(); renderInspector(); } });

  box.append(el('div', { class: 'face-top' }, preview, el('div', {},
    el('p', { class: 'muted' }, 'Drag on the picture to move the selected layer. Positions are in key units (0-144); text and values are centred on x, y.'),
    field('Background', el('input', { type: 'color', value: face.background || '#000000', on: { input: e => { face.background = e.target.value; update(); } } })),
    el('div', { class: 'inline' }, ...Object.keys(NEW_LAYER).map(k => el('button', { on: { click: () => {
      face.layers.push(NEW_LAYER[k]());
      faceLayer = face.layers.length - 1;
      changed(); renderInspector();
    } } }, `+ ${LAYER_NAMES[k]}`))))));

  face.layers.forEach((L, i) => {
    const n = (k, label, attrs = {}) => el('label', { class: 'mini' }, label,
      input(L[k] ?? (L.kind === 'bar' ? S.look.style.bar[k] : ''), v => { if (v === '') delete L[k]; else L[k] = Number(v); update(); }, { type: 'number', ...attrs }));
    // Colour: empty follows the global look; "reset" goes back to it.
    const color = (k, d) => el('label', { class: 'mini' }, L[k] ? 'colour' : 'colour (look)',
      el('span', { class: 'inline' },
        el('input', { type: 'color', value: L[k] || d, on: { input: e => { L[k] = e.target.value; update(); } } }),
        L[k] ? el('button', { title: 'Use the global look colour', on: { click: () => { delete L[k]; changed(); renderInspector(); } } }, '↺') : null));
    const fields = [];
    if (L.kind === 'icon') {
      fields.push(el('span', { class: 'icon-chip' }, iconThumb(L.icon || (key.icon && (key.type === 'switch' ? `${key.icon}_on` : key.icon))),
        el('span', {}, L.icon || (key.icon ? `key's icon (${key.icon})` : 'choose an icon')),
        el('button', { on: { click: () => pickIcon('any', name => { if (name) L.icon = name; else delete L.icon; changed(); renderInspector(); }) } }, 'Choose…')),
      el('label', { class: 'mini' }, 'crop', select_([['auto', 'to content'], ['full', 'whole icon']], L.crop || 'auto', v => { L.crop = v; update(); })),
      n('x', 'x'), n('y', 'y'), n('w', 'w'), n('h', 'h'));
    } else if (L.kind === 'text') {
      fields.push(el('label', { class: 'mini wide' }, 'text', el('textarea', { rows: 1, on: { input: e => { L.text = e.target.value; update(); } } }, L.text || '')),
        n('x', 'x'), n('y', 'y'), n('size', 'size'), n('w', 'max width'), color('color', COLORS().label));
    } else if (L.kind === 'value') {
      fields.push(n('x', 'x'), n('y', 'y'), n('size', 'size'), n('w', 'max width'), color('color', COLORS().value),
        n('decimals', 'decimals', { min: 0, max: 6 }), n('pad', 'pad', { min: 0, max: 8 }),
        el('label', { class: 'mini' }, 'show as', select_([['', 'number'], ['time', 'HH:MM']], L.format || '', v => { if (v) L.format = v; else delete L.format; update(); })));
      // Each value layer can show its own source, so one key can show several live values.
      const own = !!L.read;
      const srcBox = el('div', { class: 'layer-source' },
        el('label', { class: 'row' }, el('input', { type: 'radio', name: `vsrc${i}`, checked: own ? null : true, on: { change: () => { delete L.read; changed(); renderInspector(); } } }), ' the key\'s value'),
        el('label', { class: 'row' }, el('input', { type: 'radio', name: `vsrc${i}`, checked: own ? true : null, on: { change: () => { L.read = { var: '', unit: 'number' }; changed(); renderInspector(); } } }), ' its own source'));
      if (own) srcBox.append(sourceEditor(L.read, r => { L.read = r; if (r && r.hint) { for (const k of ['decimals', 'pad', 'format']) if (r.hint[k] !== undefined && L[k] === undefined) L[k] = r.hint[k]; delete r.hint; } }));
      fields.push(srcBox);
    } else if (L.kind === 'sublabel') {
      fields.push(n('x', 'x', { placeholder: 72 }), n('y', 'y', { placeholder: SUBLABEL_Y() }), n('size', 'size', { placeholder: 19 }), n('w', 'max width'), color('color', lookValue('dim', '#9aa0a8')));
      // Like a live value: the key's sublabel, or text chosen by its own source's value (user,
      // 2026-10-30), e.g. a second line saying which mode another simvar is in.
      const own = !!L.read;
      const srcBox = el('div', { class: 'layer-source' },
        el('label', { class: 'row' }, el('input', { type: 'radio', name: `ssrc${i}`, checked: own ? null : true, on: { change: () => { delete L.read; delete L.sublabels; delete L.sublabel; changed(); renderInspector(); } } }), ' the key\'s sublabel (set under Sublabel below)'),
        el('label', { class: 'row' }, el('input', { type: 'radio', name: `ssrc${i}`, checked: own ? true : null, on: { change: () => { L.read = { var: '', unit: 'number' }; L.sublabels = {}; changed(); renderInspector(); } } }), ' its own source'));
      if (own) {
        srcBox.append(sourceEditor(L.read, r => { L.read = r || { var: '', unit: 'number' }; if (r) delete r.hint; }),
          el('div', { class: 'muted' }, 'Text per value of this source:'),
          mapEditor(L.sublabels = L.sublabels || {}, (v, set) => input(v, x => { set(x); update(); }), { label: 'text', value: '' }),
          field('Other values', input(L.sublabel, v => { if (v) L.sublabel = v; else delete L.sublabel; update(); }), 'shown for values not listed; empty shows nothing'));
      }
      fields.push(srcBox);
    } else if (L.kind === 'bar') {
      fields.push(el('label', { class: 'mini' }, 'shows', select_([['', 'follows the key\'s state'], ['on', 'green'], ['armed', 'white (armed)'], ['off', 'red'], ['clear', 'clear (outline)']],
        L.look || '', v => { if (v) L.look = v; else delete L.look; update(); })),
      n('x', 'x'), n('y', 'y'), n('w', 'w'), n('h', 'h'), n('r', 'corner'),
        el('span', { class: 'muted' }, 'Empty fields use the bar measured from your icons.'));
    } else if (L.kind === 'rect') {
      fields.push(n('x', 'x'), n('y', 'y'), n('w', 'w'), n('h', 'h'), n('r', 'corner'), color('color', '#1e2a3a'));
    }
    const move = d => {
      const j = i + d;
      if (j < 0 || j >= face.layers.length) return;
      [face.layers[i], face.layers[j]] = [face.layers[j], face.layers[i]];
      faceLayer = j;
      changed(); renderInspector();
    };
    box.append(el('div', { class: `layer ${i === faceLayer ? 'active' : ''}`, on: { click: e => {
      if (faceLayer === i || e.target.closest('input, textarea, select, button')) return;
      faceLayer = i; renderInspector();
    } } },
    el('div', { class: 'layer-head' },
      el('input', { type: 'radio', name: 'faceLayer', checked: i === faceLayer ? true : null, title: 'Drag moves this layer', on: { change: () => { faceLayer = i; renderInspector(); } } }),
      el('strong', {}, LAYER_NAMES[L.kind] || L.kind),
      el('span', { class: 'muted' }, L.kind === 'bar' ? (L.look ? ` always ${{ on: 'green', armed: 'white', off: 'red', clear: 'clear' }[L.look]}` : ' green / red / outline by state') : L.kind === 'sublabel' ? (L.read ? ` ${L.read.input || L.read.var || '(choose a source)'}` : ' per value / step') : L.kind === 'value' ? (L.read ? ` ${L.read.input || L.read.var || '(choose a source)'}` : ' the key\'s value') : ''),
      el('span', { class: 'spacer' }),
      el('button', { title: 'Draw earlier (behind)', on: { click: () => move(-1) } }, '↑'),
      el('button', { title: 'Draw later (in front)', on: { click: () => move(1) } }, '↓'),
      el('button', { title: 'Remove layer', on: { click: () => { face.layers.splice(i, 1); faceLayer = Math.max(0, faceLayer - 1); changed(); renderInspector(); } } }, '✕')),
    el('div', { class: 'layer-fields' }, fields)));
  });
  box.append(el('button', { on: { click: () => {
    if (faceTarget === 'default') {
      if (!confirm('Go back to the automatic look?')) return;
      delete key.face;
    } else {
      if (!confirm(`Remove the face for value ${faceTarget}?`)) return;
      delete key.valueFaces[faceTarget];
      faceTarget = 'default';
    }
    changed(); renderInspector();
  } } }, faceTarget === 'default' ? 'Remove custom face' : `Remove face for value ${faceTarget}`));
  refresh();
  return box;
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

// ---------- look (font and colours) ----------

function lookValue(k, d) {
  return (S.look && S.look.style && S.look.style[k]) || d;
}

const LOOK_FIELDS = { readout: '#lookReadout', label: '#lookLabel', dim: '#lookDim', on: '#lookOn', off: '#lookOff', armed: '#lookArmed' };
const SAMPLE_KEYS = {
  0: { type: 'switch', label: 'FUEL\nPUMP', read: { input: 'X' }, states: { 0: 'off', 1: 'on' } },
  1: { type: 'switch', label: 'AVN\nBUS 1', read: { input: 'X' }, states: { 0: 'off', 1: 'on' } },
  2: { type: 'switch', label: 'STBY\nBATT', read: { input: 'X' }, states: { 0: 'off', 1: 'on' } },
  3: { type: 'readout', label: 'COM1', read: { var: 'X', unit: 'MHz' }, decimals: 3 },
  4: { type: 'button', label: '◀ MAG' },
  5: { type: 'armable', label: 'APR', read: { var: 'X', unit: 'bool' }, armed: { var: 'Y', unit: 'bool' } },
};

async function loadLook() {
  S.look = await api('GET', '/api/settings');
  const font = $('#lookFont');
  font.innerHTML = '';
  for (const f of S.look.fonts) font.append(el('option', { value: f, selected: f === S.look.style.font ? true : null }, f));
  for (const [k, sel] of Object.entries(LOOK_FIELDS)) $(sel).value = S.look.style[k];
  const m = S.look.measured;
  $('#lookMeasured').textContent = m.barSource
    ? `Measured from your icons: bar from ${m.barSource}${m.readoutSource ? `, readout colour from ${m.readoutSource}` : ''}.`
    : 'Could not measure your icons (icon folder not found?); using built-in defaults.';
  const { images } = await api('POST', '/api/render', { keys: SAMPLE_KEYS, values: { 0: 1, 1: 0, 2: undefined, 3: 124.85, 5: 'armed' } });
  const box = $('#lookSamples');
  box.innerHTML = '';
  for (const i of Object.keys(SAMPLE_KEYS)) box.append(el('img', { src: images[i], alt: '' }));
}

async function saveLook(change) {
  const settings = { ...S.look.settings, ...change };
  for (const [k, v] of Object.entries(settings)) if (v === null) delete settings[k];
  await api('PUT', '/api/settings', settings);
  await loadLook();
  renderGrid();
  loadLibrary();
}

function bindLook() {
  $('#lookFont').addEventListener('change', e => saveLook({ font: e.target.value }));
  let t = null;
  for (const [k, sel] of Object.entries(LOOK_FIELDS)) {
    $(sel).addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => saveLook({ [k]: e.target.value }), 250); });
  }
  for (const b of document.querySelectorAll('#lookPanel [data-reset]')) {
    b.addEventListener('click', e => { e.preventDefault(); saveLook({ [b.dataset.reset]: null }); });
  }
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
  $('#saveToLibrary').addEventListener('click', saveToLibrary);
  let libTimer = null;
  $('#libSearch').addEventListener('input', () => { clearTimeout(libTimer); libTimer = setTimeout(renderLibrary, 200); });
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

  bindLook();
  await loadLook();
  S.sim = await api('GET', '/api/state');
  $('#folderNote').textContent = `Profiles are saved in ${S.sim.profilesDir}`;
  S.icons = await api('GET', '/api/icons');
  await loadFiles();
  loadLibrary();
  loadInputs();
  pollState();
  setInterval(pollState, 1500);
  setInterval(loadInputs, 15000);
}

init().catch(e => status(`Editor failed to start: ${e.message}`, 'bad'));
