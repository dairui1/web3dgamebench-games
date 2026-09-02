import * as THREE from 'three';
import { randRange } from './utils.ts';

interface ExplosionInstance {
  points: THREE.Points;
  velocities: Float32Array;
  age: number;
  life: number;
  light: THREE.PointLight;
}

export class ExplosionSystem {
  private scene: THREE.Scene;
  private active: ExplosionInstance[] = [];
  private geoCache = new THREE.SphereGeometry(1, 4, 4);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  spawn(position: THREE.Vector3, scale = 1, colorA = 0xffb347, colorB = 0x3a2a1a) {
    const count = Math.floor(18 * scale) + 8;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const cA = new THREE.Color(colorA);
    const cB = new THREE.Color(colorB);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;
      const speed = randRange(6, 22) * scale;
      const theta = randRange(0, Math.PI * 2);
      const phi = randRange(0, Math.PI);
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i * 3 + 1] = Math.cos(phi) * speed + randRange(2, 6);
      velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
      const c = cA.clone().lerp(cB, Math.random());
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.4 * scale,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    const light = new THREE.PointLight(0xff9a44, 6 * scale, 80 * scale, 2);
    light.position.copy(position);
    this.scene.add(light);

    this.active.push({ points, velocities, age: 0, life: 0.9 + 0.4 * scale, light });
  }

  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const inst = this.active[i];
      inst.age += dt;
      const t = inst.age / inst.life;
      if (t >= 1) {
        this.scene.remove(inst.points);
        this.scene.remove(inst.light);
        inst.points.geometry.dispose();
        (inst.points.material as THREE.Material).dispose();
        this.active.splice(i, 1);
        continue;
      }
      const pos = inst.points.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let p = 0; p < arr.length / 3; p++) {
        arr[p * 3] += inst.velocities[p * 3] * dt;
        arr[p * 3 + 1] += (inst.velocities[p * 3 + 1] - 14 * inst.age) * dt;
        arr[p * 3 + 2] += inst.velocities[p * 3 + 2] * dt;
      }
      pos.needsUpdate = true;
      (inst.points.material as THREE.PointsMaterial).opacity = 1 - t;
      inst.light.intensity = (1 - t) * 6;
    }
  }
}
