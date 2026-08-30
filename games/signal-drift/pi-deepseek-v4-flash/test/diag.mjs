// Short diagnostic: boot, start, sample state, capture console errors, pixel stats.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

const CHROME = '/ms-playwright/chromium-1234/chrome-linux/chrome';
const PORT = 9334;
const OUT = new URL('./shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let idc = 0;
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        }
      } else {
        const ls = this.listeners.get(msg.method);
        if (ls) for (const fn of ls) fn(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++idc;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,720', 'about:blank',
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const targets = await r.json();
    target = targets.find((t) => t.type === 'page');
    if (target) break;
  } catch {}
  await sleep(250);
}
if (!target) { console.error('no target'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
const cdp = new CDP(ws);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
const errors = [];
cdp.on('Runtime.exceptionThrown', (p) => errors.push('EXC: ' + (p.exceptionDetails?.exception?.description || JSON.stringify(p.exceptionDetails)).slice(0, 400)));
cdp.on('Runtime.consoleAPICalled', (p) => {
  if (p.type === 'error' || p.type === 'warning') {
    const t = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
    errors.push(p.type.toUpperCase() + ': ' + t.slice(0, 300));
  }
});
await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
await sleep(2500);

const boot = await cdp.send('Runtime.evaluate', { expression: `JSON.stringify({ api: !!window.__AETHERPLAY__, canvas: !!document.querySelector('canvas'), w: innerWidth, h: innerHeight, ready: document.querySelector('#o-ready')?.classList.contains('hidden'), gl: (() => { const c = document.querySelector('canvas'); if (!c) return 'none'; return !!(c.getContext('webgl2') || c.getContext('webgl')); })() })`, returnByValue: true });
console.log('boot:', boot.result.value);

await cdp.send('Runtime.evaluate', { expression: `document.getElementById('btn-start').click()` });
await sleep(800);

// sample over 16 seconds, no input
for (let i = 0; i < 16; i++) {
  await sleep(1000);
  const r = await cdp.send('Runtime.evaluate', { expression: `JSON.stringify({ p: __AETHERPLAY__, t: performance.now().toFixed(0) })`, returnByValue: true });
  console.log('t+' + i + 's:', r.result.value);
}

// one steering nudge
await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
await sleep(1000);
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
const after = await cdp.send('Runtime.evaluate', { expression: `JSON.stringify(__AETHERPLAY__)`, returnByValue: true });
console.log('after steer:', after.result.value);

// screenshot + pixel stats
const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
const png = Buffer.from(shot.data, 'base64');
writeFileSync(OUT + 'diag.png', png);
console.log('screenshot bytes:', png.length);
console.log('stats:', pngStats(png));
console.log('errors:', errors.length ? JSON.stringify(errors, null, 1) : 'none');
chrome.kill();
process.exit(0);

function pngStats(buf) {
  // parse PNG: find IDAT chunks, inflate, sample alpha
  let off = 8;
  let idat = [];
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') {
      w = buf.readUInt32BE(off + 8);
      h = buf.readUInt32BE(off + 12);
      bitDepth = buf[off + 16];
      colorType = buf[off + 17];
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(off + 8, off + 8 + len));
    }
    off += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  // unfilter simple: iterate rows, apply filter 0/1/2/3/4 minimally (assume filter 0 common)
  let sum = 0, cnt = 0, nonzero = 0, dark = 0;
  const stride = w * ch;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    if (f !== 0) continue; // skip filtered rows for quick estimate
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += Math.max(1, Math.floor(stride / 400))) {
      const v = row[x];
      sum += v; cnt++; if (v > 10) nonzero++; if (v < 24) dark++;
    }
  }
  return {
    w, h,
    samples: cnt,
    avg: cnt ? (sum / cnt).toFixed(1) : -1,
    nonblackPct: cnt ? ((nonzero / cnt) * 100).toFixed(1) : -1,
    darkPct: cnt ? ((dark / cnt) * 100).toFixed(1) : -1,
  };
}