// Quick visual check: start a run and grab a couple of frames.
import { launch, Session, sleep } from './cdp.mjs';

const BASE = process.env.URL ?? 'http://127.0.0.1:4173/?q=high';
const SHOTS = '/workspace/tools/shots';
const W = Number(process.env.W ?? 1440);
const H = Number(process.env.H ?? 900);
const MOBILE = process.env.MOBILE === '1';
const TAG = process.env.TAG ?? 'q';

const { proc, wsUrl } = await launch(9336);
const s = await Session.connect(wsUrl);
await s.send('Page.enable');
await s.send('Runtime.enable');
await s.setViewport(W, H, MOBILE);
await s.send('Page.navigate', { url: BASE });
await sleep(4500);
await s.keyPress('Enter', 'Enter', 13);
await sleep(3500);
await s.screenshot(`${SHOTS}/${TAG}-a.png`);
await s.key('Space', ' ', 'keyDown', { vk: 32 });
await sleep(3500);
await s.screenshot(`${SHOTS}/${TAG}-b.png`);
await s.key('Space', ' ', 'keyUp', { vk: 32 });
console.log(JSON.stringify(await s.evaluate('JSON.parse(JSON.stringify(window.__AETHERPLAY__))')));
s.ws.close();
proc.kill();
