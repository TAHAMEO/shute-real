// SHUTE REAL - procedural rocks (boulders, slabs, spires, cliffs, pebbles).
// Every variant is a displaced icosphere (ridged/fbm noise + planar cuts for granite facets)
// filling the unit sphere. All variants share the icosphere topology, so instances are drawn by
// vertex pulling: one InstancedMesh per LOD level (4 draw calls for all rocks) fetches the
// variant's displaced positions / normals / AO from data textures using gl_VertexID.
// Material: MeshStandardMaterial + world-space triplanar albedo/normal (no stretching on scaled
// instances), lichen on upward faces, crevice AO.
import * as THREE from 'three';
import { createRockTextures, mulberry32, hash2, smoothstep, clamp01 } from './vegetation-textures.js';

export const ROCK_TYPES = ['boulder', 'slab', 'spire', 'cliff', 'pebble'];
const VARIANTS_PER_TYPE = 6;
const MAX_LEVEL = { boulder: 4, slab: 4, spire: 4, cliff: 4, pebble: 3 };
const LOD_LEVELS = [4, 3, 2, 1];
const TEX_W = 1024;

/** Quality presets: LOD thresholds use projected size (radius / distance). */
export const ROCK_QUALITY = {
  low: { lodScale: 1.7, maxLevel: 3, cull: 0.007, far: 1200, texSize: 256 },
  medium: { lodScale: 1.3, maxLevel: 4, cull: 0.005, far: 1600, texSize: 512 },
  high: { lodScale: 1.0, maxLevel: 4, cull: 0.0035, far: 2200, texSize: 512 },
  ultra: { lodScale: 0.7, maxLevel: 4, cull: 0.0025, far: 3000, texSize: 512 },
};
const LOD_THRESHOLDS = [0.075, 0.025, 0.009]; // projected size (radius/distance) above which L4, L3, L2 are used

// ---------------------------------------------------------------------------------------------
// Icosphere with the vertex-prefix property (level n vertices are the first V(n) of level n+1)
// ---------------------------------------------------------------------------------------------

let _ico = null;
function icosphere() {
  if (_ico) return _ico;
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const pos = [];
  for (const p of v) {
    const l = Math.hypot(p[0], p[1], p[2]);
    pos.push(p[0] / l, p[1] / l, p[2] / l);
  }
  let faces = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  // make sure faces wind counter-clockwise seen from outside
  {
    const a = faces[0] * 3;
    const b = faces[1] * 3;
    const c = faces[2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (n[0] * pos[a] + n[1] * pos[a + 1] + n[2] * pos[a + 2] < 0) {
      for (let i = 0; i < faces.length; i += 3) { const tmp = faces[i + 1]; faces[i + 1] = faces[i + 2]; faces[i + 2] = tmp; }
    }
  }
  const levels = [{ index: faces.slice(), vcount: 12 }];
  for (let l = 1; l <= 4; l++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let m = cache.get(key);
      if (m !== undefined) return m;
      const x = pos[a * 3] + pos[b * 3];
      const y = pos[a * 3 + 1] + pos[b * 3 + 1];
      const z = pos[a * 3 + 2] + pos[b * 3 + 2];
      const len = Math.hypot(x, y, z);
      m = pos.length / 3;
      pos.push(x / len, y / len, z / len);
      cache.set(key, m);
      return m;
    };
    const nf = [];
    for (let i = 0; i < faces.length; i += 3) {
      const a = faces[i];
      const b = faces[i + 1];
      const c = faces[i + 2];
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      nf.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = nf;
    levels.push({ index: faces, vcount: pos.length / 3 });
  }
  _ico = { pos: new Float32Array(pos), levels };
  return _ico;
}

// ---------------------------------------------------------------------------------------------
// 3D gradient noise (improved Perlin) for displacement
// ---------------------------------------------------------------------------------------------

function makeNoise(seed) {
  const rng = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y, z) => {
    const hh = h & 15;
    const u = hh < 8 ? x : y;
    const v = hh < 4 ? y : hh === 12 || hh === 14 ? x : z;
    return ((hh & 1) === 0 ? u : -u) + ((hh & 2) === 0 ? v : -v);
  };
  const noise = (x, y, z) => {
    let X = Math.floor(x);
    let Y = Math.floor(y);
    let Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    X &= 255; Y &= 255; Z &= 255;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const w = z * z * z * (z * (z * 6 - 15) + 10);
    const A = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;
    const l1 = grad(perm[AA], x, y, z) + u * (grad(perm[BA], x - 1, y, z) - grad(perm[AA], x, y, z));
    const l2 = grad(perm[AB], x, y - 1, z) + u * (grad(perm[BB], x - 1, y - 1, z) - grad(perm[AB], x, y - 1, z));
    const l3 = grad(perm[AA + 1], x, y, z - 1) + u * (grad(perm[BA + 1], x - 1, y, z - 1) - grad(perm[AA + 1], x, y, z - 1));
    const l4 = grad(perm[AB + 1], x, y - 1, z - 1) + u * (grad(perm[BB + 1], x - 1, y - 1, z - 1) - grad(perm[AB + 1], x, y - 1, z - 1));
    const m1 = l1 + v * (l2 - l1);
    const m2 = l3 + v * (l4 - l3);
    return m1 + w * (m2 - m1);
  };
  const fbm = (x, y, z, oct) => {
    let s = 0;
    let a = 1;
    let n = 0;
    for (let o = 0; o < oct; o++) {
      s += noise(x, y, z) * a;
      n += a;
      a *= 0.5;
      x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; z = z * 2.03 + 9.3;
    }
    return s / n;
  };
  const ridged = (x, y, z, oct) => {
    let s = 0;
    let a = 1;
    let n = 0;
    for (let o = 0; o < oct; o++) {
      const r = 1 - Math.abs(noise(x, y, z));
      s += r * r * a;
      n += a;
      a *= 0.5;
      x = x * 2.07 + 5.3; y = y * 2.07 + 11.9; z = z * 2.07 + 1.7;
    }
    return s / n;
  };
  return { noise, fbm, ridged };
}

// ---------------------------------------------------------------------------------------------
// Variant generation
// ---------------------------------------------------------------------------------------------

function randomUnit(rng) {
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return [Math.cos(a) * r, z, Math.sin(a) * r];
}

function makeCuts(type, rng) {
  const cuts = [];
  const add = (n, o) => {
    const l = Math.hypot(n[0], n[1], n[2]);
    cuts.push([n[0] / l, n[1] / l, n[2] / l, o]);
  };
  if (type === 'boulder') {
    const n = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const d = randomUnit(rng);
      d[1] = d[1] * 0.6 + (i === 0 ? 0.8 : 0);
      add(d, 0.8 + rng() * 0.12);
    }
  } else if (type === 'slab') {
    add([(rng() - 0.5) * 0.3, 1, (rng() - 0.5) * 0.3], 0.72 + rng() * 0.1);
    add([(rng() - 0.5) * 0.3, -1, (rng() - 0.5) * 0.3], 0.75);
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      add([Math.cos(a), (rng() - 0.5) * 0.4, Math.sin(a)], 0.8 + rng() * 0.12);
    }
  } else if (type === 'spire') {
    const n = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.6;
      add([Math.cos(a), (rng() - 0.3) * 0.25, Math.sin(a)], 0.78 + rng() * 0.12);
    }
    for (let i = 0; i < 2; i++) {
      const a = rng() * Math.PI * 2;
      add([Math.cos(a) * 0.9, 0.75 + rng() * 0.4, Math.sin(a) * 0.9], 0.62 + rng() * 0.12);
    }
  } else if (type === 'cliff') {
    const a0 = rng() * Math.PI * 2;
    add([Math.cos(a0), 0.05, Math.sin(a0)], 0.74 + rng() * 0.06);
    add([(rng() - 0.5) * 0.25, 1, (rng() - 0.5) * 0.25], 0.68 + rng() * 0.12);
    const n = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const a = a0 + Math.PI * (0.4 + rng() * 1.2);
      add([Math.cos(a), (rng() - 0.5) * 0.3, Math.sin(a)], 0.8 + rng() * 0.1);
    }
  } else {
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) add(randomUnit(rng), 0.86 + rng() * 0.08);
  }
  return cuts;
}

/** Displaced unit-sphere positions + AO for one variant at its max level. */
function buildVariant(type, seed, maxLevel) {
  const ico = icosphere();
  const V = ico.levels[maxLevel].vcount;
  const rng = mulberry32(seed);
  const N = makeNoise(seed * 31 + 7);
  const ox = rng() * 100;
  const oy = rng() * 100;
  const oz = rng() * 100;
  const cuts = makeCuts(type, rng);
  const out = new Float32Array(V * 4);
  const nd = new Float32Array(V);
  const strataPhase = rng() * 10;
  const strataFreq = type === 'cliff' ? 3.2 + rng() * 1.2 : 5 + rng() * 2;
  for (let i = 0; i < V; i++) {
    const x = ico.pos[i * 3];
    const y = ico.pos[i * 3 + 1];
    const z = ico.pos[i * 3 + 2];
    let r = 1;
    let n1 = 0;
    if (type === 'boulder') {
      n1 = N.fbm(x * 1.4 + ox, y * 1.4 + oy, z * 1.4 + oz, 4);
      const rg = N.ridged(x * 2.6 + oz, y * 2.6 + ox, z * 2.6 + oy, 3);
      r = 0.95 + 0.12 * n1 - 0.07 * Math.pow(rg, 4) + 0.025 * N.noise(x * 7 + ox, y * 7, z * 7);
    } else if (type === 'slab') {
      n1 = N.fbm(x * 1.6 + ox, y * 1.6 + oy, z * 1.6 + oz, 4);
      const ph = y * strataFreq + n1 * 1.2 + strataPhase;
      const st = ph - Math.floor(ph);
      r = 0.94 + 0.08 * n1 - 0.05 * smoothstep(0.75, 0.95, st) + 0.02 * N.noise(x * 8 + oy, y * 8, z * 8);
    } else if (type === 'spire') {
      n1 = N.fbm(x * 1.6 + ox, y * 0.9 + oy, z * 1.6 + oz, 4);
      const fl = N.ridged(x * 4.2 + ox, y * 1.1 + oy, z * 4.2 + oz, 3);
      r = 0.9 + 0.14 * n1 - 0.2 * Math.pow(fl, 2.5) + 0.03 * N.noise(x * 9, y * 4 + ox, z * 9);
    } else if (type === 'cliff') {
      n1 = N.fbm(x * 1.2 + ox, y * 1.2 + oy, z * 1.2 + oz, 4);
      const ph = y * strataFreq + n1 * 0.8 + strataPhase;
      const st = ph - Math.floor(ph);
      const ledge = smoothstep(0.62, 0.9, st);
      const joint = N.ridged(x * 4.2 + oy, y * 1.1 + oz, z * 4.2 + ox, 3);
      r = 0.95 + 0.07 * n1 - 0.07 * ledge - 0.08 * Math.pow(joint, 4) + 0.02 * N.noise(x * 9, y * 9 + oz, z * 9);
    } else {
      n1 = N.fbm(x * 1.1 + ox, y * 1.1 + oy, z * 1.1 + oz, 3);
      r = 0.96 + 0.07 * n1;
    }
    let vx = x * r;
    let vy = y * r;
    let vz = z * r;
    if (type === 'spire') {
      // taper towards a jagged top with secondary pinnacles
      const tp = 1 - 0.35 * smoothstep(0.0, 1.0, y);
      vx *= tp;
      vz *= tp;
      if (y > 0.3) vy += 0.3 * smoothstep(0.3, 1.0, y) * N.fbm(x * 4 + ox, 0.5, z * 4 + oz, 3);
    }
    for (let c = 0; c < cuts.length; c++) {
      const [cx, cy, cz, o] = cuts[c];
      const d = vx * cx + vy * cy + vz * cz - o;
      if (d > 0) { vx -= cx * d; vy -= cy * d; vz -= cz * d; }
    }
    const floor = type === 'spire' ? -0.85 : -0.7;
    if (vy < floor) vy = floor + (vy - floor) * 0.3;
    out[i * 4] = vx;
    out[i * 4 + 1] = vy;
    out[i * 4 + 2] = vz;
    nd[i] = r - 1;
  }
  // normalise so the farthest point lies on the unit sphere
  let maxR = 0;
  for (let i = 0; i < V; i++) maxR = Math.max(maxR, Math.hypot(out[i * 4], out[i * 4 + 1], out[i * 4 + 2]));
  const inv = 1 / maxR;
  for (let i = 0; i < V; i++) { out[i * 4] *= inv; out[i * 4 + 1] *= inv; out[i * 4 + 2] *= inv; }
  // AO: cavity (Laplacian along the normal) + noise valleys + ground contact
  const idx = ico.levels[maxLevel].index;
  const nrm = computeNormals(out, idx, V);
  const sum = new Float32Array(V * 3);
  const cnt = new Float32Array(V);
  const elen = new Float32Array(V);
  for (let f = 0; f < idx.length; f += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[f + e];
      const b = idx[f + ((e + 1) % 3)];
      const dx = out[b * 4] - out[a * 4];
      const dy = out[b * 4 + 1] - out[a * 4 + 1];
      const dz = out[b * 4 + 2] - out[a * 4 + 2];
      const l = Math.hypot(dx, dy, dz);
      sum[a * 3] += dx; sum[a * 3 + 1] += dy; sum[a * 3 + 2] += dz; cnt[a]++; elen[a] += l;
      sum[b * 3] -= dx; sum[b * 3 + 1] -= dy; sum[b * 3 + 2] -= dz; cnt[b]++; elen[b] += l;
    }
  }
  let ao = new Float32Array(V);
  for (let i = 0; i < V; i++) {
    const c = cnt[i] || 1;
    const cav = (sum[i * 3] * nrm[i * 3] + sum[i * 3 + 1] * nrm[i * 3 + 1] + sum[i * 3 + 2] * nrm[i * 3 + 2]) / c / ((elen[i] / c) || 1);
    const y = out[i * 4 + 1];
    ao[i] = clamp01(1 - Math.max(0, cav) * 2.2) * (0.75 + 0.25 * smoothstep(-0.08, 0.05, nd[i])) * (0.55 + 0.45 * smoothstep(-0.75, 0.1, y));
  }
  // smooth a couple of times over the 1-ring
  for (let it = 0; it < 2; it++) {
    const acc = new Float32Array(V);
    const n = new Float32Array(V);
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f];
      const b = idx[f + 1];
      const c = idx[f + 2];
      acc[a] += ao[b] + ao[c]; n[a] += 2;
      acc[b] += ao[a] + ao[c]; n[b] += 2;
      acc[c] += ao[a] + ao[b]; n[c] += 2;
    }
    const nao = new Float32Array(V);
    for (let i = 0; i < V; i++) nao[i] = (ao[i] * 2 + acc[i] / (n[i] || 1)) / 3;
    ao = nao;
  }
  for (let i = 0; i < V; i++) out[i * 4 + 3] = ao[i];
  return out;
}

function computeNormals(p4, index, vcount) {
  const n = new Float32Array(vcount * 3);
  for (let f = 0; f < index.length; f += 3) {
    const a = index[f];
    const b = index[f + 1];
    const c = index[f + 2];
    const e1x = p4[b * 4] - p4[a * 4];
    const e1y = p4[b * 4 + 1] - p4[a * 4 + 1];
    const e1z = p4[b * 4 + 2] - p4[a * 4 + 2];
    const e2x = p4[c * 4] - p4[a * 4];
    const e2y = p4[c * 4 + 1] - p4[a * 4 + 1];
    const e2z = p4[c * 4 + 2] - p4[a * 4 + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    n[a * 3] += nx; n[a * 3 + 1] += ny; n[a * 3 + 2] += nz;
    n[b * 3] += nx; n[b * 3 + 1] += ny; n[b * 3 + 2] += nz;
    n[c * 3] += nx; n[c * 3 + 1] += ny; n[c * 3 + 2] += nz;
  }
  for (let i = 0; i < vcount; i++) {
    const l = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) || 1;
    n[i * 3] /= l; n[i * 3 + 1] /= l; n[i * 3 + 2] /= l;
  }
  return n;
}

const _variantCache = new Map();

/** Displaced positions/AO + per-level normals for one variant (cached at module level). */
function getVariant(type, k) {
  const key = `${type}:${k}`;
  let v = _variantCache.get(key);
  if (v) return v;
  const ico = icosphere();
  const maxLevel = MAX_LEVEL[type];
  const data = buildVariant(type, 9001 + ROCK_TYPES.indexOf(type) * 101 + k * 17, maxLevel);
  const normals = {};
  for (const l of LOD_LEVELS) {
    if (l > maxLevel) continue;
    const lv = ico.levels[l];
    const n = computeNormals(data, lv.index, lv.vcount);
    const u8 = new Uint8Array(lv.vcount * 4);
    for (let i = 0; i < lv.vcount; i++) {
      u8[i * 4] = Math.round((n[i * 3] * 0.5 + 0.5) * 255);
      u8[i * 4 + 1] = Math.round((n[i * 3 + 1] * 0.5 + 0.5) * 255);
      u8[i * 4 + 2] = Math.round((n[i * 3 + 2] * 0.5 + 0.5) * 255);
      u8[i * 4 + 3] = 255;
    }
    normals[l] = u8;
  }
  v = { type, maxLevel, data, normals };
  _variantCache.set(key, v);
  return v;
}

/** Packs the variants of the given rock types into vertex-pulling data textures. */
function packLibrary(types) {
  const t0 = performance.now();
  const ico = icosphere();
  const variants = new Array(ROCK_TYPES.length * VARIANTS_PER_TYPE).fill(null);
  let posTexels = 0;
  let nrmTexels = 0;
  const list = [];
  ROCK_TYPES.forEach((type, ti) => {
    if (!types.has(type)) return;
    for (let k = 0; k < VARIANTS_PER_TYPE; k++) {
      const src = getVariant(type, k);
      const v = { type, maxLevel: src.maxLevel, src, posOffset: posTexels, nrmOffset: {} };
      posTexels += ico.levels[src.maxLevel].vcount;
      for (const l of LOD_LEVELS) {
        if (l > src.maxLevel) continue;
        v.nrmOffset[l] = nrmTexels;
        nrmTexels += ico.levels[l].vcount;
      }
      variants[ti * VARIANTS_PER_TYPE + k] = v;
      list.push(v);
    }
  });
  const posRows = Math.max(1, Math.ceil(posTexels / TEX_W));
  const nrmRows = Math.max(1, Math.ceil(nrmTexels / TEX_W));
  const posData = new Float32Array(TEX_W * posRows * 4);
  const nrmData = new Uint8Array(TEX_W * nrmRows * 4);
  for (const v of list) {
    posData.set(v.src.data, v.posOffset * 4);
    for (const l of LOD_LEVELS) if (v.src.normals[l]) nrmData.set(v.src.normals[l], v.nrmOffset[l] * 4);
  }
  const posTex = new THREE.DataTexture(posData, TEX_W, posRows, THREE.RGBAFormat, THREE.FloatType);
  const nrmTex = new THREE.DataTexture(nrmData, TEX_W, nrmRows, THREE.RGBAFormat, THREE.UnsignedByteType);
  for (const t of [posTex, nrmTex]) {
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
  }
  const geometries = {};
  for (const l of LOD_LEVELS) {
    const lv = ico.levels[l];
    const g = new THREE.BufferGeometry();
    const p = new THREE.BufferAttribute(ico.pos.slice(0, lv.vcount * 3), 3);
    g.setAttribute('position', p);
    g.setAttribute('normal', p);
    g.setIndex(lv.vcount > 65535 ? new THREE.Uint32BufferAttribute(lv.index, 1) : new THREE.Uint16BufferAttribute(lv.index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    geometries[l] = { geometry: g, triangles: lv.index.length / 3 };
  }
  return {
    types: new Set(types), variants, posTex, nrmTex, geometries, buildMs: performance.now() - t0,
    dispose() {
      posTex.dispose();
      nrmTex.dispose();
      for (const l of LOD_LEVELS) geometries[l].geometry.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------

const ROCK_VERT_PARS = /* glsl */`
uniform highp sampler2D tRockPos;
uniform highp sampler2D tRockNrm;
uniform vec3 uRockView;
attribute vec4 aRock;      // x = position offset, y = normal offset (this LOD), z = fade-out distance
attribute vec4 aRockTint;  // rgb tint, a = lichen amount
ivec2 rockTexel( int i ) { return ivec2( i & ${TEX_W - 1}, i >> ${Math.log2(TEX_W)} ); }
`;

const ROCK_FETCH_POS = /* glsl */`
vec4 rockP = texelFetch( tRockPos, rockTexel( int( aRock.x + 0.5 ) + gl_VertexID ), 0 );
float rockD = distance( uRockView, instanceMatrix[ 3 ].xyz );
float rockFade = 1.0 - smoothstep( aRock.z * 0.75, aRock.z, rockD );
vec3 transformed = rockP.xyz * rockFade;
`;

function injectRockVertex(src) {
  return src
    .replace('#include <common>', `#include <common>
${ROCK_VERT_PARS}
varying vec3 vRockW;
varying vec3 vRockN;
varying vec4 vRockTint;
varying float vRockAO;
varying float vRockY;
`)
    .replace('#include <beginnormal_vertex>', `
vec3 objectNormal = texelFetch( tRockNrm, rockTexel( int( aRock.y + 0.5 ) + gl_VertexID ), 0 ).xyz * 2.0 - 1.0;
`)
    .replace('#include <begin_vertex>', `${ROCK_FETCH_POS}
mat3 rockIM = mat3( instanceMatrix );
vec3 rockN = objectNormal / vec3( dot( rockIM[ 0 ], rockIM[ 0 ] ), dot( rockIM[ 1 ], rockIM[ 1 ] ), dot( rockIM[ 2 ], rockIM[ 2 ] ) );
vRockN = normalize( mat3( modelMatrix ) * ( rockIM * rockN ) );
vRockW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
vRockTint = aRockTint;
vRockAO = rockP.w;
vRockY = rockP.y;
`);
}

function injectRockDepthVertex(src) {
  return src
    .replace('#include <common>', `#include <common>
${ROCK_VERT_PARS}
`)
    .replace('#include <begin_vertex>', ROCK_FETCH_POS);
}

function injectRockFragment(src) {
  return src
    .replace('#include <common>', `#include <common>
uniform sampler2D tRockAlbedo;
uniform sampler2D tRockNormal;
uniform vec4 uRockParams;   // x = texture frequency (1/m), y = normal strength, z = lichen amount, w = moss amount
uniform vec3 uRockLichen;
uniform vec3 uRockMoss;
varying vec3 vRockW;
varying vec3 vRockN;
varying vec4 vRockTint;
varying float vRockAO;
varying float vRockY;
`)
    .replace('#include <map_fragment>', `
vec3 rockGN = normalize( vRockN );
vec3 rockBW = pow( abs( rockGN ), vec3( 4.0 ) );
rockBW /= ( rockBW.x + rockBW.y + rockBW.z );
vec3 rockP = vRockW * uRockParams.x;
vec4 rockA = texture( tRockAlbedo, rockP.zy ) * rockBW.x + texture( tRockAlbedo, rockP.xz ) * rockBW.y + texture( tRockAlbedo, rockP.xy ) * rockBW.z;
vec3 rockQ = rockP * 0.19 + 0.37;
vec4 rockM = texture( tRockAlbedo, rockQ.zy ) * rockBW.x + texture( tRockAlbedo, rockQ.xz ) * rockBW.y + texture( tRockAlbedo, rockQ.xy ) * rockBW.z;
// large-scale tone variation + vertical weathering streaks on steep faces
float rockStreak = texture( tRockAlbedo, vec2( ( rockP.x + rockP.z ) * 0.35, rockP.y * 0.02 ) ).r;
vec3 rockCol = rockA.rgb * ( 0.72 + 0.55 * rockM.r ) * mix( 1.0, 0.75 + 0.35 * rockStreak, ( 1.0 - abs( rockGN.y ) ) * 0.6 );
// lichen on upward faces, patchy mask from the alpha channel at two scales
float rockUp = smoothstep( 0.15, 0.75, rockGN.y );
float rockL = smoothstep( 0.5, 0.62, rockM.a * 0.6 + rockA.a * 0.5 );
float rockLichen = rockL * rockUp * uRockParams.z * vRockTint.a;
rockCol = mix( rockCol, uRockLichen * ( 0.75 + 0.5 * rockA.r ), clamp( rockLichen, 0.0, 1.0 ) );
// moss/dirt near the ground contact and in crevices
float rockLow = 1.0 - smoothstep( -0.65, -0.15, vRockY );
rockCol = mix( rockCol, uRockMoss * ( 0.8 + 0.4 * rockA.g ), clamp( ( rockLow * 0.7 + ( 1.0 - vRockAO ) * 0.5 ) * uRockParams.w, 0.0, 0.85 ) );
rockCol *= mix( 0.42, 1.0, vRockAO ) * vRockTint.rgb;
diffuseColor.rgb *= rockCol;
`)
    .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = mix( 0.82, 0.96, clamp( rockLichen + rockLow * 0.5, 0.0, 1.0 ) ) - rockA.r * 0.06;
`)
    .replace('#include <normal_fragment_maps>', `
vec3 rockTX = texture( tRockNormal, rockP.zy ).xyz * 2.0 - 1.0;
vec3 rockTY = texture( tRockNormal, rockP.xz ).xyz * 2.0 - 1.0;
vec3 rockTZ = texture( tRockNormal, rockP.xy ).xyz * 2.0 - 1.0;
vec3 rockPert = vec3( 0.0, rockTX.y, rockTX.x ) * rockBW.x + vec3( rockTY.x, 0.0, rockTY.y ) * rockBW.y + vec3( rockTZ.x, rockTZ.y, 0.0 ) * rockBW.z;
vec3 rockWN = normalize( rockGN + rockPert * uRockParams.y );
normal = normalize( ( viewMatrix * vec4( rockWN, 0.0 ) ).xyz );
`)
    .replace('#include <aomap_fragment>', `
reflectedLight.indirectDiffuse *= mix( 0.35, 1.0, vRockAO );
reflectedLight.indirectSpecular *= mix( 0.35, 1.0, vRockAO );
`);
}

// ---------------------------------------------------------------------------------------------
// RockSystem
// ---------------------------------------------------------------------------------------------

const TYPE_TINT = {
  boulder: [1.0, 0.99, 0.97, 1.0],
  slab: [0.95, 0.94, 0.92, 0.8],
  spire: [0.74, 0.74, 0.76, 0.35],
  cliff: [0.8, 0.79, 0.78, 0.55],
  pebble: [0.92, 0.9, 0.87, 0.5],
};

function sphereInFrustum(frustum, x, y, z, r) {
  const planes = frustum.planes;
  for (let i = 0; i < 6; i++) {
    const p = planes[i];
    if (p.normal.x * x + p.normal.y * y + p.normal.z * z + p.constant < -r) return false;
  }
  return true;
}

function markRange(attr, count) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count * attr.itemSize);
  attr.needsUpdate = true;
}

const _m4 = new THREE.Matrix4();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();

/**
 * Instanced procedural rocks with 4 LOD levels (vertex pulled), triplanar material, shadows.
 * Each rock fills the ellipsoid (x, y, z) radii (sx, sy, sz), rotated by rotY about Y.
 */
export class RockSystem {
  /** @param {{ scene: THREE.Scene, quality?: 'low'|'medium'|'high'|'ultra' }} opts */
  constructor({ scene, quality = 'high' }) {
    this.scene = scene;
    this.quality = ROCK_QUALITY[quality] ? quality : 'high';
    this.q = ROCK_QUALITY[this.quality];
    this.group = new THREE.Group();
    this.group.name = 'Rocks';
    scene.add(this.group);
    /** Per-frame CPU frustum culling (disable if you render extra views with other cameras). */
    this.frustumCulling = true;
    this.uniforms = {
      uRockView: { value: new THREE.Vector3() },
      uRockParams: { value: new THREE.Vector4(0.42, 0.9, 1.0, 0.35) },
      uRockLichen: { value: new THREE.Color('#a7ab86') },
      uRockMoss: { value: new THREE.Color('#4a5230') },
      tRockPos: { value: null },
      tRockNrm: { value: null },
    };
    this._frustum = new THREE.Frustum();
    this._shadowFrustum = new THREE.Frustum();
    this._camPos = new THREE.Vector3();
    this._lastPos = new THREE.Vector3(1e9, 1e9, 1e9);
    this._lastRebucket = -1e9;
    this._lods = [];
    this._stats = { drawCalls: 0, rocks: 0, triangles: 0, shadowDrawCalls: 0, buildMs: 0 };
    this.count = 0;
  }

  _ensureResources(types) {
    if (!this._lib || [...types].some((t) => !this._lib.types.has(t))) {
      const all = new Set([...(this._lib ? this._lib.types : []), ...types]);
      if (this._lib) this._lib.dispose();
      this._lib = packLibrary(all);
      this.uniforms.tRockPos.value = this._lib.posTex;
      this.uniforms.tRockNrm.value = this._lib.nrmTex;
    }
    if (this.material) return;
    this._tex = createRockTextures(this.q.texSize, 8);
    const U = this.uniforms;
    const tex = this._tex;
    const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U, { tRockAlbedo: { value: tex.albedo }, tRockNormal: { value: tex.normal } });
      shader.vertexShader = injectRockVertex(shader.vertexShader);
      shader.fragmentShader = injectRockFragment(shader.fragmentShader);
    };
    m.customProgramCacheKey = () => 'rock-v1';
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    d.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = injectRockDepthVertex(shader.vertexShader);
    };
    d.customProgramCacheKey = () => 'rock-depth-v1';
    this.material = m;
    this.depthMaterial = d;
  }

  /**
   * @param {Array<{x:number,y:number,z:number,rotY:number,sx:number,sy:number,sz:number,type:string,variant?:number}>} rocks
   */
  build(rocks = []) {
    const t0 = performance.now();
    this._clear();
    const types = new Set();
    for (const r of rocks) types.add(ROCK_TYPES.includes(r.type) ? r.type : 'boulder');
    if (!types.size) types.add('boulder');
    this._ensureResources(types);
    const lib = this._lib;
    const n = rocks.length;
    const mat = new Float32Array(n * 16);
    const pos = new Float32Array(n * 4); // x, y, z, radius
    const tint = new Float32Array(n * 4);
    const vari = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const r = rocks[i];
      let ti = ROCK_TYPES.indexOf(r.type);
      if (ti < 0) ti = 0;
      const k = r.variant !== undefined ? r.variant % VARIANTS_PER_TYPE : Math.floor(hash2(r.x, r.z, 41) * VARIANTS_PER_TYPE);
      vari[i] = ti * VARIANTS_PER_TYPE + k;
      const c = Math.cos(r.rotY || 0);
      const s = Math.sin(r.rotY || 0);
      const o = i * 16;
      mat[o] = c * r.sx; mat[o + 1] = 0; mat[o + 2] = -s * r.sx; mat[o + 3] = 0;
      mat[o + 4] = 0; mat[o + 5] = r.sy; mat[o + 6] = 0; mat[o + 7] = 0;
      mat[o + 8] = s * r.sz; mat[o + 9] = 0; mat[o + 10] = c * r.sz; mat[o + 11] = 0;
      mat[o + 12] = r.x; mat[o + 13] = r.y; mat[o + 14] = r.z; mat[o + 15] = 1;
      pos[i * 4] = r.x; pos[i * 4 + 1] = r.y; pos[i * 4 + 2] = r.z;
      pos[i * 4 + 3] = Math.max(r.sx, r.sy, r.sz);
      const tt = TYPE_TINT[ROCK_TYPES[ti]];
      const h1 = hash2(r.x, r.z, 42);
      const h2 = hash2(r.x, r.z, 43);
      const br = 0.86 + 0.24 * h1;
      tint[i * 4] = tt[0] * br * (1.0 + (h2 - 0.5) * 0.06);
      tint[i * 4 + 1] = tt[1] * br;
      tint[i * 4 + 2] = tt[2] * br * (1.0 - (h2 - 0.5) * 0.06);
      tint[i * 4 + 3] = tt[3] * (0.4 + 0.9 * hash2(r.x, r.z, 44));
    }
    this.data = { n, mat, pos, tint, vari };
    this._lods = LOD_LEVELS.map((level, li) => {
      const geo = new THREE.BufferGeometry();
      const src = lib.geometries[level].geometry;
      geo.setAttribute('position', src.attributes.position);
      geo.setAttribute('normal', src.attributes.normal);
      geo.setIndex(src.index);
      const cap = Math.max(1, n);
      const aRock = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const aTint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aRock', aRock);
      geo.setAttribute('aRockTint', aTint);
      const mesh = new THREE.InstancedMesh(geo, this.material, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.customDepthMaterial = this.depthMaterial;
      mesh.castShadow = level >= 2;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      mesh.name = `rocks-L${level}`;
      const st = { level, li, mesh, aRock, aTint, list: new Int32Array(cap), listN: 0, main: 0, shadow: 0, triangles: lib.geometries[level].triangles };
      mesh.onBeforeShadow = () => { mesh.count = st.shadow; };
      mesh.onBeforeRender = () => { mesh.count = st.main; };
      this.group.add(mesh);
      return st;
    });
    this._scratch = new Int32Array(Math.max(1, n));
    this.count = n;
    this._lastRebucket = -1e9;
    this._stats.buildMs = performance.now() - t0;
    this._stats.libraryMs = lib.buildMs;
    this._stats.types = [...lib.types].join(',');
  }

  _clear() {
    for (const st of this._lods) {
      this.group.remove(st.mesh);
      st.mesh.geometry.deleteAttribute('aRock');
      st.mesh.geometry.deleteAttribute('aRockTint');
      st.mesh.geometry.dispose();
      st.mesh.dispose();
    }
    this._lods = [];
  }

  _findShadowLight() {
    let found = null;
    this.scene.traverseVisible((o) => {
      if (!found && o.castShadow && (o.isDirectionalLight || o.isSunLight)) found = o;
    });
    this._shadowLight = found;
  }

  _rebucket() {
    const { n, pos, vari } = this.data;
    const cam = this._camPos;
    const q = this.q;
    const t5 = LOD_THRESHOLDS[0] * q.lodScale;
    const t4 = LOD_THRESHOLDS[1] * q.lodScale;
    const t3 = LOD_THRESHOLDS[2] * q.lodScale;
    for (const st of this._lods) st.listN = 0;
    const far2 = q.far * q.far;
    for (let i = 0; i < n; i++) {
      const dx = pos[i * 4] - cam.x;
      const dy = pos[i * 4 + 1] - cam.y;
      const dz = pos[i * 4 + 2] - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > far2) continue;
      const r = pos[i * 4 + 3];
      const d = Math.sqrt(d2) + 1e-3;
      const m = r / d;
      if (m < q.cull) continue;
      const maxL = Math.min(MAX_LEVEL[ROCK_TYPES[Math.floor(vari[i] / VARIANTS_PER_TYPE)]], q.maxLevel);
      let level = m > t5 ? 4 : m > t4 ? 3 : m > t3 ? 2 : 1;
      if (level > maxL) level = maxL;
      const st = this._lods[LOD_LEVELS.indexOf(level)];
      st.list[st.listN++] = i;
    }
    this._findShadowLight();
  }

  /**
   * Per-frame LOD/culling update (re-buckets every ~0.3 s or 4 m of camera motion).
   * @param {THREE.Camera} camera
   */
  update(camera) {
    if (!this.data) return;
    camera.updateMatrixWorld();
    this._camPos.setFromMatrixPosition(camera.matrixWorld);
    this.uniforms.uRockView.value.copy(this._camPos);
    const now = performance.now();
    if (now - this._lastRebucket > 300 || this._camPos.distanceToSquared(this._lastPos) > 16) {
      this._lastRebucket = now;
      this._lastPos.copy(this._camPos);
      this._rebucket();
    }
    _m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(_m4, camera.coordinateSystem, camera.reversedDepth);
    const light = this._shadowLight;
    const dirShadow = light && light.isDirectionalLight;
    if (dirShadow) {
      const sc = light.shadow.camera;
      light.updateWorldMatrix(true, false);
      light.target.updateWorldMatrix(true, false);
      _va.setFromMatrixPosition(light.matrixWorld);
      _vb.setFromMatrixPosition(light.target.matrixWorld);
      sc.position.copy(_va);
      sc.lookAt(_vb);
      sc.updateMatrixWorld();
      _m4.multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse);
      this._shadowFrustum.setFromProjectionMatrix(_m4, sc.coordinateSystem, sc.reversedDepth);
    }
    const { pos } = this.data;
    let calls = 0;
    let shadowCalls = 0;
    let drawn = 0;
    let tris = 0;
    for (const st of this._lods) {
      let main = 0;
      let extra = 0;
      const casts = st.mesh.castShadow && !!light;
      for (let k = 0; k < st.listN; k++) {
        const i = st.list[k];
        const x = pos[i * 4];
        const y = pos[i * 4 + 1];
        const z = pos[i * 4 + 2];
        const r = pos[i * 4 + 3];
        if (!this.frustumCulling || sphereInFrustum(this._frustum, x, y, z, r)) {
          this._write(st, main++, i);
        } else if (casts && (!dirShadow || sphereInFrustum(this._shadowFrustum, x, y, z, r))) {
          this._scratch[extra++] = i;
        }
      }
      for (let k = 0; k < extra; k++) this._write(st, main + k, this._scratch[k]);
      const total = main + extra;
      st.main = main;
      st.shadow = st.mesh.castShadow ? total : 0;
      st.mesh.count = main;
      st.mesh.visible = total > 0;
      if (total > 0) {
        markRange(st.mesh.instanceMatrix, total);
        markRange(st.aRock, total);
        markRange(st.aTint, total);
      }
      if (main) calls++;
      if (st.shadow) shadowCalls++;
      drawn += main;
      tris += main * st.triangles;
    }
    const s = this._stats;
    s.drawCalls = calls;
    s.shadowDrawCalls = shadowCalls;
    s.rocks = drawn;
    s.triangles = tris;
  }

  _write(st, slot, i) {
    const { mat, pos, tint, vari } = this.data;
    const mArr = st.mesh.instanceMatrix.array;
    const rArr = st.aRock.array;
    const tArr = st.aTint.array;
    const o = slot * 16;
    const s = i * 16;
    for (let k = 0; k < 16; k++) mArr[o + k] = mat[s + k];
    const v = this._lib.variants[vari[i]];
    const q = slot * 4;
    rArr[q] = v.posOffset;
    rArr[q + 1] = v.nrmOffset[st.level];
    rArr[q + 2] = Math.min(this.q.far, pos[i * 4 + 3] / this.q.cull);
    rArr[q + 3] = 0;
    tArr[q] = tint[i * 4]; tArr[q + 1] = tint[i * 4 + 1]; tArr[q + 2] = tint[i * 4 + 2]; tArr[q + 3] = tint[i * 4 + 3];
  }

  /** Change quality preset (LOD distances, max detail level). */
  setQuality(q) {
    if (!ROCK_QUALITY[q]) return;
    this.quality = q;
    this.q = ROCK_QUALITY[q];
    this._lastRebucket = -1e9;
  }

  /** { drawCalls, rocks, triangles, shadowDrawCalls, buildMs } */
  get stats() {
    return { ...this._stats };
  }

  dispose() {
    this._clear();
    this.scene.remove(this.group);
    if (this.material) this.material.dispose();
    if (this.depthMaterial) this.depthMaterial.dispose();
    if (this._tex) {
      this._tex.albedo.dispose();
      this._tex.normal.dispose();
    }
    if (this._lib) this._lib.dispose();
    this._lib = null;
    this.material = null;
    this.data = null;
  }
}
