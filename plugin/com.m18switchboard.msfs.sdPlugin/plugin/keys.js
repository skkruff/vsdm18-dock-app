// Keyboard shortcuts sent to the sim (user, 2026-10-30): for things MSFS only offers as key
// bindings, such as the pilot's flashlight, camera views or the toolbar.
//
// Keys go out through Windows SendInput as hardware scancodes, which games read (plain virtual
// keys are often ignored). The plugin runs on VSD Craft's Node without native modules, so a
// small PowerShell helper (keys-helper.ps1) does the sending: started once, then fed one line per
// key event.
//
// A shortcut is written like the sim's bindings: "Ctrl+Shift+L", "Alt+F1", "NumpadAdd", "RCtrl+5".
const { spawn } = require('child_process');
const path = require('path');

// Scancode set 1; ext marks the extended keys (E0 prefix).
const SC = {
  Escape: 0x01, Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06, Digit6: 0x07,
  Digit7: 0x08, Digit8: 0x09, Digit9: 0x0a, Digit0: 0x0b, Minus: 0x0c, Equal: 0x0d, Backspace: 0x0e,
  Tab: 0x0f, KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15, KeyU: 0x16,
  KeyI: 0x17, KeyO: 0x18, KeyP: 0x19, BracketLeft: 0x1a, BracketRight: 0x1b, Enter: 0x1c,
  ControlLeft: 0x1d, KeyA: 0x1e, KeyS: 0x1f, KeyD: 0x20, KeyF: 0x21, KeyG: 0x22, KeyH: 0x23,
  KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26, Semicolon: 0x27, Quote: 0x28, Backquote: 0x29, ShiftLeft: 0x2a,
  Backslash: 0x2b, KeyZ: 0x2c, KeyX: 0x2d, KeyC: 0x2e, KeyV: 0x2f, KeyB: 0x30, KeyN: 0x31, KeyM: 0x32,
  Comma: 0x33, Period: 0x34, Slash: 0x35, ShiftRight: 0x36, NumpadMultiply: 0x37, AltLeft: 0x38,
  Space: 0x39, CapsLock: 0x3a, F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40, F7: 0x41,
  F8: 0x42, F9: 0x43, F10: 0x44, NumLock: 0x45, ScrollLock: 0x46, Numpad7: 0x47, Numpad8: 0x48,
  Numpad9: 0x49, NumpadSubtract: 0x4a, Numpad4: 0x4b, Numpad5: 0x4c, Numpad6: 0x4d, NumpadAdd: 0x4e,
  Numpad1: 0x4f, Numpad2: 0x50, Numpad3: 0x51, Numpad0: 0x52, NumpadDecimal: 0x53, IntlBackslash: 0x56,
  F11: 0x57, F12: 0x58, F13: 0x64, F14: 0x65, F15: 0x66, F16: 0x67, F17: 0x68, F18: 0x69, F19: 0x6a,
  F20: 0x6b, F21: 0x6c, F22: 0x6d, F23: 0x6e, F24: 0x76,
};
const EXT = {
  NumpadEnter: 0x1c, ControlRight: 0x1d, NumpadDivide: 0x35, AltRight: 0x38, Home: 0x47, ArrowUp: 0x48,
  PageUp: 0x49, ArrowLeft: 0x4b, ArrowRight: 0x4d, End: 0x4f, ArrowDown: 0x50, PageDown: 0x51,
  Insert: 0x52, Delete: 0x53, MetaLeft: 0x5b, MetaRight: 0x5c, ContextMenu: 0x5d,
};
const MODIFIERS = ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'];

// Names people write -> key codes (browser KeyboardEvent.code names, which the editor records).
const ALIASES = {
  ctrl: 'ControlLeft', control: 'ControlLeft', lctrl: 'ControlLeft', rctrl: 'ControlRight',
  shift: 'ShiftLeft', lshift: 'ShiftLeft', rshift: 'ShiftRight',
  alt: 'AltLeft', lalt: 'AltLeft', ralt: 'AltRight', altgr: 'AltRight',
  win: 'MetaLeft', windows: 'MetaLeft', meta: 'MetaLeft',
  esc: 'Escape', escape: 'Escape', enter: 'Enter', return: 'Enter', tab: 'Tab', space: 'Space',
  backspace: 'Backspace', del: 'Delete', delete: 'Delete', ins: 'Insert', insert: 'Insert',
  home: 'Home', end: 'End', pgup: 'PageUp', pageup: 'PageUp', pgdn: 'PageDown', pagedown: 'PageDown',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  '-': 'Minus', minus: 'Minus', '=': 'Equal', equal: 'Equal', equals: 'Equal', '[': 'BracketLeft', ']': 'BracketRight',
  ';': 'Semicolon', "'": 'Quote', ',': 'Comma', comma: 'Comma', '.': 'Period', period: 'Period', '/': 'Slash',
  '`': 'Backquote', '\\': 'Backslash', capslock: 'CapsLock', numlock: 'NumLock', scrolllock: 'ScrollLock',
  numpadplus: 'NumpadAdd', numplus: 'NumpadAdd', numadd: 'NumpadAdd', numpadminus: 'NumpadSubtract', numminus: 'NumpadSubtract',
  numsub: 'NumpadSubtract', nummultiply: 'NumpadMultiply', numdivide: 'NumpadDivide', numenter: 'NumpadEnter',
  numdecimal: 'NumpadDecimal', numdel: 'NumpadDecimal',
};
// How each key is written back ("Ctrl+Shift+L").
const SHORT = {
  ControlLeft: 'Ctrl', ControlRight: 'RCtrl', ShiftLeft: 'Shift', ShiftRight: 'RShift', AltLeft: 'Alt',
  AltRight: 'RAlt', MetaLeft: 'Win', MetaRight: 'RWin', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left',
  ArrowRight: 'Right', PageUp: 'PgUp', PageDown: 'PgDn',
};
const ALL = new Set([...Object.keys(SC), ...Object.keys(EXT)]);
const LOWER = new Map([...ALL].map(c => [c.toLowerCase(), c]));

function codeOf(token) {
  const t = token.trim();
  const l = t.toLowerCase();
  if (ALIASES[l]) return ALIASES[l];
  if (LOWER.has(l)) return LOWER.get(l);
  if (/^[a-z]$/.test(l)) return `Key${l.toUpperCase()}`;
  if (/^[0-9]$/.test(l)) return `Digit${l}`;
  let m = l.match(/^(?:numpad|num)([0-9])$/);
  if (m) return `Numpad${m[1]}`;
  m = l.match(/^f([1-9]|1[0-9]|2[0-4])$/);
  if (m) return `F${m[1]}`;
  throw new Error(`unknown key "${t}"`);
}

// "Ctrl+Shift+L" -> ['ControlLeft', 'ShiftLeft', 'KeyL']: modifiers first (always Ctrl, Shift, Alt,
// Win, whatever order they were written in), then the other keys.
function parseShortcut(text) {
  const s = String(text || '').trim();
  if (!s) throw new Error('no keys');
  // "+" separates keys; "Num+" style is not supported, write NumpadAdd.
  const codes = s.split('+').map(t => t.trim()).filter(Boolean).map(codeOf);
  const unique = [...new Set(codes)];
  const mods = unique.filter(c => MODIFIERS.includes(c)).sort((a, b) => MODIFIERS.indexOf(a) - MODIFIERS.indexOf(b));
  const keys = unique.filter(c => !MODIFIERS.includes(c));
  return [...mods, ...keys];
}

function formatShortcut(codes) {
  return codes.map(c => SHORT[c] || c.replace(/^Key/, '').replace(/^Digit/, '')).join('+');
}

function scan(code) {
  if (EXT[code] !== undefined) return { scan: EXT[code], ext: true };
  return { scan: SC[code], ext: false };
}

// The helper's commands, one per line: "k <scan> <ext 0|1> <up 0|1>", "s <ms>" (sleep),
// "f" (bring MSFS to the front if it is not already).
function tapCommands(codes, { holdMs = 40, gapMs = 15 } = {}) {
  return [...downCommands(codes, gapMs), `s ${holdMs}`, ...upCommands(codes, gapMs)];
}
function downCommands(codes, gapMs = 15) {
  const out = [];
  codes.forEach((c, i) => { const k = scan(c); out.push(`k ${k.scan} ${k.ext ? 1 : 0} 0`); if (i < codes.length - 1) out.push(`s ${gapMs}`); });
  return out;
}
function upCommands(codes, gapMs = 15) {
  const out = [];
  [...codes].reverse().forEach((c, i) => { const k = scan(c); out.push(`k ${k.scan} ${k.ext ? 1 : 0} 1`); if (i < codes.length - 1) out.push(`s ${gapMs}`); });
  return out;
}

const HELPER = path.join(__dirname, 'keys-helper.ps1');

class KeySender {
  constructor({ spawnFn = spawn, platform = process.platform, log = () => {} } = {}) {
    Object.assign(this, { spawnFn, platform, log });
    this.proc = null;
    this.held = new Map(); // shortcut text -> codes held down by a "while held" press
  }

  get available() { return this.platform === 'win32'; }

  start() {
    if (this.proc || !this.available) return;
    const p = this.spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = p;
    p.stdout.on('data', d => String(d).split(/\r?\n/).filter(Boolean).forEach(l => this.log('keys', l)));
    p.stderr.on('data', d => this.log('keys error', String(d).trim()));
    p.on('exit', code => { this.log('keys helper ended', code); if (this.proc === p) this.proc = null; });
    p.on('error', e => { this.log('keys helper failed', e.message); if (this.proc === p) this.proc = null; });
  }

  _send(lines) {
    if (!this.available) throw new Error('keyboard shortcuts work on Windows only');
    this.start();
    if (!this.proc) throw new Error('keyboard helper not running');
    this.proc.stdin.write(`${lines.join('\r\n')}\r\n`);
  }

  // Press and release a shortcut; focus brings MSFS to the front first if it is not.
  tap(text, { focus = true } = {}) {
    const codes = parseShortcut(text);
    this._send([...(focus ? ['f'] : []), ...tapCommands(codes)]);
    return codes;
  }

  // "While held": keys go down with the dock key and up when it is released.
  down(text, { focus = true } = {}) {
    const codes = parseShortcut(text);
    this.held.set(text, codes);
    this._send([...(focus ? ['f'] : []), ...downCommands(codes)]);
  }

  up(text) {
    const codes = this.held.get(text) || parseShortcut(text);
    this.held.delete(text);
    this._send(upCommands(codes));
  }

  stop() {
    if (this.proc) { try { this.proc.stdin.end(); this.proc.kill(); } catch (e) { /* already gone */ } }
    this.proc = null;
  }
}

module.exports = { KeySender, parseShortcut, formatShortcut, tapCommands, downCommands, upCommands, HELPER };
