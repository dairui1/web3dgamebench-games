// Mesh builders for aircraft, ground targets and projectiles.
// All models are original, built from Three.js primitives.

import * as THREE from 'three';

export interface AircraftModel {
  group: THREE.Group;
  /** engine glow discs, brightened with throttle */
  glow: THREE.Mesh[];
}

function mat(color: number, opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

export function buildPlayerJet(): AircraftModel {
  const group = new THREE.Group();

  const body = mat(0x5d6b78);
  const dark = mat(0x39434d);
  const accent = mat(0xc7d3de);
  const canopyMat = mat(0x27414f, { transparent: true, opacity: 0.85 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x7fd4ff });

  // Fuselage
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.1, 9, 10), body);
  fus.rotation.x = Math.PI / 2;
  group.add(fus);

  // Nose cone
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.85, 3.4, 10), body);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -6.1;
  group.add(nose);

  // Canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.72, 10, 8), canopyMat);
  canopy.scale.set(1, 0.75, 2.1);
  canopy.position.set(0, 0.72, -2.4);
  group.add(canopy);

  // Delta wings
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 2.6);
  wingShape.lineTo(7.2, -2.4);
  wingShape.lineTo(7.2, -3.6);
  wingShape.lineTo(0, -1.6);
  wingShape.lineTo(-7.2, -3.6);
  wingShape.lineTo(-7.2, -2.4);
  wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
    depth: 0.22,
    bevelEnabled: false,
  });
  wingGeo.rotateX(Math.PI / 2);
  const wings = new THREE.Mesh(wingGeo, body);
  wings.position.set(0, 0.15, 1.4);
  group.add(wings);

  // Wing accents
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.5), accent);
    stripe.position.set(side * 5.2, 0.45, 2.6);
    stripe.rotation.y = side * 0.32;
    group.add(stripe);
  }

  // Twin vertical stabilizers
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.0, 1.9), dark);
    fin.position.set(side * 1.35, 1.15, 3.4);
    fin.rotation.x = -0.28;
    group.add(fin);
  }

  // Horizontal stabilizers
  for (const side of [-1, 1]) {
    const stab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 1.3), body);
    stab.position.set(side * 2.2, 0.1, 4.1);
    group.add(stab);
  }

  // Engine intakes
  for (const side of [-1, 1]) {
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 2.6), dark);
    intake.position.set(side * 1.5, -0.15, -0.6);
    group.add(intake);
  }

  // Engine glow discs
  const glow: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const g = new THREE.Mesh(new THREE.CircleGeometry(0.62, 12), glowMat);
    g.position.set(side * 0.62, 0, 4.55);
    g.rotation.y = Math.PI;
    group.add(g);
    glow.push(g);
  }

  return { group, glow };
}

export function buildDrone(): AircraftModel {
  const group = new THREE.Group();
  const body = mat(0x8f3f36);
  const dark = mat(0x4a2a25);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffb066 });

  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 4.4, 4, 10), body);
  fus.rotation.x = Math.PI / 2;
  group.add(fus);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.2, 10), dark);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -4;
  group.add(nose);

  // Forward-swept wings
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.16, 1.8), body);
    wing.position.set(side * 2.6, 0, 0.6);
    wing.rotation.y = -side * 0.5;
    group.add(wing);

    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.4, 1.2), dark);
    fin.position.set(side * 0.9, 0.75, 2.2);
    group.add(fin);

    const g = new THREE.Mesh(new THREE.CircleGeometry(0.45, 10), glowMat);
    g.position.set(side * 0.5, 0, 3.15);
    g.rotation.y = Math.PI;
    group.add(g);
  }

  return { group, glow: [] };
}

export interface GroundSite {
  group: THREE.Group;
  radar: THREE.Object3D;
  launcher: THREE.Object3D;
}

/** Surface-to-air missile site: radar dish + rotating launcher. */
export function buildSamSite(): GroundSite {
  const group = new THREE.Group();
  const base = mat(0x5c5f52);
  const dark = mat(0x3b3e35);
  const accent = mat(0x9b5a3c);

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 1.6, 10), base);
  pedestal.position.y = 0.8;
  group.add(pedestal);

  const radar = new THREE.Group();
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), accent);
  dish.rotation.x = -Math.PI / 3;
  dish.position.set(-2.6, 3.4, 0);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.6, 6), dark);
  mast.position.set(-2.6, 2.4, 0);
  radar.add(dish, mast);
  group.add(radar);

  const launcher = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 4.6), dark);
  box.position.y = 0.4;
  launcher.add(box);
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.32, 4.4, 8),
        accent,
      );
      tube.rotation.x = Math.PI / 2 - 0.5;
      tube.position.set(-0.42 + i * 0.84, 1.15 + j * 0.7, 0.3);
      launcher.add(tube);
    }
  }
  launcher.position.set(2.4, 2.0, 0);
  group.add(launcher);

  return { group, radar, launcher };
}

/** Anti-air gun turret: fires tracer bullets. */
export function buildAaTurret(): GroundSite {
  const group = new THREE.Group();
  const base = mat(0x565a4e);
  const dark = mat(0x34372f);

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.8, 1.4, 10), base);
  pedestal.position.y = 0.7;
  group.add(pedestal);

  const radar = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), dark);
  dome.position.set(0, 1.6, -1.6);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.2, 6), dark);
  post.position.set(0, 0.9, -1.6);
  radar.add(dome, post);
  group.add(radar);

  const launcher = new THREE.Group();
  const mount = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 1.6), dark);
  mount.position.y = 0.6;
  launcher.add(mount);
  for (const side of [-1, 1]) {
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 3.4, 8),
      dark,
    );
    barrel.rotation.x = Math.PI / 2 - 0.18;
    barrel.position.set(side * 0.45, 1.0, -1.6);
    launcher.add(barrel);
  }
  launcher.position.set(0, 1.2, 0.6);
  group.add(launcher);

  return { group, radar, launcher };
}

export function buildMissileMesh(color = 0xd8dde2): THREE.Group {
  const g = new THREE.Group();
  const m = mat(color, { emissive: 0x222222 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.4, 8), m);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 8), m);
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -1.55;
  g.add(tip);
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xffc36b,
    transparent: true,
    opacity: 0.9,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.4, 8), flameMat);
  flame.rotation.x = Math.PI / 2;
  flame.position.z = 1.9;
  g.add(flame);
  return g;
}

/** Heli-pad style extraction marker (won on mission completion). */
export function buildExtractionPad(): THREE.Group {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(26, 26, 1.4, 28),
    mat(0x3f4a3a),
  );
  pad.position.y = 0.7;
  g.add(pad);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(19, 1.2, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0xffe27a }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.6;
  g.add(ring);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffe27a,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(19, 26, 420, 20, 1, true), beamMat);
  beam.position.y = 212;
  g.add(beam);
  return g;
}
