// Sim layer, SimConnect implementation of the SimBackend interface (DESIGN_BRIEF.md section 3):
//   connect(), onAircraftChanged(cb), subscribe(vars, cb), read(var), send(action), setVar(var, value)
// Other backends (MobiFlight, AAO, ...) should expose the same methods and events:
//   'connected' (info), 'disconnected', 'aircraft' ({ title, atcModel, path }),
//   'aircraftLoaded' (file), 'exception' ({ name, about }), 'pause' (Pause_EX1 flags, 0 = running)
//
// A variable spec is { name, unit, type } with type one of bool | int | number | string.
// An action is { event, value } where value defaults to 0.
//
// Input events (MSFS's per-aircraft named cockpit controls, e.g. the 2024 C172's avionics bus
// switches) are reached through listInputEvents(), subscribeInput(), getInput() and setInput().
// Their hashes are only valid for the aircraft they were listed for.
const { EventEmitter } = require('events');
const {
  open, Protocol, SimConnectConstants, SimConnectPeriod, SimConnectDataType,
  DataRequestFlag, EventFlag, RawBuffer,
} = require('node-simconnect');

const TYPES = {
  bool: { dataType: SimConnectDataType.INT32, read: b => b.readInt32() !== 0 },
  int: { dataType: SimConnectDataType.INT32, read: b => b.readInt32() },
  number: { dataType: SimConnectDataType.FLOAT64, read: b => b.readFloat64() },
  string: { dataType: SimConnectDataType.STRING256, read: b => b.readString256() },
};

const USER = SimConnectConstants.OBJECT_ID_USER;
const GROUP_PRIORITY_HIGHEST = 1;
const AIRCRAFT_LOADED_EVENT = 1;
// Pause_EX1 reports the pause state as flags: 0 none, 1 full (menu), 2 legacy pause key, 4 active
// pause, 8 sim pause. SIMULATION TIME keeps running in active pause (user test, 2026-10-30), so
// stopwatches follow this instead.
const PAUSE_EVENT = 3;
const AIRCRAFT_STATE_REQUEST = 2;
const AIRCRAFT_VARS = [
  { name: 'TITLE', unit: null, type: 'string' },
  { name: 'ATC MODEL', unit: null, type: 'string' },
];

function specKey(s) { return `${s.name}|${s.unit}|${s.type}`; }

// The AircraftLoaded event gives an absolute lower-case path, the system state request a relative
// one; compare them from the SimObjects folder on.
function samePath(a, b) {
  const norm = p => (p || '').toLowerCase().replace(/\//g, '\\').replace(/^.*?(simobjects\\)/, '$1');
  return !!a && !!b && norm(a) === norm(b);
}

class SimConnectBackend extends EventEmitter {
  constructor({ appName = 'MSFS Switchboard', openFn = open, aircraftDebounceMs = 750, pathWaitMs = 5000 } = {}) {
    super();
    this.appName = appName;
    this.openFn = openFn;
    this.handle = null;
    this.subs = new Map(); // specKey -> { spec, defId, listeners: Set, value }
    this.events = new Map(); // event name -> client event id
    this.writeDefs = new Map(); // 'name|unit' -> data definition used to set that simvar
    this.sent = new Map(); // SimConnect send id -> what it was, for readable exceptions
    this.oneShots = new Map(); // defId -> resolve
    this.nextId = 10;
    this.aircraftDebounceMs = aircraftDebounceMs;
    this.aircraft = { title: undefined, atcModel: undefined, path: undefined };
    this.aircraftPath = undefined;
    this.aircraftTimer = null;
    this.pathWaitMs = pathWaitMs;
    this.lastTitle = undefined;
    this.titleChangedAt = 0;
    this.pathAt = 0;
    this.pathBeforeTitleChange = undefined;
    this.inputs = new Map(); // input event name -> { hash, type }
    this.inputSubs = new Map(); // hash (bigint) -> { name, listeners: Set, value }
    this.inputLists = new Map(); // request id -> { found: [], resolve }
    this.inputGets = new Map(); // request id -> resolve
    this._aircraftCb = () => this._aircraftChanged(); // one function, so reconnects don't stack listeners
  }

  get connected() { return this.handle !== null; }

  async connect() {
    const { recvOpen, handle } = await this.openFn(this.appName, Protocol.KittyHawk);
    this.handle = handle;
    this.events.clear();
    this.writeDefs.clear();
    this.sent.clear();

    handle.on('simObjectData', d => this._onData(d));
    handle.on('exception', e => this.emit('exception', {
      name: e.exceptionName || String(e.exception), about: this.sent.get(e.sendId) || `send id ${e.sendId}`,
    }));
    handle.on('event', e => {
      if (e.clientEventId !== PAUSE_EVENT) return;
      this.pauseFlags = e.data;
      this.emit('pause', e.data);
    });
    handle.on('eventFilename', e => {
      if (e.clientEventId !== AIRCRAFT_LOADED_EVENT) return;
      this.emit('aircraftLoaded', e.fileName);
      this._gotPath(e.fileName);
    });
    handle.on('systemState', s => {
      if (s.requestID !== AIRCRAFT_STATE_REQUEST) return;
      this._gotPath(s.dataString);
    });
    handle.on('inputEventsList', r => this._onInputList(r));
    handle.on('getInputEvent', r => {
      const resolve = this.inputGets.get(r.requestID);
      if (resolve) { this.inputGets.delete(r.requestID); resolve(r.value); }
    });
    handle.on('subscribeInputEvent', r => {
      const s = this.inputSubs.get(r.inputEventIdHash);
      if (!s || s.value === r.value) return;
      s.value = r.value;
      for (const cb of [...s.listeners]) cb(s.name, r.value);
    });
    const lost = () => {
      if (!this.handle) return;
      this.handle = null;
      for (const s of this.subs.values()) s.value = undefined;
      clearTimeout(this.aircraftTimer);
      this.aircraft = { title: undefined, atcModel: undefined, path: undefined };
      this.aircraftPath = undefined;
      this.lastTitle = undefined;
      this._forgetInputs();
      this.emit('disconnected');
    };
    handle.on('quit', lost);
    handle.on('close', lost);
    handle.on('error', lost);

    this._track(handle.subscribeToSystemEvent(AIRCRAFT_LOADED_EVENT, 'AircraftLoaded'), 'system event AircraftLoaded');
    this._track(handle.subscribeToSystemEvent(PAUSE_EVENT, 'Pause_EX1'), 'system event Pause_EX1');
    // The event only fires on a load; ask for the current aircraft file too.
    this._track(handle.requestSystemState(AIRCRAFT_STATE_REQUEST, 'AircraftLoaded'), 'system state AircraftLoaded');
    // Re-register everything subscribed before a (re)connect.
    for (const s of this.subs.values()) this._register(s);
    this.subscribe(AIRCRAFT_VARS, this._aircraftCb);

    this.emit('connected', {
      app: recvOpen.applicationName,
      version: `${recvOpen.applicationVersionMajor}.${recvOpen.applicationVersionMinor}`,
      build: `${recvOpen.applicationBuildMajor}.${recvOpen.applicationBuildMinor}`,
    });
  }

  close() {
    if (this.handle) this.handle.close();
  }

  onAircraftChanged(cb) {
    this.on('aircraft', cb);
    if (this.aircraft.title !== undefined) cb(this.aircraft);
  }

  // Calls cb(name, value, spec) whenever one of vars changes, and once with the current value.
  // Returns a function that removes this subscription.
  subscribe(vars, cb) {
    const entries = vars.map(spec => {
      if (!TYPES[spec.type]) throw new Error(`unknown type ${spec.type} for ${spec.name}`);
      const key = specKey(spec);
      let s = this.subs.get(key);
      if (!s) {
        s = { spec, defId: this.nextId++, listeners: new Set(), value: undefined };
        this.subs.set(key, s);
        if (this.handle) this._register(s);
      }
      s.listeners.add(cb);
      if (s.value !== undefined) cb(spec.name, s.value, spec);
      return [key, s];
    });
    return () => {
      for (const [key, s] of entries) {
        s.listeners.delete(cb);
        if (s.listeners.size) continue;
        this.subs.delete(key);
        if (this.handle) {
          this.handle.requestDataOnSimObject(s.defId, s.defId, USER, SimConnectPeriod.NEVER);
          this.handle.clearDataDefinition(s.defId);
        }
      }
    };
  }

  // One-off read of a variable. Rejects if the sim does not answer within timeoutMs.
  read(spec, timeoutMs = 3000) {
    if (!this.handle) return Promise.reject(new Error('not connected'));
    const defId = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.oneShots.delete(defId); reject(new Error(`no answer for ${spec.name}`)); }, timeoutMs);
      this.oneShots.set(defId, { spec, resolve: v => { clearTimeout(timer); resolve(v); } });
      this._define(defId, spec);
      this.handle.requestDataOnSimObject(defId, defId, USER, SimConnectPeriod.ONCE);
    });
  }

  send({ event, value = 0 }) {
    if (!this.handle) throw new Error('not connected');
    if (!this.events.has(event)) {
      const id = this.nextId++;
      this._track(this.handle.mapClientEventToSimEvent(id, event), `event ${event}`);
      this.events.set(event, id);
    }
    this._track(this.handle.transmitClientEvent(USER, this.events.get(event), value,
      GROUP_PRIORITY_HIGHEST, EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY), `send ${event}`);
  }

  // Sets a simvar on the user aircraft (SimConnect SetDataOnSimObject), as a number in unit. The
  // sim only takes it for variables it lets clients set (the SDK's "settable"); for others it
  // reports an exception or ignores it, so read it back to know.
  setVar({ name, unit }, value) {
    if (!this.handle) throw new Error('not connected');
    const key = `${name}|${unit}`;
    let defId = this.writeDefs.get(key);
    if (defId === undefined) {
      defId = this.nextId++;
      this._define(defId, { name, unit, type: 'number' });
      this.writeDefs.set(key, defId);
    }
    const buffer = new RawBuffer(8);
    buffer.writeFloat64(Number(value));
    this._track(this.handle.setDataOnSimObject(defId, USER, { buffer, arrayCount: 0, tagged: false }), `set ${name} (${unit}) to ${value}`);
  }

  // All input events of the loaded aircraft: [{ name, hash, type: 'number' | 'string' }].
  listInputEvents(timeoutMs = 5000) {
    if (!this.handle) return Promise.reject(new Error('not connected'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.inputLists.delete(id);
        reject(new Error('no input event list (aircraft without input events?)'));
      }, timeoutMs);
      this.inputLists.set(id, { found: [], resolve: list => { clearTimeout(timer); resolve(list); } });
      this._track(this.handle.enumerateInputEvents(id), 'enumerate input events');
    });
  }

  getInput(name, timeoutMs = 3000) {
    const ev = this._input(name);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.inputGets.delete(id); reject(new Error(`no answer for ${name}`)); }, timeoutMs);
      this.inputGets.set(id, v => { clearTimeout(timer); resolve(v); });
      this._track(this.handle.getInputEvent(id, ev.hash), `get input ${name}`);
    });
  }

  setInput(name, value) {
    this._track(this.handle.setInputEvent(this._input(name).hash, value), `set input ${name}`);
  }

  // Calls cb(name, value) when one of the named input events changes. Returns an unsubscribe
  // function. Needs listInputEvents() to have run for the current aircraft.
  subscribeInput(names, cb) {
    const subs = names.map(name => {
      const { hash } = this._input(name);
      let s = this.inputSubs.get(hash);
      if (!s) {
        s = { name, listeners: new Set(), value: undefined };
        this.inputSubs.set(hash, s);
        this._track(this.handle.subscribeInputEvent(hash), `subscribe input ${name}`);
      }
      s.listeners.add(cb);
      return [hash, s];
    });
    return () => {
      for (const [hash, s] of subs) {
        s.listeners.delete(cb);
        if (s.listeners.size || this.inputSubs.get(hash) !== s) continue;
        this.inputSubs.delete(hash);
        if (this.handle) this.handle.unsubscribeInputEvent(hash);
      }
    };
  }

  _input(name) {
    if (!this.handle) throw new Error('not connected');
    const ev = this.inputs.get(name);
    if (!ev) throw new Error(`unknown input event ${name} (list them first, for this aircraft)`);
    return ev;
  }

  _onInputList(r) {
    const req = this.inputLists.get(r.requestID);
    if (!req) return;
    for (const d of r.inputEventDescriptors) {
      req.found.push({ name: d.name, hash: d.inputEventIdHash, type: d.type === 1 ? 'string' : 'number' });
    }
    if (r.entryNumber + 1 < r.outOf) return; // more pages to come
    this.inputLists.delete(r.requestID);
    this.inputs = new Map(req.found.map(e => [e.name, { hash: e.hash, type: e.type }]));
    req.resolve(req.found);
  }

  _forgetInputs() {
    this.inputs.clear();
    this.inputSubs.clear();
  }

  _track(sendId, about) {
    if (typeof sendId === 'number') this.sent.set(sendId, about);
  }

  _define(defId, spec) {
    this._track(this.handle.addToDataDefinition(defId, spec.name, spec.type === 'string' ? null : spec.unit,
      TYPES[spec.type].dataType), `variable ${spec.name} (${spec.unit || 'string'})`);
  }

  _register(s) {
    this._define(s.defId, s.spec);
    this.handle.requestDataOnSimObject(s.defId, s.defId, USER, SimConnectPeriod.SIM_FRAME,
      DataRequestFlag.DATA_REQUEST_FLAG_CHANGED);
  }

  _onData(d) {
    const one = this.oneShots.get(d.requestID);
    if (one) {
      this.oneShots.delete(d.requestID);
      this.handle.clearDataDefinition(d.requestID);
      one.resolve(TYPES[one.spec.type].read(d.data));
      return;
    }
    for (const s of this.subs.values()) {
      if (s.defId !== d.requestID) continue;
      s.value = TYPES[s.spec.type].read(d.data);
      for (const cb of [...s.listeners]) cb(s.spec.name, s.value, s.spec);
      return;
    }
  }

  // After a title change the sim keeps reporting the previous aircraft's path for a few seconds,
  // including in answer to a fresh request (user log 2026-10-28). So a path equal to the one in use
  // at the title change counts as stale until a different one arrives.
  _gotPath(path) {
    const waitingForNew = this.titleChangedAt > this.pathAt;
    if (waitingForNew && samePath(path, this.pathBeforeTitleChange)) return;
    this.aircraftPath = path;
    this.pathAt = Date.now();
    this._aircraftChanged();
  }

  // TITLE, ATC MODEL and the aircraft file arrive separately and up to seconds apart during a
  // load (the file path about 2.7 s after the title in MSFS 2024), so wait for them to settle
  // before announcing. If no new path arrives within pathWaitMs (e.g. a livery change within the
  // same aircraft), the last known path stands.
  _aircraftChanged() {
    const get = name => this.subs.get(specKey(AIRCRAFT_VARS.find(v => v.name === name)))?.value;
    const title = get('TITLE');
    if (title !== undefined && title !== this.lastTitle) {
      this.lastTitle = title;
      this.titleChangedAt = Date.now();
      this.pathBeforeTitleChange = this.aircraftPath;
      if (this.handle) this._track(this.handle.requestSystemState(AIRCRAFT_STATE_REQUEST, 'AircraftLoaded'), 'system state AircraftLoaded');
    }
    clearTimeout(this.aircraftTimer);
    this.aircraftTimer = setTimeout(() => {
      const pathStale = this.pathAt < this.titleChangedAt;
      if (pathStale && Date.now() - this.titleChangedAt < this.pathWaitMs) return this._aircraftChanged();
      const next = { title: get('TITLE'), atcModel: get('ATC MODEL'), path: this.aircraftPath };
      if (next.title === undefined || next.atcModel === undefined) return;
      const a = this.aircraft;
      if (next.title === a.title && next.atcModel === a.atcModel && next.path === a.path) return;
      // A different aircraft has different input events.
      if (a.title !== undefined) this._forgetInputs();
      this.aircraft = next;
      this.emit('aircraft', next);
    }, this.aircraftDebounceMs);
  }
}

module.exports = { SimConnectBackend, TYPES };
