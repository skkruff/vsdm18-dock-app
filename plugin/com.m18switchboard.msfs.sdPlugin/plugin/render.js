// Key images. Library icons where the profile names one and the file exists; otherwise generated
// SVG tiles styled to match the library's RGB icons.
//
// Text is drawn as outlines from a bundled font (fonts/*.woff, via opentype.js), not as SVG
// <text>: VSD Craft's renderer ignores SVG text features browsers support (it drew text half a line
// high, user report 2026-10-28), and outlines look identical everywhere, with no font installed.
const path = require('path');
const opentype = require('opentype.js');
const { contentBox } = require('./png');

const FONT_DIR = path.join(__dirname, '..', 'fonts');
const FONTS = {
  'Bebas Neue': 'bebas-neue-latin-400-normal.woff',
  'Oswald SemiBold': 'oswald-latin-600-normal.woff',
  'Oswald Bold': 'oswald-latin-700-normal.woff',
  'Barlow Condensed SemiBold': 'barlow-condensed-latin-600-normal.woff',
  'Barlow Condensed Bold': 'barlow-condensed-latin-700-normal.woff',
  'Roboto Condensed Bold': 'roboto-condensed-latin-700-normal.woff',
  Anton: 'anton-latin-400-normal.woff',
};
const DEFAULT_FONT = 'Barlow Condensed Bold'; // user's choice, 2026-10-28

// The look of generated tiles. Colours and bar geometry are replaced by values measured from the
// user's icons when available (theme.js), so drawn keys sit next to library keys without a seam.
const DEFAULT_STYLE = {
  font: DEFAULT_FONT,
  label: '#ffffff',
  dim: '#9aa0a8',
  readout: '#4fc3f7',
  on: '#b8f01c',
  off: '#f0204c',
  armed: '#ffffff', // armable keys: mode armed, not yet active (G1000 shows armed modes in white)
  clearStroke: '#8a8f98',
  clearWidth: 3,
  // Measured from the user's master_battery icons (2026-10-28), corner set by the user. Fixed
  // rather than re-measured at start-up: the style is settled (user, 2026-10-28).
  bar: { x: 21.4, y: 93.4, w: 101.3, h: 34.9, r: 9.5 },
};
const style = { ...DEFAULT_STYLE, bar: { ...DEFAULT_STYLE.bar } };

function setStyle(s) {
  Object.assign(style, s, { bar: { ...style.bar, ...(s.bar || {}) } });
}

const fontCache = new Map();
function font(name = style.font) {
  const file = FONTS[name] || FONTS[DEFAULT_FONT];
  if (!fontCache.has(file)) {
    try { fontCache.set(file, opentype.loadSync(path.join(FONT_DIR, file))); } catch (e) { fontCache.set(file, null); }
  }
  return fontCache.get(file);
}

function num(v, d) {
  const n = Number(v);
  return v === undefined || v === '' || Number.isNaN(n) ? d : n;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// viewBox lets one large drawing be cut into per-key pieces (see tiles.scene).
function svgUri(body, bg = '#000000', viewBox = '0 0 144 144') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="144" height="144" viewBox="${viewBox}"><rect x="-1000" y="-1000" width="3000" height="3000" fill="${esc(bg)}"/>` +
    `${body}</svg>`;
  return 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
}

// Arrows the condensed fonts lack, drawn as shapes in a box `cap` high: [width, points].
const SHAPES = {
  '◀': [0.8, [[0.8, 0], [0, 0.5], [0.8, 1]]],
  '▶': [0.8, [[0, 0], [0.8, 0.5], [0, 1]]],
  '▲': [0.9, [[0, 1], [0.45, 0], [0.9, 1]]],
  '▼': [0.9, [[0, 0], [0.45, 1], [0.9, 0]]],
};
const SHAPE_GAP = 0.25; // space after a shape, in cap heights

// A line laid out as runs of font text and drawn shapes: { width, draw(x0, baseline) -> path data }.
function layout(f, line, size, cap) {
  const parts = [];
  let run = '';
  for (const ch of line) {
    if (SHAPES[ch] && f.charToGlyphIndex(ch) === 0) {
      if (run) { parts.push({ text: run }); run = ''; }
      parts.push({ shape: SHAPES[ch] });
    } else run += ch;
  }
  if (run) parts.push({ text: run });
  const h = cap * size;
  const widthOf = p => (p.text ? f.getAdvanceWidth(p.text, size) : (p.shape[0] + SHAPE_GAP) * h);
  return {
    width: parts.reduce((s, p) => s + widthOf(p), 0),
    draw(x0, base) {
      let x = x0;
      let d = '';
      for (const p of parts) {
        if (p.text) d += f.getPath(p.text, x, base, size).toPathData(1);
        else d += `M${p.shape[1].map(([px, py]) => `${(x + px * h).toFixed(1)} ${(base - h + py * h).toFixed(1)}`).join('L')}Z`;
        x += widthOf(p);
      }
      return d;
    },
  };
}

// Lines of text centred on (x, y) at up to `size`, shrunk so the widest line fits `width`.
// Capital letters are centred vertically, so a line sits where its y says on every renderer.
function lines(text, y, { size = 26, color = style.label, x = 72, width = 130 } = {}) {
  const ls = String(text).split('\n');
  const f = font();
  if (!f) return fallbackLines(ls, y, size, color, x, width);
  const cap = ((f.tables.os2 && f.tables.os2.sCapHeight) || f.unitsPerEm * 0.7) / f.unitsPerEm;
  const widest = Math.max(1, ...ls.map(l => layout(f, l, 1000, cap).width));
  const fit = Math.max(4, Math.min(size, (width * 1000) / widest));
  const step = fit * (cap + 0.32);
  const y0 = y - ((ls.length - 1) * step) / 2;
  return ls.map((l, i) => {
    const lay = layout(f, l, fit, cap);
    const d = lay.draw(x - lay.width / 2, y0 + i * step + (cap * fit) / 2);
    // aria-label keeps the words readable in the SVG (tests, debugging); renderers ignore it.
    return d ? `<path aria-label="${esc(l)}" d="${d}" fill="${esc(color)}"/>` : '';
  }).join('');
}

// Without a font file: SVG text, positioned by baseline only (no dominant-baseline, which VSD
// Craft ignores).
function fallbackLines(ls, y, size, color, x, width) {
  const longest = Math.max(...ls.map(l => l.length), 1);
  const fit = Math.min(size, (width * 1.75) / longest);
  const step = fit * 1.05;
  const y0 = y - ((ls.length - 1) * step) / 2;
  return ls.map((l, i) => `<text x="${x}" y="${(y0 + i * step + fit * 0.35).toFixed(1)}" font-family="Arial" font-weight="bold" ` +
    `font-size="${fit.toFixed(1)}" fill="${esc(color)}" text-anchor="middle">${esc(l)}</text>`).join('');
}

// The 15 LCD keys as one canvas that includes the physical gaps between keys (about a quarter of
// a key wide on the M18), so text crossing a gap keeps its shape and only loses the hidden part.
const PANEL = { cols: 5, rows: 3, key: 144, gap: 36 };

const BAR_LOOKS = ['on', 'armed', 'off', 'clear'];

function bar(state, b = style.bar) {
  const fill = style[state === 'on' || state === 'off' || state === 'armed' ? state : null];
  if (fill) return `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.r}" fill="${fill}"/>`;
  const sw = style.clearWidth;
  return `<rect x="${b.x + sw / 2}" y="${b.y + sw / 2}" width="${b.w - sw}" height="${b.h - sw}" rx="${Math.max(0, b.r - sw / 2)}" ` +
    `fill="none" stroke="${style.clearStroke}" stroke-width="${sw}"/>`;
}

// Fits an icon (box: its content box, or null for the whole image) into an area, clipped to it.
function placedIcon(uri, box, area, id, crop = 'auto') {
  const full = { x: 0, y: 0, w: box ? box.width : 512, h: box ? box.height : 512 };
  const b = crop === 'full' || !box ? full : box;
  const s = Math.min(area.w / b.w, area.h / b.h);
  const ix = area.x + (area.w - b.w * s) / 2 - b.x * s;
  const iy = area.y + (area.h - b.h * s) / 2 - b.y * s;
  return `<defs><clipPath id="${id}"><rect x="${area.x}" y="${area.y}" width="${area.w}" height="${area.h}"/></clipPath></defs>` +
    `<image href="${uri}" xlink:href="${uri}" x="${ix.toFixed(1)}" y="${iy.toFixed(1)}" ` +
    `width="${(full.w * s).toFixed(1)}" height="${(full.h * s).toFixed(1)}" clip-path="url(#${id})"/>`;
}

// Sublabels: a smaller line under the main label, in the sublabel colour (Look panel).
const SUBLABEL_SIZE = 19;

const tiles = {
  // state: on | off | clear (unknown). sublabel: optional line under the label, e.g. ARM.
  switch(label, state, sublabel) {
    const top = style.bar.y;
    return svgUri(lines(label, sublabel ? top * 0.34 : top * 0.48, { size: sublabel ? 26 : 30, width: 128 }) +
      (sublabel ? lines(sublabel, top * 0.78, { size: SUBLABEL_SIZE, color: style.dim }) : '') + bar(state));
  },
  button(label, sublabel) {
    return svgUri(lines(label, sublabel ? 58 : 72, { size: 34, width: 128 }) +
      (sublabel ? lines(sublabel, 104, { size: SUBLABEL_SIZE, color: style.dim }) : ''));
  },
  readout(label, value, sublabel) {
    return svgUri(lines(label, 28, { size: 24, width: 130 }) +
      (sublabel ? lines(sublabel, 52, { size: SUBLABEL_SIZE, color: style.dim }) : '') +
      lines(value, sublabel ? 100 : 94, { size: sublabel ? 42 : 46, color: style.readout, width: 132 }));
  },
  // A library icon's content scaled into the top of the key, with a live value below.
  // A library icon has no armed version: its clear version with the bar filled in the armed colour.
  // The bar geometry is the one measured from the user's icons, so the fill lands on their outline.
  armedIcon(clearUri) {
    return svgUri(placedIcon(clearUri, null, { x: 0, y: 0, w: 144, h: 144 }, 'armed', 'full') + bar('armed'));
  },
  iconReadout(iconUri, value, box, sublabel) {
    return svgUri(placedIcon(iconUri, box, { x: 6, y: 6, w: 132, h: sublabel ? 56 : 70 }, 'top') +
      (sublabel ? lines(sublabel, 76, { size: SUBLABEL_SIZE, color: style.dim }) : '') +
      lines(value, sublabel ? 112 : 108, { size: sublabel ? 38 : 42, color: style.readout, width: 132 }));
  },
  // A key face designed in the editor: layers drawn in order on a 144 x 144 key.
  //   { kind: 'icon', icon, crop: 'auto' | 'full', x, y, w, h }   icon fitted into the box
  //   { kind: 'text', text, x, y, size, color, w }                 centred on (x, y)
  //   { kind: 'value', x, y, size, color, w, read?, decimals?, pad?, text? }
  //                                                                a live value (the key's own, or
  //                                                                the layer's own source)
  //   { kind: 'sublabel', x, y, size, color, w }                  the key's sublabel for its value
  //   { kind: 'bar', x, y, w, h, r, look }                         red / green / outline by state,
  //                                                                or always look (on|armed|off|clear)
  //   { kind: 'rect', x, y, w, h, r, color }
  // ctx: { iconFor(name) -> { uri, box } | null, valueFor(layer) -> string, state }
  face(face, ctx) {
    let body = '';
    (face.layers || []).forEach((L, n) => {
      // A bar without its own position sits where the standard bar does.
      const d = L.kind === 'bar' ? style.bar : { x: 0, y: 0, w: 144, h: 144 };
      const x = num(L.x, d.x), y = num(L.y, d.y), w = num(L.w, d.w), h = num(L.h, d.h);
      if (L.kind === 'icon') {
        const ic = ctx.iconFor(L.icon);
        if (ic) body += placedIcon(ic.uri, ic.box, { x, y, w, h }, `c${n}`, L.crop);
      } else if (L.kind === 'text' || L.kind === 'value') {
        const text = L.kind === 'value' ? ctx.valueFor(L) : (L.text || '');
        body += lines(text, y, { size: num(L.size, 26), color: L.color || (L.kind === 'value' ? style.readout : style.label), x, width: num(L.w, 136) });
      } else if (L.kind === 'sublabel') {
        // The key's sublabel for what it shows now (per value or per armable step).
        const sx = num(L.x, 72), sy = num(L.y, Math.round(style.bar.y * 0.78));
        const text = typeof ctx.sublabel === 'function' ? ctx.sublabel(L) : ctx.sublabel;
        if (text) body += lines(text, sy, { size: num(L.size, SUBLABEL_SIZE), color: L.color || style.dim, x: sx, width: num(L.w, 136) });
      } else if (L.kind === 'bar') {
        // look: a fixed bar (on / armed / off / clear) instead of following the key's state, e.g.
        // a different bar on each per-value face of a readout (user, 2026-10-30).
        body += bar(BAR_LOOKS.includes(L.look) ? L.look : ctx.state, { x, y, w, h, r: num(L.r, style.bar.r) });
      } else if (L.kind === 'rect') {
        body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${num(L.r, 0)}" fill="${esc(L.color || '#333333')}"/>`;
      }
    });
    return svgUri(body, face.background || '#000000');
  },
  // One slot's piece of a scene drawn across the whole panel.
  // scene: { rows: { 0: 'MSFS', 2: 'NOT CONNECTED' }, icons: { 7: dataUri }, color, offset }
  // Each text row is centred on its row of keys, as large as fits across the panel. offset slides
  // the text sideways (canvas units), so letters behind the bezels come into view (engine animates).
  scene(scene, slot) {
    const { cols, key, gap } = PANEL;
    const pitch = key + gap;
    const w = cols * key + (cols - 1) * gap;
    let body = '';
    const slotRow = Math.floor(slot / cols);
    for (const [row, text] of Object.entries(scene.rows || {})) {
      // Only this key's own row of text: keys elsewhere stay byte-identical while text slides,
      // so they are not resent.
      if (Number(row) !== slotRow) continue;
      body += lines(text, Number(row) * pitch + key / 2, { size: scene.size || 128, color: scene.color || style.label, x: w / 2 + (scene.offset || 0), width: w - 30 });
    }
    for (const [s, uri] of Object.entries(scene.icons || {})) {
      const ix = (Number(s) % cols) * pitch;
      const iy = Math.floor(Number(s) / cols) * pitch;
      body += `<image href="${uri}" xlink:href="${uri}" x="${ix}" y="${iy}" width="${key}" height="${key}"/>`;
    }
    const x = (slot % cols) * pitch;
    const y = Math.floor(slot / cols) * pitch;
    // The empty marker group identifies panel scenes (tests, debugging).
    return svgUri(`<g id="scene"/>${body}`, '#000000', `${x} ${y} ${key} ${key}`);
  },
  message(text) {
    return svgUri(lines(text, 72, { size: 24, color: style.dim }));
  },
  unavailable(label) {
    return svgUri(lines(label, 50, { size: 30 }) + lines('N/A', 104, { size: 24, color: style.off }));
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

module.exports = { Renderer, tiles, setStyle, style, DEFAULT_STYLE, FONTS };
