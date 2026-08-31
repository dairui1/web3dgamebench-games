import './style.css';
import { Game } from './game/game';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root');

new Game(root);
