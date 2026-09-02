import * as THREE from 'three';

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.55, metalness: 0.25, ...opts });
}

export function buildJet(bodyColor: number, accentColor: number): THREE.Group {
  const group = new THREE.Group();

  const bodyMat = mat(bodyColor);
  const accentMat = mat(accentColor, { emissive: accentColor, emissiveIntensity: 0.15 });
  const glassMat = mat(0x1a2733, { roughness: 0.15, metalness: 0.6 });

  const fuselage = new THREE.Mesh(new THREE.ConeGeometry(1.05, 7.2, 8), bodyMat);
  fuselage.rotation.x = -Math.PI / 2;
  fuselage.position.z = -0.4;
  group.add(fuselage);

  const tailCone = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.4, 2.6, 8), bodyMat);
  tailCone.rotation.x = Math.PI / 2;
  tailCone.position.z = 3.6;
  group.add(tailCone);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6, 0, Math.PI * 2, 0, Math.PI / 1.6), glassMat);
  canopy.scale.set(0.7, 0.6, 1.5);
  canopy.position.set(0, 0.55, -1.6);
  group.add(canopy);

  const wingGeo = new THREE.BoxGeometry(5.6, 0.12, 1.9);
  const wingL = new THREE.Mesh(wingGeo, bodyMat);
  wingL.position.set(-2.5, -0.05, 0.6);
  wingL.rotation.z = 0.05;
  group.add(wingL);
  const wingR = wingL.clone();
  wingR.position.x = 2.5;
  wingR.rotation.z = -0.05;
  group.add(wingR);

  const stripeGeo = new THREE.BoxGeometry(1.6, 0.05, 0.5);
  const stripeL = new THREE.Mesh(stripeGeo, accentMat);
  stripeL.position.set(-2.6, 0, 0.9);
  group.add(stripeL);
  const stripeR = stripeL.clone();
  stripeR.position.x = 2.6;
  group.add(stripeR);

  const finGeo = new THREE.BoxGeometry(0.1, 1.3, 1.5);
  const finL = new THREE.Mesh(finGeo, bodyMat);
  finL.position.set(-0.55, 0.55, 3.2);
  finL.rotation.z = 0.35;
  group.add(finL);
  const finR = finL.clone();
  finR.position.x = 0.55;
  finR.rotation.z = -0.35;
  group.add(finR);

  const tailWingGeo = new THREE.BoxGeometry(2.2, 0.1, 0.9);
  const tailWing = new THREE.Mesh(tailWingGeo, bodyMat);
  tailWing.position.set(0, 0.1, 3.4);
  group.add(tailWing);

  const intakeGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.6, 8);
  const intakeL = new THREE.Mesh(intakeGeo, mat(0x22262b));
  intakeL.rotation.x = Math.PI / 2;
  intakeL.position.set(-0.75, -0.1, 0.4);
  group.add(intakeL);
  const intakeR = intakeL.clone();
  intakeR.position.x = 0.75;
  group.add(intakeR);

  const nozzleGeo = new THREE.CylinderGeometry(0.5, 0.42, 0.5, 8);
  const nozzle = new THREE.Mesh(nozzleGeo, mat(0x1c1c1c, { metalness: 0.8, roughness: 0.4 }));
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = 4.85;
  group.add(nozzle);

  group.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });

  return group;
}

export function buildEngineGlow(color = 0xff8a3d): THREE.PointLight {
  const light = new THREE.PointLight(color, 0, 20, 2);
  return light;
}

export function buildTurret(): THREE.Group {
  const group = new THREE.Group();
  const baseMat = mat(0x3a3f33);
  const gunMat = mat(0x22261e);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.7, 1.4, 8), baseMat);
  base.position.y = 0.7;
  group.add(base);

  const turretHead = new THREE.Group();
  turretHead.position.y = 1.5;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), baseMat);
  turretHead.add(dome);

  const barrelGeo = new THREE.CylinderGeometry(0.16, 0.2, 3.2, 6);
  const barrelL = new THREE.Mesh(barrelGeo, gunMat);
  barrelL.rotation.x = Math.PI / 2;
  barrelL.position.set(-0.4, 0.3, -2);
  turretHead.add(barrelL);
  const barrelR = barrelL.clone();
  barrelR.position.x = 0.4;
  turretHead.add(barrelR);

  group.add(turretHead);
  (group as any).userData.turretHead = turretHead;
  return group;
}

export function buildSamSite(): THREE.Group {
  const group = new THREE.Group();
  const baseMat = mat(0x44403a);
  const missileMat = mat(0xd8d4c8, { roughness: 0.4 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.2, 4.5), baseMat);
  base.position.y = 0.6;
  group.add(base);

  const pivot = new THREE.Group();
  pivot.position.y = 1.2;
  group.add(pivot);

  for (let i = -1; i <= 1; i += 2) {
    const rack = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3.6, 6), missileMat);
    rack.rotation.z = -0.55;
    rack.position.set(i * 0.9, 1.2, 0);
    pivot.add(rack);
  }
  (group as any).userData.turretHead = pivot;
  return group;
}

export function buildRadarDish(): THREE.Mesh {
  const dish = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 0.15, 16, 1, false, 0, Math.PI),
    mat(0xcfcfcf, { roughness: 0.3 }),
  );
  dish.rotation.z = Math.PI / 2;
  return dish;
}

export function buildMissile(color = 0xdedede): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.2, 6), mat(color));
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 6), mat(0xff5a3d, { emissive: 0x551100 }));
  nose.rotation.x = Math.PI / 2;
  nose.position.z = -1.35;
  group.add(nose);
  const finGeo = new THREE.BoxGeometry(0.05, 0.5, 0.4);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, mat(0x888888));
    fin.position.z = 1;
    fin.rotation.z = (Math.PI / 2) * i;
    fin.position.x = Math.cos((Math.PI / 2) * i) * 0.2;
    fin.position.y = Math.sin((Math.PI / 2) * i) * 0.2;
    group.add(fin);
  }
  return group;
}

export function buildBullet(color = 0xffe066): THREE.Mesh {
  const geo = new THREE.SphereGeometry(0.16, 6, 5);
  const m = new THREE.MeshBasicMaterial({ color });
  return new THREE.Mesh(geo, m);
}

export function buildExtractionGate(): THREE.Group {
  const group = new THREE.Group();
  const pylonMat = mat(0x2196f3, { emissive: 0x2196f3, emissiveIntensity: 0.6, roughness: 0.3 });
  const pylonGeo = new THREE.CylinderGeometry(2, 2, 60, 10);
  const left = new THREE.Mesh(pylonGeo, pylonMat);
  left.position.x = -70;
  left.position.y = 30;
  group.add(left);
  const right = left.clone();
  right.position.x = 70;
  group.add(right);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(70, 1.6, 8, 24), pylonMat);
  ring.position.y = 62;
  group.add(ring);
  return group;
}
