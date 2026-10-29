// Profile engine: picks the profile for the loaded aircraft, decides what each key shows and does,
// watches only the sources the active page needs, and redraws keys when the sim reports changes.
//
// Rule from the brief: a key shows sim state, never the last press. Presses only send commands.
//
// Slots: 0-14 are the LCD keys (top-left first), 15-17 the round buttons (page prev / main /
// next). display is { image(slot, uri), title(slot, text), alert(slot) }.
const { matchProfile } = require('./profiles');
const { tiles } = require('./render');

const LCD_SLOTS = 15;
const NAV = { 15: 'prev', 16: 'main', 17: 'next' };
const STATUS_ROWS = { offline: { 0: 'MSFS', 2: 'NOT CONNECTED' }, loading: { 0: 'MSFS', 2: 'LOADING' } };
const STATUS_COLOR = '#9aa0a8';
const LOGO_SLOT = 7;

function sourceKey(src) {
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
  const out = key.read ? [key.read] : [];
  if (key.type === 'armable' && key.armed) out.push(key.armed);
  if (key.type === 'armable') out.push(...armableOrSources(key));
  const faces = [key.face, ...Object.values(key.valueFaces || {})].filter(Boolean);
  for (const f of faces) for (const L of f.layers || []) if (L.kind === 'value' && L.read) out.push(L.read);
  return out;
}

// Armable keys (user, 2026-10-29): a fixed ladder, checked top to bottom.
//   active when read is activeIs (default 1), else armed when armed is armedIs (default 1), else
//   otherwise. Unknown active value: clear, like any switch before the sim answers.
//   activeOr / armedOr: more sources for a step, any one of which is enough, e.g. ILS capture or
//   GPS approach active: [{ read: { var, unit }, is }] (is defaults to 1).
// Returns 'active' | 'armed' | 'otherwise' | undefined.
function armableStep(key, active, armed, valueOf = () => undefined) {
  const any = (main, is, more) => (main !== undefined && same(main, is ?? 1))
    || (more || []).some(o => o.read && same(valueOf(o.read), o.is ?? 1));
  if (active === undefined && !(key.activeOr || []).some(o => o.read && valueOf(o.read) !== undefined)) return undefined;
  if (any(active, key.activeIs, key.activeOr)) return 'active';
  if (any(armed, key.armedIs, key.armedOr)) return 'armed';
  return 'otherwise';
}
function armableOrSources(key) {
  return [...(key.activeOr || []), ...(key.armedOr || [])].map(o => o.read).filter(Boolean);
}
const same = (a, b) => String(a) === String(b);
const ARMABLE_STATE = { active: 'on', armed: 'armed' };
const ARMABLE_STEPS = ['active', 'armed', 'otherwise'];
function armableState(key, step) {
  return step === undefined ? 'clear' : ARMABLE_STATE[step] || key.otherwise || 'clear';
}

// Sublabel: per-value text if there is one for this value, else the fixed sublabel. Switches made
// before sublabels existed kept theirs in `text` ("word under the label"), still honoured.
function sublabelFor(key, value) {
  const perValue = lookup(key.sublabels || (key.type === 'switch' ? key.text : null), value);
  return perValue !== undefined ? perValue : key.sublabel;
}

function formatValue(key, value) {
  if (value === undefined) return '---';
  const text = lookup(key.text, value);
  if (text !== undefined) return text;
  if (typeof value !== 'number') return String(value);
  if (key.format === 'time') {
    // Seconds since midnight (LOCAL TIME, ZULU TIME) as HH:MM.
    const m = Math.floor(value / 60) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  const s = value.toFixed(key.decimals ?? 0);
  return key.pad ? s.padStart(key.pad, '0') : s;
}

class ProfileEngine {
  constructor({ sim, display, renderer, profiles, announcePages = true, announceMs = 800,
    announceAircraftMs = 2500, logoIcon = 'fs_logo_icon', animateScenes = true, sceneFps = 10, log = () => {} }) {
    Object.assign(this, { sim, display, renderer, profiles, announcePages, announceMs, announceAircraftMs, logoIcon, animateScenes, sceneFps, log });
    this.scene = null; // panel-wide picture shown instead of the keys (aircraft or page name)
    this.sceneTimer = null;
    this.slide = 0; // sideways offset of panel-wide text, animated (see _slide)
    this.slideTimer = null;
    this.holdTimers = new Map(); // slot -> interval re-sending a held position
    this.swallowed = new Set(); // slots whose key down only dismissed an announcement
    this.status = 'offline'; // offline | loading | ready
    this.profile = null;
    this.pageIndex = 0;
    this.watches = new Map(); // sourceKey -> { src, value, error, unsub }
    this.generation = 0; // bumps on every aircraft/page change so stale async work is dropped
  }

  start() {
    this.sim.on('connected', () => { this.status = 'loading'; this._sway(); });
    this.sim.on('disconnected', () => {
      this._unwatchAll();
      this._stopHolds();
      this.profile = null;
      this.status = 'offline';
      this._clearScene();
      this._sway();
    });
    this.sim.on('exception', e => this._onException(e));
    this.sim.onAircraftChanged(a => this.setAircraft(a));
    this._sway();
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
      w.value = normalise(v);
      this._redrawSource(k);
    };
    try {
      if (src.input) {
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
    if (this.status === 'offline') return tiles.scene({ ...this._statusScene('offline'), offset: this.slide }, slot);
    if (this.scene) return tiles.scene({ ...this.scene, offset: this.slide }, slot);
    if (this.status === 'loading') return tiles.scene({ ...this._statusScene('loading'), offset: this.slide }, slot);
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
    if (!key) return tiles.blank();
    if (error) return tiles.unavailable(key.label || '');
    if (key.type === 'armable') return this._armableImage(key, value, valueOf);
    const valueFace = lookup(key.valueFaces, value);
    const valueIcon = valueFace ? null : this.renderer.icon(lookup(key.valueIcons, value), null);
    if (valueIcon) return valueIcon;
    const face = valueFace || key.face;
    if (face) {
      const state = value === undefined ? 'clear' : (lookup(key.states, value) || key.otherwise || 'clear');
      // An icon layer without a name uses the key's own icon (its on/off/clear version on switches).
      const iconFor = name => {
        const n = name || key.icon;
        const st = !name && key.type === 'switch' ? state : null;
        const uri = this.renderer.icon(n, st);
        return uri ? { uri, box: this.renderer.iconBox(n, st) } : null;
      };
      const valueFor = L => (L.read
        ? formatValue(L, valueOf(L.read))
        : formatValue({ ...key, ...pick(L, ['decimals', 'pad', 'format']) }, value));
      return tiles.face(face, { iconFor, valueFor, state, sublabel: sublabelFor(key, value) });
    }
    if (key.type === 'readout') {
      const icon = this.renderer.icon(key.icon, key.iconState || null);
      return icon
        ? tiles.iconReadout(icon, formatValue(key, value), this.renderer.iconBox(key.icon, key.iconState || null), sublabelFor(key, value))
        : tiles.readout(key.label || '', formatValue(key, value), sublabelFor(key, value));
    }
    if (key.type === 'button') return this.renderer.icon(key.icon, null) || tiles.button(key.label || '', sublabelFor(key, value));
    const state = value === undefined ? 'clear' : (lookup(key.states, value) || key.otherwise || 'clear');
    return this.renderer.icon(key.icon, state) || tiles.switch(key.label || '', state, sublabelFor(key, value));
  }

  // Armable: faces and sublabels are per step (active / armed / otherwise), not per sim value.
  _armableImage(key, value, valueOf) {
    // The editor previews a step by name; sim values are numbers.
    const step = ARMABLE_STEPS.includes(value) ? value : armableStep(key, value, key.armed ? valueOf(key.armed) : undefined, valueOf);
    const state = armableState(key, step);
    const face = (step && key.valueFaces && key.valueFaces[step]) || key.face;
    const sublabel = step && key.sublabels && key.sublabels[step] !== undefined ? key.sublabels[step] : key.sublabel;
    if (face) {
      const iconFor = name => {
        const n = name || key.icon;
        const st = !name ? (state === 'armed' ? 'clear' : state) : null;
        const uri = this.renderer.icon(n, st);
        return uri ? { uri, box: this.renderer.iconBox(n, st) } : null;
      };
      const valueFor = L => formatValue(L.read ? L : { ...key, ...pick(L, ['decimals', 'pad', 'format']) }, L.read ? valueOf(L.read) : value);
      return tiles.face(face, { iconFor, valueFor, state, sublabel });
    }
    if (state === 'armed') {
      const clear = this.renderer.icon(key.icon, 'clear');
      if (clear) return tiles.armedIcon(clear);
    }
    return this.renderer.icon(key.icon, state) || tiles.switch(key.label || '', state, sublabel);
  }

  _stopHolds() {
    for (const t of this.holdTimers.values()) clearInterval(t);
    this.holdTimers.clear();
  }

  keyDown(slot) {
    if (NAV[slot]) return this._nav(NAV[slot]);
    // A press while an announcement covers the keys just dismisses it: the keys were not visible.
    if (this.scene) { this.swallowed.add(slot); this._clearScene(); return this.redrawAll(); }
    const key = this.status === 'ready' ? this.page.keys?.[slot] : null;
    if (!key || !key.press) return;
    try {
      this._press(key, 'down');
      // Some aircraft drop spring-loaded positions (e.g. START) after a moment unless the input
      // keeps arriving, like a "repeat input" binding. Re-send while the key is held.
      if (key.press.hold !== undefined && key.press.repeatMs) {
        clearInterval(this.holdTimers.get(slot));
        this.holdTimers.set(slot, setInterval(() => {
          try { this.sim.setInput(key.press.input || key.read.input, key.press.hold); } catch (e) { this._stopHold(slot); }
        }, key.press.repeatMs));
      }
    } catch (e) {
      this.log('press failed', { slot, error: e.message });
      this.display.alert(slot);
    }
  }

  _stopHold(slot) {
    clearInterval(this.holdTimers.get(slot));
    this.holdTimers.delete(slot);
  }

  keyUp(slot) {
    this._stopHold(slot);
    if (this.swallowed.delete(slot)) return; // its key down did nothing, so neither does key up
    const key = this.status === 'ready' ? this.page?.keys?.[slot] : null;
    if (!key || !key.press || key.press.release === undefined) return;
    try { this._press(key, 'up'); } catch (e) { this.log('release failed', { slot, error: e.message }); }
  }

  _nav(dir) {
    if (!this.profile || this.status === 'offline') return;
    if (dir === 'main') return this.setPage(0);
    return this.setPage(this.pageIndex + (dir === 'next' ? 1 : -1));
  }

  _press(key, phase) {
    const p = key.press;
    const target = p.input || key.read?.input;
    const current = key.read ? this.watches.get(sourceKey(key.read))?.value : undefined;
    let value;
    if (phase === 'up') value = p.release;
    else if (p.event) {
      value = p.toggleValue ? (current ? 0 : 1) : (p.value ?? 0);
      this.log('press', { event: p.event, value });
      return this.sim.send({ event: p.event, value });
    } else if (p.cycle) {
      const i = p.cycle.findIndex(v => v === Math.round(current));
      value = p.cycle[(i + 1) % p.cycle.length];
    } else if (p.step !== undefined) {
      if (current === undefined) throw new Error('no current value to step from');
      value = Math.round(current) + p.step;
      if (p.min !== undefined) value = Math.max(p.min, value);
      if (p.max !== undefined) value = Math.min(p.max, value);
      if (value === Math.round(current)) return; // at the stop
    } else if (p.hold !== undefined) value = p.hold;
    else if (p.set !== undefined) value = p.set;
    else throw new Error('press has no action');
    this.log('press', { input: target, value, phase });
    this.sim.setInput(target, value);
  }
}

module.exports = { ProfileEngine, formatValue, sourceKey, keySources, LCD_SLOTS };
