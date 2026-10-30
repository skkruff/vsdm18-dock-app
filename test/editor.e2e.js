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
    await page.click('#inspector .layer.active button:has-text("+ value")');
    await page.fill('#inspector .layer.active .map-table input >> nth=0', '1');
    await page.fill('#inspector .layer.active .map-table input >> nth=1', 'GPS');
    await page.waitForFunction(() => /aria-label="GPS"/.test(decodeURIComponent(document.querySelector('.slot[data-slot="3"] img').src)), null, { timeout: 5000 });
    await save();
    const subL = file().pages[1].keys['3'].face.layers.find(l => l.kind === 'sublabel');
    assert.deepStrictEqual([subL.read.var, subL.sublabels], ['GPS DRIVES NAV1', { 1: 'GPS' }]);

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

    // Empty slot: add a key, make it a toggle on a learned input event.
    await page.click(slot(8));
    await page.click('#inspector button:has-text("Add key")');
    await page.selectOption('#inspector select >> nth=0', 'switch');
    await page.selectOption('#inspector .field:has-text("Source") select', 'input');
    await page.click('#inspector button:has-text("Learn")');
    await page.waitForFunction(() => /LIGHTING_TAXI_1/.test(document.querySelector('#inspector input[list="inputList"]').value), null, { timeout: 6000 });
    await page.selectOption('#inspector .field:has-text("Action") select', 'cycle');
    await page.fill('#inspector .field:has-text("Sublabel") input >> nth=0', 'GROUND');
    await page.keyboard.press('Tab');
    await save();
    const learned = file().pages[1].keys['8'];
    assert.deepStrictEqual(learned.read, { input: 'LIGHTING_TAXI_1' });
    assert.deepStrictEqual(learned.press, { cycle: [0, 1] });
    assert.strictEqual(learned.sublabel, 'GROUND', 'sublabel on any key');

    // Switch (armable): the ladder sets two sources; the armed preview shows a white bar.
    const emptyAux = 8; // the key just learned becomes an armable one
    await page.click(slot(emptyAux));
    await page.selectOption('#inspector select >> nth=0', 'armable');
    await page.waitForSelector('#inspector .ladder');
    await page.selectOption('#inspector .ladder .step >> nth=0 >> .field:has-text("Source") select', 'var');
    await page.fill('#inspector .ladder .step >> nth=0 >> input[placeholder^="e.g. NAV"]', 'AUTOPILOT APPROACH ACTIVE');
    await page.fill('#inspector .ladder .step >> nth=1 >> input[placeholder^="e.g. NAV"]', 'AUTOPILOT APPROACH ARM');
    await page.click('#inspector .ladder .step >> nth=0 >> button.add-or');
    await page.fill('#inspector .ladder .step >> nth=0 >> .or-source input[placeholder^="e.g. NAV"]', 'AUTOPILOT APPROACH CAPTURED');
    await page.fill('#inspector .field:has-text("When armed") input', 'ARM');
    await page.fill('#inspector input[placeholder="input event"]', 'LIGHTING_TAXI_1');
    await page.selectOption('#inspector .field:has-text("Preview") select', 'armed');
    // Drawn tile (no face): the armed preview shows the ARM sublabel.
    await page.waitForFunction(s => /aria-label="ARM"/.test(decodeURIComponent(document.querySelector(`.slot[data-slot="${s}"] img`).src)), emptyAux);
    // With a custom face the sublabel needs a Sublabel layer; the editor offers to add it.
    await page.click('#inspector button:has-text("Design a custom face")');
    await page.waitForFunction(s => /aria-label="ARM"/.test(decodeURIComponent(document.querySelector(`.slot[data-slot="${s}"] img`).src)), emptyAux);
    // A face made before the sublabel existed has no Sublabel layer: as if so, then the fix.
    await page.evaluate(s => { const f = S.profile.pages[S.page].keys[s].face; f.layers = f.layers.filter(L => L.kind !== 'sublabel'); renderInspector(); renderGrid(); }, emptyAux);
    await page.waitForFunction(s => !/aria-label="ARM"/.test(decodeURIComponent(document.querySelector(`.slot[data-slot="${s}"] img`).src)), emptyAux);
    await page.click('#inspector button:has-text("Add it to the face")');
    await page.waitForFunction(s => /aria-label="ARM"/.test(decodeURIComponent(document.querySelector(`.slot[data-slot="${s}"] img`).src)), emptyAux);
    // Typing a sublabel adds the layer to a face that lacks it.
    await page.evaluate(s => { const f = S.profile.pages[S.page].keys[s].face; f.layers = f.layers.filter(L => L.kind !== 'sublabel'); renderInspector(); renderGrid(); }, emptyAux);
    await page.fill('#inspector .field:has-text("When armed") input', 'ARMD');
    await page.waitForFunction(s => /aria-label="ARMD"/.test(decodeURIComponent(document.querySelector(`.slot[data-slot="${s}"] img`).src)), emptyAux);
    await page.fill('#inspector .field:has-text("When armed") input', 'ARM');
    await page.waitForFunction(s => /ffffff/i.test(decodeURIComponent(document.querySelector(`.slot[data-slot="${s}"] img`).src)), emptyAux);
    // The ⓘ pins its explanation open on click.
    await page.click('#inspector .info[data-help="armable"]');
    assert.ok(await page.isVisible('#inspector .info.open .info-text:has-text("armed")'));
    await save();
    const ar = file().pages[1].keys[String(emptyAux)];
    assert.strictEqual(ar.type, 'armable');
    assert.strictEqual(ar.read.var, 'AUTOPILOT APPROACH ACTIVE');
    assert.strictEqual(ar.armed.var, 'AUTOPILOT APPROACH ARM');
    assert.deepStrictEqual(ar.sublabels, { armed: 'ARM' });
    assert.deepStrictEqual(ar.activeOr, [{ read: { var: 'AUTOPILOT APPROACH CAPTURED', unit: 'bool' } }], '"or" source saved');
    assert.strictEqual(ar.press.input, 'LIGHTING_TAXI_1');

    // A press can write a simvar instead (user, 2026-10-30): Acts on "Simvar", tried with Set.
    await page.selectOption('#inspector .field:has-text("Acts on") select', 'var');
    await page.fill('#inspector input[placeholder="e.g. TRANSPONDER STATE:1"]', 'TRANSPONDER STATE:1');
    await page.fill('#inspector input[list="unitList"] >> nth=-1', 'number');
    await page.fill('#inspector .field:has-text("Set now") input', '4');
    await page.click('#inspector .field:has-text("Set now") button:has-text("Set")');
    await page.waitForSelector('#inspector .field:has-text("Set now") .test-out:has-text("kept")');
    assert.strictEqual(h.sim.simvars['TRANSPONDER STATE:1'], 4);
    await save();
    assert.deepStrictEqual(file().pages[1].keys['8'].press.var, { var: 'TRANSPONDER STATE:1', unit: 'number' });
    assert.strictEqual(file().pages[1].keys['8'].press.input, undefined, 'one target only');
    await page.fill('#inspector input[placeholder="e.g. TRANSPONDER STATE:1"]', 'TRANSPONDER CODE:1');
    await page.click('#inspector .field:has-text("Set now") button:has-text("Set")');
    await page.waitForSelector('#inspector .field:has-text("Set now") .test-out:has-text("did not keep")');

    // Choosing "Send a sim event" keeps that choice while the event name is still empty (user
    // report 2026-10-29: it fell back to Nothing), and saving without a name is refused.
    await page.selectOption('#inspector .field:has-text("Action") select', 'event');
    assert.strictEqual(await page.inputValue('#inspector .field:has-text("Action") select'), 'event');
    assert.ok(await page.isVisible('#inspector .field:has-text("Event") input'));
    await page.click('#saveProfile');
    await page.waitForSelector('.status.bad:has-text("needs the event")');
    await page.fill('#inspector .field:has-text("Event") input', 'AP_APR_HOLD');
    await save();
    assert.deepStrictEqual(file().pages[1].keys['8'].press, { event: 'AP_APR_HOLD' });

    // Decorative key: choosing it drops the key's function (after a confirm) and hides those sections.
    await page.click(slot(8));
    await page.selectOption('#inspector select >> nth=0', 'decor');
    await page.waitForSelector('#inspector .info[data-help="decor"]');
    assert.ok(!(await page.isVisible('#inspector h4:has-text("When pressed")')), 'no press section');
    assert.ok(!(await page.isVisible('#inspector h4:has-text("Reads from the sim")')), 'no source section');
    await page.fill('#inspector .field:has-text("Sublabel") input', 'INTERIOR');
    await save();
    const deco = file().pages[1].keys['8'];
    assert.strictEqual(deco.type, 'decor');
    assert.deepStrictEqual([deco.read, deco.press, deco.sublabel], [undefined, undefined, 'INTERIOR']);
    await page.click(slot(8));
    await page.selectOption('#inspector select >> nth=0', 'armable');
    await page.selectOption('#inspector .ladder .step >> nth=0 >> .field:has-text("Source") select', 'input');
    await page.fill('#inspector .ladder .step >> nth=0 >> input[placeholder^="e.g. ELECTRICAL"]', 'LIGHTING_TAXI_1');
    await page.fill('#inspector .ladder .step >> nth=1 >> input[placeholder^="e.g. NAV"]', 'AUTOPILOT APPROACH ARM');
    await save();

    // Dimmer page (user, 2026-10-30): readout with units and separator; one key steps, wraps and ramps.
    page.prompts = ['Dimmers'];
    await page.click('#addPage');
    await page.click(slot(0));
    await page.click('#inspector button:has-text("Add key")');
    await page.selectOption('#inspector select >> nth=0', 'readout');
    await page.selectOption('#inspector .field:has-text("Source") select', 'input');
    await page.fill('#inspector input[placeholder="e.g. ELECTRICAL_BATTERY_1"]', 'LIGHTING_TAXI_1');
    await page.fill('#inspector .field:has-text("Unit after") input', '%');
    await page.check('#inspector .field:has-text("Separator") input');
    await page.selectOption('#inspector .field:has-text("Action") select', 'step');
    await page.fill('#inspector .field:has(> span:text-is("Step")) input', '25');
    await page.fill('#inspector .field:has-text("Minimum") input', '0');
    await page.fill('#inspector .field:has-text("Maximum") input', '100');
    await page.check('#inspector .field:has-text("Wrap at the ends") input');
    await page.check('#inspector .field:has-text("Hold to ramp") input');
    await page.fill('#inspector .field:has(> span:text-is("Ramp step")) input', '5');
    await page.waitForFunction(() => /<rect[^>]*height="7"/.test(decodeURIComponent(document.querySelector('.slot[data-slot="0"] img').src)), null, { timeout: 5000 });
    await save();
    const dim = file().pages[file().pages.length - 1].keys['0'];
    assert.deepStrictEqual([dim.suffix, dim.separator], ['%', true]);
    assert.deepStrictEqual(dim.press, { step: 25, min: 0, max: 100, wrap: true, rampMs: 100, rampStep: 5 });
    await page.click('#inspector button:has-text("Design a custom face")');
    assert.ok(await page.isVisible('#inspector .layer:has-text("Separator")'), 'the custom face starts with the separator');
    // Keyboard shortcut (user, 2026-10-30): recorded from the keyboard, combinations included.
    await page.click(slot(1));
    await page.click('#inspector button:has-text("Add key")');
    await page.selectOption('#inspector .field:has-text("Action") select', 'keys');
    await page.click('#inspector button:has-text("Record")');
    await page.keyboard.press('Control+Shift+KeyL');
    await page.waitForSelector('#inspector .test-out:has-text("= Ctrl+Shift+L")');
    await page.click('#inspector button:has-text("Send now")');
    await page.waitForSelector('#inspector .test-out:has-text("sent Ctrl+Shift+L")');
    assert.deepStrictEqual(h.keyboard.typed.pop(), ['Ctrl+Shift+L', true], 'sent, MSFS to the front');
    await page.fill('#inspector input[placeholder^="e.g. Ctrl+Shift+L"]', 'Alt+Banana');
    await page.waitForSelector('#inspector .test-out.bad:has-text("unknown key")');
    await page.fill('#inspector input[placeholder^="e.g. Ctrl+Shift+L"]', 'alt+f1');
    await page.check('#inspector .field:has-text("While held") input');
    await save();
    assert.deepStrictEqual(file().pages[file().pages.length - 1].keys['1'].press, { keys: 'alt+f1', whileHeld: true });

    // Stopwatch (user, 2026-10-30): a readout of it, and a key that starts / stops it.
    await page.click(slot(2));
    await page.click('#inspector button:has-text("Add key")');
    await page.selectOption('#inspector select >> nth=0', 'readout');
    await page.selectOption('#inspector .field:has-text("Source") select', 'timer');
    await page.waitForFunction(() => /aria-label="0:00"/.test(decodeURIComponent(document.querySelector('.slot[data-slot="2"] img').src)), null, { timeout: 5000 });
    await page.click(slot(3));
    await page.click('#inspector button:has-text("Add key")');
    await page.selectOption('#inspector .field:has-text("Action") select', 'timer');
    // Keypad: on a transponder readout the XPDR preset is the guess; Preview shows it on the dock picture.
    await page.click(slot(4));
    await page.click('#inspector button:has-text("Add key")');
    await page.selectOption('#inspector select >> nth=0', 'readout');
    await page.selectOption('#inspector .field:has-text("Source") select', 'var');
    await page.fill('#inspector input[placeholder="e.g. NAV ACTIVE FREQUENCY:1"]', 'TRANSPONDER CODE:1');
    await page.selectOption('#inspector .field:has-text("Action") select', 'keypad');
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
    assert.deepStrictEqual(dv['3'].press, { timer: 'T1', action: 'toggle' });
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
    page.prompts = [];
    await page.click('#keypadNote button:has-text("Reset to built-in")');
    await page.waitForFunction(() => /aria-label="CANCEL"/.test(decodeURIComponent(document.querySelector('.slot[data-slot="0"] img').src)));
    assert.ok(!fs.existsSync(path.join(path.dirname(h.dir), 'keypad.json')), 'built-in again');
    await page.click('.tab:nth-child(2)');

    // A save that fails validation is refused with a message, and the file is untouched.
    await page.click(slot(8));
    await page.click('#inspector details summary');
    await page.fill('#inspector textarea.json', JSON.stringify({ type: 'switch', press: { cycle: [0, 1] } }));
    await page.click('#inspector button:has-text("Apply JSON")');
    await page.click('#saveProfile');
    await page.waitForSelector('.status.bad');
    assert.match(await page.textContent('.status'), /needs read/);
    assert.strictEqual(file().pages[1].keys['8'].type, 'armable', 'file untouched');

    assert.deepStrictEqual(errors, [], 'no page errors');
    console.log('editor e2e: PASS (edit+save+reload, drag swap, library, face designer incl. per-value faces and extra live values, save regression, learn candidates, catalogs, look, copy/paste, validation)');
  } catch (e) {
    console.error('editor e2e: FAIL', e);
    await page.screenshot({ path: path.join(__dirname, '..', 'editor-e2e-failure.png'), fullPage: true });
    process.exitCode = 1;
  } finally {
    await browser.close();
    h.close();
  }
})();
