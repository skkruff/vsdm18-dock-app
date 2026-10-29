// Aircraft profiles: one JSON file per aircraft in ../profiles. See docs/profiles.md for the format.
const fs = require('fs');
const path = require('path');

const KEY_TYPES = ['switch', 'armable', 'button', 'readout'];
const LCD_SLOTS = 15;

function validate(p, file) {
  const errors = [];
  if (!p.id) errors.push('missing id');
  if (!p.fallback && !p.match) errors.push('missing match');
  if (!Array.isArray(p.pages) || !p.pages.length) errors.push('missing pages');
  for (const [i, page] of (p.pages || []).entries()) {
    for (const [slot, key] of Object.entries(page.keys || {})) {
      const where = `page ${i + 1} slot ${slot}`;
      if (!(Number(slot) >= 0 && Number(slot) < LCD_SLOTS)) errors.push(`${where}: slot must be 0-14`);
      if (!KEY_TYPES.includes(key.type)) errors.push(`${where}: type must be one of ${KEY_TYPES.join(', ')}`);
      if (key.type !== 'button' && !key.read) errors.push(`${where}: ${key.type} needs read`);
      if (key.type === 'armable' && !(key.armed && (key.armed.input || key.armed.var))) errors.push(`${where}: armable needs an armed source`);
      for (const [name, face] of [['face', key.face], ...Object.entries(key.valueFaces || {}).map(([v, f]) => [`face for value ${v}`, f])]) {
        if (!face) continue;
        if (!Array.isArray(face.layers)) { errors.push(`${where}: ${name} needs a layers list`); continue; }
        for (const L of face.layers) {
          if (!['icon', 'text', 'value', 'bar', 'rect'].includes(L.kind)) errors.push(`${where}: ${name}: unknown layer ${L.kind}`);
          if (L.kind === 'value' && L.read && !L.read.input && !L.read.var) errors.push(`${where}: ${name}: value layer source needs an input event or simvar`);
        }
      }
      const press = key.press;
      if (press && (press.cycle || press.step !== undefined || press.hold !== undefined || press.set !== undefined)
        && !(press.input || key.read?.input)) {
        errors.push(`${where}: cycle/step/hold/set need an input event (read.input or press.input)`);
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
