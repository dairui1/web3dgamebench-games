// Minimal Chrome DevTools Protocol driver used to play-test the build locally.
// Dev tooling only: not part of the game bundle.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/ms-playwright/chromium-1234/chrome-linux/chrome';

export async function launch(port = 9222) {
  const userDir = mkdtempSync(join(tmpdir(), 'sd-chrome-'));
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDir}`,
      '--no-sandbox',
      '--no-first-run',
      '--disable-gpu-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      '--mute-audio',
      '--window-size=1280,800',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  proc.stderr.on('data', () => {});
  const deadline = Date.now() + 20000;
  let target = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!target) {
    proc.kill();
    throw new Error('chrome did not start');
  }
  return { proc, wsUrl: target.webSocketDebuggerUrl };
}

export class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    return new Session(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description ?? 'eval failed');
    }
    return res.result.value;
  }

  async setViewport(width, height, mobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: mobile ? 3 : 1,
      mobile,
    });
    if (mobile) {
      await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await this.send('Emulation.setEmitTouchEventsForMouse', {
        enabled: true,
        configuration: 'mobile',
      });
    } else {
      await this.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  }

  async key(code, key, type, extra = {}) {
    await this.send('Input.dispatchKeyEvent', {
      type,
      code,
      key,
      windowsVirtualKeyCode: extra.vk ?? 0,
      nativeVirtualKeyCode: extra.vk ?? 0,
      ...extra,
    });
  }

  async keyPress(code, key, vk) {
    await this.key(code, key, 'keyDown', { vk });
    await this.key(code, key, 'keyUp', { vk });
  }

  async mouse(type, x, y, button = 'left') {
    await this.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button,
      buttons: type === 'mouseMoved' ? 1 : button === 'left' ? 1 : 0,
      clickCount: 1,
    });
  }

  async touch(type, x, y) {
    await this.send('Input.dispatchTouchEvent', {
      type,
      touchPoints:
        type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }],
    });
  }

  async screenshot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from(data, 'base64'));
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
