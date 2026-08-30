// Diagnose autopilot orb collection: run the same strategy and log charge,
// nearestCharge, and pickup events over time.
import { spawn } from 'node:child_process';

const CHROME = '/ms-playwright/chromium-1234/chrome-linux/chrome';
const PORT = 9337;
let idc = 0;
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (p) { this.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
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
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 50; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); const ts = await r.json(); target = ts.find((t) => t.type === 'page'); if (target) break; } catch {}
  await sleep(200);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
const cdp = new CDP(ws);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
await sleep(2500);
const evalJs = async (e) => (await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
await evalJs(`document.getElementById('btn-start').click()`);
await sleep(600);
await evalJs(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', {key:'r'})); return 1; })()`);
await sleep(400);

const HOLD = new Set();
async function key(k, code, vk, up = false) {
  await cdp.send('Input.dispatchKeyEvent', { type: up ? 'keyUp' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}
async function hold(k, code, vk) { HOLD.add(k); await key(k, code, vk); }
async function rel(k, code, vk) { HOLD.delete(k); await key(k, code, vk, true); }
async function steer(dir, want) {
  const map = { l: ['ArrowLeft', 37], r: ['ArrowRight', 39], u: ['ArrowUp', 38], d: ['ArrowDown', 40] };
  const [code, vk] = map[dir];
  const tag = 'S' + dir;
  if (want && !HOLD.has(tag)) { HOLD.add(tag); await key(code, code, vk); }
  else if (!want && HOLD.has(tag)) { HOLD.delete(tag); await key(code, code, vk, true); }
}

let commit = null;
const t0 = Date.now();
let lastCharge = 100;
let pickups = 0;
console.log('t(s)  z      charge  orbs   nc(d)  action');
while (Date.now() - t0 < 42000) {
  await sleep(100);
  const st = JSON.parse(await evalJs(`JSON.stringify(__AETHERPLAY__)`));
  const dtSec = ((Date.now() - t0) / 1000).toFixed(1);
  if (st.charge > lastCharge + 1.5) {
    pickups++;
    console.log(`  ^^ PICKUP +${(st.charge - lastCharge).toFixed(0)} (total ${pickups})`);
  }
  lastCharge = st.charge;
  if (st.phase !== 'playing') { console.log('phase:', st.phase); break; }
  const target = st.relaysRestored < 3 ? [-1050, -2400, -3800][st.relaysRestored] : -4900;
  const distAhead = st.player.z - target;
  let gx = 15 * Math.sin(target * 0.0017 + 2.1) + 8 * Math.sin(target * 0.0043 - 0.6);
  let gy = 4 * Math.sin(target * 0.0029 + 1.25) + 2.5 * Math.sin(target * 0.0083 + 2.6) + (st.relaysRestored >= 3 ? 3 : 0);
  let action = 'gate';
  if (st.charge < 92 && st.nearestCharge) {
    const n = st.nearestCharge;
    if (!commit || Date.now() > commit.until || st.player.z < commit.z + 3) {
      commit = { x: n.x, y: n.y, z: n.z, until: Date.now() + 1600 };
    }
    gx = commit.x; gy = commit.y;
    action = 'orb';
  } else commit = null;
  if (st.charge < 30 && st.nearestCharge) { gx = st.nearestCharge.x; gy = st.nearestCharge.y; action = 'orb-urgent'; }
  await steer('l', gx - st.player.x < -1.6);
  await steer('r', gx - st.player.x > 1.6);
  await steer('u', gy - st.player.y > 1.6);
  await steer('d', gy - st.player.y < -1.6);
  const ncx = st.nearestCharge ? st.nearestCharge : null;
  if (Math.floor(parseFloat(dtSec) * 10) % 20 === 0) {
    const note = ncx ? `${ncx.d.toFixed(0)} / ${(ncx.z - st.player.z).toFixed(0)}` : 'none';
    console.log(`${dtSec.padStart(5)}  ${st.player.z.toFixed(0).padStart(5)} ${st.charge.toFixed(0).padStart(6)}  ${String(st.orbCount).padStart(5)}  ${note.padStart(10)}  ${action}  p=(${st.player.x.toFixed(0)},${st.player.y.toFixed(0)})`);
  }
}
for (const tag of [...HOLD]) {
  if (tag.startsWith('S')) { const c = tag[1]; const map = { l: ['ArrowLeft', 37], r: ['ArrowRight', 39], u: ['ArrowUp', 38], d: ['ArrowDown', 40] }; HOLD.delete(tag); await key(...map[c], true); }
}
console.log('pickups:', pickups);
chrome.kill();
process.exit(0);