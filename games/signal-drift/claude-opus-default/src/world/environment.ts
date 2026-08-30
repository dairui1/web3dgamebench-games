import * as THREE from 'three';
import { Rng } from '../core/rng';

const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += amp * vnoise(p);
      p = p * 2.03 + vec2(17.3, 9.1);
      amp *= 0.5;
    }
    return sum;
  }
`;

/**
 * Sky dome, endless storm-lit cloud deck and the field lighting rig.
 * Everything is procedural: no textures are loaded at runtime.
 */
export class Environment {
  readonly group = new THREE.Group();
  readonly keyLight: THREE.DirectionalLight;

  private readonly skyUniforms;
  private readonly cloudUniforms;
  private readonly deck: THREE.Mesh;
  private readonly wisps: THREE.Mesh;
  private readonly hemi: THREE.HemisphereLight;
  private flash = 0;
  private nextFlash: number;
  private readonly rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
    this.nextFlash = rng.range(2, 7);

    this.skyUniforms = {
      uTop: { value: new THREE.Color(0x05070f) },
      uMid: { value: new THREE.Color(0x123049) },
      uHorizon: { value: new THREE.Color(0x3d5f77) },
      uGlow: { value: new THREE.Color(0xffb066) },
      uFlash: { value: 0 },
      uTime: { value: 0 },
    };

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(4200, 32, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.skyUniforms,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uGlow;
          uniform float uFlash; uniform float uTime;
          varying vec3 vDir;
          ${NOISE_GLSL}
          void main() {
            float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 col = mix(uHorizon, uMid, smoothstep(0.42, 0.66, h));
            col = mix(col, uTop, smoothstep(0.6, 0.98, h));
            // Warm break in the storm, low on the horizon.
            float sun = pow(max(0.0, dot(normalize(vDir), normalize(vec3(0.55, 0.06, -0.83)))), 14.0);
            col += uGlow * sun * 0.85;
            float band = smoothstep(0.5, 0.44, h) * smoothstep(0.30, 0.46, h);
            col += uGlow * band * 0.16;
            // Faint star field above the storm.
            float stars = pow(vnoise(vDir.xz * 260.0 + vDir.y * 40.0), 34.0) * smoothstep(0.55, 0.9, h);
            col += vec3(0.7, 0.85, 1.0) * stars * 1.6;
            col += vec3(0.30, 0.42, 0.62) * uFlash * smoothstep(0.25, 0.75, h);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -100;
    this.group.add(sky);

    this.cloudUniforms = {
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uLow: { value: new THREE.Color(0x121b2c) },
      uHigh: { value: new THREE.Color(0x8fa9c4) },
      uHorizon: { value: new THREE.Color(0x2b4257) },
      uTint: { value: new THREE.Color(0xffa257) },
    };

    const deckMaterial = new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms,
      fog: false,
      transparent: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uFlash; uniform vec3 uCam;
        uniform vec3 uLow; uniform vec3 uHigh; uniform vec3 uHorizon; uniform vec3 uTint;
        varying vec3 vWorld;
        ${NOISE_GLSL}
        void main() {
          vec2 p = vWorld.xz * 0.0022;
          float drift = uTime * 0.012;
          float base = fbm(p + vec2(drift, drift * 0.4));
          float detail = fbm(p * 3.1 - vec2(drift * 1.7, 0.0));
          float mask = smoothstep(0.34, 0.86, base * 0.75 + detail * 0.35);
          vec3 col = mix(uLow, uHigh, mask);
          col += uTint * pow(mask, 3.0) * 0.35;
          col += vec3(0.45, 0.58, 0.85) * uFlash * (0.35 + mask * 0.9);
          float dist = length(vWorld.xz - uCam.xz);
          float fade = 1.0 - exp(-dist * 0.00048);
          col = mix(col, uHorizon, clamp(fade, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.deck = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1), deckMaterial);
    this.deck.rotation.x = -Math.PI / 2;
    this.deck.position.y = -190;
    this.deck.frustumCulled = false;
    this.group.add(this.deck);

    // A thin upper haze layer that the corridor passes through.
    this.wisps = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000, 1, 1),
      new THREE.ShaderMaterial({
        uniforms: this.cloudUniforms,
        transparent: true,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uCam; uniform vec3 uHigh; uniform vec3 uTint;
          uniform float uFlash;
          varying vec3 vWorld;
          ${NOISE_GLSL}
          void main() {
            vec2 p = vWorld.xz * 0.0015 + vec2(uTime * 0.02, uTime * 0.006);
            float n = fbm(p) * 0.8 + fbm(p * 2.7) * 0.3;
            float a = smoothstep(0.55, 0.95, n) * 0.5;
            float dist = length(vWorld.xz - uCam.xz);
            a *= 1.0 - exp(-dist * 0.0016);
            a *= 1.0 - smoothstep(2200.0, 3000.0, dist);
            vec3 col = mix(uHigh, uTint, 0.25) + vec3(0.4, 0.5, 0.8) * uFlash;
            gl_FragColor = vec4(col, a);
          }
        `,
      }),
    );
    this.wisps.rotation.x = -Math.PI / 2;
    this.wisps.position.y = -34;
    this.wisps.frustumCulled = false;
    this.wisps.renderOrder = -50;
    this.group.add(this.wisps);

    this.hemi = new THREE.HemisphereLight(0x8ec6ff, 0x2a1a12, 0.85);
    this.group.add(this.hemi);

    this.keyLight = new THREE.DirectionalLight(0xffd2a1, 1.5);
    this.keyLight.position.set(220, 180, -320);
    this.group.add(this.keyLight);

    const fill = new THREE.DirectionalLight(0x5fe0ff, 0.55);
    fill.position.set(-260, -60, 220);
    this.group.add(fill);
  }

  /**
   * Bakes a small procedural environment so the metal hulls and rails have
   * something to reflect. Generated once at boot; no assets involved.
   */
  buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(40, 16, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {},
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 col = mix(vec3(0.16, 0.20, 0.26), vec3(0.05, 0.09, 0.16), smoothstep(0.45, 1.0, h));
            col = mix(vec3(0.40, 0.30, 0.20), col, smoothstep(0.0, 0.45, h));
            float sun = pow(max(0.0, dot(vDir, normalize(vec3(0.55, 0.12, -0.82)))), 8.0);
            col += vec3(1.4, 0.85, 0.45) * sun;
            float rim = pow(max(0.0, dot(vDir, normalize(vec3(-0.6, 0.35, 0.7)))), 6.0);
            col += vec3(0.25, 0.65, 0.9) * rim;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    envScene.add(dome);

    const target = pmrem.fromScene(envScene, 0.06);
    dome.geometry.dispose();
    (dome.material as THREE.Material).dispose();
    pmrem.dispose();
    return target.texture;
  }

  update(dt: number, elapsed: number, cameraPos: THREE.Vector3): void {
    this.skyUniforms.uTime.value = elapsed;
    this.cloudUniforms.uTime.value = elapsed;
    this.cloudUniforms.uCam.value.copy(cameraPos);

    this.nextFlash -= dt;
    if (this.nextFlash <= 0) {
      this.flash = this.rng.range(0.5, 1.1);
      this.nextFlash = this.rng.range(3.5, 11);
    }
    this.flash = Math.max(0, this.flash - dt * 2.6);
    const f = this.flash * this.flash;
    this.skyUniforms.uFlash.value = f;
    this.cloudUniforms.uFlash.value = f;
    this.hemi.intensity = 0.85 + f * 0.9;

    this.deck.position.x = cameraPos.x;
    this.deck.position.z = cameraPos.z;
    this.wisps.position.x = cameraPos.x;
    this.wisps.position.z = cameraPos.z;
  }
}
