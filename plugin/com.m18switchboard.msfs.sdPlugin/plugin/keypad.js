// Keypad entry (user, 2026-10-27 / 2026-10-30): a press opens a keypad over the whole dock; the
// digits typed are set in the sim on ENT (or as soon as all digits are in), then the page returns.
//
// press.keypad: { preset } and/or { title, digits, decimals, octal, autoEnter, apply }
//   digits     how many digits are typed (decimal point not counted)
//   decimals   how many of them come after the decimal point
//   octal      only 0-7 (transponder codes)
//   autoEnter  set the value as soon as all digits are typed (default true)
//   apply      { event, encode } | { var, unit, encode } | { input, encode }: where the value goes.
//              encode: 'number' (default; times scale, rounded) or 'bcd16' (the digits read as
//              hex, as XPNDR_SET wants: 1200 -> 0x1200).
//
// Layout (top row = slots 0-4):
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

const SLOTS = { cancel: 0, title: 1, typed: 2, del: 3, ent: 4 };
const DIGIT_SLOTS = { 1: 5, 2: 6, 3: 7, 4: 8, 5: 9, 6: 10, 7: 11, 8: 12, 9: 13, 0: 14 };
const SLOT_DIGIT = Object.fromEntries(Object.entries(DIGIT_SLOTS).map(([d, s]) => [s, d]));

// The full spec: the preset's fields, then the key's own.
function keypadSpec(k) {
  const own = typeof k === 'string' ? { preset: k } : (k || {});
  const base = own.preset ? PRESETS[own.preset] : {};
  if (own.preset && !base) throw new Error(`unknown keypad preset ${own.preset}`);
  const spec = { autoEnter: true, decimals: 0, ...base, ...own, apply: { ...(base.apply || {}), ...(own.apply || {}) } };
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
  return Math.round(n * (spec.apply.scale || 1));
}

// A digit typed: the new typed string, or the same one when it is not allowed or there is no room.
function typeDigit(spec, typed, d) {
  if (spec.octal && Number(d) > 7) return typed;
  if (typed.length >= spec.digits) return typed;
  return typed + d;
}

module.exports = { PRESETS, PRESET_NAMES, SLOTS, DIGIT_SLOTS, SLOT_DIGIT, keypadSpec, display, encode, typeDigit };
