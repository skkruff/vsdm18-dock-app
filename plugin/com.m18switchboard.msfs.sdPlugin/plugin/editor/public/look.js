// Switchboard editor: Icon picker, Look panel (font and colours), new profiles.
// Classic script sharing the page's globals with the other editor scripts (index.html order).

'use strict';

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
