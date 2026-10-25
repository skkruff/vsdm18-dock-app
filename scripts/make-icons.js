// Generates the placeholder PNGs in the plugin's static/ folder with no image dependencies.
//   static/icon.png      plugin / action icon
//   static/test_144.png  144x144 test card: red edge border, green centre cross, quadrant colours.
//                        On the key, check whether the border is visible (no cropping) and
//                        whether the quadrants stay square (no stretching).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'plugin', 'com.m18switchboard.msfs.sdPlugin', 'static');
fs.mkdirSync(out, { recursive: true });

fs.writeFileSync(path.join(out, 'test_144.png'), png(144, 144, (x, y) => {
  if (x < 3 || y < 3 || x > 140 || y > 140) return [255, 40, 40];
  if (Math.abs(x - 72) < 2 || Math.abs(y - 72) < 2) return [40, 255, 40];
  if (x < 72) return y < 72 ? [30, 60, 160] : [160, 140, 30];
  return y < 72 ? [120, 30, 140] : [30, 130, 120];
}));

// Simple switch-like icon: dark key with a lit bar.
fs.writeFileSync(path.join(out, 'icon.png'), png(144, 144, (x, y) => {
  if (x > 40 && x < 104 && y > 30 && y < 114) return y < 72 ? [255, 200, 60] : [70, 70, 80];
  return [20, 30, 45];
}));

console.log('icons written to', out);
