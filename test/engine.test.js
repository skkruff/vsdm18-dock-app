// Profile engine against a fake sim and a recording display, using the real profiles.
const assert = require('assert');
const path = require('path');
const pluginDir = path.join(__dirname, '..', 'plugin', 'com.m18switchboard.msfs.sdPlugin');
const { ProfileEngine, formatValue } = require(path.join(pluginDir, 'plugin', 'engine'));
const { loadProfiles } = require(path.join(pluginDir, 'plugin', 'profiles'));
const { Renderer } = require(path.join(pluginDir, 'plugin', 'render'));

const { FakeSim } = require('./fake-sim');

const C172 = { title: 'C172SP G1000 Passengers', atcModel: 'ATCCOM.AC_MODEL C172.0.text',
  path: 'SimObjects\\Airplanes\\asobo_c172sp_g1000\\presets\\asobo\\c172sp_avionics_passengers\\config\\aircraft.CFG' };
const CARAVAN = { title: 'Black Square Caravan', atcModel: 'ATCCOM.AC_MODEL C208.0.text',
  path: 'SimObjects\\Airplanes\\bksq-aircraft-caravanprocargopod\\aircraft.CFG' };

const tick = () => new Promise(r => setTimeout(r, 5));
const text = uri => decodeURIComponent(uri);

(async () => {
  const { profiles, errors } = loadProfiles(path.join(pluginDir, 'profiles'));
  assert.deepStrictEqual(errors, [], 'shipped profiles validate');
  assert.deepStrictEqual(profiles.map(p => p.id), ['c172-g1000', 'generic'], 'fallback last');

  const sim = new FakeSim({
    ELECTRICAL_BATTERY_STBY_2: 1, ELECTRICAL_ALTERNATOR_1: 0, ELECTRICAL_BATTERY_1: 0,
    ELECTRICAL_LINE_BUS_1_TO_AVIONICS_BUS_1: 0, ELECTRICAL_LINE_BUS_2_TO_AVIONICS_BUS_2: 0,
    LIGHTING_BEACON_1: 0, LIGHTING_LANDING_1: 0, LIGHTING_TAXI_1: 0, LIGHTING_NAV_0: 0, LIGHTING_STROBE_0: 0,
    FUEL_PUMP_1: 0, ENGINE_MAGNETO_1: 3, DEICE_PITOT_1: 0, FUEL_SELECTOR_1: 1,
  });
  const images = new Map();
  const history = []; // every image drawn: [slot, decoded svg]
  const alerts = [];
  const display = {
    image: (s, u) => { images.set(s, u); history.push([s, decodeURIComponent(u)]); },
    title: () => {}, alert: s => alerts.push(s),
  };
  const engine = new ProfileEngine({ sim, display, profiles, renderer: new Renderer(null), announceMs: 1, announceAircraftMs: 1 });
  // Scenes span the panel: text is centred on the 864-wide canvas (5 keys + 4 gaps).
  const announced = name => history.some(([s, svg]) => s === 0 && svg.includes(`aria-label="${name}"`) && svg.includes('id="scene"'));
  const sceneCount = name => history.filter(([s, svg]) => s === 0 && svg.includes(`aria-label="${name}"`)).length;
  engine.start();

  // Not connected: status message in the centre, other keys dark.
  // Not connected: one message across the whole panel; each key holds its piece of it.
  assert.match(text(images.get(7)), /NOT CONNECTED/);
  assert.match(text(images.get(0)), /viewBox="0 0 144 144"/);
  assert.match(text(images.get(7)), /viewBox="360 180 144 144"/, 'centre key cut from the panel, gaps included');

  sim.emit('connected');
  assert.match(text(images.get(7)), /viewBox/);
  assert.ok(history.some(([, svg]) => svg.includes('aria-label="LOADING"')), 'connected, no aircraft yet: loading');
  const mark = history.length;
  sim.emit('aircraft', C172);
  await tick();
  assert.strictEqual(engine.profile.id, 'c172-g1000');
  assert.strictEqual(engine.page.name, 'Main');
  assert.ok(announced('C172') && announced('G1000'), 'aircraft announced across the panel');
  assert.ok(!history.slice(mark).some(([, svg]) => svg.includes('LOADING')), 'no loading flash: the aircraft scene covers the wait');
  assert.strictEqual(sceneCount('Main'), 0, 'main page not announced on aircraft load');
  await new Promise(r => setTimeout(r, 30));
  assert.doesNotMatch(text(images.get(2)), /id="scene"/, 'announcement over, keys back');

  // Keys show the sim's state.
  assert.match(text(images.get(2)), /BAT/);
  assert.match(text(images.get(2)), /#f0204c/, 'battery off: red bar');
  assert.match(text(images.get(0)), /OFF/, 'standby battery shows its position');
  assert.match(text(images.get(12)), /BOTH/, 'magneto readout');

  // Pressing sends a command but does not change the key; the sim's report does.
  const before = images.get(2);
  engine.keyDown(2);
  assert.deepStrictEqual(sim.sets.pop(), ['ELECTRICAL_BATTERY_1', 1]);
  assert.strictEqual(images.get(2), before, 'icon follows sim, not the press');
  sim.input('ELECTRICAL_BATTERY_1', 1);
  assert.match(text(images.get(2)), /#b8f01c/, 'battery on: green bar');
  engine.keyDown(2);
  assert.deepStrictEqual(sim.sets.pop(), ['ELECTRICAL_BATTERY_1', 0]);

  engine.keyDown(0);
  assert.deepStrictEqual(sim.sets.pop(), ['ELECTRICAL_BATTERY_STBY_2', 0], 'standby battery OFF -> ARM');

  // Magnetos: ▶ stops at BOTH, ◀ steps down, START holds and springs back.
  engine.keyDown(13);
  assert.strictEqual(sim.sets.length, 0, 'MAG ▶ does nothing at BOTH');
  engine.keyDown(11);
  assert.deepStrictEqual(sim.sets.pop(), ['ENGINE_MAGNETO_1', 2]);
  sim.input('ENGINE_MAGNETO_1', 0);
  engine.keyDown(11);
  assert.strictEqual(sim.sets.length, 0, 'MAG ◀ does nothing at OFF');
  assert.match(text(images.get(12)), /OFF/);
  sim.input('ENGINE_MAGNETO_1', 3);
  engine.keyDown(14);
  assert.deepStrictEqual(sim.sets.pop(), ['ENGINE_MAGNETO_1', 4]);
  await new Promise(r => setTimeout(r, 600));
  assert.ok(sim.sets.length >= 2, 'START re-sent while held');
  assert.ok(sim.sets.every(s => s[0] === 'ENGINE_MAGNETO_1' && s[1] === 4));
  sim.sets.length = 0;
  sim.input('ENGINE_MAGNETO_1', 4);
  assert.match(text(images.get(14)), /#b8f01c/, 'START lit while cranking');
  assert.match(text(images.get(12)), /START/);
  engine.keyUp(14);
  assert.deepStrictEqual(sim.sets.pop(), ['ENGINE_MAGNETO_1', 3]);
  await new Promise(r => setTimeout(r, 300));
  assert.strictEqual(sim.sets.length, 0, 'repeat stops on release');
  engine.keyUp(2);
  assert.strictEqual(sim.sets.length, 0, 'key up only acts on keys with a release');

  // Next page: only that page's sources are watched.
  engine.keyDown(17);
  await tick();
  assert.strictEqual(engine.page.name, 'Auxiliary');
  assert.ok(announced('Auxiliary'));
  assert.deepStrictEqual(sim.activeInputSubs(), ['FUEL_SELECTOR_1']);
  assert.ok(sim.varSubs.get('TRANSPONDER CODE:1').size === 1);
  sim.simvar('TRANSPONDER CODE:1', 7);
  assert.match(text(images.get(4)), /aria-label="0007"/);
  sim.simvar('COM ACTIVE FREQUENCY:1', 124.655);
  assert.match(text(images.get(0)), /aria-label="124\.655"/);
  sim.simvar('KOHLSMAN SETTING MB:1', 1013.25);
  assert.match(text(images.get(3)), /aria-label="1013"/);
  engine.keyDown(3);
  assert.deepStrictEqual(sim.sent.pop(), { event: 'BAROMETRIC', value: 0 }, 'QNH key is a readout and a button');
  assert.match(text(images.get(6)), /BOTH/, 'fuel selector');
  assert.doesNotMatch(text(images.get(14)), /<text/, 'unused key is dark');
  engine.keyDown(2);
  assert.deepStrictEqual(sim.sent.pop(), { event: 'COM_STBY_RADIO_SWAP', value: 0 });
  engine.keyDown(7);
  assert.deepStrictEqual(sim.sets.pop(), ['FUEL_SELECTOR_1', 2]);

  // Round buttons wrap around and return to main.
  engine.keyDown(17);
  await tick();
  assert.strictEqual(engine.page.name, 'Main', 'next wraps');
  assert.strictEqual(sim.varSubs.get('TRANSPONDER CODE:1').size, 0, 'old page unsubscribed');
  engine.keyDown(15);
  await tick();
  assert.strictEqual(engine.page.name, 'Auxiliary', 'prev wraps');
  engine.keyDown(16);
  await tick();
  assert.strictEqual(engine.page.name, 'Main');

  // A press during an announcement only dismisses it; its key up does nothing either.
  engine.announceMs = 10000;
  engine.keyDown(15);
  await tick();
  assert.ok(engine.scene, 'page announcement showing');
  const before2 = sim.sets.length + sim.sent.length;
  engine.keyDown(14);
  engine.keyUp(14);
  assert.strictEqual(engine.scene, null, 'dismissed');
  assert.strictEqual(sim.sets.length + sim.sent.length, before2, 'START not pressed, no release sent');
  engine.announceMs = 1;

  // Unknown aircraft: generic profile, announced as such.
  sim.emit('aircraft', CARAVAN);
  await tick();
  assert.strictEqual(engine.profile.id, 'generic');
  assert.ok(announced('NO PROFILE') && announced('GENERIC'));
  sim.simvar('LIGHT BEACON', true);
  assert.match(text(images.get(5)), /#b8f01c/);
  engine.keyDown(2);
  assert.deepStrictEqual(sim.sent.pop(), { event: 'AVIONICS_MASTER_SET', value: 1 }, 'set-style event from current state');

  // A profile input event the aircraft does not have: that key says N/A, the rest work.
  delete sim.inputValues.LIGHTING_STROBE_0;
  sim.inputs.clear();
  sim.emit('aircraft', C172);
  await tick();
  assert.match(text(images.get(9)), /N\/A/);
  assert.match(text(images.get(5)), /BCN/);

  // Variable exceptions mark readouts unavailable.
  engine.keyDown(17);
  await tick();
  sim.emit('exception', { name: 'NAME_UNRECOGNIZED', about: 'variable TRANSPONDER CODE:1 (number)' });
  assert.match(text(images.get(4)), /N\/A/);

  // Sim gone: back to the status message.
  sim.emit('disconnected');
  assert.match(text(images.get(7)), /NOT CONNECTED/);
  const sentBefore = sim.sent.length + sim.sets.length;
  engine.keyDown(2);
  engine.keyDown(17);
  assert.strictEqual(sim.sent.length + sim.sets.length, sentBefore, 'presses ignored while offline');
  assert.strictEqual(engine.profile, null);

  // Faces: per-value face wins, value layers can read their own source, time format.
  const { keySources } = require(path.join(pluginDir, 'plugin', 'engine'));
  const fk = {
    type: 'readout', read: { var: 'COM ACTIVE FREQUENCY:1', unit: 'MHz' }, decimals: 3,
    face: { layers: [{ kind: 'value', y: 40 }, { kind: 'value', y: 100, read: { var: 'NAV ACTIVE FREQUENCY:1', unit: 'MHz' }, decimals: 2 }] },
    valueFaces: { 1: { layers: [{ kind: 'text', text: 'ONE' }] } },
  };
  assert.deepStrictEqual(keySources(fk).map(s => s.var), ['COM ACTIVE FREQUENCY:1', 'NAV ACTIVE FREQUENCY:1']);
  const two = text(engine.keyImage(fk, 124.85, null, src => (src.var === 'NAV ACTIVE FREQUENCY:1' ? 110.5 : undefined)));
  assert.match(two, /aria-label="124\.850"/);
  assert.match(two, /aria-label="110\.50"/, 'second value from its own source');
  assert.match(text(engine.keyImage(fk, 1)), /aria-label="ONE"/, 'face for value 1');
  assert.strictEqual(formatValue({ format: 'time' }, 13 * 3600 + 7 * 60 + 30), '13:07');

  assert.strictEqual(formatValue({ decimals: 1 }, 1013.25), '1013.3');
  assert.strictEqual(formatValue({}, undefined), '---');
  console.log('engine: PASS');
})().catch(e => { console.error('engine: FAIL', e); process.exitCode = 1; });
