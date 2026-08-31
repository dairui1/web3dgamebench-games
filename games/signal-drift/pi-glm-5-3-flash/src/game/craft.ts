import * as THREE from 'three';
import { FLIGHT, PALETTE } from '../config';
import { clamp, damp, lerp } from '../core/mathutil';
import { getGlowTexture } from './textures';

export interface SteerInput {
  x: number;
  y: number;
  boost: boolean;
}

const FORWARD = new THREE.Vector3();

/** The courier craft: procedural model + arcade flight model. */
export class Craft {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  heading = 0;
  pitch = 0;
  bank = 0;
  speed = FLIGHT.baseSpeed;
  boostAmount = 0;

  private steerS = { x: 0, y: 0 };
  private model = new THREE.Group();
  private engineGlows: THREE.Sprite[] = [];
  private engineMats: THREE.SpriteMaterial[] = [];
  private engineLight: THREE.PointLight;
  private falloff = 0;
  private tumbleAxis = new THREE.Vector3(1, 0.4, 0.8).normalize();
  private tumbleAngle = 0;
  falling = false;
  fallVel = 0;

  constructor() {
    this.buildModel();
    this.group.add(this.model);

    this.engineLight = new THREE.PointLight(PALETTE.cyan, 12, 42, 1.9);
    this.engineLight.position.set(0, 0.2, 2.4);
    this.model.add(this.engineLight);
  }

  private buildModel(): void {
    const hullMat = new THREE.MeshStandardMaterial({ color: PALETTE.hull, metalness: 0.72, roughness: 0.36 });
    const darkMat = new THREE.MeshStandardMaterial({ color: PALETTE.hullDark, metalness: 0.7, roughness: 0.5 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x24343a,
      emissive: PALETTE.cyan,
      emissiveIntensity: 1.4,
      metalness: 0.4,
      roughness: 0.4,
    });

    // hexagonal fuselage, nose toward -z
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.8, 3.6, 6), hullMat);
    body.rotation.x = -Math.PI / 2;
    this.model.add(body);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.52, 1.7, 6), hullMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -2.65;
    this.model.add(nose);

    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.52, 0.9, 6), darkMat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.z = 2.2;
    this.model.add(tail);

    // canopy
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 10, 8),
      new THREE.MeshStandardMaterial({
        color: 0x0d2b33,
        emissive: 0x2ba8c4,
        emissiveIntensity: 0.8,
        metalness: 0.1,
        roughness: 0.15,
      }),
    );
    canopy.scale.set(1, 0.72, 1.7);
    canopy.position.set(0, 0.42, -0.55);
    this.model.add(canopy);

    // swept wings
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, -1.4);
    wingShape.lineTo(2.9, 0.9);
    wingShape.lineTo(2.9, 1.5);
    wingShape.lineTo(0, 1.7);
    wingShape.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.14, bevelEnabled: false });
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(wingGeo, hullMat);
      wing.rotation.x = -Math.PI / 2;
      wing.scale.x = side;
      wing.position.set(side * 0.55, -0.05, 0.35);
      wing.rotation.z = side * -0.08;
      this.model.add(wing);
      // wingtip lights
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.8), accentMat);
      tip.position.set(side * 3.35, 0.02, 1.15);
      this.model.add(tip);
    }

    // tail fin
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.25, 1.15), hullMat);
    fin.position.set(0, 0.62, 2.05);
    fin.rotation.x = 0.28;
    this.model.add(fin);
    const finLight = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.3), accentMat);
    finLight.position.set(0, 1.22, 2.28);
    this.model.add(finLight);

    // twin engines with glow discs
    const glowTex = getGlowTexture();
    for (const side of [-1, 1]) {
      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 1.15, 8), darkMat);
      nacelle.rotation.x = -Math.PI / 2;
      nacelle.position.set(side * 0.62, -0.08, 2.55);
      this.model.add(nacelle);

      const mat = new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(PALETTE.cyan).multiplyScalar(1.5),
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const glow = new THREE.Sprite(mat);
      glow.position.set(side * 0.62, -0.08, 3.2);
      glow.scale.set(1.6, 1.6, 1);
      this.model.add(glow);
      this.engineGlows.push(glow);
      this.engineMats.push(mat);
    }

    // belly stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 2.6), accentMat);
    stripe.position.set(0, -0.62, -0.4);
    this.model.add(stripe);
  }

  reset(pos: THREE.Vector3, heading: number): void {
    this.pos.copy(pos);
    this.heading = heading;
    this.pitch = 0;
    this.bank = 0;
    this.speed = FLIGHT.baseSpeed;
    this.boostAmount = 0;
    this.steerS.x = 0;
    this.steerS.y = 0;
    this.falling = false;
    this.fallVel = 0;
    this.falloff = 0;
    this.tumbleAngle = 0;
    this.model.rotation.set(0, 0, 0);
    this.model.position.set(0, 0, 0);
    this.model.visible = true;
    this.group.visible = true;
    this.syncTransform();
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    out.set(-Math.sin(this.heading) * cp, Math.sin(this.pitch), -Math.cos(this.heading) * cp);
    return out;
  }

  /** Per-frame flight integration. */
  update(dt: number, input: SteerInput, time: number): void {
    if (this.falling) {
      this.updateFalling(dt);
      return;
    }

    this.steerS.x = damp(this.steerS.x, input.x, FLIGHT.steerLerp, dt);
    this.steerS.y = damp(this.steerS.y, input.y, FLIGHT.steerLerp, dt);

    this.heading -= this.steerS.x * FLIGHT.yawRate * dt;
    this.pitch = clamp(this.pitch + this.steerS.y * FLIGHT.pitchRate * dt, -FLIGHT.maxPitch, FLIGHT.maxPitch);
    // gentle auto-level when hands off the stick
    if (Math.abs(input.y) < 0.05) this.pitch = damp(this.pitch, 0, 0.55, dt);

    this.boostAmount = damp(this.boostAmount, input.boost ? 1 : 0, 5, dt);
    const targetSpeed = lerp(FLIGHT.baseSpeed, FLIGHT.boostSpeed, this.boostAmount);
    this.speed = damp(this.speed, targetSpeed, FLIGHT.accel / 20, dt);

    this.forward(FORWARD);
    this.pos.addScaledVector(FORWARD, this.speed * dt);

    this.bank = damp(this.bank, -this.steerS.x * FLIGHT.bankMax, 5.5, dt);
    this.syncTransform();

    // engine glow feedback
    const flicker = 0.9 + 0.1 * Math.sin(time * 31);
    for (let i = 0; i < this.engineGlows.length; i++) {
      const s = 0.95 + this.boostAmount * 0.85 + 0.1 * Math.sin(time * 23 + i * 2);
      this.engineGlows[i].scale.set(s, s, 1);
      this.engineMats[i].opacity = (0.5 + this.boostAmount * 0.35) * flicker;
    }
    this.engineLight.intensity = 9 + this.boostAmount * 9;
  }

  private syncTransform(): void {
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.heading, this.bank, 'YXZ');
    // subtle idle bob
    this.model.position.y = Math.sin(performance.now() * 0.0016) * 0.08;
  }

  /** Knockback from a hazard hit. */
  knock(pushDir: THREE.Vector3, strength: number): void {
    this.pos.addScaledVector(pushDir, strength);
    this.pitch = clamp(this.pitch + (Math.random() - 0.5) * 0.5, -FLIGHT.maxPitch, FLIGHT.maxPitch);
    this.heading += (Math.random() - 0.5) * 0.24;
    this.falloff = 1;
  }

  startFalling(): void {
    this.falling = true;
    this.fallVel = 4;
  }

  private updateFalling(dt: number): void {
    this.fallVel += 14 * dt;
    this.pos.y -= this.fallVel * dt;
    this.pos.addScaledVector(this.forward(FORWARD), this.speed * 0.3 * dt);
    this.tumbleAngle += dt * 2.4;
    this.model.setRotationFromAxisAngle(this.tumbleAxis, this.tumbleAngle);
    this.group.position.copy(this.pos);
    for (const g of this.engineGlows) g.scale.setScalar(0.4);
    this.engineLight.intensity = 4;
  }

  hide(): void {
    this.group.visible = false;
  }
}
