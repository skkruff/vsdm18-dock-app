// Editor web server, run inside the plugin process. Listens on 127.0.0.1 only. Serves the editor
// page and a small JSON API over the profile store, the icon library, the engine (for previews
// drawn exactly as the dock draws them) and the sim (input event names, learn mode).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseName } = require('../icons');
const { sourceKey, keySources } = require('../engine');
const { FONTS, style } = require('../render');

const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const LEARN_TIMEOUT_MS = 30000;
const LEARN_WINDOW_MS = 1500; // after the first change, keep collecting for this long
const CATALOG = path.join(__dirname, '..', '..', 'catalog');

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

function createEditorServer({ store, engine, sim, icons, config, look = {}, applyLook = () => {}, log = () => {} }) {
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

  // Waits for input events to change while the user works the cockpit. Everything that changes
  // within LEARN_WINDOW_MS of the first change is returned, so the user can pick the right one
  // when one switch moves several things: [{ name, value, changes }], first change first.
  async function learn() {
    if (!sim.connected) throw new Error('MSFS is not connected');
    const events = sim.inputs && sim.inputs.size ? [...sim.inputs.keys()] : (await sim.listInputEvents()).map(e => e.name);
    return new Promise((resolve, reject) => {
      const seen = new Map();
      let unsub = null;
      let windowTimer = null;
      const timer = setTimeout(() => { if (unsub) unsub(); reject(new Error('nothing changed within 30 s')); }, LEARN_TIMEOUT_MS);
      unsub = sim.subscribeInput(events, (name, value) => {
        const s = seen.get(name) || { name, value, changes: 0 };
        s.value = value;
        s.changes++;
        seen.set(name, s);
        if (windowTimer) return;
        clearTimeout(timer);
        windowTimer = setTimeout(() => { unsub(); resolve({ candidates: [...seen.values()] }); }, LEARN_WINDOW_MS);
      });
    });
  }

  // One-off reads for previews of sources the dock is not watching, cached for a few seconds.
  const previewCache = new Map(); // sourceKey -> { value, at }
  async function readForPreview(src) {
    const k = sourceKey(src);
    const hit = previewCache.get(k);
    if (hit && Date.now() - hit.at < 3000) return hit.value;
    let value;
    try {
      if (src.input) value = await sim.getInput(src.input, 800);
      else {
        const type = src.unit === 'bool' ? 'bool' : src.unit === 'string' ? 'string' : 'number';
        value = await sim.read({ name: src.var, unit: type === 'string' ? null : src.unit, type }, 800);
        if (typeof value === 'boolean') value = Number(value);
      }
    } catch (e) { value = undefined; }
    previewCache.set(k, { value, at: Date.now() });
    return value;
  }

  function catalog(name) {
    try { return JSON.parse(fs.readFileSync(path.join(CATALOG, `${name}.json`), 'utf8')); } catch (e) { return []; }
  }

  // Current values of the aircraft's input events, read one by one.
  async function inputValues(names) {
    const out = [];
    for (const name of names) {
      let value;
      try { value = await sim.getInput(name, 1500); } catch (e) { value = null; }
      out.push({ name, value });
    }
    return out;
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
    // The same list with current values (takes a few seconds for a big aircraft).
    ['GET', /^\/api\/input-values$/, async () => {
      if (!sim.connected) return { connected: false, inputs: [] };
      if (!sim.inputs || !sim.inputs.size) await sim.listInputEvents();
      return { connected: true, aircraft: sim.aircraft && sim.aircraft.title, inputs: await inputValues([...sim.inputs.keys()].sort()) };
    }],
    ['GET', /^\/api\/catalog\/(simvars|events)$/, (m) => catalog(m[1])],
    // Reads a simvar once, to check it exists and gives sensible values in this aircraft.
    ['POST', /^\/api\/test-var$/, async (m, req) => {
      const { var: name, unit } = await readBody(req);
      if (!sim.connected) throw new Error('MSFS is not connected');
      const type = unit === 'bool' ? 'bool' : unit === 'string' ? 'string' : 'number';
      try {
        return { value: await sim.read({ name, unit: type === 'string' ? null : unit, type }) };
      } catch (e) {
        throw new Error(`no value for ${name} (${unit}): not a simvar this aircraft has, or the wrong unit`);
      }
    }],
    ['POST', /^\/api\/send-event$/, async (m, req) => {
      const { event, value = 0 } = await readBody(req);
      if (!sim.connected) throw new Error('MSFS is not connected');
      sim.send({ event, value: Number(value) || 0 });
      return { ok: true };
    }],
    ['POST', /^\/api\/test-input$/, async (m, req) => {
      const { name } = await readBody(req);
      return { value: await sim.getInput(name) };
    }],
    // Look: the font and colours of drawn keys.
    ['GET', /^\/api\/settings$/, () => ({ settings: store.readSettings(), fonts: Object.keys(FONTS), measured: look.measured || {}, style })],
    ['PUT', /^\/api\/settings$/, async (m, req) => {
      const s = await readBody(req);
      store.writeSettings(s);
      applyLook(s);
      return { ok: true };
    }],
    ['POST', /^\/api\/learn$/, () => learn()],
    // Previews: { keys: { slot: keyDef }, values: { slot: value } } -> { images: { slot: uri } }
    ['POST', /^\/api\/render$/, async (m, req) => {
      const { keys = {}, values = {}, sources = {} } = await readBody(req);
      const parse = v => (v === '' || v === undefined || v === null ? undefined : (isNaN(Number(v)) ? v : Number(v)));
      // Value layers with their own source: live from the dock if watched, else read once.
      const extra = {};
      if (sim.connected) {
        for (const key of Object.values(keys)) {
          for (const src of keySources(key).slice(key.read ? 1 : 0)) {
            const k = sourceKey(src);
            if (sources[k] === undefined && extra[k] === undefined && (src.input || src.var)) extra[k] = await readForPreview(src);
          }
        }
      }
      const valueOf = src => parse(sources[sourceKey(src)] ?? extra[sourceKey(src)]);
      const images = {};
      for (const [slot, key] of Object.entries(keys)) {
        images[slot] = engine.keyImage(key, parse(values[slot]), null, valueOf);
      }
      return { images };
    }],
    ['POST', /^\/api\/render-announcement$/, async (m, req) => ({ images: engine.aircraftSceneImages(await readBody(req)) })],
    // Live values of the page currently on the dock.
    ['GET', /^\/api\/live$/, () => ({
      profile: engine.profile ? engine.profile.id : null, pageIndex: engine.pageIndex, values: engine.liveValues(),
      sources: engine.liveSources(),
    })],
    // Shows a page on the dock, if that profile is the one in use.
    ['POST', /^\/api\/show$/, async (m, req) => {
      const { id, page } = await readBody(req);
      if (!engine.profile || engine.profile.id !== id) throw new Error('that profile is not the one in use on the dock');
      await engine.setPage(page);
      return { ok: true };
    }],
    // Key library: reusable keys and groups of keys.
    ['GET', /^\/api\/library$/, () => store.readLibrary().items],
    ['POST', /^\/api\/library$/, async (m, req) => {
      const item = await readBody(req);
      if (!item.name || !Array.isArray(item.keys) || !item.keys.length) throw new Error('a library item needs a name and keys');
      const lib = store.readLibrary();
      item.id = `user.${Date.now().toString(36)}`;
      item.category = item.category || 'My keys';
      delete item.shipped;
      lib.items.push(item);
      store.writeLibrary(lib);
      return item;
    }],
    ['PATCH', /^\/api\/library\/([^/]+)$/, async (m, req) => {
      const lib = store.readLibrary();
      const item = lib.items.find(i => i.id === decodeURIComponent(m[1]));
      if (!item) throw new Error('no such library item');
      const { name, category, notes } = await readBody(req);
      Object.assign(item, name !== undefined ? { name } : {}, category !== undefined ? { category } : {}, notes !== undefined ? { notes } : {});
      store.writeLibrary(lib);
      return item;
    }],
    ['DELETE', /^\/api\/library\/([^/]+)$/, (m) => {
      const lib = store.readLibrary();
      const id = decodeURIComponent(m[1]);
      const item = lib.items.find(i => i.id === id);
      if (!item) throw new Error('no such library item');
      lib.items = lib.items.filter(i => i !== item);
      if (item.shipped && !lib.hiddenShipped.includes(id)) lib.hiddenShipped.push(id);
      store.writeLibrary(lib);
      return { ok: true };
    }],
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
