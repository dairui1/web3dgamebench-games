import './style.css';
import { Game } from './game';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root');

try {
  const game = new Game(root);
  game.startLoop();
} catch (err) {
  console.error(err);
  root.innerHTML = `
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                padding:24px;text-align:center;font-family:ui-monospace,monospace;color:#eaf6ff">
      <div>
        <h1 style="letter-spacing:.16em">Signal Drift</h1>
        <p style="opacity:.75;line-height:1.7">
          This browser could not open a WebGL context, so the relay field cannot be drawn.<br />
          Enable hardware acceleration or try another browser.
        </p>
      </div>
    </div>`;
}
