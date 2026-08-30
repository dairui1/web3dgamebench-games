// Verifies the failure path: pin the craft against the corridor wall until
// the cells drain, then check the lose card and a fast restart.
import { launch, Session, sleep } from './cdp.mjs';

const URL = process.env.URL ?? 'http://127.0.0.1:4173/';
const SHOTS = '/workspace/tools/shots';

const { proc, wsUrl } = await launch(9338);
const s = await Session.connect(wsUrl);
await s.send('Page.enable');
await s.send('Runtime.enable');
await s.setViewport(1280, 800, false);
await s.send('Page.navigate', { url: URL });
await sleep(4000);
await s.keyPress('Enter', 'Enter', 13);
await sleep(600);

const st = () => s.evaluate('JSON.parse(JSON.stringify(window.__AETHERPLAY__))');
await s.key('ArrowLeft', 'ArrowLeft', 'keyDown', { vk: 37 });
const timeline = [];
const deadline = Date.now() + 120000;
let last;
while (Date.now() < deadline) {
  last = await st();
  timeline.push({ t: last.elapsed, charge: last.charge, phase: last.phase, lat: last.lateral });
  if (last.phase !== 'playing') break;
  await sleep(700);
}
await s.key('ArrowLeft', 'ArrowLeft', 'keyUp', { vk: 37 });
await sleep(6000);
const lost = await st();
await s.screenshot(`${SHOTS}/lose-card.png`);

// restart from the lose screen
await s.keyPress('KeyR', 'r', 82);
await sleep(1500);
const restarted = await st();

console.log(
  JSON.stringify(
    {
      timeline: timeline.slice(-6),
      lost: { phase: lost.phase, charge: lost.charge, elapsed: lost.elapsed, score: lost.score },
      restarted: {
        phase: restarted.phase,
        charge: restarted.charge,
        restartCount: restarted.restartCount,
        relays: restarted.relaysRestored,
        elapsed: restarted.elapsed,
      },
    },
    null,
    2,
  ),
);
s.ws.close();
proc.kill();
