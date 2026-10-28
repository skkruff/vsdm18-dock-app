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

function normalise(v) {
  return typeof v === 'boolean' ? Number(v) : v;
}

// Map lookup by value: numbers are rounded so 1.0000001 finds "1".
function lookup(map, value) {
  if (!map || value === undefined) return undefined;
  return map[typeof value === 'number' ? String(Math.round(value)) : String(value)];
}

function formatValue(key, value) {
  if (value === undefined) return '---';
  const text = lookup(key.text, value);
  if (text !== undefined) return text;
  if (typeof value !== 'number') return String(value);
  const s = value.toFixed(key.decimals ?? 0);
  return key.pad ? s.padStart(key.pad, '0') : s;
}

class ProfileEngine {
  constructor({ sim, display, renderer, profiles, announcePages = true, announceMs = 800,
    announceAircraftMs = 2500, logoIcon = 'fs_logo_icon', log = () => {} }) {
    Object.assign(this, { sim, display, renderer, profiles, announcePages, announceMs, announceAircraftMs, logoIcon, log });
    this.scene = null; // panel-wide picture shown instead of the keys (aircraft or page name)
    this.sceneTimer = null;
    this.holdTimers = new Map(); // slot -> interval re-sending a held position
    this.swallowed = new Set(); // slots whose key down only dismissed an announcement
    this.status = 'offline'; // offline | loading | ready
    this.profile = null;
    this.pageIndex = 0;
    this.watches = new Map(); // sourceKey -> { src, value, error, unsub }
    this.generation = 0; // bumps on every aircraft/page change so stale async work is dropped
  }

  start() {
    this.sim.on('connected', () => { this.status = 'loading'; this.redrawAll(); });
    this.sim.on('disconnected', () => {
      this._unwatchAll();
      this._stopHolds();
      this.profile = null;
      this.status = 'offline';
      this._clearScene();
      this.redrawAll();
    });
    this.sim.on('exception', e => this._onException(e));
    this.sim.onAircraftChanged(a => this.setAircraft(a));
    this.redrawAll();
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
    if (!this.profile) { this.status = 'loading'; this._clearScene(); return this.redrawAll(); }
    if (aircraft) this._showScene(this._aircraftScene(), this.announceAircraftMs);
    else if (this.announcePages && !quiet) this._showScene({ rows: { 1: this.page.name } }, this.announceMs);
    else this._clearScene();
    // The announcement covers any wait for input events; only without one is "loading" shown.
    const sources = this._pageSources(this.page);
    if (sources.some(s => s.input) && (!this.sim.inputs || !this.sim.inputs.size)) {
      if (!this.scene) { this.status = 'loading'; this.redrawAll(); }
      // Input event hashes are per aircraft; list them once per aircraft.
      try { await this.sim.listInputEvents(); } catch (e) { this.log('input events unavailable', e.message); }
      if (gen !== this.generation) return;
    }
    for (const src of sources) this._watch(src, gen);
    this.status = 'ready';
    this.log('page', { profile: this.profile.id, page: this.page.name });
    this.redrawAll();
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
    this.redrawAll();
    this.sceneTimer = setTimeout(() => {
      if (this.scene !== scene) return;
      this.scene = null;
      this.redrawAll();
    }, ms);
  }

  _clearScene() {
    clearTimeout(this.sceneTimer);
    this.scene = null;
  }

  _pageSources(page) {
    const seen = new Map();
    for (const key of Object.values(page.keys || {})) {
      if (key.read) seen.set(sourceKey(key.read), key.read);
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
      if (key.read && sourceKey(key.read) === k) this.redraw(Number(slot));
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
    if (this.status === 'offline') return tiles.scene(this._statusScene('offline'), slot);
    if (this.scene) return tiles.scene(this.scene, slot);
    if (this.status === 'loading') return tiles.scene(this._statusScene('loading'), slot);
    const key = this.page.keys?.[slot];
    if (!key) return tiles.blank();
    const w = key.read ? this.watches.get(sourceKey(key.read)) : null;
    return this.keyImage(key, w ? w.value : undefined, w && w.error);
  }

  // Image for one key definition showing a given value. Shared with the editor's previews.
  keyImage(key, value, error) {
    if (!key) return tiles.blank();
    if (error) return tiles.unavailable(key.label || '');
    // valueIcons: a library icon per sim value, shown whole (e.g. magneto_left for 2).
    const valueIcon = this.renderer.icon(lookup(key.valueIcons, value), null);
    if (valueIcon) return valueIcon;
    if (key.type === 'readout') {
      const icon = this.renderer.icon(key.icon, key.iconState || null);
      return icon
        ? tiles.iconReadout(icon, formatValue(key, value), this.renderer.iconBox(key.icon, key.iconState || null))
        : tiles.readout(key.label || '', formatValue(key, value));
    }
    if (key.type === 'button') return this.renderer.icon(key.icon, null) || tiles.button(key.label || '');
    const state = value === undefined ? 'clear' : (lookup(key.states, value) || key.otherwise || 'clear');
    return this.renderer.icon(key.icon, state) || tiles.switch(key.label || '', state, lookup(key.text, value));
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

module.exports = { ProfileEngine, formatValue, LCD_SLOTS };
