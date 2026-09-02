import * as THREE from 'three';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root');
root.innerHTML = `
  <div id="hud"><b>CANYON STRIKE</b><span id="mission">Destroy all targets</span><span id="stats"></span></div>
  <div id="crosshair">+</div>
  <section id="screen"><h1>CANYON<br>STRIKE</h1><p>Fly the canyon, destroy six targets, then reach extraction.</p><p class="keys">W/S pitch &nbsp; A/D roll &nbsp; Q/E yaw &nbsp; Space missile &nbsp; Shift boost</p><button id="start">Launch mission</button></section>
  <section id="result" hidden><h2 id="resultTitle"></h2><p id="resultStats"></p><button id="restart">Fly again</button></section>`;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
root.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x79a9bd);
scene.fog = new THREE.Fog(0x7399a6, 700, 4200);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 7000);
scene.add(new THREE.HemisphereLight(0xcbefff, 0x593822, 2.2));
const sun = new THREE.DirectionalLight(0xffe0ac, 3.4);
sun.position.set(-500, 900, 300);
scene.add(sun);
const world = new THREE.Group();
scene.add(world);
const rock = new THREE.MeshStandardMaterial({ color: 0x754b36, roughness: 0.95 });
const rock2 = new THREE.MeshStandardMaterial({ color: 0x9a6647, roughness: 1 });
const sand = new THREE.MeshStandardMaterial({ color: 0xb9895b, roughness: 1 });
const metal = new THREE.MeshStandardMaterial({ color: 0x263943, metalness: 0.65, roughness: 0.35 });
const red = new THREE.MeshStandardMaterial({ color: 0xd83b27, emissive: 0x4d0902 });
const cyan = new THREE.MeshBasicMaterial({ color: 0x55dcff });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(2600, 10000), sand);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, -35, -4200);
world.add(floor);
for (const side of [-1, 1]) {
  for (let i = 0; i < 34; i++) {
    const h = 350 + (i * 71 % 430);
    const width = 260 + (i * 47 % 260);
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(width, h, 7), i % 2 ? rock : rock2);
    mountain.position.set(side * (470 + (i * 89 % 230)), h / 2 - 25, 600 - i * 280);
    mountain.rotation.y = i * 0.73;
    mountain.scale.z = 1.3;
    world.add(mountain);
  }
}

function jet(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.8, 7, 8), metal);
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.5, 8), metal);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -4.7;
  group.add(nose);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(8, 0.18, 2.4), metal);
  wing.position.z = -0.6;
  group.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.7, 0.2), red);
  tail.position.set(0, 0.8, 2.5);
  group.add(tail);
  for (const x of [-0.42, 0.42]) {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 2, 7), cyan);
    flame.position.set(x, 0, 4.4);
    flame.rotation.x = Math.PI / 2;
    group.add(flame);
  }
  return group;
}

const player = jet();
player.scale.setScalar(1.25);
scene.add(player);
type Target = { mesh: THREE.Group; hp: number; maxHp: number; alive: boolean };
const targets: Target[] = [];
for (let i = 0; i < 6; i++) {
  const target = i < 3 ? new THREE.Group() : jet();
  if (i < 3) {
    target.add(new THREE.Mesh(new THREE.CylinderGeometry(7, 10, 7, 8), metal));
    const dish = new THREE.Mesh(new THREE.TorusGeometry(8, 1.1, 6, 20), red);
    dish.rotation.x = Math.PI / 2;
    dish.position.y = 8;
    target.add(dish);
  }
  target.position.set((i % 2 ? 1 : -1) * (100 + i * 28), i < 3 ? 0 : 180 + i * 20, -1100 - i * 700);
  world.add(target);
  targets.push({ mesh: target, hp: i < 3 ? 2 : 1, maxHp: i < 3 ? 2 : 1, alive: true });
}
const extraction = new THREE.Mesh(new THREE.TorusGeometry(85, 4, 10, 50), cyan);
extraction.position.set(0, 180, -6100);
extraction.rotation.y = Math.PI / 2;
extraction.visible = false;
world.add(extraction);

const keys: Record<string, boolean> = {};
addEventListener('keydown', (event) => {
  keys[event.code] = true;
  if (event.code === 'Space') { event.preventDefault(); fire(); }
});
addEventListener('keyup', (event) => { keys[event.code] = false; });
const projectiles: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];
let running = false;
let health = 100;
let ammo = 12;
let kills = 0;
let elapsed = 0;
let cooldown = 0;

function fire() {
  if (!running || cooldown > 0 || ammo <= 0) return;
  cooldown = 0.35;
  ammo--;
  const missile = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 2.4, 6), red);
  missile.rotation.x = Math.PI / 2;
  missile.position.copy(player.position);
  scene.add(missile);
  projectiles.push({ mesh: missile, velocity: new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion).multiplyScalar(420), life: 6 });
}

function reset() {
  health = 100; ammo = 12; kills = 0; elapsed = 0; cooldown = 0;
  player.position.set(0, 180, 350); player.quaternion.identity();
  targets.forEach((target) => { target.alive = true; target.hp = target.maxHp; target.mesh.visible = true; });
  extraction.visible = false;
  document.querySelector<HTMLElement>('#result')!.hidden = true;
  document.querySelector<HTMLElement>('#screen')!.hidden = true;
  running = true;
}
document.querySelector('#start')!.addEventListener('click', reset);
document.querySelector('#restart')!.addEventListener('click', reset);
function end(win: boolean) {
  running = false;
  const panel = document.querySelector<HTMLElement>('#result')!;
  document.querySelector('#resultTitle')!.textContent = win ? 'Mission complete' : 'Aircraft lost';
  document.querySelector('#resultStats')!.textContent = `${kills}/6 targets - ${Math.floor(elapsed)} seconds`;
  panel.hidden = false;
}

const clock = new THREE.Clock();
function update(dt: number) {
  if (!running) return;
  elapsed += dt; cooldown -= dt;
  const pitch = (keys.KeyW ? -1 : 0) + (keys.KeyS ? 1 : 0);
  const roll = (keys.KeyA ? 1 : 0) + (keys.KeyD ? -1 : 0);
  const yaw = (keys.KeyQ ? 1 : 0) + (keys.KeyE ? -1 : 0);
  player.rotateX(pitch * dt * 0.8);
  player.rotateZ(roll * dt * 1.1);
  player.rotateY(yaw * dt * 0.55);
  const speed = keys.ShiftLeft || keys.ShiftRight ? 250 : 155;
  player.position.addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion), speed * dt);
  player.position.y = THREE.MathUtils.clamp(player.position.y, 30, 650);
  player.position.x = THREE.MathUtils.clamp(player.position.x, -430, 430);
  for (let i = 3; i < targets.length; i++) if (targets[i].alive) targets[i].mesh.position.x += Math.sin(elapsed * 0.7 + i) * 18 * dt;
  for (const projectile of projectiles) {
    projectile.mesh.position.addScaledVector(projectile.velocity, dt);
    projectile.life -= dt;
    for (const target of targets) if (target.alive && projectile.mesh.position.distanceTo(target.mesh.position) < 22) {
      target.hp--; projectile.life = 0;
      if (target.hp <= 0) { target.alive = false; target.mesh.visible = false; kills++; }
      break;
    }
  }
  for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].life <= 0) { scene.remove(projectiles[i].mesh); projectiles.splice(i, 1); }
  if (kills === 6) extraction.visible = true;
  extraction.rotation.z += dt * 0.5;
  if (extraction.visible && player.position.distanceTo(extraction.position) < 110) end(true);
  if (player.position.z < -6600 || health <= 0) end(false);
  const follow = player.position.clone().add(new THREE.Vector3(0, 7, 27).applyQuaternion(player.quaternion));
  camera.position.lerp(follow, 1 - Math.exp(-dt * 6));
  camera.lookAt(player.position.clone().add(new THREE.Vector3(0, 0, -45).applyQuaternion(player.quaternion)));
  document.querySelector('#mission')!.textContent = extraction.visible ? 'Reach extraction' : `Destroy targets ${kills}/6`;
  document.querySelector('#stats')!.textContent = `HP ${health}  MISSILES ${ammo}`;
}
function frame() {
  requestAnimationFrame(frame);
  update(Math.min(clock.getDelta(), 0.04));
  renderer.render(scene, camera);
}
frame();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
