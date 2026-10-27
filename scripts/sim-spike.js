// Phase 1 sim link spike. No dock involved.
//   npm run sim:spike     (with MSFS 2024 running, ideally the default Cessna 172 loaded)
//
// Shows the loaded aircraft, prints C172 switch and radio values as they change, toggles the
// landing light on and off once by itself, then lets you fire each candidate event from the
// keyboard and reports whether the matching variable followed. Everything is also written to
// logs/sim-spike-<date>.log for docs/verified.md.
const fs = require('fs');
const path = require('path');
const { SimConnectBackend } = require('../plugin/com.m18switchboard.msfs.sdPlugin/plugin/sim/simconnect');

// Candidates from DESIGN_BRIEF.md section 5. Nothing here is trusted until this script says so.
const SWITCHES = [
  { key: '1', label: 'Battery master', var: 'ELECTRICAL MASTER BATTERY', event: 'TOGGLE_MASTER_BATTERY' },
  { key: '2', label: 'Alternator', var: 'GENERAL ENG MASTER ALTERNATOR:1', event: 'TOGGLE_MASTER_ALTERNATOR' },
  { key: '3', label: 'Avionics master', var: 'AVIONICS MASTER SWITCH', event: 'AVIONICS_MASTER_SET', set: true },
  { key: '4', label: 'Beacon', var: 'LIGHT BEACON', event: 'TOGGLE_BEACON_LIGHTS' },
  { key: '5', label: 'Landing', var: 'LIGHT LANDING', event: 'LANDING_LIGHTS_TOGGLE' },
  { key: '6', label: 'Taxi', var: 'LIGHT TAXI', event: 'TOGGLE_TAXI_LIGHTS' },
  { key: '7', label: 'Nav', var: 'LIGHT NAV', event: 'TOGGLE_NAV_LIGHTS' },
  { key: '8', label: 'Strobe', var: 'LIGHT STROBE', event: 'STROBES_TOGGLE' },
  { key: '9', label: 'Pitot heat', var: 'PITOT HEAT SWITCH', event: 'PITOT_HEAT_TOGGLE' },
];
const READOUTS = [
  { label: 'QNH', var: 'KOHLSMAN SETTING MB:1', unit: 'millibars', type: 'number', fmt: v => v.toFixed(1) },
  { label: 'COM1 active', var: 'COM ACTIVE FREQUENCY:1', unit: 'MHz', type: 'number', fmt: v => v.toFixed(3) },
  { label: 'COM1 standby', var: 'COM STANDBY FREQUENCY:1', unit: 'MHz', type: 'number', fmt: v => v.toFixed(3) },
  // Raw value printed in decimal and hex: hex 0x1200 would mean the sim returns BCD.
  { label: 'Transponder', var: 'TRANSPONDER CODE:1', unit: 'number', type: 'int', fmt: v => `${v} (hex 0x${v.toString(16)})` },
];
const VERIFY_MS = 2000;

const logDir = path.join(__dirname, '..', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `sim-spike-${new Date().toISOString().slice(0, 10)}.log`);
function out(line) {
  const stamped = `${new Date().toISOString().slice(11, 23)} ${line}`;
  console.log(stamped);
  fs.appendFileSync(logFile, stamped + '\n');
}

const sim = new SimConnectBackend({ appName: 'MSFS Switchboard spike' });
const values = new Map(); // var name -> latest value
const pending = new Map(); // var name -> { sw, before, timer }
const results = new Map(); // event -> result text
const exceptions = [];
let demoDone = false;

const vars = [
  ...SWITCHES.map(s => ({ name: s.var, unit: 'bool', type: 'bool' })),
  ...READOUTS.map(r => ({ name: r.var, unit: r.unit, type: r.type })),
];

sim.on('connected', info => {
  out(`CONNECTED to ${info.app} version ${info.version} build ${info.build}`);
  out('Keys: 1-9 fire a switch event, r re-reads everything once, q quits.');
  SWITCHES.forEach(s => out(`  ${s.key} = ${s.label.padEnd(16)} ${s.event}`));
});
sim.on('disconnected', () => { out('DISCONNECTED (sim closed?). Retrying every 5 s.'); retry(); });
sim.on('exception', e => { exceptions.push(e); out(`SIM EXCEPTION ${e.name} about ${e.about}`); });
sim.on('aircraftLoaded', file => out(`AIRCRAFT LOADED event: ${file}`));
sim.onAircraftChanged(a => {
  out(`AIRCRAFT title="${a.title}" atcModel="${a.atcModel}" path="${a.path}"`);
  if (!demoDone) setTimeout(landingDemo, 3000);
});

sim.subscribe(vars, (name, value) => {
  const first = !values.has(name);
  const before = values.get(name);
  values.set(name, value);
  const sw = SWITCHES.find(s => s.var === name);
  const ro = READOUTS.find(r => r.var === name);
  const shown = sw ? (value ? 'ON' : 'off') : ro.fmt(value);
  out(`${first ? 'VALUE ' : 'CHANGE'} ${(sw || ro).label.padEnd(16)} ${shown}${first ? '' : `   (was ${sw ? (before ? 'ON' : 'off') : ro.fmt(before)})`}`);
  const p = pending.get(name);
  if (p && value !== p.before) {
    clearTimeout(p.timer);
    pending.delete(name);
    record(p.sw, `OK   ${p.sw.event} moved ${p.sw.var} to ${value ? 'ON' : 'off'}`);
  }
});

function record(sw, text) {
  results.set(sw.event, text);
  out(`RESULT ${text}`);
}

function fire(sw) {
  if (!sim.connected) return out('Not connected.');
  const before = values.get(sw.var);
  const value = sw.set ? (before ? 0 : 1) : 0;
  out(`SEND   ${sw.event}${sw.set ? ` value ${value}` : ''}`);
  pending.set(sw.var, {
    sw, before,
    timer: setTimeout(() => {
      pending.delete(sw.var);
      record(sw, `FAIL ${sw.event}: ${sw.var} did not change within ${VERIFY_MS / 1000} s (still ${values.get(sw.var) ? 'ON' : 'off'})`);
    }, VERIFY_MS),
  });
  sim.send({ event: sw.event, value });
}

function landingDemo() {
  if (demoDone || !sim.connected) return;
  demoDone = true;
  const landing = SWITCHES.find(s => s.label === 'Landing');
  out('DEMO   toggling the landing light now, and back again in 3 s. Watch the cockpit switch.');
  fire(landing);
  setTimeout(() => fire(landing), 3000);
}

async function rereadAll() {
  for (const v of vars) {
    try { out(`READ   ${v.name} = ${await sim.read(v)}`); } catch (e) { out(`READ   ${v.name} failed: ${e.message}`); }
  }
}

function summary() {
  out('==== SUMMARY ====');
  for (const v of vars) out(`${values.has(v.name) ? 'seen   ' : 'MISSING'} ${v.name}`);
  for (const s of SWITCHES) out(results.get(s.event) || `untested ${s.event}`);
  out(`${exceptions.length} sim exception(s)`);
  out(`Log file: ${logFile}`);
}

let retryTimer = null;
function retry() {
  if (retryTimer) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    try { await sim.connect(); } catch (e) { out(`Could not connect (${e.message || e}). Is MSFS running? Retrying in 5 s.`); retry(); }
  }, 5000);
}

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', k => {
    if (k === 'q' || k === '\u0003') { summary(); sim.close(); process.exit(0); }
    if (k === 'r') return void rereadAll();
    const sw = SWITCHES.find(s => s.key === k);
    if (sw) fire(sw);
  });
}

out(`MSFS Switchboard sim spike. Node ${process.version}. Connecting...`);
sim.connect().catch(e => { out(`Could not connect (${e.message || e}). Is MSFS running? Retrying in 5 s.`); retry(); });
