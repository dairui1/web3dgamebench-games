import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Course } from './course';

const SEGMENTS = 640;

/** Builds one continuous tube of radius `tubeRadius` riding the corridor wall. */
function buildRail(course: Course, angle: number, tubeRadius: number, radial = 5): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const center = new THREE.Vector3();
  const n = new THREE.Vector3();
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  for (let i = 0; i <= SEGMENTS; i++) {
    const d = (i / SEGMENTS) * course.length;
    const f = course.frameAt(d);
    center
      .copy(f.pos)
      .addScaledVector(f.right, course.radiusX * cos)
      .addScaledVector(f.up, course.radiusY * sin);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      n.copy(f.right).multiplyScalar(Math.cos(a)).addScaledVector(f.up, Math.sin(a));
      positions.push(
        center.x + n.x * tubeRadius,
        center.y + n.y * tubeRadius,
        center.z + n.z * tubeRadius,
      );
      normals.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < SEGMENTS; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const b = i * radial + ((k + 1) % radial);
      const c = a + radial;
      const d = b + radial;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

/** Inside-facing shell used to draw the corridor boundary. */
function buildShell(course: Course, radialCount = 26): THREE.BufferGeometry {
  const positions: number[] = [];
  const params: number[] = [];
  const indices: number[] = [];
  const p = new THREE.Vector3();

  for (let i = 0; i <= SEGMENTS; i++) {
    const u = i / SEGMENTS;
    const f = course.frameAt(u * course.length);
    for (let k = 0; k <= radialCount; k++) {
      const a = (k / radialCount) * Math.PI * 2;
      p.copy(f.pos)
        .addScaledVector(f.right, Math.cos(a) * course.radiusX)
        .addScaledVector(f.up, Math.sin(a) * course.radiusY);
      positions.push(p.x, p.y, p.z);
      params.push(u * course.length, k / radialCount);
    }
  }
  const stride = radialCount + 1;
  for (let i = 0; i < SEGMENTS; i++) {
    for (let k = 0; k < radialCount; k++) {
      const a = i * stride + k;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aParam', new THREE.Float32BufferAttribute(params, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * All static corridor dressing: rails, hoops, chevrons, the boundary shell and
 * the wrecked structures that make the relay field read as a place.
 */
export class Track {
  readonly group = new THREE.Group();

  private readonly shellUniforms = {
    uTime: { value: 0 },
    uPlayer: { value: 0 },
    uHeat: { value: 0 },
    uLength: { value: 1 },
    uColor: { value: new THREE.Color(0x49e0ff) },
    uWarn: { value: new THREE.Color(0xff5a4a) },
  };

  private readonly chevronMaterial: THREE.MeshStandardMaterial;
  private readonly lampMaterial: THREE.MeshStandardMaterial;

  constructor(course: Course, rng: Rng) {
    this.shellUniforms.uLength.value = course.length;

    // --- corridor boundary shell -------------------------------------------
    const shell = new THREE.Mesh(
      buildShell(course),
      new THREE.ShaderMaterial({
        uniforms: this.shellUniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec2 aParam;
          varying vec2 vParam;
          varying vec3 vView;
          varying vec3 vWorld;
          void main() {
            vParam = aParam;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            vView = normalize(cameraPosition - wp.xyz);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uPlayer; uniform float uHeat; uniform float uLength;
          uniform vec3 uColor; uniform vec3 uWarn;
          varying vec2 vParam;
          varying vec3 vView;
          varying vec3 vWorld;
          void main() {
            float along = vParam.x;
            float ring = abs(fract(along / 9.0 + uTime * 0.05) - 0.5) * 2.0;
            float rib = smoothstep(0.86, 1.0, ring);
            float spoke = smoothstep(0.90, 1.0, abs(fract(vParam.y * 13.0) - 0.5) * 2.0);
            float grid = max(rib * 0.85, spoke * 0.35);

            float d = abs(along - uPlayer);
            d = min(d, uLength - d);
            float near = exp(-d * d / 5200.0);

            float dist = length(vWorld - cameraPosition);
            float falloff = exp(-dist * 0.0035);

            vec3 col = mix(uColor, uWarn, clamp(uHeat, 0.0, 1.0));
            float a = grid * (0.10 + near * 0.55) * falloff;
            a += near * 0.05 * falloff;
            a *= 1.0 + uHeat * 1.2;
            gl_FragColor = vec4(col * (0.6 + uHeat), clamp(a, 0.0, 1.0));
          }
        `,
      }),
    );
    shell.frustumCulled = false;
    this.group.add(shell);

    // --- structural rails ---------------------------------------------------
    const railMaterial = new THREE.MeshStandardMaterial({
      color: 0x2c3644,
      roughness: 0.55,
      metalness: 0.75,
      emissive: 0x0b2b3a,
      emissiveIntensity: 0.8,
    });
    const glowMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a1a22,
      roughness: 0.3,
      metalness: 0.2,
      emissive: 0x37d6ff,
      emissiveIntensity: 1.5,
    });
    const railAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
    for (const a of railAngles) {
      const rail = new THREE.Mesh(buildRail(course, a, 0.62), railMaterial);
      rail.frustumCulled = false;
      this.group.add(rail);
    }
    for (const a of [Math.PI * 1.5, Math.PI * 0.5]) {
      const strip = new THREE.Mesh(buildRail(course, a, 0.2), glowMaterial);
      strip.frustumCulled = false;
      this.group.add(strip);
    }

    // --- hoops --------------------------------------------------------------
    const hoopSpacing = 24;
    const hoopCount = Math.floor(course.length / hoopSpacing);
    const intactGeo = new THREE.TorusGeometry(1, 0.05, 5, 40);
    const brokenGeo = new THREE.TorusGeometry(1, 0.07, 5, 30, Math.PI * 1.25);
    const hoopMaterial = new THREE.MeshStandardMaterial({
      color: 0x39485c,
      roughness: 0.42,
      metalness: 0.85,
      emissive: 0x11414f,
      emissiveIntensity: 0.7,
    });
    const intact = new THREE.InstancedMesh(intactGeo, hoopMaterial, hoopCount);
    const broken = new THREE.InstancedMesh(brokenGeo, hoopMaterial, hoopCount);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const roll = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    let intactUsed = 0;
    let brokenUsed = 0;
    for (let i = 0; i < hoopCount; i++) {
      const d = i * hoopSpacing;
      const f = course.frameAt(d);
      course.orientationFromFrame(f, q);
      const damaged = rng.next() < 0.32;
      if (damaged) roll.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rng.range(0, Math.PI * 2));
      else roll.identity();
      q.multiply(roll);
      const wobble = damaged ? rng.range(0.9, 1.06) : 1;
      scale.set(course.radiusX * wobble, course.radiusY * wobble, course.radiusX);
      m.compose(f.pos, q, scale);
      color.setHSL(0.52 + rng.spread(0.05), 0.5, damaged ? 0.16 : 0.34);
      if (damaged) {
        broken.setMatrixAt(brokenUsed, m);
        broken.setColorAt(brokenUsed, color);
        brokenUsed++;
      } else {
        intact.setMatrixAt(intactUsed, m);
        intact.setColorAt(intactUsed, color);
        intactUsed++;
      }
    }
    intact.count = intactUsed;
    broken.count = brokenUsed;
    intact.frustumCulled = false;
    broken.frustumCulled = false;
    this.group.add(intact, broken);

    // --- floor chevrons: which way is forward -------------------------------
    this.chevronMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a1c0c,
      emissive: 0xffa83a,
      emissiveIntensity: 1.2,
      roughness: 0.4,
      metalness: 0.1,
    });
    const chevSpacing = 12;
    const chevCount = Math.floor(course.length / chevSpacing);
    const chevrons = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.9, 2.4, 3),
      this.chevronMaterial,
      chevCount * 2,
    );
    const chevQuat = new THREE.Quaternion();
    const noseDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    let chevIndex = 0;
    for (let i = 0; i < chevCount; i++) {
      const d = i * chevSpacing;
      const f = course.frameAt(d);
      course.orientationFromFrame(f, chevQuat);
      chevQuat.multiply(noseDown);
      for (const side of [-1, 1]) {
        const pos = new THREE.Vector3()
          .copy(f.pos)
          .addScaledVector(f.right, side * course.radiusX * 0.55)
          .addScaledVector(f.up, -course.radiusY * 0.88);
        m.compose(pos, chevQuat, scale.set(1, 1, 1));
        chevrons.setMatrixAt(chevIndex++, m);
      }
    }
    chevrons.count = chevIndex;
    chevrons.frustumCulled = false;
    this.group.add(chevrons);

    // --- lamps on the outer rail --------------------------------------------
    this.lampMaterial = new THREE.MeshStandardMaterial({
      color: 0x102028,
      emissive: 0x6fe9ff,
      emissiveIntensity: 1.3,
      roughness: 0.3,
      metalness: 0.4,
    });
    const lampSpacing = 48;
    const lampCount = Math.floor(course.length / lampSpacing) * 2;
    const lamps = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.55, 8, 6),
      this.lampMaterial,
      lampCount,
    );
    let lampIndex = 0;
    for (let i = 0; i * lampSpacing < course.length; i++) {
      const f = course.frameAt(i * lampSpacing);
      for (const side of [-1, 1]) {
        const pos = new THREE.Vector3()
          .copy(f.pos)
          .addScaledVector(f.right, side * course.radiusX * 0.98)
          .addScaledVector(f.up, course.radiusY * 0.2);
        m.compose(pos, q.identity(), scale.set(1, 1, 1));
        if (lampIndex < lampCount) lamps.setMatrixAt(lampIndex++, m);
      }
    }
    lamps.count = lampIndex;
    lamps.frustumCulled = false;
    this.group.add(lamps);

    // --- wrecked structures hanging outside the corridor --------------------
    const debrisMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a4152,
      roughness: 0.85,
      metalness: 0.35,
      flatShading: true,
    });
    const debrisCount = 420;
    const debris = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      debrisMaterial,
      debrisCount,
    );
    for (let i = 0; i < debrisCount; i++) {
      const d = rng.range(0, course.length);
      const angle = rng.range(0, Math.PI * 2);
      const dist = rng.range(1.55, 6.5);
      const pos = new THREE.Vector3();
      course.toWorld(
        d,
        Math.cos(angle) * course.radiusX * dist,
        Math.sin(angle) * course.radiusY * dist + rng.spread(30),
        pos,
      );
      q.setFromEuler(new THREE.Euler(rng.range(0, 6.3), rng.range(0, 6.3), rng.range(0, 6.3)));
      const s = rng.range(1.2, 7.5);
      m.compose(pos, q, scale.set(s, s * rng.range(0.5, 1.4), s * rng.range(0.6, 1.6)));
      debris.setMatrixAt(i, m);
      color.setHSL(0.58 + rng.spread(0.06), 0.18, rng.range(0.12, 0.34));
      debris.setColorAt(i, color);
    }
    debris.frustumCulled = false;
    this.group.add(debris);

    // --- distant relay pylons ------------------------------------------------
    const towerMaterial = new THREE.MeshStandardMaterial({
      color: 0x27303e,
      roughness: 0.7,
      metalness: 0.6,
      emissive: 0x18313d,
      emissiveIntensity: 0.6,
    });
    const towerCount = 26;
    const towers = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1.4, 3.2, 40, 6, 1, true),
      towerMaterial,
      towerCount * 2,
    );
    let towerIndex = 0;
    for (let i = 0; i < towerCount; i++) {
      const d = (i / towerCount) * course.length + rng.spread(20);
      const side = rng.next() < 0.5 ? -1 : 1;
      const pos = new THREE.Vector3();
      course.toWorld(d, side * rng.range(70, 210), rng.range(-120, -40), pos);
      q.setFromEuler(new THREE.Euler(rng.spread(0.25), rng.range(0, 6.3), rng.spread(0.25)));
      const s = rng.range(0.8, 2.4);
      m.compose(pos, q, scale.set(s, rng.range(1.4, 4.5), s));
      towers.setMatrixAt(towerIndex++, m);
    }
    towers.count = towerIndex;
    towers.frustumCulled = false;
    this.group.add(towers);
  }

  update(elapsed: number, playerDistance: number, wallHeat: number): void {
    this.shellUniforms.uTime.value = elapsed;
    this.shellUniforms.uPlayer.value = playerDistance;
    this.shellUniforms.uHeat.value = wallHeat;
    this.chevronMaterial.emissiveIntensity = 1.1 + Math.sin(elapsed * 4) * 0.4;
    this.lampMaterial.emissiveIntensity = 1.2 + Math.sin(elapsed * 2.3) * 0.35;
  }
}
