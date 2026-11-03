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
  decor: 'For looks only: a label, an icon, a sublabel or a custom face, with no sim source and nothing on press. '
    + 'Use it for panel titles, separators or artwork. It saves once it shows something.',
  switchType: 'A control with positions you can see: toggles, rockers, latching push buttons, selectors (magnetos, '
    + 'fuel). Give it a source to show its position, and its Positions (value, look, sublabel): "Fill from the SDK" or '
    + '"Learn positions" finds them. It saves once it does something when pressed.',
  buttonType: 'Something you push: panel buttons, softkeys, or a press that turns a selector one way (◀ MAG). '
    + 'A tap and a hold can do different things, and a hold can repeat. A source is optional (to show a state). '
    + 'It saves once it does something when pressed.',
  rotaryType: 'A knob over a range: dimmers, vents, climate. Starts as a tap that steps and a hold that ramps, '
    + 'shown as a value (e.g. 75%). It saves once it does something when pressed.',
  readoutType: 'Shows the sim: a value (frequency, time, percent) or, with State logic, an annunciator (captured, armed, '
    + 'off). A press is optional (swap, keypad, sync). It saves once it reads something.',
  logic: 'Steps checked from the top: the first step with any of its conditions met decides the look and sublabel; '
    + 'if none is met, "otherwise". E.g. APR: step 1 green LOC when APPROACH CAPTURED is 1, step 2 white ARM when '
    + 'APPROACH HOLD is 1, otherwise clear. A step can have several conditions ("or"), each with its own source.',
  positions: 'One row per sim value: the look (bar), sublabel, the text shown instead of the number, or an icon that '
    + 'replaces the whole key. Leave a cell empty for the default. "Fill from the SDK" uses the values the SDK lists '
    + 'for a simvar; "Learn positions" records the values while you move the control in the cockpit.',
  sendScale: 'Some controls are set in other units than they report. The DA62\'s panel light reads 0-100 but is set '
    + '0-1: with Sends × 0.01, a step of 10 from 50 sends 0.6. Steps, minimum, maximum and the value on the key stay in '
    + 'the units read. Empty or 1: sent as is. Test: "Set a value" 50 and press; if the control goes to full, try 0.5.',
  simPaused: 'Whether the sim is paused: 1 in any pause (the pause key, active pause, the menu), else 0. The sim tells '
    + 'the plugin only when this changes, so after the plugin connects the key shows clear (unknown) until the first '
    + 'pause or unpause. MSFS has no event for active pause: use a keyboard shortcut to work it.',
  tapHold: 'With a hold action, a tap acts when you let go (before the hold time) and a hold acts at the hold time '
    + '(400 ms unless you change it), so the two never both happen. Without one, a press acts at once.',
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
        S.clipboard ? el('button', { on: { click: paste } }, 'Paste') : null,
        // A key deleted since the last save comes back with Revert changes.
        savedKey(slot) ? el('button', { title: 'Bring back the key saved here', on: { click: () => revertKey(slot) } }, 'Revert changes') : null));
    return;
  }

  renderKeyEditor(box, key, slot); // key-editor.js
}
