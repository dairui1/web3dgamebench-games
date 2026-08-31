/**
 * Visual pass: captures key UI/feedback moments at desktop size without
 * requiring a full winning run (win path is covered by drive.mjs).
 * Usage: node tools/visual.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/ms-playwright/chromium-1234/chrome-linux/chrome';
const GAME_URL = 'http://127.0.0.1:8077/';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('[visual]', ...a);

function launchChrome() {
  return spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--remote-debugging-port=9226',
    `--user-data-dir=/tmp/sd-visual-${Date.now()}`, '--about:blank',
  ], { stdio: 'ignore' });
}

async function waitForHttp(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return r; } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${url}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
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
      this.pending.set(id, {
        resolve: (v) => resolve(v),
        reject: (e) => { console.log(`CDP error on ${method}:`, e.message); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

const KEY = { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, ShiftLeft: 16, KeyP: 80, Enter: 13 };
const evalJs = async (cdp, expr) =>
  (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;
const bench = (cdp) => evalJs(cdp, 'window.__WEB3DGAMEBENCH__ ?? null');
async function shot(cdp, name) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${SHOTS}visual-${name}.png`, Buffer.from(res.data, 'base64'));
  log(`shot: ${name}`);
}
async function key(cdp, k, down) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: down ? 'keyDown' : 'keyUp', windowsVirtualKeyCode: KEY[k], code: k, key: k.replace('Left', ''),
  });
}

async function main() {
  await waitForHttp(GAME_URL);
  const chrome = launchChrome();
  try {
    await waitForHttp('http://127.0.0.1:9226/json/version');
    const target = await fetch(`http://127.0.0.1:9226/json/new?${encodeURIComponent(GAME_URL)}`, { method: 'PUT' }).then((r) => r.json());
    const cdp = await CDP.connect(target.webSocketDebuggerUrl);
    cdp.on('Runtime.exceptionThrown', (p) => log('EXCEPTION', p.exceptionDetails.text));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: GAME_URL });
    await sleep(3500);

    await shot(cdp, '1-title');

    // start via Enter (keyboard confirm path)
    await key(cdp, 'Enter', true); await sleep(100); await key(cdp, 'Enter', false);
    await sleep(700);
    log('phase:', (await bench(cdp))?.phase);

    // boost straight ahead for a speed shot
    await key(cdp, 'ShiftLeft', true);
    await sleep(5000);
    await key(cdp, 'ShiftLeft', false);
    await shot(cdp, '2-boost');

    // hard bank right for motion-feedback shot
    await key(cdp, 'KeyD', true);
    await sleep(2600);
    await key(cdp, 'KeyD', false);
    await shot(cdp, '3-bank');

    // gentle level flight for a while (rain, gates, cells)
    await key(cdp, 'KeyW', true);
    await sleep(1600);
    await key(cdp, 'KeyW', false);
    const b1 = await bench(cdp);
    log('mid state:', JSON.stringify({ charge: b1?.charge, relays: b1?.relaysRestored, elapsed: b1?.elapsed }));

    // dive into the storm to trigger surges until signal lost
    let guard = 0;
    await key(cdp, 'KeyS', true);
    while (guard++ < 90) {
      const b = await bench(cdp);
      if (!b || b.phase === 'lost') break;
      await sleep(700);
    }
    await key(cdp, 'KeyS', false);
    const b2 = await bench(cdp);
    log('after dive:', b2?.phase);
    await sleep(2500);
    await shot(cdp, '4-lost');

    // retry, then pause overlay
    const click = async (sel) => {
      const c = await evalJs(cdp, `(() => { const el = document.querySelector('${sel}');
        if (!el) return null; const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!c) return false;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await sleep(60);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      return true;
    };
    let retried = false;
    for (let i = 0; i < 20 && !retried; i++) { await sleep(500); retried = await click('#btn-retry'); }
    await sleep(900);
    await key(cdp, 'KeyP', true); await sleep(120); await key(cdp, 'KeyP', false);
    await sleep(800);
    await shot(cdp, '5-paused-midrun');
    log('final bench:', JSON.stringify(await bench(cdp)));
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('visual pass crashed:', e); process.exit(2); });
