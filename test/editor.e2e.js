// Drives the editor in a real browser against the harness (fake sim, temporary profile folder).
// Needs Playwright, so it is not part of `npm test`: run with `npm run test:editor`.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { startHarness } = require('./editor-harness');

let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.log('editor e2e: SKIPPED (Playwright not installed)');
  process.exit(0);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const h = await startHarness();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.prompts = []; // answers for the next prompts, in order; otherwise the default is accepted
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? (page.prompts.length ? page.prompts.shift() : d.defaultValue()) : undefined));
  const file = () => JSON.parse(fs.readFileSync(path.join(h.dir, 'c172-g1000.json'), 'utf8'));
  const slot = n => `.slot[data-slot="${n}"]`;
  const save = async () => { await page.click('#saveProfile'); await sleep(400); };

  try {
    // Other websites cannot drive the editor (review 2026-10-30): changes need the editor's
    // header, and a Host other than localhost (DNS rebinding) is refused.
    const raw = (method, headers, body) => new Promise((resolve, reject) => {
      const r = require('http').request({ host: '127.0.0.1', port: h.port, path: '/api/send-keys', method, headers }, res => { res.resume(); resolve(res.statusCode); });
      r.on('error', reject);
      r.end(body);
    });
    assert.strictEqual(await raw('POST', { 'Content-Type': 'text/plain' }, '{"keys":"Alt+F"}'), 403, 'a cross-site form post');
    assert.strictEqual(await raw('POST', { Host: 'evil.example:8765', 'X-Switchboard': '1' }, '{"keys":"Alt+F"}'), 403, 'DNS rebinding');
    assert.strictEqual(h.keyboard.typed.length, 0, 'nothing typed');
    await page.goto(`http://localhost:${h.port}/`);
    await page.waitForSelector(`${slot(0)} img`);
    await page.waitForFunction(() => /MSFS connected/.test(document.querySelector('#simStatus').textContent), null, { timeout: 5000 });
    await page.waitForSelector('.tab.active .ondock', { timeout: 5000 }); // after the first status poll
    assert.match(await page.textContent('.tab.active'), /on dock/, 'the page on the dock is marked');

    // Edit a label and save: the file changes and the engine reloads it.
    await page.click(slot(1));
    await page.fill('#inspector textarea', 'ALTERNATOR');
    assert.ok(await page.isVisible('#dirty'), 'unsaved marker');
    await save();
    assert.strictEqual(file().pages[0].keys['1'].label, 'ALTERNATOR');
    await sleep(300);
    assert.strictEqual(h.engine.profile.pages[0].keys['1'].label, 'ALTERNATOR', 'engine picked up the saved file');

    // Drag a key onto another: they swap.
    await page.dragAndDrop(slot(5), slot(9));
    await save();
    assert.strictEqual(file().pages[0].keys['9'].label, 'BCN');
    assert.strictEqual(file().pages[0].keys['5'].label, 'STRB');

    // The library ships with every key built so far, grouped by category.
    const library = () => JSON.parse(fs.readFileSync(path.join(path.dirname(h.dir), 'library.json'), 'utf8')).items;
    assert.ok(library().some(i => i.id === 'group.magneto-set'), 'shipped magneto set');
    assert.ok(library().some(i => i.id === 'c172-g1000.0.2'), 'every shipped key is in the library');
    assert.ok(await page.isVisible('.lib-cat summary:has-text("Groups")'));

    // Save the magneto group to the library, then insert it on the Auxiliary page with a new source.
    await page.click(slot(11));
    for (const s of [12, 13, 14]) await page.click(slot(s), { modifiers: ['Control'] });
    await page.click('#saveToLibrary');
    await page.fill('dialog.small-dialog input >> nth=0', 'My magnetos');
    assert.ok(!(await page.$$eval('dialog.small-dialog select option', o => o.map(x => x.textContent))).includes('Groups'), 'Groups is not offered');
    await page.selectOption('dialog.small-dialog select', '__new__');
    await page.fill('dialog.small-dialog input[placeholder="New category name"]', 'My keys');
    await page.click('#libSaveOk');
    await page.waitForSelector('.lib-cat[data-cat="My keys"] .lib-item:has-text("My magnetos")');
    const mine = library().find(i => i.name === 'My magnetos');
    assert.strictEqual(mine.category, 'My keys');
    assert.strictEqual(mine.keys.length, 4);
    // A group shows in its own category and in Groups, once each.
    assert.strictEqual(await page.locator('.lib-cat[data-cat="Groups"] .lib-item:has-text("My magnetos")').count(), 1);
    assert.strictEqual(await page.locator('.lib-cat[data-cat="My keys"] .lib-item:has-text("My magnetos")').count(), 1);
    assert.strictEqual(await page.locator('.lib-cat[data-cat="Groups"]').count(), 1, 'categories not repeated');
    await page.click('.tab:nth-child(2)');
    await page.click(slot(10));
    // As if another aircraft were loaded, one without ENGINE_MAGNETO_1: insert asks for its equivalent.
    await page.evaluate(() => { S.inputs = S.inputs.filter(n => n !== 'ENGINE_MAGNETO_1'); });
    await page.click('.lib-cat[data-cat="My keys"] .lib-item:has-text("My magnetos") button:has-text("Insert")');
    await page.click('dialog.small-dialog button:has-text("Choose from this aircraft")');
    await page.fill('dialog.browse .dialog-head input', 'MAGNETO_2');
    await page.click('dialog.browse .browse-row:has-text("ENGINE_MAGNETO_2")');
    await save();
    let aux = file().pages[1].keys;
    // Anchored at slot 10: ◀ MAG 10, MAGS 11, MAG ▶ 12, START 13.
    assert.strictEqual(aux['11'].read.input, 'ENGINE_MAGNETO_2', 'inserted with the source renamed');
    assert.strictEqual(aux['10'].press.step, -1);
    assert.deepStrictEqual(aux['13'].press, { hold: 4, release: 3, repeatMs: 250 }, 'START behaviour carried over');
    assert.ok(aux['11'].valueIcons && aux['11'].valueIcons['3'] === 'magneto_both');

    // Drag a single shipped key from the library onto an empty slot.
    await page.fill('#libSearch', 'BAT (C172');
    await sleep(400);
    await page.dragAndDrop('.lib-item:has-text("BAT (C172 G1000)") >> nth=0', slot(14));
    await save();
    aux = file().pages[1].keys;
    assert.strictEqual(aux['14'].read.input, 'ELECTRICAL_BATTERY_1', 'dragged from the library');

    // Face designer: QNH readout gets a custom face with an extra text layer, moved by dragging.
    await page.click(slot(3));
    await page.click('#inspector button:has-text("Design a custom face")');
    await page.click('#inspector button:has-text("+ Text")');
    await page.fill('#inspector .layer.active textarea', 'BARO');
    await page.locator('.face-preview').scrollIntoViewIfNeeded();
    const box = await page.locator('.face-preview').boundingBox();
    await page.mouse.move(box.x + 144, box.y + 72);
    await page.mouse.down();
    await page.mouse.move(box.x + 144, box.y + 52, { steps: 4 });
    await page.mouse.up();
    await save();
    const face = file().pages[1].keys['3'].face;
    assert.deepStrictEqual(face.layers.map(l => l.kind), ['icon', 'sublabel', 'value', 'text'], 'default face from the key (sublabel ready to move), plus a text layer');
    assert.strictEqual(face.layers[3].text, 'BARO');
    assert.strictEqual(face.layers[3].y, 26, 'dragged up 20 px on the 2x preview = 10 key units');
    assert.ok((await page.getAttribute(`${slot(3)} img`, 'src')).includes('BARO'), 'the dock picture uses the face');

    // Regression (user report): after saving, further edits to the open face must still save.
    await page.fill('#inspector .layer.active textarea', 'BARO 2');
    await save();
    assert.strictEqual(file().pages[1].keys['3'].face.layers[3].text, 'BARO 2', 'edit after save is kept');

    // A second live value on the same key, from its own simvar picked in the catalog.
    await page.click('#inspector button:has-text("+ Live value")');
    await page.click('#inspector .layer.active label:has-text("its own source") input');
    await page.click('#inspector .layer.active button:has-text("Browse…")');
    await page.fill('dialog.browse .dialog-head input', 'nav1 active');
    await page.click('dialog.browse .browse-row:has-text("NAV ACTIVE FREQUENCY:1") button:has-text("Test")');
    await page.waitForSelector('dialog.browse .browse-row:has-text("NAV ACTIVE FREQUENCY:1") .test-out:has-text("110.5")');
    await page.click('dialog.browse .browse-row:has-text("NAV ACTIVE FREQUENCY:1") .mono');
    await save();
    const nav = file().pages[1].keys['3'].face.layers[4];
    assert.deepStrictEqual(nav.read, { var: 'NAV ACTIVE FREQUENCY:1', unit: 'MHz' });
    assert.strictEqual(nav.decimals, 2, 'catalog suggests the format');
    await sleep(300);
    assert.ok(h.engine.watches.has('var:NAV ACTIVE FREQUENCY:1|MHz') || h.engine.page.name !== 'Auxiliary', 'engine watches the layer source when that page shows');

    // A Sublabel layer with its own source (user, 2026-10-30): text per that source's value.
    await page.click('#inspector .layer:has-text("Sublabel") input[type="radio"] >> nth=0');
    await page.click('#inspector .layer.active label:has-text("its own source") input');
    await page.fill('#inspector .layer.active input[placeholder^="e.g. NAV"]', 'GPS DRIVES NAV1');
    await page.keyboard.press('Tab'); // a typed name the SDK knows brings its unit (user report 2026-11-03)
    await page.waitForSelector('#inspector .layer.active .muted:has-text("unit from the SDK: bool")');
    await page.click('#inspector .layer.active button:has-text("+ value")');
    await page.fill('#inspector .layer.active .map-table input >> nth=0', '1');
    await page.fill('#inspector .layer.active .map-table input >> nth=1', 'GPS');
    await page.waitForFunction(() => /aria-label="GPS"/.test(decodeURIComponent(document.querySelector('.slot[data-slot="3"] img').src)), null, { timeout: 5000 });
    await save();
    const subL = file().pages[1].keys['3'].face.layers.find(l => l.kind === 'sublabel');
    assert.deepStrictEqual([subL.read.var, subL.read.unit, subL.sublabels], ['GPS DRIVES NAV1', 'bool', { 1: 'GPS' }]);

    // A face for one value: the BAT switch dragged in earlier gets its own look when on.
    await page.click(slot(14));
    page.prompts = ['1'];
    await page.click('#inspector button:has-text("+ face for a value")');
    await page.click('#inspector button:has-text("+ Text")');
    await page.fill('#inspector .layer.active textarea', 'BATT ON');
    // Its bar layer set to always show white.
    await page.click('#inspector button:has-text("+ State bar")');
    await page.selectOption('#inspector .layer.active label:has-text("shows") select', 'armed');
    await save();
    assert.ok(file().pages[1].keys['14'].valueFaces['1'].layers.some(l => l.kind === 'bar' && l.look === 'armed'), 'bar look stored');
    const bat = file().pages[1].keys['14'];
    assert.ok(bat.valueFaces && bat.valueFaces['1'].layers.some(l => l.text === 'BATT ON'), 'face stored for value 1');
    assert.ok(!bat.face, 'default stays automatic');

    // Learn when two controls change at once: the editor asks which.
    await page.click(slot(6));
    page.prompts = [];
    const learning = page.click('#inspector button:has-text("Learn")');
    await learning;
    await sleep(200);
    // A report of an unchanged value (user report 2026-11-01, DA62: PROCEDURE_ELEVATOR_TRIM
    // reported 0 right after subscribing) is not a move and must not end the Learn.
    h.sim.input('ELECTRICAL_BATTERY_1', h.sim.inputValues.ELECTRICAL_BATTERY_1);
    await sleep(1700);
    h.sim.input('FUEL_PUMP_1', 1);
    h.sim.input('LIGHTING_BEACON_1', 0);
    await page.waitForSelector('dialog.browse:has-text("changed")', { timeout: 5000 });
    await page.click('dialog.browse .browse-row:has-text("FUEL_PUMP_1")');
    await save();
    assert.deepStrictEqual(file().pages[1].keys['6'].read, { input: 'FUEL_PUMP_1' }, 'picked from the candidates');

    // Events: browse the catalog and fire one.
    await page.click(slot(2));
    await page.click('#inspector button:has-text("Browse…") >> nth=-1');
    await page.fill('dialog.browse .dialog-head input', 'altimeter weather');
    await page.click('dialog.browse .browse-row:has-text("BAROMETRIC") button:has-text("Send")');
    await sleep(200);
    assert.deepStrictEqual(h.sim.sent.pop(), { event: 'BAROMETRIC', value: 0 });
    await page.click('dialog.browse .browse-row:has-text("BAROMETRIC") .mono');
    await save();
    assert.strictEqual(file().pages[1].keys['2'].press.event, 'BAROMETRIC');

    // Look: the font is a global setting.
    await page.click('#lookPanel summary');
    await page.selectOption('#lookFont', 'Oswald Bold');
    await sleep(500);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(h.dir), 'settings.json'), 'utf8')).font, 'Oswald Bold');

    // Copy and paste a key.
    await page.click(slot(3));
    await page.keyboard.press('Control+c');
    await page.click(slot(9));
    await page.keyboard.press('Control+v');
    await save();
    assert.strictEqual(file().pages[1].keys['9'].label, file().pages[1].keys['3'].label);

    // Empty slot: add a switch on a learned input event (key editor redesign, 2026-11-01: type,
    // then the sections "gets its information from", "looks like", "when pressed").
    const sec = n => `#inspector [data-section="${n}"]`;
    const fld = (n, label) => `${sec(n)} .field:has(> span:text-is("${label}"))`;
    await page.click(slot(8));
    await page.click('#inspector button:has-text("Add key")');
    await page.selectOption('#inspector select >> nth=0', 'switch');
    await page.selectOption(`${fld('info', 'Source')} select`, 'input');
    await page.click(`${sec('info')} button:text-is("Learn")`);
    await page.waitForFunction(() => /LIGHTING_TAXI_1/.test(document.querySelector('#inspector input[list="inputList"]').value), null, { timeout: 6000 });
    await page.selectOption(`${fld('press', 'Action')} select`, 'cycle');
    await page.fill(`${fld('look', 'Sublabel')} input`, 'GROUND');
    await page.keyboard.press('Tab');
    // Positions: Learn records each one as the control moves, a row per position.
    h.sim.input('LIGHTING_TAXI_1', 0); // the starting position, before the first poll (was a race)
    await page.click(`${sec('look')} button:has-text("Learn positions")`);
    await page.waitForSelector(`${sec('look')} .test-out:has-text("found: 0")`);
    h.sim.input('LIGHTING_TAXI_1', 1);
    await page.waitForSelector(`${sec('look')} .test-out:has-text("found: 0, 1")`);
    h.sim.input('LIGHTING_TAXI_1', 2);
    await page.waitForSelector(`${sec('look')} .test-out:has-text("found: 0, 1, 2")`);
    await page.click(`${sec('look')} button:has-text("Done")`);
    assert.strictEqual(await page.locator(`${sec('look')} table.value-table tr`).count(), 5, 'header, three positions, + value');
    await save();
    const learned = file().pages[1].keys['8'];
    assert.deepStrictEqual(learned.read, { input: 'LIGHTING_TAXI_1' });
    assert.deepStrictEqual(learned.press, { cycle: [0, 1] }, 'a press already set is kept');
    assert.deepStrictEqual(learned.states, { 0: 'off', 1: 'on', 2: 'on' }, 'uncapped positions');
    assert.strictEqual(learned.sublabel, 'GROUND', 'sublabel on any key');

    // Readout with state logic (replaces Switch (armable)): N steps, each with "or" conditions.
    await page.click(slot(8));
    await page.selectOption('#inspector select >> nth=0', 'readout');
    await page.check(`${fld('info', 'State logic')} input`);
    await page.waitForSelector('#inspector .ladder');
    const step = n => `#inspector .ladder > .step >> nth=${n}`;
    await page.selectOption(`${step(0)} >> .field:has(> span:text-is("Source")) select`, 'var');
    await page.fill(`${step(0)} >> input[placeholder^="e.g. NAV"]`, 'AUTOPILOT APPROACH ACTIVE');
    await page.click(`${step(0)} >> button.add-or`);
    await page.selectOption(`${step(0)} >> .or-source >> nth=1 >> .field:has(> span:text-is("Source")) select`, 'var');
    await page.fill(`${step(0)} >> .or-source >> nth=1 >> input[placeholder^="e.g. NAV"]`, 'AUTOPILOT APPROACH CAPTURED');
    await page.click('#inspector .ladder > button:has-text("+ step")');
    await page.selectOption(`${step(1)} >> .field:has(> span:text-is("Source")) select`, 'var');
    await page.fill(`${step(1)} >> input[placeholder^="e.g. NAV"]`, 'AUTOPILOT APPROACH ARM');
    await page.selectOption(`${step(1)} >> .step-head select`, 'armed');
    await page.fill(`${step(1)} >> .step-head input[placeholder="sublabel"]`, 'ARM');
    // A third step: more than the old armable's two.
    await page.click('#inspector .ladder > button:has-text("+ step")');
    await page.selectOption(`${step(2)} >> .field:has(> span:text-is("Source")) select`, 'var');
    await page.fill(`${step(2)} >> input[placeholder^="e.g. NAV"]`, 'AUTOPILOT GLIDESLOPE ARM');
    await page.selectOption(`${step(2)} >> .step-head select`, 'off');
    await page.selectOption(`${fld('preview', 'Preview')} select`, 'step 2');
    // Drawn tile (no face): step 2 shows the ARM sublabel and a white bar.
    await page.waitForFunction(s => /aria-label="ARM"/.test(decodeURIComponent(document.querySelector(`.slot[data-slot="${s}"] img`).src)), 8);
    await page.waitForFunction(s => /ffffff/i.test(decodeURIComponent(document.querySelector(`.slot[data-slot="${s}"] img`).src)), 8);
    // With a custom face the sublabel needs a Sublabel layer; the editor offers to add it.
    await page.click('#inspector button:has-text("Design a custom face")');
    await page.waitForFunction(s => /aria-label="ARM"/.test(decodeURIComponent(document.querySelector(`.slot[data-slot="${s}"] img`).src)), 8);
    await page.evaluate(s => { const f = S.profile.pages[S.page].keys[s].face; f.layers = f.layers.filter(L => L.kind !== 'sublabel'); renderInspector(); renderGrid(); }, 8);
    await page.waitForFunction(s => !/aria-label="ARM"/.test(decodeURIComponent(document.querySelector(`.slot[data-slot="${s}"] img`).src)), 8);
    await page.click('#inspector button:has-text("Add it to the face")');
    await page.waitForFunction(s => /aria-label="ARM"/.test(decodeURIComponent(document.querySelector(`.slot[data-slot="${s}"] img`).src)), 8);
    // The ⓘ pins its explanation open on click.
    await page.click('#inspector .info[data-help="logic"]');
    assert.ok(await page.isVisible('#inspector .info.open .info-text'));
    // The old switch settings are listed as unused, and go at save.
    assert.ok(await page.isVisible('#inspector p:has-text("removed when you save")'));
    await save();
    const ar = file().pages[1].keys['8'];
    assert.strictEqual(ar.type, 'readout');
    assert.strictEqual(ar.logic.steps.length, 3);
    assert.deepStrictEqual(ar.logic.steps[0].when.map(c => c.read.var), ['AUTOPILOT APPROACH ACTIVE', 'AUTOPILOT APPROACH CAPTURED'], '"or" condition saved');
    assert.deepStrictEqual([ar.logic.steps[1].look, ar.logic.steps[1].sublabel], ['armed', 'ARM']);
    assert.strictEqual(ar.logic.steps[2].look, 'off');
    assert.strictEqual(ar.states, undefined, 'switch positions removed at save');
    assert.deepStrictEqual(ar.press, { cycle: [0, 1] }, 'a readout may keep a press');
    await page.click(slot(8));

    // A press can write a simvar instead (user, 2026-10-30): Acts on "Simvar", tried with Set.
    await page.selectOption(`${fld('press', 'Acts on')} select`, 'var');
    await page.fill('#inspector input[placeholder="e.g. TRANSPONDER STATE:1"]', 'TRANSPONDER STATE:1');
    await page.fill(`${fld('press', 'Unit')} input`, 'number');
    await page.fill(`${fld('press', 'Set now')} input`, '4');
    await page.click(`${fld('press', 'Set now')} button:has-text("Set")`);
    await page.waitForSelector(`${fld('press', 'Set now')} .test-out:has-text("kept")`);
    assert.strictEqual(h.sim.simvars['TRANSPONDER STATE:1'], 4);
    await save();
    assert.deepStrictEqual(file().pages[1].keys['8'].press.var, { var: 'TRANSPONDER STATE:1', unit: 'number' });
    assert.strictEqual(file().pages[1].keys['8'].press.input, undefined, 'one target only');
    await page.fill('#inspector input[placeholder="e.g. TRANSPONDER STATE:1"]', 'TRANSPONDER CODE:1');
    await page.click(`${fld('press', 'Set now')} button:has-text("Set")`);
    await page.waitForSelector(`${fld('press', 'Set now')} .test-out:has-text("did not keep")`);

    // Choosing "Send a sim event" keeps that choice while the event name is still empty (user
    // report 2026-10-29: it fell back to Nothing), and saving without a name is refused.
    await page.selectOption(`${fld('press', 'Action')} select`, 'event');
    assert.strictEqual(await page.inputValue(`${fld('press', 'Action')} select`), 'event');
    assert.ok(await page.isVisible(`${fld('press', 'Event')} input`));
    await page.click('#saveProfile');
    await page.waitForSelector('.status.bad:has-text("needs the event")');
    await page.fill(`${fld('press', 'Event')} input`, 'AP_APR_HOLD');
    // Tap / hold: a tap sends the event, a hold sends a list of two, after 600 ms.
    await page.check(`${fld('press', 'Something else when held')} input`);
    await page.fill(`${fld('press', 'Hold for, ms')} input`, '600');
    await page.fill(`${sec('press')} .action-list >> nth=1 >> .field:has(> span:text-is("Event")) input`, 'AP_MASTER');
    await page.click(`${sec('press')} .action-list >> nth=1 >> button:has-text("+ then")`);
    await page.fill(`${sec('press')} .action-list >> nth=1 >> .action-item >> nth=1 >> .field:has(> span:text-is("Event")) input`, 'AP_PANEL_HEADING_HOLD');
    await save();
    assert.deepStrictEqual(file().pages[1].keys['8'].press, { tap: { event: 'AP_APR_HOLD' }, hold: [{ event: 'AP_MASTER' }, { event: 'AP_PANEL_HEADING_HOLD' }], holdMs: 600 });
    // On the dock: a short press taps, a long one holds.
    await sleep(300);
    h.sim.sent.length = 0;
    const kd = s => h.engine.keyDown(s);
    const ku = s => h.engine.keyUp(s);
    await h.engine.setPage(1);
    await sleep(100); // the page announcement goes first
    kd(8); await sleep(50); ku(8);
    await sleep(50);
    assert.deepStrictEqual(h.sim.sent.splice(0).map(x => x.event), ['AP_APR_HOLD'], 'tap');
    kd(8); await sleep(700); ku(8);
    await sleep(50);
    assert.deepStrictEqual(h.sim.sent.splice(0).map(x => x.event), ['AP_MASTER', 'AP_PANEL_HEADING_HOLD'], 'hold');
    await h.engine.setPage(0);

    // Decorative key: the type hides the information and press sections; the rest goes at save.
    await page.click(slot(8));
    await page.selectOption('#inspector select >> nth=0', 'decor');
    await page.waitForSelector('#inspector .info[data-help="decor"]');
    assert.ok(!(await page.isVisible(sec('press'))), 'no press section');
    assert.ok(!(await page.isVisible(sec('info'))), 'no information section');
    await page.fill(`${fld('look', 'Sublabel')} input`, 'INTERIOR');
    await save();
    const deco = file().pages[1].keys['8'];
    assert.strictEqual(deco.type, 'decor');
    assert.deepStrictEqual([deco.read, deco.press, deco.logic, deco.sublabel], [undefined, undefined, undefined, 'INTERIOR']);
    await page.click(slot(8));
    await page.selectOption('#inspector select >> nth=0', 'readout');
    await page.selectOption(`${fld('info', 'Source')} select`, 'input');
    await page.fill(`${sec('info')} input[placeholder^="e.g. ELECTRICAL"]`, 'LIGHTING_TAXI_1');
    // Readout positions from the SDK's list for a simvar: the names replace the number.
    await page.selectOption(`${fld('info', 'Source')} select`, 'var');
    await page.fill(`${sec('info')} input[placeholder^="e.g. NAV"]`, 'TRANSPONDER STATE:1');
    await page.keyboard.press('Tab');
    await page.click(`${sec('look')} button:has-text("Fill from the SDK")`);
    await page.waitForFunction(() => [...document.querySelectorAll('#inspector table.value-table input')].some(i => /STANDBY/i.test(i.value)), null, { timeout: 5000 });
    await save();
    const xp = file().pages[1].keys['8'];
    assert.ok(xp.text && Object.keys(xp.text).length >= 3, `positions filled from the SDK: ${JSON.stringify(xp.text)}`);
    assert.strictEqual(xp.sublabel, 'INTERIOR', 'the sublabel stays: every type uses it');

    // Dimmer page (user, 2026-10-30): a Rotary (a dimmer knob) with units and separator; a tap
    // steps and wraps, a hold ramps.
    page.prompts = ['Dimmers'];
    await page.click('#addPage');
    await page.click(slot(0));
    await page.click('#inspector button:has-text("Add key")');
    await page.selectOption('#inspector select >> nth=0', 'rotary');
    await page.selectOption(`${fld('info', 'Source')} select`, 'input');
    await page.fill('#inspector input[placeholder="e.g. ELECTRICAL_BATTERY_1"]', 'LIGHTING_TAXI_1');
    await page.check(`${fld('look', 'Separator')} input`);
    await page.fill(`${sec('press')} .action-list >> nth=0 >> .field:has(> span:text-is("Step")) input`, '25');
    await page.fill(`${sec('press')} .action-list >> nth=1 >> .field:has(> span:text-is("Step")) input`, '5');
    await page.waitForFunction(() => /<rect[^>]*height="7"/.test(decodeURIComponent(document.querySelector('.slot[data-slot="0"] img').src)), null, { timeout: 5000 });
    await save();
    const dim = file().pages[file().pages.length - 1].keys['0'];
    assert.deepStrictEqual([dim.type, dim.suffix, dim.separator], ['rotary', '%', true]);
    assert.deepStrictEqual(dim.press, { tap: { step: 25, min: 0, max: 100, wrap: true }, hold: { step: 5, min: 0, max: 100, wrap: true, repeatMs: 100 } });
    await page.click('#inspector button:has-text("Design a custom face")');
    assert.ok(await page.isVisible('#inspector .layer:has-text("Separator")'), 'the custom face starts with the separator');
    // Level bar (user, 2026-11-03): upright, filling from the bottom, yellow below 25.
    await page.click('#inspector button:has-text("+ Level bar")');
    await page.selectOption('#inspector .layer.active label:has-text("direction") select', 'up');
    await page.click('#inspector .layer.active button:has-text("+ colour band")');
    await save();
    const lvl = file().pages[file().pages.length - 1].keys['0'].face.layers.find(l => l.kind === 'level');
    assert.deepStrictEqual(lvl, { kind: 'level', dir: 'up', min: 0, max: 100, x: 108, y: 14, w: 24, h: 116, bands: [{ below: 25, color: '#ffcc00' }] });
    // Keyboard shortcut (user, 2026-10-30): recorded from the keyboard, combinations included.
    await page.click(slot(1));
    await page.click('#inspector button:has-text("Add key")');
    await page.selectOption(`${fld('press', 'Action')} select`, 'keys');
    await page.click('#inspector button:has-text("Record")');
    await page.keyboard.press('Control+Shift+KeyL');
    await page.waitForSelector('#inspector .test-out:has-text("= Ctrl+Shift+L")');
    await page.click('#inspector button:has-text("Send now")');
    await page.waitForSelector('#inspector .test-out:has-text("sent Ctrl+Shift+L")');
    assert.deepStrictEqual(h.keyboard.typed.pop(), ['Ctrl+Shift+L', true], 'sent, MSFS to the front');
    await page.fill('#inspector input[placeholder^="e.g. Ctrl+Shift+L"]', 'Alt+Banana');
    await page.waitForSelector('#inspector .test-out.bad:has-text("unknown key")');
    await page.fill('#inspector input[placeholder^="e.g. Ctrl+Shift+L"]', 'alt+f1');
    await page.check(`${fld('press', 'While held')} input`);
    await save();
    assert.deepStrictEqual(file().pages[file().pages.length - 1].keys['1'].press, { keys: 'alt+f1', whileHeld: true });

    // Stopwatch (user, 2026-10-30): a readout of it, and one key: tap starts / stops, hold resets.
    await page.click(slot(2));
    await page.click('#inspector button:has-text("Add key")');
    await page.selectOption('#inspector select >> nth=0', 'readout');
    await page.selectOption(`${fld('info', 'Source')} select`, 'timer');
    await page.waitForFunction(() => /aria-label="0:00"/.test(decodeURIComponent(document.querySelector('.slot[data-slot="2"] img').src)), null, { timeout: 5000 });
    await page.click(slot(3));
    await page.click('#inspector button:has-text("Add key")');
    await page.selectOption(`${fld('press', 'Action')} select`, 'timer');
    await page.check(`${fld('press', 'Something else when held')} input`);
    await page.selectOption(`${sec('press')} .action-list >> nth=1 >> .field:has(> span:text-is("Action")) select`, 'timer');
    await page.selectOption(`${sec('press')} .action-list >> nth=1 >> .field:has(> span:text-is("Does")) select`, 'reset');
    // Sim paused (user, 2026-11-01): a switch that is green while the sim is paused.
    await page.click(slot(5));
    await page.click('#inspector button:has-text("Add key")');
    await page.selectOption('#inspector select >> nth=0', 'switch');
    await page.selectOption(`${fld('info', 'Source')} select`, 'sim');
    await page.selectOption(`${fld('press', 'Action')} select`, 'keys');
    await page.fill('#inspector input[placeholder^="e.g. Ctrl+Shift+L"]', 'Pause');
    h.sim.emit('pause', 4);
    await save();
    const pz = file().pages[file().pages.length - 1].keys['5'];
    assert.deepStrictEqual([pz.read, pz.press], [{ sim: 'paused' }, { keys: 'Pause' }]);
    await page.click(slot(5));
    await page.waitForFunction(() => /b8f01c|#[0-9a-f]{6}/i.test(decodeURIComponent(document.querySelector('.slot[data-slot="5"] img').src)));
    h.sim.emit('pause', 0);
    // Keypad: on a transponder readout the XPDR preset is the guess; Preview shows it on the dock picture.
    await page.click(slot(4));
    await page.click('#inspector button:has-text("Add key")');
    await page.selectOption('#inspector select >> nth=0', 'readout');
    await page.selectOption(`${fld('info', 'Source')} select`, 'var');
    await page.fill('#inspector input[placeholder="e.g. NAV ACTIVE FREQUENCY:1"]', 'TRANSPONDER CODE:1');
    await page.selectOption(`${fld('press', 'Action')} select`, 'keypad');
    assert.strictEqual(await page.inputValue('#inspector .field:has-text("Keypad for") select'), 'xpdr');
    await page.click('#inspector button:has-text("Show the keypad on the dock picture")');
    await page.waitForFunction(() => /aria-label="CANCEL"/.test(decodeURIComponent(document.querySelector('.slot[data-slot="0"] img').src)));
    // The preset's pathway is shown and can be changed (user, 2026-10-30), tried, and put back.
    assert.strictEqual(await page.inputValue('#inspector .field:has(> span:text-is("Event")) input'), 'XPNDR_SET');
    await page.fill('#inspector .field:has(> span:text-is("Event")) input', 'XPNDR_SET_ALT');
    await page.keyboard.press('Tab');
    await page.waitForSelector('#inspector h4:has-text("changed from the preset")');
    await page.fill('#inspector .field:has-text("Try it") input', '7700');
    await page.click('#inspector .field:has-text("Try it") button');
    await page.waitForSelector('#inspector .test-out:has-text("sent 30464 to XPNDR_SET_ALT")');
    assert.deepStrictEqual(h.sim.sent.pop(), { event: 'XPNDR_SET_ALT', value: 0x7700 }, 'BCD, through the new event');
    await page.click('#inspector button:has-text("Back to the preset")');
    assert.strictEqual(await page.inputValue('#inspector .field:has(> span:text-is("Event")) input'), 'XPNDR_SET');
    // Your own keypad: e.g. an autopilot altitude, 5 digits, sent with AP_ALT_VAR_SET_ENGLISH.
    await page.selectOption('#inspector .field:has-text("Keypad for") select', '');
    await page.fill('#inspector .field:has(> span:text-is("Digits")) input', '5');
    await page.fill('#inspector .field:has(> span:text-is("Event")) input', 'AP_ALT_VAR_SET_ENGLISH');
    await page.fill('#inspector .field:has(> span:text-is("Title")) input', 'ALT SEL');
    await save();
    const dv = file().pages[file().pages.length - 1].keys;
    assert.deepStrictEqual(dv['2'].read, { timer: 'T1' });
    assert.strictEqual(dv['2'].format, 'duration', 'a stopwatch readout shows M:SS');
    assert.deepStrictEqual(dv['3'].press, { tap: { timer: 'T1', action: 'toggle' }, hold: { timer: 'T1', action: 'reset' } }, 'start / stop, hold to reset');
    assert.deepStrictEqual(dv['4'].press, { keypad: { title: 'ALT SEL', digits: 5, decimals: 0, apply: { event: 'AP_ALT_VAR_SET_ENGLISH' } } });
    // The keypad layout (user, 2026-10-30): one for every keypad, edited like a page.
    await page.click('.tab.tab-keypad');
    await page.waitForSelector('#keypadNote:has-text("used by every keypad")');
    await page.click(slot(0));
    assert.strictEqual(await page.inputValue('#inspector .field:has(> span:text-is("Role")) select'), 'cancel');
    await page.selectOption('#inspector .field:has(> span:text-is("Role")) select', 'clr');
    await page.fill('#inspector .field:has-text("Label") textarea', 'CLEAR');
    await page.waitForFunction(() => /aria-label="CLEAR"/.test(decodeURIComponent(document.querySelector('.slot[data-slot="0"] img').src)));
    await save();
    const kpFile = JSON.parse(fs.readFileSync(path.join(path.dirname(h.dir), 'keypad.json'), 'utf8'));
    assert.deepStrictEqual(kpFile.keys['0'], { type: 'keypad', role: 'clr', label: 'CLEAR' });
    assert.strictEqual(h.engine.keypadLayout['0'].role, 'clr', 'the dock uses it');
    // Keypad keys stay in the keypad: pasting one into a page is refused.
    await page.click(slot(0));
    await page.keyboard.press('Control+c');
    await page.click('.tab:nth-child(2)');
    await page.click(slot(0));
    await page.keyboard.press('Control+v');
    await page.waitForSelector('.status.bad:has-text("belong in the Keypad tab")');
    await page.click('.tab.tab-keypad');
    page.prompts = [];
    await page.click('#keypadNote button:has-text("Reset to built-in")');
    await page.waitForFunction(() => /aria-label="CANCEL"/.test(decodeURIComponent(document.querySelector('.slot[data-slot="0"] img').src)));
    assert.ok(!fs.existsSync(path.join(path.dirname(h.dir), 'keypad.json')), 'built-in again');
    await page.click('.tab:nth-child(2)');

    // Save rules per type (user schema): a switch with nothing to do when pressed is refused,
    // with the reason, and the file is untouched.
    await page.click(slot(8));
    await page.click('#inspector details:has(textarea.json) summary');
    await page.fill('#inspector textarea.json', JSON.stringify({ type: 'switch', read: { input: 'LIGHTING_TAXI_1' } }));
    await page.click('#inspector button:has-text("Apply JSON")');
    await page.click('#saveProfile');
    await page.waitForSelector('.status.bad');
    assert.match(await page.textContent('.status'), /key 8: a switch .* needs something to do when pressed/);
    assert.strictEqual(file().pages[1].keys['8'].type, 'readout', 'file untouched');

    // Preview on the dock (user schema): the profile being edited, siloed from the sim. A key the
    // dock cannot draw yet (a readout with nothing to read) is left off, with the reason.
    await page.click('#inspector details:has(textarea.json) summary');
    await page.fill('#inspector textarea.json', JSON.stringify({ type: 'readout', label: 'HALF' }));
    await page.click('#inspector button:has-text("Apply JSON")');
    h.sim.sent.length = 0;
    await page.click('#previewOnDock');
    await page.waitForFunction(() => /Stop preview/.test(document.querySelector('#previewOnDock').textContent));
    await page.waitForSelector('.status:has-text("without unfinished keys"):has-text("page 2, key 8")');
    assert.ok(h.engine.preview, 'the dock is previewing');
    assert.strictEqual(h.engine.preview.pageIndex, 1, 'the page being edited');
    assert.ok(!h.engine.preview.profile.pages[1].keys['8'], 'the unfinished key is left off');
    h.engine.keyDown(2); h.engine.keyUp(2);
    await sleep(100);
    assert.deepStrictEqual(h.sim.sent, [], 'presses do not reach the sim');
    // Edits follow on the dock.
    await page.click('#inspector details:has(textarea.json) summary');
    await page.fill('#inspector textarea.json', JSON.stringify({ type: 'switch', label: 'TAXI', read: { input: 'LIGHTING_TAXI_1' }, press: { cycle: [0, 1] } }));
    await page.click('#inspector button:has-text("Apply JSON")');
    await sleep(500);
    assert.strictEqual(h.engine.preview.profile.pages[1].keys['8'].label, 'TAXI', 'the edit is on the dock');
    await page.click('#previewOnDock');
    await page.waitForFunction(() => /Preview on dock/.test(document.querySelector('#previewOnDock').textContent));
    assert.ok(!h.engine.preview, 'back to the sim');

    assert.deepStrictEqual(errors, [], 'no page errors');
    console.log('editor e2e: PASS (edit+save+reload, drag swap, library, face designer, learn, catalogs, look, copy/paste; key editor: types, positions (learn, SDK), state logic, tap / hold on the dock, rotary, save rules, preview on dock)');
  } catch (e) {
    console.error('editor e2e: FAIL', e);
    await page.screenshot({ path: path.join(__dirname, '..', 'editor-e2e-failure.png'), fullPage: true });
    process.exitCode = 1;
  } finally {
    await browser.close();
    h.close();
  }
})();
