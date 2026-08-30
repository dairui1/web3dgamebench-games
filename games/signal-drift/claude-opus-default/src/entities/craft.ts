import * as THREE from 'three';
import { approach, clamp, lerp } from '../core/rng';

/** The courier craft: procedural hull, animated bank/pitch and engine glow. */
export class Craft {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();

  private readonly hullMaterial: THREE.MeshStandardMaterial;
  private readonly trimMaterial: THREE.MeshStandardMaterial;
  private readonly engineMaterial: THREE.MeshBasicMaterial;
  private readonly glowSprites: THREE.Mesh[] = [];
  private readonly nozzles: THREE.Object3D[] = [];
  private readonly light: THREE.PointLight;

  private bank = 0;
  private pitch = 0;
  private hitFlash = 0;

  constructor() {
    this.hullMaterial = new THREE.MeshStandardMaterial({
      color: 0x8e9cb0,
      roughness: 0.38,
      metalness: 0.55,
      flatShading: true,
    });
    this.trimMaterial = new THREE.MeshStandardMaterial({
      color: 0x1b2733,
      roughness: 0.5,
      metalness: 0.5,
      emissive: 0x2fd9ff,
      emissiveIntensity: 1.0,
      flatShading: true,
    });
    this.engineMaterial = new THREE.MeshBasicMaterial({
      color: 0x9ff4ff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Fuselage: a lathed profile rotated so the nose points down -Z.
    const profile: THREE.Vector2[] = [
      new THREE.Vector2(0.02, 2.1),
      new THREE.Vector2(0.22, 1.5),
      new THREE.Vector2(0.44, 0.7),
      new THREE.Vector2(0.56, -0.1),
      new THREE.Vector2(0.5, -0.9),
      new THREE.Vector2(0.38, -1.4),
      new THREE.Vector2(0.02, -1.5),
    ];
    const fuselage = new THREE.Mesh(
      new THREE.LatheGeometry(profile, 7).rotateX(-Math.PI / 2),
      this.hullMaterial,
    );
    this.body.add(fuselage);

    // Wings: swept plates with glowing leading trim.
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 1.15), this.hullMaterial);
      wing.position.set(side * 1.15, -0.06, 0.15);
      wing.rotation.z = side * 0.16;
      wing.rotation.y = side * -0.34;
      this.body.add(wing);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.16), this.trimMaterial);
      trim.position.set(side * 1.16, 0.02, -0.32);
      trim.rotation.z = side * 0.16;
      trim.rotation.y = side * -0.34;
      this.body.add(trim);

      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 4), this.hullMaterial);
      tip.position.set(side * 2.0, 0.0, 0.0);
      tip.rotation.x = -Math.PI / 2;
      tip.rotation.z = side * 0.16;
      this.body.add(tip);
    }

    // Canopy.
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({
        color: 0x0a1c26,
        roughness: 0.12,
        metalness: 0.4,
        emissive: 0x1ea7c8,
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 0.85,
      }),
    );
    canopy.position.set(0, 0.28, -0.4);
    canopy.scale.set(1, 0.75, 1.6);
    this.body.add(canopy);

    // Dorsal fin.
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 1.0), this.hullMaterial);
    fin.position.set(0, 0.5, 0.85);
    fin.rotation.x = 0.22;
    this.body.add(fin);

    // Engines.
    for (const side of [-1, 1]) {
      const nacelle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.34, 1.5, 7).rotateX(Math.PI / 2),
        this.hullMaterial,
      );
      nacelle.position.set(side * 0.72, -0.05, 0.85);
      this.body.add(nacelle);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.3, 0.06, 5, 12),
        this.trimMaterial,
      );
      ring.position.set(side * 0.72, -0.05, 1.6);
      this.body.add(ring);

      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.24, 12), this.engineMaterial);
      glow.position.set(side * 0.72, -0.05, 1.66);
      glow.rotation.y = Math.PI;
      this.body.add(glow);
      this.glowSprites.push(glow);

      const nozzle = new THREE.Object3D();
      nozzle.position.set(side * 0.72, -0.05, 1.8);
      this.body.add(nozzle);
      this.nozzles.push(nozzle);
    }

    // Sits behind the engines so it rims the corridor rather than blowing
    // out the hull panels a few centimetres away.
    this.light = new THREE.PointLight(0x7fe6ff, 7, 44, 2);
    this.light.position.set(0, 0.4, 3.4);
    this.body.add(this.light);

    this.root.add(this.body);
    this.root.scale.setScalar(1.45);
  }

  get nozzleCount(): number {
    return this.nozzles.length;
  }

  nozzleWorld(index: number, out: THREE.Vector3): THREE.Vector3 {
    return this.nozzles[index].getWorldPosition(out);
  }

  flashHit(): void {
    this.hitFlash = 1;
  }

  update(dt: number, elapsed: number, steer: number, climb: number, thrust: number, danger: number): void {
    const k = approach(9, dt);
    this.bank = lerp(this.bank, clamp(-steer, -1, 1) * 0.78, k);
    this.pitch = lerp(this.pitch, clamp(climb, -1, 1) * 0.28, k);
    this.body.rotation.z = this.bank;
    this.body.rotation.x = -this.pitch + Math.sin(elapsed * 2.1) * 0.015;
    this.body.rotation.y = this.bank * -0.16;
    this.body.position.y = Math.sin(elapsed * 1.7) * 0.06;

    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    const pulse = 0.85 + Math.sin(elapsed * 22) * 0.12;
    const glowScale = (0.6 + thrust * 0.8) * pulse;
    for (const g of this.glowSprites) {
      g.scale.setScalar(glowScale);
    }
    this.engineMaterial.opacity = 0.16 + thrust * 0.24;

    const warn = Math.max(danger, this.hitFlash);
    this.trimMaterial.emissive.setRGB(0.18 + warn * 1.6, 0.85 - warn * 0.7, 1.0 - warn * 0.8);
    this.trimMaterial.emissiveIntensity = 0.55 + thrust * 0.45 + this.hitFlash * 1.6;
    this.hullMaterial.emissive.setRGB(this.hitFlash * 0.5, 0, 0);
    this.hullMaterial.emissiveIntensity = this.hitFlash;
    this.light.color.setRGB(0.5 + warn * 0.5, 0.9 - warn * 0.6, 1.0 - warn * 0.7);
    this.light.intensity = 6 + thrust * 7 + this.hitFlash * 18;
  }
}
