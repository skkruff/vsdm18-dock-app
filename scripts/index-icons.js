// Indexes the icon library so profiles can be written against real names.
//   npm run icons:index -- "D:\MFS2024\Flight Sim Dock\Button Icon PNGs"
// Writes docs/icon-index.md: one row per icon base with its states and themes, the pixel size
// of each distinct PNG size found, and any files that do not fit the naming scheme.
const fs = require('fs');
const path = require('path');
const { parseName, THEMES } = require('../plugin/com.m18switchboard.msfs.sdPlugin/plugin/icons');

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error('Usage: npm run icons:index -- "<icon folder>"');
  process.exit(1);
}

// PNG width/height live at fixed offsets in the IHDR chunk.
function pngSize(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(24);
  fs.readSync(fd, buf, 0, 24, 0);
  fs.closeSync(fd);
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

const bases = new Map(); // base -> { states: Set, themes: Set }
const unparsed = [];
const sizes = new Map(); // "WxH" -> count
for (const file of fs.readdirSync(dir).sort()) {
  if (!/\.png$/i.test(file)) continue;
  const p = parseName(file);
  if (!p) { unparsed.push(file); continue; }
  if (!bases.has(p.base)) bases.set(p.base, { states: new Set(), themes: new Set() });
  bases.get(p.base).states.add(p.state || '(none)');
  bases.get(p.base).themes.add(p.theme);
  const s = pngSize(path.join(dir, file));
  sizes.set(s, (sizes.get(s) || 0) + 1);
}

const lines = [
  '# Icon library index', '',
  `Folder: \`${dir}\`  `, `Generated: ${new Date().toISOString()}`, '',
  '## Image sizes', '',
  ...[...sizes].map(([s, n]) => `- ${s}: ${n} files`), '',
  `## Icon bases (${bases.size})`, '',
  '| Base | States | Themes |', '|---|---|---|',
  ...[...bases].map(([b, v]) =>
    `| ${b} | ${[...v.states].join(', ')} | ${THEMES.filter(t => v.themes.has(t)).join(', ')} |`),
  '', `## Not matching <base>[_<state>]_<theme>.png (${unparsed.length})`, '',
  ...unparsed.map(f => `- ${f}`), '',
];
const out = path.join(__dirname, '..', 'docs', 'icon-index.md');
fs.writeFileSync(out, lines.join('\n'));
console.log(`${bases.size} icon bases, ${unparsed.length} unmatched files -> ${out}`);
