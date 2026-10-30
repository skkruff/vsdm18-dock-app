// The user's profile folder (default Documents\MSFS Switchboard\profiles). Profiles shipped with
// the plugin are copied in on first run and never overwritten after that, so redeploying the
// plugin cannot undo work done in the editor. The key library (library.json: reusable keys and
// groups of keys) lives next to it.
const fs = require('fs');
const path = require('path');
const { loadProfiles, validate } = require('./profiles');

const FILE_RE = /^[A-Za-z0-9_.-]+\.json$/;

class ProfileStore {
  constructor({ dir, bundledDir, log = () => {} }) {
    this.dir = dir;
    this.bundledDir = bundledDir;
    this.libraryFile = path.join(path.dirname(dir), 'library.json');
    this.oldPresetsFile = path.join(path.dirname(dir), 'presets.json'); // before the library
    this.settingsFile = path.join(path.dirname(dir), 'settings.json'); // look: font, colours
    this.dockStateFile = path.join(path.dirname(dir), 'dock-state.json'); // stopwatches, kept across restarts
    this.keypadFile = path.join(path.dirname(dir), 'keypad.json'); // the keypad layout, for every keypad
    this.log = log;
    this.watcher = null;
  }

  // Creates the folder, copies in any shipped profile the user does not have yet, and adds shipped
  // library items the user has neither got nor deleted.
  seed(bundledLibrary) {
    fs.mkdirSync(this.dir, { recursive: true });
    if (bundledLibrary && fs.existsSync(bundledLibrary)) {
      const lib = this.readLibrary();
      const have = new Set(lib.items.map(i => i.id));
      const hidden = new Set(lib.hiddenShipped);
      const added = JSON.parse(fs.readFileSync(bundledLibrary, 'utf8')).items
        .filter(i => !have.has(i.id) && !hidden.has(i.id));
      if (added.length || !fs.existsSync(this.libraryFile)) {
        lib.items.push(...added);
        this.writeLibrary(lib);
      }
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

  // { items: [{ id, name, category, notes, shipped, keys: [{ dr, dc, key }] }], hiddenShipped: [id] }
  // hiddenShipped remembers shipped items the user deleted, so they are not added back.
  readLibrary() {
    try {
      const lib = JSON.parse(fs.readFileSync(this.libraryFile, 'utf8'));
      return { items: lib.items || [], hiddenShipped: lib.hiddenShipped || [] };
    } catch {
      // Presets saved before the library existed become library items.
      let old = [];
      try { old = JSON.parse(fs.readFileSync(this.oldPresetsFile, 'utf8')); } catch { old = []; }
      return {
        items: old.map((p, i) => ({ id: `user.preset${i}`, category: 'My keys', ...p })),
        hiddenShipped: [],
      };
    }
  }

  writeLibrary(lib) {
    const tmp = `${this.libraryFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(lib, null, 2) + '\n');
    fs.renameSync(tmp, this.libraryFile);
  }

  // Look settings chosen in the editor: { font, readout, label, ... } overriding the measured style.
  readSettings() {
    try { return JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')); } catch { return {}; }
  }

  writeSettings(s) {
    fs.writeFileSync(this.settingsFile, JSON.stringify(s, null, 2) + '\n');
  }

  // The keypad layout: { keys }, or {} for the built-in one.
  readKeypad() {
    try { return JSON.parse(fs.readFileSync(this.keypadFile, 'utf8')); } catch { return {}; }
  }

  writeKeypad(layout) {
    if (!layout) { try { fs.unlinkSync(this.keypadFile); } catch { /* already the built-in one */ } return; }
    fs.writeFileSync(this.keypadFile, JSON.stringify(layout, null, 2) + '\n');
  }

  readDockState() {
    try { return JSON.parse(fs.readFileSync(this.dockStateFile, 'utf8')); } catch { return {}; }
  }

  // Written whole each time; a temporary file then a rename, so a crash never leaves half a file.
  writeDockState(s) {
    const tmp = `${this.dockStateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
    fs.renameSync(tmp, this.dockStateFile);
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
