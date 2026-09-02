import './style.css';
import { Game } from './game/game';

const found = document.querySelector<HTMLDivElement>('#app');
if (!found) throw new Error('Missing #app root');
const root: HTMLDivElement = found;

const loader = document.createElement('div');
loader.className = 'boot';
loader.innerHTML = `
  <div class="boot-inner">
    <div class="boot-title">CANYON<span>STRIKE</span></div>
    <div class="boot-bar"><i></i></div>
    <div class="boot-sub">Surveying the Redstone Canyon&hellip;</div>
  </div>
`;
root.appendChild(loader);

function boot(): void {
  try {
    const game = new Game(root);
    game.build();
    game.start();
    loader.classList.add('done');
    window.setTimeout(() => loader.remove(), 600);
  } catch (err) {
    console.error(err);
    loader.innerHTML = `
      <div class="boot-inner">
        <div class="boot-title">CANYON<span>STRIKE</span></div>
        <div class="boot-sub error">
          Unable to start the 3D renderer.<br />WebGL may be disabled in this browser.
        </div>
      </div>`;
  }
}

// Let the loader paint before the (synchronous) terrain build.
requestAnimationFrame(() => window.setTimeout(boot, 40));
