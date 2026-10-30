// Switchboard editor: The inspector: form helpers, help texts (HELP), and the key editor itself.
// Classic script sharing the page's globals with the other editor scripts (index.html order).

'use strict';

// ---------- inspector ----------

function field(label, control, note, help) {
  return el('label', { class: 'field' }, el('span', {}, label, help ? info(help) : null), control, note ? el('span', {}) : null, note ? el('span', { class: 'muted' }, note) : null);
}

// ⓘ next to a label: the help text on hover, or pinned open by a click (user, 2026-10-29). Texts
// live in HELP so they are easy to find and correct.
const HELP = {
  keypadKey: 'One key of the keypad layout every keypad uses. Its role says what it does: a digit, ENT, DEL, CLR, CANCEL, VFR, '
    + 'or what it shows: the title (with the value now), the value now, or the digits typed. Without a face or icon it gets '
    + 'the built-in look; a label replaces the word on ENT / DEL / CLR / CANCEL and digits. In a custom face, a Live value '
    + 'layer shows the role\'s text. Keys that do nothing at the moment (8 and 9 on a transponder, ENT before a digit) are dimmed.',
  stopwatch: 'A stopwatch the dock keeps itself, counting sim time: it stops while the sim is paused and follows sim '
    + 'rate. It keeps its time across restarts of the plugin or VSD Craft. Keys with the same name share one stopwatch: '
    + 'a readout showing it (Show as: Stopwatch M:SS), and keys with the "Stopwatch control" press to start, stop or reset it.',
  keypad: 'Pressing the key covers the dock with a keypad: CANCEL, the title and value now, the digits typed, DEL, ENT, '
    + 'and 1-9, 0. The value is set as soon as all digits are typed (or on ENT; missing digits count as zeros), then '
    + 'the page comes back. CANCEL or a round button closes it without setting anything.',
  keys: 'Presses keys on your PC as if typed, for things MSFS only offers as key bindings (the pilot\'s flashlight, '
    + 'camera views, toolbar panels). Use the shortcut set in MSFS\'s controls options. Combinations work: modifiers '
    + '(Ctrl, Shift, Alt, Win; RCtrl etc. for the right-hand ones) go down first and up last. Some combinations '
    + 'the browser keeps for itself (Ctrl+W, Ctrl+T, Ctrl+N) cannot be recorded: type them. The key has no on/off look, '
    + 'since the sim does not report these states.',
  units: 'Text before or after the value, e.g. QNH before, or %, RPM, FPM, KT after. A unit starting with a letter '
    + 'or digit gets a space ("2400 RPM"); a symbol does not ("75%"). Not added to words from "Value text per value".',
  wrap: 'Step keys stop at min / max. With wrap, a tap at the stop goes round to the other end, so one key can cycle '
    + 'through a range; a held ramp turns back at the ends instead.',
  ramp: 'For one-key dimmers: a tap steps once (on release, so a hold is not also a step), holding past the delay '
    + 'keeps stepping by "Ramp step" every "Ramp every ms" until you let go. The ramp counts from the value it last '
    + 'sent, so it stays smooth even though the sim reports changes a moment later.',
  decor: 'For looks only: a label, an icon, a sublabel or a custom face, with no sim source and nothing on press. '
    + 'Use it for panel titles, separators or artwork.',
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
        el('button', { class: 'primary', on: { click: () => { keys()[slot] = S.page === KP ? { type: 'keypad', role: 'digit', digit: '1' } : { type: 'button', label: 'NEW' }; changed(); renderInspector(); } } }, 'Add key'),
        S.clipboard ? el('button', { on: { click: paste } }, 'Paste') : null));
    return;
  }

  const redraw = () => { changed(); renderInspector(); };
  box.append(el('h3', {}, `Key ${slot}`));

  const types = S.page === KP ? [['keypad', 'Keypad key'], ['decor', 'Decorative (no function)']]
    : [['switch', 'Switch (on/off look)'], ['armable', 'Switch (armable)'], ['readout', 'Readout (live value)'], ['button', 'Button'], ['decor', 'Decorative (no function)']];
  box.append(field('Type', select_(types, key.type, v => {
    if (v === 'keypad' && !key.role) { key.role = 'digit'; key.digit = '1'; }
    // Decorative keys only look: what the key read or did goes (user, 2026-10-30).
    if (v === 'decor') {
      const had = FUNCTION_FIELDS.filter(k => key[k] !== undefined);
      if (had.length && !confirm('A decorative key does nothing: its source, press action and per-value settings will be removed. Continue?')) return renderInspector();
      for (const k of had) delete key[k];
    }
    key.type = v;
    if (v === 'switch' && !key.states) key.states = { 0: 'off', 1: 'on' };
    if (v === 'armable' && !key.armed) key.armed = { var: '', unit: 'bool' };
    redraw();
  }), null, key.type === 'armable' ? 'armable' : key.type === 'decor' ? 'decor' : key.type === 'keypad' ? 'keypadKey' : null));
  if (key.type === 'keypad') {
    box.append(field('Role', select_(Object.entries(KEYPAD_ROLES), key.role || 'digit', v => {
      key.role = v;
      if (v === 'digit') key.digit = key.digit || '1'; else delete key.digit;
      redraw();
    })));
    if (key.role === 'digit') box.append(field('Digit', select_([...'1234567890'].map(d => [d, d]), String(key.digit ?? '1'), v => { key.digit = v; redraw(); })));
    // 9 is not a transponder digit: on keypads with a VFR code it becomes VFR (user, 2026-10-30).
    if (key.role === 'digit' && String(key.digit) === '9') {
      box.append(field('VFR on transponders', el('input', { type: 'checkbox', checked: key.vfr === false ? null : true, on: { change: e => { if (e.target.checked) delete key.vfr; else key.vfr = false; changed(); } } }),
        'On keypads with a VFR code (the transponder), this key shows VFR and sets that code'));
    }
  }
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

  if (key.type === 'decor' || key.type === 'keypad') {
    box.append(el('h4', {}, 'Sublabel'));
    box.append(field('Sublabel', input(key.sublabel, v => { if (v) { key.sublabel = v; ensureSublabelLayer(key); } else delete key.sublabel; changed(); }),
      key.type === 'keypad' && key.role === 'title' ? 'empty shows "now" and the value' : 'smaller text under the label'));
    return inspectorTail(box, key, slot);
  }

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
    box.append(field('Show as', select_([['', 'Number'], ['time', 'Time HH:MM (from seconds)'], ['duration', 'Stopwatch M:SS (from seconds)']], key.format || '', v => { if (v) key.format = v; else delete key.format; changed(); })));
  }
  if (key.type === 'readout') {
    box.append(field('Unit before', input(key.prefix, v => { if (v) key.prefix = v; else delete key.prefix; changed(); }, { placeholder: 'e.g. QNH' }), null, 'units'));
    box.append(field('Unit after', input(key.suffix, v => { if (v) key.suffix = v; else delete key.suffix; changed(); }, { placeholder: 'e.g. %, RPM, FPM' })));
    box.append(field('Separator', el('input', { type: 'checkbox', checked: key.separator ? true : null, on: { change: e => {
      if (e.target.checked) key.separator = true; else delete key.separator;
      changed();
    } } }), 'A line under the label, like SET ALTIMETER. In a custom face, add a Separator layer instead.'));
  }

  // Press
  box.append(el('h4', {}, 'When pressed', key.type === 'armable' ? info('armablePress') : null));
  const p = key.press || {};
  const pkind = !key.press ? 'none' : p.keypad !== undefined ? 'keypad' : p.timer !== undefined ? 'timer' : p.keys !== undefined ? 'keys' : p.event !== undefined ? 'event' : p.cycle ? 'cycle' : p.step !== undefined ? 'step' : p.hold !== undefined ? 'hold' : p.set !== undefined ? 'set' : 'none';
  box.append(field('Action', select_([['none', 'Nothing'], ['cycle', 'Toggle / cycle values'], ['step', 'Step up or down'], ['hold', 'Hold (spring-loaded)'], ['set', 'Set a value'], ['event', 'Send a sim event'], ['keys', 'Press a keyboard shortcut'], ['keypad', 'Open a keypad'], ['timer', 'Stopwatch control']], pkind, v => {
    const target = p.input;
    const targetVar = p.var;
    key.press = { cycle: { cycle: [0, 1] }, step: { step: 1 }, hold: { hold: 1, release: 0 }, set: { set: 1 }, event: { event: '' }, keys: { keys: '' },
      keypad: { keypad: { preset: guessKeypad(key) } }, timer: { timer: (key.read && key.read.timer) || 'T1', action: 'toggle' } }[v];
    if (!key.press) delete key.press;
    else if (['cycle', 'step', 'hold', 'set'].includes(v)) { if (target) key.press.input = target; if (targetVar) key.press.var = targetVar; }
    redraw();
  })));
  const num = v => (v === '' ? undefined : Number(v));
  const setP = (k, v) => { if (v === undefined || Number.isNaN(v)) delete key.press[k]; else key.press[k] = v; changed(); };
  if (pkind === 'cycle') box.append(field('Values in order', input(p.cycle.join(', '), v => { key.press.cycle = v.split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n)); changed(); }), 'e.g. 0, 1 toggles; the next value after the current one is set'));
  if (pkind === 'step') {
    box.append(field('Step', input(p.step, v => setP('step', num(v)), { type: 'number' }), '1 = up, -1 = down'));
    box.append(field('Minimum', input(p.min, v => setP('min', num(v)), { type: 'number' })));
    box.append(field('Maximum', input(p.max, v => setP('max', num(v)), { type: 'number' })));
    box.append(field('Wrap at the ends', el('input', { type: 'checkbox', checked: p.wrap ? true : null, on: { change: e => setP('wrap', e.target.checked || undefined) } }),
      'At the stop, the next tap goes round to the other end (needs min and max); a hold turns back', 'wrap'));
    // Hold to ramp (user, 2026-10-30): tap steps, holding keeps stepping, e.g. one dimmer key.
    const ramping = !!p.rampMs;
    box.append(field('Hold to ramp', el('input', { type: 'checkbox', checked: ramping ? true : null, on: { change: e => {
      if (e.target.checked) key.press.rampMs = 100; else { delete key.press.rampMs; delete key.press.rampStep; delete key.press.rampDelayMs; }
      redraw();
    } } }), 'A tap steps once (on release); holding keeps stepping until you let go', 'ramp'));
    if (ramping) {
      box.append(field('Ramp step', input(p.rampStep, v => setP('rampStep', num(v)), { type: 'number', min: 0, placeholder: String(Math.abs(p.step || 1)) }), 'Size of each step while held (empty = the step above)'));
      box.append(field('Ramp every ms', input(p.rampMs, v => setP('rampMs', num(v) || 100), { type: 'number', min: 20 })));
      box.append(field('Hold before ramp, ms', input(p.rampDelayMs, v => setP('rampDelayMs', num(v)), { type: 'number', min: 0, placeholder: '400' })));
    }
  }
  if (pkind === 'hold') {
    box.append(field('While held', input(p.hold, v => setP('hold', num(v)), { type: 'number' })));
    box.append(field('On release', input(p.release, v => setP('release', num(v)), { type: 'number' })));
    box.append(field('Repeat every ms', input(p.repeatMs, v => setP('repeatMs', num(v)), { type: 'number', min: 0 }), 'Re-sends while held, for positions the aircraft drops. Empty = once. G1000 softkeys need 130 ms or less to stay held; the C172 START works at 250.'));
  }
  if (pkind === 'set') box.append(field('Value', input(p.set, v => setP('set', num(v)), { type: 'number' })));
  if (pkind === 'keys') box.append(...shortcutEditor(key));
  if (pkind === 'keypad') box.append(...keypadEditor(key));
  if (pkind === 'timer') {
    box.append(field('Stopwatch', input(p.timer, v => { key.press.timer = v; changed(); }, { placeholder: 'T1' }), 'The same name as on the key showing its time'));
    // "Start / stop, hold to reset": the whole stopwatch on one key (user, 2026-10-30).
    const does = p.holdReset ? 'toggle-hold' : (p.action || 'toggle');
    box.append(field('Does', select_([['toggle', 'Start / stop'], ['toggle-hold', 'Start / stop; hold to reset'], ['reset', 'Reset to 0:00'], ['start', 'Start'], ['stop', 'Stop']], does, v => {
      if (v === 'toggle-hold') { key.press.action = 'toggle'; key.press.holdReset = true; } else { key.press.action = v; delete key.press.holdReset; delete key.press.holdMs; }
      redraw();
    }), p.holdReset ? 'A tap starts or stops it (when you let go); holding stops it and sets it to 0:00' : null));
    if (p.holdReset) box.append(field('Hold for, ms', input(p.holdMs, v => { if (v === '') delete key.press.holdMs; else key.press.holdMs = Number(v); changed(); }, { type: 'number', min: 200, placeholder: '1000' })));
  }
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

  inspectorTail(box, key, slot);
}
