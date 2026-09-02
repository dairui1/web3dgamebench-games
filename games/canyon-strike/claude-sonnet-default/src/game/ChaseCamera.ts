import * as THREE from 'three';
import { damp, lerp } from './utils.ts';
import type { Aircraft } from './Aircraft.ts';

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private currentPos = new THREE.Vector3();
  private currentLook = new THREE.Vector3();
  private initialized = false;
  private shake = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.5, 6000);
  }

  addShake(amount: number) {
    this.shake = Math.min(this.shake + amount, 1.5);
  }

  update(dt: number, aircraft: Aircraft, speedRatio: number) {
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(aircraft.object.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(aircraft.object.quaternion);

    const distance = lerp(11, 16, speedRatio);
    const height = lerp(3.2, 4, speedRatio);
    const desiredPos = aircraft.position
      .clone()
      .addScaledVector(back, distance)
      .addScaledVector(up, height);

    const desiredLook = aircraft.position.clone().addScaledVector(back, -14);

    if (!this.initialized) {
      this.currentPos.copy(desiredPos);
      this.currentLook.copy(desiredLook);
      this.initialized = true;
    } else {
      const lambda = lerp(5, 3.2, speedRatio);
      this.currentPos.x = damp(this.currentPos.x, desiredPos.x, lambda, dt);
      this.currentPos.y = damp(this.currentPos.y, desiredPos.y, lambda, dt);
      this.currentPos.z = damp(this.currentPos.z, desiredPos.z, lambda, dt);
      this.currentLook.x = damp(this.currentLook.x, desiredLook.x, 8, dt);
      this.currentLook.y = damp(this.currentLook.y, desiredLook.y, 8, dt);
      this.currentLook.z = damp(this.currentLook.z, desiredLook.z, 8, dt);
    }

    let shakeOffset = new THREE.Vector3();
    if (this.shake > 0) {
      shakeOffset = new THREE.Vector3(
        (Math.random() - 0.5) * this.shake,
        (Math.random() - 0.5) * this.shake,
        (Math.random() - 0.5) * this.shake,
      );
      this.shake = Math.max(0, this.shake - dt * 3);
    }

    this.camera.position.copy(this.currentPos).add(shakeOffset);
    this.camera.up.copy(up);
    this.camera.lookAt(this.currentLook);
    this.camera.fov = lerp(58, 70, speedRatio);
    this.camera.updateProjectionMatrix();
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
