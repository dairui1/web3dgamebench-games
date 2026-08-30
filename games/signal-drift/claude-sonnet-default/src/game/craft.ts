import * as THREE from 'three';

export interface Craft {
  group: THREE.Group;
  leftFlame: THREE.Mesh;
  rightFlame: THREE.Mesh;
  engineLight: THREE.PointLight;
}

/**
 * Local -Z is "forward" (matches the lookAt-based orientation used in Game),
 * so nose geometry sits at negative Z and the engine/tail sits at positive Z.
 */
export function buildCraft(): Craft {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0xd8dee8,
    metalness: 0.75,
    roughness: 0.28,
    emissive: 0x0a1522,
    emissiveIntensity: 0.4,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x28e0ff,
    emissive: 0x1fb8e8,
    emissiveIntensity: 1.1,
    metalness: 0.2,
    roughness: 0.3,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1f27, metalness: 0.6, roughness: 0.5 });

  const hull = new THREE.Mesh(new THREE.ConeGeometry(0.85, 3.2, 8), hullMat);
  hull.rotation.x = -Math.PI / 2;
  hull.position.z = -0.2;
  group.add(hull);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10, 0, Math.PI * 2, 0, Math.PI / 1.6), accentMat);
  canopy.position.set(0, 0.35, -0.35);
  canopy.rotation.x = -0.15;
  group.add(canopy);

  const wingGeo = new THREE.BoxGeometry(2.6, 0.08, 1.15);
  const wingL = new THREE.Mesh(wingGeo, hullMat);
  wingL.position.set(-1.5, -0.05, 0.05);
  wingL.rotation.z = 0.12;
  const wingR = wingL.clone();
  wingR.position.x = 1.5;
  wingR.rotation.z = -0.12;
  group.add(wingL, wingR);

  const finGeo = new THREE.BoxGeometry(0.7, 0.06, 0.65);
  const finL = new THREE.Mesh(finGeo, accentMat);
  finL.position.set(-1.55, -0.02, 0.6);
  const finR = finL.clone();
  finR.position.x = 1.55;
  group.add(finL, finR);

  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.9), darkMat);
  tailFin.position.set(0, 0.35, 1.15);
  group.add(tailFin);

  const flameGeo = new THREE.ConeGeometry(0.2, 0.75, 8);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x5be8ff, transparent: true, opacity: 0.75 });
  const leftFlame = new THREE.Mesh(flameGeo, flameMat);
  leftFlame.rotation.x = Math.PI / 2;
  leftFlame.position.set(-1.5, -0.05, 0.75);
  const rightFlame = leftFlame.clone();
  rightFlame.position.x = 1.5;
  group.add(leftFlame, rightFlame);

  const engineLight = new THREE.PointLight(0x38d6ff, 1.4, 9, 2);
  engineLight.position.set(0, 0, 1.2);
  group.add(engineLight);

  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });

  return { group, leftFlame, rightFlame, engineLight };
}
