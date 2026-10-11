// Geometry toolkit for procedural weapon models.
//
// Modelling space ("gun space"): metres, bore axis on x = 0, y = 0, forward is -Z.
// Profiles are drawn in (f, y) where f = forward distance (z = -f), cross-sections in (x, y).
// A Builder collects part geometries per material, merges them into one mesh per material
// (one draw call each), supports animated sub-groups (magazine, bolt, ...) and anchors, and
// finally re-centres everything on the right-hand grip point.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getMaterial } from './weapon-materials.js';

/** Quality presets per LOD. */
export const QUALITY = {
  fp: { lod: 'fp', fp: true, seg: 22, segS: 14, segXS: 8, bevel: 0.0007, bevelSeg: 2, fillet: 3, crease: 0.6 },
  tp: { lod: 'tp', fp: false, seg: 8, segS: 6, segXS: 4, bevel: 0, bevelSeg: 0, fillet: 1, crease: 0.9 },
};

const UV_SCALE = 10; // 1 UV unit = 10 cm (textures set their own repeat)
const _v2 = (x, y) => new THREE.Vector2(x, y);

/** Matrix from gun-space position (x, y, f) and Euler rotation (XYZ). */
export function mtx(x = 0, y = 0, f = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(s[0], s[1], s[2]);
  return m.compose(new THREE.Vector3(x, y, -f), q, sc);
}

// ------------------------------------------------------------------ 2D outlines

/**
 * Closed polygon with optional per-corner fillets: pts = [[u, v, r?], ...].
 * Returns THREE.Vector2[] (duplicates removed).
 */
export function fillet(pts, segs) {
  const out = [];
  const n = pts.length;
  const push = (x, y) => {
    const l = out[out.length - 1];
    if (!l || Math.abs(l.x - x) > 1e-7 || Math.abs(l.y - y) > 1e-7) out.push(_v2(x, y));
  };
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const r = p[2] || 0;
    if (!r || segs < 1) { push(p[0], p[1]); continue; }
    const a = pts[(i - 1 + n) % n];
    const c = pts[(i + 1) % n];
    let d1x = a[0] - p[0]; let d1y = a[1] - p[1];
    let d2x = c[0] - p[0]; let d2y = c[1] - p[1];
    const l1 = Math.hypot(d1x, d1y); const l2 = Math.hypot(d2x, d2y);
    if (l1 < 1e-9 || l2 < 1e-9) { push(p[0], p[1]); continue; }
    d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2;
    const ang = Math.acos(Math.max(-1, Math.min(1, d1x * d2x + d1y * d2y)));
    if (ang > 3.1) { push(p[0], p[1]); continue; }
    const t = Math.min(r / Math.tan(ang / 2), l1 * 0.49, l2 * 0.49);
    const p1x = p[0] + d1x * t; const p1y = p[1] + d1y * t;
    const p2x = p[0] + d2x * t; const p2y = p[1] + d2y * t;
    for (let k = 0; k <= segs; k++) {
      const s = k / segs;
      const w0 = (1 - s) * (1 - s); const w1 = 2 * s * (1 - s); const w2 = s * s;
      push(w0 * p1x + w1 * p[0] + w2 * p2x, w0 * p1y + w1 * p[1] + w2 * p2y);
    }
  }
  if (out.length > 2) {
    const f0 = out[0]; const l = out[out.length - 1];
    if (Math.abs(f0.x - l.x) < 1e-7 && Math.abs(f0.y - l.y) < 1e-7) out.pop();
  }
  return out;
}

/** Points of a circle/ellipse (for holes / round outlines). */
export function circlePts(cu, cv, ru, rv = ru, n = 16, a0 = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    out.push([cu + Math.cos(a) * ru, cv + Math.sin(a) * rv]);
  }
  return out;
}

/** Rounded rectangle outline (u0..u1, v0..v1) with corner radius r. */
export function rrect(u0, v0, u1, v1, r = 0) {
  return [[u0, v0, r], [u1, v0, r], [u1, v1, r], [u0, v1, r]];
}

// ------------------------------------------------------------------ geometry post-processing

/** Recompute normals of a non-indexed geometry, smoothing across edges below `angle` (radians). */
export function creaseNormals(geo, angle) {
  const pos = geo.attributes.position.array;
  const n = pos.length / 3;
  const faces = n / 3;
  const fn = new Float32Array(faces * 3);
  const corner = new Float32Array(n);
  for (let f = 0; f < faces; f++) {
    const i = f * 9;
    const ax = pos[i]; const ay = pos[i + 1]; const az = pos[i + 2];
    const bx = pos[i + 3]; const by = pos[i + 4]; const bz = pos[i + 5];
    const cx = pos[i + 6]; const cy = pos[i + 7]; const cz = pos[i + 8];
    const ux = bx - ax; const uy = by - ay; const uz = bz - az;
    const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    fn[f * 3] = nx; fn[f * 3 + 1] = ny; fn[f * 3 + 2] = nz;
    // interior angles at each corner (angle-weighted normals)
    const P = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]];
    for (let k = 0; k < 3; k++) {
      const p0 = P[k]; const p1 = P[(k + 1) % 3]; const p2 = P[(k + 2) % 3];
      const e1x = p1[0] - p0[0]; const e1y = p1[1] - p0[1]; const e1z = p1[2] - p0[2];
      const e2x = p2[0] - p0[0]; const e2y = p2[1] - p0[1]; const e2z = p2[2] - p0[2];
      const d = (e1x * e2x + e1y * e2y + e1z * e2z) / ((Math.hypot(e1x, e1y, e1z) * Math.hypot(e2x, e2y, e2z)) || 1);
      corner[f * 3 + k] = Math.acos(Math.max(-1, Math.min(1, d)));
    }
  }
  const buckets = new Map();
  const ids = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 2e5)},${Math.round(pos[i * 3 + 1] * 2e5)},${Math.round(pos[i * 3 + 2] * 2e5)}`;
    let b = buckets.get(k);
    if (!b) { b = []; buckets.set(k, b); }
    b.push(i);
    ids[i] = b;
  }
  const cosA = Math.cos(angle);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const f = (i / 3) | 0;
    const fx = fn[f * 3]; const fy = fn[f * 3 + 1]; const fz = fn[f * 3 + 2];
    let sx = 0; let sy = 0; let sz = 0;
    for (const j of ids[i]) {
      const g = (j / 3) | 0;
      const gx = fn[g * 3]; const gy = fn[g * 3 + 1]; const gz = fn[g * 3 + 2];
      if (fx * gx + fy * gy + fz * gz >= cosA) {
        const w = corner[j];
        sx += gx * w; sy += gy * w; sz += gz * w;
      }
    }
    const l = Math.hypot(sx, sy, sz);
    if (l < 1e-12) { sx = fx; sy = fy; sz = fz; } else { sx /= l; sy /= l; sz /= l; }
    out[i * 3] = sx; out[i * 3 + 1] = sy; out[i * 3 + 2] = sz;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return geo;
}

/** Strip to position/normal, make non-indexed, add colour (edge wear along `axis`). */
export function prep(geo, q, { axis = -1, wear = 1, crease = true, creaseAngle } = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (crease) creaseNormals(g, creaseAngle ?? q.crease);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3).fill(1);
  if (axis >= 0 && wear > 0 && q.fp) {
    const nr = g.attributes.normal.array;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(nr[i * 3 + axis]);
      const e = 2 * a * Math.sqrt(Math.max(0, 1 - a * a)); // 1 at 45 degrees (bevel), 0 on faces
      const c = 1 + wear * 1.3 * e * e;
      col[i * 3] = c; col[i * 3 + 1] = c; col[i * 3 + 2] = c;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Box-projected UVs per triangle (gun space, so texel density is uniform). */
function boxUV(geo) {
  const p = geo.attributes.position.array;
  const n = p.length / 3;
  const uv = new Float32Array(n * 2);
  for (let t = 0; t < n; t += 3) {
    const i = t * 3;
    const ux = p[i + 3] - p[i]; const uy = p[i + 4] - p[i + 1]; const uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i]; const vy = p[i + 7] - p[i + 1]; const vz = p[i + 8] - p[i + 2];
    const nx = Math.abs(uy * vz - uz * vy); const ny = Math.abs(uz * vx - ux * vz); const nz = Math.abs(ux * vy - uy * vx);
    for (let k = 0; k < 3; k++) {
      const x = p[i + k * 3]; const y = p[i + k * 3 + 1]; const z = p[i + k * 3 + 2];
      let u; let v;
      if (nx >= ny && nx >= nz) { u = -z; v = y; } else if (ny >= nz) { u = -z; v = x; } else { u = x; v = y; }
      uv[(t + k) * 2] = u * UV_SCALE;
      uv[(t + k) * 2 + 1] = v * UV_SCALE;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ------------------------------------------------------------------ primitive generators (local space)

/** Side profile (f, y) extruded across X, centred on x = 0. */
export function extrudeSide(pts, width, q, o = {}) {
  const shape = new THREE.Shape(fillet(pts, q.fillet));
  if (o.holes) for (const h of o.holes) shape.holes.push(new THREE.Path(fillet(h, q.fillet)));
  const want = o.bevel !== undefined ? o.bevel : q.bevel;
  const bv = q.fp ? Math.min(want, width * 0.22) : 0;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - 2 * bv, bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv, bevelOffset: -bv,
    bevelSegments: o.bevelSeg || q.bevelSeg, curveSegments: 4, steps: 1,
  });
  geo.translate(0, 0, -(width / 2 - bv));
  geo.rotateY(Math.PI / 2);
  return prep(geo, q, { axis: 0, wear: o.wear ?? 1, creaseAngle: o.crease });
}

/** Cross-section (x, y) extruded forward from f = 0 to f = len. */
export function extrudeSection(pts, len, q, o = {}) {
  const shape = new THREE.Shape(fillet(pts, q.fillet));
  if (o.holes) for (const h of o.holes) shape.holes.push(new THREE.Path(fillet(h, q.fillet)));
  const want = o.bevel !== undefined ? o.bevel : q.bevel;
  const bv = q.fp ? Math.min(want, len * 0.22) : 0;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: len - 2 * bv, bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv, bevelOffset: -bv,
    bevelSegments: o.bevelSeg || q.bevelSeg, curveSegments: 4, steps: 1,
  });
  geo.translate(0, 0, -(len - bv));
  return prep(geo, q, { axis: 2, wear: o.wear ?? 1, creaseAngle: o.crease });
}

/** Cylinder along the bore direction from f = 0 (radius r0) to f = len (radius r1). */
export function cylZ(r0, r1, len, segs, q, o = {}) {
  const geo = new THREE.CylinderGeometry(r1, r0, len, segs, 1, !!o.open, o.thetaStart || 0, o.thetaLength || Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -len / 2);
  return prep(geo, q, { creaseAngle: o.crease ?? (segs <= 8 ? 0.9 : q.crease) });
}

/** Lathe around the bore direction: pts = [[r, f], ...] ordered rear-to-front (increasing f) for outward faces. */
export function latheZ(pts, segs, q, o = {}) {
  const geo = new THREE.LatheGeometry(pts.map((p) => _v2(Math.max(p[0], 0), p[1])), segs, o.phiStart || 0, o.phiLength || Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  return prep(geo, q, { creaseAngle: o.crease ?? (segs <= 8 ? 0.95 : q.crease) });
}

export function boxGeo(w, h, l, q) {
  return prep(new THREE.BoxGeometry(w, h, l), q, { crease: false });
}

export function sphereGeo(r, ws, hs, q) {
  return prep(new THREE.SphereGeometry(r, ws, hs), q, { creaseAngle: 1.2 });
}

export function torusGeo(r, tube, rs, ts, q, arc = Math.PI * 2) {
  return prep(new THREE.TorusGeometry(r, tube, rs, ts, arc), q, { creaseAngle: 1.2 });
}

// ------------------------------------------------------------------ Builder

/**
 * Collects geometry per material key, plus named animated sub-groups, special meshes and anchors.
 * All coordinates are gun space (x, y, f).
 */
export class Builder {
  constructor(id, q, root = null, frame = null, name = '') {
    this.id = id;
    this.q = q;
    this.fp = q.fp;
    this.root = root || this;
    this.frame = frame;
    this.name = name;
    this.lists = new Map();
    this.children = [];
    this.specials = [];
    if (!root) {
      this.anchors = {};
      this.origin = new THREE.Vector3();
      this.meta = {};
    }
  }

  /** Animated sub-group with its own frame (gun space). Parts added to it use gun space too. */
  group(name, x = 0, y = 0, f = 0, rx = 0, ry = 0, rz = 0) {
    const c = new Builder(this.id, this.q, this.root, mtx(x, y, f, rx, ry, rz), name);
    this.children.push(c);
    return c;
  }

  /** Add an already generated geometry; `m` places it in gun space. o.tint multiplies vertex colours. */
  geo(mat, geo, m = null, o = {}) {
    if (m) geo.applyMatrix4(m);
    if (o.tint !== undefined && o.tint !== 1) {
      const c = geo.attributes.color.array;
      const t = Array.isArray(o.tint) ? o.tint : [o.tint, o.tint, o.tint];
      for (let i = 0; i < c.length; i += 3) { c[i] *= t[0]; c[i + 1] *= t[1]; c[i + 2] *= t[2]; }
    }
    boxUV(geo);
    let l = this.lists.get(mat);
    if (!l) { l = []; this.lists.set(mat, l); }
    l.push(geo);
    return geo;
  }

  /** Side profile extruded across X. o: { x, y, f, rx, width-centred at x, holes, bevel, wear, tint } */
  side(mat, pts, width, o = {}) {
    const g = extrudeSide(pts, width, this.q, o);
    const m = (o.x || o.y || o.f || o.rx || o.ry || o.rz) ? mtx(o.x || 0, o.y || 0, o.f || 0, o.rx || 0, o.ry || 0, o.rz || 0) : null;
    return this.geo(mat, g, m, o);
  }

  /** Cross-section (x, y) extruded from f0 to f1. o: { x, y, rz (roll about bore), holes, bevel } */
  section(mat, pts, f0, f1, o = {}) {
    const g = extrudeSection(pts, f1 - f0, this.q, o);
    let m = mtx(o.x || 0, o.y || 0, f0);
    if (o.rz) m = new THREE.Matrix4().makeRotationZ(o.rz).multiply(m);
    if (o.pre) m = o.pre.clone().multiply(m);
    return this.geo(mat, g, m, o);
  }

  /** Cylinder along the bore from f0 to f1 at (o.x, o.y). r may be [r0, r1]. */
  tube(mat, r, f0, f1, o = {}) {
    const [r0, r1] = Array.isArray(r) ? r : [r, r];
    const segs = o.seg || this.q.seg;
    const g = cylZ(r0, r1, f1 - f0, segs, this.q, o);
    let m = mtx(o.x || 0, o.y || 0, f0, o.rx || 0, o.ry || 0, o.roll || 0);
    if (o.pre) m = o.pre.clone().multiply(m);
    return this.geo(mat, g, m, o);
  }

  /** Lathe [[r, f], ...] (absolute f) around an axis parallel to the bore at (o.x, o.y). */
  lathe(mat, pts, o = {}) {
    const segs = o.seg || this.q.seg;
    const g = latheZ(pts, segs, this.q, o);
    let m = mtx(o.x || 0, o.y || 0, 0, o.rx || 0, o.ry || 0, o.roll || 0);
    if (o.pre) m = o.pre.clone().multiply(m);
    return this.geo(mat, g, m, o);
  }

  /** Box centred at (x, y, f) with size w (X), h (Y), l (along bore). */
  box(mat, x, y, f, w, h, l, o = {}) {
    const g = boxGeo(w, h, l, this.q);
    let m = mtx(x, y, f, o.rx || 0, o.ry || 0, o.rz || 0);
    if (o.pre) m = o.pre.clone().multiply(m);
    return this.geo(mat, g, m, o);
  }

  /** Rounded box (beveled extrusion of a filleted rectangle) centred at (x, y, f). */
  rbox(mat, x, y, f, w, h, l, r = 0.002, o = {}) {
    if (!this.fp && !o.keep) return this.box(mat, x, y, f, w, h, l, o);
    const rr = Math.min(r, w * 0.45, h * 0.45);
    const g = extrudeSection(rrect(-w / 2, -h / 2, w / 2, h / 2, rr), l, this.q, o);
    let m = mtx(x, y, f - l / 2, o.rx || 0, o.ry || 0, o.rz || 0);
    if (o.pre) m = o.pre.clone().multiply(m);
    return this.geo(mat, g, m, o);
  }

  /** Cylinder with its axis along X (pins, screws, side turrets), centred at (x, y, f). */
  cylX(mat, x, y, f, r, len, o = {}) {
    const segs = o.seg || this.q.segS;
    const g = prep(new THREE.CylinderGeometry(o.r2 ?? r, r, len, segs), this.q, { creaseAngle: segs <= 8 ? 0.95 : this.q.crease });
    g.rotateZ(-Math.PI / 2);
    let m = mtx(x, y, f, o.rx || 0, o.ry || 0, o.rz || 0);
    if (o.pre) m = o.pre.clone().multiply(m);
    return this.geo(mat, g, m, o);
  }

  /** Cylinder with its axis along Y, centred at (x, y, f). o.r2 = top radius. */
  cylY(mat, x, y, f, r, len, o = {}) {
    const segs = o.seg || this.q.segS;
    const g = prep(new THREE.CylinderGeometry(o.r2 ?? r, r, len, segs), this.q, { creaseAngle: segs <= 8 ? 0.95 : this.q.crease });
    let m = mtx(x, y, f, o.rx || 0, o.ry || 0, o.rz || 0);
    if (o.pre) m = o.pre.clone().multiply(m);
    return this.geo(mat, g, m, o);
  }

  /** Lathe around the Y axis: pts = [[r, y], ...] (local y, bottom to top), placed at (x, y, f). */
  latheY(mat, pts, x, y, f, o = {}) {
    const segs = o.seg || this.q.segS;
    const g = prep(new THREE.LatheGeometry(pts.map((p) => _v2(Math.max(p[0], 0), p[1])), segs), this.q,
      { creaseAngle: o.crease ?? (segs <= 8 ? 0.95 : this.q.crease) });
    let m = mtx(x, y, f, o.rx || 0, o.ry || 0, o.rz || 0);
    if (o.pre) m = o.pre.clone().multiply(m);
    return this.geo(mat, g, m, o);
  }

  sphere(mat, x, y, f, r, o = {}) {
    const g = sphereGeo(r, o.ws || this.q.segS, o.hs || Math.max(4, this.q.segS >> 1), this.q);
    let m = mtx(x, y, f, o.rx || 0, o.ry || 0, o.rz || 0, o.scale || 1);
    if (o.pre) m = o.pre.clone().multiply(m);
    return this.geo(mat, g, m, o);
  }

  torus(mat, x, y, f, r, tube, o = {}) {
    const g = torusGeo(r, tube, o.rs || (this.fp ? 8 : 4), o.ts || this.q.segS, this.q, o.arc);
    let m = mtx(x, y, f, o.rx || 0, o.ry || 0, o.rz || 0);
    if (o.pre) m = o.pre.clone().multiply(m);
    return this.geo(mat, g, m, o);
  }

  /** Dark recessed decal (port / hole / slot) - a thin box tinted almost black. */
  hole(mat, x, y, f, w, h, l, o = {}) {
    return this.box(mat, x, y, f, w, h, l, { ...o, tint: o.tint ?? 0.05 });
  }

  /** Dark round decal facing along an axis ('x' | 'y' | 'z'). */
  dot(mat, x, y, f, r, axis = 'z', o = {}) {
    const t = o.depth || 0.0008;
    const segs = o.seg || this.q.segXS;
    if (axis === 'z') return this.tube(mat, r, f - t / 2, f + t / 2, { x, y, seg: segs, tint: o.tint ?? 0.05 });
    if (axis === 'x') return this.cylX(mat, x, y, f, r, t, { seg: segs, tint: o.tint ?? 0.05 });
    return this.cylY(mat, x, y, f, r, t, { seg: segs, tint: o.tint ?? 0.05 });
  }

  /** Register a special (non-merged) mesh positioned in gun space (lens, reticle). */
  special(mesh) {
    this.specials.push(mesh);
    return mesh;
  }

  /** Anchor in gun space. rot = [rx, ry, rz] Euler (XYZ). */
  anchor(name, x, y, f, rot = null) {
    const q = new THREE.Quaternion();
    if (rot) q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ'));
    this.root.anchors[name] = { pos: new THREE.Vector3(x, y, -f), quat: q };
  }

  /** Gun-space point that becomes the model origin (right-hand grip point). */
  setOrigin(x, y, f) {
    this.root.origin.set(x, y, -f);
  }

  // ---------------------------------------------------------------- finalise

  build() {
    const root = new THREE.Group();
    root.name = `weapon:${this.id}`;
    const o = this.origin;
    const toRoot = new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z);
    this._emit(root, toRoot, '');
    for (const [name, a] of Object.entries(this.anchors)) {
      const obj = new THREE.Object3D();
      obj.name = `anchor:${name}`;
      obj.position.copy(a.pos).sub(o);
      obj.quaternion.copy(a.quat);
      root.add(obj);
    }
    root.updateMatrixWorld(true);
    return root;
  }

  _emit(parent, toLocal, prefix) {
    const shadows = !this.fp;
    for (const [mat, list] of this.lists) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!g) throw new Error(`merge failed for ${this.id}:${mat}`);
      g.applyMatrix4(toLocal);
      g.computeBoundingBox();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, getMaterial(mat));
      mesh.name = `${this.id}:${prefix}${mat}`;
      mesh.castShadow = shadows;
      mesh.receiveShadow = false;
      parent.add(mesh);
    }
    for (const s of this.specials) {
      s.applyMatrix4(toLocal);
      s.castShadow = false;
      s.receiveShadow = false;
      parent.add(s);
    }
    for (const c of this.children) {
      const grp = new THREE.Group();
      grp.name = c.name;
      const m = toLocal.clone().multiply(c.frame);
      m.decompose(grp.position, grp.quaternion, grp.scale);
      parent.add(grp);
      c._emit(grp, c.frame.clone().invert(), `${c.name}:`);
    }
  }
}
