// Procedural low-poly original models: player aircraft, enemy fighters,
// ground units, extraction beacons, and shared sprite textures.

import * as THREE from 'three';

const COL = {
  body: 0x3a3f49,
  bodyDark: 0x23262e,
  accent: 0xd8432f,
  cockpit: 0x15335a,
  wing: 0x373c46,
  enemy: 0x4a3a35,
  enemyAccent: 0xc8a537,
};

function stdMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.25, ...opts });
}

function add(mesh: THREE.Mesh, matList: THREE.Material[]): THREE.Mesh {
  matList.push(mesh.material as THREE.Material);
  return mesh;
}

/** Original multi-role strike fighter with a delta wing and twin tails. */
export function buildPlayerPlane(): { group: THREE.Group; pitchLight: THREE.PointLight } {
  const group = new THREE.Group();
  const mats: THREE.Material[] = [];
  const body = stdMat(COL.body, { metalness: 0.55, roughness: 0.4 });
  const bodyDark = stdMat(COL.bodyDark, { metalness: 0.5, roughness: 0.5 });
  const accent = stdMat(COL.accent, { metalness: 0.3, roughness: 0.5, emissive: 0x551005, emissiveIntensity: 0.35 });
  const dark = stdMat(0x1a1d24, { roughness: 0.8 });
  const canopyMat = stdMat(COL.cockpit, { metalness: 0.85, roughness: 0.12 });
  const white = stdMat(0xe8e6df, { roughness: 0.6 });

  // Fuselage
  const fusRef = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.78, 4.6, 3, 12), body), mats);
  fusRef.rotation.x = Math.PI / 2;
  fusRef.scale.set(1, 0.85, 1);
  fusRef.position.set(0, 0.45, 0);
  group.add(fusRef);

  const nose = add(new THREE.Mesh(new THREE.ConeGeometry(0.58, 1.7, 10), body), mats);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.5, -3.65);
  group.add(nose);

  const intakes = [new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 1.5), dark), new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 1.5), dark)];
  intakes[0].position.set(-0.95, 0.35, 1.6);
  intakes[1].position.set(0.95, 0.35, 1.6);
  intakes.forEach((m) => {
    add(m, mats);
    m.rotation.x = 0.12;
    group.add(m);
  });

  // Delta wing
  const wingShape = new THREE.Shape();
  wingShape.moveTo(-6.9, -0.18);
  wingShape.lineTo(0.4, 1.05);
  wingShape.lineTo(3.4, 0.55);
  wingShape.lineTo(6.3, -0.15);
  wingShape.lineTo(3.2, -1.15);
  wingShape.lineTo(-0.1, -1.05);
  wingShape.closePath();
  const wingGeo = new THREE.ShapeGeometry(wingShape);
  const wing = add(new THREE.Mesh(wingGeo, stdMat(COL.wing, { metalness: 0.5, roughness: 0.45 })), mats);
  wing.rotation.x = -Math.PI / 2;
  wing.rotation.z = 0.05;
  wing.position.set(0, 0.62, 0.9);
  group.add(wing);

  // Wingtip rails with missiles
  const railMat = stdMat(0x6b7280, { roughness: 0.5 });
  const missMat = stdMat(0xdfe3e8, { roughness: 0.4 });
  for (const sx of [-1, 1]) {
    const rail = add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 3.2), railMat), mats);
    rail.position.set(sx * 5.9, 0.52, 1.3);
    rail.rotation.z = sx * 0.06;
    group.add(rail);
    const miss = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 2.6, 3, 8), missMat), mats);
    miss.rotation.x = Math.PI / 2;
    miss.position.set(sx * 5.9, 0.75, 1.3);
    group.add(miss);
    const tip = add(new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.35, 8), accent), mats);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(sx * 5.9, 0.78, -0.1);
    group.add(tip);
  }

  // Twin tails (canted)
  for (const sx of [-1, 1]) {
    const tail = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.9, 1.35), bodyDark), mats);
    tail.position.set(sx * 1.05, 2.0, 2.15);
    tail.rotation.z = sx * 0.28;
    tail.rotation.y = sx * -0.08;
    group.add(tail);
    const tailTrim = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.5), accent), mats);
    tailTrim.position.set(sx * 1.05, 2.75, 2.1);
    tailTrim.rotation.z = sx * 0.28;
    group.add(tailTrim);
  }

  // Horizontal stabilizers
  for (const sx of [-1, 1]) {
    const stab = add(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 0.9), body), mats);
    stab.position.set(sx * 1.5, 0.8, 3.15);
    group.add(stab);
  }

  // Canopy
  const canopy = add(new THREE.Mesh(new THREE.SphereGeometry(0.52, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), canopyMat), mats);
  canopy.scale.set(1.25, 1, 1);
  canopy.position.set(0, 0.95, -1.15);
  group.add(canopy);

  // Engine nozzles
  for (const sx of [-1, 1]) {
    const nozzle = add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.5, 10), dark), mats);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(sx * 0.7, 0.55, 3.2);
    group.add(nozzle);
  }

  // Afterburner glow
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x7fd0ff,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const burner = add(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.4, 2.2, 8), glowMat), mats);
  burner.rotation.x = Math.PI / 2;
  burner.position.set(0, 0.55, 4.04);
  burner.visible = true;
  (burner.material as THREE.MeshBasicMaterial).opacity = 0.75;
  group.add(burner);
  group.userData.burner = burner;

  // Nav lights
  const navMat = (color: number) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
  for (const sx of [-1, 1]) {
    const light = add(
      new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6), navMat(sx < 0 ? 0xff2222 : 0x22ff44)),
      mats
    );
    light.position.set(sx * 6.6, 0.6, 2.0);
    group.add(light);
  }

  const pitchLight = new THREE.PointLight(0xff8844, 0, 26, 1.6);
  pitchLight.position.set(0, 0.55, 4.6);
  group.add(pitchLight);

  // Contact shadow blob
  const shadowTex = makeGlowTexture();
  const shadow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: shadowTex, color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false })
  );
  shadow.scale.set(16, 16, 1);
  shadow.position.set(0, -2.6, 0.4);
  shadow.renderOrder = 2;
  group.add(shadow);
  group.userData.shadow = shadow;
  group.userData.burnerMat = glowMat;

  group.userData.updateMaterials = (matsArr: THREE.Material[]): void => void matsArr;

  return { group, pitchLight };
}

/** Enemy delta-wing fighter, rust/bronze livery. */
export function buildEnemyFighter(): THREE.Group {
  const group = new THREE.Group();
  const body = stdMat(COL.enemy, { metalness: 0.45, roughness: 0.5 });
  const bodyDark = stdMat(0x2c2320, { metalness: 0.5 });
  const accent = stdMat(COL.enemyAccent, { metalness: 0.4, roughness: 0.45, emissive: 0x4a3a08, emissiveIntensity: 0.3 });

  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 4.2, 3, 10), body);
  fus.rotation.x = Math.PI / 2;
  fus.scale.set(1, 0.9, 1);
  fus.position.set(0, 0, 0);
  group.add(fus);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.5, 8), bodyDark);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.05, -3.1);
  group.add(nose);

  const wingShape = new THREE.Shape();
  wingShape.moveTo(-5.6, -0.1);
  wingShape.lineTo(-0.4, 0.9);
  wingShape.lineTo(5.6, -0.1);
  wingShape.lineTo(0.4, -0.9);
  wingShape.closePath();
  const wing = new THREE.Mesh(new THREE.ShapeGeometry(wingShape), body);
  wing.rotation.x = -Math.PI / 2;
  wing.position.set(0, 0.12, 0.8);
  group.add(wing);

  for (const sx of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5, 1.1), bodyDark);
    tail.position.set(sx * 0.9, 1.55, 1.85);
    tail.rotation.z = sx * 0.35;
    group.add(tail);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.4, 0.4), accent);
    trim.position.set(sx * 0.9, 2.2, 1.85);
    trim.rotation.z = sx * 0.35;
    group.add(trim);
    const bud = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 2.0, 3, 8), bodyDark);
    bud.rotation.x = Math.PI / 2;
    bud.position.set(sx * 4.4, 0.15, 1.1);
    group.add(bud);
  }

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    stdMat(0x331a12, { metalness: 0.6, roughness: 0.3 })
  );
  canopy.scale.set(1.2, 1, 1);
  canopy.position.set(0, 0.6, -0.85);
  group.add(canopy);

  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffa050,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.8, 7), glowMat);
  burner.rotation.x = Math.PI / 2;
  burner.position.set(0, 0.1, 3.1);
  group.add(burner);
  group.userData.burnerMat = glowMat;

  return group;
}

export function buildSamSite(): THREE.Group {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 4.4), stdMat(0x4a5560, { roughness: 0.7 }));
  base.position.y = 0.45;
  group.add(base);
  const track = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.35, 6.4), stdMat(0x2b3138));
  track.position.y = 0.2;
  group.add(track);
  const launcher = new THREE.Group();
  const bed = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 3.6), stdMat(0x37424e));
  launcher.add(bed);
  for (let i = 0; i < 4; i++) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3.1, 8), stdMat(0xb7c2cc));
    tube.rotation.x = Math.PI / 2;
    tube.position.set(i % 2 === 0 ? -0.55 : 0.55, 0.55 + Math.floor(i / 2) * 0.42, 0);
    launcher.add(tube);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.24, 6, 5), stdMat(0xd8432f));
    cap.position.set(i % 2 === 0 ? -0.55 : 0.55, 0.55 + Math.floor(i / 2) * 0.42, -1.62);
    launcher.add(cap);
  }
  launcher.rotation.x = -0.22;
  launcher.position.y = 1.25;
  group.add(launcher);
  group.userData.launcher = launcher;
  return group;
}

export function buildAaGun(): THREE.Group {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 2.1), stdMat(0x3d4a3a));
  base.position.y = 0.35;
  group.add(base);
  const turret = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 1.2), stdMat(0x55614f));
  body.position.y = 0.4;
  turret.add(body);
  for (const sx of [-0.3, 0.3]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.2, 7), stdMat(0x777060));
    barrel.rotation.x = Math.PI / 4;
    barrel.position.set(sx, 0.75, -0.55);
    turret.add(barrel);
  }
  turret.position.y = 0.75;
  group.add(turret);
  group.userData.turret = turret;
  return group;
}

export function buildRadarTruck(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 5.2), stdMat(0x46535e));
  body.position.y = 0.9;
  group.add(body);
  for (const wheel of [-1.5, 1.5]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.4, 10), stdMat(0x1f242b));
    w.rotation.z = Math.PI / 2;
    w.position.set(-1.25, 0.45, wheel);
    group.add(w);
    const w2 = w.clone();
    w2.position.x = 1.25;
    group.add(w2);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 2.6, 8), stdMat(0x2b3138));
  mast.position.set(0.9, 2.3, -0.2);
  group.add(mast);
  const dish = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.14, 20), stdMat(0xd8d4c6, { roughness: 0.4 }));
  bowl.rotation.x = Math.PI / 2;
  dish.add(bowl);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), stdMat(0x1f242b));
  hub.position.z = 0.1;
  dish.add(hub);
  dish.position.set(0.9, 4.15, -0.2);
  dish.rotation.x = Math.PI / 4;
  group.add(dish);
  group.userData.dish = dish;
  return group;
}

export function buildMortar(): THREE.Group {
  const group = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.4, 0.5, 8), stdMat(0x40382f));
  pad.position.y = 0.25;
  group.add(pad);
  const barrelGrp = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 3.4, 8), stdMat(0x57503f));
  barrel.rotation.z = Math.PI / 2 + 0.9;
  barrel.position.set(1.1, 1.2, 0);
  barrelGrp.add(barrel);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 1.6), stdMat(0x2e2a24));
  base.position.y = 0.65;
  barrelGrp.add(base);
  group.add(barrelGrp);
  group.userData.barrel = barrelGrp;
  return group;
}

export function buildExtractionBeacon(): THREE.Group {
  const group = new THREE.Group();
  const ringGeo = new THREE.RingGeometry(32, 34, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x37e06a,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 1.2;
  group.add(ring);
  group.userData.ring = ring;
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x37e06a,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(6, 22, 380, 16, 1, true), beamMat);
  beam.position.y = 190;
  group.add(beam);
  group.userData.beam = beam;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 9, 8), stdMat(0x2f7d46));
  pole.position.y = 4.5;
  group.add(pole);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), new THREE.MeshBasicMaterial({ color: 0x5dff8a }));
  light.position.y = 9.2;
  group.add(light);
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0x37e06a }));
    p.position.set(Math.cos(ang) * 30, 0.8, Math.sin(ang) * 30);
    group.add(p);
  }
  return group;
}

/** Soft radial glow texture used for sprites (fire, smoke, flares, lock pips). */
const glowCanvasCache = new Map<string, THREE.CanvasTexture>();

export function makeGlowTexture(opts?: { inner?: string; outer?: string; soft?: boolean }): THREE.CanvasTexture {
  const key = opts?.inner ?? 'white';
  const cached = glowCanvasCache.get(key);
  if (cached) return cached;
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, opts?.inner ?? 'rgba(255,255,255,1)');
  if (opts?.soft) {
    g.addColorStop(0.35, opts?.outer ?? 'rgba(255, 160, 60, 0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
  } else {
    g.addColorStop(0.4, opts?.outer ?? 'rgba(255, 200, 120, 0.9)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  glowCanvasCache.set(key, tex);
  return tex;
}

export function makeRockMaterial(): THREE.MeshStandardMaterial {
  return stdMat(0x6e6255, { roughness: 0.95, metalness: 0.02 });
}

export function makeTreeFoliageTexture(): THREE.CanvasTexture {
  const key = 'foliage';
  const cached = glowCanvasCache.get(key);
  if (cached) return cached;
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#2e6b2a';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1d4d1c';
  ctx.beginPath();
  ctx.arc(size * 0.36, size * 0.4, size * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3c7d33';
  ctx.beginPath();
  ctx.arc(size * 0.62, size * 0.62, size * 0.16, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  glowCanvasCache.set(key, tex);
  return tex;
}

export function makeCloudTexture(): THREE.CanvasTexture {
  const key = 'cloud';
  const cached = glowCanvasCache.get(key);
  if (cached) return cached;
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.55, 'rgba(235,238,242,0.42)');
  g.addColorStop(1, 'rgba(235,238,242,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // wispy bumps
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * size * 0.32;
    ctx.beginPath();
    ctx.arc(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, Math.random() * 26 + 10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.12 + Math.random() * 0.22) + ')';
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(cv);
  glowCanvasCache.set(key, tex);
  return tex;
}

export function makeDustTexture(): THREE.CanvasTexture {
  const key = 'dust';
  const cached = glowCanvasCache.get(key);
  if (cached) return cached;
  const size = 48;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  glowCanvasCache.set(key, tex);
  return tex;
}