// Phase 0 diagnostic plugin.
// Place the "Switchboard Slot" action on every key of one Stream Dock page. Each key then shows
// its row/column. Pressing a key cycles it through display tests (see TESTS) and logs what
// happened, so docs/verified.md can be filled in from the real M18.
const fs = require('fs');
const path = require('path');
const { Dock } = require('./dock');
const log = require('./log');

const dock = new Dock();
const keys = new Map(); // context -> { device, row, column, test }
const devices = new Map(); // device id -> deviceInfo

const staticDir = path.join(__dirname, '..', 'static');
const testPng = 'data:image/png;base64,' + fs.readFileSync(path.join(staticDir, 'test_144.png')).toString('base64');

function svgUri(svg) {
  return 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
}

// 144x144 frame with a 2px border at the very edge, so cropping or scaling is visible on the key.
function frameSvg(lines, { bg = '#102030', fg = '#ffffff', size = 28 } = {}) {
  const step = size * 1.15;
  const y0 = 72 - ((lines.length - 1) * step) / 2;
  const text = lines.map((l, i) =>
    `<text x="72" y="${y0 + i * step}" font-family="Arial" font-weight="bold" font-size="${size}" fill="${fg}" text-anchor="middle" dominant-baseline="middle">${l}</text>`
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
    `<rect width="144" height="144" fill="${bg}"/>` +
    `<rect x="1" y="1" width="142" height="142" fill="none" stroke="#ff3030" stroke-width="2"/>` +
    text + `</svg>`;
}

function slotIndex(k) {
  const dev = devices.get(k.device);
  const cols = dev?.size?.columns;
  return cols ? k.row * cols + k.column : null;
}

const TESTS = [
  {
    name: 'coords-svg',
    run(ctx, k) {
      const slot = slotIndex(k);
      dock.setTitle(ctx, '');
      dock.setImage(ctx, svgUri(frameSvg([`r${k.row} c${k.column}`, slot === null ? 'slot ?' : `slot ${slot}`], { size: 24 })));
    },
  },
  {
    name: 'png-base64',
    run(ctx) { dock.setTitle(ctx, ''); dock.setImage(ctx, testPng); },
  },
  {
    name: 'title-only',
    run(ctx) {
      dock.setImage(ctx, svgUri(frameSvg([], { bg: '#000000' })));
      dock.setTitle(ctx, 'TITLE\n2 lines');
    },
  },
  {
    name: 'readout-svg',
    run(ctx) {
      dock.setTitle(ctx, '');
      dock.setImage(ctx, svgUri(frameSvg(['QNH', '1013'], { bg: '#000000', fg: '#ffd040', size: 34 })));
    },
  },
  {
    name: 'state-1',
    run(ctx) { dock.setState(ctx, 1); },
  },
];

function runTest(ctx) {
  const k = keys.get(ctx);
  if (!k) return;
  const t = TESTS[k.test % TESTS.length];
  log.info('test', { context: ctx, row: k.row, column: k.column, test: t.name });
  t.run(ctx, k);
}

dock.on('message', msg => log.info('recv', msg));

dock.on('connected', () => {
  log.info('registered', { args: { ...dock.args, info: undefined } });
  log.info('registration info', dock.args.info);
  for (const d of dock.args.info.devices || []) devices.set(d.id, d);
});

dock.on('deviceDidConnect', msg => {
  devices.set(msg.device, { id: msg.device, ...msg.deviceInfo });
  // Redraw keys on this device now that we know its column count.
  for (const [ctx, k] of keys) if (k.device === msg.device && k.test === 0) runTest(ctx);
});

dock.on('willAppear', msg => {
  const c = msg.payload?.coordinates || {};
  keys.set(msg.context, { device: msg.device, row: c.row, column: c.column, test: 0 });
  runTest(msg.context);
});

dock.on('willDisappear', msg => keys.delete(msg.context));

dock.on('keyUp', msg => {
  const k = keys.get(msg.context);
  if (!k) return;
  k.test += 1;
  runTest(msg.context);
});

dock.connect();
