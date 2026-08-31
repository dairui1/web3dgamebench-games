import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

import { AudioFX } from './game/audio';
import { Course, EXTRACT_Z, GATE_ZS, SEED } from './game/course';
import { Particles } from './game/particles';
import { Player, CRAFT_R, CRUISE } from './game/player';
import { Skyline } from './game/sky';
import { UI } from './game/ui';

type Phase = 'ready' | 'playing' | 'paused' | 'won' | 'lost';

// ============================================================================
//  Contract object
// ============================================================================
const bench: {
  phase: Phase;
  score: number;
  player: { x: number; y: number; z: number };
  relaysRestored: number;
  charge: number;
  seed: number;
  restartCount: number;
  orbsCollected: number;
  hazardHits: number;
  timeMs: number;
} = {
  phase: 'ready',
  score: 0,
  player: { x: 0, y: 12, z: 0 },
  relaysRestored: 0,
  charge: 100,
  seed: SEED,
  restartCount: 0,
  orbsCollected: 0,
  hazardHits: 0,
  timeMs: 0,
};
(window as unknown as Record<string, unknown>).__WEB3DGAMEBENCH__ = bench;

// ============================================================================
//  Constants
// ============================================================================
const MAX_CHARGE = 100;
const BASE_DRAIN = 4.4;
const BOOST_DRAIN = 8;
const ORB_GAIN = 13;
const RELAY_GAIN = 18;
const HAZARD_DMG = 15;
const LIGHTNING_DMG = 14;
const OFFORDER_DMG = 7;
const RELAY_SCORE = 250;
const ORB_SCORE = 30;
const WIN_SCORE = 500;

// ============================================================================
//  Bootstrap
// ============================================================================
const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root');

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.domElement.id = 'webgl-canvas';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1226);
scene.fog = new THREE.FogExp2(0x182244, 0.0026);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, 3600);
camera.position.set(0, 17, -14);

// ---- post processing
const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.05, 0.6, 0.55,
);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const fxaa = new ShaderPass(FXAAShader);
fxaa.material.uniforms['resolution'].value.set(
  1 / (window.innerWidth * renderer.getPixelRatio()),
  1 / (window.innerHeight * renderer.getPixelRatio()),
);
composer.addPass(fxaa);

// ---- ambient light
scene.add(new THREE.HemisphereLight(0x8fb4e8, 0x1a2030, 0.85));
const keyLight = new THREE.DirectionalLight(0xbfd6ff, 1.25);
keyLight.position.set(-30, 60, 20);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xff9a5c, 0.5);
rimLight.position.set(25, -10, -40);
scene.add(rimLight);

// ---- world
const skyline = new Skyline(scene);
const player = new Player(scene, camera);
const course = new Course(scene, SEED);
const particles = new Particles(2400, scene);
const audio = new AudioFX();
const ui = new UI(root, {
  onStart: () => {
    audio.init();
    audio.click();
    startRun();
  },
  onResume: () => {
    audio.init();
    audio.click();
    resume();
  },
  onRestart: () => {
    audio.init();
    audio.click();
    restart(true);
  },
  onMute: () => {
    audio.init();
    ui.setMuted(audio.toggleMute());
  },
});

// ============================================================================
//  State
// ============================================================================
let phase: Phase = 'ready';
let timeScale = 1;
let runMs = 0;
let charge = MAX_CHARGE;
let relaysRestored = 0;
let score = 0;
let orbScore = 0;
let relayScore = 0;
let winBonus = 0;
let orbsCollected = 0;
let hazardHits = 0;
let restartCount = 0;
let invuln = 0;
let boostHeld = false;
let boostTapT = 0;
let lostReason = '';
let wonT = 0;
let lostT = 0;
let overlayShown = false;
let failed = false;
let twoFinger = false;
let touchTap = false;
let belowDeckT = 0;
let warningTimer = 0.4;
let strikeTimer = 4.2;
let lockNoticeT = 0;

function setPhase(p: Phase): void {
  phase = p;
  bench.phase = p;
}

function startRun(): void {
  restartCount = 0;
  resetRun();
  setPhase('playing');
  ui.showOverlay(null);
  ui.setObjective(objectiveText());
}

function restart(fromUi: boolean): void {
  if (phase !== 'ready') restartCount++;
  resetRun();
  setPhase('playing');
  ui.showOverlay(null);
  ui.setObjective(objectiveText());
  audio.click();
  void fromUi;
}

function resetRun(): void {
  timeScale = 1;
  runMs = 0;
  charge = MAX_CHARGE;
  relaysRestored = 0;
  orbScore = 0;
  relayScore = 0;
  winBonus = 0;
  orbsCollected = 0;
  hazardHits = 0;
  invuln = 0;
  boostHeld = false;
  boostTapT = 0;
  wonT = 0;
  lostT = 0;
  overlayShown = false;
  failed = false;
  twoFinger = false;
  touchTap = false;
  belowDeckT = 0;
  warningTimer = 0.4;
  strikeTimer = 4.2;
  lockNoticeT = 0;
  strike = null;
  player.reset();
  course.reset();
  clearStrike();
  particles.clear();
  ui.showOverlay(null);
}

function pause(): void {
  if (phase !== 'playing') return;
  setPhase('paused');
  ui.showOverlay('paused');
  audio.click();
}

function resume(): void {
  if (phase !== 'paused') return;
  setPhase('playing');
  ui.showOverlay(null);
}

function fail(reason: string): void {
  if (failed) return;
  failed = true;
  lostReason = reason;
  setPhase('lost');
  lostT = 0;
  overlayShown = false;
  player.addShake(3.4, 6);
  ui.flash('#ff5544', 1.3);
  audio.lose();
  burst(player.x, player.y, player.z, {
    count: 90, color: [1, 0.55, 0.25], speed: 34, spread: 1, life: 1.6, size: 2.6, gravity: -2,
  });
  burst(player.x, player.y, player.z, {
    count: 40, color: [0.35, 0.85, 1], speed: 26, spread: 1, life: 0.9, size: 1.6, drag: 3,
  });
}

function win(): void {
  if (phase === 'won') return;
  setPhase('won');
  wonT = 0;
  overlayShown = false;
  winBonus = WIN_SCORE;
  course.extract.setCrossed(true);
  player.addShake(1.6, 4);
  ui.flash('#ffe9a8', 1.1);
  audio.win();
  burst(player.x, player.y, player.z, {
    count: 70, color: [1, 0.85, 0.4], speed: 22, spread: 1, life: 1.4, size: 2.2,
  });
}

function objectiveText(): string {
  if (lockNoticeT > 0) return 'EXTRACTION LOCKED — RESTORE ALL THREE RELAYS FIRST';
  if (belowDeckT > 0) return 'PULL UP — YOU ARE ENTERING THE CLOUD DECK';
  if (relaysRestored >= 3) return 'ALL RELAYS RESTORED — CROSS THE EXTRACTION RING';
  const next = GATE_ZS[relaysRestored];
  return `RESTORE RELAY ${String(relaysRestored + 1).padStart(2, '0')}/03 — FOLLOW THE AMBER SIGNAL (${Math.max(0, Math.round((next - player.z) / player.speed))}s)`;
}

function updateScore(): void {
  score = Math.max(0, Math.floor(player.z * 0.06)) + relayScore + orbScore + winBonus;
}

function clearStrike(): void {
  if (strike) {
    scene.remove(strike.telegraph);
    scene.remove(strike.bolt);
    scene.remove(strike.glow);
    scene.remove(strike.light);
    strike.telegraph.geometry.dispose();
    (strike.telegraph.material as THREE.Material).dispose();
    strike.bolt.geometry.dispose();
    (strike.bolt.material as THREE.Material).dispose();
    strike.glow.material.dispose();
    strike = null;
  }
}

// ============================================================================
//  Lightning / storm strikes
// ============================================================================
interface Strike {
  x: number; y: number; z: number;
  t: number;
  telegraph: THREE.Mesh;
  bolt: THREE.Mesh;
  glow: THREE.Sprite;
  light: THREE.PointLight;
  struck: boolean;
  done: boolean;
}
let strike: Strike | null = null;

function spawnStrike(craftZ: number): void {
  let z = craftZ + 140 + Math.random() * 190;
  for (const gz of [...GATE_ZS, EXTRACT_Z]) {
    if (Math.abs(gz - z) < 75) z = gz + 75 + Math.random() * 30;
  }
  const x = (Math.random() - 0.5) * 40;
  const y = 6 + Math.random() * 15;
  const telegraph = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 2.4, 52, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffb060, transparent: true, opacity: 0.0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }),
  );
  telegraph.position.set(x, y + 22, z);
  telegraph.frustumCulled = false;
  scene.add(telegraph);
  const bolt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 1.9, 58, 6, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xcfeaff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }),
  );
  bolt.position.set(x, y + 24, z);
  bolt.frustumCulled = false;
  scene.add(bolt);
  const glowTex = makeGlowTex2();
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex, color: 0xffc878, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  );
  glow.position.set(x, y, z);
  glow.scale.set(16, 16, 1);
  scene.add(glow);
  const light = new THREE.PointLight(0xffc878, 0, 90, 1.6);
  light.position.set(x, y + 20, z);
  scene.add(light);
  strike = { x, y, z, t: 0, telegraph, bolt, glow, light, struck: false, done: false };
}

function updateStrike(dt: number, craftX: number, craftY: number, craftZ: number): void {
  if (strike) {
    strike.t += dt;
    const s = strike;
    const tm = s.telegraph.material as THREE.MeshBasicMaterial;
    const bm = s.bolt.material as THREE.MeshBasicMaterial;
    const gm = s.glow.material as THREE.SpriteMaterial;
    if (s.t < 1.25) {
      // telegraph phase
      const flick = 0.5 + 0.5 * Math.sin(s.t * 26) * Math.sin(s.t * 7.3);
      tm.opacity = 0.05 + 0.16 * flick;
      s.glow.scale.setScalar(14 + 4 * Math.sin(s.t * 13));
      gm.opacity = 0.05 + 0.05 * flick;
      const prowlX = s.x + Math.sin(s.t * 1.7) * 1.8;
      const prowlY = s.y + Math.sin(s.t * 2.3) * 1.2;
      s.telegraph.position.set(prowlX, s.y + 22, s.z);
      (s.glow as THREE.Sprite).position.set(prowlX, prowlY, s.z);
    } else if (s.t < 1.65) {
      // bolt flash
      bm.opacity = 0.85;
      tm.opacity = 0;
      gm.opacity = 0.55;
      s.light.intensity = 160 * Math.max(0, 1 - (s.t - 1.25) / 0.4);
      const dx = craftX - s.x, dy = craftY - s.y;
      if (!s.struck && dx * dx + dy * dy < 8.5 * 8.5) {
        s.struck = true;
        if (invuln <= 0) {
          charge -= LIGHTNING_DMG;
          hazardHits++;
          invuln = 0.9;
          player.addShake(2.6, 3);
          timeScale = 0.3;
          audio.damage();
          audio.strike();
          ui.pulseDamage();
          ui.flash('#ffffff', 0.9);
          burst(craftX, craftY, craftZ, {
            count: 26, color: [0.9, 0.95, 1], speed: 24, spread: 1, life: 0.55, size: 1.7,
          });
        }
      }
    } else if (s.t < 3.4) {
      bm.opacity = Math.max(0, bm.opacity - dt * 2.2);
      gm.opacity = Math.max(0, gm.opacity - dt * 0.5);
      s.light.intensity *= Math.exp(-dt * 9);
    } else {
      s.done = true;
      scene.remove(s.telegraph);
      scene.remove(s.bolt);
      scene.remove(s.glow);
      scene.remove(s.light);
      s.telegraph.geometry.dispose();
      (s.telegraph.material as THREE.Material).dispose();
      s.bolt.geometry.dispose();
      (s.bolt.material as THREE.Material).dispose();
      s.glow.material.dispose();
      strike = null;
    }
    void craftZ;
  }
  if (!strike) {
    strikeTimer -= dt;
    if (strikeTimer <= 0) {
      if (craftZ > 90) {
        spawnStrike(craftZ);
        audio.warning();
      }
      strikeTimer = 5.5 + Math.random() * 4.5;
    }
  }
}

function makeGlowTex2(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// ============================================================================
//  Input
// ============================================================================
const keys = new Set<string>();
const drag = { dx: 0, dy: 0 };
let dragActive = false;
const pointers = new Map<number, { x: number; y: number; prevX: number; prevY: number; startX: number; startY: number; t: number; moved: boolean }>();

window.addEventListener('keydown', (e) => {
  audio.init();
  const code = e.code;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) e.preventDefault();
  keys.add(code);
  if (phase === 'ready' && (code === 'Space' || code === 'Enter')) {
    e.preventDefault();
    startRun();
    return;
  }
  if (code === 'KeyP' || code === 'Escape') {
    if (phase === 'playing') pause();
    else if (phase === 'paused') resume();
  }
  if (code === 'KeyR') {
    if (phase !== 'ready') restart(false);
  }
  if (code === 'KeyM') ui.setMuted(audio.toggleMute());
  if (code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight') {
    audio.init();
    if (phase === 'playing') audio.boostOn();
  }
}, { passive: false });

window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});

// pointer steering (desktop + touch)
const canvasEl = renderer.domElement;
canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());

canvasEl.addEventListener('pointerdown', (e) => {
  audio.init();
  if (e.button !== 0) return;
  dragActive = true;
  pointers.set(e.pointerId, {
    x: e.clientX, y: e.clientY, prevX: e.clientX, prevY: e.clientY,
    startX: e.clientX, startY: e.clientY, t: performance.now(), moved: false,
  });
  canvasEl.setPointerCapture?.(e.pointerId);
});

canvasEl.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  drag.dx += e.clientX - p.prevX;
  drag.dy += e.clientY - p.prevY;
  p.prevX = e.clientX;
  p.prevY = e.clientY;
  if (Math.abs(e.clientX - p.startX) + Math.abs(e.clientY - p.startY) > 12) p.moved = true;
});

canvasEl.addEventListener('pointerup', (e) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (!p) return;
  if (!p.moved && performance.now() - p.t < 260) touchTap = true;
  if (pointers.size === 0) {
    dragActive = false;
    drag.dx = 0;
    drag.dy = 0;
  }
});

canvasEl.addEventListener('pointercancel', () => {
  pointers.clear();
  dragActive = false;
  drag.dx = 0;
  drag.dy = 0;
});

// touch: two-finger = sustained boost
canvasEl.addEventListener('touchstart', () => {
  twoFinger = pointers.size >= 2;
}, { passive: true });
canvasEl.addEventListener('touchmove', (e) => {
  e.preventDefault();
  twoFinger = pointers.size >= 2;
}, { passive: false });

window.addEventListener('blur', () => { /* keep playing on blur; visibilitychange handles hiding */ });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'playing') {
    pause();
    ui.setObjective('PAUSED — flight systems on hold');
  }
});

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  bloom.setSize(w, h);
  fxaa.material.uniforms['resolution'].value.set(
    1 / (w * renderer.getPixelRatio()),
    1 / (h * renderer.getPixelRatio()),
  );
  particles.setPixelRatio(renderer.getPixelRatio());
});

// ============================================================================
//  Helpers
// ============================================================================
function burst(x: number, y: number, z: number, opts: Parameters<Particles['burst']>[3]): void {
  particles.burst(x, y, z, opts);
}

function applyHazard(px: number, py: number, pz: number): void {
  if (invuln > 0) return;
  charge -= HAZARD_DMG;
  hazardHits++;
  invuln = 0.9;
  player.addShake(2.4, 3.4);
  timeScale = 0.32;
  audio.damage();
  ui.pulseDamage();
  ui.flash('#ff6655', 1.0);
  burst(px, py, pz, {
    count: 30, color: [1, 0.5, 0.2], speed: 24, spread: 1, life: 0.7, size: 2.0, gravity: -1,
  });
}

const collectedOrbs: number[] = [];

// ============================================================================
//  Update
// ============================================================================
function updatePlaying(dt: number): void {
  // --- input aggregation
  let ix = 0;
  let iy = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) iy += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) iy -= 1;

  // pointer drag → velocity injection
  const pxScale = window.innerWidth < 600 ? 0.085 : 0.045;
  let ddx = drag.dx * pxScale;
  let ddy = -drag.dy * (window.innerWidth < 600 ? 0.09 : 0.05);
  // move the drag vector's steering toward matching velocity as well:
  // (keep simple: one-shot impulses per frame, damped by steer)
  drag.dx = 0;
  drag.dy = 0;

  // boost
  const boostKey = keys.has('Space') || keys.has('ShiftLeft') || keys.has('ShiftRight');
  boostHeld = boostKey || twoFinger;
  if (touchTap) {
    boostTapT = 0.55;
    touchTap = false;
  }
  let boosting = boostHeld;
  if (boostTapT > 0) {
    boostTapT -= dt;
    boosting = true;
  }

  // time-scale recovery
  timeScale += (1 - timeScale) * (1 - Math.exp(-8 * dt));
  const sdt = dt * timeScale;

  player.steer(sdt, ix, iy, ddx, ddy);
  player.update(sdt, boosting, timeScale);

  // forward distance & charge
  const drain = (BASE_DRAIN + (boosting ? BOOST_DRAIN : 0)) * sdt;
  charge -= drain * (charge < 18 ? 0.6 : 1);
  if (charge > MAX_CHARGE) charge = MAX_CHARGE;

  // cloud-nape hazard: pressing down too far drags the craft into the deck
  if (player.y < -6.5) {
    // strong resistance
    player.vy += (-20 - player.vy) * (1 - Math.exp(-4 * sdt));
    warningTimer -= sdt;
    if (warningTimer <= 0) {
      audio.warning();
      warningTimer = 0.45;
    }
    belowDeckT += sdt;
    if (belowDeckT > 1.5) {
      fail('the courier was swallowed by the cloud deck');
      return;
    }
  } else {
    belowDeckT = Math.max(0, belowDeckT - sdt * 2);
    warningTimer = 0.4;
  }
  if (phase !== 'playing') return;

  if (invuln > 0) {
    invuln -= dt;
    player.group.visible = Math.floor(invuln * 12) % 2 === 0;
  } else if (!player.group.visible) {
    player.group.visible = true;
  }

  // --- course sim
  course.update(sdt, player.z);
  for (let i = 0; i < course.gates.length; i++) course.gates[i].setHighlight(i === relaysRestored);

  // --- orbs
  collectedOrbs.length = 0;
  course.tryCollectOrbs(player.x, player.y, player.z, 4.0, collectedOrbs);
  for (const idx of collectedOrbs) {
    const o = course.orbs[idx];
    orbsCollected++;
    orbScore += ORB_SCORE;
    charge = Math.min(MAX_CHARGE, charge + ORB_GAIN);
    audio.pickup();
    burst(o.x, o.y, o.z, {
      count: 14, color: [0.4, 0.95, 1], speed: 14, spread: 1, life: 0.5, size: 1.4,
    });
  }

  // --- hazard collisions
  for (const d of course.drones) {
    if (!d.active) continue;
    const dx = d.x - player.x, dy = d.y - player.y, dz = d.z - player.z;
    const rr = d.r + CRAFT_R;
    if (dx * dx + dy * dy + dz * dz < rr * rr) {
      applyHazard(player.x, player.y, player.z);
      burst(d.x, d.y, d.z, { count: 20, color: [1, 0.35, 0.18], speed: 20, spread: 0.7, life: 0.6, size: 1.8 });
    }
  }
  for (const tb of course.tumblers) {
    if (!tb.active) continue;
    const dx = tb.x - player.x, dy = tb.y - player.y, dz = tb.z - player.z;
    const rr = tb.r + CRAFT_R;
    if (dx * dx + dy * dy + dz * dz < rr * rr) {
      applyHazard(player.x, player.y, player.z);
      burst(tb.x, tb.y, tb.z, { count: 22, color: [0.7, 0.5, 0.35], speed: 16, spread: 0.8, life: 0.7, size: 2.0 });
    }
  }
  for (const s of course.strikers) {
    if (!s.active) continue;
    const dx = s.x - player.x, dy = s.y - player.y, dz = s.z - player.z;
    const rr = s.r + CRAFT_R;
    if (dx * dx + dy * dy + dz * dz < rr * rr) {
      applyHazard(player.x, player.y, player.z);
      burst(s.x, s.y, s.z, { count: 26, color: [1, 0.7, 0.2], speed: 24, spread: 0.7, life: 0.6, size: 1.8 });
      s.active = false;
    }
  }

  if (phase !== 'playing') return;

  // --- gates
  const ev = course.tryGateCross(player.z - player.speed * sdt, player.z, player.x, player.y);
  if (ev) {
    if (ev.type === 'relay') {
      if (ev.index === relaysRestored) {
        relaysRestored++;
        relayScore += RELAY_SCORE;
        charge = Math.min(MAX_CHARGE, charge + RELAY_GAIN);
        course.markRelayRestored(ev.index);
        audio.restore();
        player.addShake(1.0, 2);
        ui.flash('#ffe9a8', 0.8);
        burst(course.gates[ev.index].x, course.gates[ev.index].y, course.gates[ev.index].z, {
          count: 60, color: [1, 0.85, 0.45], speed: 26, spread: 1, life: 1.0, size: 2.0,
        });
        if (relaysRestored >= 3) {
          ui.setObjective('ALL RELAYS RESTORED — CROSS THE EXTRACTION RING AHEAD');
          course.extract.setUnlocked(true);
          burst(player.x, player.y, player.z, { count: 30, color: [1, 0.8, 0.5], speed: 18, spread: 1, life: 0.8, size: 1.6 });
        }
      } else if (ev.index > relaysRestored) {
        // out-of-order: handled order penalty
        charge -= OFFORDER_DMG;
        invuln = Math.max(invuln, 0.5);
        audio.damage();
        ui.pulseDamage();
        ui.flash('#ff9a6b', 0.6);
        burst(player.x, player.y, player.z, { count: 16, color: [1, 0.6, 0.3], speed: 16, spread: 0.9, life: 0.5, size: 1.5 });
      }
    } else if (ev.type === 'extract') {
      win();
    } else if (ev.type === 'locked') {
      lockNoticeT = 2.5;
      audio.damage();
      ui.flash('#ffca7a', 0.4);
      burst(player.x, player.y, player.z, { count: 14, color: [1, 0.75, 0.4], speed: 14, spread: 0.9, life: 0.5, size: 1.4 });
    }
  }

  if (phase !== 'playing') return;

  // --- lightning
  updateStrike(sdt, player.x, player.y, player.z);

  // --- engine trail
  const spawnRate = (boostHeld || boosting ? 90 : 46) * sdt;
  const tz = player.speed * 0.25;
  particles.trickle(
    player.x - 0.95, player.y - 0.05, player.z - 2.2,
    -player.vx * 0.2, -player.vy * 0.2, player.speed - tz,
    spawnRate * 2,
    boostHeld || boosting ? 0.42 : 0.3,
    boostHeld || boosting ? 1.7 : 1.1,
    0.55, 0.85, 1,
    1.2,
  );

  // --- failure checks
  if (charge <= 0) {
    fail('carrier charge depleted');
    return;
  }
  if (lockNoticeT > 0) lockNoticeT -= sdt;
  updateScore();
  bench.relaysRestored = relaysRestored;
  runMs += sdt * 1000;
}

function updateWon(dt: number): void {
  wonT += dt;
  player.speed += (4 - player.speed) * (1 - Math.exp(-1.8 * dt));
  player.z += player.speed * dt;
  course.update(dt, player.z);
  timeScale += (0.25 - timeScale) * (1 - Math.exp(-3 * dt));
  particles.trickle(
    player.x, player.y + 1, player.z - 1,
    (Math.random() - 0.5) * 4, 6 + Math.random() * 8, player.speed * 0.2,
    8 * dt, 1.2, 1.8, 1, 0.85, 0.4, 0.2,
  );
  if (wonT > 1.4 && !overlayShown) {
    overlayShown = true;
    ui.showWinStats({
      timeMs: runMs, orbs: orbsCollected, relays: relaysRestored, score, hits: hazardHits,
    });
    ui.showOverlay('won');
  }
  // cinematic pull-back so the ring reads as a landmark, not a white-out
  const ck = 1 - Math.exp(-2.2 * dt);
  camera.position.x += (player.x - camera.position.x) * ck;
  camera.position.y += (player.y + 9.5 - camera.position.y) * ck;
  camera.position.z += (player.z - 42 - camera.position.z) * ck;
  camera.up.set(0, 1, 0);
  camera.lookAt(player.x, player.y + 1, player.z + 34);
  updateScore();
}

function updateLost(dt: number): void {
  lostT += dt;
  player.sinkUpdate(dt);
  // camera keeps watching the sinking craft
  camera.position.x += (player.x - camera.position.x) * (1 - Math.exp(-3 * dt));
  camera.position.y = player.y + 26;
  camera.position.z = player.z - 12;
  camera.up.set(0, 1, 0);
  camera.lookAt(player.x, player.y - 4, player.z + 14);
  particles.trickle(
    player.x, player.y, player.z,
    (Math.random() - 0.5) * 8, -4 + Math.random() * 6, player.speed * 0.1,
    26 * dt, 1.4, 2.4, 1, 0.45, 0.2, -1,
  );
  if (lostT > 1.1 && !overlayShown) {
    overlayShown = true;
    ui.setLostReason(lostReason);
    ui.showOverlay('lost');
  }
}

function updateReady(dt: number, t: number): void {
  player.idleUpdate(dt, t);
  course.update(dt, player.z);
  particles.trickle(
    player.x - 0.95, player.y - 0.05, player.z - 2.2,
    -player.vx * 0.2, -player.vy * 0.2, player.speed - 10,
    10 * dt, 0.5, 1.2, 0.55, 0.85, 1, 1.2,
  );
}

// ============================================================================
//  Main loop
// ============================================================================
let lastT = performance.now();
let globalT = 0;

function frame(now: number): void {
  // 0.1s clamp keeps the sim at real-time even around ~10fps software rendering;
  // the game also auto-pauses when the tab is hidden, so long frames are rare.
  const rawDt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  globalT += rawDt;
  const dt = rawDt;

  if (phase === 'playing') {
    updatePlaying(dt);
  } else if (phase === 'won') {
    updateWon(dt);
  } else if (phase === 'lost') {
    updateLost(dt);
  } else if (phase === 'ready') {
    updateReady(dt, globalT);
  }
  // paused: no simulation, static frame

  skyline.update(dt, player.x, player.y, player.z, camera.position.z);
  particles.update(dt);

  // contract
  bench.score = score;
  bench.player.x = player.x;
  bench.player.y = player.y;
  bench.player.z = player.z;
  bench.charge = charge;
  bench.restartCount = restartCount;
  bench.orbsCollected = orbsCollected;
  bench.hazardHits = hazardHits;
  bench.timeMs = runMs;
  if (!Number.isFinite(bench.player.x)) bench.player.x = 0;
  if (!Number.isFinite(bench.player.y)) bench.player.y = 12;
  if (!Number.isFinite(bench.player.z)) bench.player.z = 0;
  if (!Number.isFinite(bench.charge)) bench.charge = 0;

  // hud
  if (phase !== 'ready') {
    ui.update({
      charge,
      relaysRestored,
      score,
      speed: player.speed,
      boosting: boostHeld,
      timeMs: runMs,
      orbs: orbsCollected,
      hits: hazardHits,
    }, now);
  }

  audio.setEngine(player.speed / CRUISE, boostHeld || boostTapT > 0);

  composer.render();

  if (phase === 'playing') ui.setObjective(objectiveText());
}
renderer.setAnimationLoop(frame);

// initial overlay
ui.showOverlay('ready');

// canvas must be a child of #app *after* the UI markup is built (innerHTML would wipe it)
root.prepend(renderer.domElement);
ui.setObjective('PREPARE FOR DELIVERY — RESTORE ALL THREE RELAY GATES');
ui.setMuted(false);

// first-frame camera intro
camera.position.set(0, 19, -8);
player.lookAtCenter();

console.log('Signal Drift ready (seed', SEED + ')');