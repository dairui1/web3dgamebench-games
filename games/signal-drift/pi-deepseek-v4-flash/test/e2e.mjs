// End-to-end browser test: boots the game, plays it via real input events,
// drives an autopilot to victory, then through a scripted loss, at desktop
// and 390x844 phone viewports. All checks are against the public API.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

const CHROME = '/ms-playwright/chromium-1234/chrome-linux/chrome';
const PORT = 9336;
const GAME = 'http://127.0.0.1:4173/';
const OUT = new URL('./shots/', import.meta.url).pathname;

const failures = [];
function ck(cond, msg) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg);
  if (!cond) failures.push(msg);
}

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

// ---------- PNG pixel stats (decode + unfilter all filter types) ----------
function pngStats(buf) {
  let off = 8;
  const idat = [];
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') {
      w = buf.readUInt32BE(off + 8);
      h = buf.readUInt32BE(off + 12);
      bitDepth = buf[off + 16];
      colorType = buf[off + 17];
    } else if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = w * ch;
  const out = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    const rowIn = raw.subarray(pos, pos + stride);
    const rowOut = out.subarray(y * stride, (y + 1) * stride);
    if (f === 0) {
      rowIn.copy(rowOut);
    } else {
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? rowOut[x - ch] : 0;
        const b = prev[x];
        const c = x >= ch ? prev[x - ch] : 0;
        let v = rowIn[x];
        if (f === 1) v = (v + a) & 0xff;
        else if (f === 2) v = (v + b) & 0xff;
        else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
        else {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 0xff;
        }
        rowOut[x] = v;
      }
    }
    prev = rowOut;
    pos += stride;
  }
  let sum = 0, cnt = 0, nonblack = 0, dark = 0;
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * ch;
      const lum = ch === 1 ? out[i] : (out[i] + out[i + 1] + out[i + 2]) / 3;
      sum += lum;
      cnt++;
      if (lum > 12) nonblack++;
      if (lum < 26) dark++;
    }
  }
  return { w, h, avg: (sum / cnt).toFixed(1), nonblackPct: ((nonblack / cnt) * 100).toFixed(1), darkPct: ((dark / cnt) * 100).toFixed(1) };
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(r.data, 'base64');
  writeFileSync(OUT + name + '.png', buf);
  const st = pngStats(buf);
  console.log(`  [shot] ${name} ${st.w}x${st.h} avg=${st.avg} nonblack=${st.nonblackPct}% dark=${st.darkPct}%`);
  return st;
}

async function evalJs(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)).slice(0, 300));
  return r.result.value;
}
async function state(cdp) {
  return JSON.parse(await evalJs(cdp, `JSON.stringify(__AETHERPLAY__)`));
}
async function click(cdp, selector) {
  return evalJs(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'missing'; el.click(); return 'ok'; })()`);
}
async function key(cdp, k, code, vk, up = false) {
  await cdp.send('Input.dispatchKeyEvent', { type: up ? 'keyUp' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}
const HOLD = new Set();
async function hold(cdp, k, code, vk) {
  if (HOLD.has(k)) return;
  HOLD.add(k);
  await key(cdp, k, code, vk);
}
async function release(cdp, k, code, vk) {
  if (!HOLD.has(k)) return;
  HOLD.delete(k);
  await key(cdp, k, code, vk, true);
}
async function releaseAllKeys(cdp) {
  const map = {
    ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37],
    ArrowRight: ['ArrowRight', 'ArrowRight', 39],
    ArrowUp: ['ArrowUp', 'ArrowUp', 38],
    ArrowDown: ['ArrowDown', 'ArrowDown', 40],
    Shift: ['Shift', 'ShiftLeft', 16],
  };
  for (const k of [...HOLD]) {
    const m = map[k];
    if (m) await release(cdp, ...m);
  }
}

// ---------------- launch ----------------
mkdirSync(OUT, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, 'about:blank',
], { stdio: 'ignore' });

let cdp;
try {
  let target;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const ts = await r.json();
      target = ts.find((t) => t.type === 'page');
      if (target) break;
    } catch {}
    await sleep(250);
  }
  if (!target) throw new Error('chrome not reachable');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: GAME });
} catch (e) {
  console.error('CONNECT FAIL', e);
  chrome.kill();
  process.exit(1);
}

// collect page errors
const pageErrors = [];
cdp.on('Runtime.consoleAPICalled', (p) => {
  if (p.type === 'error') {
    const t = p.args.map((a) => (a.value !== undefined ? a.value : a.description ?? '')).join(' ');
    pageErrors.push(t.slice(0, 400));
  }
});
cdp.on('Runtime.exceptionThrown', (p) => {
  pageErrors.push('EX: ' + (p.exceptionDetails?.exception?.description ?? '').slice(0, 300));
});

// ---------------- boot checks ----------------
let booted = false;
for (let i = 0; i < 60; i++) {
  await sleep(250);
  try {
    booted = await evalJs(cdp, `!!window.__AETHERPLAY__`);
    if (booted) break;
  } catch {}
}
ck(booted, 'game boots and exposes window.__AETHERPLAY__');

let s = await state(cdp);
ck(s.phase === 'ready', 'phase is ready on boot');
ck(s.seed === 94721, 'seed is 94721');
ck(s.restartCount === 0, 'restartCount starts at 0');
ck(Number.isFinite(s.charge) && s.charge > 0, 'charge finite & positive');
ck(Number.isFinite(s.player.x) && Number.isFinite(s.player.y) && Number.isFinite(s.player.z), 'player coords finite');
const glOk = await evalJs(cdp, `(() => { const c = document.querySelector('canvas'); if (!c) return 'no canvas'; return !!(c.getContext('webgl2') || c.getContext('webgl')) ? 'webgl-ok' : 'webgl-fail'; })()`);
ck(glOk === 'webgl-ok', 'WebGL context available');
const resources = await evalJs(cdp, `JSON.stringify(performance.getEntriesByType('resource').map(e => e.name))`);
const resList = JSON.parse(resources);
const localOnly = resList.every((n) => n.startsWith('http://127.0.0.1:4173') || n.startsWith('data:'));
ck(localOnly, 'all loaded resources are local (no external network)');
const readyShot = await shot(cdp, '01-ready-desktop');
ck(readyShot.nonblackPct > 10, 'ready screen renders real pixels (non-black)');

// ---------------- start + basic control ----------------
await click(cdp, '#btn-start');
await sleep(700);
s = await state(cdp);
ck(s.phase === 'playing', 'start button begins play');
const z0 = s.player.z;
ck(z0 < 42, `craft advances forward (z=${z0.toFixed(1)})`);
await sleep(1300);
s = await state(cdp);
ck(s.player.z < z0 - 50, 'auto-thrust keeps moving forward');
ck(s.phase === 'playing', 'still playing');

const x0 = s.player.x;
await hold(cdp, 'ArrowRight', 'ArrowRight', 39);
await sleep(900);
await release(cdp, 'ArrowRight', 'ArrowRight', 39);
s = await state(cdp);
ck(s.player.x > x0 + 5, `steering right moves craft (+${(s.player.x - x0).toFixed(1)})`);

const y0 = s.player.y;
await hold(cdp, 'ArrowUp', 'ArrowUp', 38);
await sleep(700);
await release(cdp, 'ArrowUp', 'ArrowUp', 38);
s = await state(cdp);
ck(s.player.y > y0 + 2, `steering up moves craft (+${(s.player.y - y0).toFixed(1)})`);

const c0 = s.charge;
const sc0 = s.score;
await sleep(2000);
s = await state(cdp);
ck(s.charge < c0, `charge drains over time (${c0.toFixed(1)} -> ${s.charge.toFixed(1)})`);
ck(s.score > sc0, `score increases (${sc0.toFixed(0)} -> ${s.score.toFixed(0)})`);

const zBefore = s.player.z;
await hold(cdp, 'Shift', 'Shift', 16);
await sleep(1200);
await release(cdp, 'Shift', 'Shift', 16);
s = await state(cdp);
ck(s.player.z < zBefore - 95, `boost accelerates forward motion (${(zBefore - s.player.z).toFixed(0)} u in 1.2s)`);

// ---------------- pause paths ----------------
// Synthetically flip document.hidden + fire visibilitychange (the browser
// lifecycle in headless freezes the page and makes live reads stale, so we
// exercise the exact handler the game listens to this way).
const hiddenSet = await evalJs(cdp, `(() => {
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
  let fake = false;
  Object.defineProperty(Document.prototype, 'hidden', {
    configurable: true,
    get() { return fake; },
    set(v) { fake = v; },
  });
  document.hidden = true;
  window.dispatchEvent(new Event('visibilitychange'));
  document.hidden = false;
  window.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(Document.prototype, 'hidden', desc);
  return 'dispatched';
})()`);
await sleep(250); // let the game's next frame mirror the transition into the API
s = await state(cdp);
ck(s.phase === 'paused', 'page visibility loss pauses the game (visibilitychange handler)');
// while hidden the sim should be frozen; check no motion happened:
s = await state(cdp);
const zf = s.player.z;
await sleep(1000);
s = await state(cdp);
ck(Math.abs(s.player.z - zf) < 1.5, 'no motion while paused (fast reads)');
await click(cdp, '#btn-resume');
await sleep(400);
s = await state(cdp);
ck(s.phase === 'playing', 'resume button continues play');

// real-browser lifecycle freeze (informational): checks the tab-autopause
// contract with the real CDP freeze, done last so it cannot poison the run.
// (Kept at the end of the script — see summary block.)

await key(cdp, 'p', 'KeyP', 80);
await sleep(300);
s = await state(cdp);
ck(s.phase === 'paused', 'P key pauses');
await key(cdp, 'p', 'KeyP', 80);
await sleep(300);
s = await state(cdp);
ck(s.phase === 'playing', 'P key resumes');

const rcBefore = s.restartCount;
await key(cdp, 'r', 'KeyR', 82);
await sleep(600);
s = await state(cdp);
ck(s.restartCount === rcBefore + 1, 'R key restarts (restartCount incremented)');
ck(s.phase === 'playing', 'restart returns to playing');
ck(s.relaysRestored === 0, 'restart resets relay progress');
ck(s.player.z > -20, 'restart resets position to start');
await shot(cdp, '02-playing-desktop');

// ---------------- autopilot run to victory ----------------
const GATES = [{ z: -1050 }, { z: -2400 }, { z: -3800 }];
function pathX(z) { return 15 * Math.sin(z * 0.0017 + 2.1) + 8 * Math.sin(z * 0.0043 - 0.6); }
function pathY(z) { return 4 * Math.sin(z * 0.0029 + 1.25) + 2.5 * Math.sin(z * 0.0083 + 2.6); }

const steerKeys = { l: 'ArrowLeft', r: 'ArrowRight', u: 'ArrowUp', d: 'ArrowDown' };
const VK = { l: 37, r: 39, u: 38, d: 40 };
const steering = { l: false, r: false, u: false, d: false };
let boosting = false;
async function steerAxis(cdp, dir, want) {
  if (want && !steering[dir]) {
    steering[dir] = true;
    await hold(cdp, steerKeys[dir], steerKeys[dir], VK[dir]);
  } else if (!want && steering[dir]) {
    steering[dir] = false;
    await release(cdp, steerKeys[dir], steerKeys[dir], VK[dir]);
  }
}
async function setBoost(cdp, want, charge) {
  if (want && !boosting && charge > 42) {
    boosting = true;
    await hold(cdp, 'Shift', 'Shift', 16);
  } else if (!want && boosting) {
    boosting = false;
    await release(cdp, 'Shift', 'Shift', 16);
  }
}

async function autopilotTick(cdp) {
  const st = await state(cdp);
  if (st.phase !== 'playing') return { done: true, st };
  const target = st.relaysRestored < 3 ? GATES[st.relaysRestored] : { z: -4900 };
  const distAhead = st.player.z - target.z;
  let gx = pathX(target.z);
  let gy = pathY(target.z) + (st.relaysRestored >= 3 ? 3 : 0);

  // harvest mode: commit to a charge orb for a while instead of thrashing
  const now = Date.now();
  if (st.charge < 92 && st.nearestCharge) {
    if (!commit || now > commit.until || st.player.z < commit.z + 3) {
      const n = st.nearestCharge;
      commit = { x: n.x, y: n.y, z: n.z, until: now + 1600 };
    }
    gx = commit.x;
    gy = commit.y;
  } else {
    commit = null;
  }
  if (st.charge < 30 && st.nearestCharge) {
    gx = st.nearestCharge.x;
    gy = st.nearestCharge.y;
  }

  await steerAxis(cdp, 'l', gx - st.player.x < -1.6);
  await steerAxis(cdp, 'r', gx - st.player.x > 1.6);
  await steerAxis(cdp, 'u', gy - st.player.y > 1.6);
  await steerAxis(cdp, 'd', gy - st.player.y < -1.6);
  const wantBoost = st.charge > 82 && distAhead > 300 && st.relaysRestored < 3;
  await setBoost(cdp, wantBoost, st.charge);
  return { done: false, st };
}
let commit = null;

let winner = false;
let attempts = 0;
let lastRelay = -1;
while (attempts < 3 && !winner) {
  attempts++;
  console.log(`  [autopilot] attempt ${attempts}/3`);
  lastRelay = -1;
  const tA0 = Date.now();
  let lostThis = false;
  while (Date.now() - tA0 < 220000 && !winner && !lostThis) {
    const r = await autopilotTick(cdp);
    if (r.done) {
      if (r.st.phase === 'won') winner = true;
      if (r.st.phase === 'lost') lostThis = true;
      break;
    }
    if (r.st.relaysRestored !== lastRelay) {
      lastRelay = r.st.relaysRestored;
      console.log(`    relays restored: ${lastRelay}/3  charge=${r.st.charge.toFixed(0)}  z=${r.st.player.z.toFixed(0)}`);
    }
    await sleep(80);
  }
  if (!winner) {
    console.log('    attempt ended without victory' + (lostThis ? ' (lost)' : ' (timeout)'));
    await releaseAllKeys(cdp);
    if (!lostThis) {
      // still flying but stuck: restart to try again
      await key(cdp, 'r', 'KeyR', 82);
      await sleep(600);
    }
  }
}
await releaseAllKeys(cdp);
ck(winner, `autopilot run reaches EXTRACTION and wins (attempts=${attempts})`);
console.log('  final state:', JSON.stringify(await state(cdp)).slice(0, 240));
if (winner) {
  ck(await evalJs(cdp, `!document.getElementById('o-won').classList.contains('hidden')`), 'won overlay visible');
  console.log('  won score:', await evalJs(cdp, `document.getElementById('won-score').textContent`));
}
await shot(cdp, '03-won-desktop');

// ---------------- deliberate loss ----------------
await key(cdp, 'r', 'KeyR', 82);
await sleep(700);
s = await state(cdp);
ck(s.phase === 'playing' && s.restartCount >= 2, 'restart from won starts a new run');
await steerAxis(cdp, 'r', true);
await setBoost(cdp, true, 200);
let lostAt = null;
const tL0 = Date.now();
while (Date.now() - tL0 < 60000) {
  await sleep(130);
  s = await state(cdp);
  if (s.phase === 'lost') { lostAt = Date.now() - tL0; break; }
}
await releaseAllKeys(cdp);
ck(!!lostAt, `wall-hug + boost drains charge to zero (lost after ${(lostAt / 1000).toFixed(1)}s)`);
ck(await evalJs(cdp, `!document.getElementById('o-lost').classList.contains('hidden')`), 'lost overlay visible');
console.log('  lost reason:', await evalJs(cdp, `document.getElementById('lost-reason').textContent`));
await shot(cdp, '04-lost-desktop');

// restart from lost
await key(cdp, 'r', 'KeyR', 82);
await sleep(600);
s = await state(cdp);
ck(s.phase === 'playing', 'restart from lost works');

// ---------------- phone viewport ----------------
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  screenWidth: 390, screenHeight: 844,
});
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await sleep(1200);
const phoneVp = await evalJs(cdp, `JSON.stringify([window.innerWidth, window.innerHeight])`);
ck(JSON.parse(phoneVp)[0] === 390 && JSON.parse(phoneVp)[1] === 844, 'phone viewport is 390x844');
const phoneHud = JSON.parse(await evalJs(cdp, `(() => JSON.stringify({
  scoreShown: document.getElementById('score-box').offsetParent !== null,
  chargeShown: document.getElementById('charge-box').offsetParent !== null,
  objShown: document.getElementById('obj-box').offsetParent !== null,
}))()`));
ck(phoneHud.scoreShown && phoneHud.chargeShown && phoneHud.objShown, 'HUD elements visible on phone');
await shot(cdp, '05-phone-playing');

const js0 = await state(cdp);
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: 60, y: 560, id: 1, radiusX: 5, radiusY: 5, force: 1 }],
});
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchMove',
  touchPoints: [{ x: 120, y: 300, id: 1, radiusX: 5, radiusY: 5, force: 1 }],
});
await sleep(800);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const js1 = await state(cdp);
const dxp = js1.player.x - js0.player.x;
const dyp = js1.player.y - js0.player.y;
ck(dxp > 0.5 && dyp > 0.5, `touch joystick steers craft (dx=${dxp.toFixed(1)}, dy=${dyp.toFixed(1)})`);

const cBefore = js1.charge;
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: 390 - 48, y: 844 - 52, id: 2, radiusX: 8, radiusY: 8, force: 1 }],
});
await sleep(900);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
s = await state(cdp);
ck(s.charge < cBefore - 4, 'touch BOOST button consumes extra charge');
await shot(cdp, '06-phone-touch');

// orientation/resize robustness
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
await sleep(800);
s = await state(cdp);
ck(s.phase === 'playing', 'game survives viewport resize (landscape)');
// restore phone portrait and ensure still fine
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(600);
s = await state(cdp);
ck(s.phase === 'playing', 'game survives resize back to portrait');
await shot(cdp, '07-phone-portrait-after');

// ---------------- real visibility freeze (final, informational) ----------------
// The headless lifecycle freeze keeps the page suspended in this Chromium
// build, so this is a non-fatal probe: it proves document.hidden becomes
// true; the synthetic test above already proved the handler pauses on it.
const preFreeze = await evalJs(cdp, `__AETHERPLAY__.phase`);
await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
await sleep(500);
let froze = await evalJs(cdp, `document.hidden`);
let frozePhase = await evalJs(cdp, `__AETHERPLAY__.phase`);
await cdp.send('Page.setWebLifecycleState', { state: 'active' });
console.log(`  [info] lifecycle freeze: before=${preFreeze} hidden=${froze} phaseWhileFrozen=${frozePhase}`);

// ---------------- summary ----------------
console.log('\n=== SUMMARY ===');
if (pageErrors.length) {
  console.log('page console errors:');
  for (const e of pageErrors) console.log('  -', e.slice(0, 200));
  ck(false, 'no page console errors (found ' + pageErrors.length + ')');
} else {
  ck(true, 'no page console errors');
}
console.log(`failures: ${failures.length}`);
if (failures.length) console.log(failures.join('\n  - '));
chrome.kill();
process.exit(failures.length ? 1 : 0);