// Drives SimConnectBackend with a fake SimConnect handle. Checks our bookkeeping (definitions,
// requests, decoding, events, reconnect); says nothing about how MSFS itself behaves.
const assert = require('assert');
const { EventEmitter } = require('events');
const path = require('path');
const pluginDir = path.join(__dirname, '..', 'plugin', 'com.m18switchboard.msfs.sdPlugin', 'plugin');
const { SimConnectBackend } = require(path.join(pluginDir, 'sim', 'simconnect'));
const { RawBuffer, SimConnectPeriod } = require(path.join(pluginDir, 'node_modules', 'node-simconnect'));

class FakeHandle extends EventEmitter {
  constructor() { super(); this.calls = []; this.sendId = 100; }
  rec(name, args) { this.calls.push([name, ...args]); return this.sendId++; }
  subscribeToSystemEvent(...a) { return this.rec('subscribeToSystemEvent', a); }
  addToDataDefinition(...a) { return this.rec('addToDataDefinition', a); }
  requestDataOnSimObject(...a) { return this.rec('requestDataOnSimObject', a); }
  clearDataDefinition(...a) { return this.rec('clearDataDefinition', a); }
  mapClientEventToSimEvent(...a) { return this.rec('mapClientEventToSimEvent', a); }
  transmitClientEvent(...a) { return this.rec('transmitClientEvent', a); }
  close() { this.emit('close'); }
  defIdFor(name) { return this.calls.filter(c => c[0] === 'addToDataDefinition' && c[2] === name).pop()[1]; }
  data(name, buf) { this.emit('simObjectData', { requestID: this.defIdFor(name), data: new RawBuffer(buf) }); }
}
const int32 = v => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const float64 = v => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return b; };
const str256 = s => { const b = Buffer.alloc(256); b.write(s, 'latin1'); return b; };
const recvOpen = { applicationName: 'KittyHawk', applicationVersionMajor: 12, applicationVersionMinor: 1,
  applicationBuildMajor: 1, applicationBuildMinor: 0 };

(async () => {
  let handle = new FakeHandle();
  const sim = new SimConnectBackend({ openFn: async () => ({ recvOpen, handle }) });
  const seen = { connected: 0, disconnected: 0, aircraft: [], exceptions: [] };
  sim.on('connected', () => seen.connected++);
  sim.on('disconnected', () => seen.disconnected++);
  sim.on('exception', e => seen.exceptions.push(e));
  sim.onAircraftChanged(a => seen.aircraft.push(a));

  // Subscribing before connect is allowed; registration happens on connect.
  const got = [];
  const unsub = sim.subscribe([{ name: 'LIGHT LANDING', unit: 'bool', type: 'bool' },
    { name: 'KOHLSMAN SETTING MB:1', unit: 'millibars', type: 'number' }], (n, v) => got.push([n, v]));
  await sim.connect();
  assert.strictEqual(seen.connected, 1);
  assert.ok(handle.calls.some(c => c[0] === 'subscribeToSystemEvent' && c[2] === 'AircraftLoaded'));
  assert.ok(handle.calls.some(c => c[0] === 'addToDataDefinition' && c[2] === 'TITLE' && c[3] === null));
  const req = handle.calls.find(c => c[0] === 'requestDataOnSimObject' && c[2] === handle.defIdFor('LIGHT LANDING'));
  assert.strictEqual(req[4], SimConnectPeriod.SIM_FRAME, 'per-frame check');
  assert.strictEqual(req[5], 1, 'but only sent when changed');

  handle.data('LIGHT LANDING', int32(1));
  handle.data('KOHLSMAN SETTING MB:1', float64(1013.25));
  assert.deepStrictEqual(got, [['LIGHT LANDING', true], ['KOHLSMAN SETTING MB:1', 1013.25]]);

  // A late subscriber gets the current value immediately.
  const late = [];
  sim.subscribe([{ name: 'LIGHT LANDING', unit: 'bool', type: 'bool' }], (n, v) => late.push(v));
  assert.deepStrictEqual(late, [true]);

  handle.data('TITLE', str256('Cessna Skyhawk G1000 Asobo'));
  handle.data('ATC MODEL', str256('C172'));
  assert.strictEqual(seen.aircraft.length, 1, 'announced once, not once per variable');
  assert.deepStrictEqual(seen.aircraft.pop(), { title: 'Cessna Skyhawk G1000 Asobo', atcModel: 'C172' });

  // Events are mapped once, sent each time; exceptions name what they were about.
  sim.send({ event: 'LANDING_LIGHTS_TOGGLE' });
  sim.send({ event: 'LANDING_LIGHTS_TOGGLE' });
  assert.strictEqual(handle.calls.filter(c => c[0] === 'mapClientEventToSimEvent').length, 1);
  assert.strictEqual(handle.calls.filter(c => c[0] === 'transmitClientEvent').length, 2);
  const mapId = 100 + handle.calls.findIndex(c => c[0] === 'mapClientEventToSimEvent');
  handle.emit('exception', { exception: 7, exceptionName: 'NAME_UNRECOGNIZED', sendId: mapId });
  assert.deepStrictEqual(seen.exceptions.pop(), { name: 'NAME_UNRECOGNIZED', about: 'event LANDING_LIGHTS_TOGGLE' });

  // One-shot read.
  const p = sim.read({ name: 'LIGHT NAV', unit: 'bool', type: 'bool' });
  handle.data('LIGHT NAV', int32(0));
  assert.strictEqual(await p, false);

  // Unsubscribing the last listener stops the request.
  const kohlsmanDef = handle.defIdFor('KOHLSMAN SETTING MB:1');
  unsub();
  assert.ok(handle.calls.some(c => c[0] === 'requestDataOnSimObject' && c[1] === kohlsmanDef && c[4] === SimConnectPeriod.NEVER));
  assert.ok(handle.calls.some(c => c[0] === 'clearDataDefinition' && c[1] === kohlsmanDef));

  // Disconnect clears state; reconnect re-registers what is still subscribed.
  handle.emit('quit');
  assert.strictEqual(seen.disconnected, 1);
  assert.strictEqual(sim.connected, false);
  handle = new FakeHandle();
  await sim.connect();
  const names = handle.calls.filter(c => c[0] === 'addToDataDefinition').map(c => c[2]);
  assert.deepStrictEqual(names.sort(), ['ATC MODEL', 'LIGHT LANDING', 'TITLE']);
  handle.data('TITLE', str256('Cessna Skyhawk G1000 Asobo'));
  handle.data('ATC MODEL', str256('C172'));
  assert.strictEqual(seen.aircraft.length, 1, 'aircraft announced once, again after reconnect');

  console.log('simconnect: PASS');
})().catch(e => { console.error('simconnect: FAIL', e); process.exitCode = 1; });
