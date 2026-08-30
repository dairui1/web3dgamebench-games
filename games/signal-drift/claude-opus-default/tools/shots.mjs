// Captures a review set of screenshots at desktop and phone viewports.
import { launch, Session, sleep } from './cdp.mjs';

const BASE = process.env.URL ?? 'http://127.0.0.1:4173/?q=high';
const SHOTS = process.env.SHOTS ?? '/workspace/tools/shots';
const { mkdirSync } = await import('node:fs');
mkdirSync(SHOTS, { recursive: true });

const TARGETS = [
  [27 * 0.3, 17 * 0.28],
  [-27 * 0.52, -17 * 0.34],
  [27 * 0.48, -17 * 0.42],
  [0, 0],
];
const KEYS = {
  left: ['ArrowLeft', 'ArrowLeft', 37],
  right: ['ArrowRight', 'ArrowRight', 39],
  up: ['ArrowUp', 'ArrowUp', 38],
  down: ['ArrowDown', 'ArrowDown', 40],
};

const { proc, wsUrl } = await launch(9335);
const s = await Session.connect(wsUrl);
await s.send('Page.enable');
await s.send('Runtime.enable');

const down = new Set();
async function setKey(name, want) {
  const [code, key, vk] = KEYS[name];
  if (want && !down.has(name)) {
    down.add(name);
    await s.key(code, key, 'keyDown', { vk });
  } else if (!want && down.has(name)) {
    down.delete(name);
    await s.key(code, key, 'keyUp', { vk });
  }
}
const st = () => s.evaluate('JSON.parse(JSON.stringify(window.__AETHERPLAY__))');

/** Autopilot toward the current objective for `ms` of wall time. */
async function fly(ms, opts = {}) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await st();
    if (t.phase !== 'playing') return t;
    if (opts.stopAtRelay && t.relaysRestored >= opts.stopAtRelay) return t;
    if (opts.stopWithin && t.distanceToTarget < opts.stopWithin) return t;
    const [tx, ty] = TARGETS[Math.min(3, t.relaysRestored)];
    await setKey('right', tx - t.lateral > 1.2);
    await setKey('left', tx - t.lateral < -1.2);
    await setKey('up', ty - t.vertical > 1.2);
    await setKey('down', ty - t.vertical < -1.2);
    await sleep(70);
  }
  return st();
}
async function release() {
  for (const n of [...down]) await setKey(n, false);
}

// ---- desktop ----
await s.setViewport(1440, 900, false);
await s.send('Page.navigate', { url: BASE });
await sleep(5000);
await s.screenshot(`${SHOTS}/d1-title.png`);
await s.keyPress('Enter', 'Enter', 13);
await sleep(2500);
await s.screenshot(`${SHOTS}/d2-launch.png`);

await fly(30000, { stopWithin: 60 });
await release();
await s.screenshot(`${SHOTS}/d3-gate-approach.png`);
await fly(20000, { stopAtRelay: 1 });
await release();
await sleep(400);
await s.screenshot(`${SHOTS}/d4-relay-flash.png`);

// pause overlay
await s.keyPress('KeyP', 'p', 80);
await sleep(900);
await s.screenshot(`${SHOTS}/d5-paused.png`);
await s.keyPress('KeyP', 'p', 80);

// boost run
await s.key('Space', ' ', 'keyDown', { vk: 32 });
await fly(9000, {});
await s.key('Space', ' ', 'keyUp', { vk: 32 });
await release();
await s.screenshot(`${SHOTS}/d6-boost.png`);

// run to the end for the result card
let t = await fly(200000, {});
await release();
await sleep(9000);
await s.screenshot(`${SHOTS}/d7-result.png`);
const result = await st();

// ---- phone ----
await s.setViewport(390, 844, true);
await sleep(1200);
await s.send('Page.navigate', { url: BASE });
await sleep(5000);
await s.screenshot(`${SHOTS}/p1-title.png`);
await s.touch('touchStart', 195, 660);
await sleep(120);
await s.touch('touchEnd', 195, 660);
await sleep(2500);
const phoneAfterTap = await st();
await s.screenshot(`${SHOTS}/p2-play.png`);

// touch steering + boost button
await s.touch('touchStart', 110, 620);
for (let i = 0; i < 10; i++) {
  await s.touch('touchMove', 110 + i * 6, 620 - i * 5);
  await sleep(110);
}
await s.screenshot(`${SHOTS}/p3-stick.png`);
const phoneSteer = await st();
await s.touch('touchEnd', 170, 570);
await sleep(500);
const boostBox = await s.evaluate(
  `(() => { const r = document.querySelector('#boost-btn').getBoundingClientRect();
     return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; })()`,
);
await s.touch('touchStart', boostBox.x, boostBox.y);
await sleep(2200);
const phoneBoost = await st();
await s.screenshot(`${SHOTS}/p4-boost.png`);
await s.touch('touchEnd', boostBox.x, boostBox.y);

console.log(
  JSON.stringify(
    { desktopEnd: t.phase, result, phoneAfterTap, phoneSteer, phoneBoost, boostBox },
    null,
    2,
  ),
);
s.ws.close();
proc.kill();
