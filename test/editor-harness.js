// Runs the editor against a fake sim with the C172 loaded, for development and the editor test.
//   node test/editor-harness.js [iconDir] [port]
// Profiles go to a temporary folder seeded from the shipped ones. The taxi light flips every
// 4 s, so "Learn" and live previews have something to show.
const fs = require('fs');
const os = require('os');
const path = require('path');
const pluginDir = path.join(__dirname, '..', 'plugin', 'com.m18switchboard.msfs.sdPlugin', 'plugin');
const { ProfileEngine } = require(path.join(pluginDir, 'engine'));
const { ProfileStore } = require(path.join(pluginDir, 'store'));
const { Renderer, setStyle, DEFAULT_STYLE } = require(path.join(pluginDir, 'render'));
const { measure } = require(path.join(pluginDir, 'theme'));
const { IconLibrary } = require(path.join(pluginDir, 'icons'));
const { createEditorServer } = require(path.join(pluginDir, 'editor', 'server'));
const { FakeSim } = require('./fake-sim');

async function startHarness({ iconDir = '', port = 0, profilesDir } = {}) {
  const dir = profilesDir || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-editor-')), 'profiles');
  const store = new ProfileStore({ dir, bundledDir: path.join(pluginDir, '..', 'profiles') });
  store.seed(path.join(pluginDir, '..', 'library.json'));
  const icons = new IconLibrary(iconDir, 'RGB');
  icons.scan();
  const sim = new FakeSim({
    ELECTRICAL_BATTERY_STBY_2: 1, ELECTRICAL_ALTERNATOR_1: 1, ELECTRICAL_BATTERY_1: 1,
    ELECTRICAL_LINE_BUS_1_TO_AVIONICS_BUS_1: 1, ELECTRICAL_LINE_BUS_2_TO_AVIONICS_BUS_2: 0,
    LIGHTING_BEACON_1: 1, LIGHTING_LANDING_1: 0, LIGHTING_TAXI_1: 0, LIGHTING_NAV_0: 1, LIGHTING_STROBE_0: 0,
    FUEL_PUMP_1: 0, ENGINE_MAGNETO_1: 3, ENGINE_MAGNETO_2: 3, DEICE_PITOT_1: 0, FUEL_SELECTOR_1: 1,
  });
  sim.aircraft = { title: 'C172SP G1000 Passengers', atcModel: 'ATCCOM.AC_MODEL C172.0.text',
    path: 'd:\\mfs2024\\official2024\\onestore\\asobo-aircraft-c172sp-as1000\\simobjects\\airplanes\\asobo_c172sp_g1000\\presets\\asobo\\c172sp_avionics_passengers\\config\\aircraft.cfg' };
  const display = { image() {}, title() {}, alert() {} };
  const engine = new ProfileEngine({ sim, display, profiles: store.load().profiles, renderer: new Renderer(icons), announceMs: 1, announceAircraftMs: 1 });
  engine.start();
  sim.emit('connected');
  sim.emit('aircraft', sim.aircraft);
  store.watch(() => engine.setProfiles(store.load().profiles), 100);
  const timer = setInterval(() => sim.input('LIGHTING_TAXI_1', sim.inputValues.LIGHTING_TAXI_1 ? 0 : 1), 4000);
  sim.readOnly = ['TRANSPONDER CODE:1'];
  sim.simvars = { 'TRANSPONDER STATE:1': 3, 'TRANSPONDER CODE:1': 1200, 'NAV ACTIVE FREQUENCY:1': 110.5, 'COM ACTIVE FREQUENCY:1': 124.85, 'KOHLSMAN SETTING MB:1': 1013.2 };
  const { bar, ...colours } = measure(icons);
  const look = { measured: colours };
  const applyLook = s => { setStyle({ ...DEFAULT_STYLE, ...look.measured, ...s }); engine.redrawAll(); };
  applyLook(store.readSettings());
  const server = createEditorServer({ store, engine, sim, icons, config: { theme: 'RGB', iconDir }, look, applyLook });
  const actualPort = await server.listen(port);
  return { port: actualPort, dir, sim, engine, store, close: () => { clearInterval(timer); server.close(); if (store.watcher) store.watcher.close(); } };
}

if (require.main === module) {
  startHarness({ iconDir: process.argv[2] || '', port: Number(process.argv[3] || 8765) })
    .then(h => console.log(`editor on http://localhost:${h.port}/ (profiles in ${h.dir})`));
}

module.exports = { startHarness };
