import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { launchChrome, Cdp, openPage, Page, wait } from './cdp.mjs';

const PORT = Number(process.env.PROBE_PORT || 4188);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

function serve() {
  const proc = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  return proc;
}

async function waitForServer(deadlineMs = 20000) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(APP_URL);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await wait(200);
  }
  throw new Error('preview server never came up');
}

const server = serve();
const { proc, wsUrl } = await launchChrome();
const cdp = await Cdp.connect(wsUrl);
const { sessionId } = await openPage(cdp);
const page = new Page(cdp, sessionId);
await page.enable();

try {
  await waitForServer();
  await page.setViewport(1440, 900, false, 1);
  await page.navigate(APP_URL);
  await wait(3500);
  console.log('inspector:', JSON.stringify(await page.evaluate('window.__WEB3DGAMEBENCH__'), null, 1));
  console.log('canvas:', await page.evaluate('!!document.querySelector("canvas")'));
  console.log('webgl:', await page.evaluate(`(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    return gl ? gl.getParameter(gl.VERSION) + ' | ' + gl.getParameter(gl.RENDERER) : 'none';
  })()`));
  await page.screenshot(`${OUT}/ready-desktop.png`);
  console.log('console:', page.console.slice(0, 20));
  console.log('errors:', page.errors.slice(0, 10));
  console.log('requests:', [...new Set(page.requests)].slice(0, 20));
} finally {
  page.detach();
  cdp.close();
  proc.kill('SIGKILL');
  server.kill('SIGKILL');
}
