import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';

export interface GradeParams {
  time: number;
  damage: number;
  speed01: number;
  danger: number;
  lowCharge: number;
  victory: number;
}

const GradeShader = {
  name: 'SignalDriftGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uDamage: { value: 0 },
    uSpeed: { value: 0 },
    uDanger: { value: 0 },
    uLow: { value: 0 },
    uWin: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAspect: { value: 1.6 },
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
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uDamage;
    uniform float uSpeed;
    uniform float uDanger;
    uniform float uLow;
    uniform float uWin;
    uniform vec2 uResolution;
    uniform float uAspect;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    vec3 sampleCA(vec2 uv, float amount) {
      vec2 dir = uv - 0.5;
      float r = texture2D(tDiffuse, uv + dir * amount).r;
      vec2 g = texture2D(tDiffuse, uv).ga;
      return vec3(r, g.x, texture2D(tDiffuse, uv - dir * amount).b);
    }

    void main() {
      vec2 uv = vUv;
      vec2 centered = uv - 0.5;
      float radius = length(centered);

      // Impact glitch: horizontal band displacement.
      float band = step(0.72, hash(vec2(floor(uv.y * 46.0), floor(uTime * 24.0))));
      uv.x += band * uDamage * 0.02 * (hash(vec2(uTime, uv.y)) - 0.5);

      float ca = 0.0018 + uSpeed * 0.006 + uDamage * 0.012 + uDanger * 0.004;
      vec3 col = sampleCA(uv, ca * radius * 3.0);

      // Radial speed smear toward the edges.
      float smear = uSpeed * 0.03 * radius;
      if (smear > 0.001) {
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 4; i += 1) {
          float k = float(i + 1) / 4.0;
          acc += texture2D(tDiffuse, uv - centered * smear * k).rgb;
        }
        col = mix(col, acc * 0.25, clamp(uSpeed * 0.85, 0.0, 0.75));
      }

      // Cool storm grade + desaturation when charge runs out.
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 teal = mix(vec3(lum), col, vec3(0.86, 0.98, 1.06));
      col = mix(col, teal, 0.45);
      col = mix(col, vec3(lum) * vec3(1.05, 0.92, 0.94), uLow * 0.55);

      // Damage flash + critical vignette pulse.
      col += vec3(0.65, 0.08, 0.22) * uDamage * 0.55;
      float vig = smoothstep(0.98, 0.32, radius);
      float pulse = 0.5 + 0.5 * sin(uTime * 5.0);
      col *= mix(1.0, vig, 0.5 + uLow * 0.3 * pulse + uDanger * 0.25);
      col *= 1.0 - uLow * 0.12 * pulse;

      // Victory bloom-in.
      col = mix(col, col * vec3(1.25, 1.12, 0.85) + vec3(0.06, 0.05, 0.02), uWin);

      // Film grain + faint scan structure.
      float g = hash(uv * uResolution + fract(uTime) * 91.7) - 0.5;
      col += g * (0.030 + uLow * 0.03);
      col -= 0.012 * sin(uv.y * uResolution.y * 1.6 + uTime * 2.0);

      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }
  `,
};

/** Bloom + FXAA + the Signal Drift look. */
export class PostFX {
  readonly composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private fxaa: FXAAPass;
  private enabled: boolean;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.enabled = renderer.capabilities.isWebGL2;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(720, 420), 0.72, 0.62, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.fxaa = new FXAAPass();
    this.composer.addPass(this.fxaa);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.bloom.setSize(width * pixelRatio, height * pixelRatio);
    this.fxaa.setSize(width * pixelRatio, height * pixelRatio);
    this.grade.uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio);
    this.grade.uniforms.uAspect.value = width / Math.max(1, height);
  }

  setQuality(level: 'high' | 'medium' | 'low'): void {
    this.grade.enabled = level !== 'low';
    this.fxaa.enabled = level !== 'low';
    this.bloom.enabled = level !== 'low';
    this.bloom.strength = level === 'high' ? 0.72 : 0.55;
  }

  update(params: GradeParams): void {
    const u = this.grade.uniforms;
    u.uTime.value = params.time;
    u.uDamage.value = params.damage;
    u.uSpeed.value = params.speed01;
    u.uDanger.value = params.danger;
    u.uLow.value = params.lowCharge;
    u.uWin.value = params.victory;
  }

  render(): void {
    this.composer.render();
  }
}
