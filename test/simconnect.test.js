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
  requestSystemState(...a) { return this.rec('requestSystemState', a); }
  enumerateInputEvents(...a) { return this.rec('enumerateInputEvents', a); }
  getInputEvent(...a) { return this.rec('getInputEvent', a); }
  setInputEvent(...a) { return this.rec('setInputEvent', a); }
  subscribeInputEvent(...a) { return this.rec('subscribeInputEvent', a); }
  unsubscribeInputEvent(...a) { return this.rec('unsubscribeInputEvent', a); }
  last(name) { return this.calls.filter(c => c[0] === name).pop(); }
  close() { this.emit('close'); }
  defIdFor(name) { return this.calls.filter(c => c[0] === 'addToDataDefinition' && c[2] === name).pop()[1]; }
  data(name, buf) { this.emit('simObjectData', { requestID: this.defIdFor(name), data: new RawBuffer(buf) }); }
}
const int32 = v => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const float64 = v => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return b; };
const str256 = s => { const b = Buffer.alloc(256); b.write(s, 'latin1'); return b; };
const recvOpen = { applicationName: 'KittyHawk', applicationVersionMajor: 12, applicationVersionMinor: 1,
  applicationBuildMajor: 1, applicationBuildMinor: 0 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const C172_PATH = 'd:\\...\\asobo_c172sp_g1000\\presets\\asobo\\c172sp_avionics_passengers\\config\\aircraft.cfg';

(async () => {
  let handle = new FakeHandle();
  const sim = new SimConnectBackend({ openFn: async () => ({ recvOpen, handle }), aircraftDebounceMs: 20, pathWaitMs: 150 });
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

  // Title, model and file path arrive separately (as seen in MSFS 2024) and are announced once.
  assert.ok(handle.calls.some(c => c[0] === 'requestSystemState' && c[2] === 'AircraftLoaded'));
  handle.data('TITLE', str256('C172SP G1000 Passengers'));
  handle.data('ATC MODEL', str256('ATCCOM.AC_MODEL C172.0.text'));
  await sleep(5);
  handle.emit('systemState', { requestID: handle.last('requestSystemState')[1], dataString: C172_PATH });
  await sleep(40);
  assert.strictEqual(seen.aircraft.length, 1, 'announced once, after things settle');
  assert.deepStrictEqual(seen.aircraft.pop(),
    { title: 'C172SP G1000 Passengers', atcModel: 'ATCCOM.AC_MODEL C172.0.text', path: C172_PATH });

  // Picking another aircraft (as in the user's 2026-10-28 log): title and model change first, the
  // new path arrives seconds later. The old C172 path must never be paired with the Caravan.
  handle.data('TITLE', str256('Black Square Caravan'));
  handle.data('ATC MODEL', str256('ATCCOM.AC_MODEL C208.0.text'));
  assert.strictEqual(handle.last('requestSystemState')[2], 'AircraftLoaded', 'asks for the new path');
  await sleep(80);
  assert.strictEqual(seen.aircraft.length, 0, 'waits for the new path');
  handle.emit('eventFilename', { clientEventId: 1, fileName: 'bksq\\aircraft.cfg' });
  await sleep(40);
  assert.deepStrictEqual(seen.aircraft.splice(0),
    [{ title: 'Black Square Caravan', atcModel: 'ATCCOM.AC_MODEL C208.0.text', path: 'bksq\\aircraft.cfg' }]);

  // If no new path comes, announce without one rather than with the stale one.
  handle.data('TITLE', str256('Some Other Aircraft'));
  await sleep(200);
  assert.deepStrictEqual(seen.aircraft.splice(0),
    [{ title: 'Some Other Aircraft', atcModel: 'ATCCOM.AC_MODEL C208.0.text', path: undefined }]);

  // Input events: list (two pages), subscribe, change, get, set.
  const listing = sim.listInputEvents();
  const listReq = handle.last('enumerateInputEvents')[1];
  handle.emit('inputEventsList', { requestID: listReq, entryNumber: 0, outOf: 2,
    inputEventDescriptors: [{ name: 'ELECTRICAL_Avionics_Bus_1', inputEventIdHash: 11n, type: 0 }] });
  handle.emit('inputEventsList', { requestID: listReq, entryNumber: 1, outOf: 2,
    inputEventDescriptors: [{ name: 'ELECTRICAL_Avionics_Bus_2', inputEventIdHash: 22n, type: 0 }] });
  assert.deepStrictEqual((await listing).map(e => e.name), ['ELECTRICAL_Avionics_Bus_1', 'ELECTRICAL_Avionics_Bus_2']);
  const inputSeen = [];
  const unsubInput = sim.subscribeInput(['ELECTRICAL_Avionics_Bus_1'], (n, v) => inputSeen.push([n, v]));
  assert.strictEqual(handle.last('subscribeInputEvent')[1], 11n);
  handle.emit('subscribeInputEvent', { inputEventIdHash: 11n, type: 0, value: 1 });
  handle.emit('subscribeInputEvent', { inputEventIdHash: 11n, type: 0, value: 1 });
  assert.deepStrictEqual(inputSeen, [['ELECTRICAL_Avionics_Bus_1', 1]], 'repeats of the same value are dropped');
  const getting = sim.getInput('ELECTRICAL_Avionics_Bus_2');
  handle.emit('getInputEvent', { requestID: handle.last('getInputEvent')[1], type: 0, value: 0 });
  assert.strictEqual(await getting, 0);
  sim.setInput('ELECTRICAL_Avionics_Bus_2', 1);
  assert.deepStrictEqual(handle.last('setInputEvent').slice(1), [22n, 1]);
  assert.throws(() => sim.setInput('NOPE', 1), /unknown input event/);
  unsubInput();
  assert.strictEqual(handle.last('unsubscribeInputEvent')[1], 11n);

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
  handle.data('TITLE', str256('Black Square Caravan'));
  handle.data('ATC MODEL', str256('ATCCOM.AC_MODEL C208.0.text'));
  await sleep(200);
  assert.strictEqual(seen.aircraft.length, 1, 'aircraft announced again after reconnect');
  assert.throws(() => sim.setInput('ELECTRICAL_Avionics_Bus_2', 1), /unknown input event/, 'input list dropped on disconnect');
  sim.close();

  console.log('simconnect: PASS');
})().catch(e => { console.error('simconnect: FAIL', e); process.exitCode = 1; });
