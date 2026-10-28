// Key images. Library icons where the profile names one and the file exists; otherwise generated
// SVG tiles styled like the library's RGB icons (black key, label, red/green/outlined state bar).
const STATE_COLORS = { on: '#b8f01c', off: '#f0204c' };
const LABEL = '#ffffff';
const DIM = '#9aa0a8';
const READOUT = '#ffd040';

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// viewBox lets one large drawing be cut into per-key pieces (see tiles.banner).
function svgUri(body, bg = '#000000', viewBox = '0 0 144 144') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="144" height="144" viewBox="${viewBox}"><rect x="-1000" y="-1000" width="3000" height="3000" fill="${bg}"/>` +
    `${body}</svg>`;
  return 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
}

// Centred lines of text around (x, y), shrinking the font so the longest line fits width.
// charsPerEm: roughly how many characters fit per font-size unit of width (lower for capitals).
function lines(text, y, { size = 26, color = LABEL, weight = 'bold', x = 72, width = 130, charsPerEm = 1.75 } = {}) {
  const ls = String(text).split('\n');
  const longest = Math.max(...ls.map(l => l.length));
  const fit = Math.min(size, Math.floor((width * charsPerEm) / Math.max(longest, 1)));
  const step = fit * 1.1;
  const y0 = y - ((ls.length - 1) * step) / 2;
  return ls.map((l, i) =>
    `<text x="${x}" y="${y0 + i * step}" font-family="Arial, Helvetica, sans-serif" font-weight="${weight}" ` +
    `font-size="${fit}" fill="${color}" text-anchor="middle" dominant-baseline="middle">${esc(l)}</text>`).join('');
}

// The 15 LCD keys as one 720 x 432 canvas (5 x 3 keys of 144). The physical gaps between keys
// are not part of the canvas, so text crossing a gap looks slightly stretched.
const PANEL = { cols: 5, rows: 3, key: 144 };

function bar(state) {
  const fill = STATE_COLORS[state];
  return fill
    ? `<rect x="30" y="100" width="84" height="22" rx="6" fill="${fill}"/>`
    : `<rect x="31" y="101" width="82" height="20" rx="6" fill="none" stroke="${DIM}" stroke-width="3"/>`;
}

const tiles = {
  // state: on | off | clear (unknown). stateText: optional word under the label, e.g. ARM.
  switch(label, state, stateText) {
    return svgUri(lines(label, stateText ? 38 : 50) + (stateText ? lines(stateText, 80, { size: 18, color: DIM }) : '') + bar(state));
  },
  button(label) {
    return svgUri(lines(label, 72, { size: 30 }));
  },
  readout(label, value) {
    return svgUri(lines(label, 32, { size: 20, color: DIM }) + lines(value, 88, { size: 40, color: READOUT }));
  },
  // Top of a library icon (its printed name) above a live value. The icon's state bar at the
  // bottom is cut off.
  iconReadout(iconUri, value) {
    return svgUri(
      `<defs><clipPath id="top"><rect width="144" height="78"/></clipPath></defs>` +
      `<image href="${iconUri}" xlink:href="${iconUri}" x="0" y="0" width="144" height="144" clip-path="url(#top)"/>` +
      lines(value, 112, { size: 38, color: READOUT }));
  },
  // One slot's piece of a message drawn across the whole panel. Each line sits inside one row of
  // keys so no letters fall into the gaps between rows: one line in the middle row, two in the
  // top and bottom rows, three in all rows.
  banner(text, slot, { color = LABEL, size = 100 } = {}) {
    const { cols, key } = PANEL;
    const w = cols * key;
    const ls = String(text).split('\n').slice(0, 3);
    const rowsFor = { 1: [1], 2: [0, 2], 3: [0, 1, 2] }[ls.length];
    const longest = Math.max(...ls.map(l => l.length));
    const fit = Math.min(size, Math.floor(((w - 40) * 1.3) / Math.max(longest, 1)));
    const body = ls.map((l, i) => lines(l, rowsFor[i] * key + key / 2, { size: fit, color, x: w / 2, width: w })).join('');
    const x = (slot % cols) * key;
    const y = Math.floor(slot / cols) * key;
    return svgUri(body, '#000000', `${x} ${y} ${key} ${key}`);
  },
  message(text) {
    return svgUri(lines(text, 72, { size: 22, color: DIM }));
  },
  unavailable(label) {
    return svgUri(lines(label, 50) + lines('N/A', 104, { size: 22, color: STATE_COLORS.off }));
  },
  blank() {
    return svgUri('');
  },
};

class Renderer {
  constructor(icons) { this.icons = icons; }

  // Library icon for (base, state) as a data URI, or null if there is no such file.
  icon(base, state) {
    if (!base || !this.icons) return null;
    const file = this.icons.resolve(base, state);
    return file ? this.icons.dataUri(file) : null;
  }
}

module.exports = { Renderer, tiles };
