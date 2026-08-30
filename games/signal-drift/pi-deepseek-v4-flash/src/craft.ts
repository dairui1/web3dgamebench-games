import * as THREE from 'three';
import { makeGlowTexture } from './textures';

export interface CraftRenderState {
  roll: number;
  pitch: number;
  yaw: number;
  speedFrac: number;
  boost: boolean;
  invulnFlash: boolean;
}

/** Compact courier craft built from primitives. Nose points toward -Z. */
export class Craft {
  readonly group = new THREE.Group();
  private engineMat: THREE.MeshStandardMaterial;
  private noseMat: THREE.MeshStandardMaterial;
  private underGlow: THREE.Sprite;
  private tailGlow: THREE.Sprite;
  private glowTex: THREE.Texture;

  constructor() {
    this.glowTex = makeGlowTexture();

    const body = new THREE.MeshStandardMaterial({
      color: 0x2c3a4d,
      metalness: 0.72,
      roughness: 0.38,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: 0x0d1a24,
      emissive: 0x39d9c8,
      emissiveIntensity: 1.4,
      metalness: 0.4,
      roughness: 0.5,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x141b26,
      metalness: 0.8,
      roughness: 0.3,
    });
    const canopy = new THREE.MeshStandardMaterial({
      color: 0x9fd8ff,
      emissive: 0x1d3550,
      emissiveIntensity: 0.8,
      metalness: 0.9,
      roughness: 0.15,
    });

    // fuselage
    const fuse = new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 1.9, 5, 14), body);
    fuse.rotation.x = Math.PI / 2;
    fuse.position.z = 0.1;
    this.group.add(fuse);

    // nose cone
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.95, 16), body);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -1.35;
    this.group.add(nose);

    // cockpit canopy
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), canopy);
    glass.scale.set(1.15, 0.72, 1.7);
    glass.position.set(0, 0.42, -0.25);
    this.group.add(glass);

    // wings
    const wingGeo = new THREE.BoxGeometry(2.9, 0.1, 1.15);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(wingGeo, body);
      wing.position.set(s * 1.25, -0.05, 0.05);
      wing.rotation.y = s * 0.24;
      wing.rotation.z = s * -0.06;
      this.group.add(wing);

      // wingtip lights
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.5), accent);
      tip.position.set(s * 2.62, -0.02, 0.3);
      tip.rotation.y = s * -0.12;
      this.group.add(tip);

      // forward strake
      const strake = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 1.9), dark);
      strake.position.set(s * 0.62, 0.12, -0.6);
      strake.rotation.z = s * -0.12;
      this.group.add(strake);
    }

    // tail fin
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.85), body);
    fin.position.set(0, 0.42, 1.32);
    fin.rotation.x = -0.16;
    this.group.add(fin);
    const finTip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.5), accent);
    finTip.position.set(0, 0.96, 1.3);
    this.group.add(finTip);

    // horizontal stabs
    for (const s of [-1, 1]) {
      const stab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.6), dark);
      stab.position.set(s * 0.98, 0.12, 1.28);
      stab.rotation.z = s * -0.1;
      this.group.add(stab);
    }

    // engines
    this.engineMat = new THREE.MeshStandardMaterial({
      color: 0x0a1018,
      emissive: 0x7fe8ff,
      emissiveIntensity: 2.2,
    });
    for (const s of [-1, 1]) {
      const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.95, 14), dark);
      nac.rotation.x = Math.PI / 2;
      nac.position.set(s * 0.52, 0.05, 1.52);
      this.group.add(nac);
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.24, 0.3, 12), this.engineMat);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(s * 0.52, 0.05, 2.02);
      this.group.add(nozzle);
    }

    // nose lamp
    this.noseMat = new THREE.MeshStandardMaterial({
      color: 0x0a1018,
      emissive: 0xffd9a0,
      emissiveIntensity: 2.0,
    });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), this.noseMat);
    lamp.position.set(0, 0.05, -1.7);
    this.group.add(lamp);

    // under glow aura
    this.underGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTex,
        color: 0x39d9c8,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.underGlow.scale.set(3.2, 3.2, 1);
    this.underGlow.position.set(0, -0.4, 0);
    this.group.add(this.underGlow);

    // tail glow (engine wash)
    this.tailGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTex,
        color: 0x9ff2ff,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.tailGlow.scale.set(0.8, 2.4, 1);
    this.tailGlow.position.set(0, 0.05, 2.5);
    this.group.add(this.tailGlow);
  }

  /** Apply smoothed pose from game state + animate emissives. */
  update(dt: number, t: number, st: CraftRenderState): void {
    // pose smoothing
    this.group.rotation.x += (st.pitch - this.group.rotation.x) * Math.min(1, dt * 7);
    this.group.rotation.y += (st.yaw - this.group.rotation.y) * Math.min(1, dt * 7);
    this.group.rotation.z += (st.roll - this.group.rotation.z) * Math.min(1, dt * 7);

    // idle turbulence grows with speed
    const turb = 0.015 + st.speedFrac * 0.035;
    this.group.rotation.z += Math.sin(t * 3.1) * turb * 0.5;
    this.group.rotation.x += Math.cos(t * 2.6) * turb * 0.4;

    const engine = 1.6 + st.speedFrac * 1.4 + (st.boost ? 2.4 : 0);
    this.engineMat.emissiveIntensity = engine;
    this.noseMat.emissiveIntensity = 1.2 + st.speedFrac * 1.2;
    this.underGlow.material.opacity = 0.34 + st.speedFrac * 0.3 + (st.boost ? 0.2 : 0);
    const tl = 0.35 + st.speedFrac * 0.4 + (st.boost ? 0.5 : 0) + Math.sin(t * 42) * 0.08;
    this.tailGlow.material.opacity = tl;

    // invulnerability blink — hide ship briefly
    this.group.visible = !st.invulnFlash || Math.floor(t * 22) % 2 === 0;
  }

  dispose(): void {
    this.glowTex.dispose();
  }
}