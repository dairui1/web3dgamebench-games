import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const SignalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uAberration: { value: 0.0015 },
    uDamage: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0x6ff5ff) },
    uVignette: { value: 0.9 },
    uSpeed: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uDamage;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    uniform float uVignette;
    uniform float uSpeed;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(41.31, 289.17))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float r2 = dot(center, center);

      // Radial chromatic split, stronger toward the edges and under stress.
      float amount = uAberration * (1.0 + uDamage * 6.0 + uSpeed * 2.0);
      vec2 off = center * amount * (0.4 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;

      // Speed smear along the radial axis.
      if (uSpeed > 0.01) {
        vec3 smear = vec3(0.0);
        for (int i = 1; i <= 4; i++) {
          float t = float(i) / 4.0;
          smear += texture2D(tDiffuse, uv - center * t * 0.035 * uSpeed).rgb;
        }
        col = mix(col, smear * 0.25, clamp(uSpeed * 0.35 * smoothstep(0.02, 0.35, r2), 0.0, 0.6));
      }

      // Damage wash + interference bands.
      float band = sin((uv.y + uTime * 0.35) * 220.0) * 0.5 + 0.5;
      col = mix(col, vec3(0.85, 0.16, 0.12) * (0.5 + band * 0.5), uDamage * 0.35);

      // Flash punches hardest at the edges so the corridor stays readable.
      col += uFlashColor * uFlash * (0.22 + r2 * 1.8);

      // Grain keeps the gradients from banding on the cloud deck.
      float grain = hash(uv * 900.0 + fract(uTime) * 91.7) - 0.5;
      col += grain * 0.022;

      float vig = smoothstep(0.95, 0.18, r2 * uVignette * 2.0);
      col *= mix(0.55, 1.0, vig);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface PostState {
  damage: number;
  flash: number;
  flashColor: THREE.Color;
  speed: number;
}

/** Bloom + signal-degradation pass stack. */
export class PostFX {
  readonly composer: EffectComposer;

  private readonly bloom: UnrealBloomPass;
  private readonly signal: ShaderPass;
  private bloomEnabled = true;
  private bypass = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.setSize(width, height);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.6, 0.62, 0.8);
    this.composer.addPass(this.bloom);

    this.signal = new ShaderPass(SignalShader);
    this.composer.addPass(this.signal);

    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }

  setBloomEnabled(enabled: boolean): void {
    if (this.bloomEnabled === enabled) return;
    this.bloomEnabled = enabled;
    this.bloom.enabled = enabled;
  }

  /** Skip the whole post stack on very slow devices. */
  setBypass(bypass: boolean): void {
    this.bypass = bypass;
  }

  update(elapsed: number, state: PostState): void {
    const u = this.signal.uniforms;
    u.uTime.value = elapsed;
    u.uDamage.value = state.damage;
    u.uFlash.value = state.flash;
    u.uFlashColor.value.copy(state.flashColor);
    u.uSpeed.value = state.speed;
    this.bloom.strength = 0.55 + state.speed * 0.3 + state.flash * 0.55;
  }

  render(): void {
    if (this.bypass) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
