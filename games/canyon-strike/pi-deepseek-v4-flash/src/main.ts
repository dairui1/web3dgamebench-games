import './style.css';
import { Game } from './game';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root');
window.addEventListener('error', (e) => {
  // surface fatal errors on screen for debugging in the bench harness
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:8px;bottom:8px;background:#a11;color:#fff;font:12px monospace;padding:8px;z-index:99999;max-width:90vw;white-space:pre-wrap';
  d.textContent = String(e.message);
  document.body.appendChild(d);
});
new Game(root);