import * as THREE from 'three';
import { Course } from './course';
import { PALETTE, FIELD } from './config';
import { Rng, clamp, makeCloudTexture, makeSoftSprite } from './util';

const FOG_COLOR = new THREE.Color(0x16242e);
const FOG_DENSITY = 0.00225;

const FOG_HELPER = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  float signalFog(vec3 worldPos, vec3 camPos) {
    float d = length(worldPos - camPos);
    return 1.0 - exp(-(uFogDensity * uFogDensity) * (d * d));
  }
  vec3 applySignalFog(vec3 color, vec3 worldPos, vec3 camPos) {
    return mix(color, uFogColor, clamp(signalFog(worldPos, camPos), 0.0, 1.0));
  }
`;

const NOISE_HELPER = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i);
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
               mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }
`;

export interface WorldContext {
  dt: number;
  time: number;
  craftPos: THREE.Vector3;
  craftVel: THREE.Vector3;
  cameraPos: THREE.Vector3;
  speed: number;
  targetPos: THREE.Vector3 | null;
  relayProgress: number;
  charging: number;
}

/** Everything that is atmosphere rather than gameplay. */
export class World {
  readonly group = new THREE.Group();
  readonly lights = new THREE.Group();

  private cloudTex: THREE.Texture;
  private sprite: THREE.Texture;

  private sky!: THREE.Mesh;
  private skyMat!: THREE.ShaderMaterial;
  private deck!: THREE.Mesh;
  private deckMat!: THREE.ShaderMaterial;
  private puffs!: THREE.Points;
  private puffMat!: THREE.ShaderMaterial;
  private rain!: THREE.LineSegments;
  private rainMat!: THREE.ShaderMaterial;
  private spine!: THREE.Mesh;
  private spineMat!: THREE.ShaderMaterial;
  private pulses: THREE.Mesh[] = [];
  private boltLines: THREE.Line[] = [];
  private boltMats: THREE.LineBasicMaterial[] = [];
  private boltAges: number[] = [];
  private flashLight!: THREE.PointLight;
  private nextFlash = 1.4;
  private flashValue = 0;
  private hemi!: THREE.HemisphereLight;
  private key!: THREE.DirectionalLight;
  private gateLight!: THREE.PointLight;
  private craftLight!: THREE.PointLight;
  private ambientRim!: THREE.PointLight;

  private wreckGroups: { mesh: THREE.InstancedMesh; spin: THREE.Vector3[]; rot: THREE.Euler[]; pos: THREE.Vector3[]; scale: number[] }[] = [];

  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpMatrix = new THREE.Matrix4();
  private tmpQuat = new THREE.Quaternion();
  private rng: Rng;
  private pulseOffsets: number[] = [];

  constructor(private course: Course) {
    this.rng = new Rng(90210);
    this.cloudTex = makeCloudTexture(512, 5, 31);
    this.sprite = makeSoftSprite(128, 2.6);
    this.buildLights();
    this.buildSky();
    this.buildDeck();
    this.buildPuffs();
    this.buildRain();
    this.buildSpine();
    this.buildBeacons();
    this.buildWreck();
    this.buildBolts();
  }

  /* ------------------------------------------------------------ */

  private buildLights(): void {
    this.hemi = new THREE.HemisphereLight(PALETTE.ice, 0x0a1218, 0.85);
    this.key = new THREE.DirectionalLight(0xcfe8ff, 1.35);
    this.key.position.set(-0.4, 0.9, -0.35);
    this.gateLight = new THREE.PointLight(PALETTE.amber, 0, 420, 1.15);
    this.craftLight = new THREE.PointLight(PALETTE.cyan, 42, 90, 1.7);
    this.ambientRim = new THREE.PointLight(PALETTE.violet, 16, 320, 1.9);
    this.flashLight = new THREE.PointLight(0xbfe4ff, 0, 1600, 1.4);
    this.lights.add(this.hemi, this.key, this.gateLight, this.craftLight, this.ambientRim, this.flashLight);
    this.group.add(this.lights);
  }

  private buildSky(): void {
    const geo = new THREE.SphereGeometry(3200, 32, 20);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uTop: { value: new THREE.Color(PALETTE.skyHigh) },
        uMid: { value: new THREE.Color(PALETTE.skyMid) },
        uLow: { value: new THREE.Color(PALETTE.skyLow) },
        uHorizon: { value: new THREE.Color(PALETTE.horizon) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${NOISE_HELPER}
        varying vec3 vDir;
        uniform float uTime;
        uniform float uFlash;
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uLow;
        uniform vec3 uHorizon;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(uLow, uMid, smoothstep(0.34, 0.62, h));
          col = mix(col, uTop, smoothstep(0.58, 0.98, h));
          float band = d.y * 3.0;
          float n = vnoise(vec3(d.x * 3.2, band * 1.6 + uTime * 0.012, d.z * 3.2));
          n += 0.5 * vnoise(vec3(d.x * 7.0, band * 3.1 - uTime * 0.02, d.z * 7.0));
          col += vec3(0.05, 0.09, 0.12) * smoothstep(0.55, 1.35, n) * (0.35 + 0.65 * (1.0 - h));
          float horizonGlow = exp(-abs(d.y) * 7.0);
          col += uHorizon * horizonGlow * 0.5;
          col += vec3(0.42, 0.62, 0.85) * uFlash * (0.25 + 0.75 * horizonGlow);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.group.add(this.sky);
  }

  private buildDeck(): void {
    const geo = new THREE.PlaneGeometry(7000, 7000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.deckMat = new THREE.ShaderMaterial({
      transparent: false,
      depthWrite: true,
      uniforms: {
        uTime: { value: 0 },
        uCloud: { value: this.cloudTex },
        uCamPos: { value: new THREE.Vector3() },
        uFlash: { value: 0 },
        uFogColor: { value: FOG_COLOR.clone() },
        uFogDensity: { value: FOG_DENSITY },
        uDeep: { value: new THREE.Color(0x0a141b) },
        uShallow: { value: new THREE.Color(0x9db2c0) },
        uRim: { value: new THREE.Color(PALETTE.amberDeep) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        ${FOG_HELPER}
        varying vec3 vWorld;
        uniform float uTime;
        uniform sampler2D uCloud;
        uniform vec3 uCamPos;
        uniform float uFlash;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uRim;
        void main() {
          vec2 uv = vWorld.xz * 0.00085;
          float a = texture2D(uCloud, uv + vec2(uTime * 0.0035, uTime * 0.0012)).r;
          float b = texture2D(uCloud, uv * 2.7 + vec2(-uTime * 0.0062, uTime * 0.0028)).r;
          float c = texture2D(uCloud, uv * 6.1 + vec2(uTime * 0.011, -uTime * 0.004)).r;
          float density = clamp(a * 0.6 + b * 0.3 + c * 0.18, 0.0, 1.4);
          float lit = smoothstep(0.30, 1.0, density);
          float shadow = smoothstep(0.05, 0.75, density);
          vec3 col = mix(uDeep, uShallow, lit);
          col *= mix(0.42, 1.12, shadow);
          float dist = length(vWorld - uCamPos);
          float sun = exp(-pow(dist * 0.00055, 2.0));
          col += uRim * sun * 0.16 * lit;
          col += vec3(0.5, 0.68, 0.9) * uFlash * 0.45 * lit;
          // Gentle vignette into the void at the far edge of the plane.
          float edge = 1.0 - smoothstep(1800.0, 3300.0, length(vWorld.xz - uCamPos.xz));
          col = mix(uFogColor, col, edge);
          col = applySignalFog(col, vWorld, uCamPos);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.deck = new THREE.Mesh(geo, this.deckMat);
    this.deck.position.y = FIELD.deck;
    this.deck.frustumCulled = false;
    this.deck.renderOrder = -5;
    this.group.add(this.deck);
  }

  private buildPuffs(): void {
    const positions = this.course.puffField;
    const count = positions.length;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const tint = new Float32Array(count);
    const rng = new Rng(4242);
    for (let i = 0; i < count; i += 1) {
      pos[i * 3] = positions[i].x;
      pos[i * 3 + 1] = positions[i].y;
      pos[i * 3 + 2] = positions[i].z;
      size[i] = rng.float(60, 190);
      tint[i] = rng.float(0, 1);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
    this.puffMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uMap: { value: this.sprite },
        uTime: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uFlash: { value: 0 },
        uPixelRatio: { value: 1 },
        uCool: { value: new THREE.Color(0x48606f) },
        uWarm: { value: new THREE.Color(0x8b8070) },
        uFogColor: { value: FOG_COLOR.clone() },
        uFogDensity: { value: FOG_DENSITY },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aTint;
        varying float vTint;
        varying vec3 vWorld;
        uniform float uPixelRatio;
        void main() {
          vTint = aTint;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mv = viewMatrix * wp;
          gl_PointSize = aSize * uPixelRatio * (38.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        ${FOG_HELPER}
        varying float vTint;
        varying vec3 vWorld;
        uniform sampler2D uMap;
        uniform float uTime;
        uniform vec3 uCamPos;
        uniform float uFlash;
        uniform vec3 uCool;
        uniform vec3 uWarm;
        void main() {
          float m = texture2D(uMap, gl_PointCoord).a;
          if (m < 0.01) discard;
          vec3 col = mix(uCool, uWarm, vTint) * (0.55 + 0.5 * vTint);
          col += vec3(0.4, 0.55, 0.8) * uFlash * 0.5;
          float alpha = m * (0.16 + 0.14 * vTint);
          col = applySignalFog(col, vWorld, uCamPos);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    this.puffs = new THREE.Points(geo, this.puffMat);
    this.puffs.frustumCulled = false;
    this.puffs.renderOrder = -3;
    this.group.add(this.puffs);
  }

  private buildRain(): void {
    const streaks = 900;
    const box = new THREE.Vector3(280, 190, 280);
    const verts = streaks * 2;
    const geo = new THREE.BufferGeometry();
    const base = new Float32Array(verts * 3);
    const side = new Float32Array(verts);
    const rnd = new Float32Array(verts);
    const pos = new Float32Array(verts * 3);
    const rng = new Rng(808);
    for (let i = 0; i < streaks; i += 1) {
      const bx = rng.float(0, box.x);
      const by = rng.float(0, box.y);
      const bz = rng.float(0, box.z);
      const r = rng.float(0.5, 1);
      for (let s = 0; s < 2; s += 1) {
        const idx = i * 2 + s;
        base[idx * 3] = bx;
        base[idx * 3 + 1] = by;
        base[idx * 3 + 2] = bz;
        side[idx] = s;
        rnd[idx] = r;
        pos[idx * 3] = 0;
        pos[idx * 3 + 1] = 0;
        pos[idx * 3 + 2] = 0;
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uBox: { value: box.clone() },
        uRelVel: { value: new THREE.Vector3() },
        uFall: { value: 26 },
        uLen: { value: 3.2 },
        uOpacity: { value: 0.5 },
        uTint: { value: new THREE.Color(PALETTE.ice) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aBase;
        attribute float aSide;
        attribute float aRnd;
        uniform float uTime;
        uniform vec3 uOrigin;
        uniform vec3 uBox;
        uniform vec3 uRelVel;
        uniform float uFall;
        uniform float uLen;
        varying float vFade;
        void main() {
          vec3 drift = uRelVel * uTime + vec3(0.0, -uFall * uTime * aRnd, 0.0);
          vec3 p = aBase + drift;
          p = mod(p, uBox) - uBox * 0.5;
          vec3 flow = normalize(uRelVel * 0.75 + vec3(0.0, -uFall, 0.0));
          p += flow * aSide * uLen * (0.45 + aRnd);
          vFade = aRnd;
          vec4 wp = vec4(p + uOrigin, 1.0);
          vec4 mv = viewMatrix * wp;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTint;
        uniform float uOpacity;
        varying float vFade;
        void main() {
          gl_FragColor = vec4(uTint * (0.35 + 0.65 * vFade), uOpacity * (0.25 + 0.55 * vFade));
        }
      `,
    });
    this.rain = new THREE.LineSegments(geo, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 4;
    this.group.add(this.rain);
  }

  private buildSpine(): void {
    const geo = new THREE.TubeGeometry(this.course.curve, 460, 0.55, 6, false);
    this.spineMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: new THREE.Color(PALETTE.cyan) },
        uColorB: { value: new THREE.Color(PALETTE.violet) },
        uProgress: { value: 0 },
        uActive: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        uniform float uTime;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uProgress;
        uniform float uActive;
        void main() {
          float flow = fract(vUv.x * 26.0 - uTime * 0.55);
          float dash = smoothstep(0.55, 0.98, flow);
          float restored = step(vUv.x, uProgress);
          vec3 col = mix(uColorB * 0.5, uColorA, restored);
          float core = 0.18 + 0.5 * dash + 0.35 * restored;
          float ahead = 1.0 - smoothstep(uProgress, uProgress + 0.02, vUv.x);
          col += uColorA * dash * ahead * 0.8;
          gl_FragColor = vec4(col * (0.6 + 0.4 * uActive), core);
        }
      `,
    });
    this.spine = new THREE.Mesh(geo, this.spineMat);
    this.spine.frustumCulled = false;
    this.spine.renderOrder = 2;
    this.group.add(this.spine);

    const pulseGeo = new THREE.SphereGeometry(1.6, 8, 6);
    for (let i = 0; i < 7; i += 1) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(PALETTE.cyan),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(pulseGeo, mat);
      mesh.frustumCulled = false;
      this.pulses.push(mesh);
      this.pulseOffsets.push(i / 7);
      this.group.add(mesh);
    }
  }

  private buildBeacons(): void {
    const spots = this.course.beacons;
    const mastGeo = new THREE.BoxGeometry(1.1, 1, 1.1);
    const lensGeo = new THREE.IcosahedronGeometry(1.15, 0);
    const mastMat = new THREE.MeshStandardMaterial({
      color: PALETTE.metal,
      roughness: 0.82,
      metalness: 0.5,
    });
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x0b1a20,
      emissive: new THREE.Color(PALETTE.cyan),
      emissiveIntensity: 1.35,
      roughness: 0.35,
      metalness: 0.1,
    });
    const masts = new THREE.InstancedMesh(mastGeo, mastMat, spots.length);
    const lenses = new THREE.InstancedMesh(lensGeo, lensMat, spots.length);
    masts.frustumCulled = false;
    lenses.frustumCulled = false;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);
    spots.forEach((spot, i) => {
      const anchor = spot.frame.pos.clone().add(spot.offset);
      const dir = spot.frame.pos.clone().sub(anchor).normalize();
      quat.setFromUnitVectors(up, dir);
      pos.copy(anchor).addScaledVector(dir, spot.height * 0.5);
      scale.set(1, spot.height, 1);
      matrix.compose(pos, quat, scale);
      masts.setMatrixAt(i, matrix);
      const lensPos = anchor.clone().addScaledVector(dir, spot.height);
      matrix.compose(lensPos, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      lenses.setMatrixAt(i, matrix);
    });
    masts.instanceMatrix.needsUpdate = true;
    lenses.instanceMatrix.needsUpdate = true;
    this.group.add(masts, lenses);
  }

  private buildWreck(): void {
    const geos = [
      new THREE.BoxGeometry(1, 0.28, 0.7),
      new THREE.TorusGeometry(1, 0.16, 5, 12, 4.4),
      new THREE.CylinderGeometry(0.12, 0.12, 4.2, 5),
      new THREE.BoxGeometry(0.8, 0.8, 1.6),
      new THREE.ConeGeometry(0.5, 3.4, 5),
    ];
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1b2530,
      roughness: 0.9,
      metalness: 0.45,
    });
    const buckets: number[][] = geos.map(() => []);
    this.course.wreck.forEach((_, i) => {
      buckets[this.course.wreck[i].kind].push(i);
    });
    geos.forEach((geo, kind) => {
      const indices = buckets[kind];
      if (!indices.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, indices.length);
      mesh.frustumCulled = false;
      const spin: THREE.Vector3[] = [];
      const rot: THREE.Euler[] = [];
      const pos: THREE.Vector3[] = [];
      const scale: number[] = [];
      const matrix = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      indices.forEach((srcIndex, i) => {
        const spot = this.course.wreck[srcIndex];
        q.setFromEuler(spot.rotation);
        matrix.compose(spot.position, q, new THREE.Vector3(spot.scale, spot.scale, spot.scale));
        mesh.setMatrixAt(i, matrix);
        spin.push(spot.spin);
        rot.push(spot.rotation.clone());
        pos.push(spot.position.clone());
        scale.push(spot.scale);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.wreckGroups.push({ mesh, spin, rot, pos, scale });
      this.group.add(mesh);
    });
  }

  private buildBolts(): void {
    for (let i = 0; i < 3; i += 1) {
      const geo = new THREE.BufferGeometry();
      const pts = 26;
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts * 3), 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xdff2ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      this.boltLines.push(line);
      this.boltMats.push(mat);
      this.boltAges.push(99);
      this.group.add(line);
    }
  }

  /* ------------------------------------------------------------ */

  get fogColor(): THREE.Color {
    return FOG_COLOR;
  }

  setPixelRatio(ratio: number): void {
    this.puffMat.uniforms.uPixelRatio.value = ratio;
  }

  update(ctx: WorldContext): void {
    const { time } = ctx;
    this.skyMat.uniforms.uTime.value = time;
    this.deckMat.uniforms.uTime.value = time;
    this.deckMat.uniforms.uCamPos.value.copy(ctx.cameraPos);
    this.puffMat.uniforms.uTime.value = time;
    this.puffMat.uniforms.uCamPos.value.copy(ctx.cameraPos);
    this.spineMat.uniforms.uTime.value = time;
    this.spineMat.uniforms.uProgress.value = ctx.relayProgress;

    // Rain follows the craft so the box never runs out.
    const rainU = this.rainMat.uniforms;
    rainU.uTime.value = time;
    const snap = rainU.uOrigin.value;
    snap.copy(ctx.craftPos);
    snap.x = Math.round(snap.x / 20) * 20;
    snap.y = Math.round(snap.y / 20) * 20;
    snap.z = Math.round(snap.z / 20) * 20;
    rainU.uRelVel.value.copy(ctx.craftVel).multiplyScalar(-1).clampLength(0, 90);
    rainU.uLen.value = 2.4 + clamp(ctx.speed * 0.24, 0, 16);
    rainU.uOpacity.value = 0.32 + clamp(ctx.speed / 110, 0, 0.4);

    // Sky and cloud deck always sit around the viewer.
    this.sky.position.copy(ctx.cameraPos);
    this.deck.position.x = ctx.cameraPos.x;
    this.deck.position.z = ctx.cameraPos.z;

    // Lights
    this.craftLight.position.copy(ctx.craftPos);
    this.craftLight.intensity = 34 + ctx.speed * 0.45 + ctx.charging * 30;
    this.ambientRim.position.set(
      ctx.craftPos.x + Math.sin(time * 0.09) * 140,
      ctx.craftPos.y + 90,
      ctx.craftPos.z - 120,
    );
    if (ctx.targetPos) {
      this.gateLight.position.copy(ctx.targetPos);
      this.gateLight.intensity = 320 + Math.sin(time * 3.1) * 60;
    } else {
      this.gateLight.intensity = 0;
    }

    // Spine pulses travelling toward the objective.
    for (let i = 0; i < this.pulses.length; i += 1) {
      const t = (this.pulseOffsets[i] + time * 0.035) % 1;
      this.course.curve.getPointAt(clamp(t, 0, 1), this.tmpB);
      const mesh = this.pulses[i];
      mesh.position.copy(this.tmpB);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const active = t >= ctx.relayProgress - 0.02 && ctx.targetPos !== null;
      mat.opacity = active ? 0.55 + 0.45 * Math.sin((t - ctx.relayProgress) * 60 + time * 6) : 0.12;
      const near = this.tmpB.distanceTo(ctx.craftPos);
      mesh.visible = near < 620;
      mesh.scale.setScalar(active ? 1.5 : 0.8);
    }

    // Tumbling wreckage.
    const q = this.tmpQuat;
    for (const group of this.wreckGroups) {
      if (group.mesh === undefined) continue;
      let dirty = false;
      for (let i = 0; i < group.pos.length; i += 1) {
        const dist = group.pos[i].distanceToSquared(ctx.craftPos);
        if (dist > 620 * 620) continue;
        if (group.spin[i].lengthSq() === 0) continue;
        dirty = true;
        group.rot[i].x += group.spin[i].x * ctx.dt;
        group.rot[i].y += group.spin[i].y * ctx.dt;
        group.rot[i].z += group.spin[i].z * ctx.dt;
        q.setFromEuler(group.rot[i]);
        this.tmpMatrix.compose(
          group.pos[i],
          q,
          this.tmpA.setScalar(group.scale[i]),
        );
        group.mesh.setMatrixAt(i, this.tmpMatrix);
      }
      if (dirty) group.mesh.instanceMatrix.needsUpdate = true;
    }

    this.updateLightning(ctx);
  }

  private updateLightning(ctx: WorldContext): void {
    this.nextFlash -= ctx.dt;
    if (this.nextFlash <= 0) {
      this.nextFlash = this.rng.float(2.4, 7.5);
      this.strike(ctx);
      this.flashValue = this.rng.float(0.5, 1);
    }
    this.flashValue = Math.max(0, this.flashValue - ctx.dt * 2.6);
    const flicker = this.flashValue * (0.65 + 0.35 * Math.sin(ctx.time * 60));
    this.skyMat.uniforms.uFlash.value = flicker * 0.7;
    this.deckMat.uniforms.uFlash.value = flicker;
    this.puffMat.uniforms.uFlash.value = flicker * 0.8;
    this.hemi.intensity = 0.8 + flicker * 0.9;
    this.flashLight.intensity = flicker * 9000;
    for (let i = 0; i < this.boltLines.length; i += 1) {
      this.boltAges[i] += ctx.dt;
      const age = this.boltAges[i];
      const life = 0.42;
      if (age > life) {
        this.boltMats[i].opacity = 0;
        this.boltLines[i].visible = false;
        continue;
      }
      const pulse = age < 0.05 ? age / 0.05 : 1 - age / life;
      this.boltLines[i].visible = true;
      this.boltMats[i].opacity = clamp(pulse * (0.6 + 0.4 * Math.sin(age * 90)), 0, 1);
    }
  }

  private strike(ctx: WorldContext): void {
    const index = Math.floor(this.rng.float(0, this.boltLines.length));
    const slot = (index + Math.floor(this.rng.float(0, this.boltLines.length))) % this.boltLines.length;
    const line = this.boltLines[slot];
    const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pts = attr.count;
    const target = this.tmpA
      .copy(ctx.craftPos)
      .add(this.tmpB.set(this.rng.float(-320, 320), this.rng.float(-120, -30), this.rng.float(-420, 260)));
    const start = new THREE.Vector3(target.x + this.rng.float(-160, 160), FIELD.deck + this.rng.float(160, 330), target.z + this.rng.float(-120, 120));
    const end = new THREE.Vector3(target.x, FIELD.deck + this.rng.float(-6, 16), target.z);
    const jitter = new THREE.Vector3();
    for (let i = 0; i < pts; i += 1) {
      const t = i / (pts - 1);
      jitter.set(this.rng.float(-1, 1), this.rng.float(-1, 1), this.rng.float(-1, 1)).multiplyScalar(26 * Math.sin(t * Math.PI));
      attr.setXYZ(
        i,
        THREE.MathUtils.lerp(start.x, end.x, t) + jitter.x,
        THREE.MathUtils.lerp(start.y, end.y, t) + jitter.y,
        THREE.MathUtils.lerp(start.z, end.z, t) + jitter.z,
      );
    }
    attr.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    this.boltAges[slot] = 0;
    this.flashLight.position.copy(start);
    this.nextFlash = Math.min(this.nextFlash, this.rng.float(2.2, 7.5));
  }
}
