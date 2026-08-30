import * as THREE from 'three';
import './style.css';

type Phase = 'ready' | 'playing' | 'paused' | 'won' | 'lost';
type HazardKind = 'drone' | 'shard' | 'sweep';
type DigitalControl = 'left' | 'right' | 'up' | 'down' | 'boost' | 'brake';

interface RuntimeState {
  phase: Phase;
  score: number;
  player: { x: number; y: number; z: number };
  relaysRestored: number;
  charge: number;
  seed: number;
  restartCount: number;
  objective: string;
}

interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  boost: boolean;
  brake: boolean;
  pointerSteer: number | null;
  pointerBoost: boolean;
}

interface RelayGate {
  index: number;
  x: number;
  y: number;
  z: number;
  group: THREE.Group;
  ring: THREE.Mesh;
  innerRing: THREE.Mesh;
  core: THREE.Mesh;
  beam: THREE.Mesh;
  light: THREE.PointLight;
  restored: boolean;
  crossed: boolean;
  pulse: number;
}

interface Hazard {
  kind: HazardKind;
  group: THREE.Group;
  core: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  amplitudeX: number;
  amplitudeY: number;
  phase: number;
  speed: number;
  radius: number;
  hitCooldown: number;
}

interface ChargeCell {
  group: THREE.Group;
  x: number;
  y: number;
  z: number;
  phase: number;
  collected: boolean;
}

declare global {
  interface Window {
    __AETHERPLAY__?: RuntimeState;
  }
}

const SEED = 94721;
const START_Z = 22;
const FINISH_Z = -408;
const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root');

root.innerHTML = `
  <main class="game-shell" aria-label="Signal Drift game">
    <canvas id="scene-canvas" aria-label="3D relay field"></canvas>
    <div class="screen-grain" aria-hidden="true"></div>
    <div class="scanline" aria-hidden="true"></div>
    <div class="edge-vignette" aria-hidden="true"></div>

    <section class="hud" id="hud" aria-live="polite">
      <div class="hud-brand">
        <span class="brand-mark"><i></i><i></i><i></i></span>
        <span class="brand-name">SIGNAL <b>DRIFT</b></span>
        <span class="live-chip"><em></em> LIVE RUN</span>
      </div>
      <div class="hud-readouts">
        <div class="readout charge-readout">
          <div class="readout-top"><span class="micro-label">CRAFT CHARGE</span><strong id="charge-value">88</strong><span class="unit">%</span></div>
          <div class="charge-meter"><span id="charge-fill"></span><i></i><i></i><i></i><i></i></div>
          <div class="readout-bottom"><span id="charge-note">STABLE</span><span id="score-value">SCORE 000000</span></div>
        </div>
        <div class="readout relay-readout">
          <div class="readout-top"><span class="micro-label">RELAY CHAIN</span><strong id="relay-count">0</strong><span class="unit">/ 3</span></div>
          <div class="relay-dots" id="relay-dots"><i></i><i></i><i></i></div>
          <div class="readout-bottom"><span id="relay-status">LINKS DORMANT</span><span id="distance-value">22M OUT</span></div>
        </div>
      </div>
      <div class="objective-readout">
        <span class="micro-label">CURRENT OBJECTIVE</span>
        <strong id="objective-value">ALIGN WITH RELAY 01</strong>
        <span id="objective-detail">Thread the amber gate to restore the signal chain.</span>
      </div>
    </section>

    <div class="flight-reticle" id="flight-reticle" aria-hidden="true"><span></span><i></i><b></b></div>
    <div class="alert-toast" id="alert-toast" role="status"><span class="alert-line"></span><span id="alert-message">SIGNAL ACQUIRED</span></div>

    <section class="screen-overlay intro-overlay" id="intro-overlay">
      <div class="intro-copy">
        <div class="overline"><span class="overline-rule"></span> DEEP-CLOUD RELAY FIELD <span class="overline-code">/ 07</span></div>
        <h1>Signal<br><span>Drift</span></h1>
        <p class="intro-lede">The storm took the network offline.<br>Fly the gap. Bring the chain back.</p>
        <div class="mission-card">
          <div class="mission-card-head"><span>FLIGHT BRIEF</span><span class="brief-status"><i></i> READY</span></div>
          <div class="mission-objective"><span class="objective-index">01</span><span>RESTORE THREE RELAY GATES<br><b>THEN CROSS THE EXTRACTION RING</b></span></div>
          <div class="mission-divider"></div>
          <div class="mission-stats"><span><b>FIELD</b> NIMBUS-4</span><span><b>CRAFT</b> COURIER / K-2</span><span><b>CHARGE</b> 88%</span></div>
        </div>
        <button class="primary-button" data-action="start"><span>INITIALIZE FLIGHT</span><b>↗</b></button>
        <div class="control-hint"><span class="key-hint">A</span><span class="key-hint">D</span><span>STEER</span><span class="hint-separator">·</span><span class="key-hint wide">W</span><span>BOOST</span><span class="hint-separator">·</span><span class="key-hint">P</span><span>PAUSE</span><span class="mobile-control-note">TOUCH: DRAG TO STEER · HOLD BOOST</span></div>
      </div>
      <div class="intro-aside" aria-hidden="true">
        <div class="aside-radar"><span class="radar-sweep"></span><i></i><i></i><i></i><b>FIELD<br>MAP</b></div>
        <div class="aside-caption">A STORM FRONT IS MOVING<br>ACROSS THE CORRIDOR</div>
        <div class="aside-coordinates"><span>37° 12' N</span><span>118° 04' W</span><span>ALT 8,400</span></div>
      </div>
    </section>

    <section class="screen-overlay state-overlay" id="state-overlay" hidden>
      <div class="state-panel">
        <div class="overline"><span class="overline-rule"></span><span id="state-overline">FLIGHT STATE</span></div>
        <h2 id="state-title">Flight paused</h2>
        <p id="state-copy">The relay field is holding position.</p>
        <div class="state-metrics"><div><span>RELAYS</span><b id="state-relays">0 / 3</b></div><div><span>SCORE</span><b id="state-score">000000</b></div><div><span>CHARGE</span><b id="state-charge">88%</b></div></div>
        <button class="primary-button" id="state-action" data-action="resume"><span>RESUME FLIGHT</span><b>↗</b></button>
        <div class="state-shortcut"><span class="key-hint">P</span> TO PAUSE <span class="shortcut-separator">/</span> <span class="key-hint">R</span> TO RESTART</div>
      </div>
    </section>

    <section class="touch-controls" id="touch-controls" aria-label="Touch controls">
      <div class="touch-steer"><button data-control="left" aria-label="Steer left">‹</button><span>STEER</span><button data-control="right" aria-label="Steer right">›</button></div>
      <button class="boost-button" data-control="boost" aria-label="Boost"><span class="boost-glyph">↯</span><span>BOOST</span></button>
    </section>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#scene-canvas');
if (!canvas) throw new Error('Missing scene canvas');
const sceneCanvas = canvas;

const hud = document.querySelector<HTMLElement>('#hud');
const introOverlay = document.querySelector<HTMLElement>('#intro-overlay');
const stateOverlay = document.querySelector<HTMLElement>('#state-overlay');
const touchControls = document.querySelector<HTMLElement>('#touch-controls');
const stateAction = document.querySelector<HTMLButtonElement>('#state-action');
const flightReticle = document.querySelector<HTMLElement>('#flight-reticle');
const alertToast = document.querySelector<HTMLElement>('#alert-toast');
const chargeValue = document.querySelector<HTMLElement>('#charge-value');
const chargeFill = document.querySelector<HTMLElement>('#charge-fill');
const chargeNote = document.querySelector<HTMLElement>('#charge-note');
const scoreValue = document.querySelector<HTMLElement>('#score-value');
const relayCount = document.querySelector<HTMLElement>('#relay-count');
const relayDots = document.querySelectorAll<HTMLElement>('#relay-dots i');
const relayStatus = document.querySelector<HTMLElement>('#relay-status');
const distanceValue = document.querySelector<HTMLElement>('#distance-value');
const objectiveValue = document.querySelector<HTMLElement>('#objective-value');
const objectiveDetail = document.querySelector<HTMLElement>('#objective-detail');
const stateOverline = document.querySelector<HTMLElement>('#state-overline');
const stateTitle = document.querySelector<HTMLElement>('#state-title');
const stateCopy = document.querySelector<HTMLElement>('#state-copy');
const stateRelays = document.querySelector<HTMLElement>('#state-relays');
const stateScore = document.querySelector<HTMLElement>('#state-score');
const stateCharge = document.querySelector<HTMLElement>('#state-charge');
const alertMessage = document.querySelector<HTMLElement>('#alert-message');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04111e);
scene.fog = new THREE.FogExp2(0x061522, 0.0105);

const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 700);
camera.position.set(0, 7.5, 37);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.85));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const rng = createRng(SEED);
const input: InputState = {
  left: false,
  right: false,
  up: false,
  down: false,
  boost: false,
  brake: false,
  pointerSteer: null,
  pointerBoost: false,
};

const runtime: RuntimeState = {
  phase: 'ready',
  score: 0,
  player: { x: 0, y: 0.35, z: START_Z },
  relaysRestored: 0,
  charge: 88,
  seed: SEED,
  restartCount: 0,
  objective: 'ALIGN WITH RELAY 01',
};
window.__AETHERPLAY__ = runtime;

const clock = new THREE.Clock();
const player = new THREE.Vector3(0, 0.35, START_Z);
const playerVelocity = new THREE.Vector3();
const playerGroup = new THREE.Group();
const world = new THREE.Group();
const courseGroup = new THREE.Group();
const atmosphereGroup = new THREE.Group();
const relayGroup = new THREE.Group();
const hazardGroup = new THREE.Group();
const pickupGroup = new THREE.Group();
const particleGroup = new THREE.Group();
scene.add(world);
world.add(courseGroup, atmosphereGroup, relayGroup, hazardGroup, pickupGroup, particleGroup);

const colors = {
  cyan: 0x75e6e0,
  cyanDeep: 0x176b7d,
  amber: 0xffb454,
  amberHot: 0xffe2a4,
  coral: 0xff6c5c,
  violet: 0x9f8fff,
  cloud: 0xa7cbd0,
  ink: 0x071a2b,
};

const relayPalette = [colors.amber, colors.cyan, colors.violet];
const relays: RelayGate[] = [];
const hazards: Hazard[] = [];
const pickups: ChargeCell[] = [];

let phase: Phase = 'ready';
let elapsed = 0;
let distanceTraveled = 0;
let collectedCount = 0;
let impactCount = 0;
let steerInput = 0;
let currentSpeed = 0;
let cameraShake = 0;
let impactFlash = 0;
let successFlash = 0;
let alertTimer = 0;
let pointerDown = false;
let dragStartX = 0;

const engineGlowMaterials: THREE.MeshBasicMaterial[] = [];
const ship = createCourierCraft();
playerGroup.add(ship);
scene.add(playerGroup);

createEnvironment();
createRelays();
createHazards();
createPickups();
createParticleTrails();
createLighting();

const impactRing = createImpactRing();
scene.add(impactRing);

setupControls();
setPhase('ready');
resize();
window.addEventListener('resize', resize, { passive: true });
document.addEventListener('visibilitychange', handleVisibilityChange);

animate();

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function standardMaterial(color: number, emissive = 0x000000, intensity = 0, roughness = 0.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    roughness,
    metalness: 0.62,
  });
}

function createEnvironment(): void {
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x071d2b,
    roughness: 0.82,
    metalness: 0.35,
    emissive: 0x03131e,
    emissiveIntensity: 0.55,
  });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(52, 560), roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, -3.3, -185);
  courseGroup.add(road);

  const gridPositions: number[] = [];
  for (let z = 80; z >= -460; z -= 10) {
    gridPositions.push(-25, -3.24, z, 25, -3.24, z);
  }
  for (let x = -25; x <= 25; x += 5) {
    gridPositions.push(x, -3.24, 80, x, -3.24, -460);
  }
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
  const grid = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0x318a9a, transparent: true, opacity: 0.24 }));
  courseGroup.add(grid);

  const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0x76d8d6, transparent: true, opacity: 0.19, blending: THREE.AdditiveBlending });
  for (const x of [-13, 13]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 542), edgeMaterial);
    edge.position.set(x, -2.93, -188);
    courseGroup.add(edge);
  }

  const centerSegments = new THREE.Group();
  const centerMaterial = new THREE.MeshBasicMaterial({ color: 0xb8fbeb, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending });
  for (let z = 76; z >= -450; z -= 8) {
    const segment = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 3.8), centerMaterial);
    segment.position.set(0, -2.91, z);
    centerSegments.add(segment);
  }
  courseGroup.add(centerSegments);

  const barrierMaterial = standardMaterial(0x0a2b3a, 0x0a7181, 0.5, 0.54);
  const barrierGlow = new THREE.MeshBasicMaterial({ color: colors.cyan, transparent: true, opacity: 0.31, blending: THREE.AdditiveBlending });
  for (const x of [-20, 20]) {
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.48, 3.1, 542), barrierMaterial);
    barrier.position.set(x, -1.55, -188);
    courseGroup.add(barrier);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 542), barrierGlow);
    glow.position.set(x + (x < 0 ? 0.28 : -0.28), 0.01, -188);
    courseGroup.add(glow);
  }

  for (let z = 66; z >= -442; z -= 16) {
    createBoundaryBeacon(-19.2, z, rng() > 0.5 ? 1 : -1);
    createBoundaryBeacon(19.2, z - 8, rng() > 0.5 ? 1 : -1);
  }

  createCloudLayer();
  createDistantStorm();
}

function createBoundaryBeacon(x: number, z: number, lean: number): void {
  const group = new THREE.Group();
  group.position.set(x, -1.4, z);
  group.rotation.z = lean * 0.13;
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 4.8, 0.42), standardMaterial(0x123a49, 0x0b6676, 0.65, 0.7));
  pillar.position.y = 1.2;
  group.add(pillar);
  const capMaterial = new THREE.MeshBasicMaterial({ color: colors.cyan, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });
  const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), capMaterial);
  cap.position.y = 3.8;
  group.add(cap);
  const brace = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.09, 0.09), capMaterial);
  brace.position.y = 2.1;
  brace.rotation.z = lean * 0.5;
  group.add(brace);
  courseGroup.add(group);
}

function createCloudLayer(): void {
  const cloudMaterial = new THREE.MeshLambertMaterial({ color: colors.cloud, transparent: true, opacity: 0.13, depthWrite: false });
  const cloudMaterialBright = new THREE.MeshLambertMaterial({ color: 0xd6e8df, transparent: true, opacity: 0.08, depthWrite: false });
  for (let i = 0; i < 66; i += 1) {
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 7), i % 4 === 0 ? cloudMaterialBright : cloudMaterial);
    const scale = 3 + rng() * 8;
    cloud.scale.set(scale * (1.2 + rng() * 1.6), 0.45 + rng() * 0.55, scale * (0.65 + rng() * 0.75));
    cloud.position.set((rng() - 0.5) * 104, -16 - rng() * 4, 45 - rng() * 510);
    cloud.rotation.y = rng() * Math.PI;
    atmosphereGroup.add(cloud);
  }
  const cloudPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(170, 580),
    new THREE.MeshBasicMaterial({ color: 0x83aeb7, transparent: true, opacity: 0.055, depthWrite: false }),
  );
  cloudPlane.rotation.x = -Math.PI / 2;
  cloudPlane.position.set(0, -20, -185);
  atmosphereGroup.add(cloudPlane);
}

function createDistantStorm(): void {
  const stormMaterial = new THREE.MeshBasicMaterial({ color: 0x234963, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 14; i += 1) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(14 + rng() * 13, 0.06 + rng() * 0.08, 8, 56, Math.PI * (0.55 + rng() * 0.7)), stormMaterial);
    arc.position.set((rng() - 0.5) * 120, 10 + rng() * 22, -70 - rng() * 360);
    arc.rotation.set(rng() * 0.7, rng() * Math.PI, rng() * Math.PI);
    atmosphereGroup.add(arc);
  }

  const starPositions: number[] = [];
  for (let i = 0; i < 500; i += 1) {
    starPositions.push((rng() - 0.5) * 150, 4 + rng() * 50, 70 - rng() * 520);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x83d5df, size: 0.11, transparent: true, opacity: 0.57, sizeAttenuation: true }));
  atmosphereGroup.add(stars);
}

function createRelays(): void {
  const relayData = [
    { x: 0, y: 0.8, z: -58 },
    { x: 4.4, y: 1.1, z: -166 },
    { x: -4.5, y: 0.75, z: -274 },
  ];
  relayData.forEach((data, index) => {
    const color = relayPalette[index];
    const group = new THREE.Group();
    group.position.set(data.x, data.y, data.z);
    const ringMaterial = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.8, metalness: 0.45, roughness: 0.26, transparent: true, opacity: 0.86 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8.5, 0.34, 14, 104), ringMaterial);
    group.add(ring);
    const innerMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(7.55, 0.07, 8, 96), innerMaterial);
    group.add(innerRing);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, 0.07, 48, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.rotation.x = Math.PI / 2;
    group.add(beam);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.82, 1), new THREE.MeshStandardMaterial({ color: colors.amberHot, emissive: color, emissiveIntensity: 3.8, metalness: 0.15, roughness: 0.2 }));
    group.add(core);

    const towerMaterial = standardMaterial(0x102c3b, color, 0.8, 0.55);
    const leftTower = new THREE.Mesh(new THREE.BoxGeometry(0.75, 5.8, 0.75), towerMaterial);
    leftTower.position.set(-8.8, -3.1, 0);
    group.add(leftTower);
    const rightTower = leftTower.clone();
    rightTower.position.x = 8.8;
    group.add(rightTower);
    const crownMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });
    for (const x of [-8.8, 8.8]) {
      const crown = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), crownMaterial);
      crown.position.set(x, -0.05, 0);
      group.add(crown);
    }
    const strut = new THREE.Mesh(new THREE.BoxGeometry(18, 0.12, 0.12), crownMaterial);
    strut.position.y = -0.25;
    group.add(strut);
    const light = new THREE.PointLight(color, 13, 30, 2);
    group.add(light);

    const relay: RelayGate = { index, x: data.x, y: data.y, z: data.z, group, ring, innerRing, core, beam, light, restored: false, crossed: false, pulse: rng() * Math.PI * 2 };
    relays.push(relay);
    relayGroup.add(group);
  });

  createExtractionRing();
}

function createExtractionRing(): void {
  const group = new THREE.Group();
  group.position.set(0, 1.2, FINISH_Z);
  const ringMaterial = new THREE.MeshStandardMaterial({ color: colors.cyan, emissive: colors.cyan, emissiveIntensity: 1.8, metalness: 0.5, roughness: 0.24, transparent: true, opacity: 0.94 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(10.6, 0.45, 16, 128), ringMaterial);
  group.add(ring);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(9.7, 0.08, 8, 96), new THREE.MeshBasicMaterial({ color: 0xc5fff1, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending }));
  group.add(inner);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(9.6, 64), new THREE.MeshBasicMaterial({ color: colors.cyan, transparent: true, opacity: 0.04, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  disc.rotation.x = Math.PI / 2;
  group.add(disc);
  const marker = new THREE.Mesh(new THREE.BoxGeometry(22, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: colors.cyan, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending }));
  marker.position.y = -10.3;
  group.add(marker);
  const light = new THREE.PointLight(colors.cyan, 18, 36, 2);
  group.add(light);
  relayGroup.add(group);
}

function createHazards(): void {
  const hazardData: Array<[HazardKind, number, number, number, number, number, number]> = [
    ['drone', -7, 1.8, -24, 4.8, 1.1, 1.1],
    ['shard', 7, -0.1, -42, 2.3, 2.4, 1.8],
    ['sweep', 0, 2.6, -83, 10.0, 0.8, 1.15],
    ['drone', -6, 0.7, -105, 3.6, 1.7, 1.25],
    ['shard', 7, 2.5, -129, 2.8, 1.4, 1.45],
    ['drone', 1, -0.5, -148, 5.5, 2.2, 0.9],
    ['sweep', -3, 2.2, -191, 8.5, 1.2, 1.35],
    ['shard', -8, 1, -213, 3.2, 2.1, 1.6],
    ['drone', 6, 2.2, -236, 4.6, 1.6, 1.05],
    ['drone', -4, -0.3, -255, 5.2, 1.45, 1.25],
    ['sweep', 4, 1.8, -302, 9.5, 0.7, 1.2],
    ['shard', -7, 3.1, -329, 2.5, 2.2, 1.55],
    ['drone', 7, 0.4, -352, 4.4, 1.3, 1.18],
    ['shard', -2, -0.5, -379, 4.0, 1.8, 1.6],
  ];
  hazardData.forEach(([kind, x, y, z, amplitudeX, amplitudeY, speed], index) => {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const hazardColor = kind === 'shard' ? colors.coral : 0xff8f5c;
    let core: THREE.Mesh;
    if (kind === 'drone') {
      const shell = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.16, 10, 28), new THREE.MeshBasicMaterial({ color: hazardColor, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending }));
      shell.rotation.x = Math.PI / 2;
      group.add(shell);
      core = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), standardMaterial(0x481f2a, hazardColor, 2.2, 0.27));
      group.add(core);
      const spikeMaterial = new THREE.MeshBasicMaterial({ color: colors.amberHot, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
      for (const angle of [0, Math.PI / 2]) {
        const spike = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.07, 0.07), spikeMaterial);
        spike.rotation.z = angle;
        group.add(spike);
      }
    } else if (kind === 'sweep') {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(16, 0.24, 0.3), new THREE.MeshBasicMaterial({ color: hazardColor, transparent: true, opacity: 0.78, blending: THREE.AdditiveBlending }));
      group.add(bar);
      const warning = new THREE.Mesh(new THREE.BoxGeometry(16, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: colors.amberHot, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending }));
      warning.position.y = 0.42;
      group.add(warning);
      core = new THREE.Mesh(new THREE.OctahedronGeometry(0.65, 0), standardMaterial(0x54282e, hazardColor, 2.1, 0.3));
      core.position.x = -8;
      group.add(core);
    } else {
      core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 0), standardMaterial(0x4a1f29, hazardColor, 2.3, 0.26));
      core.scale.set(1, 1.55, 0.7);
      group.add(core);
      const shardGlow = new THREE.Mesh(new THREE.OctahedronGeometry(1.6, 0), new THREE.MeshBasicMaterial({ color: hazardColor, wireframe: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }));
      group.add(shardGlow);
    }
    const light = new THREE.PointLight(hazardColor, 3.3, 11, 2);
    group.add(light);
    const warningRing = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.035, 6, 40), new THREE.MeshBasicMaterial({ color: hazardColor, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending }));
    warningRing.rotation.x = Math.PI / 2;
    group.add(warningRing);
    const hazard: Hazard = { kind, group, core, x, y, z, amplitudeX, amplitudeY, phase: rng() * Math.PI * 2 + index * 0.3, speed, radius: kind === 'sweep' ? 1.5 : 1.9, hitCooldown: 0 };
    hazards.push(hazard);
    hazardGroup.add(group);
  });
}

function createPickups(): void {
  const pickupData: Array<[number, number, number]> = [
    [-8, -0.3, -14], [5, 1.4, -35], [-2, 1.8, -73], [9, -0.2, -94], [-7, 2.2, -119], [2, -0.4, -143],
    [9, 1.8, -181], [-8, 0.2, -201], [2, 2.8, -226], [-9, 0.4, -248], [7, -0.5, -291], [-2, 2.9, -316], [9, 1.1, -344], [-7, 2.5, -367], [0, 0.3, -395],
  ];
  pickupData.forEach(([x, y, z], index) => {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.78, 0), new THREE.MeshBasicMaterial({ color: colors.amberHot, transparent: true, opacity: 0.86, blending: THREE.AdditiveBlending }));
    glow.scale.y = 1.6;
    group.add(glow);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.075, 6, 28), new THREE.MeshBasicMaterial({ color: colors.amber, transparent: true, opacity: 0.94, blending: THREE.AdditiveBlending }));
    group.add(frame);
    group.add(new THREE.PointLight(colors.amber, 4.5, 10, 2));
    const pickup: ChargeCell = { group, x, y, z, phase: rng() * Math.PI * 2 + index, collected: false };
    pickups.push(pickup);
    pickupGroup.add(group);
  });
}

function createParticleTrails(): void {
  const streamPositions: number[] = [];
  for (let i = 0; i < 85; i += 1) {
    const x = (rng() - 0.5) * 45;
    const y = -1 + rng() * 19;
    const z = 76 - rng() * 505;
    streamPositions.push(x, y, z, x, y, z + 2 + rng() * 6);
  }
  const streamGeometry = new THREE.BufferGeometry();
  streamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(streamPositions, 3));
  const streams = new THREE.LineSegments(streamGeometry, new THREE.LineBasicMaterial({ color: 0x77cfd1, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending }));
  streams.userData = { stream: true };
  particleGroup.add(streams);

  const dustPositions: number[] = [];
  for (let i = 0; i < 260; i += 1) {
    dustPositions.push((rng() - 0.5) * 38, -2.4 + rng() * 11, 42 - rng() * 470);
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0x9de7df, size: 0.09, transparent: true, opacity: 0.43, blending: THREE.AdditiveBlending }));
  dust.userData = { dust: true };
  particleGroup.add(dust);
}

function createLighting(): void {
  scene.add(new THREE.HemisphereLight(0x6da4b4, 0x040812, 1.25));
  const key = new THREE.DirectionalLight(0x9dd9d2, 1.7);
  key.position.set(-18, 32, 18);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x3d5dff, 1.15);
  rim.position.set(22, 12, -80);
  scene.add(rim);
}

function createCourierCraft(): THREE.Group {
  const group = new THREE.Group();
  group.position.copy(player);
  const hullMaterial = standardMaterial(0xb7cec8, 0x1a444c, 0.65, 0.28);
  const darkMaterial = standardMaterial(0x0b2430, 0x0a6470, 0.8, 0.32);
  const brightMaterial = new THREE.MeshBasicMaterial({ color: colors.cyan, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending });
  const warmMaterial = new THREE.MeshBasicMaterial({ color: colors.amberHot, transparent: true, opacity: 0.94, blending: THREE.AdditiveBlending });

  const body = new THREE.Mesh(new THREE.OctahedronGeometry(1, 1), hullMaterial);
  body.scale.set(1.18, 0.5, 2.45);
  body.position.z = -0.15;
  group.add(body);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.58, 12, 7), darkMaterial);
  cockpit.scale.set(0.86, 0.48, 1.12);
  cockpit.position.set(0, 0.35, -0.45);
  group.add(cockpit);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.56, 1.8, 6, 1), hullMaterial);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -1.75;
  group.add(nose);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 1.02), darkMaterial);
  wing.position.set(0, -0.1, 0.2);
  wing.rotation.z = 0.02;
  group.add(wing);
  const wingTipL = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.1, 0.72), brightMaterial);
  wingTipL.position.set(-2.15, -0.02, 0.15);
  wingTipL.rotation.z = -0.13;
  group.add(wingTipL);
  const wingTipR = wingTipL.clone();
  wingTipR.position.x = 2.15;
  wingTipR.rotation.z = 0.13;
  group.add(wingTipR);
  const dorsal = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 1.1), brightMaterial);
  dorsal.position.set(0, 0.4, 0.12);
  group.add(dorsal);
  const noseLight = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), warmMaterial);
  noseLight.position.set(0, 0.05, -2.63);
  group.add(noseLight);
  const noseLamp = new THREE.PointLight(colors.amberHot, 3.2, 8, 2);
  noseLamp.position.copy(noseLight.position);
  group.add(noseLamp);
  for (const x of [-0.53, 0.53]) {
    const engineMat = new THREE.MeshBasicMaterial({ color: colors.cyan, transparent: true, opacity: 0.86, blending: THREE.AdditiveBlending });
    engineGlowMaterials.push(engineMat);
    const engine = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.75, 8, 1, true), engineMat);
    engine.rotation.x = Math.PI / 2;
    engine.position.set(x, -0.03, 1.7);
    group.add(engine);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.23, 0.18, 8), darkMaterial);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(x, -0.03, 1.04);
    group.add(nozzle);
  }
  const underGlow = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 3.2), new THREE.MeshBasicMaterial({ color: colors.cyan, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  underGlow.rotation.x = -Math.PI / 2;
  underGlow.position.y = -0.52;
  group.add(underGlow);
  return group;
}

function createImpactRing(): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.52, 32), new THREE.MeshBasicMaterial({ color: colors.coral, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  return mesh;
}

function setupControls(): void {
  const keyMap: Record<string, DigitalControl> = {
    ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'up', ArrowDown: 'down', w: 'boost', W: 'boost', s: 'brake', S: 'brake',
    ' ': 'boost', Shift: 'boost', Control: 'brake',
  };
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      if (phase === 'ready') {
        event.preventDefault();
        startRun(false);
        return;
      }
      if ((phase === 'won' || phase === 'lost') && event.key === 'Enter') {
        event.preventDefault();
        startRun(true);
        return;
      }
    }
    if (event.key === 'p' || event.key === 'P') {
      event.preventDefault();
      if (phase === 'playing' || phase === 'paused') togglePause();
      return;
    }
    if (event.key === 'r' || event.key === 'R') {
      if (phase === 'won' || phase === 'lost') {
        event.preventDefault();
        startRun(true);
        return;
      }
    }
    const control = keyMap[event.key];
    if (control) {
      event.preventDefault();
      input[control] = true;
    }
  });
  window.addEventListener('keyup', (event) => {
    const control = keyMap[event.key];
    if (control) input[control] = false;
  });

  document.querySelectorAll<HTMLElement>('[data-action="start"]').forEach((button) => button.addEventListener('click', () => startRun(false)));
  stateAction?.addEventListener('click', () => {
    if (phase === 'paused') togglePause();
    else if (phase === 'won' || phase === 'lost') startRun(true);
  });

  document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach((button) => {
    const control = button.dataset.control as 'left' | 'right' | 'boost';
    const set = (active: boolean) => {
      if (control === 'boost') input.pointerBoost = active;
      else input[control] = active;
      button.classList.toggle('pressed', active);
    };
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      set(true);
    });
    button.addEventListener('pointerup', () => set(false));
    button.addEventListener('pointercancel', () => set(false));
    button.addEventListener('pointerleave', () => set(false));
  });

  sceneCanvas.addEventListener('pointerdown', (event) => {
    if (phase !== 'playing') return;
    pointerDown = true;
    dragStartX = event.clientX;
    sceneCanvas.setPointerCapture(event.pointerId);
  });
  sceneCanvas.addEventListener('pointermove', (event) => {
    if (!pointerDown || phase !== 'playing') return;
    const width = window.innerWidth;
    const delta = event.clientX - dragStartX;
    input.pointerSteer = event.pointerType === 'touch'
      ? THREE.MathUtils.clamp(delta / (width * 0.29), -1, 1)
      : THREE.MathUtils.clamp((event.clientX - width / 2) / (width * 0.42), -1, 1);
  });
  const clearPointer = () => {
    pointerDown = false;
    input.pointerSteer = null;
  };
  sceneCanvas.addEventListener('pointerup', clearPointer);
  sceneCanvas.addEventListener('pointercancel', clearPointer);
}

function startRun(isRestart: boolean): void {
  if (isRestart) runtime.restartCount += 1;
  setPhase('playing');
  player.set(0, 0.35, START_Z);
  playerVelocity.set(0, 0, 0);
  distanceTraveled = 0;
  collectedCount = 0;
  impactCount = 0;
  currentSpeed = 27;
  steerInput = 0;
  cameraShake = 0;
  impactFlash = 0;
  successFlash = 0;
  alertTimer = 0;
  runtime.score = 0;
  runtime.relaysRestored = 0;
  runtime.charge = 88;
  runtime.objective = 'ALIGN WITH RELAY 01';
  for (const relay of relays) {
    relay.restored = false;
    relay.crossed = false;
    relay.group.visible = true;
  }
  for (const hazard of hazards) hazard.hitCooldown = 0;
  for (const pickup of pickups) {
    pickup.collected = false;
    pickup.group.visible = true;
  }
  playerGroup.position.copy(player);
  playerGroup.rotation.set(0, 0, 0);
  playerGroup.visible = true;
  introOverlay?.setAttribute('hidden', '');
  stateOverlay?.setAttribute('hidden', '');
  hud?.classList.add('is-visible');
  touchControls?.classList.add('is-visible');
  flightReticle?.classList.add('is-visible');
  setAlert('FLIGHT INITIALIZED / FIND RELAY 01', 'neutral');
  updateHud();
}

function togglePause(): void {
  if (phase === 'playing') {
    setPhase('paused');
    stateOverline!.textContent = 'VISIBILITY HOLD';
    stateTitle!.textContent = 'Flight paused';
    stateCopy!.textContent = 'The relay field is holding position. Resume when you have eyes on the corridor.';
    stateAction!.innerHTML = '<span>RESUME FLIGHT</span><b>↗</b>';
  } else if (phase === 'paused') {
    setPhase('playing');
    stateOverlay?.setAttribute('hidden', '');
    setAlert('FLIGHT RESUMED', 'neutral');
  }
}

function handleVisibilityChange(): void {
  if (document.hidden && phase === 'playing') togglePause();
}

function setPhase(next: Phase): void {
  phase = next;
  runtime.phase = next;
  document.body.dataset.phase = next;
  if (next === 'playing') {
    hud?.classList.add('is-visible');
    flightReticle?.classList.add('is-visible');
    touchControls?.classList.add('is-visible');
    stateOverlay?.setAttribute('hidden', '');
  } else if (next === 'paused') {
    stateOverlay?.removeAttribute('hidden');
    touchControls?.classList.remove('is-visible');
    flightReticle?.classList.remove('is-visible');
    updateStatePanel();
  } else if (next === 'won' || next === 'lost') {
    stateOverlay?.removeAttribute('hidden');
    touchControls?.classList.remove('is-visible');
    flightReticle?.classList.remove('is-visible');
    updateStatePanel();
  } else {
    hud?.classList.remove('is-visible');
    touchControls?.classList.remove('is-visible');
    flightReticle?.classList.remove('is-visible');
    stateOverlay?.setAttribute('hidden', '');
  }
}

function finishRun(won: boolean): void {
  if (phase !== 'playing') return;
  if (won) {
    runtime.score += 1500 + Math.round(runtime.charge * 10);
    successFlash = 1;
    setPhase('won');
    stateOverline!.textContent = 'EXTRACTION CONFIRMED';
    stateTitle!.textContent = 'Signal restored';
    stateCopy!.textContent = 'All three relays are synced. The courier has a clean path through the cloudline.';
    stateAction!.innerHTML = '<span>FLY AGAIN</span><b>↗</b>';
    setAlert('EXTRACTION RING / LOCKED', 'success');
  } else {
    setPhase('lost');
    stateOverline!.textContent = 'LINK FAILURE';
    stateTitle!.textContent = 'Signal lost';
    stateCopy!.textContent = 'The extraction window closed before the relay chain reached safety.';
    stateAction!.innerHTML = '<span>REBOOT RUN</span><b>↗</b>';
    setAlert('CHARGE DEPLETED / RUN ENDED', 'danger');
  }
  updateHud();
}

function updateGame(dt: number): void {
  const steerTarget = input.pointerSteer !== null ? input.pointerSteer : (Number(input.right) - Number(input.left));
  steerInput = THREE.MathUtils.damp(steerInput, steerTarget, 7.5, dt);
  const verticalTarget = Number(input.up) - Number(input.down);
  const boostActive = input.boost || input.pointerBoost;
  const brakeActive = input.brake;
  const targetSpeed = brakeActive ? 17 : boostActive && runtime.charge > 1 ? 43 : 28;
  currentSpeed = THREE.MathUtils.damp(currentSpeed, targetSpeed, 3.4, dt);

  playerVelocity.x = THREE.MathUtils.damp(playerVelocity.x, steerInput * 28, 5.2, dt);
  playerVelocity.y = THREE.MathUtils.damp(playerVelocity.y, verticalTarget * 7.5, 5.8, dt);
  player.x += playerVelocity.x * dt;
  player.y += playerVelocity.y * dt;
  player.x = THREE.MathUtils.clamp(player.x, -13.1, 13.1);
  player.y = THREE.MathUtils.clamp(player.y, -1.6, 5.7);
  player.z -= currentSpeed * dt;
  distanceTraveled += currentSpeed * dt;

  const drain = (0.82 + (boostActive ? 1.28 : 0) + (brakeActive ? -0.15 : 0)) * dt;
  runtime.charge = Math.max(0, runtime.charge - drain);
  if (runtime.charge <= 0) {
    finishRun(false);
    return;
  }

  playerGroup.position.copy(player);
  const bank = -steerInput * 0.34;
  playerGroup.rotation.z = THREE.MathUtils.damp(playerGroup.rotation.z, bank, 8, dt);
  playerGroup.rotation.x = THREE.MathUtils.damp(playerGroup.rotation.x, -verticalTarget * 0.12 + (boostActive ? -0.035 : 0), 7, dt);
  const engineOpacity = boostActive ? 1.0 : 0.68 + Math.sin(elapsed * 14) * 0.08;
  engineGlowMaterials.forEach((material, index) => {
    material.opacity = engineOpacity;
    material.color.set(index % 2 === 0 && boostActive ? colors.amberHot : colors.cyan);
  });

  updateRelays(dt);
  updateHazards(dt);
  updatePickups();
  updateParticles(dt, boostActive);
  updateCamera(dt, boostActive);

  const finishDistance = player.z - FINISH_Z;
  if (finishDistance < 11) {
    if (runtime.relaysRestored >= 3 && Math.hypot(player.x, player.y - 1.2) < 11.2) {
      finishRun(true);
      return;
    }
    else if (finishDistance < 2 && alertTimer <= 0) setAlert('EXTRACTION LOCKED / RELAY CHAIN INCOMPLETE', 'danger');
  }
  if (player.z < FINISH_Z - 10 && runtime.relaysRestored < 3) finishRun(false);

  runtime.score = Math.max(0, Math.round(distanceTraveled * 2 + runtime.relaysRestored * 650 + collectedCount * 80 - impactCount * 110));
  updateHud();
}

function updateRelays(dt: number): void {
  relays.forEach((relay, index) => {
    const pulse = elapsed * (1.9 + index * 0.18) + relay.pulse;
    relay.ring.rotation.z = Math.sin(pulse * 0.45) * 0.12;
    relay.innerRing.rotation.z = -pulse * 0.2;
    relay.core.rotation.x += dt * 1.2;
    relay.core.rotation.y += dt * 1.7;
    relay.beam.scale.setScalar(1 + Math.sin(pulse) * 0.06);
    const near = Math.abs(player.z - relay.z) < 15;
    const ringMaterial = relay.ring.material as THREE.MeshStandardMaterial;
    const innerMaterial = relay.innerRing.material as THREE.MeshBasicMaterial;
    if (relay.restored) {
      ringMaterial.emissiveIntensity = 3.4 + Math.sin(pulse) * 0.5;
      ringMaterial.opacity = 0.98;
      innerMaterial.opacity = 0.52 + Math.sin(pulse) * 0.12;
      relay.light.intensity = 20 + Math.sin(pulse) * 4;
      relay.core.scale.setScalar(1.1 + Math.sin(pulse * 1.2) * 0.12);
    } else {
      ringMaterial.emissiveIntensity = near && index === runtime.relaysRestored ? 2.5 + Math.sin(pulse) * 0.55 : 1.45;
      ringMaterial.opacity = near && index === runtime.relaysRestored ? 0.98 : 0.6;
      innerMaterial.opacity = near && index === runtime.relaysRestored ? 0.34 : 0.14;
      relay.light.intensity = near && index === runtime.relaysRestored ? 15 : 7;
      relay.core.scale.setScalar(0.82 + Math.sin(pulse) * 0.08);
    }

    if (!relay.crossed && player.z <= relay.z + 4) {
      relay.crossed = true;
      if (index === runtime.relaysRestored) {
        const distance = Math.hypot(player.x - relay.x, player.y - relay.y);
        if (distance < 10.2) restoreRelay(relay);
        else setAlert(`RELAY 0${index + 1} MISALIGNED / SIGNAL WEAK`, 'danger');
      } else if (index > runtime.relaysRestored && alertTimer <= 0) {
        setAlert(`RELAY 0${index + 1} LOCKED / RESTORE PRIOR LINK`, 'danger');
      }
    }
  });
}

function restoreRelay(relay: RelayGate): void {
  relay.restored = true;
  runtime.relaysRestored = relays.filter((item) => item.restored).length;
  runtime.charge = Math.min(100, runtime.charge + 12);
  successFlash = 0.65;
  cameraShake = Math.max(cameraShake, 0.18);
  setAlert(`RELAY 0${relay.index + 1} RESTORED / LINK ${runtime.relaysRestored} OF 3`, 'success');
  runtime.objective = runtime.relaysRestored < 3 ? `ALIGN WITH RELAY 0${runtime.relaysRestored + 1}` : 'CROSS THE EXTRACTION RING';
}

function updateHazards(dt: number): void {
  for (const hazard of hazards) {
    const motion = elapsed * hazard.speed + hazard.phase;
    hazard.group.position.x = hazard.x + Math.sin(motion) * hazard.amplitudeX;
    hazard.group.position.y = hazard.y + Math.cos(motion * 1.16) * hazard.amplitudeY;
    hazard.group.rotation.x += dt * (hazard.kind === 'shard' ? 1.9 : 0.8);
    hazard.group.rotation.y -= dt * 1.15;
    hazard.group.rotation.z = Math.sin(motion * 0.7) * 0.35;
    hazard.hitCooldown = Math.max(0, hazard.hitCooldown - dt);
    if (Math.abs(hazard.group.position.z - player.z) < 3.0 && hazard.hitCooldown <= 0) {
      const distance = Math.hypot(hazard.group.position.x - player.x, hazard.group.position.y - player.y);
      const sweepCollision = hazard.kind === 'sweep'
        && Math.abs(player.x - hazard.group.position.x) < 8.6
        && Math.abs(player.y - hazard.group.position.y) < 1.35;
      if (distance < hazard.radius + 0.82 || sweepCollision) hitHazard(hazard);
    }
    hazard.group.visible = Math.abs(hazard.group.position.z - player.z) < 27 || hazard.z < player.z + 60;
    const coreMaterial = hazard.core.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
    if ('emissiveIntensity' in coreMaterial) coreMaterial.emissiveIntensity = Math.abs(hazard.group.position.z - player.z) < 27 ? 3.4 : 2.1;
  }
}

function hitHazard(hazard: Hazard): void {
  hazard.hitCooldown = 1.35;
  impactCount += 1;
  const damage = hazard.kind === 'sweep' ? 24 : 18;
  runtime.charge = Math.max(0, runtime.charge - damage);
  const direction = Math.sign(player.x - hazard.group.position.x) || (rng() > 0.5 ? 1 : -1);
  playerVelocity.x += direction * 8;
  playerVelocity.y += (player.y - hazard.group.position.y) * 1.5;
  cameraShake = Math.max(cameraShake, 0.7);
  impactFlash = 1;
  impactRing.visible = true;
  impactRing.position.copy(player);
  impactRing.scale.setScalar(0.7);
  setAlert(`HULL IMPACT / CHARGE -${damage}`, 'danger');
}

function updatePickups(): void {
  for (const pickup of pickups) {
    if (pickup.collected) continue;
    pickup.group.rotation.y = elapsed * 1.6 + pickup.phase;
    pickup.group.rotation.z = Math.sin(elapsed * 1.5 + pickup.phase) * 0.16;
    pickup.group.position.y = pickup.y + Math.sin(elapsed * 2.3 + pickup.phase) * 0.28;
    if (Math.abs(pickup.z - player.z) < 2.8 && Math.hypot(pickup.group.position.x - player.x, pickup.group.position.y - player.y) < 2.15) {
      pickup.collected = true;
      pickup.group.visible = false;
      collectedCount += 1;
      runtime.charge = Math.min(100, runtime.charge + 14);
      runtime.score += 80;
      setAlert('CHARGE CELL ACQUIRED / +14', 'success');
    }
  }
}

function updateParticles(dt: number, boostActive: boolean): void {
  particleGroup.children.forEach((child) => {
    if (child.userData.stream) {
      const stream = child as THREE.LineSegments;
      const positions = stream.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i += 2) {
        const z = positions.getZ(i) - currentSpeed * dt * (boostActive ? 1.45 : 1);
        const wrapped = z < player.z - 60 ? player.z + 180 + rng() * 80 : z;
        positions.setZ(i, wrapped);
        positions.setZ(i + 1, wrapped + (boostActive ? 5.6 : 3.1));
      }
      positions.needsUpdate = true;
      (stream.material as THREE.LineBasicMaterial).opacity = boostActive ? 0.42 : 0.2;
    } else if (child.userData.dust) {
      const dust = child as THREE.Points;
      dust.rotation.y = elapsed * 0.006;
      (dust.material as THREE.PointsMaterial).opacity = boostActive ? 0.62 : 0.43;
    }
  });
}

function updateCamera(dt: number, boostActive: boolean): void {
  const targetCamera = new THREE.Vector3(player.x * 0.24, player.y + 5.7, player.z + (boostActive ? 15.6 : 14.2));
  camera.position.lerp(targetCamera, 1 - Math.exp(-4.2 * dt));
  camera.lookAt(new THREE.Vector3(player.x * 0.5, player.y + 0.15, player.z - (boostActive ? 26 : 22)));
  camera.position.x += (Math.sin(elapsed * 49) + Math.sin(elapsed * 76)) * cameraShake * 0.026;
  camera.position.y += Math.cos(elapsed * 63) * cameraShake * 0.018;
  camera.rotation.z = THREE.MathUtils.damp(camera.rotation.z, -steerInput * 0.075, 5.5, dt);
  cameraShake = Math.max(0, cameraShake - dt * 1.8);
}

function updateAmbient(dt: number): void {
  relays.forEach((relay, index) => {
    const pulse = elapsed * (1.9 + index * 0.18) + relay.pulse;
    relay.ring.rotation.z = Math.sin(pulse * 0.45) * 0.12;
    relay.innerRing.rotation.z = -pulse * 0.2;
    relay.core.rotation.x += dt * 0.4;
    relay.core.rotation.y += dt * 0.7;
    relay.beam.scale.setScalar(1 + Math.sin(pulse) * 0.055);
  });
  pickups.forEach((pickup) => {
    if (!pickup.collected) {
      pickup.group.rotation.y = elapsed * 1.2 + pickup.phase;
      pickup.group.position.y = pickup.y + Math.sin(elapsed * 1.6 + pickup.phase) * 0.24;
    }
  });
  updateCameraOverview(dt);
}

function updateCameraOverview(dt: number): void {
  const target = phase === 'ready' ? new THREE.Vector3(0, 6.2, 37) : new THREE.Vector3(player.x * 0.24, player.y + 5.7, player.z + 14.2);
  camera.position.lerp(target, 1 - Math.exp(-2.2 * dt));
  const look = phase === 'ready' ? new THREE.Vector3(0, 0, -43) : new THREE.Vector3(player.x * 0.5, player.y, player.z - 20);
  camera.lookAt(look);
}

function updateHud(): void {
  const charge = Math.max(0, Math.min(100, runtime.charge));
  chargeValue!.textContent = String(Math.round(charge));
  chargeFill!.style.width = `${charge}%`;
  chargeNote!.textContent = charge < 20 ? 'CRITICAL' : charge < 42 ? 'UNSTABLE' : charge > 78 ? 'STABLE' : 'NOMINAL';
  chargeNote!.className = charge < 20 ? 'critical' : charge < 42 ? 'warning' : '';
  scoreValue!.textContent = `SCORE ${String(runtime.score).padStart(6, '0')}`;
  relayCount!.textContent = String(runtime.relaysRestored);
  relayDots.forEach((dot, index) => dot.classList.toggle('active', index < runtime.relaysRestored));
  relayStatus!.textContent = runtime.relaysRestored === 3 ? 'CHAIN COMPLETE' : runtime.relaysRestored === 0 ? 'LINKS DORMANT' : `LINK ${runtime.relaysRestored} STABLE`;
  distanceValue!.textContent = `${Math.max(0, Math.round(player.z - FINISH_Z))}M OUT`;
  objectiveValue!.textContent = runtime.objective;
  objectiveDetail!.textContent = runtime.relaysRestored < 3 ? 'Stay inside the relay aperture to restore the chain.' : 'Extraction ring is live. Hold the centerline.';
  document.documentElement.style.setProperty('--charge', `${charge}%`);
  document.documentElement.style.setProperty('--impact', String(impactFlash));
  document.documentElement.style.setProperty('--success', String(successFlash));
  stateRelays!.textContent = `${runtime.relaysRestored} / 3`;
  stateScore!.textContent = String(runtime.score).padStart(6, '0');
  stateCharge!.textContent = `${Math.round(charge)}%`;
  runtime.player.x = finite(player.x);
  runtime.player.y = finite(player.y);
  runtime.player.z = finite(player.z);
  runtime.phase = phase;
}

function updateStatePanel(): void {
  stateRelays!.textContent = `${runtime.relaysRestored} / 3`;
  stateScore!.textContent = String(runtime.score).padStart(6, '0');
  stateCharge!.textContent = `${Math.round(runtime.charge)}%`;
}

function setAlert(message: string, tone: 'neutral' | 'success' | 'danger'): void {
  alertMessage!.textContent = message;
  alertToast!.dataset.tone = tone;
  alertToast!.classList.remove('show');
  void alertToast!.offsetWidth;
  alertToast!.classList.add('show');
  alertTimer = 2.6;
}

function finite(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  alertTimer = Math.max(0, alertTimer - dt);
  impactFlash = Math.max(0, impactFlash - dt * 2.8);
  successFlash = Math.max(0, successFlash - dt * 0.8);
  if (phase === 'playing') updateGame(dt);
  else updateAmbient(dt);
  if (impactRing.visible) {
    impactRing.scale.multiplyScalar(1 + dt * 4.6);
    const material = impactRing.material as THREE.MeshBasicMaterial;
    material.opacity = Math.max(0, impactFlash * 0.72);
    if (impactFlash <= 0) impactRing.visible = false;
  }
  if (alertTimer <= 0) alertToast?.classList.remove('show');
  updateHud();
  renderer.render(scene, camera);
}
