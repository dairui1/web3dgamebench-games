// Play-tests the production build: boots the page, drives the craft with
// keyboard + touch input and reports the runtime inspection contract.
import { launch, Session, sleep } from './cdp.mjs';

const URL = process.env.URL ?? 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS ?? '/workspace/tools/shots';
const { mkdirSync } = await import('node:fs');
mkdirSync(SHOTS, { recursive: true });

const { proc, wsUrl } = await launch(9333);
const s = await Session.connect(wsUrl);
await s.send('Page.enable');
await s.send('Runtime.enable');
await s.send('Log.enable');
await s.send('Network.enable');

const consoleErrors = [];
const requests = [];
s.ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    consoleErrors.push(m.params.entry.text);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(m.params.exceptionDetails.exception?.description ?? 'exception');
  }
  if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
});

const report = {};

async function state() {
  return s.evaluate('JSON.parse(JSON.stringify(window.__AETHERPLAY__ ?? null))');
}

async function hold(code, key, vk, ms) {
  await s.key(code, key, 'keyDown', { vk });
  await sleep(ms);
  await s.key(code, key, 'keyUp', { vk });
}

// ---------------------------------------------------------------- desktop
await s.setViewport(1440, 900, false);
await s.send('Page.navigate', { url: URL });
await sleep(4500);

report.glInfo = await s.evaluate(`(() => {
  const c = document.querySelector('canvas');
  const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
  return { hasCanvas: !!c, w: c && c.width, h: c && c.height, gl: !!gl };
})()`);
report.ready = await state();
await s.screenshot(`${SHOTS}/01-desktop-title.png`);

// Start via Enter, then fly.
await s.keyPress('Enter', 'Enter', 13);
await sleep(1200);
report.afterStart = await state();
await s.screenshot(`${SHOTS}/02-desktop-play.png`);

// Steer around for a while with boost to gather telemetry.
const samples = [];
for (let i = 0; i < 10; i++) {
  const dir = i % 2 === 0 ? ['KeyA', 'a', 65] : ['KeyD', 'd', 68];
  await s.key('Space', ' ', 'keyDown', { vk: 32 });
  await hold(dir[0], dir[1], dir[2], 420);
  await s.key('Space', ' ', 'keyUp', { vk: 32 });
  await sleep(250);
  samples.push(await state());
}
report.flightSamples = samples.map((x) => ({
  phase: x.phase,
  score: x.score,
  charge: x.charge,
  relays: x.relaysRestored,
  fps: x.fps,
  speed: x.speed,
  p: x.player,
}));
await s.screenshot(`${SHOTS}/03-desktop-flight.png`);

// Pause via visibility change, then resume.
await s.send('Emulation.setPageVisibilityOverride', { visibility: 'hidden' }).catch(() => {});
await s.evaluate(`(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  return true;
})()`);
await sleep(600);
report.hiddenPhase = (await state()).phase;
await s.screenshot(`${SHOTS}/04-desktop-paused.png`);
await s.evaluate(`(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  return true;
})()`);
await s.keyPress('KeyP', 'p', 80);
await sleep(500);
report.resumedPhase = (await state()).phase;

// Resize robustness.
await s.setViewport(900, 500, false);
await sleep(700);
report.afterResize = await s.evaluate(`(() => {
  const c = document.querySelector('canvas');
  return { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight };
})()`);

// Restart.
await s.keyPress('KeyR', 'r', 82);
await sleep(900);
report.afterRestart = await state();

// ---------------------------------------------------------------- phone
await s.setViewport(390, 844, true);
await sleep(900);
await s.keyPress('KeyR', 'r', 82);
await sleep(600);
await s.screenshot(`${SHOTS}/05-phone-play.png`);
report.phoneLayout = await s.evaluate(`(() => {
  const c = document.querySelector('canvas');
  const touch = document.querySelector('.touch');
  const boost = document.querySelector('#boost-btn').getBoundingClientRect();
  const hud = document.querySelector('.hud').getBoundingClientRect();
  return {
    canvas: { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight },
    touchVisible: getComputedStyle(touch).display,
    boost: { x: boost.x, y: boost.y, w: boost.width, h: boost.height },
    hud: { w: hud.width, h: hud.height },
  };
})()`);

// Touch steering: drag on the left, hold boost on the right.
await s.touch('touchStart', 110, 640);
for (let i = 0; i < 8; i++) {
  await s.touch('touchMove', 110 + i * 8, 640 - i * 4);
  await sleep(90);
}
const touchSteerState = await s.evaluate('window.__AETHERPLAY__.player');
await s.touch('touchEnd', 170, 610);
report.touchSteer = touchSteerState;
await sleep(400);
await s.screenshot(`${SHOTS}/06-phone-touch.png`);
report.phoneState = await state();

// ---------------------------------------------------------------- forced end states
// Fast-forward: fly long enough (unassisted) to observe charge drain and phases.
await s.setViewport(1440, 900, false);
await s.keyPress('KeyR', 'r', 82);
await sleep(500);
const timeline = [];
for (let i = 0; i < 26; i++) {
  await sleep(900);
  const st = await state();
  timeline.push({ t: st.elapsed, phase: st.phase, charge: st.charge, relays: st.relaysRestored, score: st.score, obj: st.objective, dist: st.distanceToTarget });
  if (st.phase !== 'playing') break;
}
report.timeline = timeline;
report.finalState = await state();
await s.screenshot(`${SHOTS}/07-desktop-final.png`);

report.consoleErrors = consoleErrors;
report.externalRequests = requests.filter((u) => !u.startsWith('http://127.0.0.1') && !u.startsWith('data:') && !u.startsWith('blob:'));

console.log(JSON.stringify(report, null, 2));
s.ws.close();
proc.kill();
