// Aircraft profiles: one JSON file per aircraft in ../profiles. See docs/profiles.md for the format.
const fs = require('fs');
const path = require('path');
const { parseShortcut } = require('./keys');
const { keypadSpec } = require('./keypad');
const { TIMER_ACTIONS } = require('./dockvars');

const { migrateProfile } = require('./migrate');

// Key types (key editor redesign, user 2026-11-01): named after the control they stand for. The
// type sets the editor's flow; the engine draws and acts from the key's fields.
const KEY_TYPES = ['switch', 'button', 'rotary', 'readout', 'decor'];
const LOOKS = ['on', 'armed', 'off', 'clear'];

// Sim states the plugin keeps itself: paused (1 in any pause: menu, pause, active pause).
const SIM_STATES = ['paused'];
function sourceProblems(src) {
  if (!src || typeof src !== 'object') return ['is missing'];
  if (src.timer !== undefined) return src.timer ? [] : ['needs the stopwatch\'s name'];
  if (src.sim !== undefined) return SIM_STATES.includes(src.sim) ? [] : [`sim state must be one of ${SIM_STATES.join(', ')}`];
  if (src.input || src.var) return [];
  return ['needs an input event, simvar or stopwatch'];
}

// Readout state logic: { steps: [{ when: [{ read, is }], look, sublabel }], otherwise: { look, sublabel } }.
function logicProblems(logic) {
  const out = [];
  if (!Array.isArray(logic.steps)) return ['needs a list of steps'];
  logic.steps.forEach((s, i) => {
    if (!Array.isArray(s.when) || !s.when.length) out.push(`step ${i + 1} needs at least one condition`);
    for (const c of s.when || []) out.push(...sourceProblems(c.read).map(m => `step ${i + 1}: condition ${m}`));
    if (s.look !== undefined && !LOOKS.includes(s.look)) out.push(`step ${i + 1}: look must be on, armed, off or clear`);
  });
  if (logic.otherwise && logic.otherwise.look !== undefined && !LOOKS.includes(logic.otherwise.look)) out.push('otherwise: look must be on, armed, off or clear');
  return out;
}

// A press: one action, a list of actions done in order, or { tap, hold, holdMs } with each of
// those an action or a list. Spring-loaded keys keep a number in hold ({ hold: 4, release: 3 }).
function isTapHold(p) {
  return !!p && !Array.isArray(p) && (p.tap !== undefined || (p.hold !== undefined && typeof p.hold === 'object'));
}

function pressProblems(press, key) {
  if (isTapHold(press)) {
    const out = [];
    if (press.tap === undefined && press.hold === undefined) out.push('a tap / hold press needs a tap or a hold action');
    if (press.holdMs !== undefined && !(press.holdMs >= 20)) out.push('hold time must be at least 20 ms');
    if (press.tap !== undefined) out.push(...actionProblems(press.tap, key).map(m => `tap: ${m}`));
    if (press.hold !== undefined) out.push(...actionProblems(press.hold, key).map(m => `hold: ${m}`));
    return out;
  }
  return actionProblems(press, key);
}

function actionProblems(action, key) {
  if (Array.isArray(action)) return action.flatMap((a, i) => actionProblems(a, key).map(m => `action ${i + 1}: ${m}`));
  const a = action || {};
  const out = [];
  if (a.keypad !== undefined) { try { keypadSpec(a.keypad); } catch (e) { out.push(`keypad: ${e.message}`); } }
  if (a.timer !== undefined) {
    if (!a.timer) out.push('stopwatch press needs the stopwatch\'s name');
    if (a.action !== undefined && !TIMER_ACTIONS.includes(a.action)) out.push(`stopwatch action must be one of ${TIMER_ACTIONS.join(', ')}`);
  }
  if (a.keys !== undefined) { try { parseShortcut(a.keys); } catch (e) { out.push(`keyboard shortcut "${a.keys}": ${e.message}`); } }
  if (a.event !== undefined && !a.event) out.push('"Send a sim event" needs the event\'s name');
  if ((a.cycle || a.step !== undefined || typeof a.hold === 'number' || a.set !== undefined)
    && !(a.input || key.read?.input || a.var?.var)) {
    out.push('cycle/step/hold/set need something to act on: an input event (read.input or press.input) or a simvar (press.var)');
  }
  if (a.repeatMs !== undefined && !(a.repeatMs >= 20)) out.push('repeat must be at least every 20 ms');
  if (a.scale !== undefined && !(typeof a.scale === 'number' && a.scale > 0)) out.push('"sends ×" must be a number above 0');
  return out;
}
const LCD_SLOTS = 15;

// Checks a profile and returns it in the current model (old forms migrated, migrate.js).
function validate(profile, file) {
  const p = migrateProfile(profile);
  const errors = [];
  if (!p.id) errors.push('missing id');
  if (!p.fallback && !p.match) errors.push('missing match');
  if (!Array.isArray(p.pages) || !p.pages.length) errors.push('missing pages');
  // Match patterns are regular expressions: one that does not compile would stop aircraft
  // matching for every profile (review 2026-10-30).
  for (const [field, patterns] of Object.entries(p.match || {})) {
    if (!Array.isArray(patterns)) { errors.push(`match.${field} must be a list`); continue; }
    for (const re of patterns) {
      try { new RegExp(re, 'i'); } catch (e) { errors.push(`match.${field}: "${re}" is not a valid pattern (${e.message})`); }
    }
  }
  for (const [i, page] of (p.pages || []).entries()) {
    for (const [slot, key] of Object.entries(page.keys || {})) {
      const where = `page ${i + 1} slot ${slot}`;
      if (!(Number(slot) >= 0 && Number(slot) < LCD_SLOTS)) errors.push(`${where}: slot must be 0-14`);
      if (!KEY_TYPES.includes(key.type)) errors.push(`${where}: type must be one of ${KEY_TYPES.join(', ')}`);
      if (key.type === 'readout' && !key.read && !key.logic) errors.push(`${where}: a readout needs a source or state logic`);
      if (key.type === 'decor' && (key.read || key.press)) errors.push(`${where}: a decorative key has no source or press action`);
      if (key.read) errors.push(...sourceProblems(key.read).map(m => `${where}: source ${m}`));
      if (key.logic) errors.push(...logicProblems(key.logic).map(m => `${where}: state logic: ${m}`));
      const faces = [['face', key.face], ...Object.entries(key.valueFaces || {}).map(([v, f]) => [`face for value ${v}`, f]),
        ...Object.entries(key.logicFaces || {}).map(([s, f]) => [`face for state ${s}`, f])];
      for (const [name, face] of faces) {
        if (!face) continue;
        if (!Array.isArray(face.layers)) { errors.push(`${where}: ${name} needs a layers list`); continue; }
        for (const L of face.layers) {
          if (!['icon', 'text', 'value', 'sublabel', 'separator', 'bar', 'rect'].includes(L.kind)) errors.push(`${where}: ${name}: unknown layer ${L.kind}`);
          if (L.kind === 'bar' && L.look !== undefined && !LOOKS.includes(L.look)) errors.push(`${where}: ${name}: bar look must be on, armed, off or clear`);
          if ((L.kind === 'value' || L.kind === 'sublabel') && L.read) errors.push(...sourceProblems(L.read).map(m => `${where}: ${name}: ${L.kind} layer source ${m}`));
        }
      }
      if (key.press) errors.push(...pressProblems(key.press, key).map(m => `${where}: ${m}`));
    }
  }
  if (errors.length) throw new Error(`${file}: ${errors.join('; ')}`);
  return p;
}

// Returns { profiles, errors }. Profiles keep file order (alphabetical); fallbacks go last.
function loadProfiles(dir) {
  const profiles = [];
  const errors = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    try {
      profiles.push(validate(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), file));
    } catch (e) {
      errors.push(e.message);
    }
  }
  profiles.sort((a, b) => Number(!!a.fallback) - Number(!!b.fallback));
  return { profiles, errors };
}

// match: { path: [...], title: [...], atcModel: [...] }, each a list of case-insensitive regexes.
// Any hit on any field selects the profile. The first profile that matches wins.
function matchProfile(profiles, aircraft) {
  for (const p of profiles) {
    if (p.fallback) return p;
    for (const [field, patterns] of Object.entries(p.match)) {
      const value = aircraft[field];
      if (value && patterns.some(re => new RegExp(re, 'i').test(value))) return p;
    }
  }
  return null;
}

module.exports = { loadProfiles, matchProfile, validate, isTapHold, KEY_TYPES, LOOKS };
