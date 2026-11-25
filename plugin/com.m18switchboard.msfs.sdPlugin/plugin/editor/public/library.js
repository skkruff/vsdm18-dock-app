// Switchboard editor: Copy and paste, and the key library (save, insert, drag onto the dock picture).
// Classic script sharing the page's globals with the other editor scripts (index.html order).

'use strict';

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
// Keys that can sit where they are going: keypad keys only in the keypad layout, which takes
// keypad and decorative keys only (review 2026-10-30: a keypad key pasted into a page stopped the
// profile saving; a switch in the keypad would do nothing).
const fitsHere = key => (S.page === KP ? key.type === 'keypad' || key.type === 'decor' : key.type !== 'keypad');

function placeGroup(group, anchor, renameFrom, renameTo) {
  const [r0, c0] = rc(anchor);
  let placed = 0;
  let unfit = 0;
  for (const g of group) {
    const slot = slotOf(r0 + g.dr, c0 + g.dc);
    if (slot === null) continue;
    if (!fitsHere(g.key)) { unfit++; continue; }
    let key = clone(g.key);
    if (renameFrom) key = renameSource(key, renameFrom, renameTo);
    keys()[slot] = key;
    placed++;
  }
  if (unfit) status(S.page === KP ? `${unfit} key(s) left out: the keypad takes keypad and decorative keys only` : `${unfit} keypad key(s) left out: they belong in the Keypad tab`, 'bad');
  else if (placed < group.length) status(`${group.length - placed} key(s) did not fit and were left out`, 'bad');
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
const libOpen = new Set([GROUPS]); // headings the user has open, kept across redraws
const isGroup = item => item.keys.length > 1;
const categoriesOf = item => {
  const cats = [];
  if (item.category && item.category !== GROUPS) cats.push(item.category);
  if (isGroup(item)) cats.push(GROUPS);
  return cats.length ? cats : ['Other'];
};
const typeOf = item => (isGroup(item) ? GROUPS : ((typeof KEY_TYPES !== 'undefined' && KEY_TYPES[item.keys[0].key.type]) || {}).name || item.keys[0].key.type);
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

// Grouping, kept per viewer: by category, by key type, or none (A-Z) (user, 2026-11-17).
function libGroupBy() {
  try { return localStorage.getItem('switchboard.libGroupBy') || 'category'; } catch { return 'category'; }
}

// The library (user, 2026-11-17): key faces with their titles, A-Z, under headings; below, the
// selected item: what it reads and does, its name, category and notes, Insert and Delete.
let librarySeq = 0;
async function renderLibrary() {
  // Several redraws can overlap (search, save, look change); only the newest may draw, otherwise
  // each appends its own copy of the list (user report 2026-10-28: categories repeated).
  const seq = ++librarySeq;
  const list = $('#libraryList');
  const q = $('#libSearch').value.trim().toLowerCase();
  const mode = libGroupBy();
  $('#libGroupBy').value = mode;
  const items = S.library.filter(i => !q || `${i.name} ${i.category} ${i.notes || ''}`.toLowerCase().includes(q)).sort(byName);
  const thumbs = await libraryThumbs(items);
  if (seq !== librarySeq) return;
  list.innerHTML = '';
  if (!items.length) list.append(el('div', { class: 'muted' }, q ? 'Nothing matches.' : 'The library is empty.'));
  const headsOf = item => (mode === 'type' ? [typeOf(item)] : mode === 'none' ? [''] : categoriesOf(item));
  const order = c => (c === GROUPS ? '0' : `1${c}`);
  const heads = [...new Set(items.flatMap(headsOf))].sort((a, b) => order(a).localeCompare(order(b)));
  const tile = (item, i) => el('div', {
    class: `lib-item ${S.libSel === item.id ? 'selected' : ''}`, draggable: 'true', 'data-id': item.id, title: item.name,
    on: {
      click: () => { S.libSel = item.id; renderLibraryDetail(); for (const t of list.querySelectorAll('.lib-item')) t.classList.toggle('selected', t.dataset.id === item.id); },
      dblclick: () => insertItem(item),
      dragstart: e => { S.draggingItem = item; e.dataTransfer.setData('application/x-library', item.id); },
      dragend: () => { S.draggingItem = null; clearDropMarks(); },
    },
  },
  el('div', { class: 'lib-thumb' }, el('img', { src: thumbs[i], alt: '' }), isGroup(item) ? el('span', { class: 'lib-count' }, `×${item.keys.length}`) : null),
  el('div', { class: 'name' }, item.name));
  for (const head of heads) {
    const grid = el('div', { class: 'lib-grid' });
    items.forEach((item, i) => { if (headsOf(item).includes(head)) grid.append(tile(item, i)); });
    if (mode === 'none') { list.append(grid); continue; }
    const group = el('details', { class: 'lib-cat', 'data-cat': head, open: q || libOpen.has(head) ? true : null },
      el('summary', {}, `${head} (${grid.children.length})`), grid);
    group.addEventListener('toggle', () => { if (!q) { if (group.open) libOpen.add(head); else libOpen.delete(head); } });
    list.append(group);
  }
  renderLibraryDetail();
}

// ---------- what a key does, in a line or two (library detail) ----------

const srcText = r => (!r ? null : r.timer !== undefined ? `stopwatch ${r.timer}${r.part === 'running' ? ' (running)' : ''}`
  : r.sim ? 'sim paused' : r.input ? r.input : r.var ? `${r.var} (${r.unit || 'number'})` : null);
function actionText(key, a) {
  if (a === undefined || a === null) return 'nothing';
  if (Array.isArray(a)) return a.map(x => actionText(key, x)).join(', then ');
  if (a.tap !== undefined || (a.hold !== undefined && typeof a.hold === 'object')) {
    return [a.tap !== undefined ? `tap: ${actionText(key, a.tap)}` : null, a.hold !== undefined ? `hold ${a.holdMs || 400} ms: ${actionText(key, a.hold)}` : null].filter(Boolean).join(' · ');
  }
  if (a.keypad !== undefined) return `keypad ${typeof a.keypad === 'string' ? a.keypad : a.keypad.preset || a.keypad.title || '(own)'}`;
  if (a.timer !== undefined) return `stopwatch ${a.timer}: ${a.action || 'toggle'}`;
  if (a.keys !== undefined) return `keys ${a.keys}${a.whileHeld ? ' (held)' : ''}`;
  if (a.event !== undefined) return `${a.event}${a.toggleValue ? ' 1/0' : a.value !== undefined ? ` = ${a.value}` : ''}${a.release !== undefined ? `, ${a.release} on release` : ''}`;
  const t = a.var && a.var.var ? a.var.var : a.input || (key.read && key.read.input) || '?';
  const x = a.scale ? ` ×${a.scale}` : '';
  const rep = a.repeatMs ? ` every ${a.repeatMs} ms` : '';
  if (a.cycle) return `cycles ${t}: ${a.cycle.join(' / ')}${x}`;
  if (a.step !== undefined) {
    const lim = a.min !== undefined && a.max !== undefined ? `${a.min}–${a.max}` : a.min !== undefined ? `min ${a.min}` : a.max !== undefined ? `max ${a.max}` : '';
    const range = lim ? ` (${lim}${a.wrap ? ', wraps' : ''})` : '';
    return `steps ${t} ${a.step > 0 ? '+' : ''}${a.step}${range}${rep}${x}`;
  }
  if (typeof a.hold === 'number') return `holds ${t} at ${a.hold}${a.release !== undefined ? `, ${a.release} on release` : ''}${rep}${x}`;
  if (a.set !== undefined) return `sets ${t} to ${a.set}${x}`;
  return 'nothing';
}
function valuesText(key) {
  if (key.logic) return `${key.logic.steps.length} step${key.logic.steps.length > 1 ? 's' : ''} of state logic`;
  const look = { on: 'green', off: 'red', armed: 'white', clear: 'clear', none: 'no bar' };
  const maps = [key.states || {}, key.sublabels || {}, key.text || {}];
  const vals = [...new Set(maps.flatMap(m => Object.keys(m)))].sort((a, b) => Number(a) - Number(b));
  if (!vals.length) return null;
  return vals.map(v => [v, (key.text || {})[v] || (key.sublabels || {})[v], look[(key.states || {})[v]]].filter(Boolean).join(' ')).join(' · ');
}
function keyLines(key) {
  const k = key;
  const type = ((typeof KEY_TYPES !== 'undefined' && KEY_TYPES[k.type]) || {}).name || k.type;
  const src = srcText(k.read) || (k.logic ? 'state logic' : null);
  return [
    ['Type', type],
    src ? ['Reads', src] : null,
    valuesText(k) ? ['Values', valuesText(k)] : null,
    k.press ? ['Does', actionText(k, k.press)] : null,
  ].filter(Boolean);
}

function renderLibraryDetail() {
  const box = $('#libraryDetail');
  box.innerHTML = '';
  const item = S.library.find(i => i.id === S.libSel);
  if (!item) { box.append(el('div', { class: 'muted' }, 'Select a key or group')); return; }
  const patch = async change => { await api('PATCH', `/api/library/${encodeURIComponent(item.id)}`, change); Object.assign(item, change); };
  const name = el('input', { class: 'lib-name', value: item.name, title: 'Name (rename here)', on: { change: async e => {
    const v = e.target.value.trim();
    if (!v) { e.target.value = item.name; return; }
    await patch({ name: v }); renderLibrary();
  } } });
  const cats = [...new Set(S.library.map(i => i.category).filter(c => c && c !== GROUPS))].sort();
  const cat = el('select', { title: 'Category', on: { change: async e => {
    let v = e.target.value;
    if (v === '__new__') { v = (prompt('New category') || '').trim(); if (!v || v.toLowerCase() === GROUPS.toLowerCase()) { e.target.value = item.category; return; } }
    await patch({ category: v }); libOpen.add(v); renderLibrary();
  } } }, ...cats.map(c => el('option', { value: c, selected: c === item.category ? true : null }, c)), el('option', { value: '__new__' }, 'New…'));
  const rows = isGroup(item)
    ? item.keys.map(g => el('div', { class: 'lib-key' }, el('div', { class: 'lib-key-name' }, (g.key.label || g.key.icon || g.key.type).replace(/\n/g, ' ')),
      ...keyLines(g.key).filter(([k]) => k !== 'Type').map(([k, v]) => el('div', { class: 'lib-line' }, el('span', { class: 'muted' }, k), ' ', v))))
    : keyLines(item.keys[0].key).map(([k, v]) => el('div', { class: 'lib-line' }, el('span', { class: 'muted' }, k), ' ', v));
  const notes = el('textarea', { class: 'lib-notes', rows: 2, placeholder: 'Notes', on: { change: async e => { await patch({ notes: e.target.value.trim() }); } } }, item.notes || '');
  box.append(el('div', { class: 'lib-detail-head' }, name, cat),
    el('div', { class: 'lib-lines' }, rows), notes,
    el('div', { class: 'inline' },
      el('button', { class: 'primary', title: 'Insert at the selected key (or drag it onto the dock picture)', on: { click: () => insertItem(item) } }, 'Insert'),
      el('button', { on: { click: () => deleteItem(item) } }, 'Delete')));
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
    const saved = await api('POST', '/api/library', { name: name.value.trim(), category, keys: g });
    S.libSel = saved.id; // shown below the list straight away
    await loadLibrary();
    status(`"${name.value.trim()}" saved to ${category}${g.length > 1 ? ' (and Groups)' : ''}`, 'good');
  };
  dlg.append(el('h3', {}, `Save ${g.length > 1 ? `a group of ${g.length} keys` : 'this key'} to the library`),
    field('Name', name), field('Category', cat), field('', newCat),
    el('div', { class: 'dialog-buttons' }, el('button', { on: { click: close } }, 'Cancel'), el('button', { class: 'primary', id: 'libSaveOk', on: { click: ok } }, 'Save')));
  dlg.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
  document.body.append(dlg);
  dlg.showModal();
  showNew();
  name.select();
}

async function deleteItem(item) {
  if (!confirm(`Delete "${item.name}" from the library?`)) return;
  await api('DELETE', `/api/library/${encodeURIComponent(item.id)}`);
  if (S.libSel === item.id) S.libSel = null;
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
