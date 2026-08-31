// Minimal Chrome DevTools Protocol driver (no external deps, Node >= 22).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/ms-playwright/chromium-1234/chrome-linux/chrome';
const DEBUG_PORT = Number(process.env.CDP_PORT || 9333);

export async function launchChrome(extraArgs = []) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'sd-profile-'));
  const args = [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--window-size=1440,900',
    '--hide-scrollbars',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    ...extraArgs,
  ];
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  const deadline = Date.now() + 30000;
  let targets = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      const info = await res.json();
      if (info.webSocketDebuggerUrl) {
        targets = info;
        break;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!targets) throw new Error('chrome did not start');
  return { proc, wsUrl: targets.webSocketDebuggerUrl };
}

export class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new Cdp(socket);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  onMessage(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close() {
    try {
      this.socket.close();
    } catch {
      /* noop */
    }
  }
}

/** Attach to the first real page target. */
export async function openPage(cdp) {
  const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  let page = list.find((t) => t.type === 'page');
  if (!page) {
    const created = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const again = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    page = again.find((t) => t.id === created.targetId) ?? again.find((t) => t.type === 'page');
  }
  const targetId = page.id ?? page.targetId;
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  return { sessionId, targetId };
}

export class Page {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.console = [];
    this.errors = [];
    this.requests = [];
    this.unwire = cdp.onMessage((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.consoleAPICalled') {
        this.console.push({
          type: msg.params.type,
          text: (msg.params.args ?? [])
            .map((a) => a.value ?? a.description ?? a.type)
            .join(' '),
        });
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(msg.params.exceptionDetails?.exception?.description ?? JSON.stringify(msg.params.exceptionDetails));
      }
      if (msg.method === 'Log.entryAdded') {
        const entry = msg.params.entry;
        if (entry.level === 'error') this.errors.push(`${entry.source}: ${entry.text}`);
      }
      if (msg.method === 'Network.requestWillBeSent') {
        this.requests.push(msg.params.request.url);
      }
    });
  }

  cmd(method, params = {}) {
    return this.cdp.send(method, params, this.sessionId);
  }

  async enable() {
    await this.cmd('Page.enable');
    await this.cmd('Runtime.enable');
    await this.cmd('Log.enable');
    await this.cmd('Network.enable');
    await this.cmd('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  async navigate(url) {
    await this.cmd('Page.navigate', { url });
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const ready = await this.evaluate('document.readyState');
      if (ready === 'complete') break;
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  async evaluate(expression) {
    const res = await this.cmd('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`eval failed: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
    }
    return res.result.value;
  }

  async setViewport(width, height, mobile = false, dpr = 1) {
    await this.cmd('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: dpr,
      mobile,
    });
    await this.cmd('Emulation.setVisibleSize', { width, height }).catch(() => {});
  }

  async key(type, code, key, options = {}) {
    const map = {
      KeyW: 'w',
      KeyA: 'a',
      KeyS: 's',
      KeyD: 'd',
      KeyQ: 'q',
      KeyE: 'e',
      KeyR: 'r',
      KeyP: 'p',
      KeyM: 'm',
      Space: ' ',
      Enter: 'Enter',
      ShiftLeft: 'Shift',
      ArrowUp: 'ArrowUp',
      ArrowDown: 'ArrowDown',
      ArrowLeft: 'ArrowLeft',
      ArrowRight: 'ArrowRight',
    };
    await this.cmd('Input.dispatchKeyEvent', {
      type,
      code,
      key: map[code] ?? key ?? code,
      windowsVirtualKeyCode: 0,
      nativeVirtualKeyCode: 0,
      ...options,
    });
  }

  async keyDown(code) {
    await this.key('keyDown', code);
  }

  async keyUp(code) {
    await this.key('keyUp', code);
  }

  async tap(type, x, y, opts = {}) {
    await this.cmd('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1, ...opts }],
    });
  }

  async pointer(type, x, y, button = 'none', clickCount = 0) {
    await this.cmd('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button,
      clickCount,
      buttons: button === 'left' ? 1 : 0,
    });
  }

  async screenshot(path) {
    const res = await this.cmd('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(res.data, 'base64');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, buf);
    return buf.length;
  }

  detach() {
    this.unwire();
  }
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
