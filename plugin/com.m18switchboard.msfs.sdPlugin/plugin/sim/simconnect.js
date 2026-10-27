// Sim layer, SimConnect implementation of the SimBackend interface (DESIGN_BRIEF.md section 3):
//   connect(), onAircraftChanged(cb), subscribe(vars, cb), read(var), send(action)
// Other backends (MobiFlight, AAO, ...) should expose the same methods and events:
//   'connected' (info), 'disconnected', 'aircraft' ({ title, atcModel }), 'aircraftLoaded' (file),
//   'exception' ({ name, about })
//
// A variable spec is { name, unit, type } with type one of bool | int | number | string.
// An action is { event, value } where value defaults to 0.
const { EventEmitter } = require('events');
const {
  open, Protocol, SimConnectConstants, SimConnectPeriod, SimConnectDataType,
  DataRequestFlag, EventFlag,
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
const AIRCRAFT_VARS = [
  { name: 'TITLE', unit: null, type: 'string' },
  { name: 'ATC MODEL', unit: null, type: 'string' },
];

function specKey(s) { return `${s.name}|${s.unit}|${s.type}`; }

class SimConnectBackend extends EventEmitter {
  constructor({ appName = 'MSFS Switchboard', openFn = open } = {}) {
    super();
    this.appName = appName;
    this.openFn = openFn;
    this.handle = null;
    this.subs = new Map(); // specKey -> { spec, defId, listeners: Set, value }
    this.events = new Map(); // event name -> client event id
    this.sent = new Map(); // SimConnect send id -> what it was, for readable exceptions
    this.oneShots = new Map(); // defId -> resolve
    this.nextId = 10;
    this.aircraft = { title: undefined, atcModel: undefined };
    this._aircraftCb = () => this._aircraftChanged(); // one function, so reconnects don't stack listeners
  }

  get connected() { return this.handle !== null; }

  async connect() {
    const { recvOpen, handle } = await this.openFn(this.appName, Protocol.KittyHawk);
    this.handle = handle;
    this.events.clear();
    this.sent.clear();

    handle.on('simObjectData', d => this._onData(d));
    handle.on('exception', e => this.emit('exception', {
      name: e.exceptionName || String(e.exception), about: this.sent.get(e.sendId) || `send id ${e.sendId}`,
    }));
    handle.on('eventFilename', e => {
      if (e.clientEventId === AIRCRAFT_LOADED_EVENT) this.emit('aircraftLoaded', e.fileName);
    });
    const lost = () => {
      if (!this.handle) return;
      this.handle = null;
      for (const s of this.subs.values()) s.value = undefined;
      this.aircraft = { title: undefined, atcModel: undefined };
      this.emit('disconnected');
    };
    handle.on('quit', lost);
    handle.on('close', lost);
    handle.on('error', lost);

    this._track(handle.subscribeToSystemEvent(AIRCRAFT_LOADED_EVENT, 'AircraftLoaded'), 'system event AircraftLoaded');
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

  _aircraftChanged() {
    const get = name => this.subs.get(specKey(AIRCRAFT_VARS.find(v => v.name === name)))?.value;
    const next = { title: get('TITLE'), atcModel: get('ATC MODEL') };
    if (next.title === undefined || next.atcModel === undefined) return; // wait for both
    if (next.title === this.aircraft.title && next.atcModel === this.aircraft.atcModel) return;
    this.aircraft = next;
    this.emit('aircraft', next);
  }
}

module.exports = { SimConnectBackend, TYPES };
