// Color-identity analysis of screenshots: confirm teal/amber/gold palette
// presence, and that overlays render (large bright text regions).
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';

function decode(buf) {
  let off = 8;
  const idat = [];
  let w = 0, h = 0, ch = 0;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') { w = buf.readUInt32BE(off + 8); h = buf.readUInt32BE(off + 12); ch = buf[off + 17] === 6 ? 4 : 3; }
    else if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    const rowIn = raw.subarray(pos, pos + stride);
    const rowOut = out.subarray(y * stride, (y + 1) * stride);
    if (f === 0) rowIn.copy(rowOut);
    else {
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? rowOut[x - ch] : 0;
        const b = prev[x];
        const c = x >= ch ? prev[x - ch] : 0;
        let v = rowIn[x];
        if (f === 1) v = (v + a) & 0xff;
        else if (f === 2) v = (v + b) & 0xff;
        else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
        else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff; }
        rowOut[x] = v;
      }
    }
    prev = rowOut;
    pos += stride;
  }
  return { w, h, ch, out };
}

function palette(buf) {
  const { w, h, ch, out } = decode(buf);
  let teal = 0, amber = 0, gold = 0, blue = 0, bright = 0, nonblack = 0, total = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * ch;
      const r = out[i], g = out[i + 1], b = out[i + 2];
      total++;
      const lum = (r + g + b) / 3;
      if (lum > 12) nonblack++;
      if (lum > 190) bright++;
      // teal: green dominant, blue strong, red low
      if (g > 90 && b > 70 && r < g * 0.55 && b > r * 1.4) teal++;
      // amber: r & g high, b low
      if (r > 120 && g > 90 && b < r * 0.6) amber++;
      // gold: r high, g mid, b low but warm
      if (r > 150 && g > 110 && g < r * 0.95 && b < r * 0.45) gold++;
      // blue sky
      if (b > r && b > g && lum > 30 && lum < 120) blue++;
    }
  }
  const pct = (n) => ((n / total) * 100).toFixed(1) + '%';
  return { teal: pct(teal), amber: pct(amber), gold: pct(gold), blue: pct(blue), bright: pct(bright), nonblack: pct(nonblack), nonblack } ;
}

for (const f of ['01-ready-desktop', '02-playing-desktop', '03-won-desktop', '04-lost-desktop', '05-phone-playing']) {
  const buf = readFileSync('/workspace/test/shots/' + f + '.png');
  console.log(f, JSON.stringify(palette(buf)));
}