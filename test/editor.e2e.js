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
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? (page.nextPrompt ?? d.defaultValue()) : undefined));
  const file = () => JSON.parse(fs.readFileSync(path.join(h.dir, 'c172-g1000.json'), 'utf8'));
  const slot = n => `.slot[data-slot="${n}"]`;
  const save = async () => { await page.click('#saveProfile'); await sleep(400); };

  try {
    await page.goto(`http://localhost:${h.port}/`);
    await page.waitForSelector(`${slot(0)} img`);
    assert.match(await page.textContent('#simStatus'), /MSFS connected/);
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

    // Select the magneto group, save it as a preset, insert it on the Auxiliary page with a new source.
    await page.click(slot(11));
    for (const s of [12, 13, 14]) await page.click(slot(s), { modifiers: ['Control'] });
    page.nextPrompt = 'Magneto set';
    await page.click('#savePreset');
    await sleep(200);
    const presets = JSON.parse(fs.readFileSync(path.join(path.dirname(h.dir), 'presets.json'), 'utf8'));
    assert.match(presets[0].name, /Magneto set/, 'shipped starter preset');
    assert.strictEqual(presets[1].name, 'Magneto set');
    assert.strictEqual(presets[1].keys.length, 4);
    await page.click('.tab:nth-child(2)');
    await page.click(slot(10));
    page.nextPrompt = 'ENGINE_MAGNETO_2';
    await page.click('.preset:nth-child(2) button:has-text("Insert")');
    await save();
    const aux = file().pages[1].keys;
    // Anchored at slot 10: ◀ MAG 10, MAGS 11, MAG ▶ 12, START 13.
    assert.strictEqual(aux['11'].read.input, 'ENGINE_MAGNETO_2', 'preset inserted with the source renamed');
    assert.strictEqual(aux['10'].press.step, -1);
    assert.deepStrictEqual(aux['13'].press, { hold: 4, release: 3, repeatMs: 250 }, 'START behaviour carried over');
    assert.ok(aux['11'].valueIcons && aux['11'].valueIcons['3'] === 'magneto_both');

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
    console.log('editor e2e: PASS (edit+save+reload, drag swap, presets with rename, copy/paste, learn, validation)');
  } catch (e) {
    console.error('editor e2e: FAIL', e);
    await page.screenshot({ path: path.join(__dirname, '..', 'editor-e2e-failure.png'), fullPage: true });
    process.exitCode = 1;
  } finally {
    await browser.close();
    h.close();
  }
})();
