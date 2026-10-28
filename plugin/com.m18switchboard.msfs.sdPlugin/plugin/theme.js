// Measures the user's icon library so generated keys match it out of the box (user, 2026-10-28):
// the state bar's position, size, corner radius and colours from an on/off/clear icon set, and the
// accent colour (the sky blue line on set_altimeter) for readout values.
const { decode } = require('./png');

// Icon sets with on/off/clear versions to measure the bar from, tried in order.
const BAR_SOURCES = ['master_battery', 'lights_beacon', 'avionics_master', 'master_alternator', 'lights_nav_lights'];
const ACCENT_SOURCES = ['set_altimeter', 'magneto_both', 'magneto'];
const KEY = 144;

const hex = ([r, g, b]) => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

// Pixels matching pred: their bounding box, mean colour and count.
function region(img, pred, within) {
  const a = within || { x: 0, y: 0, w: img.width, h: img.height };
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, n = 0;
  const sum = [0, 0, 0];
  for (let y = a.y; y < a.y + a.h; y++) {
    for (let x = a.x; x < a.x + a.w; x++) {
      const p = img.rgba(x, y);
      if (p[3] < 128 || !pred(p)) continue;
      n++; sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return n ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, n, color: sum.map(s => s / n) } : null;
}

const isGreen = ([r, g, b]) => g > 150 && g > b + 70 && r < g + 10 && r > 60;
const isRed = ([r, g, b]) => r > 170 && r > g + 90 && r > b + 50;
const saturated = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) > 70 && Math.max(r, g, b) > 120;

// Corner radius of a filled rounded bar: how far in from the left its top row starts.
function cornerRadius(img, box, pred) {
  for (let x = box.x; x < box.x + box.w / 2; x++) {
    if (pred(img.rgba(x, box.y))) return x - box.x;
  }
  return 0;
}

function measure(icons) {
  const out = {};
  const load = (base, state) => {
    const file = icons.resolve(base, state);
    if (!file) return null;
    try { return decode(icons.read(file)); } catch (e) { return null; }
  };

  for (const base of BAR_SOURCES) {
    const on = load(base, 'on');
    const off = load(base, 'off');
    if (!on) continue;
    const g = region(on, isGreen);
    if (!g || g.w < g.h) continue; // not a horizontal bar
    const s = KEY / on.width;
    out.bar = { x: +(g.x * s).toFixed(1), y: +(g.y * s).toFixed(1), w: +(g.w * s).toFixed(1), h: +(g.h * s).toFixed(1),
      r: +(cornerRadius(on, g, isGreen) * s).toFixed(1) };
    out.on = hex(g.color);
    const r = off && region(off, isRed);
    if (r) out.off = hex(r.color);
    // Clear: the outline drawn where the bar would be.
    const clear = load(base, 'clear');
    if (clear) {
      const bg = clear.rgba(0, 0);
      const pad = 4;
      const area = { x: Math.max(0, g.x - pad), y: Math.max(0, g.y - pad), w: g.w + 2 * pad, h: g.h + 2 * pad };
      const o = region(clear, p => Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 90, area);
      if (o) {
        out.clearStroke = hex(o.color);
        // Stroke width: lit pixels along the middle row from the left edge inwards.
        const midY = o.y + Math.floor(o.h / 2);
        let wpx = 0;
        for (let x = o.x; x < o.x + o.w / 2; x++) {
          const p = clear.rgba(x, midY);
          if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 90) wpx++; else if (wpx) break;
        }
        if (wpx) out.clearWidth = +(wpx * s).toFixed(1);
      }
    }
    out.barSource = base;
    break;
  }

  for (const base of ACCENT_SOURCES) {
    const img = load(base, null);
    const a = img && region(img, saturated);
    if (a && a.n > 50) { out.readout = hex(a.color); out.readoutSource = base; break; }
  }
  return out;
}

module.exports = { measure };
