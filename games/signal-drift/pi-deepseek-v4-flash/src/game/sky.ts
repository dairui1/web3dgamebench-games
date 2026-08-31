import * as THREE from 'three';

/**
 * Storm sky: gradient dome shader + aurora veils, procedural cloud deck and
 * drifting volumetric-ish cloud sprites. No external textures.
 */
export class Skyline {
  readonly group = new THREE.Group();
  private deck: THREE.Mesh;
  private deckTex: THREE.CanvasTexture;
  private sprites: { s: THREE.Sprite; drift: number; phase: number }[] = [];

  constructor(scene: THREE.Scene) {
    // -- Sky dome -----------------------------------------------------------
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x070c24) },
        uMid: { value: new THREE.Color(0x14224a) },
        uHorizon: { value: new THREE.Color(0x2c4368) },
        uStorm: { value: new THREE.Color(0x4d3b52) },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        uniform vec3 uStorm;
        uniform float uTime;
        varying vec3 vPos;
        // cheap pseudo-noise
        float n1(vec3 p) {
          return sin(p.x * 1.7 + p.y * 2.3 + p.z * 1.1) * sin(p.x * 3.1 - p.y * 1.7 + p.z * 2.9 + uTime * 0.02)
               + sin(p.x * 5.3 + p.y * 4.1 + p.z * 3.7 + uTime * 0.03) * 0.5;
        }
        void main() {
          vec3 dir = normalize(vPos);
          float h = clamp(dir.y, -1.0, 1.0);
          vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.45, h));
          col = mix(col, uTop, smoothstep(0.25, 0.9, h));
          // Storm tint near horizon
          col = mix(col, uStorm, (1.0 - smoothstep(0.05, 0.4, h)) * 0.65);
          // Faint aurora veils high up
          float aur = smoothstep(0.35, 0.75, h) * smoothstep(0.95, 0.6, h);
          float aurora = n1(dir * 2.2) * 0.5 + 0.5;
          col += vec3(0.05, 0.32, 0.42) * aur * aurora * 0.35;
          // Thunderheads silhouettes toward horizon
          float clouds = smoothstep(0.18, -0.05, h) * 0.5 * (0.5 + 0.5 * n1(dir * 3.0));
          col = mix(col, vec3(0.06, 0.08, 0.16), clouds * 0.7);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const skyGeo = new THREE.SphereGeometry(3000, 24, 14);
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false;
    this.group.add(sky);
    this.skyMat = skyMat;

    // -- Cloud deck ---------------------------------------------------------
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#04081a';
    ctx.fillRect(0, 0, size, size);
    const blobs: { x: number; y: number; r: number; a: number }[] = [];
    let seed = 1337;
    const rnd = () => {
      seed = (seed * 16807 + 0) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 260; i++) {
      blobs.push({ x: rnd() * size, y: rnd() * size, r: 8 + rnd() * 42, a: 0.05 + rnd() * 0.14 });
    }
    // Layer 1: dim under-glow
    const grad = ctx.createRadialGradient(size / 2, size / 2, 40, size / 2, size / 2, size * 0.75);
    grad.addColorStop(0, 'rgba(58, 84, 130, 0.35)');
    grad.addColorStop(0.6, 'rgba(26, 40, 74, 0.22)');
    grad.addColorStop(1, 'rgba(6, 10, 26, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    for (const b of blobs) {
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, `rgba(168, 190, 224, ${b.a})`);
      g.addColorStop(0.55, `rgba(120, 148, 190, ${b.a * 0.55})`);
      g.addColorStop(1, 'rgba(80, 110, 160, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    this.deckTex = tex;
    const deckMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      fog: true,
      color: 0xdfe9ff,
    });
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(3600, 3600), deckMat);
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = -52;
    this.group.add(deck);
    this.deck = deck;

    // -- Cloud sprites (soft billboards floating above the deck) ------------
    const spriteTex = makeCloudSpriteTexture();
    for (let i = 0; i < 30; i++) {
      const sm = new THREE.SpriteMaterial({
        map: spriteTex,
        transparent: true,
        opacity: 0.28 + Math.random() * 0.3,
        depthWrite: false,
        color: new THREE.Color(0x9db4dd).lerp(new THREE.Color(0x5a6c96), Math.random()),
      });
      const s = new THREE.Sprite(sm);
      const scale = 60 + Math.random() * 130;
      s.scale.set(scale * (1 + Math.random() * 1.4), scale * 0.55, 1);
      this.group.add(s);
      this.sprites.push({
        s,
        drift: 3 + Math.random() * 9,
        phase: Math.random() * Math.PI * 2,
      });
    }
    this.placeSpriteClouds(0, 900);

    scene.add(this.group);
  }

  private skyMat: THREE.ShaderMaterial;

  /** Scatter cloud sprites across a z-range around a craft at (cx, cy). */
  private placeSpriteClouds(cx: number, cy: number): void {
    for (const cs of this.sprites) {
      cs.s.position.set(
        cx + (Math.random() - 0.5) * 520,
        -48 + Math.random() * 30 + (cy - 12) * 0.12,
        cx + Math.random() * 900 + 40,
      );
      cs.s.visible = true;
    }
  }

  update(dt: number, craftX: number, craftY: number, craftZ: number, camZ: number): void {
    (this.skyMat.uniforms.uTime.value as number) += dt;
    // scroll deck
    const rep = this.deckTex.repeat.x;
    this.deckTex.offset.x = (-(craftZ * rep) / 3600) % 1;
    const span = 9000;
    for (const cs of this.sprites) {
      const s = cs.s;
      let x = s.position.x + Math.sin((craftZ + cs.phase) * 0.004) * 12 * dt;
      // relative wind so clouds stream past the camera
      const z = s.position.z - cs.drift * dt;
      s.position.set(x, s.position.y, z);
      if (z < camZ - 240) {
        s.position.set(
          craftX + (Math.random() - 0.5) * 520,
          -48 + Math.random() * 30 + (craftY - 12) * 0.12,
          s.position.z + span,
        );
      }
    }
    void craftX;
  }
}

function makeCloudSpriteTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2 + 6;
  const rnd = mulberry(99);
  for (let i = 0; i < 46; i++) {
    const r = 14 + rnd() * 40;
    const a = 0.025 + rnd() * 0.05;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx + (rnd() - 0.5) * 44, cy + (rnd() - 0.5) * 18, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}