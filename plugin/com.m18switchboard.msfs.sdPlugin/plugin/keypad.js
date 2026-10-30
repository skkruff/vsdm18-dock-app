// Keypad entry (user, 2026-10-27 / 2026-10-30): a press opens a keypad over the whole dock; the
// digits typed are set in the sim on ENT (or as soon as all digits are in), then the page returns.
//
// press.keypad: { preset } and/or { title, digits, decimals, octal, autoEnter, apply }
//   digits     how many digits are typed (decimal point not counted)
//   decimals   how many of them come after the decimal point
//   octal      only 0-7 (transponder codes)
//   autoEnter  set the value as soon as all digits are typed (default true)
//   apply      { event, encode } | { var, unit, encode } | { input, encode }: where the value goes.
//              encode: 'number' (default; times scale) or 'bcd16' (the digits read as
//              hex, as XPNDR_SET wants: 1200 -> 0x1200).
//
// One keypad layout for every keypad (user, 2026-10-30), edited in the editor's "Keypad" tab and
// saved in keypad.json next to the profiles folder: { keys: { slot: { type: 'keypad', role, digit,
// label, sublabel, icon, face } } } (decorative keys allowed too). Roles: digit (with digit),
// ent, del (last digit), clr (all digits), cancel, title (title, with the value now below),
// now (the value now), typed (the digits typed). The default (top row = slots 0-4):
//   CANCEL  title   typed   DEL   ENT
//     1       2       3      4     5
//     6       7       8      9     0
const PRESETS = {
  xpdr: { title: 'XPDR', digits: 4, decimals: 0, octal: true, apply: { event: 'XPNDR_SET', encode: 'bcd16' } },
  com1: { title: 'COM1 STBY', digits: 6, decimals: 3, apply: { event: 'COM_STBY_RADIO_SET_HZ', scale: 1000000 } },
  com2: { title: 'COM2 STBY', digits: 6, decimals: 3, apply: { event: 'COM2_STBY_RADIO_SET_HZ', scale: 1000000 } },
  nav1: { title: 'NAV1 STBY', digits: 5, decimals: 2, apply: { event: 'NAV1_STBY_SET_HZ', scale: 1000000 } },
  nav2: { title: 'NAV2 STBY', digits: 5, decimals: 2, apply: { event: 'NAV2_STBY_SET_HZ', scale: 1000000 } },
};
const PRESET_NAMES = { xpdr: 'Transponder code', com1: 'COM1 standby', com2: 'COM2 standby', nav1: 'NAV1 standby', nav2: 'NAV2 standby' };

const ROLES = ['digit', 'ent', 'del', 'clr', 'cancel', 'title', 'now', 'typed'];
const ROLE_NAMES = { digit: 'Digit', ent: 'ENT (set the value)', del: 'DEL (last digit)', clr: 'CLR (all digits)',
  cancel: 'CANCEL (close)', title: 'Title, with the value now', now: 'Value now', typed: 'Digits typed' };
const ROLE_TEXT = { ent: 'ENT', del: 'DEL', clr: 'CLR', cancel: 'CANCEL' };
const DEFAULT_LAYOUT = {
  0: { type: 'keypad', role: 'cancel' }, 1: { type: 'keypad', role: 'title' }, 2: { type: 'keypad', role: 'typed' },
  3: { type: 'keypad', role: 'del' }, 4: { type: 'keypad', role: 'ent' },
  ...Object.fromEntries(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d, i) => [5 + i, { type: 'keypad', role: 'digit', digit: d }])),
};

// Problems with a layout, for the editor (a layout with problems still works as far as it can).
function layoutProblems(keys) {
  const out = [];
  const list = Object.values(keys || {});
  for (const k of list) {
    if (k.type !== 'keypad') continue;
    if (!ROLES.includes(k.role)) out.push(`unknown role ${k.role}`);
    if (k.role === 'digit' && !/^[0-9]$/.test(String(k.digit))) out.push('a digit key needs its digit (0-9)');
  }
  const digits = new Set(list.filter(k => k.role === 'digit').map(k => String(k.digit)));
  const missing = [...'0123456789'].filter(d => !digits.has(d));
  if (missing.length) out.push(`no key for digit ${missing.join(', ')}`);
  if (!list.some(k => k.role === 'ent')) out.push('no ENT key: only keypads that set the value when all digits are in will work');
  return out;
}

// The full spec: the preset's fields, then the key's own.
function keypadSpec(k) {
  const own = typeof k === 'string' ? { preset: k } : (k || {});
  const base = own.preset ? PRESETS[own.preset] : {};
  if (own.preset && !base) throw new Error(`unknown keypad preset ${own.preset}`);
  // A send target of the key's own (event, simvar or input event) replaces the preset's, so a
  // different pathway can be tried (user, 2026-10-30); encode / scale fill in from the preset.
  const ownApply = own.apply || {};
  const baseApply = { ...(base.apply || {}) };
  if (ownApply.event !== undefined || ownApply.var !== undefined || ownApply.input !== undefined) {
    for (const f of ['event', 'var', 'unit', 'input']) delete baseApply[f];
  }
  const spec = { autoEnter: true, decimals: 0, ...base, ...own, apply: { ...baseApply, ...ownApply } };
  if (!(spec.digits >= 1 && spec.digits <= 10)) throw new Error('keypad needs 1-10 digits');
  if (!(spec.decimals >= 0 && spec.decimals < spec.digits)) throw new Error('keypad decimals must be fewer than its digits');
  const a = spec.apply;
  if (!a.event && !a.var && !a.input) throw new Error('keypad needs somewhere to set the value (an event, simvar or input event)');
  return spec;
}

// What the display key shows: typed digits, the rest as _, with the decimal point in place.
function display(spec, typed) {
  const s = typed.padEnd(spec.digits, '_');
  return spec.decimals ? `${s.slice(0, spec.digits - spec.decimals)}.${s.slice(spec.digits - spec.decimals)}` : s;
}

// Typed digits -> the number to send. Missing digits are zeros at the end (124.8 -> 124.800).
function encode(spec, typed) {
  const all = typed.padEnd(spec.digits, '0');
  if ((spec.apply.encode || 'number') === 'bcd16') return parseInt(all, 16);
  const n = Number(spec.decimals ? `${all.slice(0, spec.digits - spec.decimals)}.${all.slice(spec.digits - spec.decimals)}` : all);
  // Rounded only to clear float noise: Hz stay whole, MHz keep their decimals (122.8, not 123).
  return Math.round(n * (spec.apply.scale || 1) * 1e6) / 1e6;
}

// A digit typed: the new typed string, or the same one when it is not allowed or there is no room.
function typeDigit(spec, typed, d) {
  if (spec.octal && Number(d) > 7) return typed;
  if (typed.length >= spec.digits) return typed;
  return typed + d;
}

module.exports = { PRESETS, PRESET_NAMES, ROLES, ROLE_NAMES, ROLE_TEXT, DEFAULT_LAYOUT, layoutProblems, keypadSpec, display, encode, typeDigit };
