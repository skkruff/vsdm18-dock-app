// Plugin entry point: wires the dock layer, the sim layer and the profile engine together.
// Place the "Switchboard Slot" action on all 15 LCD keys and the 3 round buttons of one page.
const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('./log');

process.on('uncaughtException', e => log.error('uncaught', e && e.stack || String(e)));
process.on('unhandledRejection', e => log.error('unhandled rejection', e && e.stack || String(e)));

const { Dock } = require('./dock');
const { IconLibrary } = require('./icons');
const { Renderer, setStyle, DEFAULT_STYLE } = require('./render');
const { measure } = require('./theme');
const { ProfileEngine } = require('./engine');
const { KeySender } = require('./keys');
const { DockVars } = require('./dockvars');
const { ProfileStore } = require('./store');
const { createEditorServer } = require('./editor/server');

const pluginRoot = path.join(__dirname, '..');
const DEFAULTS = {
  iconDir: 'D:\\MFS2024\\Flight Sim Dock\\Button Icon PNGs',
  theme: 'RGB',
  announcePages: true,
  announceMs: 800,
  announceAircraftMs: 2500,
  animateScenes: true, // slide panel-wide text so letters behind the bezels show
  sceneFps: 10,
  reconnectSeconds: 5,
  // Profiles you edit live here, outside the plugin folder, so redeploying never touches them.
  profilesDir: path.join(os.homedir(), 'Documents', 'MSFS Switchboard', 'profiles'),
  editorPort: 8765,
};
const EDITOR_HOLD_MS = 1500; // hold the middle round button this long to open the editor

function loadConfig() {
  const file = path.join(pluginRoot, 'config.json');
  let config;
  try {
    config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    if (e.code !== 'ENOENT') log.warn('config.json unreadable, using defaults', e.message);
    config = { ...DEFAULTS };
  }
  // Overrides for tests and development.
  if (process.env.SWITCHBOARD_PROFILES_DIR) config.profilesDir = process.env.SWITCHBOARD_PROFILES_DIR;
  if (process.env.SWITCHBOARD_EDITOR_PORT) config.editorPort = Number(process.env.SWITCHBOARD_EDITOR_PORT);
  return config;
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

const store = new ProfileStore({ dir: config.profilesDir, bundledDir: path.join(pluginRoot, 'profiles'), log: (...a) => log.warn(...a) });
const seeded = store.seed(path.join(pluginRoot, 'library.json'));
if (seeded.length) log.info('profiles copied to your profile folder', { dir: config.profilesDir, files: seeded });
function loadAll() {
  const { profiles, errors } = store.load();
  errors.forEach(e => log.error('profile rejected', e));
  log.info('profiles', { dir: config.profilesDir, ids: profiles.map(p => p.id) });
  return profiles;
}
const profiles = loadAll();

// Look of drawn keys: defaults, then colours measured from the icons, then the user's settings.
// The bar's size and shape are fixed in render.js (user, 2026-10-28); only colours are measured.
const look = { measured: {} };
try {
  const { bar, ...colours } = measure(icons);
  look.measured = colours;
} catch (e) { log.warn('icon measurement failed', e.message); }
log.info('look measured from icons', look.measured);
function applyLook(settings) {
  setStyle({ ...DEFAULT_STYLE, ...look.measured, ...settings });
}
applyLook(store.readSettings());

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

// Keyboard shortcuts: the helper starts now so the first press is not delayed by its start-up.
const keyboard = new KeySender({ log: (...a) => log.info(...a) });
keyboard.start();

// Stopwatches and other values the dock keeps itself, saved so they survive a restart.
const dockVars = new DockVars({ load: () => store.readDockState(), save: s => store.writeDockState(s), log: (...a) => log.warn(...a) });

const engine = new ProfileEngine({
  sim, display, profiles, renderer: new Renderer(icons),
  announcePages: config.announcePages, announceMs: config.announceMs, announceAircraftMs: config.announceAircraftMs,
  animateScenes: config.animateScenes, sceneFps: config.sceneFps, keyboard, dockVars,
  log: (...a) => log.info(...a),
});

engine.setKeypadLayout(store.readKeypad().keys);

// Saving in the editor (or by hand) reloads profiles; the dock updates in place.
store.watch(() => engine.setProfiles(loadAll()));

const editorUrl = `http://localhost:${config.editorPort}/`;
createEditorServer({
  store, engine, sim, icons, config, look, keyboard,
  applyLook: s => { applyLook(s); engine.redrawAll(); },
  log: (...a) => log.warn(...a),
})
  .listen(config.editorPort)
  .then(port => log.info('editor', { url: `http://localhost:${port}/` }))
  .catch(e => log.error('editor not started', e.message));

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
let middleDownAt = 0;
dock.on('keyDown', msg => {
  if (!slots.has(msg.context)) return;
  const slot = slots.get(msg.context);
  if (slot === 16) middleDownAt = Date.now();
  engine.keyDown(slot);
});
dock.on('keyUp', msg => {
  if (!slots.has(msg.context)) return;
  const slot = slots.get(msg.context);
  // Holding the middle round button opens the editor in the default browser.
  if (slot === 16 && Date.now() - middleDownAt >= EDITOR_HOLD_MS) dock.send('openUrl', undefined, { url: editorUrl });
  engine.keyUp(slot);
});

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
