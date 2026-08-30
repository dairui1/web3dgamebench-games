import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Course } from './course';
import { makeSkyGradientTexture, makeSoftDotTexture } from './textures';
import { mulberry32, makeRandRange } from './rng';

export interface GateVisual {
  group: THREE.Group;
  ring: THREE.Mesh;
  ringMat: THREE.MeshStandardMaterial;
  glow: THREE.PointLight;
}

export interface HazardVisual {
  mesh: THREE.Mesh;
}

export interface Environment {
  cloudMaterial: THREE.ShaderMaterial;
  gateVisuals: GateVisual[];
  extractionVisual: GateVisual;
  hazardVisuals: HazardVisual[];
  orbInstanced: THREE.InstancedMesh;
  starPoints: THREE.Points;
  update(time: number, playerPos: THREE.Vector3): void;
}

const dummy = new THREE.Object3D();

function buildGateVisual(radius: number, color: number): GateVisual {
  const group = new THREE.Group();
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x777d88,
    emissive: color,
    emissiveIntensity: 0.15,
    metalness: 0.6,
    roughness: 0.35,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.45, 12, 48), ringMat);
  group.add(ring);

  const spire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.6, radius + 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.5, roughness: 0.6 }),
  );
  spire.position.y = -(radius + 4) / 2 - radius * 0.15;
  group.add(spire);

  const glow = new THREE.PointLight(color, 0, 30, 2);
  glow.position.set(0, 0, 0);
  group.add(glow);

  return { group, ring, ringMat, glow };
}

export function buildEnvironment(scene: THREE.Scene, course: Course, seed: number): Environment {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const rand = makeRandRange(rng);

  // Sky dome
  const skyTex = makeSkyGradientTexture();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  scene.add(sky);

  // Cloud sea far below the corridor
  const cloudGeo = new THREE.PlaneGeometry(3600, 3600, 1, 1);
  const cloudMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorLow: { value: new THREE.Color(0x0d1b2e) },
      uColorHigh: { value: new THREE.Color(0x6f93b8) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColorLow;
      uniform vec3 uColorHigh;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash(i); float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0)); float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }
      float fbm(vec2 p) {
        float v = 0.0; float amp = 0.5;
        for (int i = 0; i < 5; i++) { v += amp * noise(p); p *= 2.02; amp *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vUv * 10.0 + vec2(uTime * 0.015, uTime * 0.007);
        float n = fbm(p);
        float n2 = fbm(p * 2.3 + 5.0);
        float v = clamp(n * 0.7 + n2 * 0.3, 0.0, 1.0);
        vec3 col = mix(uColorLow, uColorHigh, v);
        float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
        col *= 0.55 + 0.45 * edge;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    fog: false,
  });
  const cloudSea = new THREE.Mesh(cloudGeo, cloudMaterial);
  cloudSea.rotation.x = -Math.PI / 2;
  cloudSea.position.y = -160;
  scene.add(cloudSea);

  // Starfield above
  const starGeo = new THREE.BufferGeometry();
  const starCount = 900;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = rand(500, 1300);
    const theta = rand(0, Math.PI * 2);
    const phi = rand(0.05, 0.8);
    starPos[i * 3] = Math.cos(theta) * Math.sin(phi) * r;
    starPos[i * 3 + 1] = Math.cos(phi) * r * 0.7 + 200;
    starPos[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const dotTex = makeSoftDotTexture();
  const starMat = new THREE.PointsMaterial({
    size: 3.2,
    map: dotTex,
    transparent: true,
    opacity: 0.75,
    color: 0xbfe0ff,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const starPoints = new THREE.Points(starGeo, starMat);
  scene.add(starPoints);

  // Gates
  const gateColor = 0x2ad8ff;
  const gateVisuals: GateVisual[] = course.gates.map((g) => {
    const gv = buildGateVisual(g.radius, gateColor);
    const frame = course.getFrame(g.t);
    gv.group.position.copy(frame.position);
    gv.group.lookAt(frame.position.clone().add(frame.tangent));
    scene.add(gv.group);
    return gv;
  });

  const extractionVisual = buildGateVisual(course.extraction.radius, 0xffc94d);
  {
    const frame = course.getFrame(course.extraction.t);
    extractionVisual.group.position.copy(frame.position);
    extractionVisual.group.lookAt(frame.position.clone().add(frame.tangent));
    extractionVisual.ring.scale.setScalar(1.0);
    scene.add(extractionVisual.group);
  }

  // Hazards: jagged rocks with displaced vertices
  const hazardMat = new THREE.MeshStandardMaterial({
    color: 0x3a2530,
    emissive: 0xff3355,
    emissiveIntensity: 0.35,
    roughness: 0.85,
    metalness: 0.1,
    flatShading: true,
  });
  const hazardVisuals: HazardVisual[] = course.hazards.map((h) => {
    const geo = new THREE.IcosahedronGeometry(h.radius, 1);
    const posAttr = geo.getAttribute('position');
    const hazardRng = mulberry32(Math.floor(h.t * 100000) + Math.floor(h.u * 37));
    for (let i = 0; i < posAttr.count; i++) {
      const nx = posAttr.getX(i);
      const ny = posAttr.getY(i);
      const nz = posAttr.getZ(i);
      const scale = 0.78 + hazardRng() * 0.42;
      posAttr.setXYZ(i, nx * scale, ny * scale, nz * scale);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, hazardMat);
    scene.add(mesh);
    return { mesh };
  });

  // Orbs: instanced octahedra
  const orbGeo = new THREE.OctahedronGeometry(0.65, 0);
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0x7fffe0,
    emissive: 0x35ffd0,
    emissiveIntensity: 1.8,
    metalness: 0.3,
    roughness: 0.2,
  });
  const orbInstanced = new THREE.InstancedMesh(orbGeo, orbMat, Math.max(1, course.orbs.length));
  orbInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(orbInstanced);

  // Pylons: merged shaft+cap geometry, instanced
  const shaft = new THREE.CylinderGeometry(0.18, 0.28, 1, 6);
  shaft.translate(0, 0.5, 0);
  const cap = new THREE.SphereGeometry(0.32, 8, 8);
  cap.translate(0, 1, 0);
  const pylonGeo = mergeGeometries([shaft, cap]);
  const pylonMat = new THREE.MeshStandardMaterial({
    color: 0x232833,
    emissive: 0x2ad8ff,
    emissiveIntensity: 0.9,
    metalness: 0.4,
    roughness: 0.5,
  });
  const pylonInstanced = new THREE.InstancedMesh(pylonGeo, pylonMat, Math.max(1, course.pylons.length));
  course.pylons.forEach((p, i) => {
    const frame = course.getFrame(p.t);
    const pos = frame.position.clone().addScaledVector(frame.right, p.side * course.corridorRadius);
    dummy.position.copy(pos);
    dummy.scale.set(1, p.height, 1);
    dummy.quaternion.identity();
    dummy.updateMatrix();
    pylonInstanced.setMatrixAt(i, dummy.matrix);
  });
  pylonInstanced.instanceMatrix.needsUpdate = true;
  scene.add(pylonInstanced);

  function update(time: number, _playerPos: THREE.Vector3): void {
    cloudMaterial.uniforms.uTime.value = time;
    starPoints.rotation.y = time * 0.004;

    course.orbs.forEach((orb, i) => {
      if (orb.collected) {
        dummy.scale.setScalar(0);
        dummy.position.set(0, -9999, 0);
        dummy.updateMatrix();
        orbInstanced.setMatrixAt(i, dummy.matrix);
        return;
      }
      const frame = course.getFrame(orb.t);
      const bob = Math.sin(time * 2 + orb.bobPhase) * 0.6;
      const pos = frame.position
        .clone()
        .addScaledVector(frame.right, orb.u)
        .addScaledVector(frame.up, orb.v + bob);
      dummy.position.copy(pos);
      dummy.rotation.set(0, 0, 0);
      dummy.quaternion.setFromEuler(new THREE.Euler(time * 1.4 + orb.bobPhase, time * 1.7, 0));
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      orbInstanced.setMatrixAt(i, dummy.matrix);
    });
    orbInstanced.instanceMatrix.needsUpdate = true;

    course.hazards.forEach((h, i) => {
      const frame = course.getFrame(h.t);
      const u = h.u + Math.sin(time * h.speed + h.phase) * h.ampU;
      const v = h.v + Math.cos(time * h.speed * 0.8 + h.phase) * h.ampV;
      const pos = frame.position.clone().addScaledVector(frame.right, u).addScaledVector(frame.up, v);
      const mesh = hazardVisuals[i].mesh;
      mesh.position.copy(pos);
      mesh.rotation.x = time * 0.6 * h.spin.x + h.phase;
      mesh.rotation.y = time * 0.5 * h.spin.y + h.phase;
      mesh.rotation.z = time * 0.4 * h.spin.z + h.phase;
    });
  }

  return { cloudMaterial, gateVisuals, extractionVisual, hazardVisuals, orbInstanced, starPoints, update };
}
