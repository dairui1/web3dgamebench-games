/**
 * CDP driver: plays Signal Drift in headless Chromium at a given viewport.
 * Usage: node tools/drive.mjs desktop|phone
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import * as THREE from 'three';

const CHROME = '/ms-playwright/chromium-1234/chrome-linux/chrome';
const GAME_URL = 'http://127.0.0.1:8077/';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const MODE = process.argv[2] ?? 'desktop';
const VIEW = MODE === 'phone'
  ? { width: 390, height: 844, mobile: true, touch: true }
  : { width: 1440, height: 900, mobile: false, touch: false };

const log = (...a) => console.log(`[${MODE}]`, ...a);
const problems = [];

/* ---------------- chrome + CDP ---------------- */

function launchChrome() {
  return spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--remote-debugging-port=9223',
    `--user-data-dir=/tmp/sd-profile-${MODE}-${Date.now()}`,
    '--about:blank',
  ], { stdio: 'ignore' });
}

async function waitForHttp(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${url}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    return new CDP(ws);
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

/* ---------------- helpers ---------------- */

const KEY_CODES = { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, ShiftLeft: 16, KeyP: 80 };

async function evalJs(cdp, expr) {
  const res = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (res.exceptionDetails) {
    throw new Error(`eval failed: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ''}`);
  }
  return res.result.value;
}

const bench = (cdp) => evalJs(cdp, 'window.__WEB3DGAMEBENCH__ ?? null');

async function shot(cdp, name) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${SHOTS}${MODE}-${name}.png`, Buffer.from(res.data, 'base64'));
  log(`shot: ${name}`);
}

async function clickAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function tapAt(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(90);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function centerOf(cdp, selector) {
  return evalJs(cdp, `(() => {
    const el = document.querySelector('${selector}');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
}

async function pressKey(cdp, key, down) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: down ? 'keyDown' : 'keyUp',
    windowsVirtualKeyCode: KEY_CODES[key],
    code: key,
    key: key.replace('Left', ''),
  });
}

/* ---------------- autopilot ---------------- */

// Replicate the course (same control points as src/game/course.ts) so the
// autopilot can fly the lit corridor like a human, via pure pursuit.
const CONTROL_POINTS = [
  [0, 58, 0], [-30, 64, -180], [-130, 78, -340], [-70, 92, -530],
  [120, 82, -660], [300, 66, -750], [430, 84, -900], [380, 108, -1080],
  [200, 98, -1200], [30, 84, -1340], [-140, 96, -1490], [-60, 116, -1660],
  [170, 124, -1780], [380, 110, -1830], [470, 92, -1960],
];
const courseCurve = (() => {
  const pts = CONTROL_POINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const c = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  c.arcLengthDivisions = 800;
  return c;
})();
const COURSE_SAMPLES = (() => {
  const n = 900;
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(courseCurve.getPointAt(i / (n - 1)));
  return arr;
})();
const COURSE_LEN = courseCurve.getLength();

function pursuitPoint(px, py, pz) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < COURSE_SAMPLES.length; i++) {
    const s = COURSE_SAMPLES[i];
    const d = (px - s.x) ** 2 + (py - s.y) ** 2 + (pz - s.z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  const pathDist = Math.sqrt(bestD);
  // shorten lookahead when far off-corridor so the aim pulls back to the line
  const look = Math.max(20, 90 - pathDist * 0.9);
  const lookIdx = Math.min(COURSE_SAMPLES.length - 1, best + Math.round(look / (COURSE_LEN / 900)));
  return { point: COURSE_SAMPLES[lookIdx], pathDist, bestIdx: best };
}

/* Deterministic hazard replication (same seed + placement as the game) so the
   autopilot can dodge like a human who sees the hazards glowing ahead. */
class Mulberry32 {
  constructor(seed) { this.s = seed >>> 0; }
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min, max) { return min + this.next() * (max - min); }
  int(min, max) { return Math.floor(this.range(min, max + 1)); }
  sign() { return this.next() < 0.5 ? -1 : 1; }
}

const HAZARDS = (() => {
  const rng = new Mulberry32(94721);
  const lateralAt = (t) => {
    const tan = courseCurve.getTangentAt(Math.min(1, Math.max(0, t))).normalize();
    return new THREE.Vector3(-tan.z, 0, tan.x).normalize();
  };
  const nearPoint = (t, lateral, up) => {
    const pos = courseCurve.getPointAt(Math.min(1, Math.max(0, t)));
    pos.addScaledVector(lateralAt(t), lateral);
    pos.y += up;
    return pos;
  };
  // placeCells rng consumption first (order matters)
  const clusters = [0.05, 0.1, 0.155, 0.28, 0.345, 0.41, 0.55, 0.61, 0.7, 0.82, 0.885, 0.94];
  for (const base of clusters) {
    rng.int(3, 4);
    const onLine = rng.next() < 0.6;
    if (onLine) rng.range(-3.5, 3.5);
    else { rng.sign(); rng.range(7, 16); }
  }
  const mines = [];
  const segments = [[0.035, 0.185, 4], [0.225, 0.465, 6], [0.505, 0.745, 8], [0.795, 0.965, 8]];
  for (const [a, b, n] of segments) {
    for (let i = 0; i < n; i++) {
      const t = Math.min(0.98, Math.max(0.01, a + ((b - a) * (i + 0.5)) / n + rng.range(-0.012, 0.012)));
      const anchor = nearPoint(t, 0, 0);
      const perp = lateralAt(t);
      const amp = rng.range(9, 21);
      const speed = rng.range(0.5, 1.15);
      const phase = rng.range(0, Math.PI * 2);
      const vert = rng.range(2, 5);
      mines.push({ anchor, perp, amp, speed, phase, vert });
    }
  }
  const spinners = [];
  for (const t of [0.3, 0.42, 0.58, 0.66, 0.84, 0.92]) {
    spinners.push(nearPoint(t, rng.sign() * rng.range(13, 18), 0));
    rng.sign();
    rng.range(1.2, 2.1);
  }
  return { mines, spinners };
})();

function minePos(m, elapsed) {
  const phase = m.phase + m.speed * elapsed;
  const s = Math.sin(phase);
  return new THREE.Vector3(
    m.anchor.x + m.perp.x * s * m.amp,
    m.anchor.y + Math.sin(phase * 0.63 + 1.7) * m.vert,
    m.anchor.z + m.perp.z * s * m.amp,
  );
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function desiredControls(b) {
  // aim at the objective (ring center) when close, otherwise pursue the corridor
  const t = b.target;
  const dToTarget = Math.hypot(t.x - b.player.x, t.y - b.player.y, t.z - b.player.z);
  let aim;
  if (dToTarget < 170) {
    aim = { x: t.x, y: t.y, z: t.z };
  } else {
    aim = pursuitPoint(b.player.x, b.player.y, b.player.z).point;
  }
  const dx = aim.x - b.player.x;
  const dy = aim.y - b.player.y;
  const dz = aim.z - b.player.z;
  const desiredH = Math.atan2(-dx, -dz);
  let errYaw = wrapAngle(desiredH - b.heading);
  const distXZ = Math.hypot(dx, dz);
  const pitchTarget = Math.max(-0.42, Math.min(0.42, Math.atan2(dy + 1.5, Math.max(24, distXZ))));
  const errPitch = pitchTarget - b.pitch;

  // hazard avoidance (mines sweep the corridor, spinners sit at its edge)
  const h = b.heading;
  const fwd = { x: -Math.sin(h), z: -Math.cos(h) };
  const right = { x: -fwd.z, z: fwd.x };
  let dodge = 0;
  let hazardClose = false;
  const consider = (hx, hy, hz) => {
    const ox = hx - b.player.x;
    const oy = hy - b.player.y;
    const oz = hz - b.player.z;
    const dist = Math.hypot(ox, oy, oz);
    if (dist > 48) return;
    const ahead = ox * fwd.x + oz * fwd.z;
    if (ahead < -4) return;
    const lat = ox * right.x + oz * right.z;
    const urgency = Math.max(0, 1 - dist / 48);
    dodge += (lat >= 0 ? 1 : -1) * urgency * 0.85;
    if (dist < 26) hazardClose = true;
  };
  for (const m of HAZARDS.mines) {
    const mp = minePos(m, b.elapsed);
    consider(mp.x, mp.y, mp.z);
  }
  for (const s of HAZARDS.spinners) consider(s.x, s.y, s.z);
  errYaw = Math.max(-Math.PI, Math.min(Math.PI, errYaw + dodge));
  return { errYaw, errPitch, hazardClose };
}

function keyboardDecision(b) {
  const { errYaw, errPitch } = desiredControls(b);
  const keys = new Set();
  if (errYaw > 0.05) keys.add('KeyA');
  else if (errYaw < -0.05) keys.add('KeyD');
  if (errPitch > 0.06) keys.add('KeyW');
  else if (errPitch < -0.06) keys.add('KeyS');
  if (Math.abs(errYaw) < 0.12 && Math.abs(errPitch) < 0.12 && b.charge > 45) keys.add('ShiftLeft');
  return keys;
}

// joystick steering vector: sx = right(+)/left(-), sy = climb(+)/dive(-)
function touchDecision(b) {
  const { errYaw, errPitch } = desiredControls(b);
  let sx = Math.max(-1, Math.min(1, -errYaw * 3));
  let sy = Math.max(-1, Math.min(1, errPitch * 3.4));
  if (Math.abs(sx) < 0.06) sx = 0;
  if (Math.abs(sy) < 0.06) sy = 0;
  return { sx, sy };
}

const JOY = { x: 130, y: 690 };
let joyDown = false;
async function driveTouch(cdp, { sx, sy }) {
  const active = sx !== 0 || sy !== 0;
  const point = [{ x: JOY.x + sx * 42, y: JOY.y - sy * 42, id: 7 }];
  if (active && !joyDown) {
    joyDown = true;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point });
  } else if (active && joyDown) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point });
  } else if (!active && joyDown) {
    joyDown = false;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}

async function releaseAll(cdp) {
  if (joyDown) {
    joyDown = false;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}

/** Steer toward the current objective until won/lost or timeout. */
async function autopilot(cdp, maxSec = 320) {
  const start = Date.now();
  let last = null;
  let tap = null; // { key, until }
  let boostHeld = false;
  let tick = 0;
  while ((Date.now() - start) / 1000 < maxSec) {
    const b = await bench(cdp);
    if (!b) { await sleep(150); continue; }
    last = b;
    if (b.phase === 'won' || b.phase === 'lost') break;
    if (b.phase === 'playing') {
      tick++;
      if (tick % 40 === 0) {
        const { point, pathDist } = pursuitPoint(b.player.x, b.player.y, b.player.z);
        log('  ...', JSON.stringify({
          p: [b.player.x, b.player.y, b.player.z], h: b.heading, pitch: b.pitch,
          pathDist: Math.round(pathDist), aim: [point.x, point.y, point.z],
          relays: b.relaysRestored, charge: b.charge, cells: b.cellsCollected,
        }));
      }
      if (VIEW.touch) {
        await driveTouch(cdp, touchDecision(b));
      } else {
        const now = Date.now();
        if (tap && now < tap.until) {
          // keep the current correction held
        } else {
          if (tap) { await pressKey(cdp, tap.key, false); tap = null; }
          const { errYaw, errPitch } = desiredControls(b);
          if (Math.abs(errYaw) > 0.045 && Math.abs(errYaw) >= Math.abs(errPitch) * 0.8) {
            const key = errYaw > 0 ? 'KeyA' : 'KeyD';
            await pressKey(cdp, key, true);
            tap = { key, until: now + Math.min(0.45, Math.abs(errYaw) * 0.6) * 1000 };
          } else if (Math.abs(errPitch) > 0.06) {
            const key = errPitch > 0 ? 'KeyW' : 'KeyS';
            await pressKey(cdp, key, true);
            tap = { key, until: now + Math.min(0.4, Math.abs(errPitch) * 0.7) * 1000 };
          }
        }
        const dc = desiredControls(b);
        const wantBoost = !dc.hazardClose && Math.abs(dc.errYaw) < 0.12 && b.charge > 65;
        if (wantBoost !== boostHeld) {
          await pressKey(cdp, 'ShiftLeft', wantBoost);
          boostHeld = wantBoost;
        }
      }
    }
    await sleep(120);
  }
  if (tap) await pressKey(cdp, tap.key, false);
  if (boostHeld) await pressKey(cdp, 'ShiftLeft', false);
  if (joyDown) {
    joyDown = false;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  return last;
}

/* ---------------- main ---------------- */

async function main() {
  await waitForHttp(GAME_URL);
  const chrome = launchChrome();
  try {
    await waitForHttp('http://127.0.0.1:9223/json/version');
    const target = await fetch(`http://127.0.0.1:9223/json/new?${encodeURIComponent(GAME_URL)}`, { method: 'PUT' }).then((r) => r.json());
    const cdp = await CDP.connect(target.webSocketDebuggerUrl);

    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error' || p.type === 'warning') {
        consoleErrors.push(`${p.type}: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
      }
    });
    cdp.on('Runtime.exceptionThrown', (p) => {
      consoleErrors.push(`exception: ${p.exceptionDetails.text} ${p.exceptionDetails.exception?.description ?? ''}`);
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1, mobile: VIEW.mobile,
    });
    if (VIEW.touch) {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }

    await cdp.send('Page.navigate', { url: GAME_URL });
    await sleep(3500);

    /* ---- title ---- */
    const b0 = await bench(cdp);
    if (!b0) throw new Error('benchmark object missing');
    log('title state:', JSON.stringify({ phase: b0.phase, seed: b0.seed, player: b0.player, charge: b0.charge }));
    if (b0.phase !== 'ready') problems.push(`expected phase ready, got ${b0.phase}`);
    if (b0.seed !== 94721) problems.push(`expected seed 94721, got ${b0.seed}`);
    for (const [k, v] of Object.entries(b0.player)) {
      if (!Number.isFinite(v)) problems.push(`player.${k} not finite`);
    }
    await shot(cdp, '1-title');

    /* ---- start via real input ---- */
    const startBtn = await centerOf(cdp, '#btn-start');
    if (!startBtn) throw new Error('start button missing');
    if (VIEW.touch) await tapAt(cdp, startBtn.x, startBtn.y);
    else await clickAt(cdp, startBtn.x, startBtn.y);
    await sleep(800);
    const b1 = await bench(cdp);
    log('after start:', JSON.stringify({ phase: b1.phase, charge: b1.charge, restartCount: b1.restartCount }));
    if (b1.phase !== 'playing') problems.push(`expected playing after start, got ${b1.phase}`);
    await shot(cdp, '2-start');

    /* ---- fly the course (up to two attempts: win, or lose -> retry) ---- */
    let endState = await autopilot(cdp);
    log('run outcome:', JSON.stringify({
      phase: endState?.phase, relays: endState?.relaysRestored, score: endState?.score,
      cells: endState?.cellsCollected, elapsed: endState?.elapsed, restartCount: endState?.restartCount,
      charge: endState?.charge, offCourse: endState?.offCourse,
    }));
    await shot(cdp, '3-end');

    if (endState?.phase === 'lost') {
      // exercise the defeat -> retry path
      await sleep(2500);
      let retry = await centerOf(cdp, '#btn-retry');
      for (let i = 0; i < 20 && !retry; i++) {
        await sleep(500);
        retry = await centerOf(cdp, '#btn-retry');
      }
      if (!retry) throw new Error('retry button never appeared');
      await shot(cdp, '3b-lost-overlay');
      if (VIEW.touch) await tapAt(cdp, retry.x, retry.y);
      else await clickAt(cdp, retry.x, retry.y);
      await sleep(700);
      const br = await bench(cdp);
      if (br.phase !== 'playing') problems.push(`expected playing after retry, got ${br.phase}`);
      if (br.restartCount !== 1) problems.push(`expected restartCount 1 after retry, got ${br.restartCount}`);
      log('retried, attempt 2...');
      endState = await autopilot(cdp);
      log('attempt 2 outcome:', JSON.stringify({
        phase: endState?.phase, relays: endState?.relaysRestored, cells: endState?.cellsCollected,
        elapsed: endState?.elapsed, restartCount: endState?.restartCount,
      }));
      await shot(cdp, '3c-attempt2');
    }

    if (endState?.phase === 'won') {
      if (endState.relaysRestored !== 3) problems.push('won without 3 relays');
      if (endState.score <= 0) problems.push('score not positive on win');
      await sleep(1800);
      let again = await centerOf(cdp, '#btn-again');
      for (let i = 0; i < 20 && !again; i++) {
        await sleep(500);
        again = await centerOf(cdp, '#btn-again');
      }
      if (!again) throw new Error('fly-again button never appeared');
      await shot(cdp, '4-won-overlay');
      if (VIEW.touch) await tapAt(cdp, again.x, again.y);
      else await clickAt(cdp, again.x, again.y);
      if (VIEW.touch) await tapAt(cdp, again.x, again.y);
      else await clickAt(cdp, again.x, again.y);
      await sleep(700);
      const b2 = await bench(cdp);
      if (b2.phase !== 'playing') problems.push(`expected playing after fly-again, got ${b2.phase}`);
      if (b2.restartCount !== endState.restartCount + 1) problems.push(`expected restartCount ${endState.restartCount + 1}, got ${b2.restartCount}`);
      if (b2.relaysRestored !== 0) problems.push('relays not reset on restart');
      if (b2.charge <= 0 || b2.charge > 100) problems.push(`charge not reset: ${b2.charge}`);
    } else {
      problems.push(`autopilot did not win (phase=${endState?.phase}, relays=${endState?.relaysRestored})`);
    }

    /* ---- pause toggle via keyboard (desktop) ---- */
    const b3 = await bench(cdp);
    if (b3.phase === 'playing' && !VIEW.touch) {
      await pressKey(cdp, 'KeyP', true);
      await sleep(120);
      await pressKey(cdp, 'KeyP', false);
      await sleep(500);
      const bp = await bench(cdp);
      if (bp.phase !== 'paused') problems.push(`expected paused after P, got ${bp.phase}`);
      await shot(cdp, '5-paused');
      await pressKey(cdp, 'KeyP', true);
      await sleep(120);
      await pressKey(cdp, 'KeyP', false);
      await sleep(500);
      const br = await bench(cdp);
      if (br.phase !== 'playing') problems.push(`expected playing after resume, got ${br.phase}`);
    }

    /* ---- movement sanity while playing ---- */
    const m1 = await bench(cdp);
    await sleep(1200);
    const m2 = await bench(cdp);
    if (m1.phase === 'playing' && m2.phase === 'playing') {
      const moved = Math.hypot(m2.player.x - m1.player.x, m2.player.z - m1.player.z);
      log(`movement over 1.2s: ${moved.toFixed(1)}u, charge ${m1.charge} -> ${m2.charge}`);
      if (moved < 2) problems.push(`craft barely moved (${moved.toFixed(2)})`);
    }

    await shot(cdp, '6-final');

    /* ---- report ---- */
    const interesting = consoleErrors.filter((e) => !e.includes('favicon'));
    if (interesting.length) {
      problems.push(`${interesting.length} console errors/warnings`);
      for (const e of interesting.slice(0, 12)) log('CONSOLE', e);
    }
    log(problems.length ? `PROBLEMS: ${problems.length}` : 'ALL CHECKS PASSED');
    for (const p of problems) log('  ✗', p);
    process.exitCode = problems.length ? 1 : 0;
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => {
  console.error('driver crashed:', e);
  process.exit(2);
});
