// The editor's Browse catalogs: the full MSFS 2024 SDK lists (scripts/build-catalog.py), common
// entries first.
const assert = require('assert');
const path = require('path');
const dir = path.join(__dirname, '..', 'plugin', 'com.m18switchboard.msfs.sdPlugin', 'catalog');
const simvars = require(path.join(dir, 'simvars.json'));
const events = require(path.join(dir, 'events.json'));

assert.ok(simvars.length > 1500, `simvars: ${simvars.length}`);
assert.ok(events.length > 2000, `events: ${events.length}`);
for (const list of [simvars, events]) {
  const names = list.map(e => e.name);
  assert.strictEqual(new Set(names).size, names.length, 'no repeats');
  assert.ok(list[0].common, 'common entries first');
  for (const e of list) assert.ok(e.name && e.cat && typeof e.desc === 'string', JSON.stringify(e));
}
for (const e of simvars) assert.ok(e.unit, `${e.name} has a unit`);
const has = (list, n) => assert.ok(list.some(e => e.name === n), n);
// Ones the user needed and did not find before (2026-10-29), plus a sample from each SDK page.
for (const n of ['COM2_RADIO_SWAP', 'COM1_RECEIVE_SELECT', 'AP_APR_HOLD_ON', 'COM3_RADIO_SWAP', 'TOGGLE_MASTER_BATTERY', 'GEAR_TOGGLE', 'VIEW_MODE']) has(events, n);
for (const n of ['COM RECEIVE:1', 'AUTOPILOT APPROACH CAPTURED', 'LOCAL TIME', 'GEAR HANDLE POSITION', 'FUEL TOTAL QUANTITY', 'ROTOR RPM:1']) has(simvars, n);
console.log(`catalog: PASS (${simvars.length} simvars, ${events.length} events)`);
