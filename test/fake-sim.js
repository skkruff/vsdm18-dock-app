// A stand-in for SimConnectBackend: records what is set and sent, and lets tests report changes.
const { EventEmitter } = require('events');

class FakeSim extends EventEmitter {
  constructor(inputValues) {
    super();
    this.inputValues = inputValues; // name -> value; the aircraft's input events
    this.inputs = new Map();
    this.inputSubs = new Map(); // name -> Set(cb)
    this.varSubs = new Map(); // name -> Set(cb)
    this.sets = [];
    this.sent = [];
  }
  onAircraftChanged(cb) { this.on('aircraft', cb); }
  get connected() { return this.connectedFlag !== false; }
  async listInputEvents() {
    for (const n of Object.keys(this.inputValues)) this.inputs.set(n, {});
    return [...this.inputs.keys()].map(name => ({ name }));
  }
  subscribeInput(names, cb) {
    for (const n of names) {
      if (!this.inputs.has(n)) throw new Error(`unknown input event ${n}`);
      if (!this.inputSubs.has(n)) this.inputSubs.set(n, new Set());
      this.inputSubs.get(n).add(cb);
    }
    return () => names.forEach(n => this.inputSubs.get(n).delete(cb));
  }
  async getInput(n) { return this.inputValues[n]; }
  setInput(n, v) { this.sets.push([n, v]); }
  subscribe(vars, cb) {
    for (const v of vars) {
      if (!this.varSubs.has(v.name)) this.varSubs.set(v.name, new Set());
      this.varSubs.get(v.name).add(cb);
    }
    return () => vars.forEach(v => this.varSubs.get(v.name).delete(cb));
  }
  send(a) { this.sent.push(a); }
  // The sim reporting a change.
  input(n, v) { this.inputValues[n] = v; for (const cb of this.inputSubs.get(n) || []) cb(n, v); }
  simvar(n, v) { for (const cb of this.varSubs.get(n) || []) cb(n, v); }
  activeInputSubs() { return [...this.inputSubs].filter(([, s]) => s.size).map(([n]) => n).sort(); }
}

module.exports = { FakeSim };
