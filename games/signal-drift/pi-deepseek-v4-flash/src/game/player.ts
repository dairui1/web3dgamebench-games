import * as THREE from 'three';

export const CRUISE = 62;
export const BOOST_MULT = 1.55;
export const MAX_LAT = 46;
export const LAT_K = 4.6;
export const CORRIDOR_X = 33;
export const CORRIDOR_Y_MIN = -9;
export const CORRIDOR_Y_MAX = 27;
export const CRAFT_R = 2.0;

/**
 * The courier craft: built from primitives, plus flight model and camera rig.
 */
export class Player {
  readonly group = new THREE.Group();
  readonly engineGlow: THREE.Mesh;

  x = 0;
  y = 12;
  z = 0;
  vx = 0;
  vy = 0;
  speed = CRUISE;
  boost = false;

  private roll = 0;
  private pitch = 0;
  private bobT = 0;
  private rigYaw = 0;

  // camera
  readonly camera: THREE.PerspectiveCamera;
  private camX = 0;
  private camY = 0;
  private camZ = 0;
  private fovBase = 70;
  private shake = 0;
  shakeAmp = 0;
  shakeFov = 0;

  private noseMat: THREE.MeshStandardMaterial;
  private wingMat: THREE.MeshStandardMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private finMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.fovBase = camera.fov;

    // ---- craft geometry -------------------------------------------------
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0xd9e4ee, roughness: 0.32, metalness: 0.72,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1b2434, roughness: 0.5, metalness: 0.6,
    });
    this.noseMat = hullMat;
    this.wingMat = darkMat;
    this.finMat = darkMat;

    const g = this.group;

    // canopy
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x10202c, roughness: 0.12, metalness: 0.9,
      emissive: 0x1c4a5c, emissiveIntensity: 0.35,
    });
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12), canopyMat);
    canopy.scale.set(0.8, 0.62, 1.5);
    canopy.position.set(0, 0.55, 0.35);
    g.add(canopy);

    // fuselage
    const fus = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 2.0, 6, 12), hullMat);
    fus.rotation.x = Math.PI / 2;
    fus.scale.set(1, 1, 1.15);
    g.add(fus);

    // nose cone
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.7, 8), hullMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0, 1.85);
    g.add(nose);

    // wings
    const wingGeo = new THREE.BoxGeometry(4.4, 0.14, 1.5);
    const wing = new THREE.Mesh(wingGeo, darkMat);
    wing.position.set(0, -0.08, -0.3);
    g.add(wing);

    // tail fin
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.15, 1.05), darkMat);
    fin.position.set(0, 0.72, -1.25);
    g.add(fin);

    // engine nacelles
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.4, 1.5, 10), darkMat);
    nac.rotation.x = Math.PI / 2;
    nac.position.set(-0.95, -0.05, -1.1);
    g.add(nac);
    const nac2 = nac.clone();
    nac2.position.x = 0.95;
    g.add(nac2);

    this.glowMat = new THREE.MeshBasicMaterial({
      color: 0x59e6ff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.engineGlow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 14), this.glowMat);
    this.engineGlow.position.set(-0.95, -0.05, -1.88);
    g.add(this.engineGlow);
    const glow2 = this.engineGlow.clone();
    glow2.position.x = 0.95;
    g.add(glow2);

    // under running light
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff5a5a, fog: false }),
    );
    light.position.set(0, -0.6, 1.0);
    g.add(light);

    // point light for local illumination
    const pl = new THREE.PointLight(0x9fdcff, 9, 46, 1.7);
    pl.position.set(0, 0.6, 0.8);
    g.add(pl);

    g.position.set(this.x, this.y, this.z);
    scene.add(g);

    this.camX = this.x;
    this.camY = this.y + 5.6;
    this.camZ = this.z - 15.5;
  }

  reset(): void {
    this.x = 0;
    this.y = 12;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.speed = CRUISE;
    this.boost = false;
    this.roll = 0;
    this.pitch = 0;
    this.group.position.set(0, 12, 0);
    this.group.rotation.set(0, 0, 0);
    this.camX = 0;
    this.camY = 17.6;
    this.camZ = -15.5;
    this.shakeAmp = 0;
    this.shakeFov = 0;
    this.camera.fov = this.fovBase;
    this.camera.updateProjectionMatrix();
  }

  /** Frame-rate independent steering toward an input vector. */
  steer(dt: number, inputX: number, inputY: number, dragDX: number, dragDY: number): void {
    const k = 1 - Math.exp(-LAT_K * dt);
    this.vx += (inputX * MAX_LAT - this.vx) * k;
    this.vy += (inputY * MAX_LAT - this.vy) * k;
    // pointer/touch drag injects direct velocity
    this.vx += dragDX;
    this.vy += dragDY;
    const vmax = MAX_LAT * 1.5;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > vmax) {
      this.vx *= vmax / sp;
      this.vy *= vmax / sp;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // bounds
    if (this.x < -CORRIDOR_X) { this.x = -CORRIDOR_X; this.vx = Math.max(0, this.vx); }
    if (this.x > CORRIDOR_X) { this.x = CORRIDOR_X; this.vx = Math.min(0, this.vx); }
    if (this.y < CORRIDOR_Y_MIN) { this.y = CORRIDOR_Y_MIN; this.vy = Math.max(0, this.vy); }
    if (this.y > CORRIDOR_Y_MAX) { this.y = CORRIDOR_Y_MAX; this.vy = Math.min(0, this.vy); }
  }

  update(dt: number, boosting: boolean, timeScale = 1): void {
    this.boost = boosting;
    const target = boosting ? CRUISE * BOOST_MULT : CRUISE;
    this.speed += (target - this.speed) * (1 - Math.exp(-2.4 * dt));
    this.z += this.speed * dt;
    this.bobT += dt;
    if (timeScale >= 1) {
      this.group.position.set(this.x, this.y + Math.sin(this.bobT * 1.6) * 0.25, this.z);
    } else {
      this.group.position.set(this.x, this.y, this.z);
    }

    const sx = this.vx / MAX_LAT;
    const sy = this.vy / MAX_LAT;
    const rollTarget = -sx * 0.5 * (1 + (boosting ? 0.35 : 0));
    const pitchTarget = -sy * 0.16 + (boosting ? 0.06 : 0);
    const rk = 1 - Math.exp(-7 * dt);
    this.roll += (rollTarget - this.roll) * rk;
    this.pitch += (pitchTarget - this.pitch) * rk;
    this.group.rotation.z = this.roll;
    this.group.rotation.x = this.pitch;
    // subtle heading sway
    this.group.rotation.y = sx * 0.12;

    // engine glow flicker
    const flick = 0.8 + Math.random() * 0.25 + (boosting ? 0.5 : 0);
    this.glowMat.opacity = Math.min(1, flick);
    this.glowMat.color.setHex(boosting ? 0x9af2ff : 0x59e6ff);
    (this.engineGlow.material as THREE.MeshBasicMaterial).color.copy(this.glowMat.color);

    // camera rig
    const speedRatio = this.speed / CRUISE;
    const ck = 1 - Math.exp(-5.2 * dt);
    const tx = this.x * 0.5;
    const ty = this.y + 5.7;
    const tz = this.z - 14.5 - speedRatio * 3.5;
    this.camX += (tx - this.camX) * ck;
    this.camY += (ty - this.camY) * ck;
    this.camZ += (tz - this.camZ) * ck;

    // shake decay
    this.shakeAmp *= Math.exp(-4.5 * dt);
    this.shakeFov *= Math.exp(-6 * dt);

    const shX = (Math.random() - 0.5) * this.shakeAmp;
    const shY = (Math.random() - 0.5) * this.shakeAmp;
    this.camera.position.set(this.camX + shX * 0.4, this.camY + shY * 0.4, this.camZ);
    this.camera.rotation.z = this.roll * 0.45;

    const lookX = this.x + shX * 0.5;
    const lookY = this.y + 3.1 + shY * 0.5;
    const lookZ = this.z + 60 + speedRatio * 10;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(lookX, lookY, lookZ);

    const fovTarget = this.fovBase + (speedRatio - 1) * 14 + this.shakeFov;
    if (Math.abs(this.camera.fov - fovTarget) > 0.01) {
      this.camera.fov += (fovTarget - this.camera.fov) * (1 - Math.exp(-6 * dt));
      this.camera.updateProjectionMatrix();
    }
  }

  /** Idle cinematic pose used on the title screen. */
  idleUpdate(dt: number, t: number): void {
    this.bobT += dt;
    this.group.position.set(
      Math.sin(t * 0.4) * 4,
      12 + Math.sin(t * 0.7) * 0.7,
      Math.cos(t * 0.3) * 3,
    );
    this.group.rotation.set(Math.sin(t * 0.5) * 0.06, t * 0.25, Math.sin(t * 0.6) * 0.12);
    this.glowMat.opacity = 0.7 + Math.sin(t * 5) * 0.2;

    const camA = t * 0.12;
    const rad = 30;
    this.camera.position.set(
      Math.sin(camA) * rad,
      19 + Math.sin(t * 0.4) * 2,
      -6 + Math.cos(camA) * rad,
    );
    this.camera.lookAt(0, 12, 20);
  }

  /** Landing pose for failure (craft sinks into the clouds). */
  sinkUpdate(dt: number): void {
    this.y -= 13 * dt;
    this.group.position.y = Math.max(-58, this.y);
    const rk = 1 - Math.exp(-3 * dt);
    this.roll += (-0.9 - this.roll) * rk;
    this.group.rotation.z = this.roll;
    this.group.rotation.x += dt * 0.4;
  }

  addShake(amp: number, fov = 0): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeFov += fov;
  }

  lookAtCenter(): void {
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.x, this.y + 2, this.z + 60);
  }
}