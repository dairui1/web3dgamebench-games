import * as THREE from 'three';
import { Rng } from '../core/mathutil';
import { WORLD, pathX } from './terrain';

export const FOG_COLOR = new THREE.Color(0xc9a37a);
export const SUN_DIR = new THREE.Vector3(-0.42, 0.46, 0.78).normalize();

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const skyFrag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.62));
  col = mix(col, uBottom, pow(clamp(-h, 0.0, 1.0), 0.5));
  float sd = max(dot(dir, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sd, 14.0) * 0.55;
  col += uSunColor * pow(sd, 220.0) * 2.4;
  col += uSunColor * pow(sd, 3.0) * 0.09;
  col = clamp(col, 0.0, 1.0);
  // Manual linear -> sRGB encode (raw shader, no output pass).
  col = mix(col * 12.92, 1.055 * pow(col, vec3(0.41666)) - 0.055, step(vec3(0.0031308), col));
  gl_FragColor = vec4(col, 1.0);
}
`;

function cloudTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = new Rng(9182);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const r = rng.range(22, 58);
    const x = rng.range(r, size - r);
    const y = rng.range(size * 0.3, size * 0.72);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.5, 'rgba(255,250,242,0.22)');
    g.addColorStop(1, 'rgba(255,250,242,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface SkyBuild {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  clouds: THREE.Group;
}

export function buildSky(scene: THREE.Scene): SkyBuild {
  const group = new THREE.Group();

  const domeMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(0x2c5f96) },
      uHorizon: { value: new THREE.Color(0xe6b483) },
      uBottom: { value: new THREE.Color(0x6a5340) },
      uSunDir: { value: SUN_DIR.clone() },
      uSunColor: { value: new THREE.Color(0xffd9a0) },
    },
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 20), domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -100;
  group.add(dome);

  // Clouds: soft billboards drifting above the canyon.
  const clouds = new THREE.Group();
  const tex = cloudTexture();
  const rng = new Rng(4242);
  const cloudMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
    fog: false,
  });
  for (let i = 0; i < 46; i++) {
    const z = rng.range(WORLD.zMin, WORLD.zMax);
    const s = rng.range(700, 1900);
    const sprite = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.5), cloudMat);
    sprite.position.set(pathX(z) + rng.range(-2600, 2600), rng.range(1500, 2900), z);
    sprite.userData.drift = rng.range(3, 9);
    sprite.renderOrder = -90;
    clouds.add(sprite);
  }
  group.add(clouds);

  scene.add(group);

  const hemi = new THREE.HemisphereLight(0xcfe1ff, 0x6b5033, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe3b8, 2.15);
  sun.position.copy(SUN_DIR).multiplyScalar(1200);
  scene.add(sun);
  scene.add(sun.target);
  const rim = new THREE.DirectionalLight(0x88a6ff, 0.45);
  rim.position.set(SUN_DIR.x * -900, 400, SUN_DIR.z * -900);
  scene.add(rim);

  scene.fog = new THREE.FogExp2(FOG_COLOR.getHex(), 0.00042);
  scene.background = null;

  return { group, sun, clouds };
}

export function updateSky(sky: SkyBuild, camera: THREE.Camera, dt: number): void {
  sky.group.position.set(camera.position.x, 0, camera.position.z);
  for (const c of sky.clouds.children) {
    c.position.x += (c.userData.drift as number) * dt;
    c.quaternion.copy(camera.quaternion);
    if (c.position.x > camera.position.x + 3200) c.position.x -= 6400;
    if (c.position.x < camera.position.x - 3200) c.position.x += 6400;
  }
  sky.sun.position.copy(SUN_DIR).multiplyScalar(1200).add(camera.position);
  sky.sun.target.position.copy(camera.position);
  sky.sun.target.updateMatrixWorld();
}
