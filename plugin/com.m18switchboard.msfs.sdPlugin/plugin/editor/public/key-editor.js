// Switchboard editor: the key editor, to the user's schema (docs/key-editor-schema.md, 2026-11-01).
// Types named after cockpit controls; three sections: where the key gets its information, what it
// looks like, what it does when pressed. The type sets the flow, defaults and save rules; the
// engine draws and acts from the fields.
// Classic script sharing the page's globals with the other editor scripts (index.html order).

'use strict';

const KEY_TYPES = {
  switch: { name: 'Switch / toggle', help: 'switchType' },
  button: { name: 'Button', help: 'buttonType' },
  rotary: { name: 'Rotary (dimmer, knob)', help: 'rotaryType' },
  readout: { name: 'Readout / annunciator', help: 'readoutType' },
  decor: { name: 'Decorative', help: 'decor' },
};
const LOOK_NAMES = [['on', 'green'], ['armed', 'white (armed)'], ['off', 'red'], ['clear', 'clear (outline)']];
const HOLD_MS = 400; // default tap / hold threshold: the hold-to-ramp delay proven in flight

// Which sections stay folded, across keys (user's choice while editing).
const folded = new Set();
function section(id, title, ...children) {
  const d = el('details', { class: 'key-section', 'data-section': id, open: folded.has(id) ? null : true },
    el('summary', {}, title), ...children);
  d.addEventListener('toggle', () => { if (d.open) folded.delete(id); else folded.add(id); });
  return d;
}

// Shown dimmed with the reason, rather than hidden, when another choice covers it.
function dimmed(node, reason) {
  if (!reason) return node;
  node.classList.add('dimmed');
  return el('div', { class: 'dimmed-wrap' }, node, el('div', { class: 'dim-note' }, reason));
}

// What a PNG icon or a face hides (user schema: hide/dim mutually exclusive choices).
function covers(key) {
  const png = !!key.icon && !key.face;
  return {
    label: png && key.type !== 'readout' && key.type !== 'rotary' ? 'Not shown: the PNG icon fills the key. A custom face can place text over it.'
      : png ? 'Not shown: the icon takes the label\'s place above the value.' : '',
    sublabel: png && key.type !== 'readout' && key.type !== 'rotary' ? 'Not shown: the PNG icon fills the key. A custom face can add a Sublabel layer.' : '',
  };
}

function renderKeyEditor(box, key, slot) {
  const redraw = () => { changed(); renderInspector(); };
  box.append(el('h3', {}, `Key ${slot}`));

  // Type
  const types = S.page === KP ? [['keypad', 'Keypad key'], ['decor', 'Decorative']] : Object.entries(KEY_TYPES).map(([k, v]) => [k, v.name]);
  box.append(field('Type', select_(types, key.type, v => { setType(key, v); redraw(); }), null,
    key.type === 'keypad' ? 'keypadKey' : (KEY_TYPES[key.type] || {}).help));
  const unused = unusedFields(key);
  if (unused.length) box.append(el('p', { class: 'muted' }, `Not used by this type, removed when you save: ${unused.join(', ')}.`));
  if (key.type === 'keypad') return keypadKeyEditor(box, key, slot);

  if (key.type !== 'decor') box.append(section('info', 'Gets its information from', ...infoSection(key)));
  box.append(section('look', 'Looks like', ...lookSection(key, slot)));
  if (key.type !== 'decor') box.append(section('press', 'When pressed', ...pressSection(key)));
  box.append(section('preview', 'Preview', ...previewSection(key, slot)));
  inspectorTail(box, key, slot);
}

// Changing type keeps everything until save (flip back and forth freely); it adds the new type's
// starting settings where the key has none.
function setType(key, v) {
  key.type = v;
  if (v === 'keypad' && !key.role) { key.role = 'digit'; key.digit = '1'; }
  if (v === 'switch' && !key.states) key.states = { 0: 'off', 1: 'on' };
  if (v === 'rotary') {
    if (!key.press) key.press = { tap: { step: 10, min: 0, max: 100, wrap: true }, hold: { step: 5, min: 0, max: 100, wrap: true, repeatMs: 100 } };
    if (key.suffix === undefined) key.suffix = '%';
  }
}

// Fields this type does not use; cleanUnused() removes them at save (user schema).
const READOUT_ONLY = ['logic', 'logicFaces'];
const FORMAT = ['decimals', 'pad', 'format', 'prefix', 'suffix', 'separator', 'text'];
const LEGACY = ['armed', 'activeIs', 'armedIs', 'activeOr', 'armedOr'];
const KEYPAD_ONLY = ['role', 'digit', 'vfr'];
function unusedFields(key) {
  const out = LEGACY.filter(f => key[f] !== undefined);
  if (key.type !== 'keypad') out.push(...KEYPAD_ONLY.filter(f => key[f] !== undefined));
  if (key.type !== 'readout') out.push(...READOUT_ONLY.filter(f => key[f] !== undefined));
  if (!['readout', 'rotary'].includes(key.type)) out.push(...FORMAT.filter(f => key[f] !== undefined && !(f === 'text' && key.type === 'switch')));
  // State logic decides the look: the per-value tables and number format are not shown.
  if (key.type === 'readout' && key.logic) out.push(...['states', 'otherwise', 'sublabels', 'valueIcons', 'valueFaces', ...FORMAT].filter(f => key[f] !== undefined && f !== 'separator'));
  if (key.type === 'decor' || key.type === 'keypad') out.push(...['read', 'press', 'states', 'otherwise', 'sublabels', 'valueIcons', 'valueFaces'].filter(f => key[f] !== undefined));
  return [...new Set(out)];
}
function cleanUnused(key) {
  for (const f of unusedFields(key)) delete key[f];
}

// Save rules (user schema): what each type needs before the profile saves.
function keyProblems(key) {
  const p = key.press;
  const pressNone = !p || (isTapHoldPress(p) && p.tap === undefined && p.hold === undefined);
  if (['switch', 'button', 'rotary'].includes(key.type) && pressNone) return `a ${KEY_TYPES[key.type].name.toLowerCase()} needs something to do when pressed`;
  if (key.type === 'readout' && !key.read && !key.logic) return 'a readout needs something to read (a source or state logic)';
  if (key.type === 'decor' && !key.label && !key.icon && !key.face && !key.sublabel) return 'a decorative key needs something on its face';
  return '';
}
const isTapHoldPress = p => !!p && !Array.isArray(p) && (p.tap !== undefined || (p.hold !== undefined && typeof p.hold === 'object'));

// ---------- 1. gets its information from ----------

function infoSection(key) {
  const out = [];
  out.push(sourceEditor(key.read, r => {
    if (r) key.read = r; else delete key.read;
    // A simvar chosen from the catalog brings a sensible number format for an unformatted readout.
    if (r && r.hint && (key.type === 'readout' || key.type === 'rotary')) {
      for (const k of ['decimals', 'pad', 'format']) if (r.hint[k] !== undefined && key[k] === undefined) key[k] = r.hint[k];
    }
    if (r) delete r.hint;
  }, { allowNone: key.type !== 'readout' || !!key.logic }));
  if (key.type !== 'readout' && !key.read) out.push(el('p', { class: 'muted' }, 'Optional: a source lets the key show the sim\'s state (a bar, a sublabel, a value).'));
  if (key.type === 'readout') {
    out.push(field('State logic', el('input', { type: 'checkbox', checked: key.logic ? true : null, on: { change: e => {
      if (e.target.checked) key.logic = { steps: [{ when: [{ read: key.read ? clone(key.read) : { var: '', unit: 'bool' } }], look: 'on' }], otherwise: { look: 'clear' } };
      else { delete key.logic; delete key.logicFaces; }
      changed(); renderInspector();
    } } }), 'Show a state chosen by conditions, checked in order (e.g. captured, else armed, else off)', 'logic'));
    if (key.logic) out.push(logicEditor(key));
  }
  // Sources used only by face layers live in the face designer; listed here so nothing is hidden.
  const layerSources = [key.face, ...Object.values(key.valueFaces || {}), ...Object.values(key.logicFaces || {})].filter(Boolean)
    .flatMap(f => f.layers || []).filter(L => L.read).map(L => L.read.input || L.read.var || (L.read.timer && `stopwatch ${L.read.timer}`) || (L.read.sim && 'sim paused')).filter(Boolean);
  if (layerSources.length) out.push(el('p', { class: 'muted' }, `Also read by face layers (edit in Looks like → face): ${[...new Set(layerSources)].join(', ')}`));
  return out;
}

// Readout state logic: steps checked in order, the first with any condition met wins.
function logicEditor(key) {
  const L = key.logic;
  const box = el('div', { class: 'ladder' });
  const lookSel = (o, d) => select_(LOOK_NAMES, o.look || d, v => { o.look = v; changed(); });
  const sub = o => input(o.sublabel, v => { if (v) { o.sublabel = v; ensureSublabelLayer(key); } else delete o.sublabel; changed(); }, { placeholder: 'sublabel', class: 'narrow-wide' });
  L.steps.forEach((s, i) => {
    const conds = el('div', { class: 'or-sources' });
    s.when.forEach((c, j) => {
      conds.append(el('div', { class: 'or-source' },
        el('div', { class: 'step-head' }, el('span', { class: 'or-word' }, j ? 'or' : 'when'),
          s.when.length > 1 ? el('button', { title: 'Remove this condition', on: { click: () => { s.when.splice(j, 1); changed(); renderInspector(); } } }, '✕') : null),
        sourceEditor(c.read, r => { c.read = r || { var: '', unit: 'bool' }; if (r) delete r.hint; }, { unit: 'bool' }),
        field('is', input(c.is ?? 1, v => { if (v === '' || v === '1') delete c.is; else c.is = isNaN(Number(v)) ? v : Number(v); changed(); }, { class: 'narrow' }))));
    });
    conds.append(el('button', { class: 'add-or', on: { click: () => { s.when.push({ read: { var: '', unit: 'bool' } }); changed(); renderInspector(); } } }, '+ or'));
    const move = d => { const j = i + d; if (j < 0 || j >= L.steps.length) return; [L.steps[i], L.steps[j]] = [L.steps[j], L.steps[i]]; moveLogicFaces(key, i, j); changed(); renderInspector(); };
    box.append(el('div', { class: 'step' },
      el('div', { class: 'step-head' }, el('span', { class: 'step-n' }, String(i + 1)), i ? 'otherwise, ' : '', 'show', lookSel(s, 'on'), sub(s),
        el('span', { class: 'spacer' }),
        el('button', { title: 'Check earlier', on: { click: () => move(-1) } }, '↑'),
        el('button', { title: 'Check later', on: { click: () => move(1) } }, '↓'),
        L.steps.length > 1 ? el('button', { title: 'Remove this step', on: { click: () => { L.steps.splice(i, 1); dropLogicFace(key, i); changed(); renderInspector(); } } }, '✕') : null),
      conds));
  });
  box.append(el('button', { on: { click: () => { L.steps.push({ when: [{ read: { var: '', unit: 'bool' } }], look: 'on' }); changed(); renderInspector(); } } }, '+ step'));
  L.otherwise = L.otherwise || {};
  box.append(el('div', { class: 'step' }, el('div', { class: 'step-head' }, el('span', { class: 'step-n' }, '…'), 'otherwise, show', lookSel(L.otherwise, 'clear'), sub(L.otherwise))));
  return box;
}
function moveLogicFaces(key, i, j) {
  if (!key.logicFaces) return;
  const a = key.logicFaces[i];
  const b = key.logicFaces[j];
  if (b) key.logicFaces[i] = b; else delete key.logicFaces[i];
  if (a) key.logicFaces[j] = a; else delete key.logicFaces[j];
}
function dropLogicFace(key, i) {
  if (!key.logicFaces) return;
  const out = {};
  for (const [k, f] of Object.entries(key.logicFaces)) {
    if (k === 'otherwise') out.otherwise = f;
    else if (Number(k) < i) out[k] = f;
    else if (Number(k) > i) out[Number(k) - 1] = f;
  }
  key.logicFaces = out;
}

// ---------- 2. looks like ----------

function lookSection(key, slot) {
  const out = [];
  const cov = covers(key);
  out.push(dimmed(field('Label', el('textarea', { rows: 2, on: { input: e => { key.label = e.target.value; changed(); } } }, key.label || ''),
    'A new line starts a second line.'), cov.label));
  const switchLike = key.type === 'switch';
  out.push(field('Icon', el('div', { class: 'icon-chip' },
    iconThumb(key.icon ? (switchLike ? `${key.icon}_on` : key.icon) : null),
    el('span', {}, key.icon || 'none (drawn tile)'),
    el('button', { on: { click: () => pickIcon(switchLike ? 'switch' : 'any', name => { if (name) key.icon = name; else delete key.icon; changed(); renderInspector(); }) } }, 'Choose…')),
  switchLike ? 'Switch icons use the icon\'s on / off / clear versions.' : key.type === 'readout' || key.type === 'rotary' ? 'Drawn above the value, scaled to fit.' : null));
  out.push(dimmed(field('Sublabel', input(key.sublabel, v => { if (v) { key.sublabel = v; ensureSublabelLayer(key); } else delete key.sublabel; changed(); }),
    key.read ? 'shown for any value without its own below' : 'smaller text under the label'), cov.sublabel));
  const missing = facesOf(key).filter(f => !(f.layers || []).some(L => L.kind === 'sublabel'));
  if (missing.length && (key.sublabel || (key.sublabels && Object.keys(key.sublabels).length))) {
    out.push(el('p', { class: 'warn' }, 'This key has a custom face, which shows the sublabel only where it has a Sublabel layer. ',
      el('button', { on: { click: () => { for (const f of missing) f.layers.push(NEW_LAYER.sublabel()); changed(); renderInspector(); } } }, 'Add it to the face')));
  }
  if (key.type === 'keypad' || key.type === 'decor') {
    out.push(el('h4', {}, 'Face (optional)'), faceDesigner(key, slot));
    return out;
  }

  // Per value: one table for everything that depends on the sim value.
  if (key.read && !key.logic) {
    const cols = key.type === 'switch' ? ['look', 'sublabel', 'icon'] : key.type === 'button' ? ['look', 'sublabel', 'icon']
      : ['text', 'sublabel', 'look', 'icon'];
    out.push(el('h4', {}, key.type === 'switch' ? 'Positions' : 'Per value', info('positions')), valueTable(key, cols));
    out.push(fillValues(key));
    if (key.type === 'switch' || key.type === 'button') {
      out.push(field('Other values', select_([['', 'clear (outline)'], ['on', 'green'], ['off', 'red'], ['armed', 'white (armed)']], key.otherwise || '', v => { if (v) key.otherwise = v; else delete key.otherwise; changed(); })));
    }
  }
  if (key.type === 'readout' || key.type === 'rotary') {
    if (!key.logic) {
      out.push(el('h4', {}, 'Value'));
      out.push(field('Decimals', input(key.decimals, v => { if (v === '') delete key.decimals; else key.decimals = Number(v); changed(); }, { type: 'number', min: 0, max: 6 })));
      out.push(field('Pad to digits', input(key.pad, v => { if (v === '') delete key.pad; else key.pad = Number(v); changed(); }, { type: 'number', min: 0, max: 8 }), 'e.g. 4 shows 7 as 0007'));
      out.push(field('Show as', select_([['', 'Number'], ['time', 'Time HH:MM (from seconds)'], ['duration', 'Stopwatch M:SS (from seconds)']], key.format || '', v => { if (v) key.format = v; else delete key.format; changed(); })));
      out.push(field('Unit before', input(key.prefix, v => { if (v) key.prefix = v; else delete key.prefix; changed(); }, { placeholder: 'e.g. QNH' }), null, 'units'));
      out.push(field('Unit after', input(key.suffix, v => { if (v) key.suffix = v; else delete key.suffix; changed(); }, { placeholder: 'e.g. %, RPM, FPM' })));
    }
    out.push(field('Separator', el('input', { type: 'checkbox', checked: key.separator ? true : null, on: { change: e => {
      if (e.target.checked) key.separator = true; else delete key.separator;
      changed();
    } } }), 'A line under the label, like SET ALTIMETER. In a custom face, add a Separator layer instead.'));
  }
  out.push(el('h4', {}, 'Face (optional)'), faceDesigner(key, slot));
  return out;
}

// One row per sim value: look, sublabel, value text, icon (states, sublabels, text, valueIcons).
const VALUE_MAPS = { look: 'states', sublabel: 'sublabels', text: 'text', icon: 'valueIcons' };
const VALUE_COLS = { look: 'look', sublabel: 'sublabel', text: 'shows (instead of the number)', icon: 'icon (whole key)' };
function valueTable(key, cols) {
  if (key.type === 'switch' && key.text && !key.sublabels) { key.sublabels = key.text; delete key.text; }
  const table = el('table', { class: 'map-table value-table' });
  const maps = () => cols.map(c => key[VALUE_MAPS[c]] || {});
  const values = () => [...new Set(maps().flatMap(m => Object.keys(m)))].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)));
  const setCell = (c, v, x) => {
    const name = VALUE_MAPS[c];
    if (x === '' || x === undefined) { if (key[name]) { delete key[name][v]; if (!Object.keys(key[name]).length) delete key[name]; } }
    else { key[name] = key[name] || {}; key[name][v] = x; if (c === 'sublabel') ensureSublabelLayer(key); }
    changed();
  };
  const draw = () => {
    table.innerHTML = '';
    table.append(el('tr', {}, el('td', { class: 'muted' }, 'sim value'), ...cols.map(c => el('td', { class: 'muted' }, VALUE_COLS[c])), el('td')));
    for (const v of values()) {
      let current = v;
      const cells = cols.map(c => {
        const name = VALUE_MAPS[c];
        const now = key[name] && key[name][current];
        if (c === 'look') return select_([['', '—'], ...LOOK_NAMES], now || '', x => setCell(c, current, x));
        if (c === 'icon') return el('div', { class: 'inline' }, iconThumb(now), el('button', { on: { click: () => pickIcon('any', n => { setCell(c, current, n || ''); draw(); }) } }, now ? '…' : '+'));
        return input(now, x => setCell(c, current, x), { class: 'narrow-wide' });
      });
      table.append(el('tr', {},
        el('td', {}, input(v, nv => {
          if (nv === '' || nv === current || values().includes(nv)) return;
          for (const c of cols) { const m = key[VALUE_MAPS[c]]; if (m && current in m) { m[nv] = m[current]; delete m[current]; } }
          current = nv;
          changed();
        }, { style: 'width:60px' })),
        ...cells.map(x => el('td', {}, x)),
        el('td', {}, el('button', { title: 'Remove this value', on: { click: () => { for (const c of cols) setCell(c, current, ''); draw(); } } }, '✕'))));
    }
    table.append(el('tr', {}, el('td', { colspan: cols.length + 2 }, el('button', { on: { click: () => {
      let n = 0;
      while (values().includes(String(n))) n++;
      const first = cols.includes('look') ? 'look' : cols[0];
      setCell(first, String(n), first === 'look' ? 'off' : first === 'text' || first === 'sublabel' ? '?' : '');
      draw();
    } } }, '+ value'))));
  };
  draw();
  return table;
}

// The values a catalog description lists, as [value, name]: "0 = Off; 1 = On" (the SDK's usual
// form) or "(0 off, 1 standby, 2 test)".
function enumValues(desc) {
  const eq = [...desc.matchAll(/(-?\d+)\s*=\s*([^;,\])]+)/g)].map(m => [m[1], m[2].trim()]);
  if (eq.length >= 2) return eq;
  const list = desc.match(/\(\s*-?\d+\s+[A-Za-z][^)]*\)/);
  if (!list) return [];
  return [...list[0].matchAll(/(-?\d+)\s+([A-Za-z][^,)]*)/g)].map(m => [m[1], m[2].trim()]);
}

// Fill the per-value rows: from the catalog's enum values (simvars), or by moving the control in
// the cockpit and recording its positions (input events) (user schema: the builder populates).
function fillValues(key) {
  const box = el('div', { class: 'inline fill-values' });
  const out = el('span', { class: 'test-out' });
  const add = (values, names = {}) => {
    // A readout shows the position's name instead of the number; a switch or button gets a look
    // per position (first off, the rest on) and the name as its sublabel.
    const asText = key.type === 'readout' || key.type === 'rotary';
    values.forEach((v, i) => {
      const name = names[v] ? names[v].toUpperCase() : undefined;
      if (asText) {
        if (!(key.text && key.text[v] !== undefined)) { key.text = key.text || {}; key.text[v] = name || v; }
        return;
      }
      key.states = key.states || {};
      if (key.states[v] === undefined) key.states[v] = i === 0 ? 'off' : 'on';
      if (name && !(key.sublabels && key.sublabels[v])) { key.sublabels = key.sublabels || {}; key.sublabels[v] = name; }
    });
    // A switch with no press yet steps through what was found.
    if (key.type === 'switch' && !key.press && values.length > 1) key.press = { cycle: values.map(Number) };
    changed(); renderInspector();
  };
  if (key.read && key.read.var !== undefined) {
    box.append(el('button', { title: 'Use the values the SDK lists for this simvar', on: { click: async e => {
      e.preventDefault();
      browseCache.simvars = browseCache.simvars || await api('GET', '/api/catalog/simvars');
      if (!key.read.var) { out.textContent = 'type or browse a simvar first'; return; }
      const c = browseCache.simvars.find(x => x.name === key.read.var) || browseCache.simvars.find(x => x.name === key.read.var.replace(/:\d+$/, ''));
      const pairs = c ? enumValues(c.desc) : [];
      if (!pairs.length) { out.textContent = 'the SDK lists no values for it: use Learn positions'; return; }
      add(pairs.map(m => m[0]), Object.fromEntries(pairs));
    } } }, 'Fill from the SDK'));
  }
  if (key.read && (key.read.input !== undefined || key.read.var !== undefined)) {
    let timer = null;
    const seen = [];
    const btn = el('button', { title: 'Move the control in the cockpit through all its positions, then Done', on: { click: async e => {
      e.preventDefault();
      if (timer) { clearInterval(timer); timer = null; btn.textContent = 'Learn positions'; return add(seen); }
      if (!key.read.input && !key.read.var) { out.textContent = 'choose the source first'; return; }
      seen.length = 0;
      btn.textContent = 'Done';
      out.textContent = 'move the control through its positions…';
      const read = async () => {
        try {
          const r = key.read.input ? await api('POST', '/api/test-input', { name: key.read.input }) : await api('POST', '/api/test-var', { var: key.read.var, unit: key.read.unit });
          const v = String(typeof r.value === 'number' ? Math.round(r.value) : r.value);
          if (!seen.includes(v)) { seen.push(v); out.textContent = `found: ${seen.join(', ')}`; }
        } catch (err) { out.textContent = err.message; }
      };
      read();
      timer = setInterval(read, 300);
    } } }, 'Learn positions');
    box.append(btn);
  }
  box.append(out);
  return box;
}

// ---------- 3. when pressed ----------

function pressSection(key) {
  const out = [];
  // The tap, hold and hold time are edited separately: each change reads the others from the key
  // as they are now (not as they were when the section was drawn).
  const now = () => {
    const p = key.press;
    const th = isTapHoldPress(p);
    return { tap: th ? p.tap : p, hold: th ? p.hold : undefined, holdMs: th ? p.holdMs : undefined };
  };
  const commit = ({ tap, hold, holdMs }) => {
    if (hold === undefined) { if (tap === undefined) delete key.press; else key.press = tap; }
    else key.press = { ...(tap !== undefined ? { tap } : {}), hold, ...(holdMs !== undefined ? { holdMs } : {}) };
    changed();
  };
  const { tap, hold, holdMs } = now();
  out.push(el('h4', {}, hold !== undefined ? 'Tap' : 'Press'));
  out.push(actionList(key, tap, a => commit({ ...now(), tap: a }), { allowSpring: hold === undefined }));
  out.push(field('Something else when held', el('input', { type: 'checkbox', checked: hold !== undefined ? true : null, on: { change: e => {
    const t = now().tap;
    if (e.target.checked) commit({ tap: Array.isArray(t) || !(t && typeof t.hold === 'number') ? t : undefined, hold: { event: '' } });
    else commit({ tap: t });
    renderInspector();
  } } }), hold !== undefined ? 'A tap acts when you let go before the hold time; a hold acts at the hold time' : 'Tap and hold do different things (e.g. tap toggles, hold resets)', 'tapHold'));
  if (hold !== undefined) {
    out.push(field('Hold for, ms', input(holdMs, v => commit({ ...now(), holdMs: v === '' ? undefined : Number(v) }), { type: 'number', min: 20, placeholder: String(HOLD_MS) }), 'Longer guards a function better'));
    out.push(el('h4', {}, 'Hold'));
    out.push(actionList(key, hold, a => commit({ ...now(), hold: a === undefined ? { event: '' } : a }), { repeat: true }));
  }
  return out;
}

// An action, or a list of actions done in order ("+ then").
function actionList(key, value, set, opts) {
  const box = el('div', { class: 'action-list' });
  const items = Array.isArray(value) ? value.slice() : value === undefined ? [] : [value];
  const commit = () => { const list = items.filter(a => a !== undefined); set(list.length === 0 ? undefined : list.length === 1 ? list[0] : list); };
  const shown = items.length ? items : [undefined];
  shown.forEach((a, i) => {
    box.append(el('div', { class: 'action-item' },
      i ? el('div', { class: 'step-head' }, el('span', { class: 'or-word' }, 'then'),
        el('button', { title: 'Remove this action', on: { click: () => { items.splice(i, 1); commit(); renderInspector(); } } }, '✕')) : null,
      actionEditor(key, a, na => { items[i] = na; if (na === undefined && i > 0) items.splice(i, 1); commit(); }, { ...opts, allowSpring: opts.allowSpring && shown.length === 1 })));
  });
  if (items.length) box.append(el('button', { class: 'add-or', title: 'Another action after this one, e.g. a second softkey', on: { click: () => { items.push({ event: '' }); commit(); renderInspector(); } } }, '+ then'));
  return box;
}

const ACTION_KINDS = [['none', 'Nothing'], ['cycle', 'Toggle / cycle values'], ['step', 'Step up or down'], ['set', 'Set a value'],
  ['spring', 'Hold a position while pressed (spring-loaded)'], ['event', 'Send a sim event'], ['keys', 'Press a keyboard shortcut'],
  ['keypad', 'Open a keypad'], ['timer', 'Stopwatch control']];
function actionKind(a) {
  if (!a) return 'none';
  if (a.keypad !== undefined) return 'keypad';
  if (a.timer !== undefined) return 'timer';
  if (a.keys !== undefined) return 'keys';
  if (a.event !== undefined) return 'event';
  if (a.cycle) return 'cycle';
  if (a.step !== undefined) return 'step';
  if (typeof a.hold === 'number') return 'spring';
  if (a.set !== undefined) return 'set';
  return 'none';
}

function actionEditor(key, a, set, { allowSpring = true, repeat = false } = {}) {
  const box = el('div', { class: 'action' });
  const kind = actionKind(a);
  const kinds = ACTION_KINDS.filter(([k]) => k !== 'spring' || allowSpring || kind === 'spring');
  box.append(field('Action', select_(kinds, kind, v => {
    const keep = a ? Object.fromEntries(['input', 'var'].filter(f => a[f] !== undefined).map(f => [f, a[f]])) : {};
    const fresh = { none: undefined, cycle: { cycle: [0, 1] }, step: { step: 1 }, set: { set: 1 }, spring: { hold: 1, release: 0 }, event: { event: '' },
      keys: { keys: '' }, keypad: { keypad: { preset: guessKeypad(key) } }, timer: { timer: (key.read && key.read.timer) || 'T1', action: 'toggle' } }[v];
    set(fresh && ['cycle', 'step', 'set', 'spring'].includes(v) ? { ...fresh, ...keep } : fresh);
    renderInspector();
  })));
  if (!a) return box;
  const num = v => (v === '' ? undefined : Number(v));
  const setA = (k, v) => { if (v === undefined || Number.isNaN(v)) delete a[k]; else a[k] = v; changed(); };
  if (kind === 'cycle') box.append(field('Values in order', input(a.cycle.join(', '), v => { a.cycle = v.split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n)); changed(); }), 'e.g. 0, 1 toggles; the next value after the current one is set'));
  if (kind === 'step') {
    box.append(field('Step', input(a.step, v => setA('step', num(v)), { type: 'number' }), '1 = up, -1 = down'));
    box.append(field('Minimum', input(a.min, v => setA('min', num(v)), { type: 'number' })));
    box.append(field('Maximum', input(a.max, v => setA('max', num(v)), { type: 'number' })));
    box.append(field('Wrap at the ends', el('input', { type: 'checkbox', checked: a.wrap ? true : null, on: { change: e => setA('wrap', e.target.checked || undefined) } }),
      'At the stop, go round to the other end (needs min and max); a repeating step turns back', 'wrap'));
  }
  if (kind === 'set') box.append(field('Value', input(a.set, v => setA('set', num(v)), { type: 'number' })));
  if (kind === 'spring') {
    box.append(field('While held', input(a.hold, v => setA('hold', num(v)), { type: 'number' })));
    box.append(field('On release', input(a.release, v => setA('release', num(v)), { type: 'number' })));
    box.append(field('Repeat every ms', input(a.repeatMs, v => setA('repeatMs', num(v)), { type: 'number', min: 0 }), 'Re-sends while held, for positions the aircraft drops. Empty = once. G1000 softkeys need 130 ms or less to stay held; the C172 START works at 250.'));
  }
  if (kind === 'keys') box.append(...shortcutEditor(a, { allowHeld: allowSpring }));
  if (kind === 'keypad') box.append(...keypadEditor(a));
  if (kind === 'timer') {
    box.append(field('Stopwatch', input(a.timer, v => { a.timer = v; changed(); }, { placeholder: 'T1' }), 'The same name as on the key showing its time'));
    box.append(field('Does', select_([['toggle', 'Start / stop'], ['reset', 'Reset to 0:00'], ['start', 'Start'], ['stop', 'Stop']], a.action || 'toggle', v => { a.action = v; changed(); })));
  }
  if (kind === 'event') {
    const evInput = input(a.event, v => { a.event = v; changed(); }, { placeholder: 'e.g. BAROMETRIC' });
    box.append(field('Event', el('div', { class: 'inline' }, evInput,
      el('button', { on: { click: () => browse('events', choice => { a.event = choice.name; if (choice.value !== undefined) a.value = choice.value; changed(); renderInspector(); }) } }, 'Browse…'),
      el('button', { title: 'Send it to the sim now, to see what it does', on: { click: async () => {
        try { await api('POST', '/api/send-event', { event: a.event, value: a.value }); status(`Sent ${a.event}`, 'good'); } catch (e) { status(e.message, 'bad'); }
      } } }, 'Send now'))));
    box.append(field('Value', input(a.value, v => setA('value', num(v)), { type: 'number' })));
    box.append(field('Send 1/0 opposite of current', el('input', { type: 'checkbox', checked: a.toggleValue ? true : null, on: { change: e => setA('toggleValue', e.target.checked || undefined) } })));
  }
  if (['cycle', 'step', 'set', 'spring'].includes(kind)) box.append(...actsOn(key, a));
  if (repeat && kind !== 'spring' && kind !== 'keypad') {
    box.append(field('Repeat while held', input(a.repeatMs, v => setA('repeatMs', num(v)), { type: 'number', min: 20, placeholder: 'once' }),
      kind === 'step' ? 'Every this many ms: a repeating step ramps (a dimmer), counting from the value it last sent' : 'Every this many ms while you keep holding'));
  }
  return box;
}

// What cycle / step / set / spring-loaded change: an input event or a simvar written directly.
function actsOn(key, a) {
  const out = [];
  const onVar = !!a.var;
  out.push(field('Acts on', select_([['input', 'Input event (cockpit control)'], ['var', 'Simvar (written directly)']], onVar ? 'var' : 'input', v => {
    if (v === 'var') {
      delete a.input;
      a.var = { var: key.read && key.read.var ? key.read.var : '', unit: key.read && key.read.var ? key.read.unit || 'number' : 'number' };
    } else delete a.var;
    changed(); renderInspector();
  }), null, 'actsOn'));
  if (!onVar) {
    const inp = input(a.input, v => { if (v) a.input = v; else delete a.input; changed(); }, { list: 'inputList', placeholder: key.read && key.read.input ? `(same as source: ${key.read.input})` : 'input event' });
    out.push(field('Input event', el('div', { class: 'inline' }, inp,
      el('button', { on: { click: () => browse('inputs', c => { a.input = c.name; changed(); renderInspector(); }) } }, 'Browse…'))));
  } else {
    const tv = a.var;
    out.push(field('Simvar', el('div', { class: 'inline' },
      input(tv.var, v => { tv.var = v; changed(); }, { placeholder: 'e.g. TRANSPONDER STATE:1' }),
      el('button', { on: { click: () => browse('simvars', c => { tv.var = c.name; if (c.unit) tv.unit = c.unit; changed(); renderInspector(); }) } }, 'Browse…'))));
    out.push(field('Unit', input(tv.unit, v => { tv.unit = v || 'number'; changed(); }, { list: 'unitList' })));
    const val = input(a.set ?? (typeof a.hold === 'number' ? a.hold : '') ?? (a.cycle ? a.cycle[0] : ''), () => {}, { type: 'number', class: 'narrow' });
    const res = el('span', { class: 'test-out' });
    out.push(field('Set now', el('div', { class: 'inline' }, val,
      el('button', { title: 'Write this value to the simvar now and read it back', on: { click: async e => {
        e.preventDefault();
        res.textContent = '…';
        try {
          const r = await api('POST', '/api/set-var', { var: tv.var, unit: tv.unit, value: val.value });
          res.textContent = r.kept ? `now ${r.value}: kept` : r.value === null ? 'no value read back' : `now ${r.value}: the sim did not keep it`;
          res.className = `test-out ${r.kept ? 'good' : 'bad'}`;
        } catch (err) { res.textContent = err.message; res.className = 'test-out bad'; }
      } } }, 'Set'), res), 'Writes the value once to see if the sim keeps it. Simvars marked [settable] in Browse are the ones the SDK says can be set.'));
  }
  out.push(field('Sends ×', input(a.scale, v => { const n = Number(v); if (v === '' || n === 1 || !(n > 0)) delete a.scale; else a.scale = n; changed(); },
    { type: 'number', step: 'any', min: 0, placeholder: '1', class: 'narrow' }), 'For controls set in other units than they read: 0.01 when it reads 0-100 but is set 0-1', 'sendScale'));
  return out;
}

// ---------- preview ----------

function previewSection(key, slot) {
  const pvKey = `${S.page}:${slot}`;
  const onChange = v => { S.previewValues[pvKey] = v; renderGrid(); renderInspector(); previewOnDockUpdate(); };
  if (key.logic) {
    const steps = key.logic.steps.map((s, i) => [`step ${i + 1}`, `step ${i + 1}${s.sublabel ? ` (${s.sublabel})` : ''}`]);
    return [field('Preview', select_([['', isLivePage() ? 'live from sim' : 'step 1 (default)'], ...steps, ['otherwise', 'otherwise']], S.previewValues[pvKey] || '', onChange))];
  }
  if (key.type === 'decor') return [el('p', { class: 'muted' }, 'A decorative key looks the same whatever the sim does.')];
  return [field('Preview value', input(S.previewValues[pvKey], onChange, { placeholder: isLivePage() ? 'live from sim' : `default: ${defaultPreview(key) ?? 'unknown'}` }),
    'Try values to see each look. Empty = live value (when this page is on the dock) or a default.')];
}

// ---------- keypad layout keys ----------

function keypadKeyEditor(box, key, slot) {
  box.append(field('Role', select_(Object.entries(KEYPAD_ROLES), key.role || 'digit', v => {
    key.role = v;
    if (v === 'digit') key.digit = key.digit || '1'; else delete key.digit;
    changed(); renderInspector();
  })));
  if (key.role === 'digit') box.append(field('Digit', select_([...'1234567890'].map(d => [d, d]), String(key.digit ?? '1'), v => { key.digit = v; changed(); renderInspector(); })));
  // 9 is not a transponder digit: on keypads with a VFR code it becomes VFR (user, 2026-10-30).
  if (key.role === 'digit' && String(key.digit) === '9') {
    box.append(field('VFR on transponders', el('input', { type: 'checkbox', checked: key.vfr === false ? null : true, on: { change: e => { if (e.target.checked) delete key.vfr; else key.vfr = false; changed(); } } }),
      'On keypads with a VFR code (the transponder), this key shows VFR and sets that code'));
  }
  box.append(section('look', 'Looks like', ...lookSection(key, slot)));
  inspectorTail(box, key, slot);
}
