// Procedural canyon world: terrain mesh with analytic height sampling,
// gradient sky dome, fog, lighting, clouds and scattered rocks.

import * as THREE from 'three';
import { makeRng, randRange, smoothstep } from './utils';

/** Canyon centerline x-offset for a given z (meandering valley). */
export function canyonCenterX(z: number): number {
  return 260 * Math.sin(z * 0.0012) + 150 * Math.sin(z * 0.0031 + 1.7);
}

/** Canyon half width at z. */
export function canyonHalfWidth(z: number): number {
  return 330 + 90 * Math.sin(z * 0.0009 + 2.0);
}

/** Cheap analytic pseudo-noise (deterministic, smooth enough for terrain). */
function noise2(x: number, z: number): number {
  return (
    Math.sin(x * 0.011 + z * 0.013) * 6 +
    Math.sin(x * 0.023 - z * 0.017 + 1.3) * 4 +
    Math.sin(x * 0.043 + z * 0.031 + 2.1) * 2 +
    Math.sin(x * 0.007 - z * 0.005) * 9
  );
}

/** Full terrain height at any (x, z). Used for mesh generation AND collisions. */
export function terrainHeight(x: number, z: number): number {
  const cx = canyonCenterX(z);
  const d = Math.abs(x - cx);
  const floor =
    10 * Math.sin(z * 0.005) + 14 * Math.sin(z * 0.0021 + 0.5) + noise2(x, z) * 0.5;
  const hw = canyonHalfWidth(z);
  // Wall rise: starts at hw - 70, fully risen at hw + 90.
  const wallT = smoothstep(hw - 70, hw + 90, d);
  const wallH = 230 + 120 * Math.sin(z * 0.0017 + 1.0) + noise2(x * 2.1, z * 1.7) * 6;
  // Beyond the walls, mountains keep climbing.
  const outer = Math.max(0, d - (hw + 90));
  const mountain = outer * 0.35 * (1 + 0.4 * Math.sin(z * 0.003 + x * 0.002)) +
    noise2(x * 0.9 + 100, z * 0.9) * Math.min(1, outer * 0.01);
  return floor + wallT * (wallH + 60) + wallT * wallT * mountain;
}

export class World {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private clouds: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    scene.fog = new THREE.Fog(0xa8c4de, 900, 4200);

    const hemi = new THREE.HemisphereLight(0xbfd8f2, 0x5a5340, 0.9);
    scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    this.sun.position.set(600, 900, 400);
    scene.add(this.sun);

    scene.add(this.buildSky());
    scene.add(this.buildTerrain());
    scene.add(this.buildWater());
    this.scatterRocks();
    this.buildClouds();
  }

  private buildSky(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(7000, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x2e5f9e) },
        mid: { value: new THREE.Color(0x9cc0e8) },
        bottom: { value: new THREE.Color(0xe8d9b8) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vPos;
        uniform vec3 top;
        uniform vec3 mid;
        uniform vec3 bottom;
        void main() {
          float h = normalize(vPos).y;
          vec3 c = h > 0.12
            ? mix(mid, top, smoothstep(0.12, 0.75, h))
            : mix(bottom, mid, smoothstep(-0.15, 0.12, h));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  private buildTerrain(): THREE.Mesh {
    const sizeX = 4200;
    const sizeZ = 11000;
    const segX = 150;
    const segZ = 330;
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);

    const cGrass = new THREE.Color(0x61703a);
    const cGrass2 = new THREE.Color(0x7a8046);
    const cRock = new THREE.Color(0x8a7a63);
    const cRock2 = new THREE.Color(0x6e6152);
    const cSnow = new THREE.Color(0xeef1f4);
    const cDirt = new THREE.Color(0x9d8a5e);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);

      // Slope estimate for rockiness.
      const e = 6;
      const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
      const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
      const slope = Math.min(1, Math.sqrt(hx * hx + hz * hz) / (2 * e) / 1.1);

      const band = (Math.sin(x * 0.05 + z * 0.037) + 1) * 0.5;
      tmp.copy(cGrass).lerp(cGrass2, band);
      const rockC = tmp.clone().copy(cRock).lerp(cRock2, band);
      tmp.lerp(rockC, smoothstep(0.25, 0.6, slope));
      // Snow above ~430m.
      tmp.lerp(cSnow, smoothstep(400, 500, h + noise2(x * 3, z * 3) * 10));
      // Dirt near the river bed.
      const cx = canyonCenterX(z);
      const d = Math.abs(x - cx);
      tmp.lerp(cDirt, smoothstep(60, 24, d) * 0.6);

      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    return mesh;
  }

  /** A simple translucent river strip hugging the canyon floor. */
  private buildWater(): THREE.Mesh {
    const len = 11000;
    const shape: THREE.Vector2[] = [];
    for (let i = 0; i <= 100; i++) {
      const z = 5500 - (len * i) / 100;
      const cx = canyonCenterX(z);
      shape.push(new THREE.Vector2(cx - 22, z));
    }
    for (let i = 100; i >= 0; i--) {
      const z = 5500 - (len * i) / 100;
      const cx = canyonCenterX(z);
      shape.push(new THREE.Vector2(cx + 22, z));
    }
    const geo = new THREE.BufferGeometry();
    const verts: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < shape.length; i++) {
      // Follow the canyon floor so the river never sinks below terrain.
      const y = terrainHeight(shape[i].x, shape[i].y) + 1.6;
      verts.push(shape[i].x, y, shape[i].y);
    }
    for (let i = 0; i < 100; i++) {
      const a = i;
      const b = i + 1;
      const c = 101 + i;
      const d = 102 + i;
      idx.push(a, c, b, b, c, d);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({
      color: 0x3f6f86,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
    });
    return new THREE.Mesh(geo, mat);
  }

  private scatterRocks(): void {
    const rng = makeRng(1337);
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0x77694f });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < 90; i++) {
      const z = randRange(rng, -4600, 4600);
      const cx = canyonCenterX(z);
      const side = rng() > 0.5 ? 1 : -1;
      const x = cx + side * randRange(rng, 120, canyonHalfWidth(z) - 90);
      const y = terrainHeight(x, z);
      const s = randRange(rng, 6, 26);
      const rock = new THREE.Mesh(rockGeo, mat);
      rock.position.set(x, y + s * 0.2, z);
      q.setFromEuler(
        new THREE.Euler(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI),
      );
      m.compose(
        rock.position,
        q,
        new THREE.Vector3(s, s * randRange(rng, 0.6, 1.3), s),
      );
      rock.applyMatrix4(m);
      this.group.add(rock);
    }
  }

  private buildClouds(): void {
    const rng = makeRng(777);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      fog: true,
    });
    const geo = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 26; i++) {
      const cluster = new THREE.Group();
      const n = 3 + Math.floor(rng() * 3);
      for (let j = 0; j < n; j++) {
        const puff = new THREE.Mesh(geo, mat);
        const s = randRange(rng, 60, 140);
        puff.scale.set(s, s * 0.45, s);
        puff.position.set(
          randRange(rng, -90, 90),
          randRange(rng, -12, 12),
          randRange(rng, -70, 70),
        );
        cluster.add(puff);
      }
      cluster.position.set(
        randRange(rng, -1600, 1600),
        randRange(rng, 520, 760),
        randRange(rng, -4800, 4800),
      );
      this.clouds.push(cluster as unknown as THREE.Mesh);
      this.group.add(cluster);
    }
  }

  update(dt: number, planeZ: number): void {
    void dt;
    // Keep sky dome centered on the player's depth so it never clips.
    void planeZ;
  }
}
