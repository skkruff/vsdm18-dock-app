// Keyboard shortcuts: parsing, the key event sequence sent for combinations, and the helper
// process bookkeeping (with a fake spawn). Says nothing about Windows actually taking the keys.
const assert = require('assert');
const path = require('path');
const { EventEmitter } = require('events');
const fs = require('fs');
const { KeySender, parseShortcut, formatShortcut, tapCommands, HELPER } = require(path.join(__dirname, '..', 'plugin', 'com.m18switchboard.msfs.sdPlugin', 'plugin', 'keys'));

// Parsing: modifiers first, whatever order they were written in; names as in MSFS bindings.
assert.deepStrictEqual(parseShortcut('Ctrl+Shift+L'), ['ControlLeft', 'ShiftLeft', 'KeyL']);
assert.deepStrictEqual(parseShortcut('l + shift + ctrl'), ['ControlLeft', 'ShiftLeft', 'KeyL']);
assert.deepStrictEqual(parseShortcut('Alt+F1'), ['AltLeft', 'F1']);
assert.deepStrictEqual(parseShortcut('RCtrl+Numpad5'), ['ControlRight', 'Numpad5']);
assert.deepStrictEqual(parseShortcut('NumpadAdd'), ['NumpadAdd']);
assert.deepStrictEqual(parseShortcut('Shift+Up'), ['ShiftLeft', 'ArrowUp']);
assert.deepStrictEqual(parseShortcut('Alt+Win+Shift+Ctrl+9'), ['ControlLeft', 'ShiftLeft', 'AltLeft', 'MetaLeft', 'Digit9']);
assert.deepStrictEqual(parseShortcut('KeyL'), ['KeyL'], 'browser code names');
assert.deepStrictEqual(parseShortcut('F24'), ['F24']);
assert.throws(() => parseShortcut('Ctrl+Banana'), /unknown key "Banana"/);
assert.throws(() => parseShortcut(''), /no keys/);
assert.strictEqual(formatShortcut(parseShortcut('ctrl+shift+l')), 'Ctrl+Shift+L');
assert.strictEqual(formatShortcut(parseShortcut('ralt+pgdn')), 'RAlt+PgDn');

// A combination: modifiers down in order, the key, a hold, then up in reverse order. Scancodes,
// extended flag for the E0 keys (right Ctrl, arrows, numpad Enter ...).
assert.deepStrictEqual(tapCommands(parseShortcut('Ctrl+Shift+L')), [
  'k 29 0 0', 's 15', 'k 42 0 0', 's 15', 'k 38 0 0', 's 40', 'k 38 0 1', 's 15', 'k 42 0 1', 's 15', 'k 29 0 1']);
assert.deepStrictEqual(tapCommands(parseShortcut('RCtrl+Up')), ['k 29 1 0', 's 15', 'k 72 1 0', 's 40', 'k 72 1 1', 's 15', 'k 29 1 1']);

// The sender: one helper process, started once; focus first unless told not to.
const spawned = [];
const fakeSpawn = (cmd, args) => {
  const p = new EventEmitter();
  p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
  p.written = [];
  p.stdin = { write: s => p.written.push(s), end() {} };
  p.kill = () => {};
  spawned.push({ cmd, args, p });
  return p;
};
const ks = new KeySender({ spawnFn: fakeSpawn, platform: 'win32' });
ks.start();
ks.tap('Alt+F1');
ks.tap('L', { focus: false });
assert.strictEqual(spawned.length, 1, 'one helper');
assert.deepStrictEqual(spawned[0].args.slice(-2), ['-File', HELPER]);
assert.ok(fs.existsSync(HELPER), 'helper script ships with the plugin');
const lines = spawned[0].p.written.join('').split('\r\n').filter(Boolean);
assert.deepStrictEqual(lines, ['f', 'k 56 0 0', 's 15', 'k 59 0 0', 's 40', 'k 59 0 1', 's 15', 'k 56 0 1', 'k 38 0 0', 's 40', 'k 38 0 1']);
spawned[0].p.written.length = 0;
ks.down('Shift+F2');
ks.up('Shift+F2');
assert.deepStrictEqual(spawned[0].p.written.join('').split('\r\n').filter(Boolean),
  ['f', 'k 42 0 0', 's 15', 'k 60 0 0', 'k 60 0 1', 's 15', 'k 42 0 1'], 'while held: down, later up');
spawned[0].p.emit('exit', 1);
ks.tap('L');
assert.strictEqual(spawned.length, 2, 'restarted after the helper ended');
assert.throws(() => new KeySender({ spawnFn: fakeSpawn, platform: 'linux' }).tap('L'), /Windows only/);

// The helper script: the pieces Windows needs (checked as text; it cannot run here).
const ps = fs.readFileSync(HELPER, 'utf8');
for (const s of ['SendInput', '0x0008u', 'FlightSimulator2024', 'ReadLine()']) assert.ok(ps.includes(s), s);
console.log('keys: PASS');
