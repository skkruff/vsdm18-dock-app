// Icon library lookup. Library files are named <base>[_<state>]_<theme>.png, for example
//   landing_light_on_RGB.png, alt_hold_clear_B_C18.png, anti_ice_RGB_white.png
// Themes and states are matched as suffixes because base names contain underscores.
const fs = require('fs');
const path = require('path');

const THEMES = ['RGB_white', 'B_C18', 'RGB']; // longest first so RGB_white is not read as RGB
const STATES = ['on', 'off', 'clear'];

function parseName(file) {
  const m = /^(.*)\.png$/i.exec(file);
  if (!m) return null;
  let stem = m[1];
  const theme = THEMES.find(t => stem.endsWith('_' + t));
  if (!theme) return null;
  stem = stem.slice(0, -(theme.length + 1));
  const state = STATES.find(s => stem.endsWith('_' + s)) || null;
  const base = state ? stem.slice(0, -(state.length + 1)) : stem;
  return { base, state, theme, file };
}

class IconLibrary {
  constructor(dir, theme) {
    this.dir = dir;
    this.theme = theme;
    this.files = new Set();
    this.cache = new Map(); // filename -> data URI
  }

  // Lists the folder once; call again to pick up new files.
  scan() {
    this.files = new Set(fs.existsSync(this.dir) ? fs.readdirSync(this.dir) : []);
    this.cache.clear();
    return this.files.size;
  }

  // Filename for an icon base and state in the configured theme, or null if not in the library.
  // state may be null for stateless icons (anti_ice_RGB.png, aileron_left_RGB.png).
  resolve(base, state) {
    const name = state ? `${base}_${state}_${this.theme}.png` : `${base}_${this.theme}.png`;
    return this.files.has(name) ? name : null;
  }

  read(file) {
    return fs.readFileSync(path.join(this.dir, file));
  }

  dataUri(file) {
    if (!this.cache.has(file)) {
      const b64 = fs.readFileSync(path.join(this.dir, file)).toString('base64');
      this.cache.set(file, `data:image/png;base64,${b64}`);
    }
    return this.cache.get(file);
  }
}

module.exports = { IconLibrary, parseName, THEMES, STATES };
