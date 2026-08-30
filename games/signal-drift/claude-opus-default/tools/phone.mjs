// Phone-viewport check: 390 x 844, touch input only.
import { launch, Session, sleep } from './cdp.mjs';

const BASE = process.env.URL ?? 'http://127.0.0.1:4173/';
const TAG = process.env.TAG ?? 'phone';
const SHOTS = '/workspace/tools/shots';

const { proc, wsUrl } = await launch(9337);
const s = await Session.connect(wsUrl);
await s.send('Page.enable');
await s.send('Runtime.enable');
await s.setViewport(390, 844, true);
await s.send('Page.navigate', { url: BASE });
await sleep(5000);
await s.screenshot(`${SHOTS}/${TAG}-1-title.png`);

const layout = await s.evaluate(`(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null;
    const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y),
      w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    touchDisplay: getComputedStyle(document.querySelector('.touch')).display,
    card: r('.card'), start: r('#start-btn'), boost: r('#boost-btn'), brake: r('#brake-btn'),
    objective: r('#objective-panel'), charge: r('.charge-wrap'), drift: r('.speed-bars'),
    sound: r('.audio-toggle'), overflow: document.documentElement.scrollHeight,
  };
})()`);

// tap Engage
await s.touch('touchStart', layout.start.x + layout.start.w / 2, layout.start.y + layout.start.h / 2);
await sleep(120);
await s.touch('touchEnd', layout.start.x + layout.start.w / 2, layout.start.y + layout.start.h / 2);
await sleep(3000);
await s.screenshot(`${SHOTS}/${TAG}-2-play.png`);

// drag steer down-left, then hold boost
await s.touch('touchStart', 120, 600);
for (let i = 0; i < 10; i++) {
  await s.touch('touchMove', 120 - i * 5, 600 + i * 4);
  await sleep(110);
}
const steer = await s.evaluate('JSON.parse(JSON.stringify(window.__AETHERPLAY__))');
await s.screenshot(`${SHOTS}/${TAG}-3-stick.png`);
await s.touch('touchEnd', 70, 640);
await sleep(300);

const b = { x: layout.boost.x + layout.boost.w / 2, y: layout.boost.y + layout.boost.h / 2 };
await s.touch('touchStart', b.x, b.y);
await sleep(2500);
const boosted = await s.evaluate('JSON.parse(JSON.stringify(window.__AETHERPLAY__))');
await s.screenshot(`${SHOTS}/${TAG}-4-boost.png`);
await s.touch('touchEnd', b.x, b.y);

const layout2 = await s.evaluate(
  `getComputedStyle(document.querySelector('.touch')).display`,
);
console.log(
  JSON.stringify(
    {
      layout,
      touchDisplayInPlay: layout2,
      steer: { lat: steer.lateral, vert: steer.vertical, phase: steer.phase },
      boosted: { speed: boosted.speed, phase: boosted.phase, fps: boosted.fps },
    },
    null,
    2,
  ),
);
s.ws.close();
proc.kill();
