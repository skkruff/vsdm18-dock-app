// Checks icon name parsing and lookup against names copied from the real library listing.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { IconLibrary, parseName } = require('../plugin/com.m18switchboard.msfs.sdPlugin/plugin/icons');

assert.deepStrictEqual(parseName('active_pause_clear_RGB_white.png'),
  { base: 'active_pause', state: 'clear', theme: 'RGB_white', file: 'active_pause_clear_RGB_white.png' });
assert.deepStrictEqual(parseName('alt_hold_on_B_C18.png'),
  { base: 'alt_hold', state: 'on', theme: 'B_C18', file: 'alt_hold_on_B_C18.png' });
assert.deepStrictEqual(parseName('airspeed_reference_minus_RGB.png'),
  { base: 'airspeed_reference_minus', state: null, theme: 'RGB', file: 'airspeed_reference_minus_RGB.png' });
assert.deepStrictEqual(parseName('anti_ice_RGB.png'),
  { base: 'anti_ice', state: null, theme: 'RGB', file: 'anti_ice_RGB.png' });
assert.strictEqual(parseName('readme.txt'), null);
assert.strictEqual(parseName('something_else.png'), null);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
for (const f of ['alt_hold_on_RGB.png', 'alt_hold_off_RGB.png', 'alt_hold_on_RGB_white.png', 'anti_ice_RGB.png']) {
  fs.writeFileSync(path.join(dir, f), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}
const lib = new IconLibrary(dir, 'RGB');
assert.strictEqual(lib.scan(), 4);
assert.strictEqual(lib.resolve('alt_hold', 'on'), 'alt_hold_on_RGB.png');
assert.strictEqual(lib.resolve('alt_hold', 'clear'), null);
assert.strictEqual(lib.resolve('anti_ice', null), 'anti_ice_RGB.png');
assert.ok(lib.dataUri('alt_hold_on_RGB.png').startsWith('data:image/png;base64,iVBORw'));
const { Renderer } = require('../plugin/com.m18switchboard.msfs.sdPlugin/plugin/render');
const r = new Renderer(lib);
assert.ok(r.icon('alt_hold', 'on').startsWith('data:image/png;base64,'), 'library icon used when present');
assert.strictEqual(r.icon('alt_hold', 'clear'), null, 'missing state falls back to a generated tile');
assert.strictEqual(new Renderer(null).icon('alt_hold', 'on'), null, 'no library at all');
const { tiles } = require('../plugin/com.m18switchboard.msfs.sdPlugin/plugin/render');
const combined = decodeURIComponent(tiles.iconReadout(r.icon('alt_hold', 'on'), '1013'));
assert.ok(combined.includes('<image href="data:image/png;base64,') && combined.includes('>1013<'), 'icon above readout');
fs.rmSync(dir, { recursive: true });

console.log('icons: PASS');
