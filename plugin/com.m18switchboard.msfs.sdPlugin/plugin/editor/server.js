// Editor web server, run inside the plugin process. Listens on 127.0.0.1 only. Serves the editor
// page and a small JSON API over the profile store, the icon library, the engine (for previews
// drawn exactly as the dock draws them) and the sim (input event names, learn mode).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseName } = require('../icons');

const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const LEARN_TIMEOUT_MS = 30000;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function createEditorServer({ store, engine, sim, icons, config, openOnDock, log = () => {} }) {
  // Every icon name in the library for the configured theme, without the theme suffix:
  // { name: 'magneto_off', base: 'magneto', state: 'off' }
  function iconList() {
    const out = [];
    for (const file of icons.files) {
      const p = parseName(file);
      if (!p || p.theme !== icons.theme) continue;
      out.push({ name: p.state ? `${p.base}_${p.state}` : p.base, base: p.base, state: p.state });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Waits for the first input event that changes while the user works the cockpit.
  async function learn() {
    if (!sim.connected) throw new Error('MSFS is not connected');
    const events = sim.inputs && sim.inputs.size ? [...sim.inputs.keys()] : (await sim.listInputEvents()).map(e => e.name);
    return new Promise((resolve, reject) => {
      let unsub = null;
      const timer = setTimeout(() => { if (unsub) unsub(); reject(new Error('nothing changed within 30 s')); }, LEARN_TIMEOUT_MS);
      unsub = sim.subscribeInput(events, (name, value) => {
        clearTimeout(timer);
        unsub();
        resolve({ name, value });
      });
    });
  }

  const routes = [
    ['GET', /^\/api\/state$/, () => ({
      connected: sim.connected,
      aircraft: sim.aircraft,
      activeProfile: engine.profile ? engine.profile.id : null,
      pageIndex: engine.pageIndex,
      profilesDir: store.dir,
      theme: config.theme,
      iconDir: config.iconDir,
    })],
    ['GET', /^\/api\/profiles$/, () => ({ profiles: store.list(), errors: store.load().errors })],
    ['GET', /^\/api\/profiles\/([^/]+)$/, (m) => store.read(decodeURIComponent(m[1]))],
    ['PUT', /^\/api\/profiles\/([^/]+)$/, async (m, req) => {
      store.write(decodeURIComponent(m[1]), await readBody(req));
      return { ok: true };
    }],
    ['DELETE', /^\/api\/profiles\/([^/]+)$/, (m) => { store.remove(decodeURIComponent(m[1])); return { ok: true }; }],
    ['GET', /^\/api\/icons$/, () => iconList()],
    ['GET', /^\/api\/inputs$/, async () => {
      if (!sim.connected) return { connected: false, inputs: [] };
      if (!sim.inputs || !sim.inputs.size) await sim.listInputEvents();
      return { connected: true, inputs: [...sim.inputs.keys()].sort() };
    }],
    ['POST', /^\/api\/learn$/, () => learn()],
    // Previews: { keys: { slot: keyDef }, values: { slot: value } } -> { images: { slot: uri } }
    ['POST', /^\/api\/render$/, async (m, req) => {
      const { keys = {}, values = {} } = await readBody(req);
      const images = {};
      for (const [slot, key] of Object.entries(keys)) {
        const v = values[slot];
        images[slot] = engine.keyImage(key, v === '' || v === undefined ? undefined : (isNaN(Number(v)) ? v : Number(v)));
      }
      return { images };
    }],
    ['POST', /^\/api\/render-announcement$/, async (m, req) => ({ images: engine.aircraftSceneImages(await readBody(req)) })],
    // Live values of the page currently on the dock.
    ['GET', /^\/api\/live$/, () => ({
      profile: engine.profile ? engine.profile.id : null, pageIndex: engine.pageIndex, values: engine.liveValues(),
    })],
    // Shows a page on the dock, if that profile is the one in use.
    ['POST', /^\/api\/show$/, async (m, req) => {
      const { id, page } = await readBody(req);
      if (!engine.profile || engine.profile.id !== id) throw new Error('that profile is not the one in use on the dock');
      await engine.setPage(page);
      return { ok: true };
    }],
    ['GET', /^\/api\/presets$/, () => store.readPresets()],
    ['PUT', /^\/api\/presets$/, async (m, req) => { store.writePresets(await readBody(req)); return { ok: true }; }],
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/icons/')) {
        const name = decodeURIComponent(url.pathname.slice(7)).replace(/\.png$/, '');
        const file = /^[A-Za-z0-9_-]+$/.test(name) && icons.resolve(name, null);
        return file ? send(res, 200, icons.read(file), 'image/png') : send(res, 404, { error: 'no such icon' });
      }
      for (const [method, re, handler] of routes) {
        const m = url.pathname.match(re);
        if (m && req.method === method) return send(res, 200, await handler(m, req));
      }
      if (req.method === 'GET') {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (/^[a-z0-9-]+\.(html|js|css)$/.test(file) && fs.existsSync(path.join(PUBLIC, file))) {
          return send(res, 200, fs.readFileSync(path.join(PUBLIC, file)), TYPES[path.extname(file)]);
        }
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      log('editor request failed', { url: req.url, error: e.message });
      send(res, 400, { error: e.message });
    }
  });

  return {
    listen(port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server.address().port));
      });
    },
    close() { server.close(); },
  };
}

module.exports = { createEditorServer };
