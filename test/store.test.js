// Profile folder and key library: seeding, merging shipped items, deletions that stick.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProfileStore } = require('../plugin/com.m18switchboard.msfs.sdPlugin/plugin/store');

const plugin = path.join(__dirname, '..', 'plugin', 'com.m18switchboard.msfs.sdPlugin');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-store-'));
const dir = path.join(base, 'profiles');
const shipped = path.join(base, 'shipped-library.json');
const ship = items => fs.writeFileSync(shipped, JSON.stringify({ items }));
const key = { type: 'button', label: 'X' };

// Presets saved by an earlier version become library items.
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(base, 'presets.json'), JSON.stringify([{ name: 'Old preset', keys: [{ dr: 0, dc: 0, key }] }]));
const store = new ProfileStore({ dir, bundledDir: path.join(plugin, 'profiles') });
ship([{ id: 'a', name: 'A', shipped: true, keys: [{ dr: 0, dc: 0, key }] }]);
store.seed(shipped);
assert.deepStrictEqual(store.readLibrary().items.map(i => i.name), ['Old preset', 'A']);
assert.ok(fs.existsSync(path.join(dir, 'c172-g1000.json')), 'profiles seeded');

// The user deletes a shipped item and adds their own; a redeploy ships a new item.
const lib = store.readLibrary();
lib.items = lib.items.filter(i => i.id !== 'a');
lib.hiddenShipped.push('a');
lib.items.push({ id: 'user.1', name: 'Mine', keys: [{ dr: 0, dc: 0, key }] });
store.writeLibrary(lib);
ship([{ id: 'a', name: 'A', shipped: true, keys: [] }, { id: 'b', name: 'B', shipped: true, keys: [] }]);
store.seed(shipped);
assert.deepStrictEqual(store.readLibrary().items.map(i => i.name), ['Old preset', 'Mine', 'B'], 'deleted stays deleted, new shipped item added, own items kept');

// A redeploy changes a shipped item (same id, new content) and drops another: the library follows,
// keeping the user's rename of a shipped item (2026-10-30: shipped ids name a page and slot).
const lib2 = store.readLibrary();
Object.assign(lib2.items.find(i => i.id === 'b'), { name: 'My B', userEdits: { name: 'My B' } });
store.writeLibrary(lib2);
ship([{ id: 'b', name: 'B2', category: 'New', shipped: true, keys: [{ dr: 0, dc: 0, key: { type: 'button', label: 'NEW' } }] }, { id: 'c', name: 'C', shipped: true, keys: [] }]);
store.seed(shipped);
const after = store.readLibrary().items;
assert.deepStrictEqual(after.map(i => i.name), ['Old preset', 'Mine', 'My B', 'C']);
assert.strictEqual(after.find(i => i.id === 'b').keys[0].key.label, 'NEW', 'content refreshed');
assert.strictEqual(after.find(i => i.id === 'b').category, 'New');
ship([{ id: 'c', name: 'C', shipped: true, keys: [] }]);
store.seed(shipped);
assert.deepStrictEqual(store.readLibrary().items.map(i => i.name), ['Old preset', 'Mine', 'C'], 'no longer shipped: removed');

// An unreadable library is kept aside, not overwritten (review 2026-10-30).
fs.writeFileSync(store.libraryFile, '{"items": [ half a fi');
const logged = [];
store.log = (...a) => logged.push(a);
assert.deepStrictEqual(store.readLibrary().items.length, 1, 'treated as missing (old presets only)');
const aside = fs.readdirSync(base).filter(f => f.startsWith('library.json.') && f.endsWith('.unreadable'));
assert.strictEqual(aside.length, 1, 'the unreadable file is kept');
assert.match(fs.readFileSync(path.join(base, aside[0]), 'utf8'), /half a fi/);
assert.ok(logged.length, 'and reported');

// The real shipped library parses and every key in it validates inside a profile.
const { validate } = require('../plugin/com.m18switchboard.msfs.sdPlugin/plugin/profiles');
const real = JSON.parse(fs.readFileSync(path.join(plugin, 'library.json'), 'utf8')).items;
for (const item of real) {
  const keys = {};
  item.keys.forEach((k, i) => { keys[i] = k.key; });
  validate({ id: 't', match: { title: ['t'] }, pages: [{ name: 'p', keys }] }, item.id);
}
fs.rmSync(base, { recursive: true });
console.log(`store: PASS (${real.length} shipped library items valid)`);
