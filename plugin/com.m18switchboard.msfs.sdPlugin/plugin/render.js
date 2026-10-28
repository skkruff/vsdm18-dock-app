// Key images. Library icons where the profile names one and the file exists; otherwise generated
// SVG tiles styled like the library's RGB icons (black key, label, red/green/outlined state bar).
const STATE_COLORS = { on: '#b8f01c', off: '#f0204c' };
const LABEL = '#ffffff';
const DIM = '#9aa0a8';
const READOUT = '#ffd040';

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function svgUri(body, bg = '#000000') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
    `<rect width="144" height="144" fill="${bg}"/>${body}</svg>`;
  return 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
}

// Centred lines of text around y, shrinking the font for long lines.
function lines(text, y, { size = 26, color = LABEL, weight = 'bold' } = {}) {
  const ls = String(text).split('\n');
  const longest = Math.max(...ls.map(l => l.length));
  const fit = Math.min(size, Math.floor(230 / Math.max(longest, 1)));
  const step = fit * 1.1;
  const y0 = y - ((ls.length - 1) * step) / 2;
  return ls.map((l, i) =>
    `<text x="72" y="${y0 + i * step}" font-family="Arial, Helvetica, sans-serif" font-weight="${weight}" ` +
    `font-size="${fit}" fill="${color}" text-anchor="middle" dominant-baseline="middle">${esc(l)}</text>`).join('');
}

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
