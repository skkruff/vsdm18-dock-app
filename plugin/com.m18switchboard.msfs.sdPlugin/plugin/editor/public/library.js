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
