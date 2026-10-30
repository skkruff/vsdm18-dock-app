// Dock variables (user, 2026-10-30): values the plugin keeps itself rather than reading from the
// sim. Keys read them like a simvar and presses change them. So far: stopwatches.
//
// A stopwatch counts sim time (SIMULATION TIME), so it runs faster at higher sim rates, and stands
// still while the sim reports any pause (Pause_EX1: menu, pause key, active pause), since
// SIMULATION TIME itself keeps running in active pause (user test, 2026-10-30). Its state is saved (dock-state.json next to the profiles folder),
// so it survives a plugin or VSD Craft restart: a running stopwatch carries on from where it was
// saved once the sim's clock moves again (time while the plugin was not running is not counted).
//
// Sources: { timer: 'T1' } elapsed whole seconds; { timer: 'T1', part: 'running' } 1 or 0.
// Presses: { timer: 'T1', action: 'toggle' | 'start' | 'stop' | 'reset' }.
const { EventEmitter } = require('events');

const TIMER_ACTIONS = ['toggle', 'start', 'stop', 'reset'];
// The longest step of sim time counted at once: longer jumps are a new flight, a time change or a
// reconnect, not time on the stopwatch. Allows for sim rates up to 16x at a few updates a second.
const MAX_STEP_S = 60;

class DockVars extends EventEmitter {
  constructor({ load = () => ({}), save = () => {}, saveEveryMs = 5000, now = () => Date.now(), log = () => {} } = {}) {
    super();
    Object.assign(this, { save, saveEveryMs, now, log });
    const saved = load() || {};
    this.timers = new Map();
    for (const [name, t] of Object.entries(saved.timers || {})) {
      this.timers.set(name, { running: !!t.running, elapsed: Number(t.elapsed) || 0 });
    }
    this.lastSim = undefined;
    this.lastSave = 0;
    this.paused = false;
  }

  // The sim's pause state (any pause, active pause included): stopwatches stand still meanwhile.
  setPaused(paused) {
    this.paused = !!paused;
  }

  _timer(name) {
    if (!this.timers.has(name)) this.timers.set(name, { running: false, elapsed: 0 });
    return this.timers.get(name);
  }

  // The value a key shows: whole seconds, or running as 1 / 0.
  value(src) {
    const t = this.timers.get(src.timer) || { running: false, elapsed: 0 };
    return src.part === 'running' ? (t.running ? 1 : 0) : Math.floor(t.elapsed);
  }

  press(name, action = 'toggle') {
    if (!TIMER_ACTIONS.includes(action)) throw new Error(`unknown stopwatch action ${action}`);
    const t = this._timer(name);
    if (action === 'toggle') t.running = !t.running;
    else if (action === 'start') t.running = true;
    else if (action === 'stop') t.running = false;
    else t.elapsed = 0;
    this._persist(true);
    this.emit('change', name);
  }

  // Each SIMULATION TIME report moves running stopwatches on by the sim time that passed.
  simTime(seconds) {
    const prev = this.lastSim;
    this.lastSim = seconds;
    if (prev === undefined) return;
    const d = seconds - prev;
    if (this.paused || !(d > 0 && d <= MAX_STEP_S)) return;
    let moved = false;
    for (const [name, t] of this.timers) {
      if (!t.running) continue;
      const before = Math.floor(t.elapsed);
      t.elapsed += d;
      moved = true;
      if (Math.floor(t.elapsed) !== before) this.emit('change', name);
    }
    if (moved) this._persist(false);
  }

  // The sim went away: the next report starts a fresh count instead of a jump.
  simGone() {
    this.lastSim = undefined;
    this.paused = false;
    this._persist(true);
  }

  _persist(force) {
    const t = this.now();
    if (!force && t - this.lastSave < this.saveEveryMs) return;
    this.lastSave = t;
    const timers = {};
    for (const [name, v] of this.timers) timers[name] = { running: v.running, elapsed: Math.round(v.elapsed * 10) / 10 };
    try { this.save({ timers }); } catch (e) { this.log('dock state not saved', e.message); }
  }
}

// Elapsed seconds as M:SS, or H:MM:SS from an hour on.
function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

module.exports = { DockVars, formatDuration, TIMER_ACTIONS };
