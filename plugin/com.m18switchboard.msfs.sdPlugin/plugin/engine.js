// Profile engine: picks the profile for the loaded aircraft, decides what each key shows and does,
// watches only the sources the active page needs, and redraws keys when the sim reports changes.
//
// Rule from the brief: a key shows sim state, never the last press. Presses only send commands.
//
// Slots: 0-14 are the LCD keys (top-left first), 15-17 the round buttons (page prev / main /
// next). display is { image(slot, uri), title(slot, text), alert(slot) }.
const { matchProfile, isTapHold } = require('./profiles');
const { tiles } = require('./render');
const { DockVars, formatDuration } = require('./dockvars');
const kp = require('./keypad');
const { migrateKey } = require('./migrate');

// Keys in the current model. Profiles are migrated when loaded; this catches an old-form key from
// anywhere else (an editor page opened before an update, a pasted key). Cached per key object.
const migrated = new WeakMap();
function norm(key) {
  if (!key || typeof key !== 'object') return key;
  const old = key.type === 'armable' || (key.press && !Array.isArray(key.press) && (key.press.rampMs || key.press.holdReset));
  if (!old) return key;
  if (!migrated.has(key)) migrated.set(key, migrateKey(key));
  return migrated.get(key);
}

const LCD_SLOTS = 15;
const NAV = { 15: 'prev', 16: 'main', 17: 'next' };
const STATUS_ROWS = { offline: { 0: 'MSFS', 2: 'NOT CONNECTED' }, loading: { 0: 'MSFS', 2: 'LOADING' } };
const STATUS_COLOR = '#9aa0a8';
const LOGO_SLOT = 7;

function sourceKey(src) {
  if (src.timer !== undefined) return `timer:${src.timer}:${src.part || 'elapsed'}`;
  if (src.sim !== undefined) return `sim:${src.sim}`;
  return src.input ? `input:${src.input}` : `var:${src.var}|${src.unit}`;
}

function pick(o, keys) {
  const out = {};
  for (const k of keys) if (o[k] !== undefined && o[k] !== '') out[k] = o[k];
  return out;
}

function normalise(v) {
  return typeof v === 'boolean' ? Number(v) : v;
}

// Map lookup by value: numbers are rounded so 1.0000001 finds "1".
function lookup(map, value) {
  if (!map || value === undefined) return undefined;
  return map[typeof value === 'number' ? String(Math.round(value)) : String(value)];
}

// Every sim source a key uses: its own, plus value layers with their own source in its faces.
function keySources(key) {
  key = norm(key);
  const out = key.read ? [key.read] : [];
  // A press that writes a simvar watches it too, so cycle and step know its current value.
  for (const a of pressActions(key.press)) if (a.var && a.var.var) out.push(a.var);
  // Readout state logic: every condition's source.
  for (const s of (key.logic && key.logic.steps) || []) for (const c of s.when || []) if (c.read) out.push(c.read);
  const faces = [key.face, ...Object.values(key.valueFaces || {}), ...Object.values(key.logicFaces || {})].filter(Boolean);
  for (const f of faces) for (const L of f.layers || []) if ((L.kind === 'value' || L.kind === 'sublabel' || L.kind === 'level') && L.read) out.push(L.read);
  // Each source once (a readout's own source is often a state logic condition too).
  const seen = new Set();
  return out.filter(s => { const k = sourceKey(s); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Readout state logic (generalised from the armable ladder, user 2026-11-01): steps checked top to
// bottom, the first with any condition met wins, else otherwise. A condition is { read, is }
// (is defaults to 1). Returns the step's index, 'otherwise', or undefined while nothing is known.
// The editor previews a step by name: 'step 1', 'step 2', ..., 'otherwise'.
function logicStep(logic, valueOf, preview) {
  if (typeof preview === 'string') {
    const m = preview.match(/^step (\d+)$/);
    if (m) return Number(m[1]) - 1;
    if (preview === 'otherwise') return 'otherwise';
    if (preview === 'active') return 0; // the armable editor's step names
    if (preview === 'armed') return 1;
  }
  const steps = logic.steps || [];
  let known = false;
  for (let i = 0; i < steps.length; i++) {
    for (const c of steps[i].when || []) {
      const v = valueOf(c.read);
      if (v === undefined) continue;
      known = true;
      if (same(v, c.is ?? 1)) return i;
    }
  }
  return known ? 'otherwise' : undefined;
}

// One key of the keypad layout (keypad.js), for an open keypad k = { spec, typed, now }. Keys
// without a face or icon get the built-in look for their role; a label replaces a fixed role's
// word, a face's live value layers show the role's text. Keys that do nothing now are dimmed.
function keypadKeyImage(engine, key, k) {
  if (!key) return tiles.blank();
  if (key.type !== 'keypad') return engine.keyImage(key);
  const { spec, typed, now } = k;
  const vfr = kp.isVfrKey(key, spec);
  const role = vfr ? 'vfr' : key.role;
  const d = String(key.digit);
  const enabled = role === 'vfr' ? !!spec.vfr : role === 'digit' ? !(spec.octal && Number(d) > 7) && typed.length < spec.digits
    : ['ent', 'del', 'clr'].includes(role) ? !!typed : true;
  const nowText = now || ''; // just the value: "now" squeezed it (user, 2026-10-30)
  const text = role === 'digit' ? d : role === 'title' ? (spec.title || 'ENTER') : role === 'now' ? now
    : role === 'typed' ? kp.display(spec, typed) : role === 'vfr' && key.role === 'digit' ? 'VFR' : (key.label || kp.ROLE_TEXT[role] || '');
  const label = role === 'digit' ? (key.label || d) : text;
  const sublabel = key.sublabel !== undefined ? key.sublabel : role === 'title' ? nowText : '';
  if (key.face) {
    const iconFor = name => {
      const uri = engine.renderer.icon(name || key.icon, null);
      return uri ? { uri, box: engine.renderer.iconBox(name || key.icon, null) } : null;
    };
    return tiles.face(key.face, { iconFor, valueFor: () => label, state: enabled ? 'on' : 'clear', sublabel, dim: !enabled });
  }
  const icon = key.icon && engine.renderer.icon(key.icon, null);
  if (icon) return enabled ? icon : tiles.dimIcon(icon);
  if (role === 'title') return tiles.keypadTitle(text, sublabel);
  if (role === 'now') return tiles.keypadTitle(key.label || 'NOW', now || '');
  if (role === 'typed') return tiles.keypadTyped(text);
  return tiles.keypadKey(label, { role: role === 'digit' ? 'digit' : role, dim: !enabled, sublabel });
}

// How a press behaves on the dock (review 2026-10-30; tap / hold from the key editor redesign,
// user 2026-11-01): a keypad, a keyboard shortcut (which can be held down with the key), tap /
// hold, or a plain action (cycle, step, set, spring-loaded hold, event, stopwatch, or a list).
function pressKind(p) {
  if (isTapHold(p)) return 'taphold';
  if (!Array.isArray(p) && p.keypad) return 'keypad';
  if (!Array.isArray(p) && p.keys) return 'keys';
  return 'simple';
}

// Every action in a press, lists and tap / hold opened up.
function pressActions(p) {
  if (!p) return [];
  if (Array.isArray(p)) return p.flatMap(pressActions);
  if (isTapHold(p)) return [...pressActions(p.tap), ...pressActions(p.hold)];
  return [p];
}

// What cycle / step / hold / set change: the action's simvar (var, user 2026-10-30), its input
// event, or the key's own input event. A simvar is never written unless an action names it.
function actionTarget(key, a) {
  if (a.var && a.var.var) return a.var;
  const input = a.input || (key.read && key.read.input);
  return input ? { input } : null;
}

// The value after current in a cycle list. A value not in the list (e.g. a dimmer set to 37 in
// the cockpit, list 0/25/50/75/100) goes to the next listed value above it, so the key carries on
// upward instead of jumping to the start (user, 2026-10-30); above them all, the first.
function nextInCycle(list, current) {
  if (current === undefined) return list[0];
  const now = Math.round(current);
  const i = list.findIndex(v => v === now);
  if (i >= 0) return list[(i + 1) % list.length];
  const above = list.filter(v => v > now);
  return above.length ? Math.min(...above) : list[0];
}

const same = (a, b) => String(a) === String(b);

// Sublabel: per-value text if there is one for this value, else the fixed sublabel. Switches made
// before sublabels existed kept theirs in `text` ("word under the label"), still honoured.
function sublabelFor(key, value) {
  const perValue = lookup(key.sublabels || (key.type === 'switch' ? key.text : null), value);
  return perValue !== undefined ? perValue : key.sublabel;
}

// A face's Sublabel layer shows the key's sublabel, or with its own source (L.read) the text for
// that source's value: L.sublabels { value: text }, else L.sublabel (user, 2026-10-30).
function layerSublabel(keySublabel, valueOf) {
  return L => {
    if (!L || !L.read) return keySublabel;
    const own = lookup(L.sublabels, valueOf(L.read));
    return own !== undefined ? own : L.sublabel;
  };
}

function formatValue(key, value) {
  if (value === undefined) return '---';
  const text = lookup(key.text, value);
  if (text !== undefined) return text;
  return withUnits(key, formatNumber(key, value));
}

function formatNumber(key, value) {
  if (typeof value !== 'number') return String(value);
  if (key.format === 'duration') return formatDuration(value); // stopwatch: M:SS, H:MM:SS
  if (key.format === 'time') {
    // Seconds since midnight (LOCAL TIME, ZULU TIME) as HH:MM.
    const m = Math.floor(value / 60) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  const s = value.toFixed(key.decimals ?? 0);
  return key.pad ? s.padStart(key.pad, '0') : s;
}

// Units around a value (user, 2026-10-30): prefix "QNH" -> "QNH 1013", suffix "%" -> "75%",
// suffix "RPM" -> "2400 RPM". A unit starting with a letter or digit gets a space; symbols do not.
function withUnits(key, s) {
  const word = u => /^[A-Za-z0-9]/.test(u);
  const pre = key.prefix ? `${key.prefix}${word(key.prefix.slice(-1)) ? ' ' : ''}` : '';
  const post = key.suffix ? `${word(key.suffix) ? ' ' : ''}${key.suffix}` : '';
  return `${pre}${s}${post}`;
}

class ProfileEngine {
  constructor({ sim, display, renderer, profiles, announcePages = true, announceMs = 800,
    announceAircraftMs = 2500, logoIcon = 'fs_logo_icon', animateScenes = true, sceneFps = 10, keyboard = null, dockVars = null,
    redrawMs = 100, log = () => {} }) {
    Object.assign(this, { sim, display, renderer, profiles, announcePages, announceMs, announceAircraftMs, logoIcon, animateScenes, sceneFps, keyboard, redrawMs, log });
    this.redrawTimers = new Map(); // sourceKey -> { timer, pending }: see _redrawSourceSoon
    this.dockVars = dockVars || new DockVars();
    this.keypad = null; // { spec, typed, now } while a keypad covers the dock
    this.keypadLayout = kp.DEFAULT_LAYOUT;
    this.preview = null; // { profile, pageIndex, values, sources } while preview mode shows a profile
    this.scene = null; // panel-wide picture shown instead of the keys (aircraft or page name)
    this.sceneTimer = null;
    this.slide = 0; // sideways offset of panel-wide text, animated (see _slide)
    this.slideTimer = null;
    this.holdTimers = new Map(); // slot -> interval re-sending a held position
    // slot -> what a press still in progress is doing, for its key up: { kind: 'ramp', ramping },
    // { kind: 'keys', keys } (a shortcut held down), { kind: 'taphold', held }.
    this.pressing = new Map();
    this.swallowed = new Set(); // slots whose key down only dismissed an announcement
    this.status = 'offline'; // offline | loading | ready
    this.profile = null;
    this.pageIndex = 0;
    this.watches = new Map(); // sourceKey -> { src, value, error, unsub }
    // Sim states the plugin keeps itself ({ sim: 'paused' } sources): unknown until the sim reports
    // one (Pause_EX1 comes only on a change, not on connecting).
    this.simStates = {};
    this.generation = 0; // bumps on every aircraft/page change so stale async work is dropped
  }

  start() {
    // Stopwatches count sim time; keys showing one follow it.
    this.sim.subscribe([{ name: 'SIMULATION TIME', unit: 'seconds', type: 'number' }], (n, v) => this.dockVars.simTime(v));
    this.dockVars.on('change', name => {
      for (const [k, w] of this.watches) {
        if (w.src.timer === name) { w.value = this.dockVars.value(w.src); this._redrawSource(k); }
      }
    });
    this.sim.on('connected', () => { this.status = 'loading'; this._sway(); });
    this.sim.on('disconnected', () => {
      this.dockVars.simGone();
      this.simStates = {};
      this.keypad = null;
      this._unwatchAll();
      this._stopHolds();
      this.profile = null;
      this.status = 'offline';
      this._clearScene();
      this._sway();
    });
    this.sim.on('exception', e => this._onException(e));
    this.sim.on('pause', flags => {
      this.dockVars.setPaused(flags !== 0);
      this.log('pause', { flags });
      this._setSimState('paused', flags !== 0 ? 1 : 0);
    });
    this.sim.onAircraftChanged(a => this.setAircraft(a));
    this._sway();
  }

  _setSimState(name, value) {
    this.simStates[name] = value;
    for (const [k, w] of this.watches) {
      if (w.src.sim === name && w.value !== value) { w.value = value; this._redrawSource(k); }
    }
  }

  get page() { return this.profile ? this.profile.pages[this.pageIndex] : null; }

  async setAircraft(aircraft) {
    const profile = matchProfile(this.profiles, aircraft);
    this.log('aircraft', { ...aircraft, profile: profile ? profile.id : null });
    this.profile = profile;
    this.pageIndex = 0;
    await this._showPage({ aircraft: true });
  }

  setProfiles(profiles) {
    this.profiles = profiles;
    if (this.sim.aircraft && this.sim.aircraft.title !== undefined && this.status !== 'offline') {
      // Re-match and redraw in place (same page if it still exists), without announcing.
      const profile = matchProfile(profiles, this.sim.aircraft);
      const samePage = profile && this.profile && profile.id === this.profile.id;
      this.profile = profile;
      if (!samePage || this.pageIndex >= profile.pages.length) this.pageIndex = 0;
      return this._showPage({ quiet: true });
    }
  }

  async setPage(index) {
    if (!this.profile) return;
    const n = this.profile.pages.length;
    this.pageIndex = ((index % n) + n) % n;
    await this._showPage();
  }

  // aircraft: a new aircraft was loaded (announce it, not the page). quiet: no announcement.
  async _showPage({ aircraft = false, quiet = false } = {}) {
    const gen = ++this.generation;
    this.keypad = null;
    this._unwatchAll();
    this._stopHolds();
    if (!this.profile) { this.status = 'loading'; this._clearScene(); this._sway(); return this.redrawAll(); }
    if (aircraft) this._showScene(this._aircraftScene(), this.announceAircraftMs);
    else if (this.announcePages && !quiet) this._showScene({ rows: { 1: this.page.name } }, this.announceMs);
    else this._clearScene();
    // The announcement covers any wait for input events; only without one is "loading" shown.
    const sources = this._pageSources(this.page);
    if (sources.some(s => s.input) && (!this.sim.inputs || !this.sim.inputs.size)) {
      if (!this.scene) { this.status = 'loading'; this._sway(); }
      // Input event hashes are per aircraft; list them once per aircraft.
      try { await this.sim.listInputEvents(); } catch (e) { this.log('input events unavailable', e.message); }
      if (gen !== this.generation) return;
    }
    for (const src of sources) this._watch(src, gen);
    this.status = 'ready';
    if (!this.scene) this._stopSlide();
    this.log('page', { profile: this.profile.id, page: this.page.name });
    this.redrawAll();
  }

  // Live value of every watched source: { sourceKey: value }.
  liveSources() {
    const out = {};
    for (const [k, w] of this.watches) if (w.value !== undefined) out[k] = w.value;
    return out;
  }

  // Live values of the keys on the page being shown: { slot: value }.
  liveValues() {
    const values = {};
    if (this.status !== 'ready') return values;
    for (const [slot, key] of Object.entries(this.page.keys || {})) {
      const w = key.read && this.watches.get(sourceKey(key.read));
      if (w && w.value !== undefined) values[slot] = w.value;
    }
    return values;
  }

  // The 15 images of the announcement shown when this profile's aircraft loads.
  aircraftSceneImages(profile) {
    const scene = this._aircraftScene(profile);
    return Array.from({ length: LCD_SLOTS }, (_, s) => tiles.scene(scene, s));
  }

  _aircraftScene(p = this.profile) {
    const lines = p.fallback ? ['NO PROFILE', 'GENERIC'] : (p.banner || [p.name || p.id]);
    const logo = this.renderer.icon(this.logoIcon, null);
    return { rows: { 0: lines[0], ...(lines[1] ? { 2: lines[1] } : {}) }, icons: logo ? { [LOGO_SLOT]: logo } : {} };
  }

  _statusScene(status) {
    const logo = this.renderer.icon(this.logoIcon, null);
    return { rows: STATUS_ROWS[status], icons: logo ? { [LOGO_SLOT]: logo } : {}, color: STATUS_COLOR };
  }

  // Shows a panel-wide scene for ms, then the keys.
  _showScene(scene, ms) {
    clearTimeout(this.sceneTimer);
    this.scene = scene;
    this._slide(ms);
    this.sceneTimer = setTimeout(() => {
      if (this.scene !== scene) return;
      this.scene = null;
      this._stopSlide();
      this.redrawAll();
    }, ms);
  }

  // Slides panel-wide text from left to right over ms, so the letters hidden behind the bezels
  // between keys pass into view (user, 2026-10-28). Only keys showing text are redrawn per frame.
  // With loop, it keeps sliding back and forth, each way taking ms: status screens that stay up
  // until something changes (NOT CONNECTED, loading) sway at the page banner's pace (user, 2026-10-29).
  _slide(ms, loop = false) {
    this._stopSlide();
    if (!this.animateScenes) { this.slide = 0; return this.redrawAll(); }
    const amplitude = 32; // canvas units either side; the gap between keys is 36 (was 24, user asked for a bit more)
    const start = Date.now();
    const frame = () => {
      const t = (Date.now() - start) / ms;
      const p = loop ? t % 1 : Math.min(1, t);
      const eased = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
      const forward = !loop || Math.floor(t) % 2 === 0;
      this.slide = Math.round((forward ? -1 : 1) * (-amplitude + 2 * amplitude * eased));
      this.redrawAll();
      if (!loop && p >= 1) this._stopSlide(false);
    };
    this.slideTimer = setInterval(frame, 1000 / this.sceneFps);
    if (this.slideTimer.unref) this.slideTimer.unref(); // a swaying status screen must not keep the process alive
    frame();
  }

  // Status screens: sway until the next scene or status change stops it.
  _sway() { this._slide(this.announceMs, true); }

  _stopSlide(reset = true) {
    clearInterval(this.slideTimer);
    this.slideTimer = null;
    if (reset) this.slide = 0;
  }

  _clearScene() {
    clearTimeout(this.sceneTimer);
    this._stopSlide();
    this.scene = null;
  }

  _pageSources(page) {
    const seen = new Map();
    for (const key of Object.values(page.keys || {})) {
      for (const src of keySources(key)) seen.set(sourceKey(src), src);
    }
    return [...seen.values()];
  }

  _watch(src, gen) {
    const k = sourceKey(src);
    const w = { src, value: undefined, error: null, unsub: null };
    this.watches.set(k, w);
    const update = v => {
      if (gen !== this.generation) return;
      const nv = normalise(v);
      if (w.value === nv && !w.error) return;
      w.value = nv;
      this._redrawSourceSoon(k);
    };
    try {
      if (src.sim !== undefined) {
        w.value = this.simStates[src.sim]; // kept by the plugin; changes arrive in _setSimState
      } else if (src.timer !== undefined) {
        w.value = this.dockVars.value(src); // kept by the plugin; changes arrive through dockVars
      } else if (src.input) {
        w.unsub = this.sim.subscribeInput([src.input], (n, v) => update(v));
        // Subscriptions report changes only; fetch the current value once.
        this.sim.getInput(src.input).then(update, e => { w.error = e.message; this._redrawSource(k); });
      } else {
        const type = src.unit === 'bool' ? 'bool' : src.unit === 'string' ? 'string' : 'number';
        w.unsub = this.sim.subscribe([{ name: src.var, unit: src.unit, type }], (n, v) => update(v));
      }
    } catch (e) {
      w.error = e.message;
      this.log('source unavailable', { source: k, error: e.message });
    }
  }

  _unwatchAll() {
    for (const w of this.watches.values()) if (w.unsub) w.unsub();
    this.watches.clear();
    for (const r of this.redrawTimers.values()) clearTimeout(r.timer);
    this.redrawTimers.clear();
  }

  // Simvars that change every sim frame (LOCAL TIME, RPM, altitude) would redraw their keys 30-60
  // times a second; drawing text as outlines is not free (review 2026-10-30). The first change is
  // drawn at once, later ones at most every redrawMs, and the last one is never lost.
  _redrawSourceSoon(k) {
    if (!this.redrawMs) return this._redrawSource(k);
    const r = this.redrawTimers.get(k);
    if (r) { r.pending = true; return; }
    this._redrawSource(k);
    const entry = { pending: false };
    entry.timer = setTimeout(() => {
      this.redrawTimers.delete(k);
      if (entry.pending) this._redrawSourceSoon(k);
    }, this.redrawMs);
    if (entry.timer.unref) entry.timer.unref();
    this.redrawTimers.set(k, entry);
  }

  _onException(e) {
    this.log('sim exception', e);
    // "variable X (unit)" exceptions mean a source this page uses does not exist.
    for (const [k, w] of this.watches) {
      if (w.src.var && e.about.startsWith(`variable ${w.src.var} `)) { w.error = e.name; this._redrawSource(k); }
    }
  }

  _redrawSource(k) {
    const page = this.page;
    if (!page) return;
    for (const [slot, key] of Object.entries(page.keys || {})) {
      if (keySources(key).some(src => sourceKey(src) === k)) this.redraw(Number(slot));
    }
  }

  redrawAll() {
    for (let slot = 0; slot < LCD_SLOTS; slot++) this.redraw(slot);
  }

  redraw(slot) {
    if (slot >= LCD_SLOTS) return;
    this.display.image(slot, this._image(slot));
  }

  _image(slot) {
    if (this.preview) return this._previewImage(slot);
    if (this.status === 'offline') return tiles.scene({ ...this._statusScene('offline'), offset: this.slide }, slot);
    if (this.scene) return tiles.scene({ ...this.scene, offset: this.slide }, slot);
    if (this.status === 'loading') return tiles.scene({ ...this._statusScene('loading'), offset: this.slide }, slot);
    if (this.keypad) return keypadKeyImage(this, this.keypadLayout[slot], this.keypad);
    const key = this.page.keys?.[slot];
    if (!key) return tiles.blank();
    const w = key.read ? this.watches.get(sourceKey(key.read)) : null;
    const other = src => { const o = this.watches.get(sourceKey(src)); return o ? o.value : undefined; };
    return this.keyImage(key, w ? w.value : undefined, w && w.error, other);
  }

  // Image for one key definition showing a given value. Shared with the editor's previews.
  // valueOf(src) gives the value of another source (value layers with their own source).
  // Order: a custom face for this value, a library icon for this value, the key's custom face,
  // then the automatic look.
  keyImage(key, value, error, valueOf = () => undefined) {
    key = norm(key);
    if (!key) return tiles.blank();
    if (error) return tiles.unavailable(key.label || '');
    if (key.logic) return this._logicImage(key, value, valueOf);
    // A keypad layout key outside an open keypad (the editor): shown with sample entry.
    if (key.type === 'keypad') return keypadKeyImage(this, key, { spec: kp.keypadSpec('com1'), typed: '1248', now: '121.500' });
    const valueFace = lookup(key.valueFaces, value);
    const valueIcon = valueFace ? null : this.renderer.icon(lookup(key.valueIcons, value), null);
    if (valueIcon) return valueIcon;
    const face = valueFace || key.face;
    if (face) {
      const state = value === undefined ? 'clear' : (lookup(key.states, value) || key.otherwise || 'clear');
      return this._faceImage(key, face, { value, valueOf, state, sublabel: sublabelFor(key, value), iconState: key.type === 'switch' ? state : null });
    }
    if (key.type === 'readout' || key.type === 'rotary') {
      const icon = this.renderer.icon(key.icon, key.iconState || null);
      return icon
        ? tiles.iconReadout(icon, formatValue(key, value), this.renderer.iconBox(key.icon, key.iconState || null), sublabelFor(key, value))
        : tiles.readout(key.label || '', formatValue(key, value), sublabelFor(key, value), key.separator);
    }
    // Decorative keys (user, 2026-10-30) look like a button without a press: icon, or label and sublabel.
    if (key.type === 'button' || key.type === 'decor') return this.renderer.icon(key.icon, null) || tiles.button(key.label || '', sublabelFor(key, value));
    const state = value === undefined ? 'clear' : (lookup(key.states, value) || key.otherwise || 'clear');
    return this.renderer.icon(key.icon, state) || tiles.switch(key.label || '', state, sublabelFor(key, value));
  }

  // A custom face. An icon layer without a name uses the key's own icon in iconState (its on / off
  // / clear version on switches); a value layer shows the key's value (with the key's format unless
  // the layer has its own) or, with its own source, that source's value.
  _faceImage(key, face, { value, valueOf, state, sublabel, iconState }) {
    const iconFor = name => {
      const n = name || key.icon;
      const st = name ? null : iconState;
      const uri = this.renderer.icon(n, st);
      return uri ? { uri, box: this.renderer.iconBox(n, st) } : null;
    };
    const valueFor = L => (L.read
      ? formatValue(L, valueOf(L.read))
      : formatValue({ ...key, ...pick(L, ['decimals', 'pad', 'format', 'prefix', 'suffix']) }, value));
    // A level bar fills by the number itself: the layer's own source, or the key's value.
    const numberFor = L => { const v = L.read ? valueOf(L.read) : value; return v === undefined || v === null || v === '' ? undefined : Number(v); };
    return tiles.face(face, { iconFor, valueFor, numberFor, state, sublabel: layerSublabel(sublabel, valueOf) });
  }

  // State logic: faces and sublabels per step (logicFaces: { index | 'otherwise': face }).
  _logicImage(key, value, valueOf) {
    const own = key.read ? sourceKey(key.read) : null;
    const of = src => (own && sourceKey(src) === own && value !== undefined && typeof value !== 'string' ? value : valueOf(src));
    const step = logicStep(key.logic, of, value);
    const s = step === undefined ? null : step === 'otherwise' ? (key.logic.otherwise || {}) : (key.logic.steps[step] || {});
    const state = !s ? 'clear' : s.look || (step === 'otherwise' ? 'clear' : 'on');
    const sublabel = s && s.sublabel !== undefined ? s.sublabel : key.sublabel;
    const face = (step !== undefined && key.logicFaces && key.logicFaces[step]) || key.face;
    const shown = typeof value === 'string' && /^(step \d+|otherwise|active|armed)$/.test(value) ? undefined : value;
    if (face) return this._faceImage(key, face, { value: shown, valueOf, state, sublabel, iconState: state === 'armed' ? 'clear' : state });
    if (state === 'armed') {
      const clear = this.renderer.icon(key.icon, 'clear');
      if (clear) return tiles.armedIcon(clear);
    }
    return this.renderer.icon(key.icon, state) || tiles.switch(key.label || '', state, sublabel);
  }

  _stopHolds() {
    // Never leave a shortcut held down when the page or aircraft changes.
    for (const p of this.pressing.values()) {
      if (p.kind === 'keys') { try { this.keyboard.up(p.keys); } catch (e) { /* helper gone */ } }
    }
    this.pressing.clear();
    for (const t of this.holdTimers.values()) clearInterval(t);
    this.holdTimers.clear();
  }

  keyDown(slot) {
    // A swallow left over from a press whose release never came (the dock went away) must not
    // eat this press's release (review 2026-10-30).
    this.swallowed.delete(slot);
    if (this.keypad) { this.swallowed.add(slot); return this._keypadPress(slot); }
    if (this.preview) return this._previewPress(slot);
    if (NAV[slot]) return this._nav(NAV[slot]);
    // A press while an announcement covers the keys just dismisses it: the keys were not visible.
    if (this.scene) { this.swallowed.add(slot); this._clearScene(); return this.redrawAll(); }
    const key = norm(this.status === 'ready' ? this.page.keys?.[slot] : null);
    if (!key || !key.press) return;
    const p = key.press;
    try {
      switch (pressKind(p)) {
        case 'keys': // a keyboard shortcut: tapped, or held down for as long as the key is
          if (!this.keyboard) throw new Error('no keyboard');
          if (p.whileHeld) {
            this.keyboard.down(p.keys, { focus: p.focus !== false });
            this.pressing.set(slot, { kind: 'keys', keys: p.keys });
          } else this.keyboard.tap(p.keys, { focus: p.focus !== false });
          this.log('press', { keys: p.keys });
          return;
        case 'taphold': {
          // Without a hold action a tap acts at once; with one, a tap acts when let go before
          // holdMs (default 400, the hold-to-ramp threshold proven in flight) and a hold at holdMs.
          if (p.hold === undefined) return this._runAction(slot, key, p.tap);
          this._stopHold(slot);
          const r = { kind: 'taphold', held: false };
          this.pressing.set(slot, r);
          this.holdTimers.set(slot, setTimeout(() => {
            r.held = true;
            try { this._holdAction(slot, key, p.hold); } catch (e) { this.log('press failed', { slot, error: e.message }); this.display.alert(slot); }
          }, p.holdMs ?? 400));
          return;
        }
        default:
          this._runAction(slot, key, p);
          // Some aircraft drop spring-loaded positions (e.g. START) after a moment unless the input
          // keeps arriving, like a "repeat input" binding. Re-send while the key is held.
          if (!Array.isArray(p) && typeof p.hold === 'number' && p.repeatMs) {
            this._stopHold(slot);
            this.holdTimers.set(slot, setInterval(() => {
              try { this._apply(actionTarget(key, p), p.hold, p.scale); } catch (e) { this._stopHold(slot); }
            }, p.repeatMs));
          }
      }
    } catch (e) {
      this.log('press failed', { slot, error: e.message });
      this.display.alert(slot);
    }
  }

  keyUp(slot) {
    this._stopHold(slot);
    if (this.swallowed.delete(slot)) return; // its key down did nothing, so neither does key up
    if (this.preview) return;
    const key = norm(this.status === 'ready' ? this.page?.keys?.[slot] : null);
    const pressing = this.pressing.get(slot);
    this.pressing.delete(slot);
    try {
      if (pressing && pressing.kind === 'keys') return this.keyboard.up(pressing.keys);
      if (!key || !key.press) return;
      if (pressing && pressing.kind === 'taphold') {
        if (!pressing.held && key.press.tap !== undefined) this._runAction(slot, key, key.press.tap);
        return;
      }
      if (!Array.isArray(key.press) && key.press.release !== undefined) this._act(key, key.press, 'up');
    } catch (e) {
      this.log('release failed', { slot, error: e.message });
      this.display.alert(slot);
    }
  }

  // An action, or a list of actions done in order.
  _runAction(slot, key, action) {
    if (Array.isArray(action)) { for (const a of action) this._runAction(slot, key, a); return; }
    if (action.keypad) { this._openKeypad(key, action.keypad); this.swallowed.add(slot); return; }
    if (action.keys) {
      if (!this.keyboard) throw new Error('no keyboard');
      this.keyboard.tap(action.keys, { focus: action.focus !== false });
      this.log('press', { keys: action.keys });
      return;
    }
    this._act(key, action, 'down');
  }

  // A hold action, at holdMs. With repeatMs it repeats while the key is held: a repeated step is
  // the ramp (counting from the value it last sent), anything else is simply sent again.
  _holdAction(slot, key, action) {
    if (!Array.isArray(action) && action.repeatMs) {
      if (action.step !== undefined) return this._ramp(slot, key, action);
      this.holdTimers.set(slot, setInterval(() => {
        try { this._runAction(slot, key, action); } catch (e) { this._stopHold(slot); }
      }, action.repeatMs));
    }
    this._runAction(slot, key, action);
  }

  // Holding a step key: keep stepping by the action's step every repeatMs, from the value the
  // ramp itself last sent (the sim's report lags). At min / max it stops, or with wrap turns back.
  _ramp(slot, key, a) {
    const target = actionTarget(key, a);
    const own = target && this.watches.get(sourceKey(target));
    let v = own && own.value !== undefined ? own.value : key.read ? this.watches.get(sourceKey(key.read))?.value : undefined;
    if (v === undefined || !target) return;
    let dir = Math.sign(a.step) || 1;
    const size = Math.abs(a.step) || 1;
    v = Number(v);
    const clamp = n => {
      if (a.max !== undefined && n >= a.max) { if (a.wrap) dir = -1; return a.max; }
      if (a.min !== undefined && n <= a.min) { if (a.wrap) dir = 1; return a.min; }
      return n;
    };
    const tick = () => {
      let next = clamp(v + dir * size);
      // Held at the end it is already at: with wrap, turn back at once (review 2026-10-30).
      if (next === v && a.wrap) next = clamp(v + dir * size);
      if (next === v) return this._stopHold(slot); // at a stop, nowhere to go
      v = next;
      try { this._apply(target, v, a.scale); } catch (e) { this._stopHold(slot); }
    };
    // The timer first, so a first tick that finds nowhere to go can stop it (review 2026-10-30).
    this.holdTimers.set(slot, setInterval(tick, a.repeatMs));
    tick();
  }

  // ---------- preview mode ----------
  // A profile shown on the dock without the sim (user, 2026-11-01): siloed even with the matching
  // aircraft loaded. Keys show the editor's preview values; the round buttons page; a key that
  // opens a keypad shows it; nothing reaches the sim. The sim's own state carries on underneath.

  // values: { page index: { slot: value } }; sources: { sourceKey: value } (other sources).
  startPreview({ profile, pageIndex = 0, values = {}, sources = {} }) {
    const pages = (profile && profile.pages) || [];
    if (!pages.length) throw new Error('nothing to preview');
    this._stopHolds();
    this.keypad = null;
    this.preview = { profile, pageIndex: Math.min(pageIndex, pages.length - 1), values, sources };
    this.preview.slotOf = key => Object.keys(this.preview.profile.pages[this.preview.pageIndex].keys || {}).find(s => this.preview.profile.pages[this.preview.pageIndex].keys[s] === key);
    this.log('preview', { profile: profile.id, page: this.preview.pageIndex });
    this.redrawAll();
  }

  // New preview values (the editor sends them as you edit), without restarting.
  updatePreview({ profile, pageIndex, values, sources }) {
    if (!this.preview) return;
    Object.assign(this.preview, { ...(profile ? { profile } : {}), ...(pageIndex !== undefined ? { pageIndex } : {}), ...(values ? { values } : {}), ...(sources ? { sources } : {}) });
    this.redrawAll();
  }

  stopPreview() {
    if (!this.preview) return;
    this.preview = null;
    this.keypad = null;
    this.log('preview', { stopped: true });
    this.redrawAll();
  }

  _previewPress(slot) {
    const pv = this.preview;
    const n = pv.profile.pages.length;
    if (NAV[slot]) {
      pv.pageIndex = NAV[slot] === 'main' ? 0 : ((pv.pageIndex + (NAV[slot] === 'next' ? 1 : -1)) % n + n) % n;
      return this.redrawAll();
    }
    const key = norm(pv.profile.pages[pv.pageIndex].keys?.[slot]);
    // Only a keypad shows: it is the dock's own; every other action would reach the sim.
    const keypad = key && pressActions(key.press).find(a => a.keypad);
    if (keypad) { this.swallowed.add(slot); this._openKeypad(key, keypad.keypad); }
  }

  _previewImage(slot) {
    if (this.keypad) return keypadKeyImage(this, this.keypadLayout[slot], this.keypad);
    const pv = this.preview;
    const key = pv.profile.pages[pv.pageIndex].keys?.[slot];
    if (!key) return tiles.blank();
    const v = (pv.values[pv.pageIndex] || {})[slot]; // values: { page: { slot: value } }
    return this.keyImage(key, v === '' ? undefined : v, null, src => pv.sources[sourceKey(src)]);
  }

  // ---------- keypad ----------

  _openKeypad(key, keypad) {
    const spec = kp.keypadSpec(keypad);
    const value = this.preview ? (this.preview.values[this.preview.pageIndex] || {})[this.preview.slotOf(key)] : (key.read && this.watches.get(sourceKey(key.read)) || {}).value;
    const now = value !== undefined ? formatValue(key, value) : '';
    this._stopHolds();
    this.keypad = { spec, typed: '', now };
    this.log('keypad', { title: spec.title });
    this.redrawAll();
  }

  _keypadPress(slot) {
    const k = this.keypad;
    const key = this.keypadLayout[slot];
    const role = key && key.type === 'keypad' ? key.role : null;
    if (NAV[slot] || role === 'cancel') return this._closeKeypad();
    if (kp.isVfrKey(key, k.spec)) { k.typed = k.spec.vfr; return this._enterKeypad(); }
    if (role === 'vfr') return; // a VFR key on a keypad without a VFR code
    if (role === 'del') k.typed = k.typed.slice(0, -1);
    else if (role === 'clr') k.typed = '';
    else if (role === 'ent') return k.typed ? this._enterKeypad() : this._closeKeypad();
    else if (role === 'digit') {
      k.typed = kp.typeDigit(k.spec, k.typed, String(key.digit));
      if (k.spec.autoEnter && k.typed.length === k.spec.digits) return this._enterKeypad();
    } else return;
    this.redrawAll(); // the typed digits, and which keys are dimmed
  }

  _enterKeypad() {
    const { spec, typed } = this.keypad;
    // Preview mode is siloed from the sim (user, 2026-11-01): the keypad shows, nothing is sent.
    if (!this.preview) { try { this.applyKeypad(spec, typed); } catch (e) { this.log('keypad failed', { error: e.message }); } }
    this._closeKeypad();
  }

  // Sends typed digits the way the keypad says (also the editor's "Try it"). Returns the value sent.
  applyKeypad(spec, typed) {
    const value = kp.encode(spec, typed);
    const a = spec.apply;
    this.log('keypad enter', { title: spec.title, typed, value, ...a });
    if (a.event) this.sim.send({ event: a.event, value });
    else if (a.var) this.sim.setVar({ name: a.var, unit: a.unit || 'number' }, value);
    else this.sim.setInput(a.input, value);
    return value;
  }

  _closeKeypad() {
    this.keypad = null;
    this.redrawAll();
  }

  // The 15 keypad images, for the editor's preview.
  keypadImages(keypad, typed = '', now = '') {
    const k = { spec: kp.keypadSpec(keypad), typed, now };
    return Array.from({ length: LCD_SLOTS }, (_, s) => keypadKeyImage(this, this.keypadLayout[s], k));
  }

  // The keypad layout used by every keypad (keypad.json; the built-in one when there is none).
  setKeypadLayout(keys) {
    this.keypadLayout = keys && Object.keys(keys).length ? keys : kp.DEFAULT_LAYOUT;
    if (this.keypad) this.redrawAll();
  }

  _stopHold(slot) {
    clearInterval(this.holdTimers.get(slot));
    this.holdTimers.delete(slot);
  }

  _nav(dir) {
    if (!this.profile || this.status === 'offline') return;
    if (dir === 'main') return this.setPage(0);
    return this.setPage(this.pageIndex + (dir === 'next' ? 1 : -1));
  }

  // One plain action: a stopwatch, an event, or a value set on its target (cycle, step,
  // spring-loaded hold and its release, set).
  _act(key, a, phase) {
    if (a.timer !== undefined) {
      if (phase === 'up') return;
      this.log('press', { timer: a.timer, action: a.action || 'toggle' });
      return this.dockVars.press(a.timer, a.action || 'toggle');
    }
    const target = actionTarget(key, a);
    // The value to cycle or step from: the target's own, when it is watched, else the key's.
    const own = target && this.watches.get(sourceKey(target));
    const current = own && own.value !== undefined ? own.value : key.read ? this.watches.get(sourceKey(key.read))?.value : undefined;
    let value;
    if (phase === 'up') value = a.release;
    else if (a.event) {
      value = a.toggleValue ? (current ? 0 : 1) : (a.value ?? 0);
      this.log('press', { event: a.event, value });
      return this.sim.send({ event: a.event, value });
    } else if (a.cycle) {
      value = nextInCycle(a.cycle, current);
    } else if (a.step !== undefined) {
      if (current === undefined) throw new Error('no current value to step from');
      const now = Math.round(current);
      value = now + a.step;
      if (a.min !== undefined) value = Math.max(a.min, value);
      if (a.max !== undefined) value = Math.min(a.max, value);
      if (value === now) {
        // At the stop: with wrap, go round to the other end (min and max both needed).
        if (!a.wrap || a.min === undefined || a.max === undefined) return;
        value = a.step > 0 ? a.min : a.max;
      }
    } else if (typeof a.hold === 'number') value = a.hold;
    else if (a.set !== undefined) value = a.set;
    else throw new Error('press has no action');
    this.log('press', { ...target, value, ...(a.scale !== undefined ? { sent: sendValue(value, a.scale) } : {}), phase });
    this._apply(target, value, a.scale);
  }

  // scale: what the target takes per unit of what it reports, e.g. 0.01 for a dimmer that reads
  // 0-100 but is set 0-1 (DA62 LIGHTING_PANEL_LIGHT_INTENSITY, user test 2026-11-01). Steps,
  // limits and the key's value stay in the units read.
  _apply(target, value, scale) {
    value = sendValue(value, scale);
    if (!target) throw new Error('press has nothing to act on');
    if (target.var) return this.sim.setVar({ name: target.var, unit: target.unit || 'number' }, value);
    return this.sim.setInput(target.input, value);
  }
}

function sendValue(value, scale) {
  if (scale === undefined || scale === 1 || typeof value !== 'number') return value;
  return Math.round(value * scale * 1e6) / 1e6; // 1e6: no 0.35000000000000003
}

module.exports = { ProfileEngine, formatValue, sourceKey, keySources, LCD_SLOTS };
