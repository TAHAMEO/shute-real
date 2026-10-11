// SHUTE REAL - procedural trees and bushes.
// Procedural meshes per species (3 shape variants each), alpha-tested foliage cards with
// spherical normals + back-light translucency, bark albedo/normal maps, GPU wind, instanced
// rendering with near meshes + runtime-baked impostor billboards (dithered LOD crossfade),
// per-frame frustum/shadow-frustum culling of the near set.
import * as THREE from 'three';
import {
  createVegetationTextures, VEG_LAYERS as L, mulberry32, hash2, smoothstep, clamp01,
} from './vegetation-textures.js';

/** Base dimensions at scale 1 (trunk radius at ≈1 m above ground, total height). */
export const TREE_SPECIES = {
  pine: { trunkRadius: 0.25, height: 20 },
  araucaria: { trunkRadius: 0.30, height: 22 },
  spruce: { trunkRadius: 0.22, height: 16 },
  birch: { trunkRadius: 0.16, height: 14 },
  oak: { trunkRadius: 0.35, height: 13 },
  dead: { trunkRadius: 0.20, height: 11 },
};
export const BUSH_SPECIES = ['shrub', 'fern', 'juniper'];

const SPECIES_LIST = Object.keys(TREE_SPECIES);
const TREE_VARIANTS = 3;
const BUSH_VARIANTS = 2;
const IMPOSTOR_VIEWS = 8;
const MAX_IMPOSTOR_VARIANTS = SPECIES_LIST.length * TREE_VARIANTS;
const NEAR_TRIANGLE_BUDGET = 5900;

/**
 * Quality presets (near tree distance, bush distance/density/shadows, impostor layer width).
 * offShadow: off-screen trees/bushes farther than this (m) from the camera don't cast shadows.
 */
export const VEGETATION_QUALITY = {
  low: { treeNear: 80, treeFar: 900, bushFar: 50, bushDensity: 0.3, bushShadows: false, impostorRes: 48, texSize: 256, aniso: 2, offShadow: 35 },
  medium: { treeNear: 110, treeFar: 1200, bushFar: 75, bushDensity: 0.6, bushShadows: false, impostorRes: 64, texSize: 256, aniso: 4, offShadow: 45 },
  high: { treeNear: 150, treeFar: 1500, bushFar: 100, bushDensity: 1.0, bushShadows: true, impostorRes: 96, texSize: 512, aniso: 8, offShadow: 70 },
  ultra: { treeNear: 200, treeFar: 1800, bushFar: 120, bushDensity: 1.0, bushShadows: true, impostorRes: 128, texSize: 512, aniso: 16, offShadow: 1e9 },
};

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------------------------
// Build-time vector helpers (plain arrays; allocation is fine at build time)
// ---------------------------------------------------------------------------------------------

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const perp = (a) => norm(cross(a, Math.abs(a[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0]));
/** Rotate v about unit axis k by angle (Rodrigues). */
function rotAxis(v, k, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}
/** Direction from azimuth (around +Y, 0 = +Z) and elevation (0 = horizontal). */
const dirAE = (az, el) => [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];

// ---------------------------------------------------------------------------------------------
// Mesh builder. Vertex layout: position, normal, uv, aColor (rgb tint * 0.5, ao) u8n,
// aData (layer, type 0 bark / 1 leaf / 2 twig, flex*255, phase*255) u8.
// ---------------------------------------------------------------------------------------------

class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.dat = [];
    this.idx = [];
    this.n = 0;
  }

  vert(p, n, u, v, tint, ao, layer, type, flex, phase) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.col.push(tint[0] * 0.5, tint[1] * 0.5, tint[2] * 0.5, ao);
    this.dat.push(layer, type, clamp01(flex) * 255, clamp01(phase) * 255);
    return this.n++;
  }

  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }

  get triangles() {
    return this.idx.length / 3;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const col = new Uint8Array(this.col.length);
    for (let i = 0; i < col.length; i++) col[i] = Math.round(clamp01(this.col[i]) * 255);
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 4, true));
    const dat = new Uint8Array(this.dat.length);
    for (let i = 0; i < dat.length; i++) dat[i] = Math.round(this.dat[i]);
    g.setAttribute('aData', new THREE.BufferAttribute(dat, 4, false));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const WHITE = [1, 1, 1];

/**
 * Generalised cylinder along a polyline.
 * opts: radial, layer, uRep, vScale, tint(t,p)->rgb, ao(t,p)->ao, flex(t)->0..1, phase, rnoise(theta,t)->factor, cap
 */
function addTube(b, pts, radii, opts) {
  const n = opts.radial;
  const count = pts.length;
  let T = norm(sub(pts[1], pts[0]));
  let N = perp(T);
  let vAcc = 0;
  let prev = -1;
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      const Tn = norm(i < count - 1 ? sub(pts[i + 1], pts[i - 1]) : sub(pts[i], pts[i - 1]));
      N = norm(madd(N, Tn, -dot(N, Tn)));
      T = Tn;
      vAcc += vlen(sub(pts[i], pts[i - 1]));
    }
    const B = cross(T, N);
    const t = i / (count - 1);
    const tint = opts.tint ? opts.tint(t, pts[i]) : WHITE;
    const ao = opts.ao ? opts.ao(t, pts[i]) : 1;
    const flex = opts.flex ? opts.flex(t) : 0;
    const start = b.n;
    for (let j = 0; j <= n; j++) {
      const th = (j / n) * TAU;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const dir = [N[0] * c + B[0] * s, N[1] * c + B[1] * s, N[2] * c + B[2] * s];
      const r = radii[i] * (opts.rnoise ? opts.rnoise(th, t, pts[i]) : 1);
      b.vert(madd(pts[i], dir, r), dir, (j / n) * opts.uRep, vAcc / opts.vScale, tint, ao, opts.layer, 0, flex, opts.phase || 0);
    }
    if (prev >= 0) {
      for (let j = 0; j < n; j++) b.quad(prev + j, prev + j + 1, start + j + 1, start + j);
    }
    prev = start;
  }
  if (opts.cap) {
    // jagged/broken cap: fan to an off-centre point
    const last = pts[count - 1];
    const tint = opts.tint ? opts.tint(1, last) : WHITE;
    const tip = madd(last, T, radii[count - 1] * (opts.capHeight ?? 0.3));
    const c = b.vert(tip, T, 0.5, vAcc / opts.vScale + 0.1, tint, 0.8, opts.layer, 0, opts.flex ? opts.flex(1) : 0, opts.phase || 0);
    for (let j = 0; j < n; j++) b.idx.push(prev + j, prev + j + 1, c);
  }
}

/** Tapered radii along a path: r0 at the base → r1 at the tip. */
function taper(count, r0, r1, pow = 1) {
  const r = [];
  for (let i = 0; i < count; i++) r.push(r1 + (r0 - r1) * Math.pow(1 - i / (count - 1), pow));
  return r;
}

/**
 * Curved branch path. dir is the initial direction; `droop` bends it down along the length,
 * `upturn` bends the tip up, `wobble` adds random kinks.
 */
function branchPath(rng, start, dir, length, segs, { droop = 0, upturn = 0, wobble = 0.08 } = {}) {
  const pts = [start];
  let d = norm(dir);
  let p = start;
  const step = length / segs;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    d = norm([
      d[0] + (rng() - 0.5) * wobble,
      d[1] - (droop * (1.2 - t)) / segs * 2.2 + (upturn * t * t) / segs * 2.8 + (rng() - 0.5) * wobble * 0.5,
      d[2] + (rng() - 0.5) * wobble,
    ]);
    p = madd(p, d, step);
    pts.push(p);
  }
  return pts;
}

function pathAt(pts, t) {
  const f = clamp01(t) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const k = f - i;
  const a = pts[i];
  const b = pts[i + 1];
  return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k], d: norm(sub(b, a)) };
}

/**
 * Foliage context: crown ellipsoid (centre C, radii R) drives spherical normals and AO.
 */
function crown(C, R, { aoMin = 0.35, clumpW = 0.45, faceW = 0.18, lowDark = 0.25 } = {}) {
  return {
    C,
    R,
    normal(p, fn, clump) {
      const e = norm([(p[0] - C[0]) / (R[0] * R[0]), (p[1] - C[1]) / (R[1] * R[1]), (p[2] - C[2]) / (R[2] * R[2])]);
      const k = clump ? norm(sub(p, clump)) : e;
      const f = dot(fn, e) < 0 ? mul(fn, -1) : fn;
      return norm([e[0] + k[0] * clumpW + f[0] * faceW, e[1] + k[1] * clumpW + f[1] * faceW + 0.08, e[2] + k[2] * clumpW + f[2] * faceW]);
    },
    ao(p) {
      const e = Math.hypot((p[0] - C[0]) / R[0], (p[1] - C[1]) / R[1], (p[2] - C[2]) / R[2]);
      const low = clamp01(0.5 + 0.5 * (p[1] - C[1]) / R[1]);
      return (aoMin + (1 - aoMin) * smoothstep(0.1, 1.0, e)) * (1 - lowDark + lowDark * low);
    },
  };
}

/** One alpha-tested card: base = attachment point (texture bottom centre), up/side unit vectors. */
function addCard(b, cr, base, up, side, w, h, layer, flex, phase, clump, tint = WHITE, type = 1, clumpR = 0) {
  const fn = norm(cross(side, up));
  const p0 = madd(madd(base, side, -w * 0.5), up, -h * 0.04);
  const p1 = madd(p0, side, w);
  const p2 = madd(p1, up, h);
  const p3 = madd(p0, up, h);
  const ids = [p0, p1, p2, p3].map((p, k) => {
    const uv = k === 0 ? [0, 0] : k === 1 ? [1, 0] : k === 2 ? [1, 1] : [0, 1];
    const f = k < 2 ? flex * 0.6 : flex;
    let ao = cr.ao(p);
    if (clumpR > 0) ao *= 0.5 + 0.5 * smoothstep(0, clumpR * 1.3, vlen(sub(p, clump)));
    return b.vert(p, cr.normal(p, fn, clump), uv[0], uv[1], tint, ao, layer, type, f, phase);
  });
  b.quad(ids[0], ids[1], ids[2], ids[3]);
}

/** Crossed pair of cards around `axis` with random roll. */
function addTuft(b, rng, cr, base, axis, w, h, layer, flex, clump, tint, type = 1) {
  const s1 = rotAxis(perp(axis), axis, rng() * Math.PI);
  const s2 = norm(cross(axis, s1));
  const phase = rng();
  addCard(b, cr, base, axis, s1, w, h, layer, flex, phase, clump, tint, type);
  addCard(b, cr, base, axis, s2, w * 0.92, h * 0.96, layer, flex, phase, clump, tint, type);
}

function randomDir(rng) {
  const z = rng() * 2 - 1;
  const a = rng() * TAU;
  const r = Math.sqrt(1 - z * z);
  return [Math.cos(a) * r, z, Math.sin(a) * r];
}

/**
 * Volumetric clump of cards around centre c (radius r) facing random directions. radial = the
 * texture is centred (needle burst); otherwise cards grow outward from the clump centre.
 * lift biases the card's up axis (+ up, - hanging).
 */
function addClump(b, rng, cr, c, r, n, size, layer, flex, { radial = false, lift = 0, tint = WHITE, type = 1 } = {}) {
  for (let k = 0; k < n; k++) {
    const nd = randomDir(rng);
    const off = mul(randomDir(rng), r * Math.cbrt(rng()) * 0.65);
    const center = add(c, off);
    let a = madd(off, nd, -dot(off, nd));
    a = vlen(a) < 1e-4 ? perp(nd) : norm(a);
    a = norm(add(a, [0, lift, 0]));
    a = madd(a, nd, -dot(a, nd));
    a = vlen(a) < 1e-4 ? perp(nd) : norm(a);
    const side = norm(cross(a, nd));
    const w = size * (0.8 + rng() * 0.4);
    const base = madd(center, a, radial ? -w * 0.5 : -w * 0.3);
    addCard(b, cr, base, a, side, w, w, layer, flex, rng(), c, tint, type, r);
  }
}

/** Bent strip (fern frond / hanging spray) along a path, width vector per point. */
function addStrip(b, cr, pts, sides, widths, layer, flexFn, phase, up = null, tint = WHITE) {
  let prev = -1;
  let vAcc = 0;
  const total = pts.reduce((s, p, i) => (i ? s + vlen(sub(p, pts[i - 1])) : 0), 0);
  for (let i = 0; i < pts.length; i++) {
    if (i) vAcc += vlen(sub(pts[i], pts[i - 1]));
    const v = vAcc / total;
    const s = sides[i];
    const w = widths[i];
    const pl = madd(pts[i], s, -w * 0.5);
    const pr = madd(pts[i], s, w * 0.5);
    const d = i < pts.length - 1 ? norm(sub(pts[i + 1], pts[i])) : norm(sub(pts[i], pts[i - 1]));
    const fn = up || norm(cross(s, d));
    const a = b.vert(pl, cr.normal(pl, fn, null), 0, v, tint, cr.ao(pl), layer, 1, flexFn(v), phase);
    b.vert(pr, cr.normal(pr, fn, null), 1, v, tint, cr.ao(pr), layer, 1, flexFn(v), phase);
    if (prev >= 0) b.quad(prev, prev + 1, a + 1, a);
    prev = a;
  }
}

/**
 * Trunk: tapered, slightly curved/leaning column with root flare and buttresses.
 * radius(1 m) == R1 exactly (collision contract).
 */
function makeTrunk(b, rng, o) {
  const { H, R1, topR, topY } = o;
  const leanAz = rng() * TAU;
  const ph = rng() * TAU;
  const ph2 = rng() * TAU;
  const lean = o.lean ?? 0.01;
  const curve = o.curve ?? 0.1;
  const taperPow = o.taperPow ?? 1;
  const centerAt = (y) => {
    const yy = Math.max(0, y);
    const c = curve * Math.sin(yy * 0.22 + ph) * smoothstep(0, 4, yy);
    return [Math.sin(leanAz) * lean * yy + c * Math.cos(ph2), y, Math.cos(leanAz) * lean * yy + c * Math.sin(ph2)];
  };
  const radiusAt = (y) => {
    const u = clamp01((topY - y) / (topY - 1));
    let r = topR + (R1 - topR) * Math.pow(u, taperPow);
    if (y > topY) r = topR;
    const f = Math.max(0, 1 - y / 0.9);
    return r + R1 * (o.flare ?? 0.45) * f * f;
  };
  const ys = [-0.9, -0.3, 0.12, 0.35, 0.62, 0.9, 1.3];
  const segs = o.segs ?? 14;
  for (let i = 1; i <= segs; i++) ys.push(1.3 + (topY - 1.3) * Math.pow(i / segs, 1.15));
  const pts = ys.map(centerAt);
  const radii = ys.map(radiusAt);
  const bphase = [rng() * TAU, rng() * TAU, rng() * TAU];
  const buttress = o.buttress ?? 0.12;
  addTube(b, pts, radii, {
    radial: o.radial ?? 10,
    layer: o.layer,
    uRep: o.uRep ?? Math.max(1, Math.round((TAU * R1) / 0.8)),
    vScale: o.vScale ?? 0.8,
    tint: (t, p) => (o.tint ? o.tint(p[1]) : WHITE),
    ao: (t, p) => (o.ao ? o.ao(p[1]) : 0.55 + 0.45 * smoothstep(0, 2.5, p[1])),
    flex: () => 0,
    rnoise: (th, t, p) => {
      const y = p[1];
      const f = Math.max(0, 1 - y / 1.4);
      return 1 + buttress * f * f * (Math.sin(5 * th + bphase[0]) * 0.6 + Math.sin(3 * th + bphase[1]) * 0.4) +
        0.025 * Math.sin(7 * th + y * 1.7 + bphase[2]);
    },
    cap: o.cap,
    capHeight: o.capHeight,
  });
  return { centerAt, radiusAt, H, topY };
}

/** Short broken stub / dead branch. */
function addStub(b, rng, trunk, y, len, r, layer) {
  const c = trunk.centerAt(y);
  const az = rng() * TAU;
  const d = dirAE(az, -0.15 + rng() * 0.5);
  const start = madd(c, d, trunk.radiusAt(y) * 0.6);
  const pts = branchPath(rng, start, d, len, 2, { droop: 0.2, wobble: 0.2 });
  addTube(b, pts, taper(pts.length, r, r * 0.45), { radial: 4, layer, uRep: 1, vScale: 0.3, ao: () => 0.7, flex: (t) => t * 0.1, cap: false });
}

// ---------------------------------------------------------------------------------------------
// Species generators. Each returns the builder filled with one tree variant at scale 1.
// ---------------------------------------------------------------------------------------------

function genPine(rng, v, dens = 1) {
  const b = new MeshBuilder();
  const H = TREE_SPECIES.pine.height * [1.0, 0.94, 1.06][v];
  const R1 = TREE_SPECIES.pine.trunkRadius;
  const cb = H * [0.6, 0.67, 0.52][v];
  const trunk = makeTrunk(b, rng, {
    H, R1, topR: 0.03, topY: H - 0.4, lean: 0.008 + rng() * 0.01, curve: 0.12 + rng() * 0.12, taperPow: 0.8,
    layer: L.barkPine, radial: 10, segs: 15, flare: 0.5,
    tint: (y) => {
      const t = smoothstep(cb * 0.55, cb * 1.05, y);
      return [1 + 0.32 * t, 1 + 0.02 * t, 1 - 0.22 * t];
    },
    ao: (y) => (0.5 + 0.5 * smoothstep(0, 2.5, y)) * (1 - 0.3 * smoothstep(cb, H, y)),
  });
  const Lmax = [3.4, 3.9, 2.9][v];
  const shape = (t) => {
    if (v === 0) return Math.pow(Math.max(0.05, Math.sin(Math.PI * (0.16 + 0.8 * t))), 0.75);
    if (v === 1) return t < 0.72 ? 0.7 + 0.3 * Math.sin((Math.PI * t) / 0.72 * 0.5 + 0.4) : Math.max(0.15, 1 - ((t - 0.72) / 0.28) * 0.85);
    return 0.12 + 0.88 * Math.pow(1 - t, 0.85);
  };
  const cc = trunk.centerAt((cb + H) / 2);
  const cr = crown([cc[0], (cb + H) / 2 + 0.6, cc[2]], [Lmax * 1.05, (H - cb) / 2 + 1.3, Lmax * 1.05], { aoMin: 0.35, clumpW: 0.6 });
  // dead stubs on the bare lower trunk
  const stubs = 8 + Math.floor(rng() * 6);
  for (let k = 0; k < stubs; k++) addStub(b, rng, trunk, 2.5 + rng() * (cb - 3), 0.25 + rng() * 0.7, 0.025 + rng() * 0.015, L.barkDead);
  let y = cb;
  let az = rng() * TAU;
  while (y < H - 0.7) {
    const t = (y - cb) / (H - cb);
    const nb = 3 + Math.floor(rng() * 2.2);
    for (let k = 0; k < nb; k++) {
      az += 2.39996 + (rng() - 0.5) * 0.7;
      const len = Lmax * shape(t) * (0.7 + rng() * 0.45);
      if (len < 0.5) continue;
      const el = lerp(-0.08, 0.55, t) + (rng() - 0.5) * 0.35;
      const start = trunk.centerAt(y);
      const pts = branchPath(rng, start, dirAE(az, el), len, 4, { droop: 0.22 * (1 - t), upturn: 0.45, wobble: 0.18 });
      const r0 = Math.min(0.1, 0.022 + len * 0.016);
      addTube(b, pts, taper(pts.length, r0, 0.012, 0.9), { radial: 4, layer: L.barkPine, uRep: 1, vScale: 0.35, ao: () => 0.6, flex: (s) => 0.35 * s, tint: () => [1.2, 1.0, 0.85] });
      const tip = pts[pts.length - 1];
      const clump = madd(tip, [0, 1, 0], -0.25);
      // side shoots
      const subs = len > 1.6 ? 2 + Math.floor(rng() * 2) : 1;
      const shoots = [pts];
      for (let s = 0; s < subs; s++) {
        const at = pathAt(pts, 0.4 + rng() * 0.45);
        const sd = norm(add(rotAxis(at.d, [0, 1, 0], (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.6)), [0, 0.25, 0]));
        const sl = len * (0.3 + rng() * 0.2);
        const sp = branchPath(rng, at.p, sd, sl, 2, { upturn: 0.6, wobble: 0.2 });
        addTube(b, sp, taper(sp.length, 0.022, 0.008), { radial: 3, layer: L.barkPine, uRep: 1, vScale: 0.25, ao: () => 0.65, flex: (q) => 0.5 + 0.3 * q, tint: () => [1.2, 1.0, 0.85] });
        shoots.push(sp);
      }
      // dense needle clumps: big one at the branch tip, smaller ones on the side shoots
      const tipR = 0.45 + len * 0.16;
      addClump(b, rng, cr, madd(tip, [0, 1, 0], 0.15), tipR, Math.max(3, Math.round((5 + len * 2.0) * dens)), 1.4 + len * 0.08, L.pine, 0.85, { radial: true });
      for (let q = 1; q < shoots.length; q++) {
        const sp = shoots[q];
        addClump(b, rng, cr, madd(sp[sp.length - 1], [0, 1, 0], 0.1), 0.4 + len * 0.06, Math.max(2, Math.round((4 + Math.floor(rng() * 2)) * dens)), 1.15, L.pine, 0.95, { radial: true });
      }
      if (len > 2.2) addClump(b, rng, cr, madd(pathAt(pts, 0.6).p, [0, 1, 0], 0.2), 0.45, 4, 1.1, L.pine, 0.6, { radial: true });
    }
    y += 0.45 + rng() * 0.4;
  }
  // leader top
  const top = trunk.centerAt(H - 0.7);
  addClump(b, rng, cr, top, 0.8, 9, 1.4, L.pine, 0.8, { radial: true });
  return b;
}

function genAraucaria(rng, v) {
  const b = new MeshBuilder();
  const H = TREE_SPECIES.araucaria.height * [1.0, 0.94, 1.05][v];
  const R1 = TREE_SPECIES.araucaria.trunkRadius;
  const cb = H * [0.72, 0.56, 0.66][v];
  const tiers = [5, 7, 6][v];
  const trunk = makeTrunk(b, rng, {
    H, R1, topR: 0.07, topY: H - 0.6, lean: 0.004 + rng() * 0.006, curve: 0.05, taperPow: 0.6,
    layer: L.barkAraucaria, radial: 10, segs: 15, flare: 0.4, buttress: 0.08,
    ao: (y) => (0.5 + 0.5 * smoothstep(0, 2.5, y)) * (1 - 0.35 * smoothstep(cb - 1, H, y)),
  });
  // remnant stubs
  for (let k = 0; k < 6; k++) addStub(b, rng, trunk, cb * (0.5 + rng() * 0.45), 0.2 + rng() * 0.4, 0.035, L.barkAraucaria);
  const Lmax = [6.2, 5.0, 5.6][v];
  const C = trunk.centerAt((cb + H) / 2);
  const cr = crown([C[0], (cb + H) / 2 + 0.8, C[2]], [Lmax * 1.05, (H - cb) / 2 + 1.5, Lmax * 1.05], { aoMin: 0.42, clumpW: 0.55, lowDark: 0.35 });
  let az0 = rng() * TAU;
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1);
    const y = cb + (H - 1.2 - cb) * Math.pow(f, 0.85);
    const m = 5 + Math.floor(rng() * 2);
    az0 += Math.PI / m + (rng() - 0.5) * 0.3;
    const lenT = v === 0 ? Lmax * (1 - 0.45 * Math.pow(f, 2.2)) : Lmax * (1 - 0.72 * Math.pow(f, 1.25));
    for (let j = 0; j < m; j++) {
      if (v === 2 && rng() < 0.18) continue;
      const az = az0 + (j * TAU) / m + (rng() - 0.5) * 0.35;
      const len = lenT * (0.82 + rng() * 0.3);
      const start = trunk.centerAt(y);
      const pts = branchPath(rng, start, dirAE(az, 0.05 + (rng() - 0.5) * 0.1 - 0.1 * (1 - f)), len, 5, { droop: 0.35, upturn: v === 0 ? 0.75 : 0.55, wobble: 0.08 });
      addTube(b, pts, taper(pts.length, 0.06 + len * 0.012, 0.02, 0.8), { radial: 5, layer: L.barkAraucaria, uRep: 1, vScale: 0.4, ao: () => 0.55, flex: (s) => 0.3 * s });
      const tip = pts[pts.length - 1];
      // branchlets: horizontal fans on both sides of the outer branch, rope-like foliage cards
      const nodes = Math.max(3, Math.round(len * 1.7));
      for (let q = 0; q < nodes; q++) {
        const s = 0.32 + 0.68 * ((q + 0.5) / nodes);
        const at = pathAt(pts, s);
        const side = norm(cross(at.d, [0, 1, 0]));
        const clump = madd(at.p, [0, 1, 0], -0.1);
        for (const sgn of [-1, 1]) {
          const ax = norm(add(mul(side, sgn * 0.75), add(mul(at.d, 0.55), [0, 0.35 + rng() * 0.3, 0])));
          const size = 1.3 + rng() * 0.4;
          // flat-ish plate card (normal mostly up) + vertical card for side views
          const flatSide = norm(cross([0, 1, 0], ax));
          addCard(b, cr, madd(at.p, ax, -0.1), ax, flatSide, size, size, L.araucaria, 0.4 + 0.5 * s, rng(), clump);
          const upAx = norm(add(ax, [0, 0.9, 0]));
          addCard(b, cr, madd(at.p, upAx, -0.1), upAx, norm(cross(upAx, flatSide)), size * 0.9, size * 0.95, L.araucaria, 0.4 + 0.5 * s, rng(), clump);
        }
      }
      // upturned candelabra clump at the tip
      addClump(b, rng, cr, madd(tip, [0, 1, 0], 0.25), 0.7, 7, 1.6, L.araucaria, 1, { lift: 1.6 });
    }
  }
  const top = trunk.centerAt(H - 0.6);
  for (let k = 0; k < 4; k++) addTuft(b, rng, cr, madd(top, [0, 1, 0], -0.2), norm([(rng() - 0.5) * 1.2, 1, (rng() - 0.5) * 1.2]), 1.3, 1.3, L.araucaria, 0.8, top);
  return b;
}

function genSpruce(rng, v) {
  const b = new MeshBuilder();
  const H = TREE_SPECIES.spruce.height * [1.0, 0.9, 1.1][v];
  const R1 = TREE_SPECIES.spruce.trunkRadius;
  const cb = H * [0.07, 0.14, 0.24][v];
  const trunk = makeTrunk(b, rng, {
    H, R1, topR: 0.02, topY: H, lean: 0.005, curve: 0.04, taperPow: 1.0,
    layer: L.barkSpruce, radial: 8, segs: 12, flare: 0.45, buttress: 0.14,
    ao: (y) => (0.35 + 0.45 * smoothstep(0, 2.5, y)) * (1 - 0.3 * smoothstep(cb, H * 0.6, y)),
  });
  const Lb = [3.1, 2.7, 3.3][v];
  const cr = crown([0, cb + (H - cb) * 0.36, 0], [Lb * 1.0, (H - cb) * 0.62, Lb * 1.0], { aoMin: 0.25, clumpW: 0.35, lowDark: 0.3 });
  let y = cb;
  let az = rng() * TAU;
  while (y < H - 0.35) {
    const t = (y - cb) / (H - cb);
    const nb = t > 0.85 ? 3 : 4 + (rng() < 0.4 ? 1 : 0);
    for (let k = 0; k < nb; k++) {
      az += TAU / nb + (rng() - 0.5) * 0.9;
      const len = (Lb * Math.pow(1 - t, 0.95) + 0.3) * (0.82 + rng() * 0.3);
      const el = lerp(-0.42, 0.35, Math.pow(t, 0.8)) + (rng() - 0.5) * 0.15;
      const start = trunk.centerAt(y);
      const segs = len > 1.5 ? 3 : 2;
      const pts = branchPath(rng, start, dirAE(az, el), len, segs, { droop: 0.25 * (1 - t), upturn: 0.55, wobble: 0.1 });
      if (len > 0.9) addTube(b, pts, taper(pts.length, Math.min(0.07, 0.015 + len * 0.016), 0.008), { radial: 3, layer: L.barkSpruce, uRep: 1, vScale: 0.3, ao: () => 0.45, flex: (s) => 0.4 * s });
      // sprays: crossed cards along the branch, plus hanging curtains on lower branches
      const n = Math.max(1, Math.round(len * 1.35));
      for (let q = 0; q < n; q++) {
        const s = 0.18 + 0.82 * ((q + 0.4 + rng() * 0.3) / n);
        const at = pathAt(pts, s);
        const w = (0.95 + rng() * 0.35) * (0.7 + 0.3 * (1 - t));
        const h = w * (1.25 + rng() * 0.2);
        const ax = norm(add(at.d, [(rng() - 0.5) * 0.3, 0.1, (rng() - 0.5) * 0.3]));
        const side = norm(cross(ax, [0, 1, 0]));
        const flatSide = rotAxis(side, ax, (rng() - 0.5) * 0.5);
        const phase = rng();
        addCard(b, cr, madd(at.p, ax, -0.2), ax, flatSide, w * 1.15, h, L.spruce, 0.3 + 0.6 * s, phase, null);
        addCard(b, cr, madd(at.p, ax, -0.2), ax, norm(cross(ax, flatSide)), w * 0.85, h, L.spruce, 0.3 + 0.6 * s, phase, null);
        if (t < 0.6 && rng() < 0.55) {
          const down = norm([at.d[0] * 0.3, -1, at.d[2] * 0.3]);
          addCard(b, cr, madd(at.p, down, -0.05), down, norm(cross(down, side)), w * 0.8, h * 0.75, L.spruce, 0.5 + 0.5 * s, rng(), null);
        }
      }
    }
    y += lerp(0.5, 0.36, t) + rng() * 0.12;
  }
  const top = trunk.centerAt(H - 0.25);
  addTuft(b, rng, cr, madd(top, [0, 1, 0], -0.7), [0, 1, 0], 0.55, 0.95, L.spruce, 0.9, null);
  return b;
}

function genBirch(rng, v) {
  const b = new MeshBuilder();
  const H = TREE_SPECIES.birch.height * [1.0, 0.9, 1.08][v];
  const R1 = TREE_SPECIES.birch.trunkRadius;
  const cb = H * [0.36, 0.3, 0.42][v];
  const trunk = makeTrunk(b, rng, {
    H, R1, topR: 0.025, topY: H * 0.9, lean: v === 2 ? 0.06 : 0.012 + rng() * 0.01, curve: 0.18 + rng() * 0.12, taperPow: 1.1,
    layer: L.barkBirch, radial: 9, segs: 13, flare: 0.35, buttress: 0.1,
    tint: (y) => {
      const t = 1 - smoothstep(0.2, 1.6, y);
      return [1 - 0.55 * t, 1 - 0.57 * t, 1 - 0.58 * t];
    },
    ao: (y) => (0.6 + 0.4 * smoothstep(0, 2, y)) * (1 - 0.15 * smoothstep(cb, H, y)),
  });
  const C = trunk.centerAt(lerp(cb, H, 0.55));
  const cr = crown([C[0], lerp(cb, H, 0.58), C[2]], [3.6, (H - cb) / 2 + 1.0, 3.6], { aoMin: 0.45, clumpW: 0.55 });
  const nMain = [15, 13, 17][v];
  let az = rng() * TAU;
  for (let k = 0; k < nMain; k++) {
    const t = (k + rng() * 0.6) / nMain;
    const y = lerp(cb, H * 0.86, t);
    az += 2.39996 + (rng() - 0.5) * 0.5;
    const len = (1.8 + 2.4 * Math.sin(Math.PI * (0.25 + 0.7 * (1 - t)))) * (0.8 + rng() * 0.35);
    const el = lerp(0.65, 1.05, t) + (rng() - 0.5) * 0.2;
    const pts = branchPath(rng, trunk.centerAt(y), dirAE(az, el), len, 4, { droop: 0.7, upturn: -0.1, wobble: 0.15 });
    addTube(b, pts, taper(pts.length, Math.min(0.06, 0.018 + len * 0.012), 0.008), { radial: 4, layer: L.barkBirch, uRep: 1, vScale: 0.3, ao: () => 0.7, flex: (s) => 0.4 * s, tint: () => [0.9, 0.88, 0.86] });
    // drooping twigs with hanging leaf cards
    const tw = 3 + Math.floor(rng() * 3);
    for (let q = 0; q < tw; q++) {
      const at = pathAt(pts, 0.35 + 0.65 * ((q + rng() * 0.5) / tw));
      const d = norm(add(rotAxis(at.d, [0, 1, 0], (rng() - 0.5) * 2.2), [0, -0.9 - rng() * 0.5, 0]));
      const tl = 0.9 + rng() * 0.9;
      const tp = branchPath(rng, at.p, d, tl, 2, { droop: 0.3, wobble: 0.2 });
      addTube(b, tp, taper(tp.length, 0.012, 0.005), { radial: 3, layer: L.barkBirch, uRep: 1, vScale: 0.2, ao: () => 0.75, flex: (s) => 0.6 + 0.4 * s, tint: () => [0.55, 0.5, 0.48] });
      addClump(b, rng, cr, pathAt(tp, 0.7).p, 0.55, 5, 1.05, L.birch, 0.9, { lift: -0.6 });
    }
    // leaves around the outer main branch
    addClump(b, rng, cr, pathAt(pts, 0.85).p, 0.7, 6, 1.1, L.birch, 0.8, { lift: -0.2 });
  }
  // leader top
  const top = trunk.centerAt(H * 0.88);
  addClump(b, rng, cr, madd(top, [0, 1, 0], -0.6), 0.9, 8, 1.1, L.birch, 0.8, { lift: 0.4 });
  return b;
}

function genOak(rng, v) {
  const b = new MeshBuilder();
  const H = TREE_SPECIES.oak.height * [1.0, 0.9, 1.06][v];
  const R1 = TREE_SPECIES.oak.trunkRadius;
  const fork = [3.0, 2.4, 3.6][v];
  const trunk = makeTrunk(b, rng, {
    H, R1, topR: 0.16, topY: fork + 1.2, lean: 0.02 + rng() * 0.02, curve: 0.15, taperPow: 1.0,
    layer: L.barkOak, radial: 12, segs: 6, flare: 0.55, buttress: 0.2,
    ao: (y) => 0.5 + 0.5 * smoothstep(0, 2.2, y),
  });
  const W = [6.8, 7.4, 5.8][v];
  const cr = crown([0, H * 0.6, 0], [W, H * 0.4, W], { aoMin: 0.3, clumpW: 0.55, lowDark: 0.3 });
  const limbs = [4, 5, 3][v];
  let az = rng() * TAU;
  const tipsL2 = [];
  for (let k = 0; k < limbs; k++) {
    az += TAU / limbs + (rng() - 0.5) * 0.6;
    const y0 = fork - 0.3 + rng() * 1.2;
    const el = (v === 2 ? 0.95 : 0.7) + (rng() - 0.5) * 0.35;
    const len = (H - y0) * (0.65 + rng() * 0.2) / Math.sin(el) * 0.75;
    const start = trunk.centerAt(y0);
    const pts = branchPath(rng, start, dirAE(az, el), Math.min(len, W * 1.05), 5, { droop: 0.55, upturn: 0.2, wobble: 0.22 });
    addTube(b, pts, taper(pts.length, R1 * (0.48 + rng() * 0.12), 0.05, 0.9), { radial: 8, layer: L.barkOak, uRep: 2, vScale: 0.7, ao: (t) => 0.55 + 0.3 * t, flex: (s) => 0.12 * s });
    const n2 = 3 + Math.floor(rng() * 2);
    for (let q = 0; q < n2; q++) {
      const at = pathAt(pts, 0.35 + 0.65 * ((q + rng() * 0.6) / n2));
      const d = norm(add(rotAxis(at.d, [0, 1, 0], (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.6)), [0, 0.25 + rng() * 0.3, 0]));
      const l2 = 1.8 + rng() * 1.8;
      const p2 = branchPath(rng, at.p, d, l2, 3, { droop: 0.4, upturn: 0.4, wobble: 0.3 });
      addTube(b, p2, taper(p2.length, 0.06, 0.015), { radial: 5, layer: L.barkOak, uRep: 1, vScale: 0.4, ao: () => 0.65, flex: (s) => 0.25 + 0.25 * s });
      tipsL2.push(p2);
      const n3 = 2 + Math.floor(rng() * 2);
      for (let r = 0; r < n3; r++) {
        const a3 = pathAt(p2, 0.4 + 0.6 * ((r + rng() * 0.5) / n3));
        const d3 = norm(add(rotAxis(a3.d, [0, 1, 0], (rng() - 0.5) * 2.4), [0, 0.3, 0]));
        const p3 = branchPath(rng, a3.p, d3, 0.8 + rng() * 0.8, 2, { wobble: 0.3, upturn: 0.3 });
        addTube(b, p3, taper(p3.length, 0.02, 0.007), { radial: 3, layer: L.barkOak, uRep: 1, vScale: 0.25, ao: () => 0.7, flex: (s) => 0.5 + 0.3 * s });
        tipsL2.push(p3);
      }
    }
    tipsL2.push(pts);
  }
  // leaf clumps at the ends of all small branches -> clumpy cloud crown
  for (const p of tipsL2) {
    const lenp = p.reduce((acc, q, i) => (i ? acc + vlen(sub(q, p[i - 1])) : 0), 0);
    const end = p[p.length - 1];
    const r = 0.7 + Math.min(0.6, lenp * 0.12);
    addClump(b, rng, cr, madd(end, [0, 1, 0], 0.2), r, Math.round(5 + lenp * 1.2), 1.45, L.oak, 0.9, { lift: 0.5 });
    if (lenp > 2) addClump(b, rng, cr, pathAt(p, 0.55).p, 0.6, 4, 1.3, L.oak, 0.6, { lift: 0.5 });
  }
  return b;
}

function genDead(rng, v) {
  const b = new MeshBuilder();
  const H = TREE_SPECIES.dead.height * [1.0, 0.9, 1.1][v];
  const R1 = TREE_SPECIES.dead.trunkRadius;
  const cr = crown([0, H * 0.6, 0], [3, H * 0.4, 3], { aoMin: 0.6 });
  const twigTint = [1, 1, 1];
  if (v === 0) {
    // broken snag
    const topY = H * (0.62 + rng() * 0.1);
    const trunk = makeTrunk(b, rng, { H, R1, topR: 0.11, topY, lean: 0.02, curve: 0.1, layer: L.barkDead, radial: 9, segs: 9, flare: 0.5, buttress: 0.18, cap: true, capHeight: 1.6 });
    for (let k = 0; k < 6; k++) addStub(b, rng, trunk, 2.2 + rng() * (topY - 3), 0.3 + rng() * 1.1, 0.04 + rng() * 0.03, L.barkDead);
    for (let k = 0; k < 2; k++) {
      const y = topY * (0.55 + rng() * 0.35);
      const pts = branchPath(rng, trunk.centerAt(y), dirAE(rng() * TAU, 0.3 + rng() * 0.4), 2 + rng() * 1.5, 3, { wobble: 0.35, droop: 0.2 });
      addTube(b, pts, taper(pts.length, 0.06, 0.015), { radial: 4, layer: L.barkDead, uRep: 1, vScale: 0.4, ao: () => 0.8, flex: (s) => 0.2 * s });
      addTuft(b, rng, cr, pts[pts.length - 1], norm(add(pathAt(pts, 1).d, [0, 0.4, 0])), 1.1, 1.1, L.twigs, 0.4, null, twigTint, 2);
    }
  } else if (v === 1) {
    // dead conifer with whorls of thin brittle branches
    const trunk = makeTrunk(b, rng, { H, R1, topR: 0.025, topY: H, lean: 0.015, curve: 0.08, layer: L.barkDead, radial: 9, segs: 12, flare: 0.45 });
    let y = H * 0.3;
    let az = rng() * TAU;
    while (y < H - 0.5) {
      const t = (y - H * 0.3) / (H * 0.7);
      for (let k = 0; k < 3; k++) {
        az += 2.39996;
        if (rng() < 0.35) continue;
        const len = (2.4 * (1 - t) + 0.4) * (0.6 + rng() * 0.5);
        const pts = branchPath(rng, trunk.centerAt(y), dirAE(az, -0.25 + rng() * 0.3), len, 3, { droop: 0.3, wobble: 0.25 });
        addTube(b, pts, taper(pts.length, 0.03, 0.008), { radial: 3, layer: L.barkDead, uRep: 1, vScale: 0.3, ao: () => 0.8, flex: (s) => 0.3 * s });
        if (len > 0.8) addCard(b, cr, madd(pathAt(pts, 0.5).p, pathAt(pts, 0.5).d, -0.2), pathAt(pts, 0.5).d, norm(cross(pathAt(pts, 0.5).d, [0, 1, 0])), len * 0.7, len * 0.8, L.twigs, 0.4, rng(), null, twigTint, 2);
      }
      y += 0.55 + rng() * 0.4;
    }
  } else {
    // dead broadleaf: forked crooked limbs, twig cards
    const trunk = makeTrunk(b, rng, { H, R1, topR: 0.09, topY: H * 0.45, lean: 0.05, curve: 0.2, layer: L.barkDead, radial: 9, segs: 7, flare: 0.5, buttress: 0.2 });
    let az = rng() * TAU;
    for (let k = 0; k < 4; k++) {
      az += TAU / 4 + (rng() - 0.5) * 0.8;
      const pts = branchPath(rng, trunk.centerAt(H * (0.38 + rng() * 0.08)), dirAE(az, 0.7 + rng() * 0.4), 3.5 + rng() * 2.5, 5, { wobble: 0.35, droop: 0.3 });
      addTube(b, pts, taper(pts.length, 0.1, 0.02), { radial: 5, layer: L.barkDead, uRep: 1, vScale: 0.5, ao: () => 0.75, flex: (s) => 0.15 * s });
      for (let q = 0; q < 3; q++) {
        const at = pathAt(pts, 0.4 + 0.25 * q);
        const p2 = branchPath(rng, at.p, norm(add(rotAxis(at.d, [0, 1, 0], (rng() - 0.5) * 2.5), [0, 0.3, 0])), 1.2 + rng() * 1.2, 2, { wobble: 0.4 });
        addTube(b, p2, taper(p2.length, 0.03, 0.008), { radial: 3, layer: L.barkDead, uRep: 1, vScale: 0.25, ao: () => 0.8, flex: (s) => 0.4 * s });
        addTuft(b, rng, cr, p2[p2.length - 1], norm(add(pathAt(p2, 1).d, [0, 0.3, 0])), 1.0, 1.0, L.twigs, 0.5, null, twigTint, 2);
      }
      addTuft(b, rng, cr, pts[pts.length - 1], norm(add(pathAt(pts, 1).d, [0, 0.4, 0])), 1.2, 1.2, L.twigs, 0.5, null, twigTint, 2);
    }
  }
  return b;
}

// ---------------------------------------------------------------------------------------------
// Bush generators (scale 1)
// ---------------------------------------------------------------------------------------------

function genShrub(rng, v) {
  const b = new MeshBuilder();
  const R = [[0.75, 0.62, 0.75], [0.6, 0.72, 0.6]][v];
  const C = [0, R[1] * 0.92, 0];
  const cr = crown(C, R, { aoMin: 0.38, clumpW: 0.2, lowDark: 0.35 });
  const stems = 5;
  for (let k = 0; k < stems; k++) {
    const d = dirAE(rng() * TAU, 1.0 + rng() * 0.35);
    const pts = branchPath(rng, [0, -0.1, 0], d, R[1] * 1.5, 3, { wobble: 0.3 });
    addTube(b, pts, taper(pts.length, 0.02, 0.006), { radial: 3, layer: L.barkOak, uRep: 1, vScale: 0.2, ao: () => 0.5, flex: (s) => s * 0.4 });
  }
  const n = 46;
  for (let k = 0; k < n; k++) {
    const az = rng() * TAU;
    const el = Math.asin(Math.min(1, rng() * 1.45 - 0.45));
    const r = 0.55 + 0.4 * Math.sqrt(rng());
    const p = [C[0] + Math.sin(az) * Math.cos(el) * R[0] * r, C[1] + Math.sin(el) * R[1] * r, C[2] + Math.cos(az) * Math.cos(el) * R[2] * r];
    const out = norm(sub(p, [0, 0, 0]));
    const ax = norm(add(out, [0, 0.8, 0]));
    const size = 0.5 + rng() * 0.25;
    addTuft(b, rng, cr, madd(p, ax, -size * 0.45), ax, size, size, L.shrub, 0.5 + 0.5 * r, null);
  }
  return b;
}

function genFern(rng, v) {
  const b = new MeshBuilder();
  const cr = crown([0, 0.15, 0], [0.9, 0.5, 0.9], { aoMin: 0.45, clumpW: 0, faceW: 0.6, lowDark: 0.4 });
  const fronds = [11, 14][v];
  for (let k = 0; k < fronds; k++) {
    const az = (k / fronds) * TAU + (rng() - 0.5) * 0.5;
    const len = (0.7 + rng() * 0.45) * (v ? 0.85 : 1);
    const el = 0.75 + rng() * 0.45;
    const pts = [];
    const sides = [];
    const widths = [];
    const segs = 6;
    let d = dirAE(az, el);
    let p = [Math.sin(az) * 0.04, 0.0, Math.cos(az) * 0.04];
    const side = norm(cross([0, 1, 0], [Math.sin(az), 0, Math.cos(az)]));
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      pts.push(p);
      sides.push(rotAxis(side, d, (rng() - 0.5) * 0.3));
      widths.push(len * 0.62 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) + 0.03);
      d = norm(add(d, [0, -0.32 - 0.1 * t, 0]));
      p = madd(p, d, len / segs);
    }
    addStrip(b, cr, pts, sides, widths, L.fern, (t) => t * 0.9, rng());
  }
  return b;
}

function genJuniper(rng, v) {
  const b = new MeshBuilder();
  const R = [[1.0, 0.55, 1.0], [0.7, 0.9, 0.7]][v];
  const C = [0, R[1] * 0.6, 0];
  const cr = crown(C, R, { aoMin: 0.3, clumpW: 0.2, lowDark: 0.4 });
  for (let k = 0; k < 6; k++) {
    const pts = branchPath(rng, [0, -0.05, 0], dirAE(rng() * TAU, 0.4 + rng() * 0.6), Math.max(R[0], R[1]) * 1.1, 3, { wobble: 0.35 });
    addTube(b, pts, taper(pts.length, 0.025, 0.008), { radial: 3, layer: L.barkSpruce, uRep: 1, vScale: 0.2, ao: () => 0.45, flex: (s) => s * 0.3 });
  }
  const n = 54;
  for (let k = 0; k < n; k++) {
    const az = rng() * TAU;
    const el = Math.asin(Math.min(1, rng() * 1.4 - 0.4));
    const r = 0.5 + 0.45 * Math.sqrt(rng());
    const p = [Math.sin(az) * Math.cos(el) * R[0] * r, C[1] + Math.sin(el) * R[1] * r, Math.cos(az) * Math.cos(el) * R[2] * r];
    const ax = norm(add(norm([p[0], 0.2, p[2]]), [0, 0.7, 0]));
    const size = 0.5 + rng() * 0.25;
    addTuft(b, rng, cr, madd(p, ax, -size * 0.45), ax, size, size * 1.1, L.juniper, 0.4 + 0.5 * r, null);
  }
  return b;
}

const TREE_GEN = { pine: genPine, araucaria: genAraucaria, spruce: genSpruce, birch: genBirch, oak: genOak, dead: genDead };
const BUSH_GEN = { shrub: genShrub, fern: genFern, juniper: genJuniper };

// ---------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------

const GLSL_COMMON = /* glsl */`
uniform float uVegTime;
uniform vec4 uVegWind;   // xy = horizontal direction, z = strength 0..1
uniform vec3 uVegView;   // main camera position (LOD fades also in the shadow pass)
uniform vec4 uVegFade;   // near-tree fade start/end, impostor far fade start/end (bushes: scale fade start/end)

// World-space wind displacement for a vertex at local height h (metres) of an instance at ip.
vec3 vegWindOffset( vec3 ip, float h, float flex, float phase ) {
  float str = uVegWind.z;
  vec2 dir = uVegWind.xy;
  float t = uVegTime;
  float sp = dot( ip.xz, dir ) * 0.035 - t * 0.9;
  float gust = 0.55 + 0.45 * sin( sp ) * sin( sp * 0.37 + 1.7 );
  float hh = max( h, 0.0 );
  float sway = str * ( 0.55 * gust + 0.3 * sin( t * 1.25 + ip.x * 0.13 + ip.z * 0.11 ) * ( 0.4 + 0.6 * gust ) ) * hh * hh * 0.0022;
  vec3 off = vec3( dir.x, 0.0, dir.y ) * sway;
  off.y -= sway * sway * 0.02;
  float f = flex * str * ( 0.3 + 0.7 * gust );
  float a1 = sin( t * 2.1 + phase * 6.2832 + ip.x * 0.31 + hh * 0.2 );
  float a2 = sin( t * 5.3 + phase * 12.566 + ip.z * 0.27 );
  off += vec3( dir.x, 0.0, dir.y ) * ( f * 0.16 * ( 0.55 + 0.45 * a1 ) );
  off += vec3( -dir.y * a2, 0.6 * a1 * a2, dir.x * a2 ) * ( f * 0.06 );
  return off;
}

#ifdef USE_INSTANCING
vec3 vegToLocal( vec3 w ) {
  mat3 m = mat3( instanceMatrix );
  return ( transpose( m ) * w ) / dot( m[ 0 ], m[ 0 ] );
}
#endif
`;

const GLSL_FRAG_COMMON = /* glsl */`
float vegDither() {
  return fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
}
float vegMip( vec2 uv, float size ) {
  vec2 dx = dFdx( uv * size );
  vec2 dy = dFdy( uv * size );
  return max( 0.0, 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) ) );
}
`;

const GLSL_TRANSLUCENCY = /* glsl */`
float gVegTrans = 0.0;
uniform vec4 uVegTrans; // rgb = transmission tint, w = strength
void RE_Direct_Veg( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  if ( gVegTrans > 0.0 ) {
    float back = saturate( dot( -geometryViewDir, directLight.direction ) );
    float thru = saturate( 0.45 - dot( geometryNormal, directLight.direction ) * 0.55 );
    float scatter = pow( back, 5.0 ) * 1.4 + pow( back, 1.5 ) * 0.25 + thru * 0.25;
    reflectedLight.directDiffuse += directLight.color * material.diffuseContribution * uVegTrans.rgb * ( scatter * uVegTrans.w * gVegTrans );
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Veg
`;

// Leaves: weaker, non-white Fresnel (spherical normals make grazing angles common).
const GLSL_LEAF_SPEC = /* glsl */`
material.specularF90 = mix( 1.0, 0.25, gVegTrans );
material.specularColor *= mix( 1.0, 0.6, gVegTrans );
material.specularColorBlended = material.specularColor;
`;

const GLSL_TBN = /* glsl */`
mat3 vegTBN( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
  vec3 q0 = dFdx( eye_pos.xyz );
  vec3 q1 = dFdy( eye_pos.xyz );
  vec2 st0 = dFdx( uv.st );
  vec2 st1 = dFdy( uv.st );
  vec3 N = surf_norm;
  vec3 q1perp = cross( q1, N );
  vec3 q0perp = cross( N, q0 );
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max( dot( T, T ), dot( B, B ) );
  float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
  return mat3( T * scale, B * scale, N );
}
`;

function injectTreeVertex(src, depth) {
  return src
    .replace('#include <common>', `#include <common>
${GLSL_COMMON}
attribute vec4 aColor;
attribute vec4 aData;
attribute vec4 aTint;
varying vec2 vVegUv;
varying vec4 vVegData;
${depth ? '' : 'varying vec4 vVegCol;\nvarying vec4 vVegTint;'}
`)
    .replace('#include <begin_vertex>', `
vec3 transformed = vec3( position );
vec3 vegIP = instanceMatrix[ 3 ].xyz;
float vegD = distance( uVegView, vegIP );
#ifdef VEG_BUSH
  transformed *= 1.0 - smoothstep( uVegFade.x * ( 1.0 - 0.4 * aTint.w ), uVegFade.y, vegD );
  float vegFade = 1.0;
#else
  float vegFade = 1.0 - smoothstep( uVegFade.x, uVegFade.y, vegD );
#endif
transformed += vegToLocal( vegWindOffset( vegIP, transformed.y, aData.z / 255.0, aData.w / 255.0 ) );
vVegUv = uv;
vVegData = vec4( aData.x, aData.y, vegFade, 0.0 );
${depth ? '' : 'vVegCol = vec4( aColor.rgb * 2.0, aColor.a );\nvVegTint = aTint;'}
`);
}

function injectTreeFragment(src) {
  return src
    .replace('#include <common>', `#include <common>
${GLSL_FRAG_COMMON}
${GLSL_TBN}
uniform sampler2DArray tVegAlbedo;
uniform sampler2DArray tVegNormal;
varying vec2 vVegUv;
varying vec4 vVegData;
varying vec4 vVegCol;
varying vec4 vVegTint;
`)
    .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
${GLSL_TRANSLUCENCY}`)
    .replace('#include <map_fragment>', `
vec4 vegTex = texture( tVegAlbedo, vec3( vVegUv, vVegData.x ) );
float vegA = vegTex.a;
if ( vVegData.y > 0.5 ) vegA *= 1.0 + vegMip( vVegUv, VEG_TEX_SIZE ) * 0.3;
if ( vegA < 0.5 ) discard;
#ifndef VEG_BUSH
  if ( vegDither() >= vVegData.z ) discard;
#endif
float vegLeaf = ( vVegData.y > 0.5 && vVegData.y < 1.5 ) ? 1.0 : 0.0;
vec3 vegTint = mix( vec3( 0.86 + 0.28 * vVegTint.w ), vVegTint.rgb, vegLeaf );
diffuseColor.rgb *= vegTex.rgb * vVegCol.rgb * vegTint * mix( 1.0, vVegCol.a, 0.35 );
gVegTrans = vegLeaf;
`)
    .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = ( vVegData.y > 0.5 && vVegData.y < 1.5 ) ? 0.7 : 0.93;
`)
    .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
${GLSL_LEAF_SPEC}`)
    .replace('#include <normal_fragment_maps>', `
if ( vVegData.y < 0.5 ) {
  vec3 vegMapN = texture( tVegNormal, vec3( vVegUv, vVegData.x ) ).xyz * 2.0 - 1.0;
  normal = normalize( vegTBN( - vViewPosition, normal, vVegUv ) * vegMapN );
} else {
  normal = normalize( vNormal );
}
`)
    .replace('#include <aomap_fragment>', `
reflectedLight.indirectDiffuse *= vVegCol.a;
reflectedLight.indirectSpecular *= vVegCol.a;
`);
}

function injectTreeDepthFragment(src) {
  return src
    .replace('#include <common>', `#include <common>
${GLSL_FRAG_COMMON}
uniform sampler2DArray tVegAlbedo;
varying vec2 vVegUv;
varying vec4 vVegData;
`)
    .replace('#include <alphatest_fragment>', `
float vegA = texture( tVegAlbedo, vec3( vVegUv, vVegData.x ) ).a;
if ( vVegData.y > 0.5 ) vegA *= 1.0 + vegMip( vVegUv, VEG_TEX_SIZE ) * 0.3;
if ( vegA < 0.5 ) discard;
`);
}

function injectImpostorVertex(src) {
  return src
    .replace('#include <common>', `#include <common>
${GLSL_COMMON}
attribute vec4 aTint;
attribute float aImp;
uniform vec4 uImpData[ ${MAX_IMPOSTOR_VARIANTS} ];
varying vec2 vImpUv;
varying vec2 vImpLayers;
varying float vImpBlend;
varying vec2 vImpFade;
varying vec4 vImpTint;
varying vec3 vImpR;
varying vec3 vImpU;
varying vec3 vImpF;
`)
    .replace('#include <beginnormal_vertex>', `
vec3 impIP = instanceMatrix[ 3 ].xyz;
mat3 impM = mat3( instanceMatrix );
vec3 impCamL = transpose( impM ) * ( uVegView - impIP );
vec2 impDir = normalize( impCamL.xz + vec2( 1e-4, 0.0 ) );
vec3 objectNormal = vec3( impDir.x, 0.0, impDir.y );
`)
    .replace('#include <begin_vertex>', `
vec4 impInfo = uImpData[ int( aImp + 0.5 ) ];
vec3 impRight = vec3( impDir.y, 0.0, -impDir.x );
float impY = mix( impInfo.y, impInfo.z, position.y );
vec3 transformed = impRight * ( position.x * impInfo.x ) + vec3( 0.0, impY, 0.0 );
transformed += vegToLocal( vegWindOffset( impIP, impY, 0.0, 0.0 ) );
float impAng = atan( impDir.x, impDir.y );
float impF = fract( impAng / 6.2831853 ) * float( IMP_VIEWS );
float impV0 = floor( impF );
vImpBlend = impF - impV0;
vImpLayers = vec2( impInfo.w + impV0, impInfo.w + mod( impV0 + 1.0, float( IMP_VIEWS ) ) );
vImpUv = vec2( position.x * 0.5 + 0.5, position.y );
float impD = distance( uVegView, impIP );
vImpFade = vec2( 1.0 - smoothstep( uVegFade.x, uVegFade.y, impD ), 1.0 - smoothstep( uVegFade.z, uVegFade.w, impD ) );
if ( vImpFade.x > 0.999 || vImpFade.y < 0.001 ) transformed = vec3( 0.0 );
vImpTint = aTint;
vImpR = normalize( ( modelViewMatrix * vec4( impM * impRight, 0.0 ) ).xyz );
vImpU = normalize( ( modelViewMatrix * vec4( impM * vec3( 0.0, 1.0, 0.0 ), 0.0 ) ).xyz );
vImpF = normalize( ( modelViewMatrix * vec4( impM * objectNormal, 0.0 ) ).xyz );
`);
}

function injectImpostorFragment(src) {
  return src
    .replace('#include <common>', `#include <common>
${GLSL_FRAG_COMMON}
uniform sampler2DArray tImpAlbedo;
uniform sampler2DArray tImpNormal;
varying vec2 vImpUv;
varying vec2 vImpLayers;
varying float vImpBlend;
varying vec2 vImpFade;
varying vec4 vImpTint;
varying vec3 vImpR;
varying vec3 vImpU;
varying vec3 vImpF;
`)
    .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
${GLSL_TRANSLUCENCY}`)
    .replace('#include <map_fragment>', `
vec4 impA = mix( texture( tImpAlbedo, vec3( vImpUv, vImpLayers.x ) ), texture( tImpAlbedo, vec3( vImpUv, vImpLayers.y ) ), vImpBlend );
vec4 impN = mix( texture( tImpNormal, vec3( vImpUv, vImpLayers.x ) ), texture( tImpNormal, vec3( vImpUv, vImpLayers.y ) ), vImpBlend );
float impCov = impA.a * ( 1.0 + vegMip( vImpUv, IMP_TEX_SIZE ) * 0.3 );
float impTh = vegDither();
if ( impCov < 0.5 || impTh < vImpFade.x || impTh >= vImpFade.y ) discard;
float impInv = 1.0 / max( impA.a, 0.004 );
vec4 impNd = clamp( impN * impInv, 0.0, 1.0 );
float impLeaf = impNd.w;
vec3 impTint = mix( vec3( 0.86 + 0.28 * vImpTint.w ), vImpTint.rgb, impLeaf );
diffuseColor.rgb *= clamp( impA.rgb * impInv, 0.0, 1.0 ) * impTint * mix( 1.0, impNd.z, 0.35 );
gVegTrans = impLeaf;
`)
    .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = 0.93;
`)
    .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
${GLSL_LEAF_SPEC}`)
    .replace('#include <normal_fragment_maps>', `
roughnessFactor = mix( 0.93, 0.7, impLeaf );
vec2 impNxy = impNd.xy * 2.0 - 1.0;
float impNz = sqrt( saturate( 1.0 - dot( impNxy, impNxy ) ) );
normal = normalize( impNxy.x * vImpR + impNxy.y * vImpU + impNz * vImpF );
`)
    .replace('#include <aomap_fragment>', `
reflectedLight.indirectDiffuse *= impNd.z;
reflectedLight.indirectSpecular *= impNd.z;
`);
}

// Impostor bake shader (unlit): mode 0 = albedo (linear, alpha = coverage), mode 1 = normal/ao/leaf.
const BAKE_VERT = /* glsl */`
attribute vec4 aColor;
attribute vec4 aData;
varying vec2 vUv;
varying vec4 vCol;
varying vec2 vDat;
varying vec3 vN;
void main() {
  vUv = uv;
  vCol = vec4( aColor.rgb * 2.0, aColor.a );
  vDat = aData.xy;
  vN = normalize( normalMatrix * normal );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;
const BAKE_FRAG = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray tVegAlbedo;
uniform int uMode;
varying vec2 vUv;
varying vec4 vCol;
varying vec2 vDat;
varying vec3 vN;
${GLSL_FRAG_COMMON}
void main() {
  vec4 t = texture( tVegAlbedo, vec3( vUv, vDat.x ) );
  float a = t.a;
  if ( vDat.y > 0.5 ) a *= 1.0 + vegMip( vUv, VEG_TEX_SIZE ) * 0.3;
  if ( a < 0.5 ) discard;
  float leaf = ( vDat.y > 0.5 && vDat.y < 1.5 ) ? 1.0 : 0.0;
  if ( uMode == 0 ) {
    gl_FragColor = vec4( t.rgb * vCol.rgb, 1.0 );
  } else {
    vec3 n = normalize( vN );
    if ( vDat.y < 0.5 && ! gl_FrontFacing ) n = -n;
    gl_FragColor = vec4( n.xy * 0.5 + 0.5, vCol.a, leaf );
  }
}
`;

// ---------------------------------------------------------------------------------------------
// Spatial grid (CSR) for fast radius queries
// ---------------------------------------------------------------------------------------------

class SpatialGrid {
  constructor(pos, count, cell) {
    this.cell = cell;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = pos[i * 3];
      const z = pos[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (!count) { minX = minZ = 0; maxX = maxZ = 1; }
    this.minX = minX;
    this.minZ = minZ;
    this.nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
    this.nz = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
    const cells = this.nx * this.nz;
    const start = new Int32Array(cells + 1);
    const cellOf = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const cx = Math.floor((pos[i * 3] - minX) / cell);
      const cz = Math.floor((pos[i * 3 + 2] - minZ) / cell);
      const c = cz * this.nx + cx;
      cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const fill = start.slice(0, cells);
    const items = new Int32Array(count);
    for (let i = 0; i < count; i++) items[fill[cellOf[i]]++] = i;
    this.start = start;
    this.items = items;
    this.pos = pos;
  }

  /** Writes indices of items within radius r of (x, z) to out; returns count. */
  query(x, z, r, out) {
    const { cell, nx, nz, minX, minZ, start, items, pos } = this;
    const x0 = Math.max(0, Math.floor((x - r - minX) / cell));
    const x1 = Math.min(nx - 1, Math.floor((x + r - minX) / cell));
    const z0 = Math.max(0, Math.floor((z - r - minZ) / cell));
    const z1 = Math.min(nz - 1, Math.floor((z + r - minZ) / cell));
    const r2 = r * r;
    let n = 0;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cz * nx + cx;
        for (let k = start[c], e = start[c + 1]; k < e; k++) {
          const i = items[k];
          const dx = pos[i * 3] - x;
          const dz = pos[i * 3 + 2] - z;
          if (dx * dx + dz * dz <= r2) out[n++] = i;
        }
      }
    }
    return n;
  }
}

/** Sphere vs frustum (no allocation). */
function sphereInFrustum(frustum, x, y, z, r) {
  const planes = frustum.planes;
  for (let i = 0; i < 6; i++) {
    const p = planes[i];
    if (p.normal.x * x + p.normal.y * y + p.normal.z * z + p.constant < -r) return false;
  }
  return true;
}

function writeMatrix(out, o, x, y, z, rot, s) {
  const c = Math.cos(rot) * s;
  const sn = Math.sin(rot) * s;
  out[o] = c; out[o + 1] = 0; out[o + 2] = -sn; out[o + 3] = 0;
  out[o + 4] = 0; out[o + 5] = s; out[o + 6] = 0; out[o + 7] = 0;
  out[o + 8] = sn; out[o + 9] = 0; out[o + 10] = c; out[o + 11] = 0;
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z; out[o + 15] = 1;
}

/** Instance tint: foliage colour shift (rgb) + random (w). */
function writeTint(out, o, x, z, salt, hueRange = 1) {
  const r1 = hash2(x, z, salt);
  const r2 = hash2(x, z, salt + 1);
  const r3 = hash2(x, z, salt + 2);
  const h = (r1 - 0.5) * hueRange + 0.5;
  const br = 0.84 + 0.3 * r2;
  out[o] = lerp(1.07, 0.9, h) * br;
  out[o + 1] = lerp(1.04, 0.99, h) * br;
  out[o + 2] = lerp(0.8, 1.08, h) * br;
  out[o + 3] = r3;
}

// ---------------------------------------------------------------------------------------------
// VegetationSystem
// ---------------------------------------------------------------------------------------------

const _m4 = new THREE.Matrix4();
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();

/**
 * Instanced procedural vegetation: near LOD meshes per (species variant), impostor billboards for
 * far trees (one draw call), near-only bushes. Call update(camera, time) every frame.
 */
export class VegetationSystem {
  /**
   * @param {{ renderer: THREE.WebGLRenderer, scene: THREE.Scene, quality?: 'low'|'medium'|'high'|'ultra' }} opts
   */
  constructor({ renderer, scene, quality = 'high' }) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = VEGETATION_QUALITY[quality] ? quality : 'high';
    this.q = VEGETATION_QUALITY[this.quality];
    /** Per-frame CPU frustum culling of near instances (disable if you render extra views). */
    this.frustumCulling = true;
    this.group = new THREE.Group();
    this.group.name = 'Vegetation';
    scene.add(this.group);
    this.uniforms = {
      uVegTime: { value: 0 },
      uVegWind: { value: new THREE.Vector4(0.8, 0.6, 0.35, 0) },
      uVegView: { value: new THREE.Vector3() },
      uVegTrans: { value: new THREE.Vector4(1.0, 1.12, 0.55, 1.0) },
    };
    this.treeFade = { value: new THREE.Vector4() };
    this.bushFade = { value: new THREE.Vector4() };
    this._applyFadeUniforms();
    this._geoCache = new Map();
    this._textures = null;
    this._materials = null;
    this._impostor = null;
    this._near = [];
    this._bushMeshes = [];
    this._lastRebucket = -1e9;
    this._lastPos = new THREE.Vector3(1e9, 1e9, 1e9);
    this._frustum = new THREE.Frustum();
    this._shadowFrustum = new THREE.Frustum();
    this._camPos = new THREE.Vector3();
    this._shadowLight = null;
    this._stats = { drawCalls: 0, nearTrees: 0, farTrees: 0, bushes: 0, triangles: 0, shadowDrawCalls: 0, buildMs: 0 };
    this.treeCount = 0;
    this.bushCount = 0;
  }

  _applyFadeUniforms() {
    const q = this.q;
    const band = Math.max(8, q.treeNear * 0.1);
    this.treeFade.value.set(q.treeNear - band, q.treeNear, q.treeFar * 0.85, q.treeFar);
    this.bushFade.value.set(q.bushFar * 0.6, q.bushFar, 0, 0);
  }

  _ensureResources() {
    if (this._textures) return;
    const caps = this.renderer.capabilities;
    const aniso = Math.min(this.q.aniso, caps.getMaxAnisotropy ? caps.getMaxAnisotropy() : 1);
    this._textures = createVegetationTextures(this.renderer, this.q.texSize, aniso);
    this._materials = this._createMaterials();
  }

  _createMaterials() {
    const tex = this._textures;
    const U = this.uniforms;
    const texDefine = `${tex.size}.0`;
    const mk = (bush) => {
      const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
      m.defines = { VEG_TEX_SIZE: texDefine };
      if (bush) m.defines.VEG_BUSH = '';
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, U, { uVegFade: bush ? this.bushFade : this.treeFade, tVegAlbedo: { value: tex.albedo }, tVegNormal: { value: tex.normal } });
        shader.vertexShader = injectTreeVertex(shader.vertexShader, false);
        shader.fragmentShader = injectTreeFragment(shader.fragmentShader);
      };
      m.customProgramCacheKey = () => (bush ? 'veg-bush-v1' : 'veg-tree-v1');
      const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      d.defines = { VEG_TEX_SIZE: texDefine };
      if (bush) d.defines.VEG_BUSH = '';
      d.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, U, { uVegFade: bush ? this.bushFade : this.treeFade, tVegAlbedo: { value: tex.albedo } });
        shader.vertexShader = injectTreeVertex(shader.vertexShader, true);
        shader.fragmentShader = injectTreeDepthFragment(shader.fragmentShader);
      };
      d.customProgramCacheKey = () => (bush ? 'veg-bush-depth-v1' : 'veg-tree-depth-v1');
      return { main: m, depth: d };
    };
    return { tree: mk(false), bush: mk(true) };
  }

  _variant(kind, name, v) {
    const key = `${kind}:${name}:${v}`;
    let e = this._geoCache.get(key);
    if (e) return e;
    const seed = (kind === 'tree' ? 1000 : 5000) + SPECIES_LIST.indexOf(name) * 97 + BUSH_SPECIES.indexOf(name) * 131 + v * 7919;
    // regenerate with lower foliage density until the variant fits the near-LOD triangle budget
    let builder = null;
    let dens = 1;
    for (let attempt = 0; attempt < 5; attempt++) {
      const rng = mulberry32(seed);
      builder = kind === 'tree' ? TREE_GEN[name](rng, v, dens) : BUSH_GEN[name](rng, v, dens);
      if (builder.triangles <= NEAR_TRIANGLE_BUDGET) break;
      dens *= (NEAR_TRIANGLE_BUDGET / builder.triangles) * 0.95;
    }
    const geometry = builder.geometry();
    const pos = geometry.attributes.position.array;
    let rMax = 0;
    let yMax = 0;
    for (let i = 0; i < pos.length; i += 3) {
      rMax = Math.max(rMax, Math.hypot(pos[i], pos[i + 2]));
      yMax = Math.max(yMax, pos[i + 1]);
    }
    e = { key, geometry, triangles: builder.triangles, rMax, yMax, yMin: -0.4, sphereY: yMax * 0.5, sphereR: Math.hypot(rMax, yMax * 0.5) };
    this._geoCache.set(key, e);
    return e;
  }

  /**
   * Build all instances. trees/bushes: Array<{ x, y, z, rot, scale, species }>.
   * @returns {Promise<void>}
   */
  async build({ trees = [], bushes = [] } = {}) {
    const t0 = performance.now();
    this._clearInstances();
    this._ensureResources();
    const tTex = performance.now();
    // --- trees ---
    const nT = trees.length;
    const tPos = new Float32Array(nT * 3);
    const tMat = new Float32Array(nT * 16);
    const tTint = new Float32Array(nT * 4);
    const tVar = new Uint8Array(nT);
    const tScale = new Float32Array(nT);
    const varCount = new Int32Array(MAX_IMPOSTOR_VARIANTS);
    let warned = false;
    for (let i = 0; i < nT; i++) {
      const t = trees[i];
      let si = SPECIES_LIST.indexOf(t.species);
      if (si < 0) {
        if (!warned) console.warn('[vegetation] unknown tree species', t.species);
        warned = true;
        si = 0;
      }
      const vi = si * TREE_VARIANTS + (t.variant !== undefined ? t.variant % TREE_VARIANTS : Math.floor(hash2(t.x, t.z, 7) * TREE_VARIANTS));
      tVar[i] = vi;
      varCount[vi]++;
      const s = t.scale || 1;
      tScale[i] = s;
      tPos[i * 3] = t.x; tPos[i * 3 + 1] = t.y; tPos[i * 3 + 2] = t.z;
      writeMatrix(tMat, i * 16, t.x, t.y, t.z, t.rot || 0, s);
      writeTint(tTint, i * 4, t.x, t.z, 11, SPECIES_LIST[si] === 'birch' ? 1.3 : 1);
    }
    this.trees = { n: nT, pos: tPos, mat: tMat, tint: tTint, variant: tVar, scale: tScale };
    // near meshes per used variant
    this._near = [];
    const used = [];
    for (let vi = 0; vi < MAX_IMPOSTOR_VARIANTS; vi++) {
      if (!varCount[vi]) continue;
      const name = SPECIES_LIST[Math.floor(vi / TREE_VARIANTS)];
      const info = this._variant('tree', name, vi % TREE_VARIANTS);
      used.push({ vi, info });
      this._near.push(this._makeNearMesh(info, varCount[vi], this._materials.tree, true, vi));
    }
    const tGeo = performance.now();
    // impostors
    this._bakeImpostors(used);
    this._buildImpostorMesh();
    const tBake = performance.now();
    // --- bushes ---
    const nB = bushes.length;
    const bPos = new Float32Array(nB * 3);
    const bMat = new Float32Array(nB * 16);
    const bTint = new Float32Array(nB * 4);
    const bVar = new Uint8Array(nB);
    const bRand = new Float32Array(nB);
    const bCount = new Int32Array(BUSH_SPECIES.length * BUSH_VARIANTS);
    for (let i = 0; i < nB; i++) {
      const t = bushes[i];
      let si = BUSH_SPECIES.indexOf(t.species);
      if (si < 0) si = 0;
      const vi = si * BUSH_VARIANTS + (t.variant !== undefined ? t.variant % BUSH_VARIANTS : Math.floor(hash2(t.x, t.z, 3) * BUSH_VARIANTS));
      bVar[i] = vi;
      bCount[vi]++;
      bPos[i * 3] = t.x; bPos[i * 3 + 1] = t.y; bPos[i * 3 + 2] = t.z;
      writeMatrix(bMat, i * 16, t.x, t.y, t.z, t.rot || 0, t.scale || 1);
      writeTint(bTint, i * 4, t.x, t.z, 21, 1.2);
      bRand[i] = hash2(t.x, t.z, 99);
    }
    this.bushes = { n: nB, pos: bPos, mat: bMat, tint: bTint, variant: bVar, rand: bRand };
    this._bushMeshes = [];
    for (let vi = 0; vi < bCount.length; vi++) {
      if (!bCount[vi]) continue;
      const name = BUSH_SPECIES[Math.floor(vi / BUSH_VARIANTS)];
      const info = this._variant('bush', name, vi % BUSH_VARIANTS);
      this._bushMeshes.push(this._makeNearMesh(info, bCount[vi], this._materials.bush, this.q.bushShadows, vi));
    }
    this.treeGrid = new SpatialGrid(tPos, nT, 64);
    this.bushGrid = new SpatialGrid(bPos, nB, 32);
    this._scratch = new Int32Array(Math.max(nT, nB, 1));
    this._scratch2 = new Int32Array(Math.max(nT, nB, 1));
    this.treeCount = nT;
    this.bushCount = nB;
    this._lastRebucket = -1e9;
    const t1 = performance.now();
    this._stats.buildMs = t1 - t0;
    this.buildTimings = { total: t1 - t0, textures: tTex - t0, geometry: tGeo - tTex, impostors: tBake - tGeo, instances: t1 - tBake, textureDetail: this._textures.timings };
  }

  _makeNearMesh(info, capacity, mats, castShadow, vi) {
    const g = new THREE.BufferGeometry();
    const src = info.geometry;
    for (const k of Object.keys(src.attributes)) g.setAttribute(k, src.attributes[k]);
    g.setIndex(src.index);
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    tint.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aTint', tint);
    g.boundingSphere = src.boundingSphere.clone();
    const mesh = new THREE.InstancedMesh(g, mats.main, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.customDepthMaterial = mats.depth;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    mesh.name = `veg-${info.key}`;
    const state = { mesh, info, vi, list: new Int32Array(capacity), listN: 0, main: 0, shadow: 0, tint };
    mesh.onBeforeShadow = () => { mesh.count = state.shadow; };
    mesh.onBeforeRender = () => { mesh.count = state.main; };
    this.group.add(mesh);
    return state;
  }

  _bakeImpostors(used) {
    const renderer = this.renderer;
    const res = this.q.impostorRes;
    const W = res;
    const H = res * 2;
    const layers = Math.max(1, used.length * IMPOSTOR_VIEWS);
    if (this._impostor) {
      this._impostor.albedo.dispose();
      this._impostor.normal.dispose();
    }
    const mkRT = (srgb) => {
      const rt = new THREE.WebGLArrayRenderTarget(W, H, layers, { depthBuffer: true });
      rt.texture.format = THREE.RGBAFormat;
      rt.texture.type = THREE.UnsignedByteType;
      rt.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
      rt.texture.magFilter = THREE.LinearFilter;
      rt.texture.generateMipmaps = false;
      return rt;
    };
    const albedo = mkRT(true);
    const normal = mkRT(false);
    const data = [];
    for (let k = 0; k < MAX_IMPOSTOR_VARIANTS; k++) data.push(new THREE.Vector4(1, 0, 1, 0));
    const bakeMat = new THREE.ShaderMaterial({
      uniforms: { tVegAlbedo: { value: this._textures.albedo }, uMode: { value: 0 } },
      defines: { VEG_TEX_SIZE: `${this._textures.size}.0` },
      vertexShader: BAKE_VERT,
      fragmentShader: BAKE_FRAG,
      side: THREE.DoubleSide,
    });
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(undefined, bakeMat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    used.forEach(({ vi, info }, u) => {
      mesh.geometry = info.geometry;
      const hw = info.rMax * 1.02;
      const y0 = info.yMin;
      const y1 = info.yMax * 1.01;
      data[vi].set(hw, y0, y1, u * IMPOSTOR_VIEWS);
      info.impostorIndex = vi;
      const D = hw + 20;
      cam.left = -hw; cam.right = hw; cam.top = y1; cam.bottom = y0; cam.near = 1; cam.far = D * 2 + 10;
      cam.updateProjectionMatrix();
      for (let k = 0; k < IMPOSTOR_VIEWS; k++) {
        const ang = (k / IMPOSTOR_VIEWS) * TAU;
        cam.position.set(Math.sin(ang) * D, 0, Math.cos(ang) * D);
        cam.lookAt(0, 0, 0);
        cam.updateMatrixWorld();
        const layer = u * IMPOSTOR_VIEWS + k;
        for (let mode = 0; mode < 2; mode++) {
          bakeMat.uniforms.uMode.value = mode;
          renderer.setRenderTarget(mode ? normal : albedo, layer);
          renderer.clear(true, true, false);
          renderer.render(scene, cam);
        }
      }
    });
    // generate mipmaps once at the end
    for (const rt of [albedo, normal]) {
      rt.texture.generateMipmaps = true;
      renderer.setRenderTarget(rt, 0);
      renderer.render(new THREE.Scene(), cam);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAuto;
    renderer.shadowMap.autoUpdate = prevShadow;
    bakeMat.dispose();
    this._impostor = { albedo, normal, data, res, layers };
  }

  _buildImpostorMesh() {
    const n = this.trees.n;
    if (this._impMesh) {
      this.group.remove(this._impMesh);
      this._impMesh.geometry.dispose();
      this._impMesh = null;
    }
    if (!n) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aTint', new THREE.InstancedBufferAttribute(this.trees.tint, 4));
    const imp = new Float32Array(n);
    for (let i = 0; i < n; i++) imp[i] = this.trees.variant[i];
    g.setAttribute('aImp', new THREE.InstancedBufferAttribute(imp, 1));
    if (!this._impMat) {
      const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.uniforms, {
          uVegFade: this.treeFade,
          tImpAlbedo: { value: this._impostor.albedo.texture },
          tImpNormal: { value: this._impostor.normal.texture },
          uImpData: { value: this._impostor.data },
        });
        shader.vertexShader = injectImpostorVertex(shader.vertexShader);
        shader.fragmentShader = injectImpostorFragment(shader.fragmentShader);
      };
      m.customProgramCacheKey = () => 'veg-impostor-v1';
      this._impMat = m;
    }
    this._impMat.defines = { IMP_VIEWS: IMPOSTOR_VIEWS, IMP_TEX_SIZE: `${this._impostor.res * 2}.0` };
    this._impMat.needsUpdate = true;
    const mesh = new THREE.InstancedMesh(g, this._impMat, n);
    mesh.instanceMatrix.array.set(this.trees.mat);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'veg-impostors';
    this.group.add(mesh);
    this._impMesh = mesh;
  }

  _clearInstances() {
    for (const s of [...this._near, ...this._bushMeshes]) {
      this.group.remove(s.mesh);
      s.mesh.geometry.deleteAttribute('aTint');
      s.mesh.geometry.dispose();
      s.mesh.dispose();
    }
    this._near = [];
    this._bushMeshes = [];
    if (this._impMesh) {
      this.group.remove(this._impMesh);
      this._impMesh.geometry.dispose();
      this._impMesh = null;
    }
  }

  /** Wind: strength 0..1, horizontal direction (normalised internally). */
  setWind(strength, dirX = 1, dirZ = 0) {
    const l = Math.hypot(dirX, dirZ) || 1;
    this.uniforms.uVegWind.value.set(dirX / l, dirZ / l, Math.max(0, Math.min(1.5, strength)), 0);
  }

  /** Change quality preset at runtime (distances, bush density/shadows, impostor resolution). */
  setQuality(q) {
    if (!VEGETATION_QUALITY[q] || q === this.quality) return;
    const prevRes = this.q.impostorRes;
    this.quality = q;
    this.q = VEGETATION_QUALITY[q];
    this._applyFadeUniforms();
    for (const s of this._bushMeshes) s.mesh.castShadow = this.q.bushShadows;
    if (this.trees && this.trees.n && prevRes !== this.q.impostorRes) {
      const used = this._near.map((s) => ({ vi: s.vi, info: s.info }));
      const old = this._impostor;
      this._impostor = null;
      this._bakeImpostors(used);
      old.albedo.dispose();
      old.normal.dispose();
      this._buildImpostorMesh();
    }
    this._lastRebucket = -1e9;
  }

  _findShadowLight() {
    let found = null;
    this.scene.traverseVisible((o) => {
      if (!found && o.castShadow && (o.isDirectionalLight || o.isSunLight)) found = o;
    });
    this._shadowLight = found;
  }

  _rebucket() {
    const cam = this._camPos;
    // trees
    if (this.trees && this.trees.n) {
      const R = this.q.treeNear + 12;
      const n = this.treeGrid.query(cam.x, cam.z, R, this._scratch);
      for (const s of this._near) s.listN = 0;
      const byVi = this._nearByVi || (this._nearByVi = []);
      byVi.length = 0;
      for (const s of this._near) byVi[s.vi] = s;
      const { variant } = this.trees;
      for (let k = 0; k < n; k++) {
        const i = this._scratch[k];
        const s = byVi[variant[i]];
        s.list[s.listN++] = i;
      }
      // count far trees (impostors drawn)
      const { pos } = this.trees;
      const n0 = this.treeFade.value.x * this.treeFade.value.x;
      const f1 = this.treeFade.value.w * this.treeFade.value.w;
      let far = 0;
      for (let i = 0, e = this.trees.n; i < e; i++) {
        const dx = pos[i * 3] - cam.x;
        const dy = pos[i * 3 + 1] - cam.y;
        const dz = pos[i * 3 + 2] - cam.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > n0 && d2 < f1) far++;
      }
      this._stats.farTrees = far;
    }
    if (this.bushes && this.bushes.n) {
      const R = this.q.bushFar + 8;
      const n = this.bushGrid.query(cam.x, cam.z, R, this._scratch);
      for (const s of this._bushMeshes) s.listN = 0;
      const byVi = this._bushByVi || (this._bushByVi = []);
      byVi.length = 0;
      for (const s of this._bushMeshes) byVi[s.vi] = s;
      const { variant, rand } = this.bushes;
      const dens = this.q.bushDensity;
      for (let k = 0; k < n; k++) {
        const i = this._scratch[k];
        if (rand[i] >= dens) continue;
        const s = byVi[variant[i]];
        s.list[s.listN++] = i;
      }
    }
    this._findShadowLight();
  }

  _cull(states, data, camera) {
    const useShadow = !!this._shadowLight;
    const dirShadow = useShadow && this._shadowLight.isDirectionalLight;
    // SunLight (cascaded): only trees inside a cascade's box (which already extends toward the sun
    // for off-screen casters) can shadow the view. Uses the cascades of the last shadow update.
    const sunFr = useShadow && this._shadowLight.isSunLight && this._shadowLight.shadow.getFrustum ? this._sunFrusta : null;
    let mainTotal = 0;
    let tris = 0;
    let calls = 0;
    let shadowCalls = 0;
    const { pos, mat, tint, scale } = data;
    const cull = this.frustumCulling;
    const off = this.q.offShadow ?? 1e9;
    const off2 = off * off;
    const cx = this._camPos.x, cz = this._camPos.z;
    for (const s of states) {
      const { list, listN, info, mesh } = s;
      const mArr = mesh.instanceMatrix.array;
      const tArr = s.tint.array;
      let main = 0;
      let extra = 0;
      const sy = info.sphereY;
      const sr = info.sphereR;
      for (let k = 0; k < listN; k++) {
        const i = list[k];
        const sc = scale ? scale[i] : mat[i * 16 + 5];
        const x = pos[i * 3];
        const y = pos[i * 3 + 1] + sy * sc;
        const z = pos[i * 3 + 2];
        const r = sr * sc;
        let inMain = true;
        if (cull) inMain = sphereInFrustum(this._frustum, x, y, z, r);
        if (inMain) {
          this._copyInstance(mArr, tArr, main++, mat, tint, i);
        } else if (useShadow && (x - cx) * (x - cx) + (z - cz) * (z - cz) < off2 && (sunFr
          ? sphereInFrustum(sunFr[0], x, y, z, r + 8) || sphereInFrustum(sunFr[1], x, y, z, r + 8)
          : !dirShadow || sphereInFrustum(this._shadowFrustum, x, y, z, r))) {
          this._scratch2[extra++] = i;
        }
      }
      for (let k = 0; k < extra; k++) this._copyInstance(mArr, tArr, main + k, mat, tint, this._scratch2[k]);
      s.main = main;
      s.shadow = mesh.castShadow ? main + extra : 0;
      const total = main + extra;
      mesh.count = main;
      mesh.visible = total > 0;
      if (total > 0) {
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, total * 16);
        mesh.instanceMatrix.needsUpdate = true;
        s.tint.clearUpdateRanges();
        s.tint.addUpdateRange(0, total * 4);
        s.tint.needsUpdate = true;
      }
      if (main > 0) calls++;
      if (s.shadow > 0) shadowCalls++;
      mainTotal += main;
      tris += main * info.triangles;
    }
    return { main: mainTotal, tris, calls, shadowCalls };
  }

  _copyInstance(mArr, tArr, slot, mat, tint, i) {
    const o = slot * 16;
    const src = i * 16;
    for (let k = 0; k < 16; k++) mArr[o + k] = mat[src + k];
    const ot = slot * 4;
    const st = i * 4;
    tArr[ot] = tint[st]; tArr[ot + 1] = tint[st + 1]; tArr[ot + 2] = tint[st + 2]; tArr[ot + 3] = tint[st + 3];
  }

  /**
   * Per-frame update: wind time, LOD re-bucketing (every ~0.3 s or 4 m) and near-set culling.
   * @param {THREE.Camera} camera
   * @param {number} time seconds (wind phase)
   */
  update(camera, time) {
    this.uniforms.uVegTime.value = time;
    camera.updateMatrixWorld();
    this._camPos.setFromMatrixPosition(camera.matrixWorld);
    this.uniforms.uVegView.value.copy(this._camPos);
    if (!this.trees) return;
    const now = performance.now();
    if (now - this._lastRebucket > 300 || this._camPos.distanceToSquared(this._lastPos) > 16) {
      this._lastRebucket = now;
      this._lastPos.copy(this._camPos);
      this._rebucket();
    }
    _m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(_m4, camera.coordinateSystem, camera.reversedDepth);
    const light = this._shadowLight;
    this._sunFrusta = null;
    if (light && light.isSunLight && light.shadow.getFrustum) {
      const f0 = light.shadow.getFrustum(0);
      const f1 = light.shadow.getFrustum(1);
      // before the first shadow update the cascade frusta are still default (identical) planes
      if (f0 && f1 && !f1.planes[0].normal.equals(f1.planes[1].normal)) this._sunFrusta = [f0, f1];
    }
    if (light && light.isDirectionalLight) {
      const sc = light.shadow.camera;
      light.updateWorldMatrix(true, false);
      light.target.updateWorldMatrix(true, false);
      _v3a.setFromMatrixPosition(light.matrixWorld);
      _v3b.setFromMatrixPosition(light.target.matrixWorld);
      sc.position.copy(_v3a);
      sc.lookAt(_v3b);
      sc.updateMatrixWorld();
      _m4.multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse);
      this._shadowFrustum.setFromProjectionMatrix(_m4, sc.coordinateSystem, sc.reversedDepth);
    }
    const t = this._cull(this._near, this.trees, camera);
    const b = this._cull(this._bushMeshes, this.bushes, camera);
    const st = this._stats;
    st.nearTrees = t.main;
    st.bushes = b.main;
    const impCalls = this._impMesh && st.farTrees > 0 ? 1 : 0;
    if (this._impMesh) this._impMesh.visible = st.farTrees > 0;
    st.drawCalls = t.calls + b.calls + impCalls;
    st.shadowDrawCalls = t.shadowCalls + b.shadowCalls;
    st.triangles = t.tris + b.tris + st.farTrees * 2;
  }

  /** { drawCalls, nearTrees, farTrees, bushes, triangles, shadowDrawCalls, buildMs } */
  get stats() {
    return { ...this._stats };
  }

  /** Triangle count of one near-LOD instance per variant (for budgeting/debugging). */
  get variantInfo() {
    return [...this._geoCache.values()].map((e) => ({ key: e.key, triangles: e.triangles, height: +e.yMax.toFixed(2), radius: +e.rMax.toFixed(2) }));
  }

  dispose() {
    this._clearInstances();
    this.scene.remove(this.group);
    for (const e of this._geoCache.values()) e.geometry.dispose();
    this._geoCache.clear();
    if (this._materials) {
      for (const k of ['tree', 'bush']) {
        this._materials[k].main.dispose();
        this._materials[k].depth.dispose();
      }
    }
    if (this._impMat) this._impMat.dispose();
    if (this._impostor) {
      this._impostor.albedo.dispose();
      this._impostor.normal.dispose();
    }
    if (this._textures) this._textures.dispose();
    this._textures = null;
    this._materials = null;
    this._impostor = null;
    this.trees = null;
    this.bushes = null;
  }
}
