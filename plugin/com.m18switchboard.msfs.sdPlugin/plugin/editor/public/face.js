// Switchboard editor: The face designer.
// Classic script sharing the page's globals with the other editor scripts (index.html order).

'use strict';

// ---------- face designer ----------

// Default colours shown in the colour pickers; layers without their own colour follow the global
// look (Look panel), so changing it there restyles every key.
const COLORS = () => ({ label: lookValue('label', '#ffffff'), value: lookValue('readout', '#4fc3f7') });

// A starting face that looks like the key's automatic look, ready to adjust.
const SUBLABEL_Y = () => Math.round(((S.look && S.look.style && S.look.style.bar) || { y: 93.4 }).y * 0.78);
const hasSublabel = key => !!(key.sublabel || (key.sublabels && Object.values(key.sublabels).some(Boolean))
  || (key.logic && [...key.logic.steps, key.logic.otherwise || {}].some(s => s.sublabel)));
const facesOf = key => [key.face, ...Object.values(key.valueFaces || {}), ...Object.values(key.logicFaces || {})].filter(Boolean);

// Every new face carries a Sublabel layer, ready to move, placed where drawn tiles put the
// sublabel (user, 2026-10-29). It draws nothing while the key has no sublabel.
function defaultFace(key) {
  const label = key.label || '';
  // A keypad key's live value is its role's text: the digit, ENT, the title, the digits typed.
  if (key.type === 'keypad') {
    const big = key.role === 'digit' ? 64 : key.role === 'typed' ? 56 : 34;
    return { layers: [{ kind: 'value', x: 72, y: key.role === 'title' || key.sublabel ? 50 : 72, size: big }, { kind: 'sublabel', x: 72, y: 100 }] };
  }
  const sub = y => ({ kind: 'sublabel', ...(y === undefined ? {} : { x: 72, y }) });
  const subl = hasSublabel(key);
  const barY = ((S.look && S.look.style && S.look.style.bar) || { y: 93.4 }).y;
  // The label as the automatic look draws it (render.js): size 40 where it fits the space between
  // top and bottom (a capital is about 0.7 of the size; each further line adds 1.02).
  const n = String(label).split('\n').length;
  const fit = h => Math.max(8, Math.min(40, Math.floor(h / (0.7 + (n - 1) * 1.02))));
  const centred = (top, bottom) => ({ kind: 'text', text: label, x: 72, y: Math.round((top + bottom) / 2), size: fit(bottom - top) });
  const block = h => fit(h) * (0.7 + (n - 1) * 1.02);
  // With a separator: label, separator and sublabel stacked and centred (render.js stacked()).
  const stacked = (top, bottom) => {
    const sepH = 27, subH = subl ? 19 * 0.7 + 8 : 0;
    const size = fit(bottom - top - sepH - subH);
    const lb = size * (0.7 + (n - 1) * 1.02);
    let y = top + (bottom - top - (lb + sepH + subH)) / 2;
    const out = [{ kind: 'text', text: label, x: 72, y: Math.round(y + lb / 2), size }];
    y += lb + 12;
    out.push({ kind: 'separator', x: 72, y: Math.round(y + 3.5) });
    y += 15;
    out.push(sub(Math.round(y + 8 + 6.65)));
    return out;
  };
  const switchLabel = () => (key.separator ? stacked(10, barY - 8) : [centred(10, subl ? barY * 0.78 - 15 : barY - 10), sub()]);
  const buttonLabel = () => (key.separator ? stacked(10, 134) : [centred(10, subl ? 90 : 134), sub(104)]);
  if ((key.type === 'readout' || key.type === 'rotary') && !key.logic && (key.hideValue || key.stateBar)) {
    // As the automatic look draws it with the value hidden and / or a state bar.
    const bar = key.stateBar ? [{ kind: 'bar' }] : [];
    if (key.hideValue) {
      if (key.icon) return { layers: [{ kind: 'icon', crop: 'auto', x: 6, y: 6, w: 132, h: key.stateBar ? 58 : 100 }, sub(key.stateBar ? 74 : 122), ...bar] };
      return key.stateBar ? { layers: [...switchLabel(), ...bar] } : { layers: buttonLabel() };
    }
    if (key.icon) return { layers: [{ kind: 'icon', crop: 'auto', x: 6, y: 4, w: 132, h: 40 }, sub(48), { kind: 'value', x: 72, y: subl ? 72 : 66, size: 30 }, ...bar] };
    const lb = block(24);
    let next = 8 + lb + 6;
    const layers = [{ kind: 'text', text: label, x: 72, y: Math.round(8 + lb / 2), size: fit(24) }];
    if (key.separator) { layers.push({ kind: 'separator', x: 72, y: Math.round(next + 2) }); next += 10; }
    layers.push(sub(Math.round(next + 8)));
    if (subl) next += 18;
    return { layers: [...layers, { kind: 'value', x: 72, y: Math.round((next + barY) / 2), size: 30 }, ...bar] };
  }
  if ((key.type === 'readout' || key.type === 'rotary') && !key.logic) {
    if (key.icon) return { layers: [{ kind: 'icon', crop: 'auto', x: 6, y: 6, w: 132, h: 62 }, sub(82), { kind: 'value', x: 72, y: 112, size: 40 }] };
    if (!key.separator) return { layers: [centred(10, subl ? 40 : 50), sub(54), { kind: 'value', x: 72, y: subl ? 102 : 96, size: subl ? 42 : 46 }] };
    const lb = block(40);
    let y = 10 + lb;
    const layers = [{ kind: 'text', text: label, x: 72, y: Math.round(10 + lb / 2), size: fit(40) }, sub(Math.round(y + 12))];
    if (subl) y += 20;
    layers.push({ kind: 'separator', x: 72, y: Math.round(y + 9) });
    y += 13;
    return { layers: [...layers, { kind: 'value', x: 72, y: Math.round((y + 140) / 2), size: subl ? 40 : 44 }] };
  }
  if (key.type === 'switch' || key.logic) {
    return key.icon
      ? { layers: [{ kind: 'icon', crop: 'full', x: 0, y: 0, w: 144, h: 144 }, sub(76)] }
      : { layers: [...switchLabel(), { kind: 'bar' }] };
  }
  return key.icon
    ? { layers: [{ kind: 'icon', crop: 'full', x: 0, y: 0, w: 144, h: 144 }, sub(122)] }
    : { layers: buttonLabel() };
}

// A face made before the key had a sublabel gets the layer when a sublabel is typed.
function ensureSublabelLayer(key) {
  for (const f of facesOf(key)) if (!(f.layers || []).some(L => L.kind === 'sublabel')) f.layers.push(NEW_LAYER.sublabel());
}

const NEW_LAYER = {
  icon: () => ({ kind: 'icon', crop: 'auto', x: 6, y: 6, w: 132, h: 70 }),
  text: () => ({ kind: 'text', text: 'TEXT', x: 72, y: 36, size: 40 }),
  value: () => ({ kind: 'value', x: 72, y: 104, size: 40 }),
  sublabel: () => ({ kind: 'sublabel' }),
  bar: () => ({ kind: 'bar' }),
  separator: () => ({ kind: 'separator', x: 72, y: 56 }),
  rect: () => ({ kind: 'rect', x: 0, y: 0, w: 144, h: 40, color: '#1e2a3a' }),
  level: () => ({ kind: 'level', dir: 'right', min: 0, max: 100 }),
};
const LAYER_NAMES = { icon: 'Icon', text: 'Text', value: 'Live value', sublabel: 'Sublabel', separator: 'Separator', bar: 'State bar', rect: 'Box', level: 'Level bar' };
const LEVEL_DIRS = [['right', '→ fills left to right'], ['left', '← fills right to left'], ['up', '↑ fills bottom to top'], ['down', '↓ fills top to bottom']];
// A vertical level bar needs a tall box: the right-hand edge of the key, unless placed already.
const LEVEL_TALL = { x: 108, y: 14, w: 24, h: 116 };

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
  // Faces per sim value (valueFaces), or per state logic step (logicFaces: '0', '1', ..., 'otherwise').
  const logic = !!key.logic;
  const mapName = logic ? 'logicFaces' : 'valueFaces';
  const valueFaces = key[mapName] || {};
  const stepName = k => (k === 'otherwise' ? 'otherwise' : `step ${Number(k) + 1}`);
  if (faceTarget !== 'default' && !valueFaces[faceTarget]) faceTarget = 'default';
  editingValue = faceTarget === 'default' ? null : logic ? stepName(faceTarget) : faceTarget;

  // Which face: the default one, or one per sim value (e.g. a different look for each magneto
  // position) or per state step. Values or steps without their own face use the default.
  const addFace = v => {
    key[mapName] = key[mapName] || {};
    key[mapName][v] = clone(key.face || defaultFace(key));
    faceTarget = v;
    faceLayer = 0;
    changed(); renderInspector();
  };
  const tabs = el('div', { class: 'face-tabs' },
    el('button', { class: faceTarget === 'default' ? 'active' : '', on: { click: () => { faceTarget = 'default'; faceLayer = 0; renderInspector(); } } },
      key.face ? 'Default face' : 'Default (automatic)'),
    logic ? [
      ...Object.keys(valueFaces).map(v => el('button', { class: faceTarget === v ? 'active' : '', on: { click: () => { faceTarget = v; faceLayer = 0; renderInspector(); } } }, `when ${stepName(v)}`)),
      ...[...key.logic.steps.map((s, i) => String(i)), 'otherwise'].filter(v => !valueFaces[v]).map(v => el('button', { title: `Design a separate face shown at ${stepName(v)}`, on: { click: () => addFace(v) } }, `+ face for ${stepName(v)}`)),
    ] : null,
    ...(logic ? [] : Object.keys(valueFaces)).map(v => el('button', { class: faceTarget === v ? 'active' : '', on: { click: () => { faceTarget = v; faceLayer = 0; renderInspector(); } } },
      `value ${v}${key.text && key.text[v] ? ` (${key.text[v]})` : ''}`)),
    logic || key.type === 'decor' || key.type === 'keypad' ? null : el('button', { title: 'Design a separate face shown when the sim value is this', on: { click: () => {
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
  if (faceTarget !== 'default') box.append(el('p', { class: 'muted' }, logic ? `Shown at ${stepName(faceTarget)}.` : `Shown while the sim value is ${faceTarget}. The preview shows that value.`));

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
    const defaults = L.kind === 'bar' || L.kind === 'level' ? S.look.style.bar : L.kind === 'sublabel' ? { x: 72, y: SUBLABEL_Y() } : L.kind === 'separator' ? { x: 72, y: 56 } : { x: 0, y: 0 };
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
      input(L[k] ?? (L.kind === 'bar' || L.kind === 'level' ? S.look.style.bar[k] : ''), v => { if (v === '') delete L[k]; else L[k] = Number(v); update(); }, { type: 'number', ...attrs }));
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
        ...['prefix', 'suffix'].map(k => el('label', { class: 'mini' }, k === 'prefix' ? 'unit before' : 'unit after',
          input(L[k], v => { if (v) L[k] = v; else delete L[k]; update(); }, { placeholder: L.read ? '' : key[k] || '', style: 'width:70px' }))),
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
    } else if (L.kind === 'separator') {
      fields.push(n('x', 'x', { placeholder: 72 }), n('y', 'y', { placeholder: 56 }), n('w', 'w', { placeholder: 64 }), n('h', 'h', { placeholder: 7 }), n('r', 'corner', { placeholder: 3.5 }),
        color('color', lookValue('separator', lookValue('readout', '#4fc3f7'))), el('span', { class: 'muted' }, 'Positioned by its centre.'));
    } else if (L.kind === 'bar') {
      fields.push(el('label', { class: 'mini' }, 'shows', select_([['', 'follows the key\'s state'], ['on', 'green'], ['armed', 'white (armed)'], ['off', 'red'], ['clear', 'clear (outline)']],
        L.look || '', v => { if (v) L.look = v; else delete L.look; update(); })),
      n('x', 'x'), n('y', 'y'), n('w', 'w'), n('h', 'h'), n('r', 'corner'),
        el('span', { class: 'muted' }, 'Empty fields use the bar measured from your icons.'));
    } else if (L.kind === 'rect') {
      fields.push(n('x', 'x'), n('y', 'y'), n('w', 'w'), n('h', 'h'), n('r', 'corner'), color('color', '#1e2a3a'));
    } else if (L.kind === 'level') {
      fields.push(levelFields(L, i, n, color, update));
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
      el('span', { class: 'muted' }, L.kind === 'level' ? ` ${L.read ? L.read.input || L.read.var || '(choose a source)' : 'the key\'s value'}, ${L.min ?? 0}-${L.max ?? 100}` : L.kind === 'bar' ? (L.look ? ` always ${{ on: 'green', armed: 'white', off: 'red', clear: 'clear' }[L.look]}` : ' green / red / outline by state') : L.kind === 'sublabel' ? (L.read ? ` ${L.read.input || L.read.var || '(choose a source)'}` : ' per value / step') : L.kind === 'value' ? (L.read ? ` ${L.read.input || L.read.var || '(choose a source)'}` : ' the key\'s value') : ''),
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
      if (!confirm(`Remove the face for ${logic ? stepName(faceTarget) : `value ${faceTarget}`}?`)) return;
      delete key[mapName][faceTarget];
      if (!Object.keys(key[mapName]).length) delete key[mapName];
      faceTarget = 'default';
    }
    changed(); renderInspector();
  } } }, faceTarget === 'default' ? 'Remove custom face' : `Remove face for ${logic ? stepName(faceTarget) : `value ${faceTarget}`}`));
  refresh();
  return box;
}

// Level bar (user, 2026-11-03): direction, range, fill and outline colours, the key's value or its
// own source, and optional colour bands (e.g. fuel: yellow below 25, red below 10).
function levelFields(L, i, n, color, update) {
  const box = el('div', { class: 'level-fields' });
  box.append(el('label', { class: 'mini' }, 'direction', select_(LEVEL_DIRS, L.dir || 'right', v => {
    const wasTall = L.dir === 'up' || L.dir === 'down';
    const tall = v === 'up' || v === 'down';
    L.dir = v;
    // Switching between across and upright: a box still at its default size turns with it.
    if (tall && !wasTall && L.w === undefined && L.h === undefined) Object.assign(L, LEVEL_TALL);
    if (!tall && wasTall && L.w === LEVEL_TALL.w && L.h === LEVEL_TALL.h) for (const k of ['x', 'y', 'w', 'h']) delete L[k];
    changed(); renderInspector();
  })),
  n('min', 'empty at', { placeholder: 0 }), n('max', 'full at', { placeholder: 100 }),
  n('x', 'x'), n('y', 'y'), n('w', 'w'), n('h', 'h'), n('r', 'corner'),
  color('color', lookValue('on', '#b8f01c')), el('label', { class: 'mini' }, L.track ? 'outline' : 'outline (look)',
    el('span', { class: 'inline' },
      el('input', { type: 'color', value: L.track || lookValue('clearStroke', '#8a8f98'), on: { input: e => { L.track = e.target.value; update(); } } }),
      L.track ? el('button', { title: 'Use the global look colour', on: { click: () => { delete L.track; changed(); renderInspector(); } } }, '↺') : null)));
  // Its value: the key's own, or its own source (like a live value layer).
  const own = !!L.read;
  const srcBox = el('div', { class: 'layer-source' },
    el('label', { class: 'row' }, el('input', { type: 'radio', name: `lsrc${i}`, checked: own ? null : true, on: { change: () => { delete L.read; changed(); renderInspector(); } } }), ' the key\'s value'),
    el('label', { class: 'row' }, el('input', { type: 'radio', name: `lsrc${i}`, checked: own ? true : null, on: { change: () => { L.read = { var: '', unit: 'number' }; changed(); renderInspector(); } } }), ' its own source'));
  if (own) srcBox.append(sourceEditor(L.read, r => { L.read = r || { var: '', unit: 'number' }; if (r) delete r.hint; }));
  box.append(srcBox);
  // Colour bands: hidden until the first one is added, so a plain bar stays plain.
  const bands = Array.isArray(L.bands) ? L.bands : [];
  const list = el('div', { class: 'level-bands' });
  bands.forEach((b, j) => {
    const side = typeof b.above === 'number' ? 'above' : 'below';
    const at = b[side];
    list.append(el('div', { class: 'inline' },
      select_([['below', 'below'], ['above', 'above']], side, v => { const val = b[side]; delete b.below; delete b.above; b[v] = val; changed(); renderInspector(); }),
      input(at, v => { delete b.below; delete b.above; b[side] = v === '' ? 0 : Number(v); update(); }, { type: 'number', class: 'narrow' }),
      'fill',
      el('input', { type: 'color', value: b.color || '#ffcc00', on: { input: e => { b.color = e.target.value; update(); } } }),
      el('button', { title: 'Remove this band', on: { click: () => { bands.splice(j, 1); if (!bands.length) delete L.bands; changed(); renderInspector(); } } }, '✕')));
  });
  list.append(el('button', { class: 'add-or', title: 'A different fill colour below or above a value, e.g. yellow below 25', on: { click: () => {
    L.bands = bands;
    const range = (L.max ?? 100) - (L.min ?? 0);
    const lowest = bands.filter(b => typeof b.below === 'number').map(b => b.below);
    const next = lowest.length ? Math.round(Math.min(...lowest) * 0.4) : Math.round((L.min ?? 0) + range * 0.25);
    bands.push({ below: next, color: lowest.length ? '#ff3b3b' : '#ffcc00' });
    changed(); renderInspector();
  } } }, '+ colour band'));
  if (bands.length) list.prepend(el('div', { class: 'muted' }, 'When the value is in a band, the band\'s colour fills the bar; in two, the tighter one wins. Otherwise the fill colour above.'));
  box.append(list);
  return box;
}
