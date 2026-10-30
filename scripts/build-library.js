// Builds the shipped key library (plugin/.../library.json) from the shipped profiles: every key
// as a single-key item, plus hand-made groups. Run after changing a shipped profile:
//   node scripts/build-library.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'plugin', 'com.m18switchboard.msfs.sdPlugin');
const profiles = ['c172-g1000', 'generic'].map(id => JSON.parse(fs.readFileSync(path.join(root, 'profiles', `${id}.json`), 'utf8')));

// Category from what the key reads or does.
function category(key) {
  const src = `${key.read?.input || ''} ${key.read?.var || ''} ${key.press?.event || ''}`.toUpperCase();
  if (/LIGHT/.test(src)) return 'Lights';
  if (/MAGNETO|ENGINE|STARTER|IGNITION/.test(src)) return 'Engine';
  if (/FUEL/.test(src)) return 'Fuel';
  if (/COM|NAV |TRANSPONDER|XPNDR|RADIO/.test(src)) return 'Radios';
  if (/KOHLSMAN|BAROMETRIC|ALTIM/.test(src)) return 'Instruments';
  if (/ELECTRICAL|BATTERY|ALTERNATOR|AVIONICS|BUS/.test(src)) return 'Electrical';
  if (/PITOT|DEICE|ICE/.test(src)) return 'Anti-ice';
  return 'Other';
}

function describe(key) {
  const src = key.read ? (key.read.input || `${key.read.var} (${key.read.unit})`) : 'nothing';
  const p = key.press;
  const act = !p ? 'no press action'
    : p.event ? `sends ${p.event}` : p.cycle ? `toggles ${p.cycle.join('/')}` : p.step !== undefined ? `steps ${p.step > 0 ? '+' : ''}${p.step}`
      : p.hold !== undefined ? `holds ${p.hold}, releases to ${p.release}` : `sets ${p.set}`;
  return `Reads ${src}; ${act}.`;
}

const items = [];
for (const prof of profiles) {
  const aircraft = prof.fallback ? 'any aircraft, classic simvars' : (prof.banner || [prof.id]).join(' ');
  prof.pages.forEach((page, pi) => {
    for (const [slot, key] of Object.entries(page.keys)) {
      items.push({
        id: `${prof.id}.${pi}.${slot}`,
        name: `${(key.label || key.icon || 'key').replace(/\n/g, ' ')} (${aircraft})`,
        category: category(key),
        notes: describe(key),
        shipped: true,
        keys: [{ dr: 0, dc: 0, key }],
      });
    }
  });
}

const c172 = profiles[0].pages[0].keys;
items.unshift({
  id: 'group.magneto-set',
  name: 'Magneto set (◀ MAG, state, MAG ▶, START)',
  category: 'Engine',
  notes: 'From the C172. Steps OFF/R/L/BOTH and stops at BOTH; START is held to crank and re-sent every 250 ms. '
    + 'Values 0 OFF, 1 R, 2 L, 3 BOTH, 4 START: check the aircraft uses the same.',
  shipped: true,
  keys: [11, 12, 13, 14].map((s, i) => ({ dr: 0, dc: i, key: c172[s] })),
});
const aux = profiles[0].pages[1].keys;
items.unshift({
  id: 'group.fuel-selector',
  name: 'Fuel selector (◀ FUEL, state, FUEL ▶)',
  category: 'Fuel',
  notes: 'From the C172. Values 0 LEFT, 1 BOTH, 2 RIGHT.',
  shipped: true,
  keys: [5, 6, 7].map((s, i) => ({ dr: 0, dc: i, key: aux[s] })),
});
items.unshift({
  id: 'group.c172-lights-row',
  name: 'Exterior lights row (BCN, LAND, TAXI, NAV, STRB)',
  category: 'Lights',
  notes: 'From the C172 G1000 (input events).',
  shipped: true,
  keys: [5, 6, 7, 8, 9].map((s, i) => ({ dr: 0, dc: i, key: c172[s] })),
});

// Dock-held values (user, 2026-10-30): a stopwatch, and radio keys that open a keypad.
items.push({
  id: 'dock.stopwatch',
  name: 'Stopwatch (time, start/stop, reset)',
  category: 'Chrono',
  notes: 'A dock stopwatch named T1, counting sim time; kept across restarts. Rename T1 on all three keys for a second one.',
  shipped: true,
  keys: [
    { dr: 0, dc: 0, key: { type: 'readout', label: 'TIMER', read: { timer: 'T1' }, format: 'duration', separator: true } },
    { dr: 0, dc: 1, key: { type: 'switch', label: 'START\nSTOP', read: { timer: 'T1', part: 'running' }, states: { 1: 'on' }, press: { timer: 'T1', action: 'toggle' } } },
    { dr: 0, dc: 2, key: { type: 'button', label: 'RESET', press: { timer: 'T1', action: 'reset' } } },
  ],
});
const keypadKey = (id, name, label, read, fmt, preset) => items.push({
  id, name, category: 'Radios', shipped: true,
  notes: `Shows ${read.var}; pressing it opens a keypad to type a new value.`,
  keys: [{ dr: 0, dc: 0, key: { type: 'readout', label, read, ...fmt, press: { keypad: preset } } }],
});
keypadKey('dock.keypad.xpdr', 'XPDR code, keypad entry (any aircraft)', 'XPDR', { var: 'TRANSPONDER CODE:1', unit: 'number' }, { pad: 4 }, 'xpdr');
keypadKey('dock.keypad.com1', 'COM1 standby, keypad entry (any aircraft)', 'COM1 STBY', { var: 'COM STANDBY FREQUENCY:1', unit: 'MHz' }, { decimals: 3 }, 'com1');
keypadKey('dock.keypad.com2', 'COM2 standby, keypad entry (any aircraft)', 'COM2 STBY', { var: 'COM STANDBY FREQUENCY:2', unit: 'MHz' }, { decimals: 3 }, 'com2');
keypadKey('dock.keypad.nav1', 'NAV1 standby, keypad entry (any aircraft)', 'NAV1 STBY', { var: 'NAV STANDBY FREQUENCY:1', unit: 'MHz' }, { decimals: 2 }, 'nav1');
keypadKey('dock.keypad.nav2', 'NAV2 standby, keypad entry (any aircraft)', 'NAV2 STBY', { var: 'NAV STANDBY FREQUENCY:2', unit: 'MHz' }, { decimals: 2 }, 'nav2');

fs.writeFileSync(path.join(root, 'library.json'), JSON.stringify({ items }, null, 2) + '\n');
console.log(`${items.length} library items`);
