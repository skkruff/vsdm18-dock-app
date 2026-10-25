// Stand-in for the Stream Dock app: launches the plugin the way the SDK templates expect,
// sends a few host events, and checks the plugin's replies. This proves our side of the
// protocol only; it says nothing about how the real M18 behaves.
// The device size here is a test value, not the M18's real layout.
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const WebSocket = require(path.join(__dirname, '..', 'plugin', 'com.m18switchboard.msfs.sdPlugin', 'plugin', 'node_modules', 'ws'));

const pluginDir = path.join(__dirname, '..', 'plugin', 'com.m18switchboard.msfs.sdPlugin');
const device = { id: 'DEV1', name: 'Test device', type: 0, size: { columns: 5, rows: 3 } };
const info = { application: { language: 'en', platform: 'windows', version: 'test' }, devices: [device] };

const wss = new WebSocket.Server({ port: 0 });
const port = wss.address().port;
const received = [];
let sock;

function waitFor(pred, ms = 3000) {
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

wss.on('connection', s => {
  sock = s;
  s.on('message', m => received.push(JSON.parse(m.toString())));
});

const child = spawn(process.execPath, [
  path.join(pluginDir, 'plugin', 'index.js'),
  '-port', String(port), '-pluginUUID', 'PLUGIN-UUID', '-registerEvent', 'registerPlugin', '-info', JSON.stringify(info),
], { stdio: 'inherit' });

(async () => {
  try {
    const reg = await waitFor(m => m.event === 'registerPlugin');
    assert.strictEqual(reg.uuid, 'PLUGIN-UUID');

    const send = o => sock.send(JSON.stringify(o));
    send({ event: 'willAppear', action: 'com.m18switchboard.msfs.slot', context: 'K7', device: 'DEV1',
      payload: { coordinates: { row: 1, column: 2 }, settings: {}, state: 0, isInMultiAction: false } });

    const img = await waitFor(m => m.event === 'setImage' && m.context === 'K7');
    assert.ok(img.payload.image.startsWith('data:image/svg+xml'));
    assert.ok(decodeURIComponent(img.payload.image).includes('slot 7'), 'row 1 col 2 on a 5-wide grid is slot 7');

    received.length = 0;
    send({ event: 'keyUp', action: 'com.m18switchboard.msfs.slot', context: 'K7', device: 'DEV1',
      payload: { coordinates: { row: 1, column: 2 }, settings: {}, state: 0 } });
    const png = await waitFor(m => m.event === 'setImage' && m.context === 'K7');
    assert.ok(png.payload.image.startsWith('data:image/png;base64,iVBOR'), 'second test sends a base64 PNG');

    console.log('fake-host: PASS (registration, willAppear -> coords tile, keyUp -> PNG test)');
    process.exitCode = 0;
  } catch (e) {
    console.error('fake-host: FAIL', e.message, received);
    process.exitCode = 1;
  } finally {
    child.kill();
    wss.close();
  }
})();
