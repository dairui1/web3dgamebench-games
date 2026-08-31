import * as THREE from 'three';
import { PALETTE, TUNING } from './config';
import { clamp, damp, makeSoftSprite } from './util';

const HULL = new THREE.MeshStandardMaterial({
  color: 0xe7eef2,
  roughness: 0.42,
  metalness: 0.55,
});
const PANEL = new THREE.MeshStandardMaterial({
  color: 0x2c3844,
  roughness: 0.55,
  metalness: 0.75,
});
const ACCENT = new THREE.MeshStandardMaterial({
  color: 0x08141a,
  emissive: new THREE.Color(PALETTE.cyan),
  emissiveIntensity: 3.2,
  roughness: 0.3,
  metalness: 0.2,
});
const AMBER = new THREE.MeshStandardMaterial({
  color: 0x1a1206,
  emissive: new THREE.Color(PALETTE.amber),
  emissiveIntensity: 2.6,
  roughness: 0.35,
  metalness: 0.2,
});
const GLASS = new THREE.MeshStandardMaterial({
  color: 0x0a2733,
  emissive: new THREE.Color(0x0e3a4a),
  emissiveIntensity: 0.9,
  roughness: 0.08,
  metalness: 1,
});

/** Procedural courier ship. Local forward is -Z, up is +Y. */
export class Craft {
  readonly group = new THREE.Group();
  readonly engineGroup = new THREE.Group();
  readonly plumes: THREE.Mesh[] = [];
  private plumeMats: THREE.ShaderMaterial[] = [];
  private hullMeshes: THREE.Mesh[] = [];
  private navLights: THREE.Mesh[] = [];
  private trailPos: Float32Array;
  private trailAlpha: Float32Array;
  private trailGeo: THREE.BufferGeometry;
  private trail: THREE.Points;
  private trailIndex = 0;
  private trailTimer = 0;
  private shieldMesh: THREE.Mesh;
  private shieldMat: THREE.MeshBasicMaterial;
  readonly shieldBubble = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor() {
    // --- hull -------------------------------------------------------------
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.32, 3.1, 6, 14), HULL);
    body.rotation.x = Math.PI / 2;
    this.group.add(body);
    this.hullMeshes.push(body);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.32, 2.9, 14), HULL);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -3.2;
    this.group.add(nose);
    this.hullMeshes.push(nose);

    const spine = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 4.6), PANEL);
    spine.position.set(0, 1.05, 0.1);
    this.group.add(spine);

    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), GLASS);
    canopy.position.set(0, 0.78, -1.0);
    canopy.scale.set(0.82, 0.7, 1.5);
    this.group.add(canopy);

    const beak = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 1.4), ACCENT);
    beak.position.set(0, -0.15, -3.6);
    this.group.add(beak);

    // --- wings ------------------------------------------------------------
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.3, 2.1), HULL);
      wing.position.set(side * 3.0, -0.05, 0.8);
      wing.rotation.z = side * 0.1;
      wing.rotation.y = side * -0.22;
      this.group.add(wing);
      this.hullMeshes.push(wing);

      const leadingEdge = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.16, 0.5), PANEL);
      leadingEdge.position.set(side * 3.0, 0.02, -0.25);
      leadingEdge.rotation.z = side * 0.1;
      this.group.add(leadingEdge);

      const strip = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 0.22), ACCENT);
      strip.position.set(side * 3.3, 0.16, 0.6);
      strip.rotation.z = side * 0.1;
      this.group.add(strip);

      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.9, 4, 10), PANEL);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(side * 4.75, -0.32, 0.9);
      this.group.add(pod);

      const nav = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 6),
        side < 0
          ? new THREE.MeshStandardMaterial({ color: 0x200408, emissive: PALETTE.magenta, emissiveIntensity: 4 })
          : new THREE.MeshStandardMaterial({ color: 0x04200c, emissive: PALETTE.green, emissiveIntensity: 4 }),
      );
      nav.position.set(side * 5.3, -0.2, 0.6);
      this.group.add(nav);
      this.navLights.push(nav);

      // --- nacelles & plumes ---
      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 1.0, 3.4, 12), PANEL);
      nacelle.rotation.x = Math.PI / 2;
      nacelle.position.set(side * 2.15, -0.28, 2.35);
      this.group.add(nacelle);
      this.hullMeshes.push(nacelle);

      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.12, 6, 16), AMBER);
      rim.position.set(side * 2.15, -0.28, 4.0);
      this.group.add(rim);

      const plumeMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uLevel: { value: 0.4 },
          uCore: { value: new THREE.Color(PALETTE.ice) },
          uFlame: { value: new THREE.Color(PALETTE.cyan) },
          uTime: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          uniform float uLevel;
          uniform vec3 uCore;
          uniform vec3 uFlame;
          uniform float uTime;
          void main() {
            float t = vUv.y;                       // 0 at nozzle, 1 at tail
            float radial = smoothstep(1.0, 0.15, abs(vUv.x - 0.5) * 2.0);
            float flick = 0.85 + 0.15 * sin(uTime * 42.0 + t * 9.0);
            float body = pow(1.0 - t, 2.0) * radial * flick;
            vec3 col = mix(uCore, uFlame, t);
            gl_FragColor = vec4(col * (0.6 + 1.5 * uLevel), body * (0.25 + 1.1 * uLevel));
          }
        `,
      });
      const plume = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.95, 7.5, 12, 1, true), plumeMat);
      plume.rotation.x = -Math.PI / 2;
      plume.position.set(side * 2.15, -0.28, 7.2);
      this.group.add(plume);
      this.plumes.push(plume);
      this.plumeMats.push(plumeMat);
    }

    // --- tail -------------------------------------------------------------
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.2, 1.8), HULL);
    fin.position.set(0, 1.35, 2.4);
    fin.rotation.x = -0.25;
    this.group.add(fin);
    for (const side of [-1, 1]) {
      const stabiliser = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 1.2), PANEL);
      stabiliser.position.set(side * 1.15, 0.55, 3.1);
      this.group.add(stabiliser);
    }

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 4), PANEL);
    antenna.position.set(0, 1.9, 1.4);
    this.group.add(antenna);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), AMBER);
    beacon.position.set(0, 3.1, 1.4);
    this.group.add(beacon);
    this.navLights.push(beacon);

    for (const side of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 3.2), PANEL);
      skid.position.set(side * 1.6, -1.5, 0.6);
      this.group.add(skid);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 3.6), PANEL);
      foot.position.set(side * 1.6, -2.05, 0.6);
      this.group.add(foot);
    }

    // --- shield bubble (impact / danger feedback) -------------------------
    this.shieldMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.cyan),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    this.shieldMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(6.4, 1), this.shieldMat);
    this.group.add(this.shieldMesh);

    // --- engine trail -----------------------------------------------------
    const count = 96;
    this.trailPos = new Float32Array(count * 3);
    this.trailAlpha = new Float32Array(count);
    for (let i = 0; i < count; i += 1) this.trailPos[i * 3 + 1] = -9999;
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.trailAlpha, 1));
    this.trail = new THREE.Points(
      this.trailGeo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uMap: { value: makeSoftSprite(64, 2.6) },
          uColor: { value: new THREE.Color(PALETTE.cyan) },
          uPixelRatio: { value: 1 },
        },
        vertexShader: /* glsl */ `
          attribute float aAlpha;
          varying float vAlpha;
          uniform float uPixelRatio;
          void main() {
            vAlpha = aAlpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = (2.0 + 12.0 * aAlpha) * uPixelRatio * (34.0 / max(1.0, -mv.z));
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vAlpha;
          uniform sampler2D uMap;
          uniform vec3 uColor;
          void main() {
            if (vAlpha <= 0.001) discard;
            float m = texture2D(uMap, gl_PointCoord).a;
            gl_FragColor = vec4(uColor * (1.4 + vAlpha), m * vAlpha * 0.5);
          }
        `,
      }),
    );
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 3;
  }

  getForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.group.quaternion);
  }

  getRight(out: THREE.Vector3): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.group.quaternion);
  }

  get right(): THREE.Vector3 {
    return this.tmp.set(1, 0, 0).applyQuaternion(this.group.quaternion);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  setPixelRatio(ratio: number): void {
    (this.trail.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value = ratio;
  }

  flashShield(strength: number, color: number): void {
    this.shieldMat.color.setHex(color);
    this.shieldMat.opacity = clamp(strength, 0, 1);
  }

  update(dt: number, time: number, throttle01: number, boosting: boolean, speed: number): void {
    this.group.updateMatrixWorld();
    const level = clamp(throttle01 * (boosting ? 1.5 : 1), 0.08, 1.4);
    for (const mat of this.plumeMats) {
      mat.uniforms.uLevel.value = level;
      mat.uniforms.uTime.value = time;
    }
    for (let i = 0; i < this.plumes.length; i += 1) {
      const plume = this.plumes[i];
      const len = 0.5 + level * (boosting ? 2.3 : 1.5) + Math.sin(time * 22 + i) * 0.06;
      plume.scale.set(0.75 + level * 0.4, len, 0.75 + level * 0.4);
    }
    this.shieldMat.opacity = Math.max(0, this.shieldMat.opacity - dt * 2.6);
    this.shieldMesh.rotation.y += dt * 0.6;

    // Blinking nav beacon.
    const blink = Math.sin(time * 5.5) > 0.4 ? 4.4 : 0.4;
    (this.navLights[2].material as THREE.MeshStandardMaterial).emissiveIntensity = blink;

    // Trail puffs from each nacelle.
    this.trailTimer += dt;
    const interval = clamp(0.05 - speed * 0.0004, 0.012, 0.05);
    while (this.trailTimer > interval) {
      this.trailTimer -= interval;
      for (const side of [-1, 1]) {
        this.tmp.set(side * 2.15, -0.28, 4.6).applyMatrix4(this.group.matrixWorld);
        const i = this.trailIndex % (this.trailPos.length / 3);
        this.trailPos[i * 3] = this.tmp.x;
        this.trailPos[i * 3 + 1] = this.tmp.y;
        this.trailPos[i * 3 + 2] = this.tmp.z;
        this.trailAlpha[i] = clamp(0.35 + level * 0.6, 0, 1);
        this.trailIndex += 1;
      }
    }
    for (let i = 0; i < this.trailAlpha.length; i += 1) {
      if (this.trailAlpha[i] > 0) this.trailAlpha[i] = Math.max(0, this.trailAlpha[i] - dt * 1.5);
    }
    (this.trailGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.trailGeo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  setDamageTint(t: number): void {
    const tint = 1 - clamp(t, 0, 0.8);
    HULL.color.setRGB(tint, tint * 1.0, tint * 1.02);
  }
}
/** Chase camera with spring lag, speed FOV, banking and impact shake. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private smoothedPos = new THREE.Vector3();
  private smoothedLook = new THREE.Vector3();
  private heading = new THREE.Quaternion();
  private targetQuat = new THREE.Quaternion();
  private dummy = new THREE.Object3D();
  private shake = 0;
  private shakeTime = 0;
  private offset = new THREE.Vector3();
  private desiredPos = new THREE.Vector3();
  private lookAhead = new THREE.Vector3();
  private roll = 0;
  private fov = TUNING.camera.fovBase;
  private initialized = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.fov, aspect, 0.6, 4200);
    this.dummy.up.set(0, 1, 0);
  }

  addShake(amount: number): void {
    this.shake = Math.min(2.6, this.shake + amount);
  }

  reset(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.smoothedPos.copy(pos);
    this.heading.copy(quat);
    this.roll = 0;
    this.shake = 0;
    this.initialized = false;
    this.updatePosition(0, pos, quat, 0, 0, 0, 0);
    this.smoothedLook.copy(this.lookAhead);
    this.initialized = true;
  }

  resize(aspect: number, w: number, h: number): void {
    this.camera.aspect = aspect;
    this.camera.near = w < 700 ? 1.6 : 0.9;
    this.camera.updateProjectionMatrix();
  }

  update(
    dt: number,
    craftPos: THREE.Vector3,
    craftQuat: THREE.Quaternion,
    speed: number,
    turnRate: number,
    boosting: boolean,
    time: number,
  ): void {
    this.updatePosition(dt, craftPos, craftQuat, speed, turnRate, boosting ? 1 : 0, time);
    if (boosting) this.addShake(dt * 0.55);
    this.applyShake(dt, time);
  }

  private updatePosition(
    dt: number,
    craftPos: THREE.Vector3,
    craftQuat: THREE.Quaternion,
    speed: number,
    turnRate: number,
    boost: number,
    time: number,
  ): void {
    const speed01 = clamp((speed - TUNING.flight.minSpeed) / (TUNING.flight.boostSpeed - TUNING.flight.minSpeed), 0, 1);

    // Roll-free heading so the horizon does not whip around with the ship.
    const fwd = this.tmpVecA.set(0, 0, -1).applyQuaternion(craftQuat);
    const upHint = this.tmpVecB.set(0, 1, 0).applyQuaternion(craftQuat);
    const right = this.tmpRight.crossVectors(fwd, upHint).normalize();
    const up = this.tmpUp.crossVectors(right, fwd).normalize();
    this.tmpBack.copy(fwd).negate();
    this.tmpBasis.makeBasis(right, up, this.tmpBack);
    this.targetQuat.setFromRotationMatrix(this.tmpBasis);
    if (!this.initialized) this.heading.copy(this.targetQuat);
    this.heading.slerp(this.targetQuat, clamp(dt * 9, 0, 1));

    this.smoothedPos.lerp(craftPos, clamp(dt * TUNING.camera.lag, 0, 1));

    const dist = TUNING.camera.distance - speed01 * 3.6;
    const height = TUNING.camera.height + speed01 * 1.2;
    this.offset.set(0, height, dist).applyQuaternion(this.heading);
    this.desiredPos.copy(this.smoothedPos).add(this.offset);
    this.camera.position.lerp(this.desiredPos, this.initialized ? clamp(dt * 14, 0, 1) : 1);

    this.lookAhead
      .copy(this.smoothedPos)
      .addScaledVector(fwd, 22 + speed01 * 16)
      .addScaledVector(upHint, 1.4);
    if (!this.initialized) this.smoothedLook.copy(this.lookAhead);
    this.smoothedLook.lerp(this.lookAhead, clamp(dt * TUNING.camera.lookLag, 0, 1));

    this.roll = damp(this.roll, -turnRate * 0.42 - speed01 * 0.05, 5, dt);
    const lookDir = this.tmpLookDir.copy(this.smoothedLook).sub(this.camera.position).normalize();
    const camRight = this.tmpCamRight.set(1, 0, 0).applyQuaternion(this.heading).normalize();
    const rollUp = this.tmpRollUp.crossVectors(camRight, lookDir).normalize();
    this.camera.up.copy(rollUp);
    this.camera.lookAt(this.smoothedLook);
    this.camera.rotateZ(this.roll + Math.sin(time * 0.7) * 0.006);

    const targetFov = this.fovTarget(speed01, boost);
    if (Math.abs(targetFov - this.fov) > 0.005) {
      this.fov = damp(this.fov, targetFov, 6, dt);
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private fovTarget(speed01: number, boost: number): number {
    return TUNING.camera.fovBase + speed01 * TUNING.camera.fovBoost * 0.7 + boost * TUNING.camera.fovBoost * 0.42;
  }

  private tmpVecA = new THREE.Vector3();
  private tmpVecB = new THREE.Vector3();
  private tmpRight = new THREE.Vector3();
  private tmpUp = new THREE.Vector3();
  private tmpBack = new THREE.Vector3();
  private tmpBasis = new THREE.Matrix4();
  private tmpLookDir = new THREE.Vector3();
  private tmpCamRight = new THREE.Vector3();
  private tmpRollUp = new THREE.Vector3();

  private applyShake(dt: number, time: number): void {
    if (this.shake > 0.0001) {
      const amp = this.shake;
      this.shakeTime += dt * 34;
      const n1 = Math.sin(this.shakeTime * 1.7 + time) * 0.6 + Math.sin(this.shakeTime * 3.9) * 0.4;
      const n2 = Math.cos(this.shakeTime * 2.3 + time * 1.3) * 0.6 + Math.sin(this.shakeTime * 4.7) * 0.4;
      this.camera.position.addScaledVector(this.tmpVecA.set(1, 0, 0).applyQuaternion(this.camera.quaternion), n1 * amp);
      this.camera.position.addScaledVector(this.tmpVecB.set(0, 1, 0).applyQuaternion(this.camera.quaternion), n2 * amp);
      this.camera.rotateZ(n1 * amp * 0.012);
      this.shake = Math.max(0, this.shake - dt * (2.4 + this.shake * 1.6));
    }
    this.initialized = true;
  }
}
