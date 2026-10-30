// The user's profile folder (default Documents\MSFS Switchboard\profiles). Profiles shipped with
// the plugin are copied in on first run and never overwritten after that, so redeploying the
// plugin cannot undo work done in the editor. The key library (library.json: reusable keys and
// groups of keys) lives next to it.
const fs = require('fs');
const path = require('path');
const { loadProfiles, validate } = require('./profiles');

const FILE_RE = /^[A-Za-z0-9_.-]+\.json$/;

// Writes JSON whole: a temporary file, then a rename, so a crash or power cut never leaves half a
// file behind (review 2026-10-30: library, settings and keypad were written in place).
function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// Reads a JSON file; a file that exists but does not parse is moved aside (kept, not lost) and
// reported, then treated as missing.
function readJson(file, log) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return undefined; }
  try { return JSON.parse(text); } catch (e) {
    const aside = `${file}.${Date.now()}.unreadable`;
    try { fs.renameSync(file, aside); } catch { /* leave it */ }
    log('file could not be read, kept as', { file: aside, error: e.message });
    return undefined;
  }
}

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

  // Creates the folder, copies in any shipped profile the user does not have yet, and brings the
  // shipped library items up to date: new ones added (unless the user deleted them), changed ones
  // replaced, ones no longer shipped removed. The user's own items are never touched, and their
  // renames of shipped items (userEdits) stay on top. Shipped items are refreshed rather than
  // kept because their ids name a page and slot of a shipped profile, which can change meaning
  // when that profile is reworked (2026-10-30: the C172 profile became the user's).
  seed(bundledLibrary) {
    fs.mkdirSync(this.dir, { recursive: true });
    if (bundledLibrary && fs.existsSync(bundledLibrary)) {
      const lib = this.readLibrary();
      const hidden = new Set(lib.hiddenShipped);
      const bundled = JSON.parse(fs.readFileSync(bundledLibrary, 'utf8')).items.filter(i => !hidden.has(i.id));
      const byId = new Map(bundled.map(i => [i.id, i]));
      const before = JSON.stringify(lib.items);
      const kept = [];
      for (const item of lib.items) {
        if (!item.shipped) { kept.push(item); continue; }
        const fresh = byId.get(item.id);
        if (!fresh) continue; // no longer shipped
        kept.push({ ...fresh, ...(item.userEdits || {}), ...(item.userEdits ? { userEdits: item.userEdits } : {}) });
        byId.delete(item.id);
      }
      lib.items = [...kept, ...byId.values()];
      if (JSON.stringify(lib.items) !== before || !fs.existsSync(this.libraryFile)) this.writeLibrary(lib);
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
    writeJson(this._path(file), profile);
  }

  // Deleting keeps a .bak copy beside the folder's files (not loaded, since it is not .json).
  remove(file) {
    const p = this._path(file);
    fs.renameSync(p, `${p}.${Date.now()}.bak`);
  }

  // { items: [{ id, name, category, notes, shipped, keys: [{ dr, dc, key }] }], hiddenShipped: [id] }
  // hiddenShipped remembers shipped items the user deleted, so they are not added back.
  readLibrary() {
    const lib = readJson(this.libraryFile, this.log);
    if (lib) return { items: lib.items || [], hiddenShipped: lib.hiddenShipped || [] };
    // Presets saved before the library existed become library items.
    let old = [];
    try { old = JSON.parse(fs.readFileSync(this.oldPresetsFile, 'utf8')); } catch { old = []; }
    return {
      items: old.map((p, i) => ({ id: `user.preset${i}`, category: 'My keys', ...p })),
      hiddenShipped: [],
    };
  }

  writeLibrary(lib) {
    writeJson(this.libraryFile, lib);
  }

  // Look settings chosen in the editor: { font, readout, label, ... } overriding the measured style.
  readSettings() {
    return readJson(this.settingsFile, this.log) || {};
  }

  writeSettings(s) {
    writeJson(this.settingsFile, s);
  }

  // The keypad layout: { keys }, or {} for the built-in one.
  readKeypad() {
    return readJson(this.keypadFile, this.log) || {};
  }

  writeKeypad(layout) {
    if (!layout) { try { fs.unlinkSync(this.keypadFile); } catch { /* already the built-in one */ } return; }
    writeJson(this.keypadFile, layout);
  }

  readDockState() {
    return readJson(this.dockStateFile, this.log) || {};
  }

  writeDockState(s) {
    writeJson(this.dockStateFile, s);
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
