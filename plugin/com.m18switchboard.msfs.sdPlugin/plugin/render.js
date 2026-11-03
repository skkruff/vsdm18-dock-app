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
// height (optional): the most the block of lines may take, top of the first capital to the
// bottom of the last line, so two-line labels shrink to fit their space (user, 2026-11-03: labels
// at 40 where they fit).
// Label, separator and sublabel stacked and centred between top and bottom (switches and buttons
// with a separator, user 2026-11-03); the label takes what space the others leave.
function stacked(label, sublabel, top, bottom) {
  const sepH = 7 + 20; // the line, a gap of 12 above (so it does not read as an underline) and 8 below
  const subH = sublabel ? SUBLABEL_SIZE * 0.7 + 8 : 0;
  const lab = textFit(label, { size: LABEL_SIZE, width: 128, height: bottom - top - sepH - subH });
  let y = top + (bottom - top - (lab.block + sepH + subH)) / 2;
  let body = lines(label, y + lab.block / 2, { size: LABEL_SIZE, width: 128, height: lab.block + 0.01 });
  y += lab.block + 12;
  body += separatorRect({ y: y + 3.5 });
  y += 15;
  if (sublabel) body += lines(sublabel, y + 8 + (SUBLABEL_SIZE * 0.7) / 2, { size: SUBLABEL_SIZE, color: style.dim });
  return body;
}
const LABEL_SIZE = 40; // automatic key labels, where they fit (user, 2026-11-03)
function textFit(text, { size = 26, width = 130, height } = {}) {
  const ls = String(text).split('\n');
  const f = font();
  if (!f) {
    const longest = Math.max(...ls.map(l => l.length), 1);
    const fit = Math.min(size, (width * 1.75) / longest, height ? height / (0.7 + (ls.length - 1) * 1.05) : Infinity);
    return { ls, f, fit, step: fit * 1.05, cap: 0.7, block: fit * (0.7 + (ls.length - 1) * 1.05) };
  }
  const cap = ((f.tables.os2 && f.tables.os2.sCapHeight) || f.unitsPerEm * 0.7) / f.unitsPerEm;
  const widest = Math.max(1, ...ls.map(l => layout(f, l, 1000, cap).width));
  const perLine = cap + (ls.length - 1) * (cap + 0.32);
  const fit = Math.max(4, Math.min(size, (width * 1000) / widest, height ? height / perLine : Infinity));
  return { ls, f, fit, step: fit * (cap + 0.32), cap, block: fit * perLine };
}
function lines(text, y, { size = 26, color = style.label, x = 72, width = 130, height } = {}) {
  const { ls, f, fit, step, cap } = textFit(text, { size, width, height });
  if (!f) return fallbackLines(ls, y, fit, color, x, width);
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

// The separator line: a rounded line about 64 x 7 key units, positioned by its centre, in the
// Look's separator colour (the readout colour until one is set, user 2026-11-03).
const SEPARATOR = { x: 72, w: 64, h: 7, r: 3.5 };
function separatorRect({ x = SEPARATOR.x, y, w = SEPARATOR.w, h = SEPARATOR.h, r = SEPARATOR.r, color } = {}) {
  return `<rect x="${(x - w / 2).toFixed(1)}" y="${(y - h / 2).toFixed(1)}" width="${w}" height="${h}" rx="${r}" fill="${esc(color || style.separator || style.readout)}"/>`;
}

// state: on / off / armed / clear, or { level: { min, max, value } } for a level bar in the bar's
// place (a rotary's automatic look, user 2026-11-03).
function bar(state, b = style.bar) {
  if (state && typeof state === 'object' && state.level) return level(state.level, state.level.value, b);
  const fill = style[state === 'on' || state === 'off' || state === 'armed' ? state : null];
  if (fill) return `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.r}" fill="${fill}"/>`;
  const sw = style.clearWidth;
  return `<rect x="${b.x + sw / 2}" y="${b.y + sw / 2}" width="${b.w - sw}" height="${b.h - sw}" rx="${Math.max(0, b.r - sw / 2)}" ` +
    `fill="none" stroke="${style.clearStroke}" stroke-width="${sw}"/>`;
}

// A level bar (user, 2026-11-03): an outline filled in proportion to the value between min and
// max, from one end (dir: right = fills from the left towards the right, left, up, down). The fill
// colour is the layer's colour, or a band's: bands [{ below, color } | { above, color }], the
// tightest band the value is in wins (e.g. fuel: yellow below 25, red below 10). An unknown value
// shows the empty outline.
const LEVEL_DIRS = ['right', 'left', 'up', 'down'];
function levelColor(L, v) {
  const bands = Array.isArray(L.bands) ? L.bands : [];
  const below = bands.filter(b => typeof b.below === 'number' && v < b.below).sort((a, b) => a.below - b.below)[0];
  const above = bands.filter(b => typeof b.above === 'number' && v > b.above).sort((a, b) => b.above - a.above)[0];
  return (below || above || {}).color || L.color || style.on;
}
function level(L, v, b) {
  const sw = style.clearWidth;
  const track = `<rect x="${b.x + sw / 2}" y="${b.y + sw / 2}" width="${Math.max(0, b.w - sw)}" height="${Math.max(0, b.h - sw)}" rx="${Math.max(0, b.r - sw / 2)}" ` +
    `fill="none" stroke="${esc(L.track || style.clearStroke)}" stroke-width="${sw}"/>`;
  if (typeof v !== 'number' || Number.isNaN(v)) return track;
  const min = num(L.min, 0), max = num(L.max, 100);
  const f = max === min ? 0 : Math.max(0, Math.min(1, (v - min) / (max - min)));
  if (f === 0) return track;
  const dir = LEVEL_DIRS.includes(L.dir) ? L.dir : 'right';
  // The fill is the bar's rounded shape cut at the level, drawn as a polygon. Not a clip path:
  // VSD Craft's renderer ignores clip-path, so the square fill showed past the round ends
  // (user, on the dock, 2026-11-03).
  const keep = {
    right: p => p[0] <= b.x + b.w * f, left: p => p[0] >= b.x + b.w * (1 - f),
    up: p => p[1] >= b.y + b.h * (1 - f), down: p => p[1] <= b.y + b.h * f,
  }[dir];
  const cut = dir === 'right' || dir === 'left'
    ? (a, c) => { const X = dir === 'right' ? b.x + b.w * f : b.x + b.w * (1 - f); const t = (X - a[0]) / (c[0] - a[0]); return [X, a[1] + t * (c[1] - a[1])]; }
    : (a, c) => { const Y = dir === 'down' ? b.y + b.h * f : b.y + b.h * (1 - f); const t = (Y - a[1]) / (c[1] - a[1]); return [a[0] + t * (c[0] - a[0]), Y]; };
  const shape = clipPolygon(roundedRectPoints(b), keep, cut);
  if (shape.length < 3) return track;
  const d = shape.map((p, i) => `${i ? 'L' : 'M'}${round2(p[0])} ${round2(p[1])}`).join('') + 'Z';
  return `<path d="${d}" fill="${esc(levelColor(L, v))}"/>` + track;
}
const round2 = n => Math.round(n * 100) / 100;
// A rounded rectangle as a polygon (each corner as a quarter circle of 8 segments).
function roundedRectPoints({ x, y, w, h, r }) {
  const rr = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  const pts = [];
  const corner = (cx, cy, from) => { for (let i = 0; i <= 8; i++) { const a = (from + i * 90 / 8) * Math.PI / 180; pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); } };
  corner(x + w - rr, y + rr, -90); // top right
  corner(x + w - rr, y + h - rr, 0); // bottom right
  corner(x + rr, y + h - rr, 90); // bottom left
  corner(x + rr, y + rr, 180); // top left
  return pts;
}
// Sutherland-Hodgman against one straight edge: keep(p) says which side stays, cut(a, b) where
// the edge crosses a-b.
function clipPolygon(pts, keep, cut) {
  const out = [];
  pts.forEach((c, i) => {
    const a = pts[(i + pts.length - 1) % pts.length];
    const ka = keep(a), kc = keep(c);
    if (kc) { if (!ka) out.push(cut(a, c)); out.push(c); } else if (ka) out.push(cut(a, c));
  });
  return out;
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
const SUBLABEL_SIZE = 25; // was 19 (user, 2026-11-03)

const tiles = {
  // state: on | off | clear (unknown). sublabel: optional line under the label, e.g. ARM.
  switch(label, state, sublabel, separator) {
    if (separator) return svgUri(stacked(label, sublabel, 10, style.bar.y - 8) + bar(state));
    const top = style.bar.y;
    // The label in the space above the sublabel (or the bar), at LABEL_SIZE where it fits.
    const bottom = sublabel ? top * 0.78 - 15 : top - 10;
    return svgUri(lines(label, (10 + bottom) / 2, { size: LABEL_SIZE, width: 128, height: bottom - 10 }) +
      (sublabel ? lines(sublabel, top * 0.78, { size: SUBLABEL_SIZE, color: style.dim }) : '') + bar(state));
  },
  button(label, sublabel, separator) {
    if (separator) return svgUri(stacked(label, sublabel, 10, 134));
    const bottom = sublabel ? 90 : 134;
    return svgUri(lines(label, (10 + bottom) / 2, { size: LABEL_SIZE, width: 128, height: bottom - 10 }) +
      (sublabel ? lines(sublabel, 104, { size: SUBLABEL_SIZE, color: style.dim }) : ''));
  },
  // opts (user, 2026-11-03): showValue false hides the number; state draws the state bar under it.
  readout(label, value, sublabel, separator, { showValue = true, state } = {}) {
    const withBar = state !== undefined && state !== null;
    if (!showValue) return withBar ? tiles.switch(label, state, sublabel, separator) : tiles.button(label, sublabel, separator);
    if (withBar) {
      // Label, separator and sublabel stacked from the top; the value centred above the bar.
      const lab = textFit(label, { size: LABEL_SIZE, width: 130, height: 24 });
      let next = 8 + lab.block + 6;
      let body = lines(label, 8 + lab.block / 2, { size: LABEL_SIZE, width: 130, height: 24 });
      if (separator) { body += separatorRect({ y: next + 10 }); next += 18; }
      if (sublabel) { body += lines(sublabel, next + 10, { size: SUBLABEL_SIZE, color: style.dim }); next += 25; }
      return svgUri(body + lines(value, (next + style.bar.y) / 2, { size: 30, color: style.readout, width: 132 }) + bar(state));
    }
    if (!separator) {
      const lb = sublabel ? 40 : 50; // the label's space: 10 down to lb
      return svgUri(lines(label, (10 + lb) / 2, { size: LABEL_SIZE, width: 130, height: lb - 10 }) +
        (sublabel ? lines(sublabel, 54, { size: SUBLABEL_SIZE, color: style.dim }) : '') +
        lines(value, sublabel ? 102 : 96, { size: sublabel ? 42 : 46, color: style.readout, width: 132 }));
    }
    // With a separator under the label (and sublabel): stack down from the label, the value
    // centred in the space left.
    const lab = textFit(label, { size: LABEL_SIZE, width: 130, height: 40 });
    let y = 10 + lab.block; // bottom of the label
    let body = lines(label, 10 + lab.block / 2, { size: LABEL_SIZE, width: 130, height: 40 });
    if (sublabel) { body += lines(sublabel, y + 14, { size: SUBLABEL_SIZE, color: style.dim }); y += 28; }
    body += separatorRect({ y: y + 9 });
    y += 13;
    return svgUri(body + lines(value, (y + 140) / 2, { size: sublabel ? 40 : 44, color: style.readout, width: 132 }));
  },
  // A library icon's content scaled into the top of the key, with a live value below.
  // Keypad keys (keypad.js): a big digit or word, dimmed when not available; colour by role.
  keypadKey(text, { role = 'digit', dim = false, sublabel = '' } = {}) {
    const color = dim ? '#3a3f47' : role === 'ent' ? style.on : role === 'cancel' ? style.off : style.label;
    const size = role === 'digit' ? 64 : 34;
    return svgUri(`<rect x="6" y="6" width="132" height="132" rx="14" fill="none" stroke="${dim ? '#22262c' : '#3a4250'}" stroke-width="3"/>` +
      lines(text, sublabel ? 62 : 72, { size, color, width: 112 }) +
      (sublabel ? lines(sublabel, 112, { size: SUBLABEL_SIZE, color: dim ? '#3a3f47' : style.dim }) : ''));
  },
  // A library icon, faded: a keypad key that does nothing right now.
  dimIcon(uri) {
    return svgUri(`<image href="${uri}" xlink:href="${uri}" x="0" y="0" width="144" height="144" opacity="0.3"/>`);
  },
  // The keypad's title (what is being set, and its value now) and the digits typed so far.
  keypadTitle(title, now) {
    return svgUri(lines(title, now ? 42 : 72, { size: 28, width: 130 }) + (now ? lines(now, 96, { size: 38, color: style.dim, width: 132 }) : ''));
  },
  keypadTyped(text) {
    return svgUri(lines(text, 72, { size: 56, color: style.readout, width: 136 }));
  },
  // A library icon has no armed version: its clear version with the bar filled in the armed colour.
  // The bar geometry is the one measured from the user's icons, so the fill lands on their outline.
  armedIcon(clearUri) {
    return svgUri(placedIcon(clearUri, null, { x: 0, y: 0, w: 144, h: 144 }, 'armed', 'full') + bar('armed'));
  },
  iconReadout(iconUri, value, box, sublabel, { showValue = true, state } = {}) {
    const withBar = state !== undefined && state !== null;
    if (withBar || !showValue) {
      const top = withBar ? style.bar.y - 6 : 138; // bottom of the space above the bar
      let body = '';
      if (showValue) {
        body += placedIcon(iconUri, box, { x: 6, y: 4, w: 132, h: sublabel ? 34 : 42 }, 'top');
        if (sublabel) body += lines(sublabel, 48, { size: SUBLABEL_SIZE, color: style.dim });
        body += lines(value, sublabel ? 72 : 66, { size: 30, color: style.readout, width: 132 });
      } else {
        body += placedIcon(iconUri, box, { x: 6, y: 6, w: 132, h: top - (sublabel ? 32 : 6) }, 'top');
        if (sublabel) body += lines(sublabel, top - 14, { size: SUBLABEL_SIZE, color: style.dim });
      }
      return svgUri(body + (withBar ? bar(state) : ''));
    }
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
  //   { kind: 'separator', x, y, w, h, r, color }                 a rounded line, centred on (x, y)
  //   { kind: 'rect', x, y, w, h, r, color }
  //   { kind: 'level', x, y, w, h, r, dir, min, max, color, track, bands, read? }
  //                                                                a bar filled by the value: see level()
  // ctx: { iconFor(name) -> { uri, box } | null, valueFor(layer) -> string, numberFor(layer), state }
  face(face, ctx) {
    let body = '';
    (face.layers || []).forEach((L, n) => {
      // A bar without its own position sits where the standard bar does.
      const d = L.kind === 'bar' || L.kind === 'level' ? style.bar : { x: 0, y: 0, w: 144, h: 144 };
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
      } else if (L.kind === 'separator') {
        body += separatorRect({ x: num(L.x, SEPARATOR.x), y: num(L.y, 56), w: num(L.w, SEPARATOR.w), h: num(L.h, SEPARATOR.h), r: num(L.r, SEPARATOR.r), color: L.color });
      } else if (L.kind === 'rect') {
        body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${num(L.r, 0)}" fill="${esc(L.color || '#333333')}"/>`;
      } else if (L.kind === 'level') {
        body += level(L, ctx.numberFor ? ctx.numberFor(L) : undefined, { x, y, w, h, r: num(L.r, style.bar.r) });
      }
    });
    // dim: a keypad key that does nothing right now (keypad.js).
    return svgUri(ctx.dim ? `<g opacity="0.3">${body}</g>` : body, face.background || '#000000');
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
