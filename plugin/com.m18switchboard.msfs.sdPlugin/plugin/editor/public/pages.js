// Switchboard editor: Profile settings, page tabs (and the keypad layout tab), the dock picture.
// Classic script sharing the page's globals with the other editor scripts (index.html order).

'use strict';

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
  // The keypad layout: not a page of this profile, one layout for every keypad (user, 2026-10-30).
  if (S.keypad) {
    tabs.append(el('div', {
      class: `tab tab-keypad ${S.page === KP ? 'active' : ''}`,
      title: 'The keypad shown by every "Open a keypad" key, in every profile',
      on: { click: () => { S.page = KP; S.selected.clear(); renderAll(); } },
    }, 'Keypad', el('span', { class: 'muted' }, ' (all keypads)')));
  }
  const note = $('#keypadNote');
  note.hidden = S.page !== KP;
  if (S.page === KP) {
    note.innerHTML = '';
    note.append(el('span', {}, `The keypad layout used by every keypad${S.keypad.builtIn ? ' (the built-in one)' : ''}. Give each key a role in the inspector; style it like any key. Save stores it for all profiles. `),
      el('button', { on: { click: async () => {
        if (!confirm('Go back to the built-in keypad layout?')) return;
        await api('PUT', '/api/keypad', { reset: true });
        await loadKeypad();
        S.kpDirty = false; setDirty(S.dirty);
        renderAll();
        status('Keypad back to the built-in layout', 'good');
      } } }, 'Reset to built-in'),
      ...(S.keypad.problems || []).map(p => el('div', { class: 'warn' }, `⚠ ${p}`)));
  }
}

async function loadKeypad() {
  const r = await api('GET', '/api/keypad');
  S.keypad = { name: 'Keypad', keys: clone(r.keys), builtIn: r.builtIn, problems: r.problems, presets: r.presets };
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
  const notKeypad = () => { if (S.page === KP) { status('The keypad is not a page of this profile', 'bad'); return false; } return true; };
  $('#renamePage').addEventListener('click', () => {
    if (!notKeypad()) return;
    const name = prompt('Page name', page().name);
    if (!name) return;
    page().name = name;
    setDirty(); renderTabs();
  });
  $('#delPage').addEventListener('click', () => {
    if (!notKeypad()) return;
    if (S.profile.pages.length === 1) return status('A profile needs at least one page', 'bad');
    if (!confirm(`Delete page "${page().name}"?`)) return;
    S.profile.pages.splice(S.page, 1);
    S.page = Math.max(0, S.page - 1);
    setDirty(); renderAll();
  });
  const move = d => {
    if (!notKeypad()) return;
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
    if (!notKeypad()) return;
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
