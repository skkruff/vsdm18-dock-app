// Profile engine: picks the profile for the loaded aircraft, decides what each key shows and does,
// watches only the sources the active page needs, and redraws keys when the sim reports changes.
//
// Rule from the brief: a key shows sim state, never the last press. Presses only send commands.
//
// Slots: 0-14 are the LCD keys (top-left first), 15-17 the round buttons (page prev / main /
// next). display is { image(slot, uri), title(slot, text), alert(slot) }.
const { matchProfile } = require('./profiles');
const { tiles } = require('./render');
const { DockVars, formatDuration } = require('./dockvars');
const kp = require('./keypad');

const LCD_SLOTS = 15;
const NAV = { 15: 'prev', 16: 'main', 17: 'next' };
const STATUS_ROWS = { offline: { 0: 'MSFS', 2: 'NOT CONNECTED' }, loading: { 0: 'MSFS', 2: 'LOADING' } };
const STATUS_COLOR = '#9aa0a8';
const LOGO_SLOT = 7;

function sourceKey(src) {
  if (src.timer !== undefined) return `timer:${src.timer}:${src.part || 'elapsed'}`;
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
  // A press that writes a simvar watches it too, so cycle and step know its current value.
  if (key.press && key.press.var && key.press.var.var) out.push(key.press.var);
  const faces = [key.face, ...Object.values(key.valueFaces || {})].filter(Boolean);
  for (const f of faces) for (const L of f.layers || []) if ((L.kind === 'value' || L.kind === 'sublabel') && L.read) out.push(L.read);
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
// One key of the keypad layout (keypad.js), for an open keypad k = { spec, typed, now }. Keys
// without a face or icon get the built-in look for their role; a label replaces a fixed role's
// word, a face's live value layers show the role's text. Keys that do nothing now are dimmed.
function keypadKeyImage(engine, key, k) {
  if (!key) return tiles.blank();
  if (key.type !== 'keypad') return engine.keyImage(key);
  const { spec, typed, now } = k;
  const role = key.role;
  const d = String(key.digit);
  const enabled = role === 'digit' ? !(spec.octal && Number(d) > 7) && typed.length < spec.digits
    : ['ent', 'del', 'clr'].includes(role) ? !!typed : true;
  const nowText = now ? `now ${now}` : '';
  const text = role === 'digit' ? d : role === 'title' ? (spec.title || 'ENTER') : role === 'now' ? now
    : role === 'typed' ? kp.display(spec, typed) : (key.label || kp.ROLE_TEXT[role] || '');
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

// What cycle / step / hold / set change: press.var (a simvar, user 2026-10-30), press.input, or
// the key's own input event. A simvar is never written unless named in press.var.
function pressTarget(key) {
  const p = key.press || {};
  if (p.var && p.var.var) return p.var;
  const input = p.input || (key.read && key.read.input);
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
    announceAircraftMs = 2500, logoIcon = 'fs_logo_icon', animateScenes = true, sceneFps = 10, keyboard = null, dockVars = null, log = () => {} }) {
    Object.assign(this, { sim, display, renderer, profiles, announcePages, announceMs, announceAircraftMs, logoIcon, animateScenes, sceneFps, keyboard, log });
    this.dockVars = dockVars || new DockVars();
    this.keypad = null; // { spec, typed, now } while a keypad covers the dock
    this.keypadLayout = kp.DEFAULT_LAYOUT;
    this.scene = null; // panel-wide picture shown instead of the keys (aircraft or page name)
    this.sceneTimer = null;
    this.slide = 0; // sideways offset of panel-wide text, animated (see _slide)
    this.slideTimer = null;
    this.holdTimers = new Map(); // slot -> interval re-sending a held position
    this.ramps = new Map(); // slot -> { ramping } while a step key with a ramp is held
    this.heldKeys = new Map(); // slot -> shortcut held down while the dock key is
    this.swallowed = new Set(); // slots whose key down only dismissed an announcement
    this.status = 'offline'; // offline | loading | ready
    this.profile = null;
    this.pageIndex = 0;
    this.watches = new Map(); // sourceKey -> { src, value, error, unsub }
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
      this.keypad = null;
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
      w.value = normalise(v);
      this._redrawSource(k);
    };
    try {
      if (src.timer !== undefined) {
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
    if (!key) return tiles.blank();
    if (error) return tiles.unavailable(key.label || '');
    if (key.type === 'armable') return this._armableImage(key, value, valueOf);
    // A keypad layout key outside an open keypad (the editor): shown with sample entry.
    if (key.type === 'keypad') return keypadKeyImage(this, key, { spec: kp.keypadSpec('com1'), typed: '1248', now: '121.500' });
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
        : formatValue({ ...key, ...pick(L, ['decimals', 'pad', 'format', 'prefix', 'suffix']) }, value));
      return tiles.face(face, { iconFor, valueFor, state, sublabel: layerSublabel(sublabelFor(key, value), valueOf) });
    }
    if (key.type === 'readout') {
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
      const valueFor = L => formatValue(L.read ? L : { ...key, ...pick(L, ['decimals', 'pad', 'format', 'prefix', 'suffix']) }, L.read ? valueOf(L.read) : value);
      return tiles.face(face, { iconFor, valueFor, state, sublabel: layerSublabel(sublabel, valueOf) });
    }
    if (state === 'armed') {
      const clear = this.renderer.icon(key.icon, 'clear');
      if (clear) return tiles.armedIcon(clear);
    }
    return this.renderer.icon(key.icon, state) || tiles.switch(key.label || '', state, sublabel);
  }

  _stopHolds() {
    this.ramps.clear();
    // Never leave a shortcut held down when the page or aircraft changes.
    for (const keys of this.heldKeys.values()) { try { this.keyboard.up(keys); } catch (e) { /* helper gone */ } }
    this.heldKeys.clear();
    for (const t of this.holdTimers.values()) clearInterval(t);
    this.holdTimers.clear();
  }

  keyDown(slot) {
    if (this.keypad) { this.swallowed.add(slot); return this._keypadPress(slot); }
    if (NAV[slot]) return this._nav(NAV[slot]);
    // A press while an announcement covers the keys just dismisses it: the keys were not visible.
    if (this.scene) { this.swallowed.add(slot); this._clearScene(); return this.redrawAll(); }
    const key = this.status === 'ready' ? this.page.keys?.[slot] : null;
    if (!key || !key.press) return;
    if (key.press.keypad) {
      try { this._openKeypad(key); this.swallowed.add(slot); } catch (e) { this.log('press failed', { slot, error: e.message }); this.display.alert(slot); }
      return;
    }
    // A keyboard shortcut (user, 2026-10-30): tapped, or held down for as long as the key is.
    if (key.press.keys) {
      try {
        if (!this.keyboard) throw new Error('no keyboard');
        if (key.press.whileHeld) { this.keyboard.down(key.press.keys, { focus: key.press.focus !== false }); this.heldKeys.set(slot, key.press.keys); }
        else this.keyboard.tap(key.press.keys, { focus: key.press.focus !== false });
        this.log('press', { keys: key.press.keys });
      } catch (e) {
        this.log('press failed', { slot, error: e.message });
        this.display.alert(slot);
      }
      return;
    }
    // Step with ramp (user, 2026-10-30): a tap steps (on release), holding past rampDelayMs ramps.
    if (key.press.step !== undefined && key.press.rampMs) {
      this._stopHold(slot);
      const r = { ramping: false };
      this.ramps.set(slot, r);
      this.holdTimers.set(slot, setTimeout(() => this._ramp(slot, key, r), key.press.rampDelayMs ?? 400));
      return;
    }
    try {
      this._press(key, 'down');
      // Some aircraft drop spring-loaded positions (e.g. START) after a moment unless the input
      // keeps arriving, like a "repeat input" binding. Re-send while the key is held.
      if (key.press.hold !== undefined && key.press.repeatMs) {
        clearInterval(this.holdTimers.get(slot));
        this.holdTimers.set(slot, setInterval(() => {
          try { this._apply(pressTarget(key), key.press.hold); } catch (e) { this._stopHold(slot); }
        }, key.press.repeatMs));
      }
    } catch (e) {
      this.log('press failed', { slot, error: e.message });
      this.display.alert(slot);
    }
  }

  // Holding a step key: keep stepping by rampStep (default step) every rampMs, from the value the
  // ramp itself last sent (the sim's report lags). At min / max it stops, or with wrap turns back.
  _ramp(slot, key, r) {
    const p = key.press;
    const target = pressTarget(key);
    const own = target && this.watches.get(sourceKey(target));
    let v = own && own.value !== undefined ? own.value : key.read ? this.watches.get(sourceKey(key.read))?.value : undefined;
    if (v === undefined || !target) return;
    r.ramping = true;
    let dir = Math.sign(p.step) || 1;
    const size = Math.abs(p.rampStep ?? p.step) || 1;
    v = Number(v);
    const tick = () => {
      let next = v + dir * size;
      if (p.max !== undefined && next >= p.max) { next = p.max; if (p.wrap) dir = -1; }
      if (p.min !== undefined && next <= p.min) { next = p.min; if (p.wrap) dir = 1; }
      if (next === v) return this._stopHold(slot); // at a stop, nowhere to go
      v = next;
      try { this._apply(target, v); } catch (e) { this._stopHold(slot); }
    };
    tick();
    this.holdTimers.set(slot, setInterval(tick, p.rampMs));
  }

  // ---------- keypad ----------

  _openKeypad(key) {
    const spec = kp.keypadSpec(key.press.keypad);
    const w = key.read && this.watches.get(sourceKey(key.read));
    const now = w && w.value !== undefined ? formatValue(key, w.value) : '';
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
    try { this.applyKeypad(spec, typed); } catch (e) { this.log('keypad failed', { error: e.message }); }
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

  keyUp(slot) {
    this._stopHold(slot);
    if (this.swallowed.delete(slot)) return; // its key down did nothing, so neither does key up
    const key = this.status === 'ready' ? this.page?.keys?.[slot] : null;
    const held = this.heldKeys.get(slot);
    if (held) {
      this.heldKeys.delete(slot);
      try { this.keyboard.up(held); } catch (e) { this.log('release failed', { slot, error: e.message }); }
      return;
    }
    const ramp = this.ramps.get(slot);
    this.ramps.delete(slot);
    if (ramp && key) {
      if (ramp.ramping) return; // the hold ramped; letting go just stops it
      try { this._press(key, 'down'); } catch (e) { this.log('press failed', { slot, error: e.message }); this.display.alert(slot); }
      return;
    }
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
    if (p.timer !== undefined) {
      if (phase === 'up') return;
      this.log('press', { timer: p.timer, action: p.action || 'toggle' });
      return this.dockVars.press(p.timer, p.action || 'toggle');
    }
    const target = pressTarget(key);
    // The value to cycle or step from: the target's own, when it is watched, else the key's.
    const own = target && this.watches.get(sourceKey(target));
    const current = own && own.value !== undefined ? own.value : key.read ? this.watches.get(sourceKey(key.read))?.value : undefined;
    let value;
    if (phase === 'up') value = p.release;
    else if (p.event) {
      value = p.toggleValue ? (current ? 0 : 1) : (p.value ?? 0);
      this.log('press', { event: p.event, value });
      return this.sim.send({ event: p.event, value });
    } else if (p.cycle) {
      value = nextInCycle(p.cycle, current);
    } else if (p.step !== undefined) {
      if (current === undefined) throw new Error('no current value to step from');
      const now = Math.round(current);
      value = now + p.step;
      if (p.min !== undefined) value = Math.max(p.min, value);
      if (p.max !== undefined) value = Math.min(p.max, value);
      if (value === now) {
        // At the stop: with wrap, go round to the other end (min and max both needed).
        if (!p.wrap || p.min === undefined || p.max === undefined) return;
        value = p.step > 0 ? p.min : p.max;
      }
    } else if (p.hold !== undefined) value = p.hold;
    else if (p.set !== undefined) value = p.set;
    else throw new Error('press has no action');
    this.log('press', { ...target, value, phase });
    this._apply(target, value);
  }

  _apply(target, value) {
    if (!target) throw new Error('press has nothing to act on');
    if (target.var) return this.sim.setVar({ name: target.var, unit: target.unit || 'number' }, value);
    return this.sim.setInput(target.input, value);
  }
}

module.exports = { ProfileEngine, formatValue, sourceKey, keySources, LCD_SLOTS };
