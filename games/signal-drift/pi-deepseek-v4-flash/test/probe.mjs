// Probe: dump full console errors (shader compile logs).
import { spawn } from 'node:child_process';

const CHROME = '/ms-playwright/chromium-1234/chrome-linux/chrome';
const PORT = 9335;
let idc = 0;
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (p) { this.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
      } else {
        const ls = this.listeners.get(msg.method);
        if (ls) for (const fn of ls) fn(msg.params);
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
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); const ts = await r.json(); target = ts.find((t) => t.type === 'page'); if (target) break; } catch {}
  await sleep(200);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
const cdp = new CDP(ws);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
cdp.on('Runtime.consoleAPICalled', (p) => {
  if (p.type === 'error') {
    const t = p.args.map((a) => (a.value !== undefined ? a.value : a.description ?? '')).join(' | ');
    console.log('CONSOLE ERROR:\n' + t + '\n---');
  }
});
cdp.on('Runtime.exceptionThrown', (p) => {
  console.log('EXCEPTION:', JSON.stringify(p.exceptionDetails?.exception?.description ?? p.exceptionDetails).slice(0, 1000));
});
await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
await sleep(3000);
try {
  const r = await cdp.send('Runtime.evaluate', { expression: `document.getElementById('btn-start').click(); 'started'`, returnByValue: true });
  console.log('start:', r.result.value);
} catch (e) { console.log('eval err', e.message); }
await sleep(2500);
console.log('done');
chrome.kill();
process.exit(0);