// Switchboard editor: Inspector parts: keypad and keyboard shortcut actions, sources, Learn, armable ladder.
// Classic script sharing the page's globals with the other editor scripts (index.html order).

'use strict';

const KEYPAD_ROLES = { digit: 'Digit', ent: 'ENT (set the value)', del: 'DEL (last digit)', clr: 'CLR (all digits)',
  cancel: 'CANCEL (close)', vfr: 'VFR (sets the VFR code)', title: 'Title, with the value now', now: 'Value now', typed: 'Digits typed' };

// Keypad (user, 2026-10-30): a preset (XPDR, COM / NAV standby) or your own.
const KEYPAD_PRESETS = {
  xpdr: 'Transponder code (4 digits, 0-7)', com1: 'COM1 standby (e.g. 124.850)', com2: 'COM2 standby',
  nav1: 'NAV1 standby (e.g. 110.50)', nav2: 'NAV2 standby',
};
function guessKeypad(key) {
  const v = (key.read && (key.read.var || key.read.input)) || '';
  if (/TRANSPONDER|XPNDR/i.test(v)) return 'xpdr';
  if (/NAV.*:2/i.test(v)) return 'nav2';
  if (/NAV/i.test(v)) return 'nav1';
  if (/COM.*:2/i.test(v)) return 'com2';
  return /COM/i.test(v) ? 'com1' : 'xpdr';
}

function keypadEditor(key) {
  const k = key.press.keypad;
  const custom = !k.preset;
  const rows = [
    field('Keypad for', select_([...Object.entries(KEYPAD_PRESETS), ['', 'Your own (digits, where it goes)']], k.preset || '', v => {
      if (v) key.press.keypad = { preset: v, ...(k.title ? { title: k.title } : {}) };
      else key.press.keypad = { title: k.title || 'ENTER', digits: 4, decimals: 0, apply: { event: '' } };
      changed(); renderInspector();
    }), null, 'keypad'),
    field('Title', input(k.title, v => { if (v) k.title = v; else delete k.title; changed(); }, { placeholder: custom ? 'ENTER' : 'as the preset' }), 'Shown on the keypad, with the key\'s value now'),
  ];
  // The code a VFR key sets: MSFS has no VFR event, a VFR button just sets this code.
  const presetVfr = k.preset && S.keypad && S.keypad.presets && S.keypad.presets[k.preset] ? S.keypad.presets[k.preset].vfr : undefined;
  if (custom || presetVfr) {
    rows.push(field('VFR code', input(k.vfr, v => { if (v) k.vfr = v; else delete k.vfr; changed(); }, { placeholder: presetVfr || 'none', style: 'width:100px' }),
      presetVfr ? `Set by the VFR key; empty = ${presetVfr} (US). Europe: 7000` : 'Optional: a code the VFR key sets (e.g. 1200, 7000)'));
  }
  const num = (o, f) => v => { if (v === '') delete o[f]; else o[f] = Number(v); changed(); };
  if (custom) {
    rows.push(
      field('Digits', input(k.digits, num(k, 'digits'), { type: 'number', min: 1, max: 10 })),
      field('After the decimal point', input(k.decimals, num(k, 'decimals'), { type: 'number', min: 0, max: 9 })),
      field('Digits 0-7 only', el('input', { type: 'checkbox', checked: k.octal ? true : null, on: { change: e => { if (e.target.checked) k.octal = true; else delete k.octal; changed(); } } })),
      field('Set when all digits are in', el('input', { type: 'checkbox', checked: k.autoEnter === false ? null : true, on: { change: e => { if (e.target.checked) delete k.autoEnter; else k.autoEnter = false; changed(); } } }), 'Otherwise only on ENT'));
  }

  // Where the value goes: shown and editable for presets too, so another pathway can be tried if
  // the preset's does not work in an aircraft (user, 2026-10-30). Editing a preset's stores the
  // whole pathway on this key; "Back to the preset's" removes it.
  const presetApply = (k.preset && S.keypad && S.keypad.presets && S.keypad.presets[k.preset] && S.keypad.presets[k.preset].apply) || {};
  const own = k.apply || {};
  const ownTarget = own.event !== undefined || own.var !== undefined || own.input !== undefined;
  const eff = { ...presetApply, ...own };
  if (ownTarget) for (const f of ['event', 'var', 'unit', 'input']) if (own[f] === undefined) delete eff[f];
  const backBtn = el('button', { hidden: k.apply === undefined ? true : null, on: { click: e => { e.preventDefault(); delete k.apply; changed(); renderInspector(); } } }, 'Back to the preset\'s pathway');
  const changedMark = el('span', { class: 'warn' }, !custom && k.apply !== undefined ? ' (changed from the preset\'s)' : '');
  const editApply = fn => {
    k.apply = clone(eff);
    fn(k.apply);
    if (!custom) { changedMark.textContent = ' (changed from the preset\'s)'; backBtn.hidden = false; }
    changed();
  };
  const target = eff.var !== undefined ? 'var' : eff.input !== undefined ? 'input' : 'event';
  rows.push(el('h4', {}, 'Sends the value', changedMark));
  rows.push(field('Sets', select_([['event', 'A sim event, with the value'], ['var', 'A simvar'], ['input', 'An input event']], target, v => {
    editApply(a => { for (const f of ['event', 'var', 'unit', 'input']) delete a[f]; if (v === 'var') { a.var = ''; a.unit = 'number'; } else a[v] = ''; });
    renderInspector();
  })));
  const targetIn = input(eff[target], v => editApply(a => { a[target] = v; }), target === 'input' ? { list: 'inputList' } : {});
  rows.push(field(target === 'event' ? 'Event' : target === 'var' ? 'Simvar' : 'Input event', el('div', { class: 'inline' },
    targetIn,
    el('button', { on: { click: () => browse(target === 'event' ? 'events' : target === 'var' ? 'simvars' : 'inputs', c => {
      editApply(a => { a[target] = c.name; if (target === 'var' && c.unit) a.unit = c.unit; });
      renderInspector();
    }) } }, 'Browse…'))));
  if (target === 'var') rows.push(field('Unit', input(eff.unit, v => editApply(a => { a.unit = v || 'number'; }), { list: 'unitList' })));
  rows.push(field('Value sent', select_([['number', 'The number'], ['bcd16', 'BCD (digits as hex, e.g. XPNDR_SET)']], eff.encode || 'number', v => {
    editApply(a => { if (v === 'number') delete a.encode; else a.encode = v; });
    renderInspector();
  })));
  if ((eff.encode || 'number') === 'number') rows.push(field('Multiplied by', input(eff.scale, v => editApply(a => { if (v === '') delete a.scale; else a.scale = Number(v); }), { type: 'number', placeholder: '1' }), 'e.g. 1000000 to send MHz as Hz'));
  if (!custom) rows.push(field('', backBtn));
  // Try the pathway now with some digits, as ENT would.
  const tryVal = input('', () => {}, { placeholder: 'digits, e.g. 1200', style: 'width:130px' });
  const tryOut = el('span', { class: 'test-out' });
  rows.push(field('Try it', el('div', { class: 'inline' }, tryVal, el('button', { on: { click: async e => {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/keypad-test', { keypad: key.press.keypad, typed: tryVal.value });
      tryOut.textContent = `sent ${r.value} to ${r.apply.event || r.apply.var || r.apply.input}`; tryOut.className = 'test-out';
    } catch (err) { tryOut.textContent = err.message; tryOut.className = 'test-out bad'; }
  } } }, 'Send'), tryOut), 'Sends the digits now, as ENT would; check the cockpit'));
  rows.push(field('Preview', el('button', { on: { click: async e => {
    e.preventDefault();
    try {
      const { images } = await api('POST', '/api/render-keypad', { keypad: key.press.keypad });
      showImages(images);
      setTimeout(renderGrid, 4000);
    } catch (err) { status(err.message, 'bad'); }
  } } }, 'Show the keypad on the dock picture')));
  return rows;
}

// Keyboard shortcut press (user, 2026-10-30): type it, or click Record and press the keys.
const BROWSER_KEY_NAMES = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', PageUp: 'PgUp', PageDown: 'PgDn' };
const MODIFIER_CODES = ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'];
function shortcutFromEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push(e.code === 'ControlRight' ? 'RCtrl' : 'Ctrl');
  if (e.shiftKey) parts.push(e.code === 'ShiftRight' ? 'RShift' : 'Shift');
  if (e.altKey) parts.push(e.code === 'AltRight' ? 'RAlt' : 'Alt');
  if (e.metaKey) parts.push('Win');
  if (!MODIFIER_CODES.includes(e.code)) parts.push(BROWSER_KEY_NAMES[e.code] || e.code.replace(/^Key/, '').replace(/^Digit/, ''));
  return { text: parts.join('+'), complete: !MODIFIER_CODES.includes(e.code) };
}

function shortcutEditor(key) {
  const p = key.press;
  const note = el('span', { class: 'test-out' });
  const check = async () => {
    if (!p.keys) { note.textContent = ''; return; }
    try { const r = await api('POST', '/api/parse-keys', { keys: p.keys }); note.textContent = `= ${r.keys}`; note.className = 'test-out'; } catch (err) { note.textContent = err.message; note.className = 'test-out bad'; }
  };
  const box = input(p.keys, v => { p.keys = v; changed(); check(); }, { placeholder: 'e.g. Ctrl+Shift+L, Alt+F1, NumpadAdd' });
  let recording = false;
  const rec = el('button', { title: 'Click, then press the shortcut on your keyboard', on: { click: e => {
    e.preventDefault();
    recording = !recording;
    rec.textContent = recording ? 'Press the keys…' : 'Record';
    rec.classList.toggle('primary', recording);
    if (recording) box.focus();
  } } }, 'Record');
  box.addEventListener('keydown', e => {
    if (!recording) return;
    e.preventDefault();
    const s = shortcutFromEvent(e);
    box.value = s.text;
    if (s.complete) {
      p.keys = s.text;
      recording = false;
      rec.textContent = 'Record';
      rec.classList.remove('primary');
      changed(); check();
    }
  });
  const sendOut = el('span', { class: 'test-out' });
  check();
  return [
    field('Shortcut', el('div', { class: 'inline' }, box, rec), null, 'keys'),
    field('', note),
    field('While held', el('input', { type: 'checkbox', checked: p.whileHeld ? true : null, on: { change: e => { if (e.target.checked) p.whileHeld = true; else delete p.whileHeld; changed(); } } }),
      'Keys stay down while the dock key is held (e.g. push to talk); otherwise one press and release'),
    field('Bring MSFS to the front', el('input', { type: 'checkbox', checked: p.focus === false ? null : true, on: { change: e => { if (e.target.checked) delete p.focus; else p.focus = false; changed(); } } }),
      'So the keys go to the sim, not to whatever window has focus'),
    field('Try it', el('div', { class: 'inline' }, el('button', { title: 'Brings MSFS to the front and presses the shortcut there', on: { click: async e => {
      e.preventDefault();
      try { const r = await api('POST', '/api/send-keys', { keys: p.keys, focus: p.focus !== false }); sendOut.textContent = `sent ${r.sent}`; sendOut.className = 'test-out'; } catch (err) { sendOut.textContent = err.message; sendOut.className = 'test-out bad'; }
    } } }, 'Send now'), sendOut)),
  ];
}

// Raw JSON, Save to library, Delete: the end of every key's inspector.
function inspectorTail(box, key, slot) {
  const raw = el('details', {}, el('summary', {}, 'Advanced: edit as JSON'));
  const ta = el('textarea', { class: 'json' }, JSON.stringify(key, null, 2));
  raw.append(ta, el('button', { on: { click: () => {
    try { keys()[slot] = JSON.parse(ta.value); changed(); renderInspector(); } catch (e) { status(`JSON error: ${e.message}`, 'bad'); }
  } } }, 'Apply JSON'));
  box.append(raw);
  box.append(el('p', {}, el('button', { on: { click: saveToLibrary } }, 'Save to library'), ' ',
    el('button', { on: { click: deleteSel } }, 'Delete this key')));
}

// What a decorative key drops when chosen: everything that reads or acts on the sim.
const FUNCTION_FIELDS = ['read', 'press', 'states', 'otherwise', 'armed', 'activeIs', 'armedIs', 'activeOr', 'armedOr',
  'sublabels', 'text', 'valueIcons', 'valueFaces', 'decimals', 'pad', 'format'];

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
  const kind = !read ? 'none' : read.timer !== undefined ? 'timer' : read.input !== undefined ? 'input' : 'var';
  const set = r => { onChange(r); changed(); renderInspector(); };
  const kinds = [['input', 'Input event (cockpit control)'], ['var', 'Simvar (sim value)'], ['timer', 'Dock stopwatch']];
  box.append(field('Source', select_(allowNone ? [['none', 'Nothing'], ...kinds] : kinds, kind, v => {
    // A stopwatch's elapsed time shows as M:SS on a readout.
    set(v === 'none' ? null : v === 'input' ? { input: '' } : v === 'timer' ? { timer: 'T1', hint: { format: 'duration' } } : { var: '', unit });
  }), null, kind === 'timer' ? 'stopwatch' : null));
  if (kind === 'timer') {
    box.append(field('Stopwatch', input(read.timer, v => { read.timer = v; changed(); }, { placeholder: 'T1' }), 'Its name: keys using the same name share one stopwatch'));
    box.append(field('Shows', select_([['', 'Elapsed time (seconds)'], ['running', 'Running (1) or stopped (0)']], read.part || '', v => {
      if (v) read.part = v; else delete read.part;
      changed(); renderInspector();
    })));
  }
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
