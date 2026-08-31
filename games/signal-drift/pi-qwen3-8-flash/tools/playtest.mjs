/**
 * Keyboard-only autopilot playthrough used to validate the real game loop.
 * It drives the shipped build through CDP input events exactly like a player.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchChrome, Cdp, openPage, Page, wait } from './cdp.mjs';

const PORT = Number(process.env.PROBE_PORT || 4191);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', () => {});

async function waitForServer(deadlineMs = 25000) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    try {
      if ((await fetch(APP_URL)).ok) return;
    } catch {
      /* retry */
    }
    await wait(200);
  }
  throw new Error('preview server never came up');
}

const log = (...args) => console.log(...args);
const read = (page) => page.evaluate('JSON.stringify(window.__WEB3DGAMEBENCH__)').then((s) => JSON.parse(s));

class Keys {
  constructor(page) {
    this.page = page;
    this.held = new Set();
  }
  async set(code, on) {
    if (on && !this.held.has(code)) {
      this.held.add(code);
      await this.page.keyDown(code);
    } else if (!on && this.held.has(code)) {
      this.held.delete(code);
      await this.page.keyUp(code);
    }
  }
  async releaseAll() {
    for (const code of [...this.held]) await this.set(code, false);
  }
  async tap(code) {
    await this.page.keyDown(code);
    await this.page.keyUp(code);
  }
}

const norm = (v) => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

function steer(state) {
  const p = state.player;
  const t = state.target;
  const h = norm(state.heading);
  const d = norm({ x: t.x - p.x, y: t.y - p.y, z: t.z - p.z });
  const crossY = h.z * d.x - h.x * d.z;
  const yaw = crossY < -0.035 ? 'KeyD' : crossY > 0.035 ? 'KeyA' : null;
  const desiredPitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
  const currentPitch = Math.asin(Math.max(-1, Math.min(1, h.y)));
  const dp = desiredPitch - currentPitch;
  const pitch = dp > 0.05 ? 'KeyW' : dp < -0.05 ? 'KeyS' : null;
  const aligned = Math.abs(crossY) < 0.12 && Math.abs(dp) < 0.12;
  return { yaw, pitch, boost: aligned && state.distanceToTarget > 90 };
}

async function fly(page, keys, seconds, { label = '', collect = true, boostAllowed = true } = {}) {
  const end = Date.now() + seconds * 1000;
  let last = null;
  let shots = 0;
  while (Date.now() < end) {
    const s = await read(page);
    if (!last || s.phase !== last.phase || s.relaysRestored !== last.relaysRestored) {
      log(`  phase=${s.phase} relays=${s.relaysRestored} charge=${s.charge.toFixed(1)} score=${s.score} obj="${s.objective}" dist=${s.distanceToTarget.toFixed(0)}m`);
    }
    if (last && s.relaysRestored !== last.relaysRestored && s.relaysRestored > 0) {
      await page.screenshot(`${OUT}/relay-${s.relaysRestored}.png`);
    }
    if (last && s.charge < 25 && last.charge >= 25) {
      log(`  ! charge low ${s.charge.toFixed(1)} at ${s.objective}`);
    }
    last = s;
    if (s.phase !== 'playing') return s;
    if (collect) {
      const cmd = steer(s);
      await keys.set('KeyA', cmd.yaw === 'KeyA');
      await keys.set('KeyD', cmd.yaw === 'KeyD');
      await keys.set('KeyW', cmd.pitch === 'KeyW');
      await keys.set('KeyS', cmd.pitch === 'KeyS');
      await keys.set('ShiftLeft', boostAllowed && cmd.boost);
    } else {
      await keys.releaseAll();
    }
    shots += 1;
    if (shots % 40 === 0) log(`  t=${(s.elapsedMs / 1000).toFixed(1)}s charge=${s.charge.toFixed(0)} obj=${s.objective} dist=${s.distanceToTarget.toFixed(0)} fps=${s.fps}`);
    await wait(55);
  }
  return last ? await read(page) : null;
}

const { proc, wsUrl } = await launchChrome();
const cdp = await Cdp.connect(wsUrl);
const { sessionId } = await openPage(cdp);
const page = new Page(cdp, sessionId);
await page.enable();
const keys = new Keys(page);
const report = { steps: [], errors: [], console: [] };

try {
  await waitForServer();
  await page.setViewport(1440, 900, false, 1);
  await page.navigate(APP_URL);
  await wait(2500);

  log('== desktop ready ==');
  let s = await read(page);
  report.steps.push({ step: 'ready', phase: s.phase, fps: s.fps });
  await page.screenshot(`${OUT}/01-ready-desktop.png`);

  log('== begin ==');
  await keys.tap('Enter');
  await wait(600);
  s = await read(page);
  log('  phase after Enter:', s.phase);
  report.steps.push({ step: 'begin', phase: s.phase });

  log('== pause round trip ==');
  await keys.tap('KeyP');
  await wait(400);
  const paused = await read(page);
  log('  phase:', paused.phase);
  await keys.tap('KeyP');
  await wait(400);
  const resumed = await read(page);
  log('  phase:', resumed.phase);
  report.steps.push({ step: 'pause', phase: paused.phase, resumed: resumed.phase });
  await page.screenshot(`${OUT}/02-playing.png`);

  log('== autopilot run ==');
  const t0 = Date.now();
  s = await fly(page, keys, 150, { label: 'run' });
  log('  final:', JSON.stringify({ phase: s?.phase, relays: s?.relaysRestored, charge: s?.charge?.toFixed(1), score: s?.score, elapsed: s?.elapsedMs, impacts: s?.impacts, cellsLeft: s?.cellsRemaining }));
  report.steps.push({ step: 'autopilot', phase: s?.phase, relays: s?.relaysRestored, seconds: (Date.now() - t0) / 1000 });
  if (s?.phase === 'playing') {
    log('  (still playing after budget - capturing mid-run state)');
    await page.screenshot(`${OUT}/03-midrun.png`);
  } else {
    await wait(900);
    await page.screenshot(`${OUT}/03-${s.phase}.png`);
  }
  await keys.releaseAll();

  log('== restart with R ==');
  await keys.tap('KeyR');
  await wait(700);
  const restarted = await read(page);
  log('  phase:', restarted.phase, 'restartCount:', restarted.restartCount, 'charge:', restarted.charge, 'relays:', restarted.relaysRestored);
  report.steps.push({ step: 'restart', phase: restarted.phase, restartCount: restarted.restartCount });

  log('== failure path (no input, charge drains) ==');
  s = await fly(page, keys, 60, { collect: false });
  log('  phase:', s?.phase, 'charge:', s?.charge?.toFixed(2), 'elapsed:', s?.elapsedMs);
  report.steps.push({ step: 'fail', phase: s?.phase, charge: s?.charge });
  await page.screenshot(`${OUT}/04-lost.png`);

  log('== visibility pause ==');
  await keys.tap('KeyR');
  await wait(500);
  const vis = await page.evaluate(`(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    return 'dispatched';
  })()`);
  await wait(400);
  const afterVis = await read(page);
  log('  ', vis, '-> phase:', afterVis.phase);
  report.steps.push({ step: 'visibility', phase: afterVis.phase, expected: 'paused' });
  await page.evaluate(`(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    return 'restored';
  })()`);

  log('== phone viewport ==');
  await page.setViewport(390, 844, true, 2);
  await wait(900);
  const phoneState = await page.evaluate('JSON.stringify(window.__WEB3DGAMEBENCH__)').then((v) => JSON.parse(v));
  log('  controls mode:', phoneState.controls, 'phase:', phoneState.phase);
  await page.screenshot(`${OUT}/05-phone-ready.png`);
  const beginBox = await page.evaluate(`(() => {
    const el = document.querySelector('#sd-screen-ready [data-action="begin"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`);
  log('  begin button:', JSON.stringify(beginBox));
  if (beginBox) {
    await page.tap('touchStart', beginBox.x, beginBox.y);
    await wait(60);
    await page.tap('touchEnd', beginBox.x, beginBox.y);
  }
  await wait(700);
  const phonePlay = await read(page);
  log('  phase after tap:', phonePlay.phase, 'controls:', phonePlay.controls);
  report.steps.push({ step: 'phone-begin', phase: phonePlay.phase, controls: phonePlay.controls });

  // Steer with a left-thumb drag.
  const before = await read(page);
  await page.tap('touchStart', 90, 600);
  for (let i = 1; i <= 6; i += 1) {
    await page.tap('touchMove', 90 + i * 12, 600 - i * 6);
    await wait(60);
  }
  await wait(900);
  await page.tap('touchEnd', 90 + 72, 600 - 36);
  const afterDrag = await read(page);
  log('  heading change from drag:', (before.heading.z).toFixed(2), '->', (afterDrag.heading.z).toFixed(2), 'phase:', afterDrag.phase);
  await page.screenshot(`${OUT}/06-phone-playing.png`);
  report.steps.push({ step: 'phone-drag', headingBefore: before.heading, headingAfter: afterDrag.heading });

  // Boost pad.
  const pad = await page.evaluate(`(() => {
    const el = document.querySelector('[data-ctrl="boost"]');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible: getComputedStyle(el).opacity };
  })()`);
  log('  boost pad:', JSON.stringify(pad));
  await page.tap('touchStart', pad.x, pad.y);
  await wait(1200);
  const boosting = await read(page);
  log('  throttle while boost held:', boosting.throttle.toFixed(2), 'speed:', boosting.speed.toFixed(1));
  await page.tap('touchEnd', pad.x, pad.y);
  report.steps.push({ step: 'phone-boost', throttle: boosting.throttle });
  await page.screenshot(`${OUT}/07-phone-hud.png`);

  // Fly the phone run a bit to prove touch steering can make progress.
  await page.tap('touchStart', 90, 620);
  await wait(200);
  await page.tap('touchEnd', 90, 620);
  await fly(page, keys, 40, {});
  const phoneFinal = await read(page);
  log('  phone final:', JSON.stringify({ phase: phoneFinal.phase, relays: phoneFinal.relaysRestored, charge: phoneFinal.charge?.toFixed(1) }));
  await page.screenshot(`${OUT}/08-phone-late.png`);
  report.steps.push({ step: 'phone-run', phase: phoneFinal.phase, relays: phoneFinal.relaysRestored });

  log('== resize stress ==');
  for (const [w, h] of [[1024, 600], [640, 1100], [1920, 1080], [390, 844]]) {
    await page.setViewport(w, h, w < 800, 1);
    await wait(350);
    const st = await read(page);
    const ok = Number.isFinite(st.player.x) && Number.isFinite(st.player.y) && Number.isFinite(st.player.z);
    log(`  ${w}x${h} finite=${ok} phase=${st.phase} fps=${st.fps} quality=${st.quality}`);
  }
  await page.setViewport(1440, 900, false, 1);
  await wait(500);
  await page.screenshot(`${OUT}/09-final-desktop.png`);

  report.errors = page.errors.slice(0, 12);
  report.console = page.console.slice(0, 12);
  report.requests = [...new Set(page.requests)];
  log('\nerrors:', report.errors);
  log('console:', report.console.map((c) => c.type + ': ' + c.text.slice(0, 120)));
  log('requests:', report.requests);
  writeFileSync(new URL('../shots/playtest-report.json', import.meta.url), JSON.stringify(report, null, 2));
} catch (err) {
  log('FATAL', err);
  log('page errors:', page.errors);
} finally {
  page.detach();
  cdp.close();
  proc.kill('SIGKILL');
  server.kill('SIGKILL');
}
