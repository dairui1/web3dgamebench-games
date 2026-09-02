import * as THREE from 'three';

function std(color: number, metalness = 0.35, roughness = 0.55): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

function wingShape(span: number, rootChord: number, tipChord: number, sweep: number): THREE.Shape {
  // Shape lives in XY, later rotated so Y becomes Z (aft). Leading edge at negative "y".
  const s = new THREE.Shape();
  s.moveTo(-span, sweep + tipChord);
  s.lineTo(-span, sweep);
  s.lineTo(0, -rootChord * 0.5);
  s.lineTo(span, sweep);
  s.lineTo(span, sweep + tipChord);
  s.lineTo(0, rootChord * 0.5);
  s.closePath();
  return s;
}

function extrudeFlat(shape: THREE.Shape, thickness: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  g.translate(0, thickness / 2, 0);
  return g;
}

export interface JetParts {
  group: THREE.Group;
  afterburner: THREE.Mesh;
}

/** Builds an original swept-wing jet, nose pointing -Z. Roughly 16 units long. */
export function buildJet(color: number, accent: number, scale = 1): JetParts {
  const g = new THREE.Group();
  const body = std(color);
  const trim = std(accent, 0.3, 0.5);
  const darkMat = std(0x1d2128, 0.6, 0.4);
  const glass = new THREE.MeshStandardMaterial({
    color: 0x6fb6ff, metalness: 0.7, roughness: 0.15, transparent: true, opacity: 0.85,
  });

  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.35, 11, 14), body);
  fus.rotation.x = Math.PI / 2;
  fus.position.z = 0.5;
  g.add(fus);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.0, 4.5, 14), trim);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -7.2;
  g.add(nose);

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 0.9, 2.5, 14), darkMat);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = 7.2;
  g.add(tail);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 10), glass);
  canopy.scale.set(0.85, 0.75, 2.3);
  canopy.position.set(0, 0.95, -2.6);
  g.add(canopy);

  const intakeL = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 5), darkMat);
  intakeL.position.set(-1.5, -0.2, 1.5);
  g.add(intakeL);
  const intakeR = intakeL.clone();
  intakeR.position.x = 1.5;
  g.add(intakeR);

  const wings = new THREE.Mesh(extrudeFlat(wingShape(8.5, 5, 1.6, 3.2), 0.28), body);
  wings.position.set(0, -0.2, 1.0);
  g.add(wings);

  const wingTipL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2.2), trim);
  wingTipL.position.set(-8.4, -0.1, 4.8);
  g.add(wingTipL);
  const wingTipR = wingTipL.clone();
  wingTipR.position.x = 8.4;
  g.add(wingTipR);

  const hstab = new THREE.Mesh(extrudeFlat(wingShape(3.6, 2.4, 0.9, 1.6), 0.22), body);
  hstab.position.set(0, 0.1, 6.6);
  g.add(hstab);

  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(-3.2, 0);
  finShape.lineTo(-1.0, 3.4);
  finShape.lineTo(0.2, 3.4);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.2, bevelEnabled: false });
  finGeo.rotateY(Math.PI / 2);
  const finL = new THREE.Mesh(finGeo, trim);
  finL.position.set(-1.0, 0.6, 7.6);
  finL.rotation.z = 0.28;
  g.add(finL);
  const finR = new THREE.Mesh(finGeo, trim);
  finR.position.set(1.0, 0.6, 7.6);
  finR.rotation.z = -0.28;
  g.add(finR);

  const ab = new THREE.Mesh(
    new THREE.ConeGeometry(0.75, 4, 10),
    new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  ab.rotation.x = Math.PI / 2;
  ab.position.z = 10.2;
  g.add(ab);

  g.scale.setScalar(scale);
  return { group: g, afterburner: ab };
}

export interface TurretParts {
  group: THREE.Group;
  turret: THREE.Object3D;
  muzzles: THREE.Object3D[];
}

export function buildSamSite(): TurretParts {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(14, 3, 14), std(0x4c5a52, 0.2, 0.8));
  base.position.y = 1.5;
  g.add(base);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 8), std(0x5f6b62, 0.2, 0.8));
  cab.position.set(-3, 5, 0);
  g.add(cab);
  const turret = new THREE.Group();
  turret.position.set(3, 4.5, 0);
  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, 2, 12), std(0x3b4540, 0.4, 0.6));
  turret.add(pivot);
  const muzzles: THREE.Object3D[] = [];
  const tubeGeo = new THREE.CylinderGeometry(0.7, 0.7, 7, 10);
  tubeGeo.rotateX(Math.PI / 2);
  const tubeMat = std(0xb8b09a, 0.3, 0.6);
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(tubeGeo, tubeMat);
    t.position.set((i % 2) * 1.8 - 0.9, 1.6 + Math.floor(i / 2) * 1.7, 0);
    turret.add(t);
    const m = new THREE.Object3D();
    m.position.set(t.position.x, t.position.y, 3.5);
    turret.add(m);
    muzzles.push(m);
  }
  turret.rotation.x = -0.6;
  g.add(turret);
  return { group: g, turret, muzzles };
}

export function buildAaaGun(): TurretParts {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.5, 2, 12), std(0x4a4f45, 0.3, 0.7));
  base.position.y = 1;
  g.add(base);
  const sand = new THREE.Mesh(new THREE.TorusGeometry(7, 1.6, 6, 16), std(0x8d7a55, 0.05, 1));
  sand.rotation.x = Math.PI / 2;
  sand.position.y = 0.8;
  g.add(sand);
  const turret = new THREE.Group();
  turret.position.y = 3;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.5, 4), std(0x5a6156, 0.4, 0.6));
  turret.add(housing);
  const barrelGeo = new THREE.CylinderGeometry(0.28, 0.35, 7, 8);
  barrelGeo.rotateX(Math.PI / 2);
  const barrelMat = std(0x2b2f2c, 0.6, 0.4);
  const muzzles: THREE.Object3D[] = [];
  for (const x of [-0.8, 0.8]) {
    const b = new THREE.Mesh(barrelGeo, barrelMat);
    b.position.set(x, 0.5, 4);
    turret.add(b);
    const m = new THREE.Object3D();
    m.position.set(x, 0.5, 7.5);
    turret.add(m);
    muzzles.push(m);
  }
  g.add(turret);
  return { group: g, turret, muzzles };
}

export function buildRadar(): { group: THREE.Group; dish: THREE.Object3D } {
  const g = new THREE.Group();
  const bunker = new THREE.Mesh(new THREE.BoxGeometry(16, 5, 12), std(0x6b6e66, 0.1, 0.9));
  bunker.position.y = 2.5;
  g.add(bunker);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 14, 8), std(0x9a9e96, 0.5, 0.5));
  mast.position.set(0, 12, 0);
  g.add(mast);
  const dish = new THREE.Group();
  dish.position.set(0, 19, 0);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(7, 5.5, 1.2, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xd8dcd6, metalness: 0.4, roughness: 0.4, side: THREE.DoubleSide }));
  disc.rotation.x = Math.PI / 2;
  disc.rotation.z = Math.PI;
  dish.add(disc);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 5, 6), std(0x333333));
  feed.rotation.x = Math.PI / 2;
  feed.position.z = -2.5;
  dish.add(feed);
  dish.rotation.x = -0.35;
  g.add(dish);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
  light.position.set(0, 19.8, 0);
  g.add(light);
  return { group: g, dish };
}

export function buildDepot(): THREE.Group {
  const g = new THREE.Group();
  const tankMat = std(0xc9c3b3, 0.4, 0.5);
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 7, 16), tankMat);
    t.position.set(-8 + i * 8, 3.5, -4);
    g.add(t);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), tankMat);
    cap.position.set(-8 + i * 8, 7, -4);
    g.add(cap);
  }
  const shed = new THREE.Mesh(new THREE.BoxGeometry(22, 5, 8), std(0x7d5f46, 0.1, 0.9));
  shed.position.set(0, 2.5, 6);
  g.add(shed);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(23, 0.6, 9), std(0x4b3a2c, 0.1, 0.9));
  roof.position.set(0, 5.3, 6);
  g.add(roof);
  return g;
}

export function buildMissile(color = 0xe8e8e8): THREE.Group {
  const g = new THREE.Group();
  const bodyGeo = new THREE.CylinderGeometry(0.32, 0.32, 3.6, 8);
  bodyGeo.rotateX(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeo, std(color, 0.4, 0.4));
  g.add(body);
  const noseGeo = new THREE.ConeGeometry(0.32, 1.0, 8);
  noseGeo.rotateX(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, std(0x333333, 0.5, 0.4));
  nose.position.z = -2.3;
  g.add(nose);
  const finGeo = new THREE.BoxGeometry(1.6, 0.08, 0.9);
  const finMat = std(0x9a2a2a, 0.3, 0.6);
  const f1 = new THREE.Mesh(finGeo, finMat);
  f1.position.z = 1.4;
  g.add(f1);
  const f2 = f1.clone();
  f2.rotation.z = Math.PI / 2;
  g.add(f2);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  glow.position.z = 2.0;
  g.add(glow);
  return g;
}

export function buildExtractionBeacon(): THREE.Group {
  const g = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x3dff9a, transparent: true, opacity: 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(60 + i * 25, 2.5, 8, 48), ringMat);
    r.position.y = i * 6;
    r.rotation.x = Math.PI / 2;
    g.add(r);
  }
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 14, 500, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x3dff9a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  beam.position.y = 250;
  g.add(beam);
  return g;
}

export function makeCloudTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
