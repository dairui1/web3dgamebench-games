/**
 * Headless browser verification harness for Signal Drift.
 * Drives the bundled Chromium via raw CDP (no external deps).
 * Usage: node scripts/browser-test.mjs [--mode=quick|full]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, '.screens');
const CHROME = '/ms-playwright/chromium-1234/chrome-linux/chrome';
const PORT = 8931;
const CDP_PORT = 9333;

mkdirSync(OUT, { recursive: true });

// ---- tiny static server ---------------------------------------------------
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.map': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = join(DIST, p);
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  const ext = file.slice(file.lastIndexOf('.'));
  res.writeHead(200, { 'content-type': mime[ext] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// ---- launch chromium ------------------------------------------------------
const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu-sandbox',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--hide-scrollbars',
  '--window-size=1280,800',
  `--remote-debugging-port=${CDP_PORT}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 20000, step = 100) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  throw new Error('waitFor timeout');
};

async function getWsUrl() {
  return waitFor(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      return page ? page.webSocketDebuggerUrl : null;
    } catch { return null; }
  });
}

const wsUrl = await getWsUrl();
const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = new Map();
const events = [];
const listeners = new Map();

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
    const ls = listeners.get(msg.method);
    if (ls) for (const l of ls) l(msg.params);
  }
};
await new Promise((r) => (ws.onopen = r));

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
function on(method, fn) {
  if (!listeners.has(method)) listeners.set(method, []);
  listeners.get(method).push(fn);
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result ? r.result.value : undefined;
}
function screenshot(name) {
  return send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'));
    console.log(`  [shot] ${name}`);
  });
}

// ---- minimal PNG decode for pixel sanity checks ---------------------------
const REV = [0, 4, 2, 6, 1, 5, 3, 7];
function decodePng(buf) {
  let pos = 8; // skip signature
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3; // RGBA or RGB
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let oi = 0;
  let ri = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[ri++];
    const line = raw.subarray(ri, ri + stride);
    ri += stride;
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v = (v + a) & 0xff;
      else if (f === 2) v = (v + b) & 0xff;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const src = x * bpp;
      out[oi] = cur[src]; out[oi + 1] = cur[src + 1]; out[oi + 2] = cur[src + 2]; out[oi + 3] = colorType === 6 ? cur[src + 3] : 255;
      oi += 4;
    }
    prev = cur;
  }
  return { width, height, data: out };
}

function regionStats(img, x0, y0, x1, y1) {
  const w = img.width, h = img.height;
  let sr = 0, sg = 0, sb = 0, n = 0, s2 = 0;
  const xa = Math.max(0, Math.floor(x0)), ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(w, Math.ceil(x1)), yb = Math.min(h, Math.ceil(y1));
  for (let y = ya; y < yb; y += 2) {
    for (let x = xa; x < xb; x += 2) {
      const i = (y * w + x) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      sr += r; sg += g; sb += b;
      const lum = (r + g + b) / 3;
      s2 += lum * lum;
      n++;
    }
  }
  const avgR = sr / n, avgG = sg / n, avgB = sb / n;
  const avgL = (avgR + avgG + avgB) / 3;
  const std = Math.sqrt(Math.max(0, s2 / n - avgL * avgL));
  return { avgR, avgG, avgB, avgL, std, n };
}

async function shotStats(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const img = decodePng(Buffer.from(r.data, 'base64'));
  const center = regionStats(img, img.width * 0.3, img.height * 0.3, img.width * 0.7, img.height * 0.7);
  const topLeft = regionStats(img, 0, 0, img.width * 0.3, img.height * 0.12);
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'));
  console.log(`  [shot] ${name} (center lum=${center.avgL.toFixed(1)} std=${center.std.toFixed(1)})`);
  return { center, topLeft };
}

async function colorPresence(name, fx0, fy0, fx1, fy1, pred) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const img = decodePng(Buffer.from(r.data, 'base64'));
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'));
  const w = img.width, h = img.height;
  const xa = Math.floor(w * fx0), ya = Math.floor(h * fy0), xb = Math.floor(w * fx1), yb = Math.floor(h * fy1);
  let n = 0;
  for (let y = ya; y < yb; y += 2) {
    for (let x = xa; x < xb; x += 2) {
      const i = (y * w + x) * 4;
      if (pred(img.data[i], img.data[i + 1], img.data[i + 2])) n++;
    }
  }
  return n;
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const canvasErrors = [];
const badResponses = [];
on('Runtime.exceptionThrown', (p) => canvasErrors.push(p.exceptionDetails?.text || 'exception'));
on('Log.entryAdded', (p) => { if (p.entry.level === 'error') canvasErrors.push(p.entry.text); });
on('Network.requestWillBeSent', (p) => {
  const u = new URL(p.request.url);
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost' && !u.protocol.startsWith('data')) {
    canvasErrors.push('NET:' + u.href);
  }
});
on('Network.responseReceived', (p) => {
  if (p.response?.status >= 400) badResponses.push(`${p.response.status} ${p.response.url}`);
});

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

async function navigate(path) {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${path}` });
  await send('Page.loadEventFired', {}).catch(() => {});
  await sleep(2500); // allow boot + shaders
}

async function setViewport(w, h, dpr = 1) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: dpr, mobile: w < 600,
  });
}

// ---- deterministic course plan port (mirrors src/game/course.ts buildPlan) ----
// Used ONLY to aim the test driver at orbs, like a human reading the trail.
function buildOrbPlan() {
  const mulberry32 = (s) => {
    let a = s >>> 0;
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  const rng = mulberry32(94721);
  const rangeJitter = (a, b) => a + rng() * (b - a);
  const GATE_ZS = [380, 920, 1520];
  const EXTRACT_Z = 2220;
  const PLAN_END = EXTRACT_Z + 780;
  const orbs = [];
  const addOrb = (x, y, z) => { if (z > 20 && z < PLAN_END) orbs.push([x, y, z]); };
  const orbLine = (cx, cy, cz, n, spacing, curve, dy) => { for (let i = 0; i < n; i++) { const f = i / Math.max(1, n - 1) - 0.5; addOrb(cx + Math.sin(f * 2.1) * curve, cy + f * dy, cz + i * spacing); } };
  const orbHoop = (cx, cy, cz, n, radius) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rng() * 0.6; addOrb(cx + Math.cos(a) * radius * (0.8 + rng() * 0.4), cy + Math.sin(a) * radius * 0.8, cz + rng() * 6); } };
  const orbScatter = (cz, n) => { for (let i = 0; i < n; i++) addOrb((rng() - 0.5) * 52, 4 + rng() * 17, cz + rng() * 26); };
  const drones = [];
  const tumblers = [];
  const strikers = [];
  const pylons = [];
  let z = 40;
  let chunk = 0;
  let gateIdx = 0;
  const gateZ = () => (gateIdx < GATE_ZS.length ? GATE_ZS[gateIdx] : Infinity);
  while (z < PLAN_END) {
    const gz = gateZ();
    let len = 135 + rng() * 65;
    if (gz < z + len + 40) len = Math.max(64, gz - z - 12);
    const zEnd = z + len;
    chunk++;
    const nearGate = gz - z < 90;
    const groups = chunk <= 1 ? 3 : rng() < 0.35 ? 2 : 3;
    for (let g = 0; g < groups; g++) {
      const cz = rangeJitter(z + 14, Math.min(zEnd - 14, gz - 30));
      if (cz <= z + 12) continue;
      const roll = rng();
      if (roll < 0.5) {
        const cx = (rng() - 0.5) * 30;
        orbLine(cx, 5 + rng() * 15, cz, 3 + Math.floor(rng() * 3), 15 + rng() * 7, 7 + rng() * 9, 3 + rng() * 6);
      } else if (roll < 0.8) {
        orbHoop((rng() - 0.5) * 20, 7 + rng() * 11, cz, 5 + Math.floor(rng() * 2), 5 + rng() * 4.5);
      } else {
        orbScatter(cz, 3 + Math.floor(rng() * 3));
      }
    }
    const safeZone = chunk <= 2 || nearGate;
    if (!safeZone) {
      const p = rng();
      if (p < 0.34) {
        const cx = (rng() - 0.5) * 30;
        const cy = 4 + rng() * 15;
        drones.push({ z: rangeJitter(z + 10, zEnd - 10), cx, cy, ax: 6 + rng() * 8, ay: 3 + rng() * 4, fx: 0.5 + rng() * 0.8, fy: 0.4 + rng() * 0.9, px: rng() * 6.28, py: rng() * 6.28 });
      } else if (p < 0.6) {
        tumblers.push({ z: rangeJitter(z + 12, zEnd - 12), bx: (rng() - 0.5) * 32, y: 5 + rng() * 14, scale: 3.6 + rng() * 1.9, ph: rng() * 6.28, rx: rng(), ry: rng(), rz: rng(), rs: 0.4 + rng() * 0.8 });
      } else if (p < 0.85) {
        const cx = (rng() - 0.5) * 26;
        const cy = 6 + rng() * 12;
        const dz = rangeJitter(z + 10, zEnd - 10);
        drones.push({ z: dz, cx: cx - 6, cy: cy + 4, ax: 7 + rng() * 6, ay: 3, px: 0.6, py: 2.1 });
        drones.push({ z: dz + 26, cx: cx + 6, cy: cy - 4, ax: 7 + rng() * 6, ay: 3, px: 3.5, py: 4.4 });
      } else {
        tumblers.push({ z: rangeJitter(z + 12, zEnd - 12), bx: -10 - rng() * 8, y: 6 + rng() * 10, scale: 3.4 + rng() * 1.4, ph: rng() * 6.28, rx: rng(), ry: rng(), rz: rng(), rs: 0.5 + rng() * 0.6 });
        drones.push({ z: rangeJitter(z + 16, zEnd - 10), cx: 12 + rng() * 8, cy: 8 + rng() * 10, ax: 5 + rng() * 5, ay: 4, fx: 0.6 + rng() * 0.5, fy: 0.5 + rng() * 0.6, px: rng() * 6.28, py: rng() * 6.28 });
      }
    }
    z = zEnd + 16;
    if (z >= gz - 24) z = gz + 26;
    if (chunk % 2 === 1) {
      const px = (rng() < 0.5 ? -1 : 1) * (37 + rng() * 6);
      const h = 20 + rng() * 14;
      pylons.push({ z: z - 26, x: px, h });
    }
    let gi = 0;
    while (gi < GATE_ZS.length && GATE_ZS[gi] < z) gi++;
    gateIdx = gi;
  }
  const s1 = 1060 + Math.floor(rng() * 180);
  const s2 = 1720 + Math.floor(rng() * 220);
  strikers.push({ z0: s1, x0: (rng() - 0.5) * 22, y0: 6 + rng() * 12, ph: rng() * 6.28 });
  strikers.push({ z0: s2, x0: (rng() - 0.5) * 22, y0: 6 + rng() * 12, ph: rng() * 6.28 });
  return { orbs, drones, tumblers, strikers, pylons };
}
const ORB_PLAN = buildOrbPlan().orbs;
// cross-check the port against the in-game plan count (193 orbs for seed 94721)
if (ORB_PLAN.length !== 193) {
  console.error(`WARN: orb plan port mismatch (${ORB_PLAN.length} vs 193)`);
}
async function pressKey(code, mods = {}) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: mods.key || code, windowsVirtualKeyCode: mods.vk || 0, modifiers: mods.mods || 0 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: mods.key || code, windowsVirtualKeyCode: mods.vk || 0, modifiers: mods.mods || 0 });
}
async function holdKey(code, holdMs, mods = {}) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: mods.key || code, windowsVirtualKeyCode: mods.vk || 0, modifiers: mods.mods || 0 });
  await sleep(holdMs);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: mods.key || code, windowsVirtualKeyCode: mods.vk || 0, modifiers: mods.mods || 0 });
}

// ===========================================================================
console.log('== DESKTOP ==');
await setViewport(1280, 800, 1);
await navigate('index.html');

// title viewport
await sleep(1200);
let bench = await evalJs('JSON.stringify(window.__WEB3DGAMEBENCH__)');
bench = JSON.parse(bench || 'null');
check('contract exists', !!bench && bench.phase === 'ready' && bench.seed === 94721, JSON.stringify(bench));
if (bench) {
  check('ready contract fields', ['phase', 'score', 'player', 'relaysRestored', 'charge', 'seed', 'restartCount'].every((k) => k in bench));
  check('player finite ready', [bench.player.x, bench.player.y, bench.player.z].every(Number.isFinite));
  check('charge 100 ready', bench.charge === 100);
  check('restartCount 0 ready', bench.restartCount === 0);
}
await screenshot('01-title-desktop.png');
const tStats = await shotStats('01-title-desktop.png');
check('title screen: scene visible (not empty/black)', tStats.center.std > 4, `center std=${tStats.center.std.toFixed(1)}`);
const titleVisible = await evalJs(`!document.querySelector('#title').classList.contains('hidden')`);
const hudHidden = await evalJs(`document.querySelector('#hud').classList.contains('hidden')`);
check('title overlay visible at ready', titleVisible === true);
check('hud hidden at ready', hudHidden === true);

// start via button click (real DOM event)
await evalJs(`document.querySelector('#btn-start').click()`);
await sleep(1500);
bench = JSON.parse((await evalJs('JSON.stringify(window.__WEB3DGAMEBENCH__)')) || 'null');
check('phase playing after start', bench?.phase === 'playing', JSON.stringify(bench));
check('craft moving forward', bench && bench.player.z > 5, `z=${bench?.player?.z}`);
check('charge drains during play', bench && bench.charge < 100, `charge=${bench?.charge}`);
const pStats = await shotStats('02-playing-desktop.png');
check('gameplay: scene rendered with content', pStats.center.std > 5, `center std=${pStats.center.std.toFixed(1)}`);

// pause test: P key
await pressKey('KeyP');
await sleep(600);
bench = JSON.parse((await evalJs('JSON.stringify(window.__WEB3DGAMEBENCH__)')) || 'null');
check('phase paused on P', bench?.phase === 'paused');
await screenshot('03-paused-desktop.png');
await pressKey('KeyP');
await sleep(600);

// visibility pause test
await evalJs(`
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  true;
`);
await sleep(600);
bench = JSON.parse((await evalJs('JSON.stringify(window.__WEB3DGAMEBENCH__)')) || 'null');
check('auto-pause on visibility hidden', bench?.phase === 'paused');
await evalJs(`
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
  true;
`);
await sleep(600);

// resume via key
await pressKey('KeyP');
await sleep(600);

// full run: fly forward, boost when healthy, gentle weave, recenter at gates
console.log('== FULL RUN (desktop, boosted + weave) ==');
const GATE_Z = [380, 920, 1520, 2220];
const t0 = Date.now();
let relaysSeen = 0;
let wonYet = null;
let lost = null;
let latKey = 0; // -1 A, 0 none, 1 D
let altKey = 0; // -1 S, 0 none, 1 W
let boostHeld = false;
const keyDown = async (code, vk) => send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: code, windowsVirtualKeyCode: vk, modifiers: 0 });
const keyUp = async (code, vk) => send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code, windowsVirtualKeyCode: vk, modifiers: 0 });
const setLat = async (v) => {
  if (latKey === v) return;
  if (latKey === -1) await keyUp('KeyA', 65);
  if (latKey === 1) await keyUp('KeyD', 68);
  if (v === -1) await keyDown('KeyA', 65);
  if (v === 1) await keyDown('KeyD', 68);
  latKey = v;
};
const setAlt = async (v) => {
  if (altKey === v) return;
  if (altKey === 1) await keyUp('KeyW', 87);
  if (altKey === -1) await keyUp('KeyS', 83);
  if (v === 1) await keyDown('KeyW', 87);
  if (v === -1) await keyDown('KeyS', 83);
  altKey = v;
};
while (Date.now() - t0 < 180000) {
  bench = JSON.parse((await evalJs('JSON.stringify(window.__WEB3DGAMEBENCH__)')) || 'null');
  if (!bench) { await sleep(250); continue; }
  if (bench.relaysRestored > relaysSeen) {
    relaysSeen = bench.relaysRestored;
    console.log(`  relay ${relaysSeen}/3 restored at z=${bench.player.z.toFixed(0)} t=${((Date.now() - t0) / 1000).toFixed(1)}s charge=${bench.charge.toFixed(0)}`);
    await shotStats(`04-relay-${relaysSeen}-desktop.png`);
  }
  if (bench.phase === 'won') { wonYet = bench; break; }
  if (bench.phase === 'lost') { lost = bench; break; }

  const z = bench.player.z;
  const x = bench.player.x;
  const nextGate = GATE_Z[bench.relaysRestored] ?? 99999;
  const gateAhead = nextGate - z < 130 && nextGate - z > -15;
  // debug: snapshot the moment the craft crosses the next gate plane
  if (z >= nextGate - 2 && z <= nextGate + 40 && globalThis.__snapKey !== bench.relaysRestored) {
    globalThis.__snapKey = bench.relaysRestored;
    console.log(`  cross ${bench.relaysRestored === 3 ? 'EXTRACT' : 'relay' + (bench.relaysRestored + 1)} z=${z.toFixed(1)} x=${x.toFixed(1)} y=${bench.player.y.toFixed(1)} relays=${bench.relaysRestored}`);
  }
  // (gate-glow screenshots happen in a dedicated pass after the run so they never stall the pilot)
  // watchdog: if the required gateway was missed, relaunch and try again
  if (bench.relaysRestored < 3 && nextGate - z < -40) {
    console.log(`  gate ${bench.relaysRestored + 1} missed — relaunching at z=${z.toFixed(0)} x=${x.toFixed(1)} y=${bench.player.y.toFixed(1)} charge=${bench.charge.toFixed(1)}`);
    await setLat(0); await setAlt(0);
    if (boostHeld) { await keyUp('Space', 32); boostHeld = false; }
    await pressKey('KeyR');
    await sleep(900);
    relaysSeen = 0;

    continue;
  }
  let targetX;
  let targetY = 12;
  if (gateAhead) {
    targetX = 0; // recenter for the gate
  } else {
    // aim at the nearest orb ahead (chase collectables like a player would)
    const orbList = ORB_PLAN;
    let best = null;
    let bestScore = Infinity;
    for (const o of orbList) {
      if (o[2] < z - 5 || o[2] > z + 190) continue;
      const s = (o[2] - z) + Math.abs(o[0] - x) * 0.5 + Math.abs(o[1] - bench.player.y) * 0.5;
      if (s < bestScore) { bestScore = s; best = o; }
    }
    if (best) { targetX = best[0]; targetY = best[1]; }
    else targetX = Math.sin((Date.now() - t0) / 2400) * 12;
  }
  await setLat(targetX < x ? -1 : targetX > x ? 1 : 0);
  await setAlt(bench.player.y < targetY - 0.6 ? 1 : bench.player.y > targetY + 0.6 ? -1 : 0);
  // boost only when charge is healthy
  const wantBoost = bench.charge > 40;
  if (wantBoost && !boostHeld) { await keyDown('Space', 32); boostHeld = true; }
  if (!wantBoost && boostHeld) { await keyUp('Space', 32); boostHeld = false; }
  await sleep(130);
}
if (boostHeld) await keyUp('Space', 32);
await setLat(0);
await setAlt(0);

if (lost) {
  check('full run: not lost', false, `lost at z=${lost.player.z.toFixed(0)} charge=${lost.charge.toFixed(1)}`);
  await screenshot('05-lost-desktop.png');
} else if (wonYet) {
  check('full run: won with all three relays', wonYet.relaysRestored === 3,
    `relays=${wonYet.relaysRestored} z=${wonYet.player.z.toFixed(0)} charge=${wonYet.charge.toFixed(1)} score=${wonYet.score}`);
  await sleep(1000); // cinematic pull-back, before the overlay fades in at ~1.4s
  const ws = await shotStats('05-won-desktop.png');
  check('won: scene has content', ws.center.std > 3, `std=${ws.center.std.toFixed(1)}`);
  await sleep(700);
  const wonOverlayVisible = await evalJs(`!document.querySelector('#won').classList.contains('hidden')`);
  check('won: overlay with stats appears', wonOverlayVisible === true);
} else {
  check('full run: won', false, `timeout; phase=${bench?.phase} relays=${bench?.relaysRestored} z=${bench?.player.z.toFixed(0)}`);
  await screenshot('05-timeout-desktop.png');
}

// restart test
await pressKey('KeyR');
await sleep(300);
bench = JSON.parse((await evalJs('JSON.stringify(window.__WEB3DGAMEBENCH__)')) || 'null');
check('restart: phase playing', bench?.phase === 'playing');
check('restart: restartCount=1', bench?.restartCount === 1, `restartCount=${bench?.restartCount}`);
check('restart: state reset', bench?.relaysRestored === 0 && bench.charge > 95 && bench.player.z < 120,
  `relays=${bench?.relaysRestored} charge=${bench?.charge?.toFixed(0)} z=${bench?.player?.z?.toFixed(0)}`);

// dedicated gate-glow pass: fresh run, capture relay 1 glowing ahead (no in-loop screenshots)
{
  await pressKey('KeyR');
  await sleep(400);
  const tG = Date.now();
  let shotGate = false;
  while (Date.now() - tG < 25000) {
    bench = JSON.parse((await evalJs('JSON.stringify(window.__WEB3DGAMEBENCH__)')) || 'null');
    if (!bench) { await sleep(150); continue; }
    // fly centered toward relay 1
    await setLat(bench.player.x > 0.3 ? -1 : bench.player.x < -0.3 ? 1 : 0);
    await setAlt(bench.player.y > 12.3 ? -1 : bench.player.y < 11.7 ? 1 : 0);
    if (!shotGate && bench.player.z >= 250 && bench.player.z <= 340) {
      shotGate = true;
      await setLat(0);
      await setAlt(0);
      await shotStats('04-approach-1-desktop.png');
      const amber = await colorPresence('04-approach-1-desktop.png', 0.3, 0.3, 0.7, 0.7, (r, g, b) => r > 120 && g > 70 && b < 95);
      check('relay 1: amber gate glow visible ahead', amber > 5, `amber px=${amber}`);
    }
    if (shotGate && bench.player.z > 400) break;
    await sleep(120);
  }
  check('gate glow pass captured', shotGate === true);
}

// ===========================================================================
console.log('== PHONE 390x844 ==');
await setViewport(390, 844, 2);
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await navigate('index.html');
await sleep(1200);
bench = JSON.parse((await evalJs('JSON.stringify(window.__WEB3DGAMEBENCH__)')) || 'null');
check('phone: contract ready', bench?.phase === 'ready');
await screenshot('06-title-phone.png');
await evalJs(`document.querySelector('#btn-start').click()`);
await sleep(1500);
bench = JSON.parse((await evalJs('JSON.stringify(window.__WEB3DGAMEBENCH__)')) || 'null');
check('phone: playing', bench?.phase === 'playing');
await screenshot('07-playing-phone.png');

// touch drag simulation: swipe right then up-left
const cx = 195, cy = 500;
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + 70, y: cy, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + 90, y: cy - 55, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(700);
bench = JSON.parse((await evalJs('JSON.stringify(window.__WEB3DGAMEBENCH__)')) || 'null');
check('phone: steer via touch moved craft x', bench && Math.abs(bench.player.x) > 1, `x=${bench?.player?.x?.toFixed(1)}`);
await screenshot('08-touch-phone.png');

// phone run: brief boost hold with two fingers
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 400, id: 1 }, { x: 290, y: 400, id: 2 }] });
await sleep(1500);
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
bench = JSON.parse((await evalJs('JSON.stringify(window.__WEB3DGAMEBENCH__)')) || 'null');
check('phone: two-finger boost advanced', bench && bench.player.z > 60, `z=${bench?.player?.z?.toFixed(0)}`);
await screenshot('09-phone-run.png');

// phone idle 8s for stability + drain
await sleep(4000);
bench = JSON.parse((await evalJs('JSON.stringify(window.__WEB3DGAMEBENCH__)')) || 'null');
await screenshot('10-phone-later.png');

// console errors?
const realErrors = canvasErrors.filter((e) => !/NET:/.test(e));
const netErrors = canvasErrors.filter((e) => /NET:/.test(e));
check('no runtime JS errors', realErrors.length === 0, realErrors.slice(0, 4).join(' | '));
check('no external network requests', netErrors.length === 0, netErrors.slice(0, 4).join(' | '));
check('no 4xx/5xx responses', badResponses.length === 0, badResponses.slice(0, 4).join(' | '));

// final report
console.log('\n== SUMMARY ==');
let fails = 0;
for (const r of results) if (!r.ok) fails++;
console.log(`${results.length - fails}/${results.length} checks passed`);
if (fails) {
  for (const r of results) if (!r.ok) console.log(`  FAILED: ${r.name} ${r.detail}`);
}

server.close();
chrome.kill();
process.exit(fails ? 1 : 0);