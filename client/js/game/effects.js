// Visual effects: billboard particles (dust, smoke, sparks, blood, fire), tracers, bullet-hole
// decals, ejected shell casings, explosions, smoke grenade clouds and pooled flash lights.
import * as THREE from 'three';

// ------------------------------------------------------------------ particle atlas (2x2)
function makeAtlas() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const g = c.getContext('2d');
  // 0: soft puff
  let grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  // 1: noisy smoke puff
  const img = g.createImageData(S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blobs = [];
  for (let i = 0; i < 14; i++) blobs.push([S * (0.3 + rnd() * 0.4), S * (0.3 + rnd() * 0.4), S * (0.12 + rnd() * 0.18)]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let a = 0;
      for (const [bx, by, br] of blobs) {
        const d = Math.hypot(x - bx, y - by) / br;
        if (d < 1) a += (1 - d * d) * 0.35;
      }
      const edge = Math.max(0, 1 - Math.hypot(x - S / 2, y - S / 2) / (S / 2));
      a = Math.min(1, a) * Math.min(1, edge * 2.2);
      const n = 0.8 + rnd() * 0.2;
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 * n;
      img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, S, 0);
  // 2: spark streak (vertical)
  grd = g.createLinearGradient(0, S, 0, S * 2);
  g.save();
  g.translate(S / 2, S + S / 2);
  const sg = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
  sg.addColorStop(0, 'rgba(255,255,255,1)');
  sg.addColorStop(0.25, 'rgba(255,240,200,0.8)');
  sg.addColorStop(1, 'rgba(255,200,120,0)');
  g.scale(0.18, 1);
  g.fillStyle = sg;
  g.beginPath();
  g.arc(0, 0, S / 2, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // 3: muzzle flash star
  g.save();
  g.translate(S + S / 2, S + S / 2);
  for (let k = 0; k < 6; k++) {
    g.rotate(Math.PI / 3 + rnd() * 0.2);
    const fg = g.createLinearGradient(0, 0, 0, -S / 2);
    fg.addColorStop(0, 'rgba(255,255,230,1)');
    fg.addColorStop(1, 'rgba(255,180,60,0)');
    g.fillStyle = fg;
    g.beginPath();
    g.moveTo(-S * 0.06, 0);
    g.lineTo(0, -S * (0.3 + rnd() * 0.2));
    g.lineTo(S * 0.06, 0);
    g.fill();
  }
  const cg = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.22);
  cg.addColorStop(0, 'rgba(255,255,240,1)');
  cg.addColorStop(1, 'rgba(255,200,80,0)');
  g.fillStyle = cg;
  g.beginPath();
  g.arc(0, 0, S * 0.22, 0, Math.PI * 2);
  g.fill();
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PARTICLE_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;   // rgb (linear, may exceed 1 for additive), alpha
attribute vec4 iParams;  // size, rotation, frame, stretch
attribute vec3 iVel;     // for stretched sparks
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vColor = iColor;
  float size = iParams.x;
  float rot = iParams.y;
  float frame = iParams.z;
  vec2 corner = position.xy;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  if (iParams.w > 0.0) {
    // Stretch along screen-space velocity.
    vec3 v = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
    vec2 d = normalize(v.xy + 1e-5);
    vec2 side = vec2(-d.y, d.x);
    float len = size * (1.0 + iParams.w * length(v.xy));
    mv.xy += side * corner.x * size * 0.35 + d * corner.y * len;
  } else {
    float c = cos(rot), s = sin(rot);
    mv.xy += mat2(c, s, -s, c) * corner * size;
  }
  gl_Position = projectionMatrix * mv;
  vec2 uv = position.xy + 0.5;
  vUv = (uv + vec2(mod(frame, 2.0), floor(frame / 2.0))) * 0.5;
  vUv.y = 1.0 - vUv.y;
  vUv.y = 1.0 - vUv.y;
}
`;
const PARTICLE_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vColor.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb * t.rgb, a);
}
`;

class ParticlePool {
  constructor(max, atlas, additive) {
    this.max = max;
    this.count = 0;
    this.p = []; // particle structs
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aPar = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iColor', this.aCol);
    geo.setAttribute('iParams', this.aPar);
    geo.setAttribute('iVel', this.aVel);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG,
      uniforms: { map: { value: atlas } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
  }

  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: 0, maxLife: o.life || 1, size: o.size || 0.3, grow: o.grow || 0, rot: o.rot ?? Math.random() * 6.28, spin: o.spin || 0,
      r: o.r ?? 1, g: o.g ?? 1, b: o.b ?? 1, a: o.a ?? 1, fadeIn: o.fadeIn || 0, frame: o.frame || 0, drag: o.drag ?? 1.5,
      gravity: o.gravity ?? 0, stretch: o.stretch || 0, buoy: o.buoy || 0,
    });
  }

  update(dt) {
    const arr = this.p;
    let n = 0;
    const P = this.aPos.array, C = this.aCol.array, R = this.aPar.array, V = this.aVel.array;
    for (let i = 0; i < arr.length; i++) {
      const q = arr[i];
      q.life += dt;
      if (q.life >= q.maxLife) continue;
      const k = Math.max(0, 1 - q.drag * dt);
      q.vx *= k; q.vy = q.vy * k - q.gravity * dt + q.buoy * dt; q.vz *= k;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.rot += q.spin * dt;
      const t = q.life / q.maxLife;
      const fade = (q.fadeIn > 0 ? Math.min(1, q.life / q.fadeIn) : 1) * (1 - t * t);
      arr[n++] = q;
      const j = n - 1;
      P[j * 3] = q.x; P[j * 3 + 1] = q.y; P[j * 3 + 2] = q.z;
      C[j * 4] = q.r; C[j * 4 + 1] = q.g; C[j * 4 + 2] = q.b; C[j * 4 + 3] = q.a * fade;
      R[j * 4] = q.size + q.grow * q.life; R[j * 4 + 1] = q.rot; R[j * 4 + 2] = q.frame; R[j * 4 + 3] = q.stretch;
      V[j * 3] = q.vx; V[j * 3 + 1] = q.vy; V[j * 3 + 2] = q.vz;
    }
    arr.length = n;
    this.mesh.geometry.instanceCount = n;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aPar.needsUpdate = this.aVel.needsUpdate = true;
    if (n) {
      this.aPos.addUpdateRange(0, n * 3);
      this.aCol.addUpdateRange(0, n * 4);
      this.aPar.addUpdateRange(0, n * 4);
      this.aVel.addUpdateRange(0, n * 3);
    }
  }
}

// ------------------------------------------------------------------ tracers
const TRACER_VERT = /* glsl */ `
attribute vec3 iA;
attribute vec3 iB;
attribute vec4 iCol; // rgb, width
varying vec3 vCol;
varying float vT;
varying float vSide;
void main() {
  vec4 a = modelViewMatrix * vec4(iA, 1.0);
  vec4 b = modelViewMatrix * vec4(iB, 1.0);
  vec4 p = mix(a, b, position.y);
  vec3 dir = normalize(b.xyz - a.xyz + 1e-5);
  vec3 side = normalize(cross(dir, normalize(p.xyz)));
  float w = iCol.w * (0.6 + 0.004 * length(p.xyz));
  p.xyz += side * position.x * w;
  vCol = iCol.rgb;
  vT = position.y;
  vSide = position.x;
  gl_Position = projectionMatrix * p;
}
`;
const TRACER_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vT;
varying float vSide;
void main() {
  float a = (1.0 - abs(vSide) * 2.0) * smoothstep(0.0, 0.6, vT);
  gl_FragColor = vec4(vCol * a, a);
}
`;

class TracerPool {
  constructor(max) {
    this.max = max;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', this.aA);
    geo.setAttribute('iB', this.aB);
    geo.setAttribute('iCol', this.aC);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: TRACER_VERT, fragmentShader: TRACER_FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(ax, ay, az, bx, by, bz, r, g, b, w) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const A = this.aA.array, B = this.aB.array, C = this.aC.array;
    A[i * 3] = ax; A[i * 3 + 1] = ay; A[i * 3 + 2] = az;
    B[i * 3] = bx; B[i * 3 + 1] = by; B[i * 3 + 2] = bz;
    C[i * 4] = r; C[i * 4 + 1] = g; C[i * 4 + 2] = b; C[i * 4 + 3] = w;
  }
  end() {
    this.mesh.geometry.instanceCount = this.n;
    this.aA.needsUpdate = this.aB.needsUpdate = this.aC.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ decals
function decalTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S * 2; c.height = S;
  const g = c.getContext('2d');
  // 0: bullet hole (hard surfaces)
  let grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(10,8,6,1)');
  grd.addColorStop(0.18, 'rgba(20,16,12,0.95)');
  grd.addColorStop(0.32, 'rgba(60,52,44,0.6)');
  grd.addColorStop(1, 'rgba(60,52,44,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(20,16,12,0.6)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    g.beginPath();
    g.moveTo(S / 2 + Math.cos(a) * 10, S / 2 + Math.sin(a) * 10);
    g.lineTo(S / 2 + Math.cos(a + 0.2) * (25 + Math.random() * 20), S / 2 + Math.sin(a + 0.2) * (25 + Math.random() * 20));
    g.stroke();
  }
  // 1: ground scuff
  grd = g.createRadialGradient(S * 1.5, S / 2, 0, S * 1.5, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(25,18,10,0.9)');
  grd.addColorStop(0.5, 'rgba(40,30,20,0.4)');
  grd.addColorStop(1, 'rgba(40,30,20,0)');
  g.fillStyle = grd;
  g.fillRect(S, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SURFACE_FX = {
  dirt: { dust: [0.42, 0.34, 0.25], chunks: [0.2, 0.15, 0.1], sparks: 0, decal: 1 },
  grass: { dust: [0.38, 0.36, 0.24], chunks: [0.18, 0.2, 0.1], sparks: 0, decal: 1 },
  gravel: { dust: [0.5, 0.48, 0.44], chunks: [0.35, 0.34, 0.32], sparks: 1, decal: 1 },
  rock: { dust: [0.55, 0.53, 0.5], chunks: [0.4, 0.39, 0.37], sparks: 3, decal: 0 },
  concrete: { dust: [0.6, 0.58, 0.55], chunks: [0.5, 0.48, 0.46], sparks: 2, decal: 0 },
  wood: { dust: [0.5, 0.4, 0.28], chunks: [0.45, 0.32, 0.18], sparks: 0, decal: 0 },
  metal: { dust: [0.4, 0.4, 0.42], chunks: [0.3, 0.3, 0.3], sparks: 10, decal: 0 },
  glass: { dust: [0.7, 0.75, 0.8], chunks: [0.7, 0.8, 0.85], sparks: 2, decal: 0 },
  flesh: { dust: [0.32, 0.02, 0.01], chunks: [0.25, 0.01, 0.01], sparks: 0, decal: -1 },
};

export class Effects {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.atlas = makeAtlas();
    this.alpha = new ParticlePool(1600, this.atlas, false);
    this.additive = new ParticlePool(700, this.atlas, true);
    this.tracers = new TracerPool(256);
    scene.add(this.alpha.mesh, this.additive.mesh, this.tracers.mesh);
    // Decals.
    this.maxDecals = 220;
    const dgeo = new THREE.PlaneGeometry(1, 1);
    const uvs = dgeo.attributes.uv;
    this.decalMats = [0, 1].map((frame) => {
      const m = new THREE.MeshStandardMaterial({ map: decalTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 1 });
      m.map.repeat.set(0.5, 1);
      m.map.offset.set(frame * 0.5, 0);
      return m;
    });
    void uvs;
    this.decals = this.decalMats.map((m) => {
      const im = new THREE.InstancedMesh(dgeo, m, this.maxDecals);
      im.count = 0;
      im.frustumCulled = false;
      im.receiveShadow = true;
      scene.add(im);
      return { mesh: im, next: 0, used: 0 };
    });
    // Shell casings.
    this.maxShells = 80;
    const shellGeo = new THREE.CylinderGeometry(0.0048, 0.0048, 0.045, 6);
    shellGeo.rotateZ(Math.PI / 2);
    this.shellMesh = new THREE.InstancedMesh(shellGeo, new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.9, roughness: 0.3 }), this.maxShells);
    this.shellMesh.count = 0;
    this.shellMesh.frustumCulled = false;
    this.shellMesh.castShadow = false;
    scene.add(this.shellMesh);
    this.shells = [];
    // Pooled lights (constant count avoids shader recompiles).
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 12, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push({ light: l, life: 0, max: 1, peak: 0 });
    }
    this.smokes = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.time = 0;
  }

  flashLight(x, y, z, color, intensity, duration, distance = 14) {
    let slot = this.lights[0];
    for (const s of this.lights) if (s.life >= s.max) { slot = s; break; }
    slot.light.position.set(x, y, z);
    slot.light.color.set(color);
    slot.light.distance = distance;
    slot.peak = intensity;
    slot.life = 0;
    slot.max = duration;
    slot.light.intensity = intensity;
  }

  /** World-space muzzle flash (remote players). dir = shot direction. */
  muzzleFlash(pos, dir, size = 1, suppressed = false) {
    if (suppressed) size *= 0.25;
    this.additive.spawn({ x: pos.x, y: pos.y, z: pos.z, life: 0.05, size: 0.35 * size, frame: 3, r: 4, g: 3, b: 1.6, a: 1, drag: 0 });
    this.additive.spawn({ x: pos.x + dir.x * 0.15, y: pos.y + dir.y * 0.15, z: pos.z + dir.z * 0.15, life: 0.04, size: 0.25 * size, frame: 0, r: 5, g: 3.5, b: 1.5, a: 1, drag: 0 });
    if (!suppressed) this.flashLight(pos.x, pos.y, pos.z, 0xffb060, 25 * size, 0.06, 10);
    this.alpha.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * 1.5, vy: dir.y * 1.5 + 0.3, vz: dir.z * 1.5, life: 0.9, size: 0.12, grow: 0.5, frame: 1, r: 0.75, g: 0.74, b: 0.72, a: 0.18, drag: 2.5, buoy: 0.3 });
  }

  /** Bullet impact on a surface. */
  impact(x, y, z, nx, ny, nz, surface = 'dirt', big = false) {
    const fx = SURFACE_FX[surface] || SURFACE_FX.dirt;
    const s = big ? 1.8 : 1;
    const [dr, dg, db] = fx.dust;
    // Dust puff.
    for (let i = 0; i < 3; i++) {
      this.alpha.spawn({
        x: x + nx * 0.05, y: y + ny * 0.05, z: z + nz * 0.05,
        vx: nx * (1.5 + Math.random() * 2) + (Math.random() - 0.5), vy: ny * (1.5 + Math.random() * 2) + Math.random() * 0.8, vz: nz * (1.5 + Math.random() * 2) + (Math.random() - 0.5),
        life: 0.8 + Math.random() * 0.9, size: 0.12 * s, grow: 0.55 * s, frame: 1, r: dr, g: dg, b: db, a: surface === 'flesh' ? 0.85 : 0.6, drag: 3.2, gravity: surface === 'flesh' ? 1.5 : 0.3,
      });
    }
    // Chunks / droplets.
    const [cr, cg, cb] = fx.chunks;
    const nChunks = surface === 'flesh' ? 6 : 5;
    for (let i = 0; i < nChunks; i++) {
      this.alpha.spawn({
        x, y, z, vx: nx * 3 + (Math.random() - 0.5) * 4, vy: ny * 3 + Math.random() * 3, vz: nz * 3 + (Math.random() - 0.5) * 4,
        life: 0.5 + Math.random() * 0.4, size: 0.025 * s, frame: 0, r: cr, g: cg, b: cb, a: 1, drag: 0.6, gravity: 9,
      });
    }
    // Sparks.
    for (let i = 0; i < fx.sparks; i++) {
      this.additive.spawn({
        x, y, z, vx: nx * 4 + (Math.random() - 0.5) * 7, vy: ny * 4 + Math.random() * 5, vz: nz * 4 + (Math.random() - 0.5) * 7,
        life: 0.15 + Math.random() * 0.25, size: 0.02, frame: 2, r: 6, g: 3.6, b: 1.2, a: 1, drag: 1, gravity: 9, stretch: 0.06,
      });
    }
    if (fx.sparks >= 3) this.flashLight(x + nx * 0.2, y + ny * 0.2, z + nz * 0.2, 0xffc080, 3, 0.05, 4);
    if (fx.decal >= 0) this.addDecal(x, y, z, nx, ny, nz, fx.decal, (fx.decal === 1 ? 0.22 : 0.09) * s);
  }

  blood(x, y, z, dx, dy, dz) {
    for (let i = 0; i < 5; i++) {
      this.alpha.spawn({
        x, y, z, vx: dx * 2 + (Math.random() - 0.5) * 1.5, vy: dy * 2 + Math.random(), vz: dz * 2 + (Math.random() - 0.5) * 1.5,
        life: 0.5 + Math.random() * 0.5, size: 0.08, grow: 0.5, frame: 1, r: 0.3, g: 0.01, b: 0.01, a: 0.8, drag: 3, gravity: 2,
      });
    }
  }

  addDecal(x, y, z, nx, ny, nz, kind, size) {
    const d = this.decals[kind];
    if (!d) return;
    this._n.set(nx, ny, nz).normalize();
    this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._n);
    const spin = new THREE.Quaternion().setFromAxisAngle(this._n, Math.random() * Math.PI * 2);
    this._q.premultiply(spin);
    this._m.compose(this._v.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01), this._q, this._s.set(size, size, size));
    d.mesh.setMatrixAt(d.next, this._m);
    d.next = (d.next + 1) % this.maxDecals;
    d.used = Math.min(this.maxDecals, d.used + 1);
    d.mesh.count = d.used;
    d.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Eject a casing from a world position with the weapon's right vector. */
  ejectShell(pos, right, up, kind = 'rifle') {
    if (kind === 'none') return;
    if (this.shells.length >= this.maxShells) this.shells.shift();
    const sp = 2.2 + Math.random() * 1.2;
    this.shells.push({
      x: pos.x, y: pos.y, z: pos.z,
      vx: right.x * sp + up.x * 1.2 + (Math.random() - 0.5) * 0.4, vy: right.y * sp + up.y * 1.6 + 0.8, vz: right.z * sp + up.z * 1.2 + (Math.random() - 0.5) * 0.4,
      rx: Math.random() * 6, ry: Math.random() * 6, rz: 0, sx: (Math.random() - 0.5) * 30, sy: (Math.random() - 0.5) * 30,
      life: 0, bounces: 0, kind, scale: kind === 'pistol' ? 0.55 : kind === 'shotgun' ? 1.6 : kind === 'big' ? 1.7 : 1,
    });
  }

  /** Frag explosion. */
  explosion(x, y, z) {
    this.flashLight(x, y + 1, z, 0xffa040, 600, 0.35, 30);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
      const sp = 4 + Math.random() * 8;
      this.additive.spawn({ x, y: y + 0.4, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp,
        life: 0.25 + Math.random() * 0.3, size: 0.8, grow: 3, frame: 1, r: 6, g: 2.6, b: 0.8, a: 0.9, drag: 4 });
    }
    this.additive.spawn({ x, y: y + 0.8, z, life: 0.12, size: 5, frame: 0, r: 10, g: 7, b: 4, a: 1, drag: 0 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 10;
      this.alpha.spawn({ x, y: y + 0.2, z, vx: Math.cos(a) * sp * 0.6, vy: 4 + Math.random() * 9, vz: Math.sin(a) * sp * 0.6,
        life: 1 + Math.random(), size: 0.05, frame: 0, r: 0.12, g: 0.1, b: 0.08, a: 1, drag: 0.5, gravity: 9.8 });
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2;
      this.alpha.spawn({ x: x + Math.cos(a) * r, y: y + 0.5 + Math.random(), z: z + Math.sin(a) * r, vx: Math.cos(a) * 1.5, vy: 1 + Math.random() * 2, vz: Math.sin(a) * 1.5,
        life: 3 + Math.random() * 3, size: 1.2, grow: 1.6, frame: 1, r: 0.25, g: 0.23, b: 0.21, a: 0.7, drag: 0.8, buoy: 0.4, fadeIn: 0.1 });
    }
    this.addDecal(x, this.world.terrain.heightAt(x, z), z, 0, 1, 0, 1, 2.6);
  }

  /** Smoke grenade cloud. */
  smokeCloud(x, y, z, duration = 28) {
    this.smokes.push({ x, y, z, t: 0, duration, acc: 0 });
  }

  update(dt, camera) {
    this.time += dt;
    // Smoke emitters.
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t += dt;
      s.acc += dt;
      const rate = s.t < 3 ? 0.04 : 0.18;
      while (s.acc > rate && s.t < s.duration - 4) {
        s.acc -= rate;
        const r = Math.min(8, 1 + s.t * 1.8) * Math.sqrt(Math.random());
        const a = Math.random() * Math.PI * 2;
        const shade = 0.72 + Math.random() * 0.12;
        this.alpha.spawn({
          x: s.x + Math.cos(a) * r * 0.5, y: s.y + 0.3 + Math.random() * 0.5, z: s.z + Math.sin(a) * r * 0.5,
          vx: Math.cos(a) * (0.6 + Math.random()), vy: 0.25 + Math.random() * 0.45, vz: Math.sin(a) * (0.6 + Math.random()),
          life: 8 + Math.random() * 4, size: 2.2, grow: 0.6, frame: 1, r: shade, g: shade, b: shade * 1.02, a: 0.55, drag: 0.35, fadeIn: 0.6, spin: (Math.random() - 0.5) * 0.3,
        });
      }
      if (s.t > s.duration) this.smokes.splice(i, 1);
    }
    this.alpha.update(dt);
    this.additive.update(dt);
    // Lights.
    for (const s of this.lights) {
      if (s.life >= s.max) { s.light.intensity = 0; continue; }
      s.life += dt;
      const k = Math.max(0, 1 - s.life / s.max);
      s.light.intensity = s.peak * k * k;
    }
    // Shells.
    const t = this.world.terrain;
    let n = 0;
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      s.life += dt;
      if (s.life > 8) continue;
      if (s.bounces < 3) {
        s.vy -= 9.8 * dt;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        s.rx += s.sx * dt; s.ry += s.sy * dt;
        const g = t.heightAt(s.x, s.z) + 0.006;
        if (s.y < g) {
          s.y = g;
          s.vy = -s.vy * 0.35;
          s.vx *= 0.5; s.vz *= 0.5;
          s.sx *= 0.5; s.sy *= 0.5;
          s.bounces++;
          if (s.bounces === 1) this.onShellLand?.(s);
          if (s.bounces >= 3) { s.rx = Math.PI / 2 * Math.round(s.rx / (Math.PI / 2)); }
        }
      }
      this.shells[n++] = s;
      const fade = s.life > 7 ? 1 - (s.life - 7) : 1;
      this._q.setFromEuler(new THREE.Euler(s.rx, s.ry, 0));
      this._m.compose(this._v.set(s.x, s.y, s.z), this._q, this._s.setScalar(s.scale * fade));
      this.shellMesh.setMatrixAt(n - 1, this._m);
    }
    this.shells.length = n;
    this.shellMesh.count = n;
    this.shellMesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.alpha.mesh, this.additive.mesh, this.tracers.mesh, this.shellMesh);
    for (const d of this.decals) this.scene.remove(d.mesh);
    for (const s of this.lights) this.scene.remove(s.light);
    this.atlas.dispose();
  }
}
