import * as THREE from 'three';

/** Local convention: aircraft nose points along -Z (Three's default forward). */

function shapeFrom(points: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return s;
}

/** Flat horizontal panel (wing / stabiliser) from a planform outline. */
function panel(points: [number, number][], thickness: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shapeFrom(points), { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness / 2);
  geo.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geo, mat);
}

/** Vertical fin from an outline in the (z-forward, y-up) plane. */
function fin(points: [number, number][], thickness: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shapeFrom(points), { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness / 2);
  geo.rotateY(Math.PI / 2);
  return new THREE.Mesh(geo, mat);
}

export interface JetModel {
  group: THREE.Group;
  burners: THREE.Mesh[];
  gunPorts: THREE.Vector3[];
  hardpoints: THREE.Vector3[];
}

export function buildPlayerJet(): JetModel {
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({
    color: 0xdfe4ea,
    roughness: 0.42,
    metalness: 0.35,
    flatShading: true,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: 0x2c3d55,
    roughness: 0.5,
    metalness: 0.3,
    flatShading: true,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: 0xd8603a,
    roughness: 0.5,
    metalness: 0.2,
    flatShading: true,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7, metalness: 0.6 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x18344a,
    roughness: 0.08,
    metalness: 0.1,
    transmission: 0.35,
    transparent: true,
    opacity: 0.72,
  });

  // Fuselage: faceted spine built from stacked sections.
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.35, 11, 8, 1), body);
  fuse.rotation.x = Math.PI / 2;
  fuse.position.z = -0.5;
  group.add(fuse);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.05, 5.4, 8), body);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -8.7;
  group.add(nose);

  const spine = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 7.5), accent);
  spine.position.set(0, 0.85, 0.6);
  group.add(spine);

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.15, 3.6, 8), accent);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = 6.6;
  group.add(tail);

  // Canopy.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.05, 12, 10), glass);
  canopy.scale.set(1, 0.82, 2.5);
  canopy.position.set(0, 0.95, -4.2);
  group.add(canopy);

  // Main cranked-delta wings.
  const wingPts: [number, number][] = [
    [1.0, 3.4],
    [7.6, -2.6],
    [8.0, -4.1],
    [3.4, -4.6],
    [1.0, -5.6],
  ];
  const rightWing = panel(wingPts, 0.42, body);
  rightWing.position.y = -0.15;
  group.add(rightWing);
  const leftWing = panel(wingPts, 0.42, body);
  leftWing.scale.x = -1;
  leftWing.position.y = -0.15;
  group.add(leftWing);

  // Wing trim stripes.
  const stripePts: [number, number][] = [
    [4.6, -1.2],
    [7.5, -2.7],
    [7.9, -3.9],
    [5.0, -2.3],
  ];
  for (const s of [1, -1]) {
    const stripe = panel(stripePts, 0.46, trim);
    stripe.scale.x = s;
    stripe.position.y = -0.15;
    group.add(stripe);
  }

  // Canards.
  const canardPts: [number, number][] = [
    [0.9, -3.4],
    [3.4, -4.6],
    [3.5, -5.4],
    [0.9, -5.2],
  ];
  for (const s of [1, -1]) {
    const c = panel(canardPts, 0.3, accent);
    c.scale.x = s;
    c.position.set(0, 0.35, -1.6);
    c.rotation.z = s * -0.06;
    group.add(c);
  }

  // Canted twin tails.
  const finPts: [number, number][] = [
    [4.2, 0],
    [8.4, 0],
    [8.0, 3.6],
    [5.8, 3.7],
  ];
  for (const s of [1, -1]) {
    const f = fin(finPts, 0.28, accent);
    f.position.set(s * 1.9, 0.35, 0);
    f.rotation.z = s * 0.34;
    group.add(f);
  }

  // Ventral strakes.
  for (const s of [1, -1]) {
    const st = fin(
      [
        [5.4, 0],
        [8.2, 0],
        [8.2, -1.7],
      ],
      0.22,
      dark
    );
    st.position.set(s * 1.3, -0.5, 0);
    st.rotation.z = s * -0.5;
    group.add(st);
  }

  // Intakes.
  for (const s of [1, -1]) {
    const intake = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.25, 4.6), accent);
    intake.position.set(s * 1.7, -0.5, -2.2);
    intake.rotation.y = s * 0.05;
    group.add(intake);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.35, 0.5), dark);
    lip.position.set(s * 1.7, -0.5, -4.5);
    group.add(lip);
  }

  // Exhaust nozzles + afterburner cones.
  const burners: THREE.Mesh[] = [];
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x74c8ff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (const s of [1, -1]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.72, 1.8, 10), dark);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(s * 0.95, 0, 8.1);
    group.add(nozzle);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.62, 5.2, 10, 1, true), flameMat.clone());
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(s * 0.95, 0, 11.2);
    flame.scale.setScalar(0.01);
    group.add(flame);
    burners.push(flame);
  }

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = false;
  });

  return {
    group,
    burners,
    gunPorts: [new THREE.Vector3(1.4, -0.35, -5.4), new THREE.Vector3(-1.4, -0.35, -5.4)],
    hardpoints: [
      new THREE.Vector3(3.2, -0.6, -1.0),
      new THREE.Vector3(-3.2, -0.6, -1.0),
      new THREE.Vector3(5.0, -0.6, 0.2),
      new THREE.Vector3(-5.0, -0.6, 0.2),
    ],
  };
}

export function buildEnemyJet(): JetModel {
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({
    color: 0x4a5058,
    roughness: 0.55,
    metalness: 0.4,
    flatShading: true,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: 0x8d2f2a,
    roughness: 0.6,
    metalness: 0.2,
    flatShading: true,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.8, metalness: 0.5 });

  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 10.5, 7), body);
  fuse.rotation.x = Math.PI / 2;
  group.add(fuse);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.15, 4.6, 7), body);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -7.5;
  group.add(nose);
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.15, metalness: 0.8 })
  );
  canopy.scale.set(1, 0.8, 2.2);
  canopy.position.set(0, 0.85, -3.6);
  group.add(canopy);

  const wingPts: [number, number][] = [
    [1.1, 1.6],
    [7.2, -3.2],
    [7.3, -4.3],
    [1.1, -4.4],
  ];
  for (const s of [1, -1]) {
    const w = panel(wingPts, 0.4, body);
    w.scale.x = s;
    w.position.y = -0.1;
    group.add(w);
    const tp = panel(
      [
        [0.9, -4.0],
        [3.6, -5.6],
        [3.6, -6.4],
        [0.9, -5.6],
      ],
      0.28,
      accent
    );
    tp.scale.x = s;
    group.add(tp);
  }

  const finMesh = fin(
    [
      [3.6, 0],
      [6.4, 0],
      [6.2, 3.9],
      [4.9, 3.9],
    ],
    0.3,
    accent
  );
  finMesh.position.y = 0.5;
  group.add(finMesh);

  for (const s of [1, -1]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.66, 1.6, 8), dark);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(s * 0.85, 0, 5.6);
    group.add(nozzle);
  }

  const burners: THREE.Mesh[] = [];
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xff9a4a,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (const s of [1, -1]) {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.6, 8, 1, true), flameMat.clone());
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(s * 0.85, 0, 8.0);
    group.add(flame);
    burners.push(flame);
  }

  return {
    group,
    burners,
    gunPorts: [new THREE.Vector3(0.9, -0.6, -5.0)],
    hardpoints: [new THREE.Vector3(2.6, -0.7, -1.0), new THREE.Vector3(-2.6, -0.7, -1.0)],
  };
}

// --- Ground installations ------------------------------------------------

const metal = () =>
  new THREE.MeshStandardMaterial({ color: 0x6c7178, roughness: 0.75, metalness: 0.45, flatShading: true });
const concrete = () =>
  new THREE.MeshStandardMaterial({ color: 0x8b8578, roughness: 0.95, metalness: 0.05, flatShading: true });
const hazard = () =>
  new THREE.MeshStandardMaterial({ color: 0xb8642a, roughness: 0.7, metalness: 0.2, flatShading: true });

export interface StructureModel {
  group: THREE.Group;
  spinner?: THREE.Object3D;
  turret?: THREE.Object3D;
  muzzle?: THREE.Vector3;
  radius: number;
}

export function buildRadarStation(): StructureModel {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 4, 8), concrete());
  base.position.y = 2;
  group.add(base);
  const mast = new THREE.Mesh(new THREE.BoxGeometry(2.2, 16, 2.2), metal());
  mast.position.y = 12;
  group.add(mast);
  for (let i = 0; i < 3; i++) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(11, 0.7, 0.7), metal());
    brace.position.y = 6 + i * 5;
    brace.rotation.z = i % 2 ? 0.5 : -0.5;
    group.add(brace);
  }
  const spinner = new THREE.Group();
  spinner.position.y = 21;
  const dish = new THREE.Mesh(new THREE.SphereGeometry(7.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), metal());
  dish.rotation.x = Math.PI * 0.62;
  dish.material = new THREE.MeshStandardMaterial({
    color: 0xa9aeb4,
    roughness: 0.6,
    metalness: 0.5,
    side: THREE.DoubleSide,
    flatShading: true,
  });
  spinner.add(dish);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 6), metal());
  arm.position.z = -3;
  spinner.add(arm);
  group.add(spinner);
  return { group, spinner, radius: 14 };
}

export function buildFuelDepot(): StructureModel {
  const group = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(40, 1.4, 30), concrete());
  pad.position.y = 0.7;
  group.add(pad);
  for (let i = 0; i < 3; i++) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 12, 12), hazard());
    tank.position.set(-12 + i * 12, 7, i % 2 ? 5 : -5);
    group.add(tank);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), metal());
    cap.position.copy(tank.position).setY(13);
    group.add(cap);
  }
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 34, 8), metal());
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(0, 3.5, 11);
  group.add(pipe);
  return { group, radius: 22 };
}

export function buildBunker(): StructureModel {
  const group = new THREE.Group();
  const main = new THREE.Mesh(new THREE.BoxGeometry(30, 11, 22), concrete());
  main.position.y = 5.5;
  group.add(main);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 11.5, 30, 10, 1, false, 0, Math.PI), concrete());
  roof.rotation.z = Math.PI / 2;
  roof.position.y = 11;
  group.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(9, 8, 1.5), metal());
  door.position.set(0, 4, -11.4);
  group.add(door);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 14, 6), metal());
  ant.position.set(11, 18, -6);
  group.add(ant);
  return { group, radius: 18 };
}

export function buildHangar(): StructureModel {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(15, 15, 40, 14, 1, true, 0, Math.PI),
    new THREE.MeshStandardMaterial({
      color: 0x757a6f,
      roughness: 0.85,
      metalness: 0.2,
      side: THREE.DoubleSide,
      flatShading: true,
    })
  );
  shell.rotation.z = Math.PI / 2;
  group.add(shell);
  const back = new THREE.Mesh(new THREE.CircleGeometry(15, 14, 0, Math.PI), concrete());
  back.rotation.y = Math.PI;
  back.rotation.z = -Math.PI / 2;
  back.position.z = -20;
  group.add(back);
  const doors = new THREE.Mesh(new THREE.BoxGeometry(26, 15, 1.5), hazard());
  doors.position.set(0, 7.5, 20);
  group.add(doors);
  return { group, radius: 24 };
}

export function buildSamSite(): StructureModel {
  const group = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(11, 12, 2, 10), concrete());
  pad.position.y = 1;
  group.add(pad);
  const turret = new THREE.Group();
  turret.position.y = 2;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 9), metal());
  cab.position.y = 2.5;
  turret.add(cab);
  const rack = new THREE.Group();
  rack.position.set(0, 4.6, 0);
  rack.rotation.x = -0.5;
  for (let i = 0; i < 4; i++) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 9, 8), hazard());
    tube.rotation.x = Math.PI / 2;
    tube.position.set(-2.4 + (i % 2) * 4.8, i < 2 ? 0 : 1.7, 0);
    rack.add(tube);
  }
  turret.add(rack);
  const radar = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 0.4), metal());
  radar.position.set(0, 5.4, 4.2);
  radar.rotation.x = 0.35;
  turret.add(radar);
  group.add(turret);
  return { group, turret, muzzle: new THREE.Vector3(0, 7, -4), radius: 12 };
}

export function buildAaaGun(): StructureModel {
  const group = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 1.6, 8), concrete());
  pad.position.y = 0.8;
  group.add(pad);
  const turret = new THREE.Group();
  turret.position.y = 1.6;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(4.6, 3, 5), metal());
  cab.position.y = 1.6;
  turret.add(cab);
  for (const s of [1, -1]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 7, 6), metal());
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(s * 0.9, 2.4, -3.6);
    turret.add(barrel);
  }
  group.add(turret);
  return { group, turret, muzzle: new THREE.Vector3(0, 4, -7), radius: 6 };
}

export function buildExtractionGate(radius: number): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x5df2b0,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * (1 - i * 0.07), 2.2, 8, 40), mat);
    ring.position.z = i * 26;
    group.add(ring);
  }
  return group;
}
