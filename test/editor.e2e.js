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
    assert.match(await page.textContent('#simStatus'), /MSFS connected/);
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
    page.prompts = ['My magnetos', 'My keys'];
    await page.click('#saveToLibrary');
    await page.waitForSelector('.lib-item:has-text("My magnetos")');
    const mine = library().find(i => i.name === 'My magnetos');
    assert.strictEqual(mine.category, 'My keys');
    assert.strictEqual(mine.keys.length, 4);
    await page.click('.tab:nth-child(2)');
    await page.click(slot(10));
    page.prompts = ['ENGINE_MAGNETO_2'];
    await page.click('.lib-item:has-text("My magnetos") button:has-text("Insert")');
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
    await page.dragAndDrop('.lib-item:has-text("BAT (C172 G1000)")', slot(14));
    await save();
    aux = file().pages[1].keys;
    assert.strictEqual(aux['14'].read.input, 'ELECTRICAL_BATTERY_1', 'dragged from the library');

    // Face designer: QNH readout gets a custom face with an extra text layer, moved by dragging.
    await page.click(slot(3));
    await page.click('#inspector button:has-text("Design a custom face")');
    await page.click('#inspector button:has-text("+ Text")');
    await page.fill('#inspector .layer.active textarea', 'BARO');
    const box = await page.locator('.face-preview').boundingBox();
    await page.mouse.move(box.x + 144, box.y + 72);
    await page.mouse.down();
    await page.mouse.move(box.x + 144, box.y + 52, { steps: 4 });
    await page.mouse.up();
    await save();
    const face = file().pages[1].keys['3'].face;
    assert.deepStrictEqual(face.layers.map(l => l.kind), ['icon', 'value', 'text'], 'default face from the key, plus a text layer');
    assert.strictEqual(face.layers[2].text, 'BARO');
    assert.strictEqual(face.layers[2].y, 26, 'dragged up 20 px on the 2x preview = 10 key units');
    assert.ok((await page.getAttribute(`${slot(3)} img`, 'src')).includes('BARO'), 'the dock picture uses the face');

    // Regression (user report): after saving, further edits to the open face must still save.
    await page.fill('#inspector .layer.active textarea', 'BARO 2');
    await save();
    assert.strictEqual(file().pages[1].keys['3'].face.layers[2].text, 'BARO 2', 'edit after save is kept');

    // A second live value on the same key, from its own simvar picked in the catalog.
    await page.click('#inspector button:has-text("+ Live value")');
    await page.click('#inspector .layer.active label:has-text("its own source") input');
    await page.click('#inspector .layer.active button:has-text("Browse…")');
    await page.fill('dialog.browse .dialog-head input', 'nav1 active');
    await page.click('dialog.browse .browse-row:has-text("NAV ACTIVE FREQUENCY:1") button:has-text("Test")');
    await page.waitForSelector('dialog.browse .browse-row:has-text("NAV ACTIVE FREQUENCY:1") .test-out:has-text("110.5")');
    await page.click('dialog.browse .browse-row:has-text("NAV ACTIVE FREQUENCY:1") .mono');
    await save();
    const nav = file().pages[1].keys['3'].face.layers[3];
    assert.deepStrictEqual(nav.read, { var: 'NAV ACTIVE FREQUENCY:1', unit: 'MHz' });
    assert.strictEqual(nav.decimals, 2, 'catalog suggests the format');
    await sleep(300);
    assert.ok(h.engine.watches.has('var:NAV ACTIVE FREQUENCY:1|MHz') || h.engine.page.name !== 'Auxiliary', 'engine watches the layer source when that page shows');

    // A face for one value: the BAT switch dragged in earlier gets its own look when on.
    await page.click(slot(14));
    page.prompts = ['1'];
    await page.click('#inspector button:has-text("+ face for a value")');
    await page.click('#inspector button:has-text("+ Text")');
    await page.fill('#inspector .layer.active textarea', 'BATT ON');
    await save();
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
    await page.click('#inspector button:has-text("Add a key here")');
    await page.selectOption('#inspector select >> nth=0', 'switch');
    await page.selectOption('#inspector .field:has-text("Source") select', 'input');
    await page.click('#inspector button:has-text("Learn")');
    await page.waitForFunction(() => /LIGHTING_TAXI_1/.test(document.querySelector('#inspector input[list="inputList"]').value), null, { timeout: 6000 });
    await page.selectOption('#inspector .field:has-text("Action") select', 'cycle');
    await save();
    const learned = file().pages[1].keys['8'];
    assert.deepStrictEqual(learned.read, { input: 'LIGHTING_TAXI_1' });
    assert.deepStrictEqual(learned.press, { cycle: [0, 1] });

    // A save that fails validation is refused with a message, and the file is untouched.
    await page.click(slot(8));
    await page.click('#inspector details summary');
    await page.fill('#inspector textarea.json', JSON.stringify({ type: 'switch', press: { cycle: [0, 1] } }));
    await page.click('#inspector button:has-text("Apply JSON")');
    await page.click('#saveProfile');
    await page.waitForSelector('.status.bad');
    assert.match(await page.textContent('.status'), /needs read/);
    assert.deepStrictEqual(file().pages[1].keys['8'].read, { input: 'LIGHTING_TAXI_1' });

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
