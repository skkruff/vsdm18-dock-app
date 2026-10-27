// Cockpit discovery tool. With an aircraft loaded, lists every input event (MSFS's named cockpit
// controls) to a file, then prints each one that changes while you work the cockpit. Commands
// let you set input events, watch any simvar and send any event to work out how to drive a
// control.
//   npm run sim:explore
// Output: logs/sim-explore-<date>.log and logs/input-events-<aircraft>.txt
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { SimConnectBackend } = require('../plugin/com.m18switchboard.msfs.sdPlugin/plugin/sim/simconnect');

const HELP = [
  'Commands (type, then Enter):',
  '  list [text]             input events whose name contains text, with current values',
  '  d                       re-read all input events, show what changed since last time',
  '  get <input>             read one input event',
  '  set <input> <value>     set an input event, then show it 1 s later',
  '  watch <SIMVAR> [unit]   print a simvar whenever it changes (unit defaults to number)',
  '  event <EVENT> [value]   send a classic sim event',
  '  help, q',
];

const logDir = path.join(__dirname, '..', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `sim-explore-${new Date().toISOString().slice(0, 10)}.log`);
function out(line) {
  const stamped = `${new Date().toISOString().slice(11, 23)} ${line}`;
  console.log(stamped);
  fs.appendFileSync(logFile, stamped + '\n');
}

const sim = new SimConnectBackend({ appName: 'MSFS Switchboard explorer' });
let events = []; // [{ name, hash, type }]
let snapshot = new Map(); // input name -> value at last full read
let unsubInputs = null;
let loading = null;

async function readAll() {
  const values = new Map();
  for (const e of events) {
    try { values.set(e.name, await sim.getInput(e.name)); } catch { values.set(e.name, '(no answer)'); }
  }
  return values;
}

async function loadInputs(aircraft) {
  if (unsubInputs) { unsubInputs(); unsubInputs = null; }
  try {
    events = await sim.listInputEvents();
  } catch (e) {
    events = [];
    return out(`INPUT EVENTS none: ${e.message}`);
  }
  events.sort((a, b) => a.name.localeCompare(b.name));
  snapshot = await readAll();
  const slug = (aircraft.title || 'aircraft').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 60);
  const file = path.join(logDir, `input-events-${slug}.txt`);
  fs.writeFileSync(file, [
    `# ${aircraft.title} | ${aircraft.atcModel} | ${aircraft.path}`,
    `# ${events.length} input events, values at ${new Date().toISOString()}`,
    ...events.map(e => `${e.name}\t${e.type}\t${snapshot.get(e.name)}`),
  ].join('\n') + '\n');
  out(`INPUT EVENTS ${events.length} found, list written to ${file}`);
  unsubInputs = sim.subscribeInput(events.map(e => e.name), (name, value) => {
    const before = snapshot.get(name);
    snapshot.set(name, value);
    out(`INPUT  ${name} = ${value}   (was ${before})`);
  });
  out('Ready. Work the cockpit controls one at a time, a few seconds apart.');
}

sim.on('connected', info => { out(`CONNECTED to ${info.app} version ${info.version} build ${info.build}`); HELP.forEach(out); });
sim.on('disconnected', () => { out('DISCONNECTED. Retrying every 5 s.'); retry(); });
sim.on('exception', e => out(`SIM EXCEPTION ${e.name} about ${e.about}`));
sim.on('aircraftLoaded', file => out(`AIRCRAFT LOADED event: ${file}`));
sim.onAircraftChanged(a => {
  out(`AIRCRAFT title="${a.title}" atcModel="${a.atcModel}" path="${a.path}"`);
  loading = loadInputs(a);
});

const commands = {
  async list(text = '') {
    const hits = events.filter(e => e.name.toLowerCase().includes(text.toLowerCase()));
    hits.forEach(e => out(`  ${e.name} = ${snapshot.get(e.name)}`));
    out(`${hits.length} of ${events.length}`);
  },
  async d() {
    const now = await readAll();
    let n = 0;
    for (const [name, v] of now) {
      if (v !== snapshot.get(name)) { out(`DIFF   ${name}: ${snapshot.get(name)} -> ${v}`); n++; }
    }
    snapshot = now;
    out(`${n} changed`);
  },
  async get(name) { out(`GET    ${name} = ${await sim.getInput(name)}`); },
  async set(name, value) {
    const v = isNaN(Number(value)) ? value : Number(value);
    out(`SET    ${name} = ${v}`);
    sim.setInput(name, v);
    await new Promise(r => setTimeout(r, 1000));
    out(`AFTER  ${name} = ${await sim.getInput(name)}`);
  },
  async watch(...words) {
    const last = words[words.length - 1];
    const hasUnit = words.length > 1 && !/[A-Z]/.test(last); // units are lower case, simvars upper
    const unit = hasUnit ? words.pop() : 'number';
    const name = words.join(' ');
    sim.subscribe([{ name, unit, type: 'number' }], (n, v) => out(`SIMVAR ${n} = ${v} (${unit})`));
    out(`WATCH  ${name} (${unit})`);
  },
  async event(name, value = '0') { out(`EVENT  ${name} ${value}`); sim.send({ event: name, value: Number(value) }); },
  async help() { HELP.forEach(out); },
};

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async line => {
  const [cmd, ...args] = line.trim().split(/\s+/);
  if (!cmd) return;
  fs.appendFileSync(logFile, `> ${line}\n`);
  if (cmd === 'q') { sim.close(); process.exit(0); }
  if (!commands[cmd]) return out(`Unknown command ${cmd}. Type help.`);
  if (!sim.connected) return out('Not connected.');
  try { await loading; await commands[cmd](...args); } catch (e) { out(`ERROR  ${e.message}`); }
});

let retryTimer = null;
function retry() {
  if (retryTimer) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    try { await sim.connect(); } catch (e) { out(`Could not connect (${e.message || e}). Retrying in 5 s.`); retry(); }
  }, 5000);
}

out(`MSFS Switchboard explorer. Node ${process.version}. Connecting...`);
sim.connect().catch(e => { out(`Could not connect (${e.message || e}). Is MSFS running? Retrying in 5 s.`); retry(); });
