import * as THREE from 'three';
import { Rng } from '../core/mathutil';
import { WORLD, canyonHalfWidth, heightAt, normalAt, pathX } from './terrain';

export interface ArchInfo {
  position: THREE.Vector3;
  radius: number;
}

export interface PropsBuild {
  group: THREE.Group;
  arches: ArchInfo[];
}

/** Scenery: spires, boulders, hardy pines and rock arches spanning the canyon. */
export function buildProps(): PropsBuild {
  const group = new THREE.Group();
  group.name = 'props';
  const rng = new Rng(70707);
  const dummy = new THREE.Object3D();

  const rockMat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a, flatShading: true });
  const darkRockMat = new THREE.MeshLambertMaterial({ color: 0x6b5644, flatShading: true });

  // --- Spires -------------------------------------------------------------
  const spireGeo = new THREE.ConeGeometry(1, 1, 6, 2);
  spireGeo.translate(0, 0.5, 0);
  const spireCount = 210;
  const spires = new THREE.InstancedMesh(spireGeo, rockMat, spireCount);
  let placed = 0;
  let guard = 0;
  while (placed < spireCount && guard++ < spireCount * 24) {
    const z = rng.range(WORLD.zMin + 200, WORLD.zMax - 200);
    const w = canyonHalfWidth(z);
    const side = rng.next() < 0.5 ? -1 : 1;
    const x = pathX(z) + side * rng.range(w * 0.35, w * 1.15);
    const y = heightAt(x, z);
    if (y > 260 || y < WORLD.waterLevel + 6) continue;
    const n = normalAt(x, z, 10);
    if (n.y < 0.72) continue;
    const h = rng.range(26, 120);
    const r = rng.range(6, 20);
    dummy.position.set(x, y - 3, z);
    dummy.rotation.set(rng.range(-0.09, 0.09), rng.range(0, 6.28), rng.range(-0.09, 0.09));
    dummy.scale.set(r, h, r);
    dummy.updateMatrix();
    spires.setMatrixAt(placed++, dummy.matrix);
  }
  spires.count = placed;
  spires.instanceMatrix.needsUpdate = true;
  group.add(spires);

  // --- Boulders -----------------------------------------------------------
  const boulderGeo = new THREE.IcosahedronGeometry(1, 0);
  const boulderCount = 420;
  const boulders = new THREE.InstancedMesh(boulderGeo, darkRockMat, boulderCount);
  placed = 0;
  guard = 0;
  while (placed < boulderCount && guard++ < boulderCount * 20) {
    const z = rng.range(WORLD.zMin + 100, WORLD.zMax - 100);
    const w = canyonHalfWidth(z);
    const x = pathX(z) + rng.range(-w * 1.2, w * 1.2);
    const y = heightAt(x, z);
    if (y < WORLD.waterLevel + 2 || y > 320) continue;
    const s = rng.range(3.5, 14);
    dummy.position.set(x, y - s * 0.25, z);
    dummy.rotation.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28));
    dummy.scale.set(s * rng.range(0.7, 1.3), s * rng.range(0.6, 1.1), s * rng.range(0.7, 1.3));
    dummy.updateMatrix();
    boulders.setMatrixAt(placed++, dummy.matrix);
  }
  boulders.count = placed;
  boulders.instanceMatrix.needsUpdate = true;
  group.add(boulders);

  // --- Pines --------------------------------------------------------------
  const pineGeo = new THREE.ConeGeometry(1, 1, 5, 1);
  pineGeo.translate(0, 0.5, 0);
  const pineMat = new THREE.MeshLambertMaterial({ color: 0x35502f, flatShading: true });
  const pineCount = 520;
  const pines = new THREE.InstancedMesh(pineGeo, pineMat, pineCount);
  placed = 0;
  guard = 0;
  while (placed < pineCount && guard++ < pineCount * 20) {
    const z = rng.range(WORLD.zMin + 100, WORLD.zMax - 100);
    const w = canyonHalfWidth(z);
    const x = pathX(z) + rng.range(-w * 1.4, w * 1.4);
    const y = heightAt(x, z);
    if (y < WORLD.waterLevel + 8 || y > 420) continue;
    const n = normalAt(x, z, 8);
    if (n.y < 0.82) continue;
    const h = rng.range(11, 26);
    dummy.position.set(x, y - 1, z);
    dummy.rotation.set(0, rng.range(0, 6.28), 0);
    dummy.scale.set(h * 0.28, h, h * 0.28);
    dummy.updateMatrix();
    pines.setMatrixAt(placed++, dummy.matrix);
  }
  pines.count = placed;
  pines.instanceMatrix.needsUpdate = true;
  group.add(pines);

  // --- Rock arches --------------------------------------------------------
  const arches: ArchInfo[] = [];
  const archZ = [-2450, -1180, 260, 1650, 2850];
  for (const z of archZ) {
    const w = canyonHalfWidth(z);
    const x = pathX(z);
    const radius = w * 0.95;
    const geo = new THREE.TorusGeometry(radius, radius * 0.13, 8, 22, Math.PI);
    const arch = new THREE.Mesh(geo, rockMat);
    arch.position.set(x, heightAt(x, z) - 12, z);
    arch.scale.y = 1.15;
    group.add(arch);
    arches.push({ position: new THREE.Vector3(x, arch.position.y + radius * 0.7, z), radius });
  }

  return { group, arches };
}
