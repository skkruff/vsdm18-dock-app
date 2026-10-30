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
  // Each key carries only its own row of a panel-wide text, so look across all keys.
  const announced = name => history.some(([, svg]) => svg.includes(`aria-label="${name}"`) && svg.includes('id="scene"'));
  const sceneCount = name => history.filter(([, svg]) => svg.includes(`aria-label="${name}"`) && svg.includes('id="scene"')).length;
  engine.start();

  // Not connected: status message in the centre, other keys dark.
  // Not connected: one message across the whole panel; each key holds its piece of it.
  assert.match(text(images.get(12)), /NOT CONNECTED/, 'bottom row carries the second line');
  assert.match(text(images.get(2)), /MSFS/, 'top row the first');
  assert.doesNotMatch(text(images.get(7)), /aria-label/, 'middle row has no text (logo only)');
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
  assert.match(text(images.get(12)), /NOT CONNECTED/);
  const sentBefore = sim.sent.length + sim.sets.length;
  engine.keyDown(2);
  engine.keyDown(17);
  assert.strictEqual(sim.sent.length + sim.sets.length, sentBefore, 'presses ignored while offline');
  assert.strictEqual(engine.profile, null);
  // The status message sways back and forth for as long as it is up.
  const offlineFrames = () => history.filter(([s]) => s === 12).length;
  const framesBefore = offlineFrames();
  await new Promise(r => setTimeout(r, 350));
  assert.ok(offlineFrames() - framesBefore >= 3, 'NOT CONNECTED keeps moving');

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
  // Decorative keys: label and sublabel, or a face; no source, no press.
  {
    const { validate } = require(path.join(pluginDir, 'plugin', 'profiles'));
    const d = { type: 'decor', label: 'LIGHTS', sublabel: 'INTERIOR' };
    validate({ id: 'x', match: {}, pages: [{ keys: { 0: d } }] }, 'x');
    assert.deepStrictEqual(keySources(d), []);
    assert.match(text(engine.keyImage(d)), /aria-label="LIGHTS".*aria-label="INTERIOR"/s);
    assert.match(text(engine.keyImage({ ...d, face: { layers: [{ kind: 'text', text: 'ART' }, { kind: 'sublabel' }] } })), /aria-label="ART".*aria-label="INTERIOR"/s);
    assert.throws(() => validate({ id: 'x', match: {}, pages: [{ keys: { 0: { ...d, press: { event: 'X' } } } }] }, 'x'), /decorative/);
  }

  // A bar layer can show a fixed look instead of the key's state (user, 2026-10-30): a readout
  // with a face per TRANSPONDER STATE value, each with its own bar.
  {
    const xk = { type: 'readout', label: 'XPDR', read: { var: 'TRANSPONDER STATE:1', unit: 'number' }, valueFaces: {
      1: { layers: [{ kind: 'bar', look: 'armed' }] }, 3: { layers: [{ kind: 'bar', look: 'off' }] },
      4: { layers: [{ kind: 'bar', look: 'on' }] }, 0: { layers: [{ kind: 'bar', look: 'clear' }] } } };
    assert.match(text(engine.keyImage(xk, 1)), /fill="#ffffff"/, 'white');
    assert.match(text(engine.keyImage(xk, 3)), /fill="#f0204c"/, 'red');
    assert.match(text(engine.keyImage(xk, 4)), /fill="#b8f01c"/, 'green');
    assert.match(text(engine.keyImage(xk, 0)), /fill="none"/, 'clear');
    assert.match(text(engine.keyImage({ type: 'switch', read: { input: 'X' }, states: { 1: 'on' }, face: { layers: [{ kind: 'bar' }] } }, 1)), /fill="#b8f01c"/, 'no look: follows the state');
  }

  // Switch (armable): active, else armed, else otherwise; both sources watched.
  {
    const ak = {
      type: 'armable', label: 'APR', read: { var: 'AUTOPILOT APPROACH ACTIVE', unit: 'bool' },
      armed: { var: 'AUTOPILOT APPROACH ARM', unit: 'bool' }, sublabels: { active: 'LOC', armed: 'ARM' },
    };
    assert.deepStrictEqual(keySources(ak).map(s => s.var), ['AUTOPILOT APPROACH ACTIVE', 'AUTOPILOT APPROACH ARM']);
    const img = (active, armed) => text(engine.keyImage(ak, active, null, () => armed));
    assert.match(img(1, 1), /fill="#b8f01c"/, 'active wins over armed');
    assert.match(img(1, 1), /aria-label="LOC"/);
    assert.match(img(0, 1), /fill="#ffffff"/, 'armed: white bar');
    assert.match(img(0, 1), /aria-label="ARM"/);
    assert.match(img(0, 0), /fill="none"/, 'otherwise: outline');
    assert.match(img(undefined, 1), /fill="none"/, 'unknown: outline');
    assert.match(text(engine.keyImage({ ...ak, otherwise: 'off' }, 0, null, () => 0)), /fill="#f0204c"/, 'otherwise can be off');
    assert.match(text(engine.keyImage({ ...ak, activeIs: 2 }, 2, null, () => 0)), /fill="#b8f01c"/, 'activeIs');
    assert.match(text(engine.keyImage(ak, 'armed')), /fill="#ffffff"/, 'editor preview by step name');
    const faced = { ...ak, valueFaces: { armed: { layers: [{ kind: 'text', text: 'ARMED FACE' }] } } };
    assert.match(text(engine.keyImage(faced, 0, null, () => 1)), /aria-label="ARMED FACE"/, 'face per step');
    const { tiles } = require(path.join(pluginDir, 'plugin', 'render'));
    const armedIcon = text(tiles.armedIcon('data:image/png;base64,AAAA'));
    assert.match(armedIcon, /<image href="data:image\/png;base64,AAAA"/, 'PNG icon: its clear version');
    assert.match(armedIcon, /fill="#ffffff"/, 'with the bar filled white');
    const { validate } = require(path.join(pluginDir, 'plugin', 'profiles'));
    assert.throws(() => validate({ id: 'x', match: {}, pages: [{ keys: { 0: { type: 'armable', read: ak.read } } }] }, 'x'), /armed source/);
    validate({ id: 'x', match: {}, pages: [{ keys: { 0: ak } }] }, 'x');

    // A custom face shows the sublabel for the current step through a Sublabel layer.
    const facedSub = { ...ak, face: { layers: [{ kind: 'text', text: 'APR' }, { kind: 'sublabel' }, { kind: 'bar' }] } };
    assert.match(text(engine.keyImage(facedSub, 0, null, () => 1)), /aria-label="ARM"/, 'face sublabel when armed');
    assert.match(text(engine.keyImage(facedSub, 1, null, () => 0)), /aria-label="LOC"/, 'face sublabel when active');
    assert.doesNotMatch(text(engine.keyImage(facedSub, 0, null, () => 0)), /aria-label="(ARM|LOC)"/, 'none otherwise');
    const swFace = { type: 'switch', read: { input: 'X' }, states: { 0: 'off', 1: 'on' }, sublabels: { 0: 'OFF', 1: 'ARM' }, face: { layers: [{ kind: 'sublabel' }] } };
    assert.match(text(engine.keyImage(swFace, 1)), /aria-label="ARM"/, 'face sublabel per value on a switch');
    // A Sublabel layer with its own source: text per that source's value, else its fallback.
    const own = { type: 'readout', read: { var: 'A', unit: 'number' }, face: { layers: [
      { kind: 'sublabel', read: { var: 'GPS DRIVES NAV1', unit: 'number' }, sublabels: { 1: 'GPS' }, sublabel: 'VLOC' }] } };
    assert.deepStrictEqual(keySources(own).map(s => s.var), ['A', 'GPS DRIVES NAV1'], 'its source is watched');
    assert.match(text(engine.keyImage(own, 5, null, s => (s.var === 'GPS DRIVES NAV1' ? 1 : undefined))), /aria-label="GPS"/);
    assert.match(text(engine.keyImage(own, 5, null, s => (s.var === 'GPS DRIVES NAV1' ? 0 : undefined))), /aria-label="VLOC"/, 'other values');

    // "or": ILS capture or GPS approach active; APR selected as armed.
    const both = {
      type: 'armable', label: 'APR', read: { var: 'AUTOPILOT APPROACH CAPTURED', unit: 'bool' },
      activeOr: [{ read: { var: 'AUTOPILOT APPROACH ACTIVE', unit: 'bool' } }],
      armed: { var: 'AUTOPILOT APPROACH HOLD', unit: 'bool' },
    };
    assert.deepStrictEqual(keySources(both).map(s => s.var), ['AUTOPILOT APPROACH CAPTURED', 'AUTOPILOT APPROACH HOLD', 'AUTOPILOT APPROACH ACTIVE']);
    const at = vals => text(engine.keyImage(both, vals.captured, null, src => vals[{ 'AUTOPILOT APPROACH ACTIVE': 'gps', 'AUTOPILOT APPROACH HOLD': 'hold' }[src.var]]));
    assert.match(at({ captured: 1, gps: 0, hold: 1 }), /fill="#b8f01c"/, 'ILS captured: active');
    assert.match(at({ captured: 0, gps: 1, hold: 1 }), /fill="#b8f01c"/, 'GPS approach active: active');
    assert.match(at({ captured: 0, gps: 0, hold: 1 }), /fill="#ffffff"/, 'selected only: armed');
    assert.match(at({ captured: 0, gps: 0, hold: 0 }), /fill="none"/, 'off');
    assert.match(at({ captured: undefined, gps: 1, hold: 1 }), /fill="#b8f01c"/, 'an "or" source alone is enough');
    const armedOr = { ...ak, armedOr: [{ read: { var: 'B', unit: 'bool' }, is: 2 }] };
    assert.match(text(engine.keyImage(armedOr, 0, null, s => (s.var === 'B' ? 2 : 0))), /fill="#ffffff"/, 'armed "or" with its own value');
    assert.throws(() => validate({ id: 'x', match: {}, pages: [{ keys: { 0: { ...both, activeOr: [{ read: { var: '' } }] } } }] }, 'x'), /"or" source/);
  }

  // Page names slide sideways while shown; keys without text are not resent each frame.
  {
    const sim2 = new FakeSim({ ...sim.inputValues, LIGHTING_STROBE_0: 0 });
    const frames = new Map(); // slot -> distinct images
    const disp = { image: (s, u) => { if (!frames.has(s)) frames.set(s, new Set()); frames.get(s).add(u); }, title() {}, alert() {} };
    const e2 = new ProfileEngine({ sim: sim2, display: disp, profiles, renderer: new Renderer(null), announceMs: 400, announceAircraftMs: 1, sceneFps: 20 });
    e2.start();
    sim2.emit('connected');
    sim2.emit('aircraft', C172);
    await new Promise(r => setTimeout(r, 50));
    frames.clear();
    e2.keyDown(17);
    await new Promise(r => setTimeout(r, 450));
    const sceneFrames = s => [...(frames.get(s) || [])].filter(u => u.includes('id%3D%22scene%22')).length;
    assert.ok(sceneFrames(7) >= 4, `middle row slides (${sceneFrames(7)} frames)`);
    assert.strictEqual(sceneFrames(2), 1, 'top row has no text: drawn once');
  }

  assert.strictEqual(formatValue({ decimals: 1 }, 1013.25), '1013.3');
  assert.strictEqual(formatValue({}, undefined), '---');
  // Presses that write a simvar (press.var): cycle from its current value, step, hold.
  {
    const sim3 = new FakeSim({});
    const xpdr = { var: 'TRANSPONDER STATE:1', unit: 'number' };
    const prof = { id: 't', fallback: true, pages: [{ name: 'P', keys: {
      0: { type: 'switch', label: 'XPDR', read: xpdr, states: { 4: 'on' }, press: { cycle: [3, 4], var: xpdr } },
      1: { type: 'button', label: 'UP', press: { step: 1, max: 5, var: { var: 'OTHER', unit: 'number' } } },
      2: { type: 'button', label: 'HOLD', press: { hold: 1, release: 0, var: { var: 'HELD', unit: 'number' } } },
    } }] };
    const imgs = new Map();
    const e3 = new ProfileEngine({ sim: sim3, display: { image: (s, u) => imgs.set(s, u), title() {}, alert() {} }, profiles: [prof], renderer: new Renderer(null), announceMs: 1, announceAircraftMs: 1 });
    e3.start();
    sim3.emit('connected');
    sim3.emit('aircraft', { title: 'X', atcModel: '', path: 'x' });
    await tick(); await tick();
    sim3.simvar('TRANSPONDER STATE:1', 3);
    sim3.simvar('OTHER', 2);
    e3.keyDown(0); e3.keyUp(0);
    assert.deepStrictEqual(sim3.varSets.pop(), ['TRANSPONDER STATE:1', 4], 'cycle 3 -> 4 written to the simvar');
    assert.match(text(imgs.get(0)), /#b8f01c/, 'key follows the simvar the sim now reports');
    e3.keyDown(0);
    assert.deepStrictEqual(sim3.varSets.pop(), ['TRANSPONDER STATE:1', 3], 'and back');
    e3.keyDown(1);
    assert.deepStrictEqual(sim3.varSets.pop(), ['OTHER', 3], 'step from the written simvar\'s own value');
    e3.keyDown(2); e3.keyUp(2);
    assert.deepStrictEqual(sim3.varSets.slice(-2), [['HELD', 1], ['HELD', 0]], 'hold and release');
    assert.strictEqual(sim3.sets.length, 0, 'no input events touched');
  }

  // Dimmers (user, 2026-10-30): cycle from a value not in the list, step with wrap, tap vs hold-to-ramp.
  {
    const sim4 = new FakeSim({ DIM: 37, DIM2: 100, DIM3: 50 });
    const prof = { id: 'd', fallback: true, pages: [{ name: 'P', keys: {
      0: { type: 'readout', read: { input: 'DIM' }, press: { cycle: [0, 25, 50, 75, 100] } },
      1: { type: 'readout', read: { input: 'DIM2' }, press: { step: 25, min: 0, max: 100, wrap: true } },
      2: { type: 'readout', read: { input: 'DIM3' }, press: { step: 25, min: 0, max: 100, wrap: true, rampMs: 15, rampStep: 10, rampDelayMs: 40 } },
    } }] };
    const e4 = new ProfileEngine({ sim: sim4, display: { image() {}, title() {}, alert() {} }, profiles: [prof], renderer: new Renderer(null), announceMs: 1, announceAircraftMs: 1 });
    e4.start();
    sim4.emit('connected');
    sim4.emit('aircraft', { title: 'X', atcModel: '', path: 'x' });
    await new Promise(r => setTimeout(r, 30));
    for (const n of ['DIM', 'DIM2', 'DIM3']) sim4.input(n, sim4.inputValues[n]);
    e4.keyDown(0); e4.keyUp(0);
    assert.deepStrictEqual(sim4.sets.pop(), ['DIM', 50], 'cycle from 37 goes up to 50, not back to 0');
    sim4.input('DIM', 100);
    e4.keyDown(0); e4.keyUp(0);
    assert.deepStrictEqual(sim4.sets.pop(), ['DIM', 0], 'listed values still go round');
    e4.keyDown(1); e4.keyUp(1);
    assert.deepStrictEqual(sim4.sets.pop(), ['DIM2', 0], 'step at max wraps to min');
    // A tap on a ramp key: one step, on release.
    e4.keyDown(2);
    assert.strictEqual(sim4.sets.length, 0, 'nothing on key down');
    e4.keyUp(2);
    assert.deepStrictEqual(sim4.sets.pop(), ['DIM3', 75], 'tap steps once');
    // A hold: ramps by rampStep from the current value, turns back at max (wrap), stops on release.
    sim4.input('DIM3', 80);
    e4.keyDown(2);
    await new Promise(r => setTimeout(r, 140));
    e4.keyUp(2);
    const ramp = sim4.sets.filter(s => s[0] === 'DIM3').map(s => s[1]);
    assert.deepStrictEqual(ramp.slice(0, 4), [90, 100, 90, 80], `ramps up, turns back at max (${ramp})`);
    const count = sim4.sets.length;
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(sim4.sets.length, count, 'stops when released');
  }

  // Keyboard shortcuts: a tap, or held for as long as the dock key; released on page change.
  {
    const sim5 = new FakeSim({});
    const typed = [];
    const keyboard = { tap: (k, o) => typed.push(['tap', k, o.focus]), down: (k, o) => typed.push(['down', k, o.focus]), up: k => typed.push(['up', k]) };
    const prof = { id: 'k', fallback: true, pages: [{ name: 'P', keys: {
      0: { type: 'button', label: 'TORCH', press: { keys: 'Alt+L' } },
      1: { type: 'button', label: 'PTT', press: { keys: 'Ctrl+T', whileHeld: true, focus: false } },
    } }, { name: 'Q', keys: {} }] };
    const e5 = new ProfileEngine({ sim: sim5, display: { image() {}, title() {}, alert() {} }, profiles: [prof], renderer: new Renderer(null), keyboard, announceMs: 1, announceAircraftMs: 1 });
    e5.start();
    sim5.emit('connected');
    sim5.emit('aircraft', { title: 'X', atcModel: '', path: 'x' });
    await new Promise(r => setTimeout(r, 30));
    e5.keyDown(0); e5.keyUp(0);
    assert.deepStrictEqual(typed, [['tap', 'Alt+L', true]], 'tap, MSFS brought to the front');
    e5.keyDown(1);
    assert.deepStrictEqual(typed.pop(), ['down', 'Ctrl+T', false]);
    e5.keyUp(1);
    assert.deepStrictEqual(typed.pop(), ['up', 'Ctrl+T'], 'released with the key');
    e5.keyDown(1);
    await e5.setPage(1);
    assert.deepStrictEqual(typed.pop(), ['up', 'Ctrl+T'], 'never left held on a page change');
    const { validate } = require(path.join(pluginDir, 'plugin', 'profiles'));
    assert.throws(() => validate({ id: 'x', match: {}, pages: [{ keys: { 0: { type: 'button', press: { keys: 'Ctrl+Nope' } } } }] }, 'x'), /unknown key "Nope"/);
  }

  // Dock variables (user, 2026-10-30): a stopwatch on sim time, kept across restarts; keypads.
  {
    const { DockVars } = require(path.join(pluginDir, 'plugin', 'dockvars'));
    const sim6 = new FakeSim({});
    sim6.simvars = { 'TRANSPONDER CODE:1': 1200 };
    let saved = null;
    const dv = new DockVars({ save: s => { saved = JSON.parse(JSON.stringify(s)); }, saveEveryMs: 0 });
    const imgs = new Map();
    const prof = { id: 'dv', fallback: true, pages: [{ name: 'P', keys: {
      0: { type: 'readout', label: 'TIMER', read: { timer: 'T1' }, format: 'duration' },
      1: { type: 'button', label: 'START', press: { timer: 'T1' } },
      2: { type: 'button', label: 'RESET', press: { timer: 'T1', action: 'reset' } },
      3: { type: 'switch', label: 'RUN', read: { timer: 'T1', part: 'running' }, states: { 1: 'on' } },
      4: { type: 'readout', label: 'XPDR', read: { var: 'TRANSPONDER CODE:1', unit: 'number' }, pad: 4, press: { keypad: 'xpdr' } },
      5: { type: 'button', label: 'COM1', press: { keypad: { preset: 'com1' } } },
    } }] };
    const e6 = new ProfileEngine({ sim: sim6, display: { image: (s, u) => imgs.set(s, u), title() {}, alert() {} }, profiles: [prof], renderer: new Renderer(null), dockVars: dv, announceMs: 1, announceAircraftMs: 1 });
    e6.start();
    sim6.emit('connected');
    sim6.emit('aircraft', { title: 'X', atcModel: '', path: 'x' });
    await new Promise(r => setTimeout(r, 30));
    sim6.simvar('TRANSPONDER CODE:1', 1200);
    const simTime = s => sim6.simvar('SIMULATION TIME', s);
    simTime(100);
    assert.match(text(imgs.get(0)), /aria-label="0:00"/);
    e6.keyDown(1); e6.keyUp(1);
    assert.match(text(imgs.get(3)), /#b8f01c/, 'running shows on a switch');
    simTime(101.5); simTime(140); simTime(165);
    assert.match(text(imgs.get(0)), /aria-label="1:05"/, 'counts sim time');
    simTime(165); // paused: sim time stands still
    simTime(9000); // a jump (new flight, time change) is not counted
    simTime(9010);
    assert.match(text(imgs.get(0)), /aria-label="1:15"/);
    assert.deepStrictEqual(saved, { timers: { T1: { running: true, elapsed: 75 } } }, 'saved');
    // A restart: a new DockVars from the saved state carries on.
    const dv2 = new DockVars({ load: () => saved });
    assert.strictEqual(dv2.value({ timer: 'T1' }), 75);
    assert.strictEqual(dv2.value({ timer: 'T1', part: 'running' }), 1);
    dv2.simTime(5); dv2.simTime(3605);
    assert.strictEqual(dv2.value({ timer: 'T1' }), 75, 'a 3600 s step is a jump, not counted');
    dv2.simTime(3610);
    assert.strictEqual(formatValue({ format: 'duration' }, dv2.value({ timer: 'T1' }) + 3600), '1:01:20', 'H:MM:SS from an hour');
    e6.keyDown(1); e6.keyUp(1);
    simTime(9020);
    assert.match(text(imgs.get(0)), /aria-label="1:15"/, 'stopped');
    e6.keyDown(2); e6.keyUp(2);
    assert.match(text(imgs.get(0)), /aria-label="0:00"/, 'reset');

    // Keypad: XPDR, octal, sent as soon as 4 digits are in (BCD), then the page is back.
    e6.keyDown(4); e6.keyUp(4);
    assert.match(text(imgs.get(1)), /aria-label="XPDR".*aria-label="1200"/s, 'title with the value now');
    assert.doesNotMatch(text(imgs.get(1)), /now 1200/, 'just the value (user, 2026-10-30)');
    assert.match(text(imgs.get(13)), /aria-label="VFR"/, 'the 9 is VFR on a transponder');
    assert.match(text(imgs.get(2)), /aria-label="____"/);
    const digit = d => { const s = { 1: 5, 2: 6, 3: 7, 4: 8, 5: 9, 6: 10, 7: 11, 8: 12, 9: 13, 0: 14 }[d]; e6.keyDown(s); e6.keyUp(s); };
    digit(7); digit(8); digit(7);
    assert.match(text(imgs.get(2)), /aria-label="77__"/, '8 is not an octal digit');
    assert.match(text(imgs.get(12)), /#3a3f47/, '8 dimmed');
    digit(0); digit(0);
    assert.deepStrictEqual(sim6.sent.pop(), { event: 'XPNDR_SET', value: 0x7700 }, 'BCD');
    // VFR: sets the VFR code (1200) at once, whatever was typed.
    e6.keyDown(4); e6.keyUp(4);
    digit(4);
    e6.keyDown(13); e6.keyUp(13);
    assert.deepStrictEqual(sim6.sent.pop(), { event: 'XPNDR_SET', value: 0x1200 }, 'VFR');
    assert.match(text(imgs.get(4)), /aria-label="XPDR"/, 'page back after VFR');
    assert.match(text(imgs.get(4)), /aria-label="XPDR"/, 'page back');
    // COM: typed partly, ENT fills the rest with zeros; DEL removes the last digit.
    e6.keyDown(5); e6.keyUp(5);
    assert.match(text(imgs.get(13)), /aria-label="9"/, 'a 9 on COM');
    digit(1); digit(2); digit(4); digit(9);
    e6.keyDown(3); e6.keyUp(3); // DEL
    digit(8);
    assert.match(text(imgs.get(2)), /aria-label="124\.8__"/);
    e6.keyDown(4); e6.keyUp(4); // ENT
    assert.deepStrictEqual(sim6.sent.pop(), { event: 'COM_STBY_RADIO_SET_HZ', value: 124800000 });
    // CANCEL and the round buttons close without sending.
    const sentBefore = sim6.sent.length;
    e6.keyDown(5); digit(1); e6.keyDown(0); e6.keyUp(0);
    e6.keyDown(5); e6.keyUp(5); e6.keyDown(16); e6.keyUp(16);
    assert.strictEqual(sim6.sent.length, sentBefore, 'nothing sent');
    assert.match(text(imgs.get(5)), /aria-label="COM1"/, 'page back');
    assert.strictEqual(e6.keypadImages('xpdr').length, 15);
    // A layout of your own (user, 2026-10-30): one for every keypad. Phone-style digits, CLR,
    // a label on ENT, a face on CANCEL; keys without a role do nothing.
    const kpm = require(path.join(pluginDir, 'plugin', 'keypad'));
    const layout = {
      0: { type: 'keypad', role: 'typed' }, 1: { type: 'keypad', role: 'title' }, 2: { type: 'keypad', role: 'clr' },
      3: { type: 'keypad', role: 'cancel', face: { layers: [{ kind: 'value', size: 30 }] } }, 4: { type: 'keypad', role: 'ent', label: 'SET' },
      5: { type: 'keypad', role: 'digit', digit: '1' }, 6: { type: 'keypad', role: 'digit', digit: '2' }, 7: { type: 'keypad', role: 'digit', digit: '3' },
      8: { type: 'keypad', role: 'digit', digit: '0' }, 9: { type: 'decor', label: 'ART' },
      10: { type: 'keypad', role: 'digit', digit: '4' }, 11: { type: 'keypad', role: 'digit', digit: '5' }, 12: { type: 'keypad', role: 'digit', digit: '6' },
      13: { type: 'keypad', role: 'digit', digit: '7' }, 14: { type: 'keypad', role: 'digit', digit: '8' },
    };
    assert.deepStrictEqual(kpm.layoutProblems(layout), ['no key for digit 9']);
    e6.setKeypadLayout(layout);
    e6.keyDown(4); e6.keyUp(4); // the XPDR key opens it
    assert.match(text(imgs.get(4)), /aria-label="SET"/, 'ENT with its own label');
    assert.match(text(imgs.get(4)), /#3a3f47/, 'dimmed until a digit is typed');
    assert.match(text(imgs.get(3)), /aria-label="CANCEL"/, 'a face shows the role\'s text');
    assert.match(text(imgs.get(9)), /aria-label="ART"/, 'decorative key');
    const press = s => { e6.keyDown(s); e6.keyUp(s); };
    press(5); press(8); press(9);
    assert.match(text(imgs.get(0)), /aria-label="10__"/, 'digits from the layout; the decorative key does nothing');
    press(2); // CLR
    assert.match(text(imgs.get(0)), /aria-label="____"/);
    press(10); press(11); press(12); press(13);
    assert.deepStrictEqual(sim6.sent.pop(), { event: 'XPNDR_SET', value: 0x4567 });
    e6.setKeypadLayout(null);
    assert.strictEqual(e6.keypadLayout, kpm.DEFAULT_LAYOUT, 'back to the built-in layout');
    // A different pathway on a preset replaces its target; encode and scale come from the preset.
    const spec = kpm.keypadSpec({ preset: 'com1', apply: { var: 'COM STANDBY FREQUENCY:1', unit: 'MHz', scale: 1 } });
    assert.deepStrictEqual(spec.apply, { var: 'COM STANDBY FREQUENCY:1', unit: 'MHz', scale: 1 });
    assert.strictEqual(e6.applyKeypad(spec, '1228'), 122.8);
    assert.deepStrictEqual(sim6.varSets.pop(), ['COM STANDBY FREQUENCY:1', 122.8]);
    assert.deepStrictEqual(kpm.keypadSpec({ preset: 'xpdr', apply: { input: 'XPDR_CODE' } }).apply, { input: 'XPDR_CODE', encode: 'bcd16' });
    assert.strictEqual(kpm.keypadSpec({ preset: 'xpdr', vfr: '7000' }).vfr, '7000', 'Europe');
    assert.throws(() => kpm.keypadSpec({ preset: 'xpdr', vfr: '1290' }), /0-7 only/);
    assert.ok(!kpm.isVfrKey({ type: 'keypad', role: 'digit', digit: '9', vfr: false }, kpm.keypadSpec('xpdr')), 'a 9 told not to be VFR');
    const { validate } = require(path.join(pluginDir, 'plugin', 'profiles'));
    assert.throws(() => validate({ id: 'x', match: {}, pages: [{ keys: { 0: { type: 'button', press: { keypad: { digits: 3 } } } } }] }, 'x'), /somewhere to set/);
    assert.throws(() => validate({ id: 'x', match: {}, pages: [{ keys: { 0: { type: 'button', press: { timer: 'T1', action: 'lap' } } } }] }, 'x'), /stopwatch action/);
    validate({ id: 'x', match: {}, pages: [prof.pages[0]] }, 'x');
  }

  // Units around values, and the separator.
  assert.strictEqual(formatValue({ suffix: '%' }, 75), '75%');
  assert.strictEqual(formatValue({ suffix: 'RPM' }, 2400), '2400 RPM');
  assert.strictEqual(formatValue({ prefix: 'QNH', decimals: 0 }, 1013.2), 'QNH 1013');
  assert.strictEqual(formatValue({ suffix: '%', text: { 0: 'OFF' } }, 0), 'OFF', 'no unit on value words');
  assert.strictEqual(formatValue({ suffix: '%' }, undefined), '---');
  {
    const sep = text(engine.keyImage({ type: 'readout', label: 'SET\nALTIMETER', read: { var: 'X', unit: 'mb' }, separator: true }, 1011));
    assert.match(sep, /<rect x="40\.0" y="[\d.]+" width="64" height="7" rx="3\.5" fill="#4fc3f7"\/>/, 'separator line');
    assert.match(sep, /aria-label="1011"/);
    const layer = text(engine.keyImage({ type: 'button', face: { layers: [{ kind: 'separator', y: 80, w: 100, color: '#ff0000' }] } }));
    assert.match(layer, /<rect x="22\.0" y="76\.5" width="100" height="7" rx="3\.5" fill="#ff0000"\/>/, 'separator layer');
    const unitLayer = text(engine.keyImage({ type: 'readout', read: { var: 'X', unit: 'n' }, suffix: '%', face: { layers: [{ kind: 'value' }, { kind: 'value', read: { var: 'Y', unit: 'n' }, suffix: 'RPM' }] } }, 40, null, () => 2400));
    assert.match(unitLayer, /aria-label="40%".*aria-label="2400 RPM"/s, 'value layers: the key\'s unit, or their own');
  }

  console.log('engine: PASS');
})().catch(e => { console.error('engine: FAIL', e); process.exitCode = 1; });
