// Procedural soldier character (third-person, skinned, procedurally animated) and first-person
// arms for the viewmodel. Everything (geometry, textures, animation) is generated in code.
//
// Third person: one SkinnedMesh per material (camo / gear / skin / hard → ≤ 4 draw calls) driven by
// a 25-bone joint hierarchy (pelvis → spine → chest → neck → head, clavicle → upperArm → foreArm →
// hand (+ thumb / index / fingers), thigh → shin → foot). Geometry and materials are cached and
// shared between instances; each SoldierModel only owns its bones and skeleton.
//
// Coordinates: metres, +Y up, model faces −Z, right is +X. Root origin = feet on the ground.
import * as THREE from 'three';
import { solveTwoBone, chainRotations, boneLookRotation, handRotation, twistAround } from './ik.js';
import {
  getCamoTexture, getFabricNormal, getNylonTextures, getFaceTexture, rng,
  CAMO_TILE_M, NYLON_TILE_M, FACE_TEX, CAMO_PATTERNS,
} from './soldier-textures.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (dt, tau) => 1 - Math.exp(-dt / Math.max(1e-4, tau));
const frac = (x) => x - Math.floor(x);
const kd = (snap, dt, tau) => (snap ? 1 : damp(dt, tau));

// ================================================================== body dimensions (1.80 m man)

const UPPER_ARM = 0.315;
const FORE_ARM = 0.265;
const THIGH = 0.43;
const SHIN = 0.42;
const ANKLE_H = 0.10; // ankle joint above the boot sole
const HEEL_BACK = 0.075; // heel contact behind the ankle
const BALL_FWD = 0.14; // ball of the foot ahead of the ankle
const LEG_REACH = 0.842;
const A_POSE = 30 * DEG;
const HIP_X = 0.095;
const PELVIS_H = 1.0;
const EYE_LOCAL = new THREE.Vector3(0.033, 0.046, -0.078); // right eye in head space
const HEAD_CENTER = new THREE.Vector3(0, 0.07, 0.0); // head centre in head space

// ================================================================== skeleton definition

const CORE_BONES = [
  ['pelvis', null, [0, PELVIS_H, 0]],
  ['spine', 'pelvis', [0, 0.10, 0]],
  ['chest', 'spine', [0, 0.18, 0]],
  ['neck', 'chest', [0, 0.22, 0]],
  ['head', 'neck', [0, 0.135, -0.005]],
];
// right side; left is mirrored (x → −x, Euler y/z negated)
const SIDE_BONES = [
  ['clavicle', 'chest', [0.025, 0.18, -0.035]],
  ['upperArm', 'clavicle', [0.16, -0.015, 0.035], [0, 0, A_POSE]],
  ['foreArm', 'upperArm', [0, -UPPER_ARM, 0]],
  ['hand', 'foreArm', [0, -FORE_ARM, 0]],
  ['thumb', 'hand', [0.024, -0.03, -0.016]],
  ['index', 'hand', [0.024, -0.095, -0.002]],
  ['fingers', 'hand', [-0.012, -0.093, -0.002]],
  ['thigh', 'pelvis', [HIP_X, -0.05, 0]],
  ['shin', 'thigh', [0, -THIGH, 0]],
  ['foot', 'shin', [0, -SHIN, 0]],
];
const SIDE_ROOTS = new Set(['chest', 'pelvis']);

function buildBoneDefs(core, side) {
  const defs = core.map(([name, parent, pos, rot]) => ({ name, parent, pos, rot: rot || [0, 0, 0] }));
  for (const s of ['L', 'R']) {
    const m = s === 'L' ? -1 : 1;
    for (const [name, parent, pos, rot = [0, 0, 0]] of side) {
      defs.push({
        name: name + s,
        parent: SIDE_ROOTS.has(parent) ? parent : parent + s,
        pos: [pos[0] * m, pos[1], pos[2]],
        rot: [rot[0], rot[1] * m, rot[2] * m],
      });
    }
  }
  return defs;
}

function makeRig(defs) {
  const index = {};
  defs.forEach((d, i) => { index[d.name] = i; });
  const bindWorld = [];
  const bindInv = [];
  const localQ = [];
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(d.rot[0], d.rot[1], d.rot[2], 'XYZ'));
    localQ.push(q);
    const local = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(d.pos), q, new THREE.Vector3(1, 1, 1));
    const w = d.parent ? bindWorld[index[d.parent]].clone().multiply(local) : local;
    bindWorld.push(w);
    bindInv.push(w.clone().invert());
  }
  return { defs, index, bindWorld, bindInv, localQ };
}

const TP_RIG = makeRig(buildBoneDefs(CORE_BONES, SIDE_BONES));
const BI = TP_RIG.index;
/** Per-side bone indices: [left, right]. */
const SIDE_I = [0, 1].map((k) => {
  const s = k ? 'R' : 'L';
  const o = {};
  for (const [n] of SIDE_BONES) o[n] = BI[n + s];
  return o;
});

// ================================================================== geometry toolkit

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);
const WHITE = new THREE.Color(1, 1, 1);

const col = (hex) => new THREE.Color(hex);
const mulCol = (c, k) => new THREE.Color(c.r * k, c.g * k, c.b * k);

/** Collects skinned vertices for one material. */
class Acc {
  constructor() {
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.si = []; this.sw = []; this.idx = [];
  }

  get n() { return this.pos.length / 3; }

  vert(p, n, u, v, c, w) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    let sum = 0; let cnt = 0;
    for (let i = 0; i + 1 < w.length; i += 2) if (w[i + 1] > 1e-4) sum += w[i + 1];
    for (let i = 0; i + 1 < w.length && cnt < 4; i += 2) {
      if (w[i + 1] <= 1e-4) continue;
      this.si.push(w[i]); this.sw.push(w[i + 1] / sum); cnt++;
    }
    for (; cnt < 4; cnt++) { this.si.push(0); this.sw.push(0); }
  }

  tri(a, b, c) { this.idx.push(a, b, c); }

  geometry() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const _ta = new THREE.Vector3();
const _tl = new THREE.Vector3();
const _gn = new THREE.Vector3();
const _gp = new THREE.Vector3();
const _gq = new THREE.Vector3();

/**
 * Adds a grid surface: rows of points (model space). Closed rows wrap around (tubes).
 * o: { closed=true, centers[], w (array per row | fn(j,k,p)), col (Color | fn(p,n,j,k)), uv fn(j,k) → [u,v],
 *      uRep, vScale, capStart, capEnd, sign (+1/−1 forces orientation) }
 */
function addGrid(acc, rows, o) {
  const R = rows.length;
  const N = rows[0].length;
  const closed = o.closed !== false;
  const centers = o.centers;
  const normals = [];
  for (let j = 0; j < R; j++) {
    const row = rows[j];
    const nr = [];
    for (let k = 0; k < N; k++) {
      const kp = closed ? (k + 1) % N : Math.min(N - 1, k + 1);
      const km = closed ? (k - 1 + N) % N : Math.max(0, k - 1);
      _ta.subVectors(row[kp], row[km]);
      const jp = Math.min(R - 1, j + 1); const jm = Math.max(0, j - 1);
      _tl.subVectors(rows[jp][k], rows[jm][k]);
      const n = new THREE.Vector3().crossVectors(_tl, _ta);
      if (n.lengthSq() < 1e-14) {
        if (centers) n.subVectors(row[k], centers[j]);
        if (n.lengthSq() < 1e-14) n.copy(_tl);
      }
      nr.push(n.normalize());
    }
    normals.push(nr);
  }
  // orientation
  let sign = o.sign || 0;
  if (!sign) {
    let s = 0;
    for (let j = 0; j < R; j++) {
      for (let k = 0; k < N; k++) {
        if (!centers) continue;
        _gn.subVectors(rows[j][k], centers[j]);
        s += _gn.dot(normals[j][k]);
      }
    }
    sign = s >= 0 ? 1 : -1;
    if (o.inward) sign = -sign;
  }
  if (sign < 0) for (const nr of normals) for (const n of nr) n.negate();
  // UVs
  const uRep = o.uRep || 1;
  const vScale = o.vScale || 1;
  const vAcc = [0];
  for (let j = 1; j < R; j++) {
    const a = centers ? centers[j - 1] : rows[j - 1][0];
    const b = centers ? centers[j] : rows[j][0];
    vAcc.push(vAcc[j - 1] + a.distanceTo(b));
  }
  const base = acc.n;
  const K = closed ? N + 1 : N;
  for (let j = 0; j < R; j++) {
    const wj = typeof o.w === 'function' ? null : (Array.isArray(o.w[0]) ? o.w[j] : o.w);
    for (let k = 0; k < K; k++) {
      const kk = k % N;
      const p = rows[j][kk];
      const n = normals[j][kk];
      let u; let v;
      if (o.uv) [u, v] = o.uv(j, k / (K - (closed ? 1 : 1)), p);
      else { u = (closed ? k / N : k / (N - 1)) * uRep; v = vAcc[j] / vScale; }
      const c = typeof o.col === 'function' ? o.col(p, n, j, kk) : (o.col || WHITE);
      const w = wj || o.w(j, kk, p);
      acc.vert(p, n, u, v, c, w);
    }
  }
  for (let j = 0; j < R - 1; j++) {
    for (let k = 0; k < K - 1; k++) {
      const a = base + j * K + k; const b = base + (j + 1) * K + k;
      const c = a + 1; const d = b + 1;
      if (sign > 0) { acc.tri(a, b, c); acc.tri(c, b, d); } else { acc.tri(a, c, b); acc.tri(c, d, b); }
    }
  }
  const cap = (j, end) => {
    if (!centers) return;
    const ctr = centers[j];
    const jn = end ? Math.max(0, j - 1) : Math.min(R - 1, j + 1);
    const dir = new THREE.Vector3().subVectors(ctr, centers[jn]).normalize();
    if (dir.lengthSq() < 1e-10) return;
    const wj = typeof o.w === 'function' ? o.w(j, 0, rows[j][0]) : (Array.isArray(o.w[0]) ? o.w[j] : o.w);
    const c0 = typeof o.col === 'function' ? o.col(ctr, dir, j, 0) : (o.col || WHITE);
    const ci = acc.n;
    let uc = 0.5 * uRep; let vc = vAcc[j] / vScale;
    if (o.uv) [uc, vc] = o.uv(j, 0.5, ctr);
    acc.vert(ctr, dir, uc, vc, c0, wj);
    const rs = acc.n;
    for (let k = 0; k < N; k++) {
      const p = rows[j][k];
      let u; let v;
      if (o.uv) [u, v] = o.uv(j, k / N, p); else { u = (k / N) * uRep; v = vc; }
      const cc = typeof o.col === 'function' ? o.col(p, dir, j, k) : (o.col || WHITE);
      acc.vert(p, dir, u, v, cc, typeof o.w === 'function' ? o.w(j, k, p) : wj);
    }
    for (let k = 0; k < N; k++) {
      const a = rs + k; const b = rs + ((k + 1) % N);
      _gp.subVectors(rows[j][(k + 1) % N], rows[j][k]);
      _gq.subVectors(ctr, rows[j][k]);
      _gn.crossVectors(_gp, _gq);
      if (_gn.dot(dir) >= 0) acc.tri(a, b, ci); else acc.tri(b, a, ci);
    }
  };
  if (o.capStart) cap(0, false);
  if (o.capEnd) cap(R - 1, true);
}

/**
 * Lofted superellipse rings. Rings: { c:[x,y,z], rx, rf, rb, n=2, ax?, az?, w?, col? } in a local frame.
 * The ring point at angle a is c + ax·rx·f(cos a) + az·(sin a < 0 ? rf : rb)·f(sin a) (rf = −az side).
 * o: { frame: Matrix4 local→model, seg, a0, disp(pLocal, j, k), w (default weights), col, uv, tile, capStart, capEnd }
 */
function addLoft(acc, rings, o) {
  const N = o.seg;
  const a0 = o.a0 ?? Math.PI / 2;
  const rows = [];
  const centers = [];
  const ringW = [];
  let perim = 0;
  for (let j = 0; j < rings.length; j++) {
    const r = rings[j];
    const e = 2 / (r.n || 2);
    const ax = r.ax || X_AXIS; const az = r.az || Z_AXIS;
    const row = [];
    for (let k = 0; k < N; k++) {
      const a = a0 + (k / N) * TAU;
      const ca = Math.cos(a); const sa = Math.sin(a);
      const x = r.rx * Math.sign(ca) * Math.abs(ca) ** e;
      const z = (sa < 0 ? r.rf : r.rb) * Math.sign(sa) * Math.abs(sa) ** e;
      const p = new THREE.Vector3(r.c[0], r.c[1], r.c[2]).addScaledVector(ax, x).addScaledVector(az, z);
      if (o.disp) o.disp(p, j, k, a);
      row.push(p);
    }
    const c = new THREE.Vector3(r.c[0], r.c[1], r.c[2]);
    if (j === Math.floor(rings.length / 2)) {
      for (let k = 0; k < N; k++) perim += row[k].distanceTo(row[(k + 1) % N]);
    }
    if (o.frame) { for (const p of row) p.applyMatrix4(o.frame); c.applyMatrix4(o.frame); }
    rows.push(row);
    centers.push(c);
    ringW.push(r.w || o.w);
  }
  const tile = o.tile || CAMO_TILE_M;
  addGrid(acc, rows, {
    centers,
    w: o.wFn || ringW,
    col: o.colFn || ((p, n, j) => rings[j].col || o.col || WHITE),
    uv: o.uv,
    uRep: o.uRep || Math.max(1, Math.round(perim / tile)),
    vScale: tile,
    capStart: o.capStart,
    capEnd: o.capEnd,
    sign: o.sign,
  });
}

/** Sweep a rounded-rect / round profile along a polyline (local frame). */
function addSweep(acc, pts, o) {
  const rings = [];
  const wAxis = o.widthAxis || null;
  for (let j = 0; j < pts.length; j++) {
    const p = pts[j];
    const t = new THREE.Vector3().subVectors(pts[Math.min(pts.length - 1, j + 1)], pts[Math.max(0, j - 1)]).normalize();
    let ax;
    if (wAxis) ax = wAxis.clone().addScaledVector(t, -wAxis.dot(t));
    else ax = new THREE.Vector3().crossVectors(o.up || Y_AXIS, t);
    if (ax.lengthSq() < 1e-8) ax = new THREE.Vector3().crossVectors(X_AXIS, t);
    if (ax.lengthSq() < 1e-8) ax = new THREE.Vector3().crossVectors(Z_AXIS, t);
    ax.normalize();
    const az = new THREE.Vector3().crossVectors(t, ax).normalize();
    const sc = o.scale ? o.scale(j / (pts.length - 1)) : 1;
    rings.push({ c: [p.x, p.y, p.z], rx: (o.w ?? o.r) * 0.5 * sc * (o.r ? 2 : 1), rf: (o.h ?? o.r) * 0.5 * sc * (o.r ? 2 : 1), rb: (o.h ?? o.r) * 0.5 * sc * (o.r ? 2 : 1), n: o.n || 2, ax, az });
  }
  addLoft(acc, rings, { ...o, w: o.weights, seg: o.seg || 6, capStart: o.caps !== false, capEnd: o.caps !== false, sign: o.sign });
}

/** Smooth path through control points (Catmull-Rom), `n` samples. */
function curvePts(ctrl, n) {
  const c = new THREE.CatmullRomCurve3(ctrl.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  return c.getPoints(n - 1);
}

/** Adds a three.js BufferGeometry transformed by M (part → model). */
function addGeo(acc, geo, M, color, w, uv = { box: 1 / NYLON_TILE_M }) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uvA = geo.attributes.uv;
  const nm = new THREE.Matrix3().getNormalMatrix(M);
  const flip = M.determinant() < 0;
  const base = acc.n;
  const p = new THREE.Vector3(); const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(M);
    n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    let u; let v;
    if (uv.box) {
      const ax = Math.abs(n.x); const ay = Math.abs(n.y); const az = Math.abs(n.z);
      if (ax >= ay && ax >= az) { u = p.z * uv.box; v = p.y * uv.box; } else if (ay >= az) { u = p.x * uv.box; v = p.z * uv.box; } else { u = p.x * uv.box; v = p.y * uv.box; }
    } else if (uv.fixed) { [u, v] = uv.fixed; } else { u = uvA.getX(i) * (uv.su || 1); v = uvA.getY(i) * (uv.sv || 1); }
    acc.vert(p, n, u, v, typeof color === 'function' ? color(p, n) : color, typeof w === 'function' ? w(p) : w);
  }
  if (geo.index) {
    const ix = geo.index;
    for (let i = 0; i < ix.count; i += 3) {
      const a = base + ix.getX(i); const b = base + ix.getX(i + 1); const c = base + ix.getX(i + 2);
      if (flip) acc.tri(a, c, b); else acc.tri(a, b, c);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      if (flip) acc.tri(base + i, base + i + 2, base + i + 1); else acc.tri(base + i, base + i + 1, base + i + 2);
    }
  }
}

/** Chamfered box geometry (44 triangles, flat-shaded bevels). */
const _chamferCache = new Map();
function chamferBox(w, h, d, c) {
  const key = `${w}|${h}|${d}|${c}`;
  let g = _chamferCache.get(key);
  if (g) return g;
  const hx = w / 2; const hy = h / 2; const hz = d / 2;
  c = Math.min(c, hx * 0.9, hy * 0.9, hz * 0.9);
  const pos = []; const nor = [];
  const fv = (a, s) => [a === 0 ? s[0] * hx : s[0] * (hx - c), a === 1 ? s[1] * hy : s[1] * (hy - c), a === 2 ? s[2] * hz : s[2] * (hz - c)];
  const poly = (pts, nrm) => {
    const v0 = new THREE.Vector3(...pts[0]);
    for (let i = 1; i + 1 < pts.length; i++) {
      const v1 = new THREE.Vector3(...pts[i]); const v2 = new THREE.Vector3(...pts[i + 1]);
      const gn = new THREE.Vector3().subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0));
      const tri = gn.dot(nrm) >= 0 ? [v0, v1, v2] : [v0, v2, v1];
      for (const v of tri) { pos.push(v.x, v.y, v.z); nor.push(nrm.x, nrm.y, nrm.z); }
    }
  };
  const S = [-1, 1];
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3; const e = (a + 2) % 3;
    for (const s of S) {
      const pts = [];
      for (const [sb, se] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const sg = [0, 0, 0]; sg[a] = s; sg[b] = sb; sg[e] = se;
        pts.push(fv(a, sg));
      }
      const nrm = new THREE.Vector3(); nrm.setComponent(a, s);
      poly(pts, nrm);
    }
  }
  if (c > 0) {
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3; const e = (a + 2) % 3;
      for (const sa of S) {
        for (const sb of S) {
          const g0 = [0, 0, 0]; g0[a] = sa; g0[b] = sb; g0[e] = -1;
          const g1 = [0, 0, 0]; g1[a] = sa; g1[b] = sb; g1[e] = 1;
          const nrm = new THREE.Vector3(); nrm.setComponent(a, sa); nrm.setComponent(b, sb); nrm.normalize();
          poly([fv(a, g0), fv(a, g1), fv(b, g1), fv(b, g0)], nrm);
        }
      }
    }
    for (const sx of S) for (const sy of S) for (const sz of S) {
      const sg = [sx, sy, sz];
      poly([fv(0, sg), fv(1, sg), fv(2, sg)], new THREE.Vector3(sx, sy, sz).normalize());
    }
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  _chamferCache.set(key, g);
  return g;
}

const _mtx = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ')),
  new THREE.Vector3(sx, sy, sz),
);

// ================================================================== looks / variants

const TEAM_COLOR = { 0: '#2a62d4', 1: '#d02a22', ffa: '#5b5e4c' };

const GEAR_PALETTES = {
  0: [
    { carrier: '#4c5241', pouch: '#4f5543', belt: '#3f4437', strap: '#3a3e33', glove: '#2c2c29', palm: '#55503f', boot: '#8b7457', sole: '#2b2a27', pad: '#262826', helmet: '#4f5546', comm: '#2b2d2a', pack: '#4c5241' },
    { carrier: '#7b6a50', pouch: '#7f6e53', belt: '#6b5c45', strap: '#625440', glove: '#6c5e49', palm: '#3a352d', boot: '#7e6a51', sole: '#2b2a27', pad: '#5f533f', helmet: '#7d6c52', comm: '#2b2d2a', pack: '#7b6a50' },
    { carrier: '#8a8462', pouch: '#7f7a5a', belt: '#5f5b45', strap: '#555139', glove: '#2b2b29', palm: '#4b463a', boot: '#8b7457', sole: '#2b2a27', pad: '#2a2b28', helmet: '#59604d', comm: '#2b2d2a', pack: '#80795a' },
  ],
  1: [
    { carrier: '#a08b66', pouch: '#9b8763', belt: '#86744f', strap: '#7d6c4c', glove: '#7a684d', palm: '#3e382f', boot: '#2b2927', sole: '#1f1e1c', pad: '#2c2b28', helmet: '#a69473', comm: '#2b2a27', pack: '#9c8864' },
    { carrier: '#5f5e47', pouch: '#62614a', belt: '#4f4e3b', strap: '#4a4937', glove: '#2b2b29', palm: '#4a4538', boot: '#2b2927', sole: '#1f1e1c', pad: '#2c2b28', helmet: '#5f604b', comm: '#2b2a27', pack: '#5f5e47' },
    { carrier: '#8c7f63', pouch: '#887b5f', belt: '#74684f', strap: '#6b6049', glove: '#6a5c48', palm: '#3e382f', boot: '#7a6650', sole: '#262420', pad: '#5c5240', helmet: '#8f8165', comm: '#2b2a27', pack: '#877a5e' },
  ],
};

const LOOK_TABLE = [
  { tone: 1, face: 'stubble', headgear: 'helmet', cover: true, nvg: false, eyewear: false, pack: 0, gear: 0 },
  { tone: 3, face: 'beard', headgear: 'helmet', cover: true, nvg: true, eyewear: true, pack: 1, gear: 1 },
  { tone: 0, face: 'clean', headgear: 'boonie', cover: false, nvg: false, eyewear: true, pack: 0, gear: 2 },
  { tone: 4, face: 'balaclava', headgear: 'helmet', cover: false, nvg: true, eyewear: false, pack: 2, gear: 0 },
  { tone: 2, face: 'stubble', headgear: 'helmet', cover: false, nvg: false, eyewear: false, pack: 1, gear: 1 },
  { tone: 5, face: 'stubble', headgear: 'helmet', cover: true, nvg: false, eyewear: true, pack: 0, gear: 2 },
  { tone: 1, face: 'beard', headgear: 'boonie', cover: false, nvg: false, eyewear: false, pack: 1, gear: 0 },
  { tone: 3, face: 'balaclava', headgear: 'helmet', cover: true, nvg: true, eyewear: false, pack: 0, gear: 2 },
];

/** Deterministic appearance from team + variant. */
export function decodeLook(team = 0, variant = 0) {
  const v = Math.abs(Math.floor(variant)) || 0;
  let L;
  if (v < LOOK_TABLE.length) L = { ...LOOK_TABLE[v] };
  else {
    const r = rng(v * 7919 + 17);
    const hg = r();
    L = {
      tone: Math.floor(r() * 6),
      face: ['clean', 'stubble', 'stubble', 'beard', 'balaclava'][Math.floor(r() * 5)],
      headgear: hg < 0.78 ? 'helmet' : 'boonie',
      cover: r() < 0.55,
      nvg: r() < 0.4,
      eyewear: r() < 0.35,
      pack: r() < 0.45 ? 0 : r() < 0.6 ? 1 : 2,
      gear: Math.floor(r() * 3),
    };
  }
  if (L.face === 'balaclava') L.headgear = 'helmet';
  if (L.headgear !== 'helmet') L.nvg = false;
  const t = team === 0 || team === 1 ? team : -1;
  const pr = rng(v * 131 + 7);
  const gteam = t >= 0 ? t : (pr() < 0.5 ? 0 : 1);
  L.team = t;
  L.camo = t === 0 ? 'multicam' : t === 1 ? 'flora' : CAMO_PATTERNS[v % CAMO_PATTERNS.length];
  L.palette = GEAR_PALETTES[gteam][L.gear % 3];
  L.teamColor = t === 0 ? TEAM_COLOR[0] : t === 1 ? TEAM_COLOR[1] : TEAM_COLOR.ffa;
  L.knit = ['#25262a', '#3b3d31', '#4a4334'][v % 3];
  return L;
}

// ================================================================== materials (shared)

const _mats = new Map();
function sharedMat(key, make) {
  let m = _mats.get(key);
  if (!m) { m = make(); _mats.set(key, m); }
  return m;
}

function camoMaterial(pattern, fp = false) {
  return sharedMat(`camo:${pattern}:${fp}`, () => new THREE.MeshStandardMaterial({
    name: `soldier-camo-${pattern}`,
    map: getCamoTexture(pattern),
    normalMap: getFabricNormal(fp ? 2 : 1),
    normalScale: new THREE.Vector2(fp ? 0.5 : 0.85, fp ? 0.5 : 0.85),
    color: 0xc4c4c4,
    roughness: 0.9,
    metalness: 0,
    vertexColors: true,
  }));
}

function gearMaterial() {
  return sharedMat('gear', () => {
    const t = getNylonTextures();
    return new THREE.MeshStandardMaterial({
      name: 'soldier-gear', map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.84, metalness: 0, vertexColors: true,
    });
  });
}

function skinMaterial(tone, face, knit) {
  return sharedMat(`skin:${tone}:${face}:${knit}`, () => new THREE.MeshStandardMaterial({
    name: 'soldier-skin', map: getFaceTexture(tone, face, knit), roughness: 0.62, metalness: 0, vertexColors: true,
  }));
}

function hardMaterial() {
  return sharedMat('hard', () => new THREE.MeshStandardMaterial({
    name: 'soldier-hard', roughness: 0.48, metalness: 0.12, vertexColors: true,
  }));
}

const MAT_KEYS = ['camo', 'gear', 'skin', 'hard'];

function soldierMaterials(look) {
  return {
    camo: camoMaterial(look.camo),
    gear: gearMaterial(),
    skin: skinMaterial(look.tone, look.face, look.knit),
    hard: hardMaterial(),
  };
}

// ================================================================== third-person body geometry

const w1 = (name) => [BI[name], 1];
const bindOf = (name) => TP_RIG.bindWorld[BI[name]];
const frameOf = (name, mirror = false, local = null) => {
  const m = bindOf(name).clone();
  if (mirror) m.multiply(MIRROR_X);
  if (local) m.multiply(local);
  return m;
};

function buildHead(B, L, hi) {
  const seg = hi ? 20 : 9;
  const rings = [
    [-0.078, -0.064, 0.010, 0.008, 0.008, 2.0],
    [-0.073, -0.056, 0.030, 0.022, 0.024, 2.0],
    [-0.060, -0.046, 0.047, 0.034, 0.036, 2.2],
    [-0.040, -0.032, 0.061, 0.052, 0.050, 2.3],
    [-0.015, -0.020, 0.069, 0.068, 0.066, 2.3],
    [0.010, -0.010, 0.074, 0.078, 0.086, 2.2],
    [0.035, -0.004, 0.078, 0.082, 0.098, 2.2],
    [0.060, 0.000, 0.080, 0.085, 0.104, 2.1],
    [0.090, 0.003, 0.079, 0.083, 0.104, 2.1],
    [0.118, 0.006, 0.073, 0.075, 0.096, 2.0],
    [0.142, 0.008, 0.060, 0.060, 0.078, 2.0],
    [0.160, 0.010, 0.040, 0.040, 0.052, 2.0],
    [0.170, 0.012, 0.018, 0.017, 0.024, 2.0],
  ];
  const use = hi ? rings : [rings[0], rings[2], rings[4], rings[6], rings[8], rings[10], rings[12]];
  const bumps = [
    [0.033, 0.046, -0.08, 0.014, -0.007], [-0.033, 0.046, -0.08, 0.014, -0.007],
    [0.03, 0.064, -0.086, 0.016, 0.004], [-0.03, 0.064, -0.086, 0.016, 0.004],
    [0.052, 0.024, -0.064, 0.016, 0.004], [-0.052, 0.024, -0.064, 0.016, 0.004],
    [0, -0.028, -0.073, 0.016, 0.003], [0, -0.064, -0.058, 0.014, 0.004],
    [0.058, -0.038, -0.004, 0.02, 0.003], [-0.058, -0.038, -0.004, 0.02, 0.003],
    [0.072, 0.075, -0.035, 0.018, -0.003], [-0.072, 0.075, -0.035, 0.018, -0.003],
  ];
  const disp = (p) => {
    const rx = p.x; const rz = p.z - 0.0;
    const rl = Math.hypot(rx, rz) || 1;
    let d = 0;
    for (const b of bumps) {
      const dd = (p.x - b[0]) ** 2 + (p.y - b[1]) ** 2 + (p.z - b[2]) ** 2;
      d += b[4] * Math.exp(-dd / (b[3] * b[3]));
    }
    p.x += (rx / rl) * d; p.z += (rz / rl) * d;
  };
  const { y0, y1 } = FACE_TEX;
  addLoft(B.skin, use.map(([y, cz, rx, rf, rb, n]) => ({ c: [0, y, cz], rx, rf, rb, n })), {
    frame: frameOf('head'), seg, w: w1('head'), disp: hi ? disp : null, capStart: true, capEnd: true,
    uv: (j, u) => [u, (use[j][0] - y0) / (y1 - y0)],
  });
  if (hi) {
    // nose
    const nose = [
      [0.052, -0.084, 0.006, 0.003, 0.006],
      [0.032, -0.089, 0.008, 0.007, 0.008],
      [0.014, -0.098, 0.011, 0.010, 0.012],
      [0.003, -0.100, 0.016, 0.011, 0.014],
      [-0.005, -0.094, 0.014, 0.008, 0.012],
    ];
    addLoft(B.skin, nose.map(([y, cz, rx, rf, rb]) => ({ c: [0, y, cz], rx, rf, rb })), {
      frame: frameOf('head'), seg: 8, w: w1('head'), capEnd: true,
      uv: (j) => [0.5, (nose[j][0] - y0) / (y1 - y0)],
    });
    // ears
    for (const s of [-1, 1]) {
      addGeo(B.skin, new THREE.SphereGeometry(1, 7, 4), frameOf('head', false, _mtx(s * 0.078, 0.028, 0.012, -0.25, 0, 0, 0.012, 0.031, 0.019)), WHITE, w1('head'), { fixed: [s > 0 ? 0.75 : 0.25, 0.42] });
    }
  }
  // neck
  const neck = [
    [-0.05, 0.006, 0.07], [0.0, 0.006, 0.062], [0.04, 0.0, 0.058], [0.08, -0.004, 0.056], [0.11, -0.008, 0.055], [0.145, -0.01, 0.052],
  ];
  const nb = BI.neck; const hb = BI.head; const cb = BI.chest;
  addLoft(B.skin, neck.map(([y, cz, r]) => {
    const s1 = smooth(-0.04, 0.02, y); const s2 = smooth(0.08, 0.14, y);
    return { c: [0, y, cz], rx: r, rf: r * 1.02, rb: r * 0.98, w: [cb, 1 - s1, nb, s1 * (1 - s2), hb, s2] };
  }), { frame: frameOf('neck'), seg: hi ? 12 : 7, uv: (j, u) => [u, 0.004 + j * 0.004] });
}

function buildTorso(B, L, hi) {
  const P = L.palette;
  const seg = hi ? 18 : 9;
  const pb = BI.pelvis; const sb = BI.spine; const cb = BI.chest; const nb = BI.neck;
  // shirt torso (camo), model space
  const torso = [
    [0.99, 0.004, 0.160, 0.106, 0.114, 2.4],
    [1.06, 0.004, 0.158, 0.108, 0.112, 2.4],
    [1.14, 0.000, 0.160, 0.112, 0.112, 2.5],
    [1.22, -0.005, 0.166, 0.118, 0.110, 2.6],
    [1.30, -0.010, 0.172, 0.122, 0.108, 2.6],
    [1.37, -0.010, 0.177, 0.118, 0.106, 2.6],
    [1.43, -0.005, 0.172, 0.102, 0.100, 2.6],
    [1.475, 0.000, 0.148, 0.084, 0.088, 2.4],
    [1.51, 0.004, 0.096, 0.064, 0.068, 2.2],
    [1.54, 0.008, 0.064, 0.054, 0.054, 2.0],
  ];
  const tw = (y) => {
    const s1 = smooth(1.03, 1.15, y); const s2 = smooth(1.19, 1.33, y); const s3 = smooth(1.47, 1.55, y);
    return [pb, 1 - s1, sb, s1 * (1 - s2), cb, s2 * (1 - s3), nb, s3];
  };
  const use = hi ? torso : [torso[0], torso[2], torso[4], torso[6], torso[8], torso[9]];
  addLoft(B.camo, use.map(([y, cz, rx, rf, rb, n]) => ({ c: [0, y, cz], rx, rf, rb, n, w: tw(y) })), { seg });
  // trousers seat (camo)
  const seat = [
    [1.085, 0.004, 0.161, 0.107, 0.113, 2.4],
    [1.02, 0.004, 0.168, 0.110, 0.122, 2.4],
    [0.96, 0.006, 0.174, 0.110, 0.130, 2.5],
    [0.90, 0.010, 0.168, 0.100, 0.128, 2.5],
    [0.85, 0.012, 0.148, 0.084, 0.110, 2.4],
    [0.815, 0.012, 0.100, 0.060, 0.076, 2.2],
    [0.80, 0.012, 0.040, 0.030, 0.034, 2.0],
  ];
  const seatUse = hi ? seat : [seat[0], seat[2], seat[4], seat[6]];
  const trouserTint = mulCol(WHITE, 0.93);
  addLoft(B.camo, seatUse.map(([y, cz, rx, rf, rb, n]) => ({ c: [0, y, cz], rx, rf, rb, n, w: [pb, 1], col: trouserTint })), { seg, capEnd: true });
  // belt (closed padded band)
  const beltC = col(P.belt);
  const belt = [
    [1.032, 0.156, 0.104, 0.112], [1.032, 0.172, 0.120, 0.128], [1.088, 0.172, 0.120, 0.128], [1.088, 0.156, 0.104, 0.112], [1.032, 0.156, 0.104, 0.112],
  ];
  if (hi) addLoft(B.gear, belt.map(([y, rx, rf, rb]) => ({ c: [0, y, 0.004], rx, rf, rb, n: 2.5 })), { seg: 20, w: w1('pelvis'), col: beltC, tile: NYLON_TILE_M });
  addGeo(B.hard, chamferBox(0.052, 0.04, 0.012, 0.004), _mtx(0, 1.06, -0.126), col('#3a3a36'), w1('pelvis'));
  // plate carrier shell
  const carrierC = col(P.carrier);
  const sideDip = (a) => {
    const ca = Math.cos(a);
    const side = Math.abs(ca) ** 2.2;
    const sa = Math.sin(a);
    const front = sa < 0 ? 1 : 0;
    // shooter's cut on the front corners
    const corner = front * Math.exp(-(((Math.abs(ca) - 0.62) / 0.16) ** 2));
    return -0.125 * side - 0.035 * corner;
  };
  const carrier = [
    { y: 1.08, rx: 0.160, rf: 0.128, rb: 0.120, top: false },
    { y: 1.08, rx: 0.185, rf: 0.152, rb: 0.146, top: false },
    { y: 1.20, rx: 0.188, rf: 0.157, rb: 0.146, top: false },
    { y: 1.32, rx: 0.192, rf: 0.160, rb: 0.146, top: false },
    { y: 1.43, rx: 0.190, rf: 0.158, rb: 0.146, top: true },
    { y: 1.43, rx: 0.168, rf: 0.128, rb: 0.118, top: true },
  ];
  const cUse = hi ? carrier : [carrier[1], carrier[3], carrier[4]];
  const cw = (y) => (y < 1.15 ? [sb, 0.45, cb, 0.55] : [cb, 1]);
  addLoft(B.gear, cUse.map((r) => ({ c: [0, r.y, -0.006], rx: r.rx, rf: r.rf, rb: r.rb, n: 3.4, w: cw(r.y), top: r.top })), {
    seg: hi ? 28 : 12, col: carrierC, tile: NYLON_TILE_M,
    disp: (p, j, k, a) => { if (cUse[j].top) p.y += sideDip(a); },
  });
  // shoulder straps
  for (const s of hi ? [-1, 1] : []) {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const th = -Math.PI / 2 + (i / 6) * Math.PI;
      pts.push(new THREE.Vector3(s * 0.118, 1.418 + 0.118 * Math.cos(th), -0.004 + (th < 0 ? 0.158 : 0.150) * Math.sin(th)));
    }
    addSweep(B.gear, pts, { w: 0.058, h: 0.018, n: 3, widthAxis: X_AXIS, weights: w1('chest'), col: carrierC, tile: NYLON_TILE_M, seg: 6 });
  }
  const pouchC = col(P.pouch);
  const darkPouch = mulCol(pouchC, 0.82);
  const C = (name, m) => frameOf(name, false, m);
  // chest-local placement helper (chest bind origin at y = 1.28)
  const cy = (y) => y - 1.28;
  // mag pouches + magazines
  for (let i = -1; i <= 1; i++) {
    const x = i * 0.081;
    const yaw = -i * 0.12;
    const z = -0.172 + Math.abs(i) * 0.012;
    addGeo(B.gear, hi ? chamferBox(0.074, 0.125, 0.042, 0.008) : new THREE.BoxGeometry(0.074, 0.125, 0.042), C('chest', _mtx(x, cy(1.185), z - 0.021, 0, yaw, 0)), pouchC, w1('chest'));
    if (hi) {
      addGeo(B.gear, chamferBox(0.078, 0.022, 0.046, 0.005), C('chest', _mtx(x, cy(1.252), z - 0.021, 0.05, yaw, 0)), darkPouch, w1('chest'));
      addGeo(B.hard, chamferBox(0.06, 0.03, 0.022, 0.004), C('chest', _mtx(x, cy(1.262), z - 0.02, 0, yaw, 0)), col('#2b2a28'), w1('chest'));
    }
  }
  // admin pouch + team patch
  addGeo(B.gear, hi ? chamferBox(0.20, 0.10, 0.024, 0.006) : new THREE.BoxGeometry(0.2, 0.1, 0.024), C('chest', _mtx(0, cy(1.335), -0.176, -0.05, 0, 0)), pouchC, w1('chest'));
  addGeo(B.gear, new THREE.BoxGeometry(0.075, 0.045, 0.006), C('chest', _mtx(-0.05, cy(1.348), -0.19, -0.05, 0, 0)), col(L.teamColor), w1('chest'));
  if (hi) {
    // radio pouch, radio, antenna
    addGeo(B.gear, chamferBox(0.05, 0.13, 0.068, 0.007), C('chest', _mtx(-0.205, cy(1.25), 0.065, 0, 0.15, 0)), darkPouch, w1('chest'));
    addGeo(B.hard, chamferBox(0.042, 0.07, 0.056, 0.005), C('chest', _mtx(-0.205, cy(1.335), 0.065, 0, 0.15, 0)), col('#232421'), w1('chest'));
    addSweep(B.hard, curvePts([[-0.205, cy(1.37), 0.075], [-0.21, cy(1.47), 0.10], [-0.2, cy(1.58), 0.135], [-0.185, cy(1.68), 0.17]], 6), { r: 0.0042, frame: bindOf('chest'), weights: w1('chest'), col: col('#1d1e1c'), seg: 5 });
    // IFAK / utility pouch right side
    addGeo(B.gear, chamferBox(0.05, 0.10, 0.085, 0.007), C('chest', _mtx(0.205, cy(1.2), 0.04, 0, -0.1, 0)), darkPouch, w1('chest'));
    // MOLLE rows on the back panel
    for (let r = 0; r < 4; r++) {
      const y = 1.14 + r * 0.055;
      addGeo(B.gear, new THREE.BoxGeometry(0.26, 0.022, 0.006), _mtx(0, y, 0.148), mulCol(carrierC, 0.86), w1('chest'));
    }
    // drag handle
    addGeo(B.gear, chamferBox(0.08, 0.025, 0.02, 0.006), C('chest', _mtx(0, cy(1.41), 0.155, 0.3, 0, 0)), mulCol(carrierC, 0.8), w1('chest'));
  }
  // belt pouches
  const beltPouch = col(P.pouch);
  const bp = (gx, gy, gz, w, h, d, ry) => addGeo(B.gear, hi ? chamferBox(w, h, d, 0.007) : new THREE.BoxGeometry(w, h, d), _mtx(gx, gy, gz, 0, ry, 0), beltPouch, w1('pelvis'));
  bp(-0.105, 1.035, -0.125, 0.07, 0.11, 0.04, 0.35);
  bp(-0.165, 1.035, -0.07, 0.065, 0.11, 0.04, 0.95);
  bp(0.0, 1.04, 0.15, 0.17, 0.09, 0.05, 0);
  if (hi) {
    bp(-0.14, 1.0, 0.11, 0.09, 0.13, 0.05, -0.6);
    // holster + pistol grip on the right hip
    addGeo(B.gear, chamferBox(0.045, 0.17, 0.07, 0.008), _mtx(0.19, 0.985, 0.02, 0.12, 0, 0), mulCol(beltPouch, 0.85), w1('pelvis'));
    addGeo(B.hard, chamferBox(0.03, 0.05, 0.035, 0.005), _mtx(0.19, 1.085, 0.045, -0.35, 0, 0), col('#232321'), w1('pelvis'));
  }
  // back gear: assault pack or hydration carrier
  const packC = col(P.pack);
  if (L.pack === 1) {
    addGeo(B.gear, hi ? chamferBox(0.30, 0.42, 0.15, 0.03) : new THREE.BoxGeometry(0.3, 0.42, 0.15), C('chest', _mtx(0, cy(1.3), 0.232)), packC, w1('chest'));
    if (hi) {
      addGeo(B.gear, chamferBox(0.24, 0.20, 0.06, 0.02), C('chest', _mtx(0, cy(1.2), 0.33)), mulCol(packC, 0.92), w1('chest'));
      addGeo(B.gear, new THREE.BoxGeometry(0.06, 0.18, 0.1), C('chest', _mtx(-0.17, cy(1.24), 0.24)), mulCol(packC, 0.9), w1('chest'));
      addGeo(B.gear, new THREE.BoxGeometry(0.06, 0.18, 0.1), C('chest', _mtx(0.17, cy(1.24), 0.24)), mulCol(packC, 0.9), w1('chest'));
      for (const s of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 4; i++) {
          const th = -Math.PI * 0.45 + (i / 4) * Math.PI * 0.95;
          pts.push(new THREE.Vector3(s * 0.12, 1.418 + 0.135 * Math.cos(th), -0.004 + (th < 0 ? 0.176 : 0.168) * Math.sin(th)));
        }
        addSweep(B.gear, pts, { w: 0.05, h: 0.012, n: 3, widthAxis: X_AXIS, weights: w1('chest'), col: mulCol(packC, 0.85), seg: 4, tile: NYLON_TILE_M });
      }
    }
  } else if (L.pack === 2) {
    addGeo(B.gear, hi ? chamferBox(0.25, 0.32, 0.045, 0.012) : new THREE.BoxGeometry(0.25, 0.32, 0.045), C('chest', _mtx(0, cy(1.27), 0.172)), mulCol(carrierC, 0.95), w1('chest'));
  }
}

function buildArm(B, L, hi, side) {
  const s = side === 'R' ? 1 : -1;
  const mirror = s < 0;
  const ub = BI['upperArm' + side]; const fb = BI['foreArm' + side]; const cb = BI['clavicle' + side];
  const hb = BI['hand' + side];
  // sleeve rings along the upper arm's local −Y (t = −y). [t, rx, rf, rb]
  const rings = [
    [-0.075, 0.022, 0.022, 0.022],
    [-0.066, 0.042, 0.042, 0.042],
    [-0.048, 0.056, 0.057, 0.057],
    [-0.02, 0.064, 0.064, 0.064],
    [0.015, 0.066, 0.066, 0.063],
    [0.06, 0.062, 0.062, 0.059],
    [0.12, 0.056, 0.058, 0.055],
    [0.2, 0.053, 0.056, 0.052],
    [0.27, 0.05, 0.052, 0.05],
    [0.315, 0.048, 0.05, 0.05],
    [0.355, 0.05, 0.05, 0.051],
    [0.41, 0.05, 0.048, 0.049],
    [0.5, 0.044, 0.042, 0.042],
    [0.565, 0.041, 0.038, 0.038],
    [0.6, 0.037, 0.034, 0.034],
  ];
  const use = hi ? rings : [rings[1], rings[3], rings[5], rings[7], rings[9], rings[11], rings[13], rings[14]];
  const wt = (t) => {
    const s1 = smooth(-0.05, 0.05, t); const s2 = smooth(0.275, 0.36, t);
    return [cb, 1 - s1, ub, s1 * (1 - s2), fb, s2];
  };
  addLoft(B.camo, use.map(([t, rx, rf, rb]) => ({ c: [0, -t, 0], rx, rf, rb, w: wt(t) })), {
    frame: frameOf('upperArm' + side, mirror), seg: hi ? 14 : 7, capStart: true,
  });
  // armband (team colour) + shoulder patch
  const band = [[0.085, 0.0575], [0.085, 0.0605], [0.14, 0.0585], [0.14, 0.0555]];
  addLoft(B.gear, band.map(([t, r]) => ({ c: [0, -t, 0], rx: r, rf: r + 0.002, rb: r - 0.001 })), {
    frame: frameOf('upperArm' + side, mirror), seg: hi ? 14 : 7, w: [ub, 1], col: col(L.teamColor), tile: NYLON_TILE_M,
  });
  if (hi) {
    addGeo(B.gear, new THREE.BoxGeometry(0.004, 0.05, 0.06), frameOf('upperArm' + side, mirror, _mtx(0.0645, -0.035, 0, 0, 0, 0)), col(L.palette.strap), w1('upperArm' + side));
  }
  // glove: palm/back loft along the hand's −Y
  const gl = col(L.palette.glove);
  const palm = [
    [0.036, 0.0, 0.041, 0.035, 0.035],
    [-0.004, 0.0, 0.041, 0.031, 0.031],
    [-0.016, 0.003, 0.038, 0.023, 0.021],
    [-0.045, 0.006, 0.045, 0.021, 0.018],
    [-0.075, 0.002, 0.046, 0.018, 0.016],
    [-0.096, 0.0, 0.043, 0.015, 0.014],
    [-0.104, 0.0, 0.034, 0.010, 0.010],
  ];
  const pUse = hi ? palm : [palm[0], palm[2], palm[4], palm[6]];
  addLoft(B.gear, pUse.map(([y, cx, rx, rf, rb]) => ({ c: [cx, y, 0], rx, rf, rb, w: y > 0.02 ? [hb, 0.6, fb, 0.4] : [hb, 1] })), {
    frame: frameOf('hand' + side, mirror), seg: hi ? 10 : 5, col: gl, tile: NYLON_TILE_M, capEnd: true, capStart: true,
  });
  const fingerSweep = (bone, pts, w, h) => addSweep(B.gear, pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), {
    w, h, n: 2.4, widthAxis: X_AXIS, frame: frameOf(bone + side, mirror), weights: w1(bone + side), col: gl, seg: hi ? 6 : 4, tile: NYLON_TILE_M,
  });
  fingerSweep('fingers', [[0, 0.004, 0], [0, -0.03, 0], [0, -0.05, -0.008], [0, -0.06, -0.026], [0, -0.058, -0.042]], 0.05, 0.02);
  fingerSweep('index', [[0, 0.004, 0], [0, -0.035, 0], [0, -0.06, -0.006], [0, -0.072, -0.018]], 0.019, 0.019);
  fingerSweep('thumb', [[0, 0.0, 0], [0.006, -0.022, -0.008], [0.008, -0.042, -0.016], [0.006, -0.054, -0.02]], 0.02, 0.019);
}

function buildLeg(B, L, hi, side) {
  const s = side === 'R' ? 1 : -1;
  const mirror = s < 0;
  const pb = BI.pelvis; const tb = BI['thigh' + side]; const sb = BI['shin' + side]; const fb = BI['foot' + side];
  const P = L.palette;
  // trousers along the thigh's −Y: [t, cx, rx, rf, rb]
  const rings = [
    [-0.09, -0.012, 0.074, 0.08, 0.09],
    [-0.04, -0.004, 0.088, 0.09, 0.1],
    [0.02, 0.004, 0.093, 0.09, 0.099],
    [0.1, 0.004, 0.088, 0.084, 0.09],
    [0.2, 0.002, 0.08, 0.078, 0.08],
    [0.3, 0.0, 0.072, 0.072, 0.07],
    [0.38, 0.0, 0.066, 0.068, 0.064],
    [0.43, 0.0, 0.064, 0.066, 0.062],
    [0.48, 0.0, 0.063, 0.061, 0.064],
    [0.56, 0.0, 0.062, 0.057, 0.068],
    [0.7, 0.0, 0.057, 0.052, 0.057],
    [0.82, 0.0, 0.055, 0.051, 0.053],
    [0.865, 0.0, 0.05, 0.048, 0.048],
  ];
  const use = hi ? rings : [rings[0], rings[2], rings[4], rings[6], rings[8], rings[9], rings[11], rings[12]];
  const wt = (t) => {
    const s1 = smooth(-0.1, 0.05, t); const s2 = smooth(0.385, 0.475, t);
    return [pb, 1 - s1, tb, s1 * (1 - s2), sb, s2];
  };
  const tint = mulCol(WHITE, 0.93);
  addLoft(B.camo, use.map(([t, cx, rx, rf, rb]) => ({ c: [cx, -t, 0], rx, rf, rb, w: wt(t), col: tint })), {
    frame: frameOf('thigh' + side, mirror), seg: hi ? 14 : 7,
  });
  if (hi) {
    // cargo pocket
    addGeo(B.camo, chamferBox(0.03, 0.16, 0.12, 0.01), frameOf('thigh' + side, mirror, _mtx(0.084, -0.2, -0.012, 0, 0, 0.06)), mulCol(WHITE, 0.88), w1('thigh' + side), { box: 1 / CAMO_TILE_M });
  }
  // knee pad
  const padM = frameOf('shin' + side, mirror, _mtx(0, -0.015, -0.058, -Math.PI / 2 + 0.1, 0, 0, 0.052, 0.034, 0.068));
  addGeo(B.hard, new THREE.SphereGeometry(1, hi ? 8 : 5, hi ? 4 : 2, 0, TAU, 0, Math.PI / 2), padM, col(P.pad), w1('shin' + side));
  if (hi) {
    addLoft(B.gear, [[0.03, 0.066], [0.03, 0.069], [0.055, 0.068], [0.055, 0.065]].map(([t, r]) => ({ c: [0, -t, 0.004], rx: r, rf: r, rb: r })), {
      frame: frameOf('shin' + side, mirror), seg: 12, w: [sb, 1], col: col(P.strap), tile: NYLON_TILE_M,
    });
  }
  // boot: foot part along −Z (ring axes X / Y), [z, cy, rx, ryBottom, ryTop, n]
  const bootC = col(P.boot);
  const lace = mulCol(bootC, 0.6);
  const boot = [
    [0.083, -0.06, 0.02, 0.025, 0.02, 2.4],
    [0.075, -0.05, 0.04, 0.05, 0.05, 3.0],
    [0.045, -0.04, 0.047, 0.06, 0.06, 3.0],
    [0.0, -0.04, 0.05, 0.06, 0.068, 3.0],
    [-0.05, -0.05, 0.052, 0.05, 0.056, 3.0],
    [-0.1, -0.064, 0.054, 0.036, 0.046, 3.0],
    [-0.15, -0.072, 0.05, 0.028, 0.036, 3.0],
    [-0.19, -0.075, 0.04, 0.025, 0.028, 2.8],
    [-0.212, -0.078, 0.024, 0.02, 0.02, 2.5],
  ];
  const bUse = hi ? boot : [boot[1], boot[3], boot[5], boot[7], boot[8]];
  addLoft(B.gear, bUse.map(([z, cy, rx, rb0, rt, n]) => ({ c: [0, cy, z], rx, rf: rb0, rb: rt, n, az: Y_AXIS })), {
    frame: frameOf('foot' + side, mirror), seg: hi ? 12 : 6, a0: -Math.PI / 2, w: [fb, 1], capEnd: true, capStart: true, tile: NYLON_TILE_M,
    colFn: (p, n, j) => bootC,
  });
  // shaft
  const shaftAll = [[-0.06, 0.058], [0.0, 0.06], [0.05, 0.058], [0.09, 0.06], [0.1, 0.062], [0.1, 0.05]];
  const shaft = hi ? shaftAll : [shaftAll[0], shaftAll[3], shaftAll[5]];
  addLoft(B.gear, shaft.map(([y, r], j) => ({ c: [0, y, 0.008], rx: r, rf: r + 0.004, rb: r, w: y > 0.03 ? [fb, 0.35, sb, 0.65] : [fb, 1], col: j >= 4 ? mulCol(bootC, 0.8) : bootC })), {
    frame: frameOf('foot' + side, mirror), seg: hi ? 12 : 6, tile: NYLON_TILE_M,
  });
  if (hi) {
    addGeo(B.gear, new THREE.BoxGeometry(0.022, 0.12, 0.01), frameOf('foot' + side, mirror, _mtx(0, -0.01, -0.06, -0.75, 0, 0)), lace, w1('foot' + side));
  }
  // sole
  const solePts = [[0.085, 0.034], [0.06, 0.05], [0.0, 0.054], [-0.08, 0.058], [-0.15, 0.054], [-0.2, 0.04], [-0.222, 0.018]];
  const sole = [];
  for (const [z, r] of solePts) sole.push({ c: [0, -0.094, z], rx: r, rf: 0.008, rb: 0.008, n: 3, az: Y_AXIS });
  if (hi) addLoft(B.hard, [sole[0], sole[1], sole[3], sole[5], sole[6]], { frame: frameOf('foot' + side, mirror), seg: 8, a0: -Math.PI / 2, w: [fb, 1], col: col(P.sole), capStart: true, capEnd: true });
}

/** Helmet / boonie, headset, eyewear. Coordinates in head space. */
function buildHeadgear(B, L, hi) {
  const P = L.palette;
  const hb = w1('head');
  const F = (m) => frameOf('head', false, m);
  const comm = col(P.comm);
  if (L.headgear === 'helmet') {
    const HC = new THREE.Vector3(0, 0.064, 0.008);
    const R = { x: 0.11, y: 0.135, f: 0.121, b: 0.128 };
    const rimTab = [[0, 78], [40, 80], [68, 74], [92, 63], [118, 82], [150, 96], [180, 101]];
    const rim = (phi) => {
      let a = Math.abs(((phi / DEG + 180) % 360) - 180);
      for (let i = 0; i < rimTab.length - 1; i++) {
        const [a0, t0] = rimTab[i]; const [a1, t1] = rimTab[i + 1];
        if (a <= a1) { const u = (a - a0) / (a1 - a0); return lerp(t0, t1, u * u * (3 - 2 * u)) * DEG; }
      }
      return 101 * DEG;
    };
    const surf = (phi, th, off = 0) => {
      const dx = Math.sin(th) * Math.sin(phi); const dy = Math.cos(th); const dz = -Math.sin(th) * Math.cos(phi);
      return new THREE.Vector3(HC.x + dx * (R.x + off), HC.y + dy * (R.y + off), HC.z + dz * ((dz < 0 ? R.f : R.b) + off));
    };
    const NC = hi ? 24 : 12; const NR = hi ? 8 : 4;
    const rows = [];
    const rowsIn = [];
    const centers = [];
    for (let r = 1; r <= NR; r++) {
      const row = []; const rowIn = [];
      for (let c = 0; c < NC; c++) {
        const phi = (c / NC) * TAU;
        const th = rim(phi) * (r / NR);
        row.push(surf(phi, th));
        rowIn.push(surf(phi, th, -0.012));
      }
      rows.push(row); rowsIn.push(rowIn);
    }
    const toModel = (row) => row.map((p) => p.clone().applyMatrix4(bindOf('head')));
    const top = surf(0, 0).applyMatrix4(bindOf('head'));
    const shellRows = [new Array(NC).fill(0).map(() => top.clone()), ...rows.map(toModel)];
    for (let i = 0; i < shellRows.length; i++) centers.push(new THREE.Vector3(HC.x, HC.y + 0.04 - i * 0.004, HC.z).applyMatrix4(bindOf('head')));
    const shellMat = L.cover ? B.camo : B.hard;
    const shellCol = L.cover ? mulCol(WHITE, 0.95) : col(P.helmet);
    addGrid(shellMat, shellRows, {
      centers, w: hb, col: shellCol, sign: 0,
      uv: (j, u) => [u * 3, (j / NR) * 0.42 / CAMO_TILE_M],
    });
    // rim lip + inner shell
    const lipRows = [toModel(rows[NR - 1]), toModel(rowsIn[NR - 1])];
    const lipC = [centers[NR], centers[NR]];
    addGrid(B.hard, lipRows, { centers: lipC, w: hb, col: mulCol(shellCol.clone(), L.cover ? 0.35 : 0.8) });
    if (hi) {
      const innerRows = [toModel(rowsIn[NR - 1]), toModel(rowsIn[Math.floor(NR * 0.6)]), toModel(rowsIn[Math.floor(NR * 0.25)])];
      addGrid(B.hard, innerRows, { centers: [centers[NR], centers[5], centers[2]], w: hb, col: col('#1d1d1b'), inward: true });
      // side rails
      for (const sd of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 6; i++) {
          const phi = sd * (58 + i * 11) * DEG;
          pts.push(surf(phi, rim(phi) - 9 * DEG, 0.004));
        }
        addSweep(B.hard, pts, { w: 0.018, h: 0.007, n: 4, frame: bindOf('head'), up: pts[3].clone().sub(HC).normalize(), weights: hb, col: col(P.helmet).multiplyScalar(0.75), seg: 4 });
      }
      // NVG shroud
      const sp = surf(0, 63 * DEG, 0.004);
      const nq = new THREE.Matrix4().lookAt(sp, HC, Y_AXIS);
      const shroudM = new THREE.Matrix4().makeTranslation(sp.x, sp.y, sp.z).multiply(new THREE.Matrix4().extractRotation(nq));
      addGeo(B.hard, chamferBox(0.052, 0.04, 0.012, 0.004), F(shroudM), col('#222320'), hb);
      if (L.nvg) {
        const base = new THREE.Matrix4().makeTranslation(0, 0.168, -0.086).multiply(new THREE.Matrix4().makeRotationX(0.9));
        addGeo(B.hard, chamferBox(0.03, 0.03, 0.05, 0.006), F(base), col('#20221f'), hb);
        for (const sd of [-1, 1]) {
          addGeo(B.hard, new THREE.CylinderGeometry(0.0175, 0.016, 0.075, 8), F(base.clone().multiply(_mtx(sd * 0.024, 0.0, -0.01, 0, 0, 0))), col('#262823'), hb);
        }
      }
      // counterweight / battery pouch
      const cp = surf(Math.PI, 70 * DEG, 0.018);
      const cq = new THREE.Matrix4().lookAt(cp, HC, Y_AXIS);
      addGeo(B.gear, chamferBox(0.075, 0.05, 0.026, 0.008), F(new THREE.Matrix4().makeTranslation(cp.x, cp.y, cp.z).multiply(new THREE.Matrix4().extractRotation(cq))), col(P.pouch), hb);
      // velcro patch on top (team colour, small)
      const tp = surf(Math.PI, 28 * DEG, 0.002);
      const tq = new THREE.Matrix4().lookAt(tp, HC, Y_AXIS);
      addGeo(B.gear, new THREE.BoxGeometry(0.06, 0.04, 0.004), F(new THREE.Matrix4().makeTranslation(tp.x, tp.y, tp.z).multiply(new THREE.Matrix4().extractRotation(tq))), col(L.teamColor), hb);
      // chin strap
      const strap = curvePts([[0.098, 0.04, 0.012], [0.075, -0.02, -0.01], [0.05, -0.062, -0.04], [0.0, -0.08, -0.055], [-0.05, -0.062, -0.04], [-0.075, -0.02, -0.01], [-0.098, 0.04, 0.012]], 9);
      addSweep(B.gear, strap, { w: 0.016, h: 0.004, n: 4, widthAxis: Z_AXIS, frame: bindOf('head'), weights: hb, col: col('#22221f'), seg: 4, caps: false });
    }
  } else {
    // boonie hat (camo)
    const crown = [[0.062, 0.104, 0.112, 0.118], [0.1, 0.1, 0.106, 0.112], [0.14, 0.094, 0.1, 0.104], [0.168, 0.08, 0.084, 0.09], [0.184, 0.05, 0.052, 0.056], [0.19, 0.01, 0.01, 0.012]];
    addLoft(B.camo, crown.map(([y, rx, rf, rb]) => ({ c: [0, y, 0.006], rx, rf, rb })), { frame: bindOf('head'), seg: hi ? 20 : 10, w: hb, capEnd: true });
    const brim = [[0.068, 0.104, 0.112, 0.118], [0.066, 0.165, 0.17, 0.168], [0.044, 0.178, 0.182, 0.178], [0.038, 0.176, 0.18, 0.176], [0.06, 0.16, 0.165, 0.162], [0.064, 0.102, 0.11, 0.116]];
    addLoft(B.camo, brim.map(([y, rx, rf, rb]) => ({ c: [0, y, 0.006], rx, rf, rb })), { frame: bindOf('head'), seg: hi ? 24 : 10, w: hb });
    addLoft(B.gear, [[0.064, 0.106], [0.064, 0.108], [0.09, 0.104], [0.09, 0.102]].map(([y, r]) => ({ c: [0, y, 0.006], rx: r, rf: r + 0.008, rb: r + 0.013 })), { frame: bindOf('head'), seg: hi ? 20 : 10, w: hb, col: col(P.strap), tile: NYLON_TILE_M });
  }
  // headset (ear cups + neckband + boom mic)
  for (const sd of [-1, 1]) {
    addGeo(B.hard, new THREE.CylinderGeometry(0.039, 0.041, 0.034, hi ? 16 : 8), F(_mtx(sd * 0.094, 0.03, 0.01, 0, 0, Math.PI / 2)), comm, hb);
    if (hi) addGeo(B.hard, new THREE.CylinderGeometry(0.03, 0.034, 0.012, 12), F(_mtx(sd * 0.114, 0.03, 0.01, 0, 0, Math.PI / 2)), mulCol(comm, 1.4), hb);
  }
  if (hi) {
    addSweep(B.hard, curvePts([[0.094, 0.0, 0.03], [0.07, -0.02, 0.085], [0.0, -0.03, 0.112], [-0.07, -0.02, 0.085], [-0.094, 0.0, 0.03]], 7), { w: 0.014, h: 0.006, n: 3, up: Y_AXIS, frame: bindOf('head'), weights: hb, col: comm, seg: 4 });
    addSweep(B.hard, curvePts([[0.1, 0.012, -0.012], [0.085, -0.012, -0.065], [0.045, -0.03, -0.1]], 5), { r: 0.003, frame: bindOf('head'), weights: hb, col: comm, seg: 4 });
    if (L.eyewear) {
      const lens = curvePts([[-0.07, 0.044, -0.07], [-0.04, 0.046, -0.098], [0, 0.044, -0.104], [0.04, 0.046, -0.098], [0.07, 0.044, -0.07]], 7);
      addSweep(B.hard, lens, { w: 0.003, h: 0.034, n: 3, up: Y_AXIS, frame: bindOf('head'), weights: hb, col: col('#121314'), seg: 4 });
      for (const sd of [-1, 1]) {
        addSweep(B.hard, [new THREE.Vector3(sd * 0.072, 0.052, -0.068), new THREE.Vector3(sd * 0.082, 0.05, -0.02), new THREE.Vector3(sd * 0.08, 0.045, 0.01)], { r: 0.003, frame: bindOf('head'), weights: hb, col: col('#1a1a1a'), seg: 4 });
      }
    }
  }
}

const _geoCache = new Map();

function lookKey(L, lod) {
  return [lod, L.headgear, L.cover, L.nvg, L.eyewear, L.pack, L.gear, L.teamColor, L.palette.carrier].join('|');
}

/** Builds (or returns cached) per-material skinned geometries for a look. */
function soldierGeometry(L, lod) {
  const key = lookKey(L, lod);
  let g = _geoCache.get(key);
  if (g) return g;
  const hi = lod !== 'low';
  const B = { camo: new Acc(), gear: new Acc(), skin: new Acc(), hard: new Acc() };
  buildHead(B, L, hi);
  buildHeadgear(B, L, hi);
  buildTorso(B, L, hi);
  for (const side of ['L', 'R']) { buildArm(B, L, hi, side); buildLeg(B, L, hi, side); }
  g = {};
  for (const k of MAT_KEYS) g[k] = B[k].geometry();
  _geoCache.set(key, g);
  return g;
}

// ================================================================== animation helpers

/** Blendable pose description (positions in root space, local Euler angles 'YXZ'). */
class Pose {
  constructor() {
    this.pelvis = new THREE.Vector3();
    this.pelvisRot = new THREE.Vector3();
    this.spine = new THREE.Vector3();
    this.chest = new THREE.Vector3();
    this.neck = new THREE.Vector3();
    this.foot = [new THREE.Vector3(), new THREE.Vector3()];
    this.footRot = [new THREE.Vector3(), new THREE.Vector3()];
    this.knee = [new THREE.Vector3(), new THREE.Vector3()];
    this.clav = [new THREE.Vector3(), new THREE.Vector3()];
    this.pitchMin = -1.4;
    this.pitchMax = 1.4;
    this.bodyPitch = 0; // how much of the aim pitch the spine/chest take
    this.reach = 1; // 1 = apply pelvis drop to keep stance feet reachable
  }

  zero() {
    for (const k of ['pelvis', 'pelvisRot', 'spine', 'chest', 'neck']) this[k].set(0, 0, 0);
    for (let i = 0; i < 2; i++) { this.foot[i].set(0, 0, 0); this.footRot[i].set(0, 0, 0); this.knee[i].set(0, 0, 0); this.clav[i].set(0, 0, 0); }
    this.pitchMin = 0; this.pitchMax = 0; this.bodyPitch = 0; this.reach = 0;
    return this;
  }

  addScaled(p, w) {
    for (const k of ['pelvis', 'pelvisRot', 'spine', 'chest', 'neck']) this[k].addScaledVector(p[k], w);
    for (let i = 0; i < 2; i++) {
      this.foot[i].addScaledVector(p.foot[i], w); this.footRot[i].addScaledVector(p.footRot[i], w);
      this.knee[i].addScaledVector(p.knee[i], w); this.clav[i].addScaledVector(p.clav[i], w);
    }
    this.pitchMin += p.pitchMin * w; this.pitchMax += p.pitchMax * w; this.bodyPitch += p.bodyPitch * w; this.reach += p.reach * w;
    return this;
  }
}

class Spring {
  constructor(omega, zeta) { this.x = 0; this.v = 0; this.w = omega; this.z = zeta; }
  step(dt) {
    // semi-implicit Euler, sub-stepped for stability
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.w * this.w * this.x - 2 * this.z * this.w * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  reset() { this.x = 0; this.v = 0; }
}

// scratch objects (module level, shared by all instances; no per-frame allocation)
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _end = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const IDENTITY = new THREE.Matrix4();

const qEuler = (out, x, y, z) => out.setFromEuler(_e.set(x, y, z, 'YXZ'));

/** Hand frames relative to the weapon frame (−Z bore, +Y up). */
const HAND_TP = {
  // right hand on a vertical pistol grip: fingers forward/down, palm facing left
  rightQ: handRotation(new THREE.Vector3(0, -0.36, -0.93), new THREE.Vector3(-1, 0, 0), new THREE.Quaternion()),
  rightGrip: new THREE.Vector3(0.004, -0.074, -0.024),
  // support hand under/at the left side of the handguard
  leftQ: handRotation(new THREE.Vector3(0.62, 0.12, -0.78), new THREE.Vector3(-0.15, 0.97, 0.15), new THREE.Quaternion()),
  leftGrip: new THREE.Vector3(-0.004, -0.07, -0.03),
  // left hand gripping a magazine (palm toward +X, fingers forward/up)
  magQ: handRotation(new THREE.Vector3(0.1, 0.35, -0.93), new THREE.Vector3(1, 0, 0), new THREE.Quaternion()),
  // pistol support hand wrapping the shooting hand
  pistolLeftQ: handRotation(new THREE.Vector3(0.45, -0.5, -0.74), new THREE.Vector3(0.9, 0.0, -0.3), new THREE.Quaternion()),
};

let _instance = 0;

/** Bounding box of a weapon's meshes in the weapon root's space (attach time only). */
function weaponBox(root) {
  const box = new THREE.Box3();
  const inv = new THREE.Matrix4();
  root.updateWorldMatrix(true, true);
  inv.copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.name === 'reticle' || o.name === 'lens') return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    m.multiplyMatrices(inv, o.matrixWorld);
    box.union(o.geometry.boundingBox.clone().applyMatrix4(m));
  });
  return box.isEmpty() ? null : box;
}

// ================================================================== SoldierModel

/**
 * Third-person soldier: skinned procedural body with procedural animation.
 */
export class SoldierModel {
  /**
   * @param {{team?: number, variant?: number, lod?: 'high'|'low'}} [opts]
   */
  constructor({ team = 0, variant = 0, lod = 'high' } = {}) {
    this.team = team;
    this.variant = variant;
    this.lod = lod === 'low' ? 'low' : 'high';
    this.look = decodeLook(team, variant);
    /** Root group: feet at the origin, facing −Z. */
    this.root = new THREE.Group();
    this.root.name = `soldier:${team}:${variant}`;
    this._seed = (variant * 97 + (_instance++) * 13) % 1000;

    // bones
    const defs = TP_RIG.defs;
    this.bones = [];
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      const b = new THREE.Bone();
      b.name = d.name;
      b.position.fromArray(d.pos);
      b.quaternion.copy(TP_RIG.localQ[i]);
      this.bones.push(b);
      if (d.parent) this.bones[BI[d.parent]].add(b); else this.root.add(b);
    }
    this._bonePos0 = defs.map((d) => new THREE.Vector3().fromArray(d.pos));
    this.skeleton = new THREE.Skeleton(this.bones, TP_RIG.bindInv.map((m) => m.clone()));

    // meshes
    this.meshes = [];
    this._sphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 2.0);
    const mats = soldierMaterials(this.look);
    const geos = soldierGeometry(this.look, this.lod);
    for (const k of MAT_KEYS) {
      if (!geos[k]) continue;
      const m = new THREE.SkinnedMesh(geos[k], mats[k]);
      m.name = `soldier-${k}`;
      m.bind(this.skeleton, IDENTITY);
      m.boundingSphere = this._sphere;
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
      this.meshes.push(m);
    }

    // weapon socket (root space, placed every update)
    this.weaponSocket = new THREE.Group();
    this.weaponSocket.name = 'weaponSocket';
    this.root.add(this.weaponSocket);
    this.weapon = null;
    this._w = {
      rh: new THREE.Vector3(), lh: new THREE.Vector3(), lhQ: new THREE.Quaternion(), rhQ: new THREE.Quaternion(),
      sight: new THREE.Vector3(0, 0.12, 0.05), mag: new THREE.Vector3(0, -0.07, -0.07), butt: new THREE.Vector3(0, 0.035, 0.27),
      pistol: false, hasLeft: false,
    };

    // root-space FK caches
    this._rq = this.bones.map(() => new THREE.Quaternion());
    this._rp = this.bones.map(() => new THREE.Vector3());

    // animation state
    this._poses = [new Pose(), new Pose(), new Pose(), new Pose()];
    this._pose = new Pose();
    this._gaitO = { restX: [0, 0], restZ: [0, 0] };
    this._wpos = new THREE.Vector3();
    this._wq = new THREE.Quaternion();
    this._st = {
      vx: 0, vz: 0, speed: 0, dirX: 0, dirZ: -1, hipYaw: 0,
      wS: 1, wC: 0, wP: 0, sprint: 0, ads: 0, lean: 0, air: 0, reload: 0, pitch: 0, vy: 0,
      phase: 0, crawl: 0, time: this._seed * 0.37, reloadT: 0, wasReloading: false, airTime: 0, wasGrounded: true,
      cad: 1.6, cycle: 0, stepLen: 0,
    };
    this._recoil = new Spring(30, 0.72);
    this._flP = new Spring(15, 0.45);
    this._flR = new Spring(15, 0.45);
    this._flY = new Spring(13, 0.5);
    this._land = new Spring(13, 0.62);
    this._snap = true;
    this._dead = false;
    this._death = null;
    this._lastS = null;
    this.update(0, DEFAULT_STATE);
    this._snap = true;
  }

  // ---------------------------------------------------------------- public API

  /**
   * Attach a weapon model ({ root, anchors }) so anchors.rightHand sits in the right hand and the
   * left hand reaches anchors.leftHand. Replaces (does not dispose) any previous weapon; null = unarmed.
   */
  attachWeapon(weaponModel) {
    if (this.weapon && this.weapon.root.parent === this.weaponSocket) this.weaponSocket.remove(this.weapon.root);
    this.weapon = weaponModel || null;
    if (!this.weapon) return;
    const root = this.weapon.root;
    const A = this.weapon.anchors || {};
    const rel = (obj, outP, outQ) => {
      if (!obj || !obj.isObject3D) return false;
      _m1.identity();
      const chain = [];
      let o = obj;
      while (o && o !== root) { chain.push(o); o = o.parent; }
      if (o !== root) return false;
      for (let i = chain.length - 1; i >= 0; i--) { chain[i].updateMatrix(); _m1.multiply(chain[i].matrix); }
      _m1.decompose(outP, outQ || _q4, _v6);
      return true;
    };
    const W = this._w;
    if (!rel(A.rightHand, W.rh, W.rhQ)) { W.rh.set(0, 0, 0); W.rhQ.identity(); }
    W.hasLeft = rel(A.leftHand, W.lh, W.lhQ);
    if (!W.hasLeft) { W.lh.set(0, 0.03, -0.28); W.lhQ.identity(); }
    W.lh.sub(W.rh);
    if (!rel(A.sight, W.sight)) W.sight.set(0, 0.12, 0.05); else W.sight.sub(W.rh);
    if (!rel(A.magazine || A.mag, W.mag)) W.mag.set(0, -0.07, -0.07); else W.mag.sub(W.rh);
    if (!rel(A.stock || A.butt || A.shoulder || A.buttstock, W.butt)) {
      // no stock anchor: rear-most point of the gun geometry, at bore height
      const box = weaponBox(root);
      const boreY = rel(A.muzzle, _v1) ? _v1.y : W.rh.y + 0.05;
      if (box) W.butt.set(0, boreY - 0.025 - W.rh.y, box.max.z - 0.012 - W.rh.z); else W.butt.set(0, 0.035, 0.27);
    } else W.butt.sub(W.rh);
    W.pistol = !W.hasLeft || W.lh.length() < 0.13;
    if (W.pistol && !rel(A.stock || A.butt, _v1)) W.butt.set(0, 0.03, 0.12);
    root.position.copy(W.rh).negate();
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
    this.weaponSocket.add(root);
  }

  /**
   * Advance the procedural animation.
   * @param {number} dt seconds
   * @param {object} s { velocity, yaw, pitch, stance, sprinting, ads, grounded, lean, reloading, firing, alive }
   */
  update(dt, s = DEFAULT_STATE) {
    dt = clamp(dt || 0, 0, 0.1);
    this._lastS = s;
    if (this._dead) {
      this._updateDeath(dt);
      this.root.updateMatrixWorld(true);
      return;
    }
    if (s.alive === false) {
      this.playDeath(null);
      this._updateDeath(dt);
      this.root.updateMatrixWorld(true);
      return;
    }
    this._inputs(dt, s);
    this._buildPose();
    this._applyPose(dt, s);
    this.root.updateMatrixWorld(true);
  }

  /**
   * Procedural death collapse; `fromDir` = world direction the killing shot travelled.
   * @param {THREE.Vector3|null} fromDir
   */
  playDeath(fromDir) {
    if (this._dead) return;
    this._dead = true;
    const d = this._death || (this._death = {
      t: 0, q0: this.bones.map(() => new THREE.Quaternion()), q1: this.bones.map(() => new THREE.Quaternion()),
      p0: new THREE.Vector3(), p1: new THREE.Vector3(), r0: new THREE.Quaternion(), r1: new THREE.Quaternion(),
      w0: new THREE.Vector3(), wq0: new THREE.Quaternion(), wq1: new THREE.Quaternion(), wv: new THREE.Vector3(), wp: new THREE.Vector3(),
      wq: new THREE.Quaternion(), dir: new THREE.Vector3(), lift: 0, landed: false, wLanded: false, count: 0,
    });
    d.count++;
    d.t = 0; d.lift = 0; d.landed = false; d.wLanded = false;
    for (let i = 0; i < this.bones.length; i++) d.q0[i].copy(this.bones[i].quaternion);
    d.p0.copy(this.bones[0].position);
    d.r0.copy(this.bones[0].quaternion);
    d.w0.copy(this.weaponSocket.position);
    d.wq0.copy(this.weaponSocket.quaternion);
    // fall direction in local space
    const dir = d.dir;
    if (fromDir && fromDir.lengthSq() > 1e-8) {
      this.root.getWorldQuaternion(_q1).invert();
      dir.copy(fromDir).applyQuaternion(_q1);
    } else dir.set(0, 0, 1);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const r = rng(this._seed * 31 + d.count * 7 + 3);
    let supine = dir.z > 0.25 ? true : dir.z < -0.25 ? false : r() < 0.5;
    if (this._st.wP > 0.5) supine = false;
    this._deathPose(d, dir, supine, r);
  }

  /** Back to the alive idle pose (respawn). */
  reset() {
    this._dead = false;
    if (this.weapon && this.weapon.root.parent !== this.weaponSocket) this.weaponSocket.add(this.weapon.root);
    this._recoil.reset(); this._flP.reset(); this._flR.reset(); this._flY.reset(); this._land.reset();
    const st = this._st;
    st.reloadT = 0; st.phase = 0; st.crawl = 0; st.airTime = 0; st.wasGrounded = true;
    this._snap = true;
    this.update(0, this._lastS || DEFAULT_STATE);
    this._snap = true;
  }

  /** Small hit reaction; `dir` = world direction the bullet travelled. */
  flinch(dir) {
    if (this._dead) return;
    this.root.getWorldQuaternion(_q1).invert();
    _v1.copy(dir || Z_AXIS).applyQuaternion(_q1);
    _v1.y = 0;
    if (_v1.lengthSq() > 1e-8) _v1.normalize();
    const k = 4.2;
    this._flP.v += _v1.z * k;
    this._flR.v += -_v1.x * k;
    this._flY.v += (frac(Math.sin(this._st.time * 91.7) * 43758.5) - 0.5) * k * 0.8;
  }

  setVisible(v) { this.root.visible = !!v; }

  /** World position of the head centre (nameplates are usually placed ~0.3 m above). */
  getHeadWorldPosition(target) {
    const h = this.bones[BI.head];
    h.updateWorldMatrix(true, false);
    return target.copy(HEAD_CENTER).applyMatrix4(h.matrixWorld);
  }

  /** Swap level of detail at runtime ('high' | 'low'); geometry is cached so this is cheap. */
  setLod(lod) {
    const l = lod === 'low' ? 'low' : 'high';
    if (l === this.lod) return;
    this.lod = l;
    const geos = soldierGeometry(this.look, l);
    for (const m of this.meshes) {
      const k = m.name.slice(8);
      if (geos[k]) m.geometry = geos[k];
    }
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    if (this.weapon && this.weapon.root.parent === this.weaponSocket) this.weaponSocket.remove(this.weapon.root);
    this.skeleton.dispose();
    this.meshes.length = 0;
  }

  // ---------------------------------------------------------------- inputs / smoothing

  _inputs(dt, s) {
    const st = this._st;
    const snap = this._snap;
    const yaw = s.yaw ?? this.root.rotation.y;
    const v = s.velocity || ZERO_V;
    const c = Math.cos(yaw); const sn = Math.sin(yaw);
    const lx = v.x * c - v.z * sn;
    const lz = v.x * sn + v.z * c;
    const kv = kd(snap, dt, 0.11);
    st.vx += (lx - st.vx) * kv;
    st.vz += (lz - st.vz) * kv;
    st.vy += ((v.y || 0) - st.vy) * kd(snap, dt, 0.05);
    st.speed = Math.hypot(st.vx, st.vz);
    if (st.speed > 0.05) { st.dirX = st.vx / st.speed; st.dirZ = st.vz / st.speed; }
    const stance = s.stance | 0;
    const ks = kd(snap, dt, 0.085);
    st.wS += ((stance === 0 ? 1 : 0) - st.wS) * ks;
    st.wC += ((stance === 1 ? 1 : 0) - st.wC) * ks;
    st.wP += ((stance === 2 ? 1 : 0) - st.wP) * ks;
    const wsum = st.wS + st.wC + st.wP || 1;
    st.wS /= wsum; st.wC /= wsum; st.wP /= wsum;
    const armed = !!this.weapon;
    st.sprint += ((s.sprinting && stance === 0 && st.speed > 1.5 ? 1 : 0) - st.sprint) * kd(snap, dt, 0.12);
    st.ads += ((s.ads && !s.sprinting && armed ? 1 : 0) - st.ads) * kd(snap, dt, 0.07);
    st.lean += (clamp(s.lean || 0, -1, 1) - st.lean) * kd(snap, dt, 0.1);
    const grounded = s.grounded !== false;
    st.air += ((grounded ? 0 : 1) - st.air) * kd(snap, dt, grounded ? 0.06 : 0.09);
    st.pitch += (clamp(s.pitch || 0, -1.4, 1.4) - st.pitch) * kd(snap, dt, 0.035);
    // reload loop timer
    const rel = !!s.reloading && armed;
    if (rel && !st.wasReloading) st.reloadT = 0;
    st.wasReloading = rel;
    if (rel) st.reloadT += dt;
    st.reload += ((rel ? 1 : 0) - st.reload) * kd(snap, dt, 0.1);
    // landing impulse
    if (!grounded) st.airTime += dt;
    if (grounded && !st.wasGrounded && st.airTime > 0.15) this._land.v -= Math.min(1.6, 0.5 + st.airTime * 1.5);
    if (grounded) st.airTime = 0;
    st.wasGrounded = grounded;
    if (s.firing && armed) this._recoil.v += 2.4;
    // gait phase
    const vv = st.speed;
    const cadS = 1.6 + 0.35 * vv;
    const cadC = 1.9 + 0.45 * vv;
    st.cad = (st.wS + st.wP) * cadS + st.wC * cadC;
    st.cycle = vv > 1e-3 ? (2 * vv) / st.cad : 0;
    st.phase = frac(st.phase + (st.cad * dt) / 2);
    st.crawl = frac(st.crawl + (vv * dt) / 0.8);
    st.time += dt;
    // hip yaw toward the movement direction (strafing)
    const ang = Math.atan2(st.dirX, -st.dirZ);
    const g = smooth(0.25, 1.2, vv) * (1 - st.wP);
    const hy = Math.abs(ang) <= Math.PI / 2 ? -0.5 * ang : -0.5 * Math.sign(ang) * (Math.PI - Math.abs(ang));
    st.hipYaw += (hy * g * (1 - st.sprint * 0.6) - st.hipYaw) * kd(snap, dt, 0.16);
    this._snap = false;
  }

  // ---------------------------------------------------------------- pose layers

  _buildPose() {
    const st = this._st;
    const P = this._pose.zero();
    const [ps, pc, pp, pa] = this._poses;
    if (st.wS > 1e-3) { this._poseStand(ps); P.addScaled(ps, st.wS); }
    if (st.wC > 1e-3) { this._poseCrouch(pc); P.addScaled(pc, st.wC); }
    if (st.wP > 1e-3) { this._poseProne(pp); P.addScaled(pp, st.wP); }
    const w = st.air * (1 - st.wP);
    if (w > 1e-3) {
      this._poseAir(pa);
      P.pelvis.lerp(pa.pelvis, w); P.pelvisRot.lerp(pa.pelvisRot, w);
      P.spine.lerp(pa.spine, w); P.chest.lerp(pa.chest, w);
      for (let i = 0; i < 2; i++) {
        P.foot[i].lerp(pa.foot[i], w); P.footRot[i].lerp(pa.footRot[i], w); P.knee[i].lerp(pa.knee[i], w);
      }
      P.reach *= 1 - w;
    }
  }

  /** Foot placement for one leg of a gait (writes ankle target, foot Euler, knee pole). */
  _gaitFoot(P, k, o) {
    const st = this._st;
    const side = k ? 1 : -1;
    const psi = frac(st.phase + (k ? 0.5 : 0));
    const beta = o.beta;
    const D = o.D;
    const fwdShare = o.fwdShare; // where in the stride the foot lands (0.4 = 40% ahead)
    // rest position relative to hips (rotated by hip yaw)
    const hy = st.hipYaw;
    const rx = o.restX[k]; const rz = o.restZ[k];
    const ch = Math.cos(hy); const sh = Math.sin(hy);
    const bx = rx * ch + rz * sh;
    const bz = -rx * sh + rz * ch;
    let x; let lift = 0; let pitch = 0;
    // move direction · foot forward (foot forward in root space = (−sin hy, 0, −cos hy))
    const dd = (st.dirX * -sh + st.dirZ * -ch) * o.g;
    if (psi < beta) {
      const s = psi / beta;
      x = D * fwdShare - s * D;
      const hs = o.heelStrike * dd; const to = o.toeOff * Math.abs(dd);
      if (dd >= 0) pitch = hs * (1 - smooth(0, o.flatAt, s)) - to * smooth(o.heelAt, 1, s) ** 1.3;
      else pitch = -o.heelStrike * -dd * (1 - smooth(0, o.flatAt, s)) + o.toeOff * 0.5 * -dd * smooth(o.heelAt, 1, s);
    } else {
      const s = (psi - beta) / (1 - beta);
      const e = o.run > 0.5 ? smooth(0.12, 0.95, s) : smooth(0.0, 1.0, s);
      x = -D * (1 - fwdShare) + D * e;
      lift = o.H * Math.sin(Math.PI * s ** o.liftSkew) ** 1.15;
      const to = o.toeOff * Math.abs(dd); const hs = o.heelStrike * dd;
      if (dd >= 0) pitch = lerp(-to, hs, smooth(0.15, 0.95, s)) - o.run * 0.35 * Math.sin(Math.PI * s) * Math.abs(dd);
      else pitch = lerp(o.toeOff * 0.5 * -dd, -o.heelStrike * -dd, smooth(0.15, 0.95, s));
    }
    const fx = bx + st.dirX * x;
    const fz = bz + st.dirZ * x;
    const yawF = hy + side * -o.toeOut;
    // pivot (heel when toes up, ball when heel up) keeps the contact point fixed
    const cy = Math.cos(yawF); const sy = Math.sin(yawF);
    const cp = Math.cos(pitch); const sp = Math.sin(pitch);
    let ax; let ay; let az;
    if (pitch >= 0) {
      // heel pivot at local (0, −ANKLE_H, +HEEL_BACK); ankle offset from heel (0, ANKLE_H, −HEEL_BACK) rotated by pitch
      const ly = ANKLE_H * cp + HEEL_BACK * sp; const lz = ANKLE_H * sp - HEEL_BACK * cp;
      ay = ly; az = HEEL_BACK + lz; ax = 0;
    } else {
      const ly = ANKLE_H * cp - BALL_FWD * sp; const lz = ANKLE_H * sp + BALL_FWD * cp;
      ay = ly; az = -BALL_FWD + lz; ax = 0;
    }
    // rotate the local (x, z) offset by foot yaw
    const ox = ax * cy + az * sy;
    const oz = -ax * sy + az * cy;
    P.foot[k].set(fx + ox, ay + lift, fz + oz);
    P.footRot[k].set(pitch, yawF, 0);
    P.knee[k].set(-sy + side * 0.12, 0.05, -cy);
    return lift;
  }

  _poseStand(P) {
    const st = this._st;
    const v = st.speed;
    const g = smooth(0.05, 0.7, v);
    const run = smooth(1.9, 3.9, v);
    const spr = st.sprint * smooth(3.5, 5.5, v);
    const beta = lerp(0.62, 0.34, run) - 0.05 * spr;
    const D = beta * st.cycle;
    const o = this._gaitO;
    o.beta = beta; o.D = D; o.g = g; o.run = run; o.fwdShare = lerp(0.42, 0.36, run) - 0.05 * spr;
    o.restX[0] = lerp(-0.13, -0.105, g); o.restX[1] = lerp(0.135, 0.105, g);
    o.restZ[0] = lerp(-0.06, 0, g); o.restZ[1] = lerp(0.07, 0, g);
    o.H = clamp(0.03 + 0.28 * st.cycle * 0.5 * (0.55 + 0.45 * run), 0, 0.3) * smooth(0.02, 0.25, v);
    o.liftSkew = lerp(1, 0.75, run); o.heelStrike = lerp(0.28, 0.1, run) * (1 - spr); o.toeOff = lerp(0.5, 0.95, run);
    o.flatAt = lerp(0.2, 0.1, run); o.heelAt = lerp(0.58, 0.35, run); o.toeOut = lerp(0.18, 0.06, g);
    this._gaitFoot(P, 0, o);
    this._gaitFoot(P, 1, o);
    const ph = st.phase;
    const bobPh = Math.cos(4 * Math.PI * (ph - beta / 2));
    const bob = (0.022 * (1 - run) - 0.035 * run) * bobPh * g;
    const sway = -0.022 * (1 - run) * Math.cos(TAU * (ph - beta / 2)) * g;
    const t = st.time;
    const idleSway = (1 - g) * (0.012 * Math.sin(t * 0.83) + 0.006 * Math.sin(t * 1.9));
    P.pelvis.set(sway + idleSway, 0.99 - 0.012 * g - 0.03 * run - 0.025 * spr + bob - 0.012 * st.ads, 0.02 * (1 - g) - 0.03 * run - 0.05 * spr);
    const lean = -(0.06 + 0.07 * run * g + 0.14 * spr);
    P.pelvisRot.set(lean, st.hipYaw - 0.14 * (1 - g) + 0.07 * g * Math.sin(TAU * ph) * (1 - spr * 0.4), 0.04 * g * Math.cos(TAU * (ph - beta / 2)) * (1 - run));
    P.spine.set(0.02 - 0.04 * spr, -0.5 * st.hipYaw + 0.07 * (1 - g), 0);
    P.chest.set(0.03 + 0.03 * spr, -0.5 * st.hipYaw + 0.05 * (1 - g) - 0.06 * g * Math.sin(TAU * ph), 0);
    P.neck.set(0.02, 0, 0);
    P.clav[0].set(0, 0, 0);
    P.clav[1].set(0, 0, 0);
    P.pitchMin = -1.4; P.pitchMax = 1.4; P.bodyPitch = 1; P.reach = 1;
  }

  _poseCrouch(P) {
    const st = this._st;
    const v = st.speed;
    const g = smooth(0.1, 0.8, v);
    const beta = 0.6;
    const D = beta * st.cycle;
    const o = this._gaitO;
    o.beta = beta; o.D = D; o.g = g; o.run = 0; o.fwdShare = 0.45;
    o.restX[0] = -0.13; o.restX[1] = 0.13; o.restZ[0] = -0.02; o.restZ[1] = 0.05;
    o.H = clamp(0.05 + 0.25 * st.cycle * 0.5, 0, 0.16) * smooth(0.02, 0.25, v); o.liftSkew = 1;
    o.heelStrike = 0.18; o.toeOff = 0.55; o.flatAt = 0.2; o.heelAt = 0.55; o.toeOut = 0.1;
    // crouch walk
    this._gaitFoot(P, 0, o);
    this._gaitFoot(P, 1, o);
    const ph = st.phase;
    const bob = 0.015 * Math.cos(4 * Math.PI * (ph - beta / 2)) * g;
    // kneeling targets (idle)
    if (g < 0.999) {
      const k = 1 - g;
      const hy = st.hipYaw;
      const t = st.time;
      // left foot planted forward, right knee down
      _v1.set(-0.15, ANKLE_H, -0.33); _v2.set(0.15, 0.115, 0.33);
      P.foot[0].lerp(_v1, k); P.foot[1].lerp(_v2, k);
      P.footRot[0].lerp(_v3.set(0, 0.2 + hy, 0), k); P.footRot[1].lerp(_v4.set(-1.25, -0.12 + hy, 0), k);
      P.knee[0].lerp(_v3.set(-0.1, 0.5, -1), k); P.knee[1].lerp(_v4.set(0.15, -1, -0.45), k);
      void t;
    }
    P.pelvis.set(0.02 * (1 - g), lerp(0.555, 0.68, g) + bob, lerp(0.06, 0.02, g));
    P.pelvisRot.set(lerp(-0.16, -0.38, g), st.hipYaw - 0.22 * (1 - g), 0);
    P.spine.set(lerp(0.0, 0.12, g), -0.5 * st.hipYaw + 0.1 * (1 - g), 0);
    P.chest.set(lerp(0.02, 0.08, g), -0.5 * st.hipYaw + 0.08 * (1 - g), 0);
    P.neck.set(0.02, 0, 0);
    P.clav[0].set(0, 0, 0); P.clav[1].set(0, 0, 0);
    P.pitchMin = -1.3; P.pitchMax = 1.3; P.bodyPitch = 1; P.reach = g;
  }

  _poseProne(P) {
    const st = this._st;
    const v = st.speed;
    const g = smooth(0.05, 0.4, v);
    const c = st.crawl;
    const sL = Math.max(0, Math.sin(TAU * c)) * g;
    const sR = Math.max(0, Math.sin(TAU * c + Math.PI)) * g;
    const rollC = 0.12 * g * Math.sin(TAU * c);
    P.pelvis.set(0.03 * g * Math.sin(TAU * c), 0.135, 0.86);
    P.pelvisRot.set(-Math.PI / 2 + 0.06, 0, rollC);
    P.spine.set(0.12, 0.05 * g * Math.sin(TAU * c), -rollC * 0.6);
    P.chest.set(0.22, 0.04 * g * Math.sin(TAU * c), -rollC * 0.4);
    P.neck.set(0.3, 0, 0);
    // legs extended back, slightly apart; crawl draws one knee up to the side
    P.foot[0].set(-0.19 - 0.2 * sL, 0.085, 1.68 - 0.36 * sL);
    P.foot[1].set(0.19 + 0.2 * sR, 0.085, 1.68 - 0.36 * sR);
    P.footRot[0].set(-1.35, 0.55 + 0.4 * sL, 0.35);
    P.footRot[1].set(-1.35, -0.55 - 0.4 * sR, -0.35);
    P.knee[0].set(-0.55 - sL, -1, -0.2 * sL);
    P.knee[1].set(0.55 + sR, -1, -0.2 * sR);
    P.clav[0].set(0, 0, 0); P.clav[1].set(0, 0, 0);
    P.pitchMin = -0.3; P.pitchMax = 0.42; P.bodyPitch = 0.55; P.reach = 0;
  }

  _poseAir(P) {
    const st = this._st;
    const up = smooth(-3, 1.5, st.vy); // 1 rising, 0 falling fast
    P.pelvis.set(0, 1.0, 0.0);
    P.pelvisRot.set(-0.08, st.hipYaw * 0.5, 0);
    P.spine.set(0.03, 0, 0); P.chest.set(0.05, 0, 0); P.neck.set(0.02, 0, 0);
    P.foot[0].set(-0.11, lerp(0.16, 0.36, up), lerp(-0.08, -0.18, up));
    P.foot[1].set(0.12, lerp(0.12, 0.27, up), lerp(0.05, 0.12, up));
    P.footRot[0].set(-0.25, 0.08, 0);
    P.footRot[1].set(-0.55, -0.08, 0);
    P.knee[0].set(-0.1, 0.2, -1); P.knee[1].set(0.1, 0.1, -1);
    P.clav[0].set(0, 0, 0); P.clav[1].set(0, 0, 0);
    P.pitchMin = -1.4; P.pitchMax = 1.4; P.bodyPitch = 1; P.reach = 0;
  }

  // ---------------------------------------------------------------- pose application

  _fk(i) {
    const b = this.bones[i];
    const pi = TP_RIG.defs[i].parent;
    if (pi === null) { this._rq[i].copy(b.quaternion); this._rp[i].copy(b.position); return; }
    const p = BI[pi];
    this._rp[i].copy(b.position).applyQuaternion(this._rq[p]).add(this._rp[p]);
    this._rq[i].multiplyQuaternions(this._rq[p], b.quaternion);
  }

  _applyPose(dt, s) {
    const st = this._st;
    const P = this._pose;
    const bones = this.bones;
    const t = st.time;
    const armed = !!this.weapon;
    // springs
    const rec = this._recoil.step(dt);
    const fp = this._flP.step(dt); const fr = this._flR.step(dt); const fy = this._flY.step(dt);
    const land = this._land.step(dt) * 0.06 * (1 - st.wP);
    // aim pitch
    const pitch = clamp(st.pitch, P.pitchMin, P.pitchMax);
    const breathe = Math.sin(t * 1.65 + this._seed);
    const lean = st.lean * (1 - st.wP);
    const leanRoll = -lean * 0.15;
    // ---- pelvis
    const pb = bones[BI.pelvis];
    pb.position.copy(P.pelvis);
    pb.position.x += -lean * 0.02;
    pb.position.y += land;
    // keep stance feet reachable: drop the pelvis if needed
    if (P.reach > 0.01) {
      let drop = 0;
      qEuler(_q1, P.pelvisRot.x, P.pelvisRot.y, P.pelvisRot.z);
      for (let k = 0; k < 2; k++) {
        _v1.set(k ? HIP_X : -HIP_X, -0.05, 0).applyQuaternion(_q1).add(pb.position);
        const dx = P.foot[k].x - _v1.x; const dz = P.foot[k].z - _v1.z;
        const h2 = dx * dx + dz * dz;
        const need = P.foot[k].y + Math.sqrt(Math.max(0.01, LEG_REACH * LEG_REACH - h2));
        drop = Math.max(drop, _v1.y - need);
      }
      pb.position.y -= drop * P.reach;
    }
    qEuler(pb.quaternion, P.pelvisRot.x, P.pelvisRot.y, P.pelvisRot.z);
    // ---- spine / chest / neck
    const bp = P.bodyPitch;
    const rb = rec;
    qEuler(bones[BI.spine].quaternion, P.spine.x + pitch * 0.14 * bp + breathe * 0.004 + fp * 0.5 + rb * 0.3, P.spine.y + fy * 0.5, P.spine.z + leanRoll * 0.5 + fr * 0.5);
    qEuler(bones[BI.chest].quaternion, P.chest.x + pitch * 0.22 * bp + breathe * 0.012 + fp * 0.5 + rb * 0.4, P.chest.y + fy * 0.5, P.chest.z + leanRoll * 0.5 + fr * 0.5);
    qEuler(bones[BI.neck].quaternion, P.neck.x + pitch * 0.1 * bp, 0, -leanRoll * 0.25);
    this._fk(BI.pelvis); this._fk(BI.spine); this._fk(BI.chest); this._fk(BI.neck);
    // ---- head: gaze follows the aim (absolute), with ADS cheek weld
    const ads = st.ads * (armed ? 1 : 0);
    const look = 0.035 * Math.sin(t * 0.37 + this._seed) * (1 - ads) * (1 - st.sprint);
    qEuler(_q1, pitch - 0.07 * ads + (1 - bp) * 0 - st.sprint * 0.15 + fp * 0.6, look + fy * 0.4, leanRoll * 0.75 - 0.16 * ads + fr * 0.4);
    _q2.copy(this._rq[BI.neck]).invert().multiply(_q1);
    // clamp head relative to neck (rough anatomical limit)
    _e.setFromQuaternion(_q2, 'YXZ');
    _e.x = clamp(_e.x, -0.9, 0.95); _e.y = clamp(_e.y, -1.2, 1.2); _e.z = clamp(_e.z, -0.5, 0.5);
    bones[BI.head].quaternion.setFromEuler(_e);
    this._fk(BI.head);
    // ---- legs
    for (let k = 0; k < 2; k++) {
      const ti = SIDE_I[k].thigh; const si = SIDE_I[k].shin; const fi = SIDE_I[k].foot;
      this._fk(ti);
      _pole.copy(P.knee[k]);
      if (_pole.lengthSq() < 1e-6) _pole.set(0, 0, -1);
      solveTwoBone(this._rp[ti], P.foot[k], _pole, THIGH, SHIN, _mid, _end);
      chainRotations(this._rp[ti], _mid, _end, _pole, -1, _q1, _q2);
      bones[ti].quaternion.copy(this._rq[BI.pelvis]).invert().multiply(_q1);
      bones[si].quaternion.copy(_q1).invert().multiply(_q2);
      qEuler(_q3, P.footRot[k].x, P.footRot[k].y, P.footRot[k].z);
      bones[fi].quaternion.copy(_q2).invert().multiply(_q3);
      this._rq[si].copy(_q2);
    }
    // ---- clavicles
    const reloadW = st.reload;
    for (let k = 0; k < 2; k++) {
      const ci = SIDE_I[k].clavicle;
      const m = k ? 1 : -1;
      const protract = armed ? (k ? 0.08 : 0.3) : 0;
      const shrug = breathe * 0.012 + (armed ? 0.04 : 0) + st.wP * 0.22 + (k ? ads * 0.05 : 0);
      qEuler(bones[ci].quaternion, P.clav[k].x, m * (protract + P.clav[k].y), m * (shrug + P.clav[k].z));
      this._fk(ci);
    }
    // ---- weapon + arms
    if (armed) this._solveArmed(dt, P, pitch, leanRoll, rec, fp, fr, fy, breathe, ads);
    else this._solveUnarmed(P);
  }

  /** Weapon placement (root space) + two-hand IK onto the weapon anchors. */
  _solveArmed(dt, P, pitch, leanRoll, rec, fp, fr, fy, breathe, ads) {
    const st = this._st;
    const W = this._w;
    const bones = this.bones;
    const chestQ = this._rq[BI.chest]; const chestP = this._rp[BI.chest];
    const t = st.time;
    const spr = st.sprint;
    const moving = smooth(0.3, 2, st.speed) * (1 - st.wP);
    // aim orientation: yaw 0 (body faces the aim), pitch, lean cant, sway
    const swayX = (0.006 * Math.sin(t * 1.1 + this._seed) + breathe * 0.004) * (1 - ads * 0.7);
    const swayY = 0.008 * Math.sin(t * 0.7 + 1.3 + this._seed) * (1 - ads * 0.7);
    const bobW = moving * (1 - spr);
    const gb = Math.sin(4 * Math.PI * st.phase) * bobW;
    qEuler(this._wq, pitch + swayX + rec * 2.2 + fp * 0.3 + gb * 0.012, swayY + fy * 0.3 + Math.sin(TAU * st.phase) * 0.02 * bobW, leanRoll + fr * 0.2);
    const wq = this._wq;
    const wp = this._wpos;
    if (W.pistol) {
      // pistol: arms extended in front of the eyes
      _v1.copy(EYE_LOCAL).applyQuaternion(this._rq[BI.head]).add(this._rp[BI.head]);
      _v2.set(-0.03, lerp(-0.2, -0.07, ads) - W.sight.y, lerp(-0.36, -0.42, ads)).applyQuaternion(wq);
      wp.copy(_v1).add(_v2);
    } else {
      // hip: butt in the shoulder pocket (chest space point)
      _v1.set(0.11, 0.135, -0.165).applyQuaternion(chestQ).add(chestP);
      _v2.copy(W.butt).applyQuaternion(wq);
      _v3.copy(_v1).sub(_v2);
      _v3.y -= 0.02;
      // ADS: sight anchor at the right eye
      _v4.copy(EYE_LOCAL).applyQuaternion(this._rq[BI.head]).add(this._rp[BI.head]);
      _v5.copy(W.sight).applyQuaternion(wq);
      _v4.sub(_v5);
      wp.lerpVectors(_v3, _v4, ads);
    }
    wp.addScaledVector(_v6.set(0, 0, 1).applyQuaternion(wq), rec);
    wp.y += gb * 0.008;
    // sprint: rifle across the chest (chest space), pumping with the stride
    if (spr > 1e-3) {
      const pump = Math.sin(TAU * st.phase) * 0.035;
      _v1.set(W.pistol ? 0.12 : 0.13 + pump * 0.3, W.pistol ? -0.12 : -0.1 + Math.abs(pump) * 0.4, W.pistol ? -0.25 : -0.26).applyQuaternion(chestQ).add(chestP);
      qEuler(_q1, W.pistol ? -0.9 : -0.12 + pump, W.pistol ? 0.3 : 1.05, W.pistol ? 0 : 0.75);
      _q1.premultiply(chestQ);
      wp.lerp(_v1, spr);
      wq.slerp(_q1, spr);
    }
    // reload: cant + tilt + bring closer (weapon local frame)
    let ru = 0;
    const rW = st.reload;
    if (rW > 1e-3) {
      ru = frac(st.reloadT / 2.2);
      const env = smooth(0, 0.1, ru) * (1 - smooth(0.86, 1, ru)) * rW;
      qEuler(_q1, -0.32 * env, 0.25 * env, -0.42 * env);
      wq.multiply(_q1);
      _v1.set(-0.03, -0.05, 0.07).applyQuaternion(chestQ);
      wp.addScaledVector(_v1, env);
    }
    this.weaponSocket.position.copy(wp);
    this.weaponSocket.quaternion.copy(wq);
    // ---- hand targets
    // right: grip anchor
    _q1.multiplyQuaternions(wq, W.rhQ).multiply(HAND_TP.rightQ);
    _v1.copy(HAND_TP.rightGrip).applyQuaternion(_q1);
    _v2.copy(wp).sub(_v1); // wrist target
    this._solveArm(1, _v2, _q1, _v3.set(0.42, -0.85, 0.3).applyQuaternion(chestQ));
    // left: handguard, with reload path
    _q2.multiplyQuaternions(wq, W.lhQ).multiply(W.pistol ? HAND_TP.pistolLeftQ : HAND_TP.leftQ);
    _v4.copy(W.lh).applyQuaternion(wq).add(wp); // palm point
    if (rW > 1e-3 && !W.pistol) {
      this._reloadHand(ru, rW, wp, wq, chestQ, chestP, _v4, _q2);
    }
    // keep the left hand on the handguard if the arm can't reach: slide back along the bore
    const lsh = _v5.set(-0.16, -0.015, 0.035).applyQuaternion(this._rq[SIDE_I[0].clavicle]).add(this._rp[SIDE_I[0].clavicle]);
    _v1.copy(HAND_TP.leftGrip).applyQuaternion(_q2);
    _v3.copy(_v4).sub(_v1);
    const over = _v3.distanceTo(lsh) - (UPPER_ARM + FORE_ARM) * 0.985;
    if (over > 0 && !W.pistol) {
      _v6.set(0, 0, 1).applyQuaternion(wq);
      _v3.addScaledVector(_v6, Math.min(over * 1.3, 0.12) * (1 - rW));
    }
    this._solveArm(0, _v3, _q2, _v6.set(-0.55, -0.8, 0.12).applyQuaternion(chestQ));
    // fingers
    this._fingers(1, 1, rW > 0.5 ? 0.85 : 0.3, 1);
    this._fingers(0, 0.95, 0.9, 0.85);
  }

  /** Left hand reload path (keyframes in weapon / chest space). */
  _reloadHand(u, w, wp, wq, chestQ, chestP, outPos, outQ) {
    const W = this._w;
    // magazine well point
    const mag = _v1.copy(W.mag).applyQuaternion(wq).add(wp);
    const keys = RELOAD_KEYS;
    let i = 0;
    while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
    const k0 = keys[i]; const k1 = keys[i + 1];
    const f = smooth(0, 1, (u - k0[0]) / Math.max(1e-4, k1[0] - k0[0]));
    const pA = this._reloadPoint(k0[1], mag, wp, wq, chestQ, chestP, _v2);
    const pB = this._reloadPoint(k1[1], mag, wp, wq, chestQ, chestP, _v3);
    pA.lerp(pB, f);
    outPos.lerp(pA, w);
    _q3.copy(wq).multiply(HAND_TP.magQ);
    const qa = k0[1] === 'guard' ? outQ : _q3;
    const qb = k1[1] === 'guard' ? outQ : _q3;
    _q4.copy(qa).slerp(qb, f);
    outQ.slerp(_q4, w);
  }

  _reloadPoint(name, mag, wp, wq, chestQ, chestP, out) {
    const W = this._w;
    switch (name) {
      case 'guard': return out.copy(W.lh).applyQuaternion(wq).add(wp);
      case 'mag': return out.copy(mag).addScaledVector(_v6.set(-0.035, -0.02, 0).applyQuaternion(wq), 1);
      case 'magOut': return out.copy(mag).addScaledVector(_v6.set(-0.04, -0.15, 0.02).applyQuaternion(wq), 1);
      case 'pouch': return out.set(-0.05, -0.1, -0.24).applyQuaternion(chestQ).add(chestP);
      case 'below': return out.copy(mag).addScaledVector(_v6.set(-0.035, -0.12, 0).applyQuaternion(wq), 1);
      case 'seat': return out.copy(mag).addScaledVector(_v6.set(-0.035, -0.035, 0).applyQuaternion(wq), 1);
      case 'bolt': return out.copy(wp).addScaledVector(_v6.set(-0.05, 0.06, -0.02).applyQuaternion(wq), 1);
      default: return out.copy(mag);
    }
  }

  /** Arms without a weapon: hands by the thighs, swinging with the gait. */
  _solveUnarmed(P) {
    const st = this._st;
    const chestQ = this._rq[BI.chest];
    const g = smooth(0.3, 2, st.speed) * (1 - st.wP);
    for (let k = 0; k < 2; k++) {
      const side = k ? 1 : -1;
      const swing = Math.sin(TAU * st.phase + (k ? 0 : Math.PI)) * 0.16 * g;
      _v1.set(side * 0.23, -0.6, -0.04 - swing).applyQuaternion(chestQ).add(this._rp[BI.chest]);
      if (st.wP > 0.5) _v1.set(side * 0.3, 0.06, -0.15);
      handRotation(_v2.set(0, -1, -0.15 - swing).applyQuaternion(chestQ), _v3.set(-side, 0, 0).applyQuaternion(chestQ), _q1);
      this._solveArm(k, _v1, _q1, _v4.set(side * 0.3, -0.2, 0.9).applyQuaternion(chestQ));
      this._fingers(k, 0.35, 0.3, 0.2);
    }
  }

  /** Two-bone IK for one arm: wrist target (root space) + desired hand rotation (root space). */
  _solveArm(k, wrist, handQ, pole) {
    const I = SIDE_I[k];
    const ci = I.clavicle; const ui = I.upperArm; const fi = I.foreArm; const hi = I.hand;
    const bones = this.bones;
    this._fk(ui);
    solveTwoBone(this._rp[ui], wrist, pole, UPPER_ARM, FORE_ARM, _mid, _end);
    chainRotations(this._rp[ui], _mid, _end, pole, 1, _qa, _qb);
    bones[ui].quaternion.copy(this._rq[ci]).invert().multiply(_qa);
    bones[fi].quaternion.copy(_qa).invert().multiply(_qb);
    bones[hi].quaternion.copy(_qb).invert().multiply(handQ);
    // clamp extreme wrist bends a little
    this._rq[fi].copy(_qb);
  }

  _fingers(k, curl, index, thumb) {
    const m = k ? 1 : -1;
    const b = this.bones;
    const I = SIDE_I[k];
    qEuler(b[I.fingers].quaternion, curl * 0.55, 0, 0);
    qEuler(b[I.index].quaternion, index * 0.75, 0, m * 0.04);
    qEuler(b[I.thumb].quaternion, thumb * 0.3, m * 0.2 * thumb, m * -0.35 * thumb);
  }

  // ---------------------------------------------------------------- death

  _deathPose(d, dir, supine, r) {
    const bones = this.bones;
    const st = this._st;
    // final pelvis transform
    const yaw = supine ? Math.atan2(dir.x, dir.z) : Math.atan2(-dir.x, -dir.z);
    const roll = (r() - 0.5) * 0.4;
    qEuler(d.r1, supine ? Math.PI / 2 : -Math.PI / 2, yaw, roll);
    const standing = 1 - st.wP;
    d.p1.copy(bones[0].position).addScaledVector(dir, 0.35 * standing + 0.05);
    d.p1.y = supine ? 0.13 : 0.15;
    if (this.look.pack === 1) d.p1.y += supine ? 0.04 : 0;
    // final local rotations
    const q = d.q1;
    for (let i = 0; i < q.length; i++) q[i].copy(TP_RIG.localQ[i]);
    const sgn = r() < 0.5 ? -1 : 1;
    if (supine) {
      qEuler(q[BI.spine], -0.05 - (this.look.pack === 1 ? 0.12 : 0), 0, 0);
      qEuler(q[BI.chest], -0.04, 0, 0);
      qEuler(q[BI.neck], 0.18, sgn * 0.25, 0);
      qEuler(q[BI.head], 0.25, sgn * 0.75, sgn * 0.12);
    } else {
      qEuler(q[BI.spine], 0.02, 0, 0);
      qEuler(q[BI.chest], 0.04, 0, 0);
      qEuler(q[BI.neck], 0.15, sgn * 0.45, 0);
      qEuler(q[BI.head], 0.2, sgn * 0.85, sgn * 0.2);
    }
    // limbs via directions in parent space
    const limb = (name, dirx, diry, dirz, zx, zy, zz) => {
      boneLookRotation(_v1.set(dirx, diry, dirz), _v2.set(zx, zy, zz), q[BI[name]]);
    };
    const kneeUp = r();
    for (const side of ['L', 'R']) {
      const m = side === 'R' ? 1 : -1;
      const ci = BI['clavicle' + side];
      qEuler(q[ci], 0, 0, 0);
      const a = 0.4 + r() * 0.9;
      if (supine) {
        // arms out to the sides, lying on the ground (chest +Z faces the ground)
        limb('upperArm' + side, m * Math.sin(a), -Math.cos(a) * 0.9, 0.35, 0, 0, 1);
        qEuler(q[BI['foreArm' + side]], 0.3 + r() * 0.6, 0, 0);
        qEuler(q[BI['hand' + side]], 0.2, m * 0.6, 0);
      } else {
        limb('upperArm' + side, m * 0.35 * a, -0.94, 0.1 - 0.3 * a, 0, 0, 1);
        qEuler(q[BI['foreArm' + side]], 0.2 + r() * 0.8, 0, 0);
        qEuler(q[BI['hand' + side]], -0.2, m * 0.4, 0);
      }
      qEuler(q[BI['fingers' + side]], 0.35, 0, 0);
      qEuler(q[BI['index' + side]], 0.3, 0, 0);
      qEuler(q[BI['thumb' + side]], 0.1, 0, 0);
      const bend = (side === 'L') === (kneeUp < 0.5) && supine ? 0.55 + r() * 0.4 : 0.05 + r() * 0.15;
      qEuler(q[BI['thigh' + side]], bend, 0, m * (0.06 + r() * 0.08));
      qEuler(q[BI['shin' + side]], -bend * 1.6 - 0.05, 0, 0);
      qEuler(q[BI['foot' + side]], supine ? -0.5 : -1.1, m * 0.45, 0);
    }
    // weapon drop target
    d.wv.set(dir.x * 0.6 + (r() - 0.5) * 0.6, 0.6, dir.z * 0.6 + (r() - 0.5) * 0.6);
    d.wp.copy(this.weaponSocket.position);
    qEuler(d.wq1, 0, yaw + (r() - 0.5) * 1.5, (r() < 0.5 ? 1 : -1) * Math.PI / 2);
  }

  _updateDeath(dt) {
    const d = this._death;
    if (!d) return;
    const bones = this.bones;
    if (d.t > 2.0) return; // settled: keep lying still
    d.t += dt;
    const T = 0.95;
    const t = d.t;
    const u = clamp(t / T, 0, 1);
    const fall = u * u; // accelerating topple
    const bounce = t > T ? Math.exp(-(t - T) * 9) * Math.sin((t - T) * 22) * 0.04 : 0;
    // pelvis
    const pb = bones[0];
    pb.quaternion.slerpQuaternions(d.r0, d.r1, clamp(fall + bounce, 0, 1.05));
    pb.position.lerpVectors(d.p0, d.p1, smooth(0, 1, u));
    const yDrop = d.p0.y - (d.p0.y - d.p1.y) * clamp(fall * 1.0 + smooth(0, 0.45, t) * 0.25 * (1 - u), 0, 1);
    pb.position.y = Math.max(d.p1.y, yDrop) + bounce * 0.5;
    // limbs: per-bone delays
    const buckle = Math.sin(Math.PI * clamp(t / 0.8, 0, 1)) * (1 - u * 0.5);
    for (let i = 1; i < bones.length; i++) {
      const name = TP_RIG.defs[i].name;
      const lag = name.startsWith('head') || name.startsWith('neck') ? 0.12 : name.includes('Arm') || name.includes('hand') ? 0.08 : 0.02;
      const f = smooth(lag, T + lag + 0.15, t);
      bones[i].quaternion.slerpQuaternions(d.q0[i], d.q1[i], f);
    }
    // knees buckle during the fall
    for (let k = 0; k < 2; k++) {
      qEuler(_q1, 0.55 * buckle, 0, 0);
      bones[SIDE_I[k].thigh].quaternion.multiply(_q1);
      qEuler(_q1, -1.1 * buckle, 0, 0);
      bones[SIDE_I[k].shin].quaternion.multiply(_q1);
    }
    // ground clamp (keep head, hands, knees, feet, chest above the ground)
    this.root.updateMatrixWorld(true);
    const rootY = this.root.getWorldPosition(_v1).y;
    let minY = 0;
    for (const [name, rad] of GROUND_PROBES) {
      bones[BI[name]].getWorldPosition(_v2);
      minY = Math.min(minY, _v2.y - rootY - rad);
    }
    d.lift = Math.max(d.lift * Math.exp(-dt * 2), -minY);
    pb.position.y += d.lift;
    // weapon falls from the hands and lands flat
    if (this.weapon) {
      const ws = this.weaponSocket;
      if (t < 0.12) {
        // still in the hands: follow the right hand
        ws.position.copy(d.w0);
      } else if (!d.wLanded) {
        d.wv.y -= 9.81 * dt;
        d.wp.addScaledVector(d.wv, dt);
        ws.quaternion.slerpQuaternions(d.wq0, d.wq1, smooth(0.12, 0.75, t));
        if (d.wp.y < 0.035) { d.wp.y = 0.035; d.wLanded = true; }
        ws.position.copy(d.wp);
      } else {
        ws.quaternion.slerp(d.wq1, 1 - Math.exp(-dt * 20));
        ws.position.copy(d.wp);
      }
    }
  }
}

const GROUND_PROBES = [
  ['head', 0.13], ['handL', 0.04], ['handR', 0.04], ['foreArmL', 0.05], ['foreArmR', 0.05],
  ['shinL', 0.07], ['shinR', 0.07], ['footL', 0.06], ['footR', 0.06], ['chest', 0.14], ['spine', 0.13], ['pelvis', 0.12],
];

const RELOAD_KEYS = [
  [0.0, 'guard'], [0.15, 'mag'], [0.27, 'magOut'], [0.44, 'pouch'], [0.6, 'below'], [0.7, 'seat'], [0.78, 'seat'], [0.86, 'bolt'], [1.0, 'guard'],
];

const ZERO_V = new THREE.Vector3();
const DEFAULT_STATE = {
  velocity: ZERO_V, yaw: 0, pitch: 0, stance: 0, sprinting: false, ads: false, grounded: true,
  lean: 0, reloading: false, firing: false, alive: true,
};

/**
 * Builds geometry/materials for the given looks ahead of time (avoids hitches when soldiers spawn).
 * @param {{team:number, variant:number, lod?:string}[]} list
 */
export function preloadSoldierAssets(list = []) {
  for (const it of list) {
    const L = decodeLook(it.team ?? 0, it.variant ?? 0);
    soldierMaterials(L);
    soldierGeometry(L, it.lod === 'low' ? 'low' : 'high');
  }
}

/** Triangle / draw call stats of a soldier for budgeting. */
export function soldierStats(model) {
  let tris = 0;
  for (const m of model.meshes) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  return { triangles: tris, drawCalls: model.meshes.length, bones: model.bones.length };
}

// ================================================================== first-person arms

const FP_UPPER = 0.33;
const FP_FORE = 0.30;
// [name, knuckle position (right hand space), phalanx lengths, radius]
const FP_FINGERS = [
  ['index', [0.025, -0.094, 0.0], [0.042, 0.025, 0.021], 0.0098],
  ['middle', [0.005, -0.098, 0.0], [0.046, 0.028, 0.022], 0.0101],
  ['ring', [-0.014, -0.094, 0.0], [0.043, 0.027, 0.021], 0.0096],
  ['pinky', [-0.031, -0.085, 0.0], [0.034, 0.021, 0.019], 0.0086],
];
const FP_THUMB = [[0.024, -0.022, -0.014], [0.044, 0.032, 0.026], 0.0113];

function fpBoneDefs() {
  const core = [];
  const side = [
    ['upperArm', null, [0.2, 0, 0]],
    ['foreArm', 'upperArm', [0, -FP_UPPER, 0]],
    ['twist', 'foreArm', [0, -FP_FORE, 0]],
    ['hand', 'twist', [0, 0, 0]],
  ];
  for (const [n, p, l] of FP_FINGERS) {
    side.push([n + '1', 'hand', p], [n + '2', n + '1', [0, -l[0], 0]], [n + '3', n + '2', [0, -l[1], 0]]);
  }
  side.push(['thumb1', 'hand', FP_THUMB[0]], ['thumb2', 'thumb1', [0, -FP_THUMB[1][0], 0]], ['thumb3', 'thumb2', [0, -FP_THUMB[1][1], 0]]);
  const defs = [];
  for (const s of ['L', 'R']) {
    const m = s === 'L' ? -1 : 1;
    for (const [name, parent, pos] of side) defs.push({ name: name + s, parent: parent ? parent + s : null, pos: [pos[0] * m, pos[1], pos[2]], rot: [0, 0, 0] });
  }
  void core;
  return defs;
}

const FP_RIG = makeRig(fpBoneDefs());
const FI = FP_RIG.index;
const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky'];
const SPREAD_DIR = [1, 0.2, -0.6, -1.2];
const FP_FI = ['L', 'R'].map((s) => [...FINGER_NAMES, 'thumb'].map((n) => [FI[n + '1' + s], FI[n + '2' + s], FI[n + '3' + s]]));
const FP_ARM = ['L', 'R'].map((s) => ['upperArm', 'foreArm', 'twist', 'hand'].map((n) => FI[n + s]));

/** FP glove / sleeve palettes per team. */
const FP_LOOK = {
  0: { camo: 'multicam', glove: '#7d6c52', palm: '#4a4136', knuckle: '#1b1a18', cuff: '#4c5241', strap: '#3a3a33' },
  1: { camo: 'flora', glove: '#8a7656', palm: '#4d4337', knuckle: '#1c1b19', cuff: '#a08b66', strap: '#4a4234' },
  ffa: { camo: 'woodland', glove: '#2e2e2b', palm: '#1d1d1b', knuckle: '#141414', cuff: '#4a4d3c', strap: '#2b2c28' },
};

const _fpGeoCache = new Map();

function fpGeometry(teamKey) {
  let g = _fpGeoCache.get(teamKey);
  if (g) return g;
  const L = FP_LOOK[teamKey];
  const B = { camo: new Acc(), gear: new Acc(), hard: new Acc() };
  const bw = FP_RIG.bindWorld;
  const fr = (name, mirror, local = null) => {
    const m = bw[FI[name]].clone();
    if (mirror) m.multiply(MIRROR_X);
    if (local) m.multiply(local);
    return m;
  };
  const glove = col(L.glove); const palmC = col(L.palm); const knC = col(L.knuckle);
  // two-tone: palm-facing vertices (local −Z) darker
  const twoTone = (boneName, mirror) => {
    const inv = new THREE.Matrix3().getNormalMatrix(fr(boneName, mirror)).invert();
    const nn = new THREE.Vector3();
    return (p, n) => (nn.copy(n).applyMatrix3(inv).normalize().z < -0.35 ? palmC : glove);
  };
  for (const side of ['L', 'R']) {
    const mirror = side === 'L';
    const ub = FI['upperArm' + side]; const fb = FI['foreArm' + side]; const tb = FI['twist' + side]; const hb = FI['hand' + side];
    // sleeve: t along the arm (straight bind), [t, rx, rf, rb]
    const sleeve = [
      [-0.07, 0.03, 0.03, 0.03], [-0.055, 0.052, 0.052, 0.052], [-0.03, 0.062, 0.062, 0.062], [0.02, 0.064, 0.064, 0.062],
      [0.1, 0.06, 0.061, 0.058], [0.18, 0.056, 0.058, 0.055], [0.26, 0.053, 0.055, 0.052], [0.31, 0.051, 0.053, 0.052],
      [0.35, 0.052, 0.052, 0.054], [0.39, 0.054, 0.051, 0.053], [0.44, 0.053, 0.049, 0.051], [0.49, 0.05, 0.046, 0.048],
      [0.54, 0.047, 0.043, 0.045], [0.575, 0.045, 0.041, 0.043], [0.585, 0.049, 0.045, 0.047], [0.61, 0.05, 0.046, 0.048],
      [0.632, 0.049, 0.045, 0.047], [0.636, 0.043, 0.04, 0.041],
    ];
    const wt = (t) => {
      const s1 = smooth(0.29, 0.37, t); const s2 = smooth(0.42, 0.6, t);
      return [ub, 1 - s1, fb, s1 * (1 - s2), tb, s2];
    };
    addLoft(B.camo, sleeve.map(([t, rx, rf, rb]) => ({ c: [0, -t, 0], rx, rf, rb, w: wt(t), col: t > 0.578 ? mulCol(WHITE, 0.82) : WHITE })), {
      frame: fr('upperArm' + side, mirror), seg: 26, capStart: true, tile: CAMO_TILE_M / 2,
    });
    // cuff velcro tab
    addGeo(B.camo, chamferBox(0.03, 0.035, 0.008, 0.003), fr('twist' + side, mirror, _mtx(0.0, 0.025, 0.05, 0.08, 0, 0)), mulCol(WHITE, 0.75), [tb, 1], { box: 1 / CAMO_TILE_M });
    // glove cuff (under the sleeve cuff) + wrist strap
    const cuff = [[0.075, 0.041, 0.038, 0.04], [0.03, 0.042, 0.037, 0.039], [0.0, 0.04, 0.032, 0.034], [-0.012, 0.039, 0.027, 0.028]];
    addLoft(B.gear, cuff.map(([y, rx, rf, rb]) => ({ c: [0, y, 0], rx, rf, rb, w: y > 0.02 ? [tb, 1] : [hb, 1] })), {
      frame: fr('hand' + side, mirror), seg: 20, col: glove, tile: NYLON_TILE_M,
    });
    addLoft(B.gear, [[0.022, 0.0435, 0.039, 0.041], [0.022, 0.046, 0.041, 0.044], [0.0, 0.0445, 0.036, 0.039], [0.0, 0.042, 0.034, 0.037]].map(([y, rx, rf, rb]) => ({ c: [0, y, 0], rx, rf, rb })), {
      frame: fr('hand' + side, mirror), seg: 20, w: [hb, 1], col: col(L.strap), tile: NYLON_TILE_M,
    });
    // palm / back of the hand
    const palm = [
      [-0.008, 0.002, 0.039, 0.026, 0.024], [-0.025, 0.006, 0.044, 0.024, 0.02], [-0.045, 0.007, 0.047, 0.022, 0.018],
      [-0.068, 0.004, 0.048, 0.019, 0.016], [-0.088, 0.0, 0.046, 0.016, 0.015], [-0.1, -0.002, 0.042, 0.013, 0.013], [-0.106, -0.002, 0.034, 0.009, 0.009],
    ];
    addLoft(B.gear, palm.map(([y, cx, rx, rf, rb]) => ({ c: [cx, y, 0], rx, rf, rb })), {
      frame: fr('hand' + side, mirror), seg: 20, w: [hb, 1], capEnd: true, tile: NYLON_TILE_M, colFn: twoTone('hand' + side, mirror),
    });
    // thenar pad
    addGeo(B.gear, new THREE.SphereGeometry(1, 10, 8), fr('hand' + side, mirror, _mtx(0.022, -0.038, -0.012, 0.3, 0, 0.5, 0.018, 0.03, 0.014)), palmC, [hb, 1]);
    // knuckle guard (hard rubber) on the back of the hand
    addGeo(B.hard, chamferBox(0.078, 0.022, 0.012, 0.005), fr('hand' + side, mirror, _mtx(-0.003, -0.088, 0.016, 0, 0, 0)), knC, [hb, 1]);
    addGeo(B.hard, chamferBox(0.05, 0.03, 0.007, 0.003), fr('hand' + side, mirror, _mtx(0.0, -0.055, 0.019, 0, 0, 0)), knC, [hb, 1]);
    // fingers
    const phal = (bone, len, r, last, padC) => {
      const rings = [];
      const n = last ? [[0.004, 0.75], [0.0, 0.95], [-len * 0.5, 1], [-len * 0.85, 0.92], [-len - r * 0.55, 0.62], [-len - r * 0.85, 0.2]] : [[0.004, 0.8], [0.0, 1], [-len * 0.5, 0.97], [-len, 0.98], [-len - r * 0.35, 0.8]];
      for (const [y, k] of n) rings.push({ c: [0, y, 0], rx: r * k, rf: r * k * 0.95, rb: r * k * 0.9 });
      addLoft(B.gear, rings, { frame: fr(bone + side, mirror), seg: 10, w: [FI[bone + side], 1], capStart: true, capEnd: true, tile: NYLON_TILE_M, colFn: padC });
    };
    for (const [n, , l, r] of FP_FINGERS) {
      for (let i = 0; i < 3; i++) phal(n + (i + 1), l[i], r * (1 - i * 0.07), i === 2, twoTone(n + (i + 1) + side, mirror));
      // knuckle pad on the proximal phalanx
      addGeo(B.hard, chamferBox(0.016, 0.02, 0.006, 0.0025), fr(n + '1' + side, mirror, _mtx(0, -l[0] * 0.45, r * 0.95, 0, 0, 0)), knC, [FI[n + '1' + side], 1]);
    }
    for (let i = 0; i < 3; i++) phal('thumb' + (i + 1), FP_THUMB[1][i], FP_THUMB[2] * (1.12 - i * 0.1), i === 2, () => glove);
    // watch on the left wrist (twist bone, dorsal side)
    if (side === 'L') {
      const tw = (m) => fr('twist' + side, mirror, m);
      addGeo(B.hard, new THREE.CylinderGeometry(0.0195, 0.0205, 0.011, 20), tw(_mtx(0, 0.038, 0.041, Math.PI / 2, 0, 0)), col('#2a2b2a'), [tb, 1]);
      addGeo(B.hard, new THREE.CylinderGeometry(0.0158, 0.0158, 0.002, 20), tw(_mtx(0, 0.038, 0.0468, Math.PI / 2, 0, 0)), col('#0d0f10'), [tb, 1]);
      addGeo(B.hard, chamferBox(0.004, 0.004, 0.006, 0.001), tw(_mtx(0.021, 0.038, 0.041)), col('#3a3b3a'), [tb, 1]);
      addLoft(B.gear, [[0.049, 0.0405, 0.036, 0.0395], [0.049, 0.0425, 0.0385, 0.0415], [0.027, 0.0425, 0.0385, 0.0415], [0.027, 0.0405, 0.036, 0.0395]].map(([y, rx, rf, rb]) => ({ c: [0, y, 0], rx, rf, rb })), {
        frame: fr('twist' + side, mirror), seg: 20, w: [tb, 1], col: col('#252623'), tile: NYLON_TILE_M,
      });
    }
  }
  g = { camo: B.camo.geometry(), gear: B.gear.geometry(), hard: B.hard.geometry() };
  _fpGeoCache.set(teamKey, g);
  return g;
}

/** Finger poses: [curl1, curl2, curl3] per finger + thumb [cmcX, cmcY, cmcZ, mcp, ip]. */
const FP_POSES = {
  pistol: { index: [0.42, 0.5, 0.22], middle: [1.32, 1.3, 0.62], ring: [1.42, 1.25, 0.6], pinky: [1.5, 1.15, 0.55], thumb: [0.8, 0.0, -0.55, 0.5, 0.4], spread: 0.04 },
  guard: { index: [0.95, 0.8, 0.35], middle: [1.05, 0.9, 0.42], ring: [1.1, 0.92, 0.45], pinky: [1.15, 0.9, 0.45], thumb: [0.15, 0.25, -0.35, 0.15, 0.12], spread: 0.06 },
  mag: { index: [1.05, 0.95, 0.45], middle: [1.15, 1.0, 0.5], ring: [1.2, 1.0, 0.5], pinky: [1.25, 1.0, 0.5], thumb: [0.4, 0.3, -0.6, 0.3, 0.25], spread: 0.03 },
  relaxed: { index: [0.22, 0.3, 0.18], middle: [0.3, 0.38, 0.2], ring: [0.36, 0.42, 0.22], pinky: [0.42, 0.45, 0.25], thumb: [0.15, 0.1, -0.2, 0.1, 0.1], spread: 0.1 },
};

/** Hand frames relative to the target anchors (anchor frame: −Z bore, +Y up). */
const HAND_FP = {
  rightQ: handRotation(new THREE.Vector3(0, -0.4, -0.92), new THREE.Vector3(-1, 0, 0.12), new THREE.Quaternion()),
  rightGrip: new THREE.Vector3(0.003, -0.068, -0.025),
  leftQ: handRotation(new THREE.Vector3(0.66, 0.1, -0.75), new THREE.Vector3(-0.25, 0.95, 0.15), new THREE.Quaternion()),
  leftGrip: new THREE.Vector3(-0.002, -0.07, -0.028),
  magQ: handRotation(new THREE.Vector3(0.05, 0.3, -0.95), new THREE.Vector3(0.95, 0.1, 0), new THREE.Quaternion()),
  magGrip: new THREE.Vector3(-0.004, -0.075, -0.03),
};

const FP_SHOULDER = [new THREE.Vector3(-0.17, -0.31, -0.1), new THREE.Vector3(0.22, -0.31, 0.2)];
const FP_POLE = [new THREE.Vector3(-0.5, -0.85, 0.1), new THREE.Vector3(0.35, -0.95, 0.0)];
const _fpInv = new THREE.Matrix4();
const _fpM = new THREE.Matrix4();
const _fpP = new THREE.Vector3();
const _fpQ = new THREE.Quaternion();
const _fpS = new THREE.Vector3();
const _fpSh = new THREE.Vector3();

/**
 * First-person arms for the viewmodel scene (camera space: camera at the origin looking −Z).
 * @param {{team?: number}} [opts]
 * @returns {{root: THREE.Group, update: Function, setVisible: Function, dispose: Function, bones: THREE.Bone[]}}
 */
export function createFirstPersonArms({ team = 0 } = {}) {
  const teamKey = team === 0 || team === 1 ? team : 'ffa';
  const L = FP_LOOK[teamKey];
  const root = new THREE.Group();
  root.name = 'fpArms';
  const defs = FP_RIG.defs;
  const bones = defs.map((d, i) => {
    const b = new THREE.Bone();
    b.name = d.name;
    b.position.fromArray(d.pos);
    b.quaternion.copy(FP_RIG.localQ[i]);
    return b;
  });
  defs.forEach((d, i) => { if (d.parent) bones[FI[d.parent]].add(bones[i]); else root.add(bones[i]); });
  const skeleton = new THREE.Skeleton(bones, FP_RIG.bindInv.map((m) => m.clone()));
  const geos = fpGeometry(teamKey);
  const mats = { camo: camoMaterial(L.camo, true), gear: gearMaterial(), hard: hardMaterial() };
  const meshes = [];
  for (const k of ['camo', 'gear', 'hard']) {
    const m = new THREE.SkinnedMesh(geos[k], mats[k]);
    m.name = `fpArms-${k}`;
    m.bind(skeleton, IDENTITY);
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = false;
    root.add(m);
    meshes.push(m);
  }
  const rq = bones.map(() => new THREE.Quaternion());
  const curPose = [{}, {}];
  for (let k = 0; k < 2; k++) {
    for (const n of ['index', 'middle', 'ring', 'pinky']) curPose[k][n] = FP_POSES.relaxed[n].slice();
    curPose[k].thumb = FP_POSES.relaxed.thumb.slice();
    curPose[k].spread = FP_POSES.relaxed.spread;
  }
  const qUp = new THREE.Quaternion(); const qFore = new THREE.Quaternion();
  const qHand = new THREE.Quaternion(); const qTw = new THREE.Quaternion(); const qLoc = new THREE.Quaternion();
  const wrist = new THREE.Vector3(); const shoulder = new THREE.Vector3();
  const lowered = new THREE.Vector3(-0.26, -0.7, -0.05);

  const solve = (k, target, handQ, grip, poseName, opts) => {
    const ui = FP_ARM[k][0]; const fi = FP_ARM[k][1]; const ti = FP_ARM[k][2]; const hi = FP_ARM[k][3];
    if (target) {
      _fpM.multiplyMatrices(_fpInv, target.matrixWorld);
      _fpM.decompose(_fpP, _fpQ, _fpS);
      qHand.multiplyQuaternions(_fpQ, handQ);
      wrist.copy(grip).applyQuaternion(qHand).negate().add(_fpP);
    } else {
      wrist.copy(lowered);
      handRotation(_v1.set(0.05, -1, -0.2), _v2.set(0.9, 0, -0.2), qHand);
    }
    // elastic shoulder: move toward the target when out of reach (shoulders are off screen)
    shoulder.copy(FP_SHOULDER[k]);
    const reach = (FP_UPPER + FP_FORE) * 0.985;
    const d = wrist.distanceTo(shoulder);
    if (d > reach) shoulder.lerp(wrist, Math.min(0.14, d - reach) / d);
    bones[ui].position.copy(shoulder);
    solveTwoBone(shoulder, wrist, FP_POLE[k], FP_UPPER, FP_FORE, _mid, _end);
    chainRotations(shoulder, _mid, _end, FP_POLE[k], 1, qUp, qFore);
    bones[ui].quaternion.copy(qUp);
    bones[fi].quaternion.copy(qUp).invert().multiply(qFore);
    // forearm twist bone takes the roll of the hand around the forearm axis
    qLoc.copy(qFore).invert().multiply(qHand);
    twistAround(qLoc, Y_AXIS, qTw);
    bones[ti].quaternion.copy(qTw);
    bones[hi].quaternion.copy(qTw).invert().multiply(qLoc);
    // fingers (smoothed toward the target pose)
    const target2 = FP_POSES[poseName];
    const cp = curPose[k];
    const a = opts.snap ? 1 : clamp((opts.dt ?? 1 / 60) * 14, 0, 1);
    const m = k ? 1 : -1;
    for (let f = 0; f < 4; f++) {
      const n = FINGER_NAMES[f];
      for (let i = 0; i < 3; i++) cp[n][i] += (target2[n][i] - cp[n][i]) * a;
    }
    for (let i = 0; i < 5; i++) cp.thumb[i] += (target2.thumb[i] - cp.thumb[i]) * a;
    cp.spread += (target2.spread - cp.spread) * a;
    const trig = k && poseName === 'pistol' ? clamp(opts.trigger || 0, 0, 1) : 0;
    const FIk = FP_FI[k];
    for (let f = 0; f < 4; f++) {
      const n = FINGER_NAMES[f];
      const t0 = f === 0 ? trig : 0;
      qEuler(bones[FIk[f][0]].quaternion, cp[n][0] + 0.25 * t0, 0, m * -cp.spread * SPREAD_DIR[f]);
      qEuler(bones[FIk[f][1]].quaternion, cp[n][1] + 0.35 * t0, 0, 0);
      qEuler(bones[FIk[f][2]].quaternion, cp[n][2] + 0.1 * t0, 0, 0);
    }
    const th = cp.thumb;
    qEuler(bones[FIk[4][0]].quaternion, th[0], m * th[1], m * th[2]);
    qEuler(bones[FIk[4][1]].quaternion, th[3], 0, 0);
    qEuler(bones[FIk[4][2]].quaternion, th[4], 0, 0);
  };

  return {
    root,
    bones,
    meshes,
    /**
     * Place the hands on the weapon anchors (Object3Ds in the same scene, world matrices updated).
     * @param {THREE.Object3D|null} rightTarget pistol-grip anchor
     * @param {THREE.Object3D|null} leftTarget handguard anchor (null → left hand lowered out of view)
     * @param {{leftOverride?: THREE.Object3D|null, trigger?: number, dt?: number, snap?: boolean}} [opts]
     */
    update(rightTarget, leftTarget, opts = {}) {
      root.updateWorldMatrix(true, false);
      _fpInv.copy(root.matrixWorld).invert();
      solve(1, rightTarget, HAND_FP.rightQ, HAND_FP.rightGrip, rightTarget ? 'pistol' : 'relaxed', opts);
      const ov = opts.leftOverride || null;
      const lt = ov || leftTarget || null;
      solve(0, lt, ov ? HAND_FP.magQ : HAND_FP.leftQ, ov ? HAND_FP.magGrip : HAND_FP.leftGrip, ov ? 'mag' : lt ? 'guard' : 'relaxed', opts);
      root.updateMatrixWorld(true);
      void rq;
    },
    setVisible(v) { root.visible = !!v; },
    dispose() {
      if (root.parent) root.parent.remove(root);
      skeleton.dispose();
    },
  };
}
