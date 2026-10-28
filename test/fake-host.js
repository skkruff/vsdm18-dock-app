// Stand-in for the Stream Dock app: launches the plugin the way the SDK templates expect, places
// the action on keys, and checks the plugin's replies. There is no sim here, so the plugin should
// sit in its "MSFS not connected" state. Proves our side of the protocol and the slot mapping
// only, not how the real M18 or MSFS behave.
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const WebSocket = require(path.join(__dirname, '..', 'plugin', 'com.m18switchboard.msfs.sdPlugin', 'plugin', 'node_modules', 'ws'));

const pluginDir = path.join(__dirname, '..', 'plugin', 'com.m18switchboard.msfs.sdPlugin');
const device = { id: 'DEV1', name: 'VSDM18', type: 0, size: { columns: 5, rows: 3 } };
const info = { application: { language: 'en', platform: 'windows', version: 'test' }, devices: [device] };

const os = require('os');
const fs = require('fs');
const profilesDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-')), 'profiles');

const wss = new WebSocket.Server({ port: 0 });
const port = wss.address().port;
const received = [];
let sock;

function waitFor(pred, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      const hit = received.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - t0 > ms) return reject(new Error('timeout waiting for message'));
      setTimeout(poll, 20);
    })();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

wss.on('connection', s => {
  sock = s;
  s.on('message', m => received.push(JSON.parse(m.toString())));
});

const child = spawn(process.execPath, [
  path.join(pluginDir, 'plugin', 'index.js'),
  '-port', String(port), '-pluginUUID', 'PLUGIN-UUID', '-registerEvent', 'registerPlugin', '-info', JSON.stringify(info),
], {
  stdio: 'inherit',
  env: { ...process.env, SWITCHBOARD_PROFILES_DIR: profilesDir, SWITCHBOARD_EDITOR_PORT: '0' },
});

const appear = (context, row, column) => sock.send(JSON.stringify({
  event: 'willAppear', action: 'com.m18switchboard.msfs.slot', context, device: 'DEV1',
  payload: { controller: 'Keypad', coordinates: { row, column }, settings: {}, state: 0, isInMultiAction: false },
}));

(async () => {
  try {
    const reg = await waitFor(m => m.event === 'registerPlugin');
    assert.strictEqual(reg.uuid, 'PLUGIN-UUID');

    // "MSFS / NOT CONNECTED" spans the panel: row 1 column 2 is slot 7 (centre piece, logo), row 0
    // column 2 the bottom centre (second line), row 2 column 0 slot 0 (top-left piece).
    appear('CENTRE', 1, 2);
    appear('BOTTOM_CENTRE', 0, 2);
    appear('TOPLEFT', 2, 0);
    appear('ROUND_RIGHT', 2, 5);
    const centre = await waitFor(m => m.event === 'setImage' && m.context === 'CENTRE');
    assert.match(decodeURIComponent(centre.payload.image), /viewBox="360 180 144 144"/);
    const bottom = await waitFor(m => m.event === 'setImage' && m.context === 'BOTTOM_CENTRE');
    assert.match(decodeURIComponent(bottom.payload.image), /NOT CONNECTED/);
    const topLeft = await waitFor(m => m.event === 'setImage' && m.context === 'TOPLEFT');
    assert.match(decodeURIComponent(topLeft.payload.image), /viewBox="0 0 144 144"/);
    await sleep(200);
    assert.ok(!received.some(m => m.event === 'setImage' && m.context === 'ROUND_RIGHT'), 'round buttons get no image');

    // Presses while the sim is away do nothing and do not crash the plugin.
    sock.send(JSON.stringify({ event: 'keyDown', context: 'ROUND_RIGHT', device: 'DEV1', payload: { coordinates: { row: 2, column: 5 } } }));
    sock.send(JSON.stringify({ event: 'keyDown', context: 'CENTRE', device: 'DEV1', payload: { coordinates: { row: 1, column: 2 } } }));
    await sleep(200);
    assert.strictEqual(child.exitCode, null, 'plugin still running');

    assert.deepStrictEqual(fs.readdirSync(profilesDir).sort(), ['c172-g1000.json', 'generic.json'], 'shipped profiles copied to the profile folder');
    console.log('fake-host: PASS (registration, slot mapping, offline state, presses while offline, profile folder seeded)');
    process.exitCode = 0;
  } catch (e) {
    console.error('fake-host: FAIL', e.message, received);
    process.exitCode = 1;
  } finally {
    child.kill();
    wss.close();
  }
})();
