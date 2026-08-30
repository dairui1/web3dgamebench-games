// Drives a full run to completion using only the public telemetry object
// (corridor offsets + relay progress), to verify the win path end to end.
import { launch, Session, sleep } from './cdp.mjs';

const URL = process.env.URL ?? 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS ?? '/workspace/tools/shots';
const { mkdirSync } = await import('node:fs');
mkdirSync(SHOTS, { recursive: true });

// Aperture centres in corridor space, mirroring the course layout.
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

const { proc, wsUrl } = await launch(9334);
const s = await Session.connect(wsUrl);
await s.send('Page.enable');
await s.send('Runtime.enable');
await s.setViewport(1280, 800, false);
await s.send('Page.navigate', { url: URL });
await sleep(4000);
await s.keyPress('Enter', 'Enter', 13);
await sleep(800);

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

const log = [];
let last = null;
let relays = 0;
const deadline = Date.now() + 240000;
while (Date.now() < deadline) {
  const st = await s.evaluate('JSON.parse(JSON.stringify(window.__AETHERPLAY__))');
  last = st;
  if (st.phase !== 'playing') break;
  if (st.relaysRestored !== relays) {
    relays = st.relaysRestored;
    log.push({ event: `relay ${relays}`, t: st.elapsed, charge: st.charge, score: st.score });
    await s.screenshot(`${SHOTS}/auto-relay-${relays}.png`);
  }
  const [tx, ty] = TARGETS[Math.min(3, st.relaysRestored)];
  const dx = tx - st.lateral;
  const dy = ty - st.vertical;
  await setKey('right', dx > 1.2);
  await setKey('left', dx < -1.2);
  await setKey('up', dy > 1.2);
  await setKey('down', dy < -1.2);
  await sleep(70);
}
for (const name of [...down]) await setKey(name, false);

await sleep(2500);
const final = await s.evaluate('JSON.parse(JSON.stringify(window.__AETHERPLAY__))');
await s.screenshot(`${SHOTS}/auto-final.png`);
console.log(JSON.stringify({ log, lastDuringPlay: last, final }, null, 2));
s.ws.close();
proc.kill();
