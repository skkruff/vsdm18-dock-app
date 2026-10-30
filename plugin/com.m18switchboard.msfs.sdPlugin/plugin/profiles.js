// Aircraft profiles: one JSON file per aircraft in ../profiles. See docs/profiles.md for the format.
const fs = require('fs');
const path = require('path');
const { parseShortcut } = require('./keys');
const { keypadSpec } = require('./keypad');
const { TIMER_ACTIONS } = require('./dockvars');

const KEY_TYPES = ['switch', 'armable', 'button', 'readout', 'decor'];
const LCD_SLOTS = 15;

function validate(p, file) {
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
      if (key.type !== 'button' && key.type !== 'decor' && !key.read) errors.push(`${where}: ${key.type} needs read`);
      if (key.type === 'decor' && (key.read || key.press)) errors.push(`${where}: a decorative key has no source or press action`);
      if (key.type === 'armable' && !(key.armed && (key.armed.input || key.armed.var))) errors.push(`${where}: armable needs an armed source`);
      for (const k of ['activeOr', 'armedOr']) {
        for (const o of key[k] || []) if (!(o.read && (o.read.input || o.read.var))) errors.push(`${where}: an "or" source in ${k} is empty`);
      }
      for (const [name, face] of [['face', key.face], ...Object.entries(key.valueFaces || {}).map(([v, f]) => [`face for value ${v}`, f])]) {
        if (!face) continue;
        if (!Array.isArray(face.layers)) { errors.push(`${where}: ${name} needs a layers list`); continue; }
        for (const L of face.layers) {
          if (!['icon', 'text', 'value', 'sublabel', 'separator', 'bar', 'rect'].includes(L.kind)) errors.push(`${where}: ${name}: unknown layer ${L.kind}`);
          if (L.kind === 'bar' && L.look !== undefined && !['on', 'armed', 'off', 'clear'].includes(L.look)) errors.push(`${where}: ${name}: bar look must be on, armed, off or clear`);
          if ((L.kind === 'value' || L.kind === 'sublabel') && L.read && !L.read.input && !L.read.var && !L.read.timer) errors.push(`${where}: ${name}: ${L.kind} layer source needs an input event or simvar`);
        }
      }
      const press = key.press;
      if (press && press.keypad !== undefined) {
        try { keypadSpec(press.keypad); } catch (e) { errors.push(`${where}: keypad: ${e.message}`); }
      }
      if (press && press.timer !== undefined) {
        if (!press.timer) errors.push(`${where}: stopwatch press needs the stopwatch's name`);
        if (press.holdReset && (press.action || 'toggle') !== 'toggle') errors.push(`${where}: hold to reset goes with start / stop (action toggle)`);
        if (press.action !== undefined && !TIMER_ACTIONS.includes(press.action)) errors.push(`${where}: stopwatch action must be one of ${TIMER_ACTIONS.join(', ')}`);
      }
      if (key.read && key.read.timer === '') errors.push(`${where}: stopwatch source needs a name`);
      if (press && press.keys !== undefined) {
        try { parseShortcut(press.keys); } catch (e) { errors.push(`${where}: keyboard shortcut "${press.keys}": ${e.message}`); }
      }
      if (press && press.event !== undefined && !press.event) errors.push(`${where}: "Send a sim event" needs the event's name`);
      if (press && (press.cycle || press.step !== undefined || press.hold !== undefined || press.set !== undefined)
        && !(press.input || key.read?.input || press.var?.var)) {
        errors.push(`${where}: cycle/step/hold/set need something to act on: an input event (read.input or press.input) or a simvar (press.var)`);
      }
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

module.exports = { loadProfiles, matchProfile, validate };
