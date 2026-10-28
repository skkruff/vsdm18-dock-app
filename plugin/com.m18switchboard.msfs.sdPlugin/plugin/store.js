// The user's profile folder (default Documents\MSFS Switchboard\profiles). Profiles shipped with
// the plugin are copied in on first run and never overwritten after that, so redeploying the
// plugin cannot undo work done in the editor. Presets (reusable groups of keys) live next to it.
const fs = require('fs');
const path = require('path');
const { loadProfiles, validate } = require('./profiles');

const FILE_RE = /^[A-Za-z0-9_.-]+\.json$/;

class ProfileStore {
  constructor({ dir, bundledDir, log = () => {} }) {
    this.dir = dir;
    this.bundledDir = bundledDir;
    this.presetsFile = path.join(path.dirname(dir), 'presets.json');
    this.log = log;
    this.watcher = null;
  }

  // Creates the folder and copies in any shipped profile the user does not have yet, and the
  // shipped presets if the user has none.
  seed(bundledPresets) {
    fs.mkdirSync(this.dir, { recursive: true });
    if (bundledPresets && fs.existsSync(bundledPresets) && !fs.existsSync(this.presetsFile)) {
      fs.copyFileSync(bundledPresets, this.presetsFile);
    }
    const copied = [];
    for (const f of fs.readdirSync(this.bundledDir).filter(f => FILE_RE.test(f))) {
      const dest = path.join(this.dir, f);
      if (!fs.existsSync(dest)) { fs.copyFileSync(path.join(this.bundledDir, f), dest); copied.push(f); }
    }
    return copied;
  }

  load() {
    return loadProfiles(this.dir);
  }

  list() {
    const out = [];
    for (const file of fs.readdirSync(this.dir).filter(f => FILE_RE.test(f)).sort()) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf8'));
        out.push({ file, id: p.id, name: p.name, fallback: !!p.fallback, pages: (p.pages || []).length });
      } catch (e) {
        out.push({ file, error: e.message });
      }
    }
    return out;
  }

  _path(file) {
    if (!FILE_RE.test(file)) throw new Error(`bad file name ${file}`);
    return path.join(this.dir, file);
  }

  read(file) {
    return JSON.parse(fs.readFileSync(this._path(file), 'utf8'));
  }

  // Validates, then writes atomically (temp file + rename) so a half-written file is never loaded.
  write(file, profile) {
    validate(profile, file);
    const target = this._path(file);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(profile, null, 2) + '\n');
    fs.renameSync(tmp, target);
  }

  // Deleting keeps a .bak copy beside the folder's files (not loaded, since it is not .json).
  remove(file) {
    const p = this._path(file);
    fs.renameSync(p, `${p}.${Date.now()}.bak`);
  }

  readPresets() {
    try { return JSON.parse(fs.readFileSync(this.presetsFile, 'utf8')); } catch { return []; }
  }

  writePresets(presets) {
    fs.writeFileSync(this.presetsFile, JSON.stringify(presets, null, 2) + '\n');
  }

  // Calls onChange (debounced) whenever a profile file changes, from the editor or by hand.
  watch(onChange, debounceMs = 300) {
    let timer = null;
    try {
      this.watcher = fs.watch(this.dir, (event, file) => {
        if (file && !FILE_RE.test(file)) return;
        clearTimeout(timer);
        timer = setTimeout(onChange, debounceMs);
      });
    } catch (e) {
      this.log('profile folder not watched', e.message);
    }
  }
}

module.exports = { ProfileStore, FILE_RE };
