import './style.css';
import { Game } from './game/game';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root');

try {
  new Game(root);
} catch (err) {
  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100%;
                font-family:system-ui,sans-serif;color:#9fd8e8;text-align:center;padding:2rem;">
      <div>
        <h1 style="letter-spacing:0.3em;">SIGNAL DRIFT</h1>
        <p>WebGL is unavailable in this browser, so the relay field cannot be reached.</p>
      </div>
    </div>`;
  throw err;
}
