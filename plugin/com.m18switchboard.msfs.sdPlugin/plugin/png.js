// Minimal PNG reader, enough to find where an icon's content sits (its bounding box against the
// background) so it can be cropped and scaled onto part of a key. 8-bit, non-interlaced PNGs of
// any colour type; anything else returns null and callers fall back to the whole image.
const zlib = require('zlib');

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let pos = 8;
  let width, height, depth, colorType, interlace;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || !CHANNELS[colorType]) return null;
  const ch = CHANNELS[colorType];
  const stride = width * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[i - ch] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = v & 0xff;
    }
  }
  // RGBA of pixel (x, y)
  function rgba(x, y) {
    const o = y * stride + x * ch;
    switch (colorType) {
      case 0: return [px[o], px[o], px[o], 255];
      case 2: return [px[o], px[o + 1], px[o + 2], 255];
      case 3: {
        const i = px[o];
        return [palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], trns && i < trns.length ? trns[i] : 255];
      }
      case 4: return [px[o], px[o], px[o], px[o + 1]];
      default: return [px[o], px[o + 1], px[o + 2], px[o + 3]];
    }
  }
  return { width, height, rgba };
}

// Bounding box { x, y, w, h } of everything that differs from the top-left (background) pixel.
function contentBox(buf, threshold = 48) {
  const img = decode(buf);
  if (!img) return null;
  const bg = img.rgba(0, 0);
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y += 2) {
    for (let x = 0; x < img.width; x += 2) {
      const p = img.rgba(x, y);
      const visible = bg[3] < 128 ? p[3] >= 128
        : Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > threshold;
      if (!visible) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 2, h: y1 - y0 + 2, width: img.width, height: img.height };
}

module.exports = { decode, contentBox };
