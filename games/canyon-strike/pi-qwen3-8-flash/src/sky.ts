// Canyon Strike - sky dome with a moving sun arc, dynamic light, fog and weather.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU, fbm } from './rng';
import { DAY_LENGTH, biomeAt, badMask, BOUND } from './world';

export type WeatherKind = 'clear' | 'haze' | 'overcast' | 'fog' | 'storm';

const SKY_VERT = `
varying vec3 vDir;
void main(){
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = `
varying vec3 vDir;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform float uNight;
uniform float uTime;
uniform float uCloud;
uniform float uHaze;
uniform vec3 uCloudCol;

float h12(vec2 p){ return fract(sin(dot(p, vec2(27.16, 57.43))) * 3943.27); }

void main(){
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(up, 0.42));
  col = mix(uBottom, col, smoothstep(-0.22, 0.03, d.y));

  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * pow(sd, 900.0) * 6.0;
  col += uSunCol * pow(sd, 26.0) * 0.55;
  col += uSunCol * pow(sd, 4.0) * 0.16;

  float md = max(dot(d, -uSunDir), 0.0);
  col += vec3(0.80, 0.84, 0.92) * (pow(md, 2400.0) * 6.0 + pow(md, 40.0) * 0.25) * uNight;

  if (uNight > 0.01 && d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.28) * 26.0;
    vec2 gi = floor(uv);
    float r = h12(gi);
    float star = step(0.982, r);
    float tw = 0.55 + 0.45 * sin(uTime * 1.7 + r * 40.0);
    col += vec3(0.9, 0.95, 1.0) * star * tw * uNight * smoothstep(0.0, 0.3, d.y) * 1.5;
  }

  // stylised banded cloud decks
  if (d.y > 0.01) {
    float band = 0.5 + 0.5 * sin(d.x * 7.0 + uTime * 0.02 + d.z * 3.0);
    float band2 = 0.5 + 0.5 * sin(d.z * 5.3 - uTime * 0.014 + d.x * 2.0);
    float cl = smoothstep(0.60, 0.99, band * band2) * smoothstep(0.02, 0.35, d.y);
    col = mix(col, uCloudCol, cl * (0.35 + 0.65 * uCloud));
  }
  col = mix(col, mix(uHorizon, uCloudCol, 0.5), uHaze * 0.35 * (1.0 - up));
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  readonly group = new THREE.Group();
  readonly sunDir = new THREE.Vector3(1, 0.3, 0);
  readonly fogColor = new THREE.Color(0x9db2bd);
  sun: THREE.DirectionalLight;
  moon: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  amb: THREE.AmbientLight;
  flash: THREE.PointLight;
  hour = 7.1;
  dayLen = DAY_LENGTH;
  night = 0;
  elevation = 0;
  weather: WeatherKind = 'clear';
  wet = 0; // 0..1 storm intensity
  haze = 0;
  fogAmt = 0;
  wind = 0;
  quality = 1; // 0 low, 1 med, 2 high
  scene: THREE.Scene;
  clock = 0;
  onThunder: (() => void) | null = null;

  private matSky: THREE.ShaderMaterial;
  private sunMesh: THREE.Mesh;
  private moonMesh: THREE.Mesh;
  private arc: THREE.Mesh;
  private arcTicks: THREE.Mesh;
  private rain: THREE.LineSegments;
  private rainGeo: THREE.BufferGeometry;
  private snow: THREE.Points;
  private dust: THREE.Points;
  private shimmer: THREE.Mesh;
  private wstate: WeatherKind = 'clear';
  private wNext = 0;
  private wT = 0;
  private wDur = 90;
  private flashT = 0;
  private thunderT = 8;
  private fog: THREE.FogExp2;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.fog = new THREE.FogExp2(0x9db2bd, 0.0038);
    scene.fog = this.fog;
    scene.background = new THREE.Color(0x0a1420);

    this.matSky = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x2f6ea8) },
        uHorizon: { value: new THREE.Color(0xbcd3dd) },
        uBottom: { value: new THREE.Color(0x2b3a44) },
        uSunDir: { value: this.sunDir },
        uSunCol: { value: new THREE.Color(0xffe6b8) },
        uNight: { value: 0 },
        uTime: { value: 0 },
        uCloud: { value: 0.15 },
        uHaze: { value: 0 },
        uCloudCol: { value: new THREE.Color(0xdadfe2) },
      },
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), this.matSky);
    dome.frustumCulled = false;
    this.group.add(dome);

    // sun / moon discs and the arc they travel on
    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(11, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff2cc, fog: false }),
    );
    this.moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(7.5, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xdfe7f2, fog: false }),
    );
    this.group.add(this.sunMesh, this.moonMesh);
    const arcGeo = new THREE.TorusGeometry(250, 0.55, 4, 64, Math.PI);
    this.arc = new THREE.Mesh(arcGeo, new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.28, fog: false, depthWrite: false }));
    this.arcTicks = new THREE.Mesh(
      new THREE.TorusGeometry(250, 2.6, 3, 24, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0.22, fog: false, depthWrite: false }),
    );
    this.group.add(this.arc, this.arcTicks);

    // lights
    this.sun = new THREE.DirectionalLight(0xffe9c8, 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -90;
    sc.right = 90;
    sc.top = 90;
    sc.bottom = -90;
    sc.near = 1;
    sc.far = 460;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.6;
    this.moon = new THREE.DirectionalLight(0x8fa8cc, 0.0);
    this.hemi = new THREE.HemisphereLight(0xbcd6e6, 0x6a6152, 0.7);
    this.amb = new THREE.AmbientLight(0xffffff, 0.16);
    this.flash = new THREE.PointLight(0xcfe4ff, 0, 700, 1.2);
    this.group.add(this.sun, this.moon, this.hemi, this.amb, this.flash);
    scene.add(this.sun.target);

    // rain
    const RN = 2600;
    this.rainGeo = new THREE.BufferGeometry();
    const rp = new Float32Array(RN * 6);
    for (let i = 0; i < RN; i++) {
      const x = (Math.random() - 0.5) * 160;
      const y = Math.random() * 70;
      const z = (Math.random() - 0.5) * 160;
      rp.set([x, y, z, x + 0.4, y - 1.9, z + 0.2], i * 6);
    }
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(this.rainGeo, new THREE.LineBasicMaterial({ color: 0xbcd2dc, transparent: true, opacity: 0, fog: true }));
    this.rain.frustumCulled = false;
    this.group.add(this.rain);

    // snow
    const SN = 900;
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(SN * 3);
    for (let i = 0; i < SN; i++) sp.set([(Math.random() - 0.5) * 120, Math.random() * 60, (Math.random() - 0.5) * 120], i * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, transparent: true, opacity: 0, sizeAttenuation: true }));
    this.snow.frustumCulled = false;
    this.group.add(this.snow);

    // airborne dust / sand
    const DN = 700;
    const dg = new THREE.BufferGeometry();
    const dp = new Float32Array(DN * 3);
    for (let i = 0; i < DN; i++) dp.set([(Math.random() - 0.5) * 90, Math.random() * 12, (Math.random() - 0.5) * 90], i * 3);
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xd8bd92, size: 0.9, transparent: true, opacity: 0, sizeAttenuation: true }));
    this.dust.frustumCulled = false;
    this.group.add(this.dust);

    // ground heat shimmer sheet (badlands, midday)
    const shimTex = shimmerTexture();
    this.shimmer = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshBasicMaterial({ map: shimTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    this.shimmer.rotation.x = -Math.PI / 2;
    this.group.add(this.shimmer);
    scene.add(this.group);
  }

  setShadowResolution(px: number): void {
    this.sun.shadow.mapSize.set(px, px);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }

  /** Force a weather state (settings/debug). */
  forceWeather(w: WeatherKind): void {
    this.wstate = w;
    this.wT = 0;
    this.wDur = 120;
  }

  private scheduleWeather(dt: number): void {
    this.wT += dt;
    if (this.wT > this.wDur) {
      this.wT = 0;
      const order: WeatherKind[] = ['clear', 'haze', 'overcast', 'clear', 'fog', 'storm', 'clear', 'overcast'];
      let pick = this.wstate;
      for (let tries = 0; tries < 4 && pick === this.wstate; tries++) pick = order[Math.floor(Math.random() * order.length)];
      this.wstate = pick;
      this.wDur = 70 + Math.random() * 90;
      if (pick === 'storm') this.thunderT = 4 + Math.random() * 8;
    }
    this.weather = this.wstate;
  }

  /** Sun azimuth/elevation for a given hour (6h = east, 12h = high, 18h = west). */
  computeSun(hour: number, out: THREE.Vector3): THREE.Vector3 {
    const ang = ((hour - 6) / 12) * Math.PI;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    out.set(c, s - 0.06, -c * 0.34).normalize();
    return out;
  }

  update(dt: number, cam: THREE.Vector3, target: THREE.Vector3, biome: string): void {
    this.clock += dt;
    this.hour = (this.hour + (dt * 24) / this.dayLen) % 24;
    this.scheduleWeather(dt);
    this.computeSun(this.hour, this.sunDir);
    this.elevation = this.sunDir.y;
    const dayAmt = smoothstep(-0.12, 0.16, this.elevation);
    this.night = 1 - dayAmt;

    // weather blends
    const wTarget = this.wstate;
    const wetT = wTarget === 'storm' ? 1 : wTarget === 'overcast' ? 0.35 : 0;
    const hazeT = wTarget === 'haze' ? 1 : wTarget === 'storm' ? 0.45 : wTarget === 'overcast' ? 0.25 : 0;
    const fogT = wTarget === 'fog' ? 1 : wTarget === 'storm' ? 0.3 : 0;
    this.wet = lerp(this.wet, wetT, 1 - Math.pow(0.35, dt));
    this.haze = lerp(this.haze, hazeT, 1 - Math.pow(0.35, dt));
    this.fogAmt = lerp(this.fogAmt, fogT, 1 - Math.pow(0.4, dt));
    this.wind = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(this.clock * 0.07)) * (0.4 + this.wet * 1.6) + (biome === 'badlands' ? 0.25 : 0);

    // sky colours by time of day
    const dawn = smoothstep(-0.2, 0.12, this.elevation) * (1 - smoothstep(0.12, 0.35, this.elevation));
    const u = this.matSky.uniforms;
    const top = new THREE.Color(0x101a2e).lerp(new THREE.Color(0x2f74ae), dayAmt);
    const hor = new THREE.Color(0x1b2534).lerp(new THREE.Color(0xcfe0e6), dayAmt);
    hor.lerp(new THREE.Color(0xe8955a), dawn * 0.85);
    top.lerp(new THREE.Color(0x7d5f8a), dawn * 0.35);
    const bot = new THREE.Color(0x0a1219).lerp(new THREE.Color(0x3c4a50), dayAmt);
    (u.uTop.value as THREE.Color).copy(top);
    (u.uHorizon.value as THREE.Color).copy(hor);
    (u.uBottom.value as THREE.Color).copy(bot);
    (u.uSunCol.value as THREE.Color).copy(new THREE.Color(0xffb070).lerp(new THREE.Color(0xfff3d8), smoothstep(0.02, 0.4, this.elevation)));
    (u.uCloudCol.value as THREE.Color).copy(new THREE.Color(0x59636e).lerp(new THREE.Color(0xe2e6e8), dayAmt));
    u.uNight.value = this.night;
    u.uTime.value = this.clock;
    u.uCloud.value = lerp(0.16, 0.95, this.wet);
    u.uHaze.value = this.haze;

    // lights
    const sunI = Math.max(0, this.elevation) * 2.5 * (1 - this.wet * 0.72) * (1 - this.fogAmt * 0.4);
    this.sun.intensity = sunI;
    this.sun.color.setRGB(
      lerp(1.0, 1.0, dayAmt),
      lerp(0.66, 0.94, smoothstep(0, 0.35, this.elevation)),
      lerp(0.42, 0.86, smoothstep(0, 0.35, this.elevation)),
    );
    this.sun.position.copy(this.sunDir).multiplyScalar(170).add(target);
    this.sun.target.position.copy(target);
    this.moon.intensity = this.night * 0.28 * (1 - this.wet * 0.6);
    this.moon.position.copy(this.sunDir).multiplyScalar(-170).add(target);
    this.hemi.intensity = lerp(0.22, 0.78, dayAmt) * (1 - this.fogAmt * 0.3) + this.wet * 0.12;
    (this.hemi.color as THREE.Color).copy(hor);
    (this.hemi.groundColor as THREE.Color).set(biome === 'badlands' ? 0x8a5236 : biome === 'alpine' ? 0xb9c6cf : biome === 'wetland' ? 0x40532f : 0x6a6152);
    this.amb.intensity = lerp(0.12, 0.2, dayAmt) + this.wet * 0.08;

    // fog: biome tint + time of day + weather
    const fc = new THREE.Color(biome === 'badlands' ? 0xb99277 : biome === 'alpine' ? 0xa9bcc9 : biome === 'wetland' ? 0x7f8f78 : biome === 'rock' ? 0x8e8b84 : 0x9db2bd);
    fc.lerp(new THREE.Color(0x1a2530), this.night * 0.82);
    fc.lerp(new THREE.Color(0x6c767e), this.wet * 0.6);
    fc.lerp(new THREE.Color(0xc9cfd3), this.fogAmt * 0.7);
    this.fogColor.copy(fc);
    this.fog.color.copy(fc);
    this.fog.density = 0.0026 + this.fogAmt * 0.016 + this.haze * 0.0032 + this.wet * 0.0022 + (biome === 'wetland' ? 0.0012 : 0) + this.night * 0.0016;
    this.scene.background = this.fogColor;

    // sun/moon/arc placement
    this.group.position.copy(cam);
    this.sunMesh.position.copy(this.sunDir).multiplyScalar(250);
    this.moonMesh.position.copy(this.sunDir).multiplyScalar(-250);
    const arcRot = Math.atan2(this.sunDir.z, this.sunDir.x);
    const tilt = -Math.asin(clamp(this.sunDir.y, -1, 1));
    this.arc.rotation.set(0, 0, 0);
    this.arc.rotateY(-arcRot + Math.PI / 2);
    this.arc.rotateX(Math.PI / 2 - 0.34);
    this.arc.visible = true;
    (this.arc.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.16 * (1 - this.wet);
    this.arcTicks.rotation.copy(this.arc.rotation);
    this.arcTicks.visible = this.quality > 0;
    const sm = this.sunMesh.material as THREE.MeshBasicMaterial;
    sm.color.setRGB(1, lerp(0.72, 0.96, smoothstep(0, 0.3, this.elevation)), lerp(0.5, 0.9, smoothstep(0, 0.3, this.elevation)));
    this.moonMesh.visible = this.night > 0.05;

    // particles
    const rainMat = this.rain.material as THREE.LineBasicMaterial;
    const wantRain = this.wet > 0.12 ? this.quality === 0 ? 1200 : 2600 : 0;
    rainMat.opacity = this.wet * 0.5;
    if (wantRain) {
      const pos = this.rainGeo.attributes.position.array as Float32Array;
      const n = wantRain;
      const fall = 62 * dt;
      const drift = this.wind * 9 * dt;
      for (let i = 0; i < n; i++) {
        const o = i * 6;
        pos[o + 1] -= fall;
        pos[o + 4] -= fall;
        pos[o] += drift;
        pos[o + 3] += drift;
        if (pos[o + 1] < -18) {
          const x = (Math.random() - 0.5) * 160;
          const z = (Math.random() - 0.5) * 160;
          pos[o] = x;
          pos[o + 1] = 52;
          pos[o + 2] = z;
          pos[o + 3] = x + 0.3;
          pos[o + 4] = 50;
          pos[o + 5] = z + 0.1;
        }
      }
      this.rainGeo.attributes.position.needsUpdate = true;
      this.rain.visible = true;
    } else this.rain.visible = false;

    const alpine = biome === 'alpine';
    const snowMat = this.snow.material as THREE.PointsMaterial;
    snowMat.opacity = alpine ? 0.75 * (1 - this.night * 0.4) : 0;
    this.snow.visible = alpine;
    if (alpine) {
      const pos = this.snow.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < pos.length; i += 3) {
        pos[i + 1] -= 6 * dt;
        pos[i] += Math.sin(this.clock + i) * 1.6 * dt;
        if (pos[i + 1] < -10) {
          pos[i] = (Math.random() - 0.5) * 120;
          pos[i + 1] = 46;
          pos[i + 2] = (Math.random() - 0.5) * 120;
        }
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }

    const bad = biome === 'badlands';
    const dustMat = this.dust.material as THREE.PointsMaterial;
    const dustAmt = (bad ? 0.5 : 0.12) * (1 - this.wet) * (0.4 + this.wind * 0.8);
    dustMat.opacity = dustAmt * 0.6;
    this.dust.visible = dustAmt > 0.02;
    if (this.dust.visible) {
      const pos = this.dust.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < pos.length; i += 3) {
        pos[i] += (2.5 + this.wind * 9) * dt;
        pos[i + 1] += Math.sin(this.clock * 1.3 + i) * 0.6 * dt;
        if (pos[i] > 45) {
          pos[i] = -45;
          pos[i + 1] = Math.random() * 12;
          pos[i + 2] = (Math.random() - 0.5) * 90;
        }
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
    }

    // heat shimmer in the badlands by day
    const shimMat = this.shimmer.material as THREE.MeshBasicMaterial;
    const shimAmt = (bad ? 1 : 0.15) * smoothstep(0.25, 0.7, this.elevation) * (1 - this.wet);
    shimMat.opacity = shimAmt * 0.1;
    this.shimmer.visible = shimAmt > 0.02;
    if (this.shimmer.visible) {
      this.shimmer.position.set(cam.x, cam.y - 6, cam.z);
      (shimMat.map as THREE.Texture).offset.x += dt * 0.35;
      (shimMat.map as THREE.Texture).offset.y += dt * 0.21;
    }

    // lightning
    if (this.wet > 0.5) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) {
        this.thunderT = 5 + Math.random() * 12;
        this.flashT = 0.5;
        if (this.onThunder) this.onThunder();
      }
    }
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      this.flash.intensity = Math.pow(this.flashT / 0.5, 2) * 900;
      this.flash.position.set(cam.x + 90, 190, cam.z - 60);
    } else this.flash.intensity = 0;
  }

  /** 0..1 darkness factor (1 = pitch night). */
  darkness(): number {
    return clamp(this.night, 0, 1);
  }

  label(): string {
    const w = this.weather.charAt(0).toUpperCase() + this.weather.slice(1);
    return w;
  }
}

function shimmerTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(64, 64);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const v = 0.5 + 0.5 * Math.sin(x * 0.5 + Math.sin(y * 0.31) * 2.2);
        const i = (y * 64 + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 230;
        img.data[i + 2] = 200;
        img.data[i + 3] = Math.floor(v * 70);
      }
    ctx.putImageData(img, 0, 0);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  return t;
}

/** Ambient wind / atmosphere audio level for a biome. */
export function windLevel(biome: string): number {
  return biome === 'alpine' ? 0.8 : biome === 'badlands' ? 0.65 : biome === 'wetland' ? 0.35 : 0.45;
}

void TAU;
void fbm;
void BOUND;
void clamp;
