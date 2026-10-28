// Key images. Library icons where the profile names one and the file exists; otherwise generated
// SVG tiles styled like the library's RGB icons (black key, label, red/green/outlined state bar).
const { contentBox } = require('./png');

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

// The 15 LCD keys as one canvas that includes the physical gaps between keys (about a quarter of
// a key wide on the M18), so text crossing a gap keeps its shape and only loses the hidden part.
const PANEL = { cols: 5, rows: 3, key: 144, gap: 36 };

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
  // A library icon's content (box: its bounding box in icon pixels, from png.contentBox) scaled
  // into the top of the key, with a live value below. Without a box the whole icon is used.
  iconReadout(iconUri, value, box) {
    const area = { x: 6, y: 4, w: 132, h: 72 };
    const b = box || { x: 0, y: 0, w: 512, h: 512, width: 512, height: 512 };
    const s = Math.min(area.w / b.w, area.h / b.h);
    const x = area.x + (area.w - b.w * s) / 2 - b.x * s;
    const y = area.y + (area.h - b.h * s) / 2 - b.y * s;
    return svgUri(
      `<defs><clipPath id="top"><rect x="${area.x}" y="${area.y}" width="${area.w}" height="${area.h}"/></clipPath></defs>` +
      `<image href="${iconUri}" xlink:href="${iconUri}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" ` +
      `width="${(b.width * s).toFixed(1)}" height="${(b.height * s).toFixed(1)}" clip-path="url(#top)"/>` +
      lines(value, 110, { size: 40, color: READOUT }));
  },
  // One slot's piece of a scene drawn across the whole panel.
  // scene: { rows: { 0: 'MSFS', 2: 'NOT CONNECTED' }, icons: { 7: dataUri }, color }
  // Each text row is centred on its row of keys, as large as fits across the panel.
  scene(scene, slot) {
    const { cols, rows, key, gap } = PANEL;
    const pitch = key + gap;
    const w = cols * key + (cols - 1) * gap;
    const color = scene.color || LABEL;
    let body = '';
    for (const [row, text] of Object.entries(scene.rows || {})) {
      const fit = Math.min(scene.size || 120, Math.floor(((w - 20) * 1.45) / Math.max(String(text).length, 1)));
      body += lines(text, Number(row) * pitch + key / 2 + fit * 0.05, { size: fit, color, x: w / 2, width: w });
    }
    for (const [s, uri] of Object.entries(scene.icons || {})) {
      const ix = (Number(s) % cols) * pitch;
      const iy = Math.floor(Number(s) / cols) * pitch;
      body += `<image href="${uri}" xlink:href="${uri}" x="${ix}" y="${iy}" width="${key}" height="${key}"/>`;
    }
    const x = (slot % cols) * pitch;
    const y = Math.floor(slot / cols) * pitch;
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
  constructor(icons) {
    this.icons = icons;
    this.boxes = new Map(); // file -> content box (or null)
  }

  _file(base, state) {
    return base && this.icons ? this.icons.resolve(base, state) : null;
  }

  // Library icon for (base, state) as a data URI, or null if there is no such file. base may also
  // be a full name such as magneto_off (state null).
  icon(base, state) {
    const file = this._file(base, state);
    return file ? this.icons.dataUri(file) : null;
  }

  // Bounding box of the icon's visible content, for cropping. null if unknown.
  iconBox(base, state) {
    const file = this._file(base, state);
    if (!file) return null;
    if (!this.boxes.has(file)) {
      let box = null;
      try { box = contentBox(this.icons.read(file)); } catch (e) { box = null; }
      this.boxes.set(file, box);
    }
    return this.boxes.get(file);
  }
}

module.exports = { Renderer, tiles };
