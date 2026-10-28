// Plugin entry point: wires the dock layer, the sim layer and the profile engine together.
// Place the "Switchboard Slot" action on all 15 LCD keys and the 3 round buttons of one page.
const fs = require('fs');
const path = require('path');
const log = require('./log');

process.on('uncaughtException', e => log.error('uncaught', e && e.stack || String(e)));
process.on('unhandledRejection', e => log.error('unhandled rejection', e && e.stack || String(e)));

const { Dock } = require('./dock');
const { IconLibrary } = require('./icons');
const { Renderer } = require('./render');
const { loadProfiles } = require('./profiles');
const { ProfileEngine } = require('./engine');

const pluginRoot = path.join(__dirname, '..');
const DEFAULTS = {
  iconDir: 'D:\\MFS2024\\Flight Sim Dock\\Button Icon PNGs',
  theme: 'RGB',
  announcePages: true,
  reconnectSeconds: 5,
};

function loadConfig() {
  const file = path.join(pluginRoot, 'config.json');
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    if (e.code !== 'ENOENT') log.warn('config.json unreadable, using defaults', e.message);
    return { ...DEFAULTS };
  }
}

// LCD keys report rows bottom-up (row 0 = bottom); round buttons report as column 5.
// See docs/hardware.md.
function slotFor({ row, column }) {
  return column === 5 ? 15 + row : (2 - row) * 5 + column;
}

const config = loadConfig();
log.info('starting', { node: process.version, config });

const dock = new Dock();
const icons = new IconLibrary(config.iconDir, config.theme);
log.info('icon library', { dir: config.iconDir, files: icons.scan() });

const { profiles, errors } = loadProfiles(path.join(pluginRoot, 'profiles'));
errors.forEach(e => log.error('profile rejected', e));
log.info('profiles', profiles.map(p => p.id));

// Loaded only after logging is set up, so a failure to load the SimConnect library is logged.
const { SimConnectBackend } = require('./sim/simconnect');
const sim = new SimConnectBackend();

const contexts = new Map(); // slot -> dock context
const slots = new Map(); // dock context -> slot
const shown = new Map(); // slot -> last image sent, to skip identical redraws
const display = {
  image(slot, uri) {
    const ctx = contexts.get(slot);
    if (!ctx || shown.get(slot) === uri) return;
    shown.set(slot, uri);
    dock.setImage(ctx, uri);
  },
  title(slot, text) {
    const ctx = contexts.get(slot);
    if (ctx) dock.setTitle(ctx, text);
  },
  alert(slot) {
    const ctx = contexts.get(slot);
    if (ctx) dock.showAlert(ctx);
  },
};

const engine = new ProfileEngine({
  sim, display, profiles, renderer: new Renderer(icons), announcePages: config.announcePages,
  log: (...a) => log.info(...a),
});

dock.on('willAppear', msg => {
  const slot = slotFor(msg.payload.coordinates);
  contexts.set(slot, msg.context);
  slots.set(msg.context, slot);
  shown.delete(slot);
  dock.setTitle(msg.context, '');
  engine.redraw(slot);
});
dock.on('willDisappear', msg => {
  const slot = slots.get(msg.context);
  slots.delete(msg.context);
  if (contexts.get(slot) === msg.context) { contexts.delete(slot); shown.delete(slot); }
});
dock.on('keyDown', msg => { if (slots.has(msg.context)) engine.keyDown(slots.get(msg.context)); });
dock.on('keyUp', msg => { if (slots.has(msg.context)) engine.keyUp(slots.get(msg.context)); });

sim.on('connected', info => log.info('sim connected', info));
sim.on('disconnected', () => { log.info('sim disconnected'); scheduleConnect(); });

let connectTimer = null;
function scheduleConnect() {
  if (connectTimer) return;
  connectTimer = setTimeout(connect, config.reconnectSeconds * 1000);
}
async function connect() {
  connectTimer = null;
  try {
    await sim.connect();
  } catch (e) {
    scheduleConnect(); // sim not running yet; quiet retry
  }
}

engine.start();
dock.connect();
connect();
