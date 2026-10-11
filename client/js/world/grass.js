// GPU grass: instanced blades in camera-following patches (near dense + far sparse).
// Blade positions wrap around the camera so blades stay fixed in the world; heights come from
// the terrain height texture, density from the ground mask. Wind, back-light translucency,
// distance fade and shadows-receiving are handled in the shader.
import * as THREE from 'three';
import { GLSL_NOISE } from '../engine/glsl.js';

const SEGMENTS = 4;

function bladeGeometry() {
  // position.x = side (-0.5..0.5), position.y = t (0..1)
  const pos = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const t = i / SEGMENTS;
    pos.push(-0.5, t, 0, 0.5, t, 0);
  }
  pos.push(0, 1, 0);
  const idx = [];
  for (let i = 0; i < SEGMENTS - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (SEGMENTS - 1) * 2;
  idx.push(last, last + 1, SEGMENTS * 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

function makePatch(count, size, seed) {
  const g = bladeGeometry();
  const offs = new Float32Array(count * 2);
  const rnd = new Float32Array(count * 4);
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Stratified (jittered grid) placement, then shuffled so any prefix is uniform (density scaling).
  const side = Math.ceil(Math.sqrt(count));
  const cellSize = size / side;
  const order = new Uint32Array(side * side);
  for (let i = 0; i < order.length; i++) order[i] = i;
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  for (let k = 0; k < count; k++) {
    const c = order[k];
    const cx = c % side, cz = Math.floor(c / side);
    offs[k * 2] = (cx + rand()) * cellSize;
    offs[k * 2 + 1] = (cz + rand()) * cellSize;
    rnd[k * 4] = rand(); rnd[k * 4 + 1] = rand(); rnd[k * 4 + 2] = rand(); rnd[k * 4 + 3] = rand();
  }
  g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offs, 2));
  g.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 4));
  g.instanceCount = count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

function makeMaterial(shared, patch) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  const uniforms = {
    ...shared,
    uPatch: { value: new THREE.Vector4(patch.size, patch.fadeIn, patch.fadeStart, patch.fadeEnd) },
    uBlade: { value: new THREE.Vector4(patch.height, patch.width, patch.densityScale, patch.far ? 1 : 0) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aOffset;
        attribute vec4 aRand;
        uniform vec3 uCamPos;
        uniform vec4 uPatch;     // size, fadeIn, fadeStart, fadeEnd
        uniform vec4 uBlade;     // height, width, density, far
        uniform highp sampler2D tHeight;
        uniform sampler2D tGround;
        uniform vec4 uTerrain;   // half, cell, n, size
        uniform float uTime;
        uniform vec3 uWind;      // dirX, dirZ, strength
        uniform float uDensity;
        uniform vec3 uColBase, uColTip, uColDry;
        uniform float uDryness;
        varying vec3 vGrassCol;
        varying float vGrassT;
        ${GLSL_NOISE}
        float terrainH(vec2 p) {
          vec2 g = (p + uTerrain.x) / uTerrain.y;
          float n1 = uTerrain.z - 1.0;
          g = clamp(g, vec2(0.0), vec2(n1 - 0.0001));
          vec2 i = floor(g);
          vec2 f = g - i;
          ivec2 ii = ivec2(i);
          float h00 = texelFetch(tHeight, ii, 0).r;
          float h11 = texelFetch(tHeight, ii + ivec2(1, 1), 0).r;
          if (f.x >= f.y) {
            float h10 = texelFetch(tHeight, ii + ivec2(1, 0), 0).r;
            return h00 + f.x * (h10 - h00) + f.y * (h11 - h10);
          }
          float h01 = texelFetch(tHeight, ii + ivec2(0, 1), 0).r;
          return h00 + f.y * (h01 - h00) + f.x * (h11 - h01);
        }
        vec3 gPos;
      `)
      .replace('#include <beginnormal_vertex>', `
        float S = uPatch.x;
        vec2 rel = mod(aOffset - uCamPos.xz + S * 0.5, S) - S * 0.5;
        vec2 wp = uCamPos.xz + rel;
        float dist = length(rel);
        vec4 gm = texture2D(tGround, (wp + uTerrain.x) / uTerrain.w);
        float macro = vfbm(wp * 0.03);
        float dens = gm.a * uDensity * (0.55 + macro * 0.9) * uBlade.z;
        float alive = step(aRand.x, dens);
        float fade = smoothstep(uPatch.y * 0.85, uPatch.y, dist) * (1.0 - smoothstep(uPatch.z, uPatch.w, dist));
        if (uBlade.w < 0.5) fade = 1.0 - smoothstep(uPatch.z, uPatch.w, dist);
        float scale = alive * fade;
        float h = uBlade.x * (0.45 + aRand.y * 0.85) * (0.75 + macro * 0.5) * scale;
        float w = uBlade.y * (0.65 + aRand.z * 0.7);
        float ang = aRand.w * 6.2831853;
        vec2 fw = vec2(cos(ang), sin(ang));      // blade facing
        vec2 side = vec2(-fw.y, fw.x);
        float t = position.y;
        float width = w * (1.0 - t * t * 0.85) * (t > 0.99 ? 0.0 : 1.0);
        // Natural curve + wind.
        float bend = (0.15 + aRand.z * 0.35) * t * t * h;
        float gust = vnoise(wp * 0.045 - uWind.xy * uTime * 1.6) ;
        float sway = (0.2 + 0.8 * gust) * uWind.z;
        float flutter = sin(uTime * (2.5 + aRand.x * 2.0) + aRand.y * 40.0 + wp.x * 0.3) * 0.12 * uWind.z;
        vec2 windOff = uWind.xy * (sway + flutter) * t * t * h * 0.9;
        float ground = terrainH(wp);
        vec3 p = vec3(wp.x, ground, wp.y);
        p.xz += side * position.x * width + fw * bend + windOff;
        p.y += t * h * (1.0 - 0.25 * (sway + 0.3) * t);
        gPos = p;
        vec3 bladeN = normalize(vec3(fw.x, 0.25, fw.y));
        vec3 objectNormal = normalize(mix(bladeN, vec3(0.0, 1.0, 0.0), 0.55));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(1.0, 0.0, 0.0);
        #endif
        // Colour: base -> tip with dry/green variation.
        float dry = clamp(uDryness + (macro - 0.5) * 0.9 + (aRand.x - 0.5) * 0.5, 0.0, 1.0);
        vec3 tip = mix(uColTip, uColDry, dry * 0.8);
        vGrassCol = mix(uColBase * (0.55 + 0.25 * aRand.z), tip, smoothstep(0.0, 1.0, t));
        vGrassT = t;
      `)
      .replace('#include <begin_vertex>', 'vec3 transformed = gPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGrassCol;
        varying float vGrassT;
        uniform vec3 uSunDirView;
        uniform vec3 uSunCol;
      `)
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vGrassCol;')
      .replace('#include <opaque_fragment>', `
        {
          // Back-lit translucency (sun shining through the blades), modulated by received direct light.
          vec3 toFrag = normalize(-vViewPosition);
          float back = pow(max(dot(toFrag, uSunDirView), 0.0), 3.0);
          float lit = clamp(dot(reflectedLight.directDiffuse, vec3(0.333)) / max(dot(diffuseColor.rgb, vec3(0.333)), 0.02) * 0.35, 0.0, 1.0);
          outgoingLight += diffuseColor.rgb * uSunCol * back * lit * (0.25 + vGrassT) * 0.9;
          // Darken the base (self-occlusion).
          outgoingLight *= 0.55 + 0.45 * smoothstep(0.0, 0.6, vGrassT);
        }
        #include <opaque_fragment>
      `);
  };
  mat.customProgramCacheKey = () => 'grass-v1-' + (patch.far ? 'far' : 'near');
  return mat;
}

export const GRASS_QUALITY = {
  low: { near: 22000, far: 0 },
  medium: { near: 55000, far: 16000 },
  high: { near: 110000, far: 32000 },
  ultra: { near: 190000, far: 56000 },
};

export class GrassSystem {
  constructor(world, heightTex, groundTex, env) {
    this.world = world;
    this.env = env;
    const t = world.terrain;
    const grass = env.grass;
    this.shared = {
      uCamPos: { value: new THREE.Vector3() },
      tHeight: { value: heightTex },
      tGround: { value: groundTex },
      uTerrain: { value: new THREE.Vector4(t.half, t.cell, t.n, t.size) },
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector3(0.8, 0.6, env.wind ?? 0.5) },
      uDensity: { value: grass.density ?? 1 },
      uColBase: { value: new THREE.Color(grass.base) },
      uColTip: { value: new THREE.Color(grass.tip) },
      uColDry: { value: new THREE.Color('#c9b06a') },
      uDryness: { value: grass.dryness ?? 0.4 },
      uSunDirView: { value: new THREE.Vector3() },
      uSunCol: { value: new THREE.Color(env.sun.color).multiplyScalar(env.sun.intensity * 0.35) },
    };
    const height = grass.height ?? 0.55;
    this.patches = {
      near: { size: 64, fadeIn: 0, fadeStart: 26, fadeEnd: 31.5, height, width: 0.05, densityScale: 1, far: false, max: GRASS_QUALITY.ultra.near },
      far: { size: 150, fadeIn: 30, fadeStart: 58, fadeEnd: 74, height: height * 1.15, width: 0.11, densityScale: 1, far: true, max: GRASS_QUALITY.ultra.far },
    };
    this.group = new THREE.Group();
    this.group.name = 'grass';
    this.meshes = {};
    for (const [key, p] of Object.entries(this.patches)) {
      const geo = makePatch(p.max, p.size, key === 'near' ? 1234 : 5678);
      const mesh = new THREE.Mesh(geo, makeMaterial(this.shared, p));
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.name = 'grass-' + key;
      this.meshes[key] = mesh;
      this.group.add(mesh);
    }
    this.setQuality('high');
    this._v = new THREE.Vector3();
    this.sunDir = new THREE.Vector3();
  }

  setQuality(level, densityMul = 1) {
    const q = GRASS_QUALITY[level] || GRASS_QUALITY.high;
    this.meshes.near.geometry.instanceCount = Math.floor(q.near * densityMul);
    this.meshes.far.geometry.instanceCount = Math.floor(q.far * densityMul);
    this.meshes.far.visible = q.far > 0;
    this.meshes.near.visible = q.near > 0 && densityMul > 0;
    // Blades become denser per instance when counts drop (keeps coverage, thinner look).
    this.shared.uDensity.value = (this.env.grass.density ?? 1);
  }

  setSunDir(dir) {
    this.sunDir.copy(dir);
  }

  update(camera, time) {
    this.shared.uCamPos.value.copy(camera.position);
    this.shared.uTime.value = time;
    this._v.copy(this.sunDir).transformDirection(camera.matrixWorldInverse);
    this.shared.uSunDirView.value.copy(this._v);
  }

  dispose() {
    for (const m of Object.values(this.meshes)) { m.geometry.dispose(); m.material.dispose(); }
  }
}
