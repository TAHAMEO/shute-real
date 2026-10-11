// Shared weapon parts: Picatinny rails, flip-up sights, optics, muzzle devices, foregrips,
// bipods, magazines and small details. All functions take a Builder and gun-space coords.
import * as THREE from 'three';
import { getMaterial, RETICLE_FEATURE } from '../weapon-materials.js';
import { extrudeSection, mtx, prep, circlePts } from '../weapon-parts.js';

export const MOA = Math.PI / (180 * 60);

/** Matrix rotating about an X-parallel axis through (y, f). */
export function pivotX(y, f, a) {
  const t1 = new THREE.Matrix4().makeTranslation(0, y, -f);
  const r = new THREE.Matrix4().makeRotationX(a);
  const t2 = new THREE.Matrix4().makeTranslation(0, -y, f);
  return t1.multiply(r).multiply(t2);
}

/** Matrix rotating about a Z-parallel axis through (x, y). */
export function pivotZ(x, y, a) {
  const t1 = new THREE.Matrix4().makeTranslation(x, y, 0);
  const r = new THREE.Matrix4().makeRotationZ(a);
  const t2 = new THREE.Matrix4().makeTranslation(-x, -y, 0);
  return t1.multiply(r).multiply(t2);
}

// ------------------------------------------------------------------ Picatinny

export const RAIL_H = 0.0095; // rail height above its base
const RS = 0.0076; // spine half width
const RW = 0.0106; // widest half width
const PITCH = 0.01001;
const TOOTH = 0.00478;

/**
 * MIL-STD-1913 rail from f0 to f1, base at height y (distance from the bore axis when rolled),
 * o.roll rotates it about the bore axis (0 top, PI bottom, -PI/2 right, PI/2 left), o.x lateral offset.
 * Returns the rail top height (y + RAIL_H).
 */
export function rail(b, mat, f0, f1, y, o = {}) {
  const pre = o.roll ? new THREE.Matrix4().makeRotationZ(o.roll) : null;
  const x = o.x || 0;
  const len = f1 - f0;
  if (!b.fp || o.flat) {
    const prof = [[-RS, 0], [RS, 0], [RS, 0.0035], [RW, 0.0062], [RS, RAIL_H], [-RS, RAIL_H], [-RW, 0.0062], [-RS, 0.0035]];
    b.section(mat, prof, f0, f1, { x, y, pre });
    return y + RAIL_H;
  }
  const base = [[-RS, 0], [RS, 0], [RS, 0.0035], [RW, 0.0065], [-RW, 0.0065], [-RS, 0.0035]];
  b.section(mat, base, f0, f1, { x, y, pre, tint: 0.55, bevel: 0.0004 });
  const tooth = extrudeSection([[-RW, 0.0065], [RW, 0.0065], [RS, RAIL_H], [-RS, RAIL_H]], TOOTH, b.q, { bevel: 0.0003, bevelSeg: 1 });
  const n = Math.max(1, Math.floor((len - TOOTH) / PITCH) + 1);
  const start = f0 + (len - ((n - 1) * PITCH + TOOTH)) / 2;
  for (let i = 0; i < n; i++) {
    const g = i === n - 1 ? tooth : tooth.clone();
    let m = mtx(x, y, start + i * PITCH);
    if (pre) m = pre.clone().multiply(m);
    b.geo(mat, g, m);
  }
  return y + RAIL_H;
}

// ------------------------------------------------------------------ flip-up iron sights

/** Rear flip-up aperture sight. f = leaf position, railTop = rail top height, sightY = aperture centre. */
export function buisRear(b, mat, f, railTop, sightY, up = true, o = {}) {
  const baseTop = railTop + 0.0075;
  b.rbox(mat, 0, railTop + 0.0035, f - 0.004, 0.019, 0.008, 0.028, 0.0015);
  if (b.fp) {
    b.box(mat, 0.0118, railTop - 0.002, f - 0.004, 0.003, 0.009, 0.024);
    b.box(mat, -0.0118, railTop - 0.002, f - 0.004, 0.003, 0.009, 0.024);
    b.cylX(mat, 0.0135, railTop - 0.003, f - 0.006, 0.0038, 0.004, { seg: 10 }); // clamp knob
  }
  const y0 = baseTop - 0.002;
  const top = sightY + 0.0062;
  let outline = [[-0.0082, y0], [0.0082, y0], [0.0082, sightY + 0.002, 0.002], [0.0058, top, 0.002], [-0.0058, top, 0.002], [-0.0082, sightY + 0.002, 0.002]];
  if (o.style === 'drum') outline = ringStem(0, sightY, 0.0078, 0.0050, y0, b.fp ? 20 : 8);
  const hole = circlePts(0, sightY, o.aperture || 0.0021, o.aperture || 0.0021, b.fp ? 16 : 8).reverse();
  const g = extrudeSection(outline, 0.0032, b.q, { holes: [hole], bevel: 0.0004 });
  const pv = up ? null : pivotX(y0 + 0.001, f, Math.PI / 2);
  let m = mtx(0, 0, f - 0.0016);
  if (pv) m = pv.multiply(m);
  b.geo(mat, g, m);
}

/** Front flip-up post sight; the post tip is exactly at sightY. */
export function buisFront(b, mat, f, railTop, sightY, up = true, o = {}) {
  const baseTop = railTop + 0.0075;
  b.rbox(mat, 0, railTop + 0.0035, f + 0.003, 0.019, 0.008, 0.024, 0.0015);
  if (b.fp) {
    b.box(mat, 0.0118, railTop - 0.002, f + 0.003, 0.003, 0.009, 0.020);
    b.box(mat, -0.0118, railTop - 0.002, f + 0.003, 0.003, 0.009, 0.020);
  }
  const y0 = baseTop - 0.002;
  const ear = sightY + (o.ear ?? 0.0065);
  const win = sightY - 0.0065;
  const pw = 0.0008;
  let outline = [
    [-0.0085, y0], [0.0085, y0], [0.0085, ear, 0.0015], [0.0060, ear, 0.001], [0.0060, win, 0.0015],
    [pw, win, 0.0008], [pw, sightY - 0.0006], [pw * 0.6, sightY], [-pw * 0.6, sightY], [-pw, sightY - 0.0006],
    [-pw, win, 0.0008], [-0.0060, win, 0.0015], [-0.0060, ear, 0.001], [-0.0085, ear, 0.0015],
  ];
  let holes;
  if (o.style === 'hood') {
    const cy = sightY - 0.0012;
    const ri = 0.0068;
    outline = ringStem(0, cy, 0.0088, 0.0045, y0, b.fp ? 22 : 10);
    const a1 = Math.asin(pw / ri);
    const yb = cy - Math.sqrt(ri * ri - pw * pw);
    const hp = [];
    const n = b.fp ? 18 : 8;
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + a1 + (i / n) * (Math.PI * 2 - 2 * a1);
      hp.push([Math.cos(a) * ri, cy + Math.sin(a) * ri]);
    }
    hp.push([-pw, yb], [-pw, sightY - 0.0006], [-pw * 0.6, sightY], [pw * 0.6, sightY], [pw, sightY - 0.0006], [pw, yb]);
    holes = [hp];
  }
  const g = extrudeSection(outline, 0.0035, b.q, { bevel: 0.0003, holes });
  let m = mtx(0, 0, f - 0.00175);
  if (!up) m = pivotX(y0 + 0.001, f, -Math.PI / 2).multiply(m);
  b.geo(mat, g, m);
}

/** Outline of a ring (radius ro around (cx, cy)) sitting on a stem of half width sw from y0. */
function ringStem(cx, cy, ro, sw, y0, n) {
  const phi = Math.acos(Math.min(0.999, sw / ro));
  const yj = cy - Math.sqrt(Math.max(0, ro * ro - sw * sw));
  const pts = [[cx - sw, y0], [cx + sw, y0], [cx + sw, yj]];
  for (let i = 1; i < n; i++) {
    const a = -phi + (i / n) * (Math.PI + 2 * phi);
    pts.push([cx + Math.cos(a) * ro, cy + Math.sin(a) * ro]);
  }
  pts.push([cx - sw, yj]);
  return pts;
}

// ------------------------------------------------------------------ small details

/** Trigger blade hanging from (f, y) (top of the blade), curving forward. */
export function trigger(b, mat, f, y, o = {}) {
  const s = o.scale || 1;
  const p = [
    [f + 0.0025 * s, y], [f + 0.0012 * s, y - 0.007 * s, 0.002], [f + 0.0022 * s, y - 0.0135 * s, 0.003],
    [f + 0.0055 * s, y - 0.0178 * s, 0.0008], [f + 0.0030 * s, y - 0.0188 * s, 0.001], [f - 0.0018 * s, y - 0.0145 * s, 0.003],
    [f - 0.0032 * s, y - 0.007 * s, 0.003], [f - 0.0028 * s, y],
  ];
  b.side(mat, p, o.width || 0.0055, { bevel: 0.0005 });
}

/** Round screw/pin head on the side (x = +-half width). */
export function pin(b, mat, x, y, f, r = 0.0022, o = {}) {
  if (!b.fp) return;
  const len = o.len || 0.0016;
  b.cylX(mat, x, y, f, r, len, { seg: o.seg || 10, tint: o.tint });
}

/** Sling loop / swivel (torus) at (x, y, f), ring in the YZ plane by default. */
export function slingLoop(b, mat, x, y, f, r = 0.008, o = {}) {
  if (!b.fp && !o.keep) return;
  b.torus(mat, x, y, f, r, o.tube || 0.0016, { ry: o.ry ?? Math.PI / 2, rx: o.rx || 0, ts: b.fp ? 14 : 6, rs: b.fp ? 6 : 3 });
}

// ------------------------------------------------------------------ magazines

/**
 * Outline of a box magazine whose centre line runs straight down from the top (fc, yTop)
 * for `straight` metres then arcs forward with radius `radius` over `arc` metres.
 * Returns { pts, bottom: { x, y, nx, ny, tx, ty } }.
 */
export function magOutline(p) {
  const { fc, yTop, depth, straight, arc = 0, radius = 1, n = 8 } = p;
  const taper = p.taper || 0; // depth change at the bottom (+ = deeper)
  const total = straight + arc;
  const s0 = p.s0 ?? 0;
  const s1 = p.s1 ?? total;
  const sample = (s) => {
    if (s <= straight) return { x: fc, y: yTop - s, phi: 0 };
    const phi = (s - straight) / radius;
    return { x: fc + radius - radius * Math.cos(phi), y: yTop - straight - radius * Math.sin(phi), phi };
  };
  const ss = [s0];
  if (straight > s0 && straight < s1) ss.push(straight);
  const a0 = Math.max(s0, straight);
  if (s1 > a0 + 1e-6) {
    const steps = Math.max(1, Math.ceil(((s1 - a0) / Math.max(arc, 1e-6)) * n));
    for (let i = 1; i <= steps; i++) ss.push(a0 + ((s1 - a0) * i) / steps);
  } else if (ss[ss.length - 1] < s1) ss.push(s1);
  const front = [];
  const rear = [];
  for (const s of ss) {
    const { x, y, phi } = sample(s);
    const hd = depth / 2 + (taper * s) / total / 2;
    const nx = Math.cos(phi); const ny = Math.sin(phi);
    front.push([x + nx * hd, y + ny * hd]);
    rear.push([x - nx * hd, y - ny * hd]);
  }
  const end = sample(s1);
  return {
    pts: [...front, ...rear.reverse()],
    bottom: { x: end.x, y: end.y, nx: Math.cos(end.phi), ny: Math.sin(end.phi), tx: Math.sin(end.phi), ty: -Math.cos(end.phi), depth: depth + taper },
  };
}

/**
 * Curved/straight box magazine into builder m. p: magOutline params + { width, mat, plateMat,
 * ribs: 'side'|'ak'|'none', rounds: true, plate: thickness }.
 */
export function boxMag(m, mat, p) {
  const { pts, bottom } = magOutline(p);
  const w = p.width;
  m.side(mat, pts, w, { bevel: p.bevel ?? 0.0009, tint: p.tint });
  const bt = bottom;
  const pm = p.plateMat || mat;
  if (p.plate !== 0) {
    const th = p.plate || 0.006;
    const hd = bt.depth / 2;
    const ex = p.plateExtra ?? 0.0018;
    const P = (a, t) => [bt.x + bt.nx * a + bt.tx * t, bt.y + bt.ny * a + bt.ty * t];
    const plate = [P(hd + ex, -0.004), P(hd + ex, th - 0.004), P(-hd - ex * 0.5, th - 0.004), P(-hd - ex * 0.5, -0.004)];
    m.side(pm, plate.map((q, i) => [q[0], q[1], i === 1 || i === 2 ? 0.002 : 0]), w + (p.plateWide ?? 0.003), { bevel: 0.0008 });
  }
  const total = p.straight + (p.arc || 0);
  if (m.fp && p.ribs === 'side') {
    const inner = magOutline({ ...p, depth: p.depth - 0.012, s0: p.ribTop ?? 0.05, s1: total - 0.012 });
    m.side(mat, inner.pts, w + 0.0016, { bevel: 0.0006, tint: p.tint });
  } else if (m.fp && p.ribs === 'ak') {
    // stamped horizontal reinforcement ribs on AK magazines
    const count = p.ribCount || 5;
    for (let i = 0; i < count; i++) {
      const s0 = (p.ribTop ?? 0.06) + i * (p.ribGap ?? 0.028);
      if (s0 > total - 0.02) break;
      const q = magOutline({ ...p, depth: p.depth - 0.012, s0, s1: s0 + 0.008 });
      m.side(mat, q.pts, w + 0.0018, { bevel: 0.0005, tint: p.tint });
    }
  }
  if (m.fp && p.rounds !== false) {
    const rr = p.roundR || 0.0048;
    const len = p.roundLen || p.depth * 0.82;
    const top = p.yTop - rr - 0.001;
    m.tube('brass', rr, p.fc - len / 2, p.fc + len / 2 - rr * 1.6, { x: (p.width / 2 - rr) * 0.55, y: top, seg: 10 });
    m.tube('brass', [rr, rr * 0.25], p.fc + len / 2 - rr * 1.6, p.fc + len / 2, { x: (p.width / 2 - rr) * 0.55, y: top, seg: 10 });
  }
  return bottom;
}

// ------------------------------------------------------------------ muzzle devices

function slantTube(b, mat, x, y, f0, len, r, slant, dirAngle, o = {}) {
  // cylinder whose front face is cut obliquely: the side at `dirAngle` (0 = top, PI = bottom) is longer
  const segs = o.seg || b.q.segS;
  const geo = new THREE.CylinderGeometry(r, r, len, segs, 1, false);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > len / 2 - 1e-6) {
      const px = p.getX(i); const pz = p.getZ(i);
      // after rotateX(-PI/2): local +X -> +X, local -Z -> +Y ... compute in final orientation below
      const ux = px; const uy = -pz;
      const d = (ux * Math.sin(dirAngle) + uy * Math.cos(dirAngle)) / r; // -1..1 (1 = long side)
      p.setY(i, len / 2 - slant * (1 - d) / 2);
    }
  }
  const g = prep(geo, b.q, { creaseAngle: 0.6 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -len / 2);
  b.geo(mat, g, mtx(x, y, f0), o);
}

/**
 * Attach a muzzle device at barrel end f (barrel radius rb, bore at (o.x, o.y)).
 * type: 'flash' | 'comp' | 'suppressor' | 'none'; o.style selects weapon-specific variants.
 * Sets the 'muzzle' anchor at the very end and returns that f.
 */
export function muzzle(b, type, f, rb, o = {}) {
  const x = o.x || 0;
  const y = o.y || 0;
  const style = o.style || 'ar';
  const mat = o.mat || 'metal';
  const fp = b.fp;
  const seg = b.q.segS;
  let end = f;
  const bore = (fe, r) => { if (fp) b.dot(mat, x, y, fe - 0.0004, r, 'z', { tint: 0.03 }); };

  if (type === 'flash') {
    if (style === 'ak47') {
      // AKM slant compensator: lower-left lip longer
      slantTube(b, mat, x, y, f, 0.034, 0.0122, 0.011, Math.PI * 0.82, { seg });
      bore(f + 0.0235, 0.0058);
      end = f + 0.034;
    } else if (style === 'ak74') {
      const L = 0.083;
      b.lathe(mat, [[0, f], [0.0112, f], [0.0116, f + 0.012], [0.0124, f + 0.014], [0.0124, f + L - 0.003], [0.0112, f + L], [0.006, f + L], [0, f + L - 0.001]], { x, y, seg });
      if (fp) {
        for (const s of [-1, 1]) {
          b.hole(mat, x + s * 0.0118, y, f + 0.061, 0.0015, 0.0095, 0.022);
          b.hole(mat, x + s * 0.0112, y - 0.0025, f + 0.045, 0.0015, 0.004, 0.006);
        }
        for (let i = 0; i < 3; i++) b.dot(mat, x + 0.0052, y + 0.0114, f + 0.020 + i * 0.008, 0.0016, 'y', { tint: 0.04 });
        bore(f + L, 0.0055);
      }
      end = f + L;
    } else if (style === 'pkm' || style === 'svd') {
      const L = style === 'svd' ? 0.078 : 0.068;
      const r0 = 0.0105; const r1 = style === 'svd' ? 0.0118 : 0.0135;
      b.lathe(mat, [[0, f], [r0, f], [r0, f + 0.012], [r1, f + L - 0.002], [r1 - 0.0008, f + L], [0.0075, f + L], [0, f + L - 0.002]], { x, y, seg });
      if (fp) {
        const n = style === 'svd' ? 5 : 4;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + (style === 'svd' ? 0 : Math.PI / 4);
          const rr = (r0 + r1) / 2 + 0.0003;
          b.hole(mat, x + Math.sin(a) * rr, y + Math.cos(a) * rr, f + 0.016 + (L - 0.022) / 2, 0.0028, 0.0014, L - 0.026, { rz: -a });
        }
        bore(f + L, 0.0068);
      }
      end = f + L;
    } else if (style === 'pistol' || style === 'none') {
      bore(f, rb * 0.55);
    } else {
      // A2 birdcage, or open prong hiders ('scar' = 3 prongs, 'prong4' = 4 prongs)
      const prong = style === 'scar' || style === 'prong4';
      const L = prong ? 0.058 : 0.054;
      const R = 0.0112;
      if (!fp) {
        b.tube(mat, R, f, f + L, { x, y, seg });
      } else {
        b.lathe(mat, [[0, f], [R - 0.0012, f], [R, f + 0.0015], [R, f + 0.013], [0.0085, f + 0.0145], [0, f + 0.0145]], { x, y, seg });
        b.tube(mat, 0.0079, f + 0.013, f + L - 0.003, { x, y, seg: 12, tint: 0.12 });
        const bars = style === 'scar' ? [0, 2.094, 4.189] : style === 'prong4' ? [0.785, 2.356, 3.927, 5.498] : [0, 1.0, 2.1, 4.18, 5.28];
        for (const a of bars) {
          b.box(mat, x + Math.sin(a) * 0.0096, y + Math.cos(a) * 0.0096, f + 0.0145 + (L - 0.0145) / 2, prong ? 0.0055 : 0.0042, 0.0031, L - 0.0145, { rz: -a });
        }
        if (!prong) {
          b.box(mat, x, y - 0.0094, f + 0.0145 + (L - 0.0145 - 0.008) / 2, 0.0085, 0.0034, L - 0.0145 - 0.008);
          b.lathe(mat, [[0.0079, f + L - 0.008], [R, f + L - 0.008], [R, f + L - 0.0012], [R - 0.0012, f + L], [0.0079, f + L], [0.0079, f + L - 0.008]], { x, y, seg });
        }
        bore(f + L - 0.002, 0.0062);
      }
      end = f + L;
    }
  } else if (type === 'comp') {
    const s = o.scale || 1;
    const L = 0.060 * s;
    const R = 0.0122 * s;
    b.lathe(mat, [[0, f], [R - 0.0015, f], [R, f + 0.003], [R, f + L - 0.003], [R - 0.0022, f + L], [0.0062 * s, f + L], [0.0058 * s, f + L - 0.002], [0, f + L - 0.002]], { x, y, seg });
    if (fp) {
      for (const sd of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          b.hole(mat, x + sd * (R - 0.0003), y + 0.001 * s, f + L * (0.36 + i * 0.2), 0.0016, 0.0125 * s, 0.0055 * s);
        }
      }
      for (let i = 0; i < 2; i++) b.dot(mat, x, y + R - 0.0003, f + L * (0.4 + i * 0.22), 0.0022 * s, 'y', { tint: 0.04 });
      b.dot(mat, x, y, f + L - 0.0024, 0.0058 * s, 'z', { tint: 0.03 });
    }
    end = f + L;
  } else if (type === 'suppressor') {
    const R = o.r || 0.019;
    const L = o.len || 0.165;
    const rc = Math.max(rb + 0.003, R * 0.82);
    const sm = o.supMat || 'metal';
    const pts = [[0, f], [rc - 0.002, f], [rc, f + 0.002], [rc, f + 0.026], [R - 0.0015, f + 0.034], [R, f + 0.037]];
    if (fp) pts.push([R, f + 0.055], [R - 0.0004, f + 0.056], [R, f + 0.057]);
    pts.push([R, f + L - 0.006], [R - 0.0035, f + L], [0.006, f + L], [0.0052, f + L - 0.002], [0, f + L - 0.002]);
    b.lathe(sm, pts, { x, y, seg: b.q.seg });
    if (fp) {
      // wrench flats / grip grooves on the mount section
      for (let i = 0; i < 4; i++) b.tube(sm, rc + 0.0004, f + 0.006 + i * 0.005, f + 0.0085 + i * 0.005, { x, y, seg: b.q.seg, tint: 0.8 });
      b.dot(sm, x, y, f + L - 0.0024, 0.0052, 'z', { tint: 0.03 });
    }
    end = f + L;
  } else {
    bore(f, rb * 0.6);
  }
  b.anchor('muzzle', x, y, end);
  return end;
}

// ------------------------------------------------------------------ foregrips

/**
 * Foregrip hanging from a bottom rail whose outer surface is at height yb, centred at f.
 * Returns the left-hand anchor position [x, y, f].
 */
export function foregrip(b, type, f, yb, o = {}) {
  const x = o.x || 0;
  const mat = o.mat || 'polymer';
  if (type === 'vertical') {
    b.rbox(mat, x, yb - 0.003, f, 0.026, 0.013, 0.038, 0.003);
    const pts = [[0, -0.098], [0.0135, -0.098], [0.0158, -0.094], [0.0158, -0.082], [0.0149, -0.077], [0.0156, -0.071],
      [0.0156, -0.057], [0.0147, -0.052], [0.0154, -0.046], [0.0154, -0.032], [0.0145, -0.027], [0.0148, -0.012], [0.0128, -0.004], [0, -0.004]];
    b.latheY(mat, b.fp ? pts : [[0, -0.098], [0.015, -0.098], [0.015, -0.004], [0, -0.004]], x, yb - 0.005, f, { seg: b.fp ? 20 : 7 });
    return [x, yb - 0.055, f];
  }
  if (type === 'angled') {
    const top = yb + 0.0035;
    const pts = [[f + 0.052, top], [f - 0.056, top], [f - 0.063, top - 0.007, 0.004], [f - 0.058, yb - 0.031, 0.006],
      [f - 0.042, yb - 0.035, 0.008], [f - 0.012, yb - 0.023, 0.03], [f + 0.052, yb - 0.008, 0.004]];
    b.side(mat, pts, 0.031, { x, bevel: 0.0015 });
    return [x, yb - 0.022, f - 0.028];
  }
  return null;
}

// ------------------------------------------------------------------ bipod

/** Folded bipod (Harris-like) clamped at (f, y) under the gun; legs lie forward along the barrel. */
export function bipod(b, mat, f, y, legLen = 0.17, o = {}) {
  const sp = o.spread || 0.011;
  b.rbox(mat, 0, y - 0.006, f, 0.034, 0.014, 0.030, 0.003);
  if (b.fp) b.cylX(mat, 0, y - 0.009, f - 0.006, 0.006, 0.044, { seg: 12 });
  for (const s of [-1, 1]) {
    const lx = s * sp;
    b.tube(mat, 0.0052, f + 0.004, f + 0.004 + legLen * 0.62, { x: lx, y: y - 0.012, seg: b.q.segXS + 2 });
    b.tube(o.mat2 || 'steel', 0.0040, f + 0.004 + legLen * 0.62, f + legLen, { x: lx, y: y - 0.012, seg: b.q.segXS + 2 });
    b.rbox('rubber', lx, y - 0.012, f + legLen + 0.006, 0.010, 0.010, 0.014, 0.003);
    if (b.fp) {
      b.cylX(mat, lx, y - 0.012, f + 0.010, 0.0055, 0.004, { seg: 10 });
    }
  }
}

// ------------------------------------------------------------------ optics

/** Reticle quad sized so its feature subtends `moa` (radius) from distance `dist`. */
function reticleMesh(kind, x, y, f, dist, moaRadius) {
  const rr = dist * Math.tan(moaRadius * MOA);
  const half = rr / RETICLE_FEATURE[kind];
  const geo = new THREE.PlaneGeometry(half * 2, half * 2);
  const mesh = new THREE.Mesh(geo, getMaterial(`reticle_${kind}`));
  mesh.name = 'reticle';
  mesh.position.set(x, y, -f);
  mesh.renderOrder = 10;
  return mesh;
}

function lensMesh(x, y, f, r, segs = 40) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, segs), getMaterial('lens'));
  mesh.name = 'lens';
  mesh.position.set(x, y, -f);
  return mesh;
}

function glass(b, x, y, f, r, mat = 'glass') {
  b.tube(mat, r, f - 0.0003, f + 0.0003, { x, y, seg: b.fp ? 24 : 8 });
}

function railJaws(b, mat, x, railTop, f, len) {
  if (!b.fp) return;
  b.box(mat, x + 0.0118, railTop - 0.0028, f, 0.003, 0.0085, len);
  b.box(mat, x - 0.0118, railTop - 0.0028, f, 0.003, 0.0085, len);
}

/**
 * Mount optic `type` centred at f = fm on a rail whose top is at railTop.
 * o: { x, h (optical axis above rail), slide (builder for pistol slide mounting), eye (eye relief override),
 *      sideRail: { y, x } for the PSO dovetail, mat }.
 * Creates lens/reticle meshes and the 'sight' anchor. Returns { sightY, eyeF, lensRadius, x }.
 */
export function optic(b, type, fm, railTop, o = {}) {
  const x0 = o.x || 0;
  const t = o.slide || b;
  const fp = b.fp;
  const seg = b.q.seg;
  let res;
  if (type === 'reddot' && o.pistol) {
    // Trijicon RMR on a pistol slide
    const ya = railTop + 0.0118;
    t.rbox('anodized', x0, railTop + 0.003, fm - 0.004, 0.0245, 0.006, 0.045, 0.002);
    const outer = [[-0.0124, 0], [0.0124, 0], [0.0112, 0.0175, 0.002], [0.0062, 0.0245, 0.003], [-0.0062, 0.0245, 0.003], [-0.0112, 0.0175, 0.002]];
    const hole = [[-0.0095, 0.004], [-0.0083, 0.0165, 0.002], [-0.0045, 0.0212, 0.002], [0.0045, 0.0212, 0.002], [0.0083, 0.0165, 0.002], [0.0095, 0.004]];
    t.section('anodized', outer, fm + 0.002, fm + 0.016, { y: railTop, x: x0, holes: [hole] });
    t.rbox('anodized', x0, railTop + 0.009, fm - 0.016, 0.022, 0.014, 0.012, 0.003);
    if (fp) {
      t.box('anodized', x0 - 0.0112, railTop + 0.009, fm - 0.004, 0.003, 0.004, 0.006, {});
      t.box('anodized', x0 + 0.0112, railTop + 0.009, fm - 0.004, 0.003, 0.004, 0.006, {});
    }
    t.box('glass', x0, ya - 0.0005, fm + 0.0145, 0.019, 0.016, 0.0006);
    const eyeF = fm - 0.022 - (o.eye ?? 0.30);
    t.special(reticleMesh('reddot', x0, ya, fm + 0.014, fm + 0.014 - eyeF, 3.5));
    res = { sightY: ya, eyeF, lensRadius: 0, x: x0 };
  } else if (type === 'reddot') {
    // Aimpoint T-2 on a lower 1/3 riser
    const H = o.h ?? 0.039;
    const ya = railTop + H;
    const R = 0.0150;
    t.rbox('anodized', x0, railTop + 0.0045, fm, 0.023, 0.009, 0.032, 0.0015);
    railJaws(t, 'anodized', x0, railTop, fm, 0.028);
    if (fp) {
      t.cylX('anodized', x0 + 0.0165, railTop + 0.002, fm - 0.004, 0.0058, 0.006, { seg: 14 });
      t.cylX('steel', x0 + 0.0198, railTop + 0.002, fm - 0.004, 0.0025, 0.002, { seg: 10 });
    }
    const rb = railTop + 0.009;
    const tb = ya - R - 0.004;
    t.rbox('anodized', x0, (rb + tb) / 2 + 0.0005, fm, 0.021, tb - rb + 0.001, 0.026, 0.002);
    t.rbox('anodized', x0, ya - R - 0.001, fm, 0.025, 0.008, 0.040, 0.0025);
    t.lathe('anodized', [[0.0108, fm - 0.031], [R + 0.0003, fm - 0.031], [R + 0.0007, fm - 0.029], [R + 0.0007, fm - 0.024],
      [R, fm - 0.0225], [R, fm + 0.0225], [R + 0.0007, fm + 0.024], [R + 0.0007, fm + 0.029], [R + 0.0003, fm + 0.031],
      [0.0108, fm + 0.031], [0.0108, fm - 0.031]], { x: x0, y: ya, seg });
    t.cylY('anodized', x0, ya + R + 0.003, fm + 0.002, 0.0064, 0.007, { seg: 16 });
    t.cylX('anodized', x0 + R + 0.003, ya, fm + 0.002, 0.0064, 0.007, { seg: 16 });
    t.cylX('anodized', x0 - R - 0.004, ya, fm - 0.004, 0.0088, 0.008, { seg: 18 });
    if (fp) {
      t.cylY('anodized', x0, ya + R + 0.0072, fm + 0.002, 0.0058, 0.0016, { seg: 16, tint: 1.3 });
      t.cylX('anodized', x0 + R + 0.0072, ya, fm + 0.002, 0.0058, 0.0016, { seg: 16, tint: 1.3 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        t.box('anodized', x0 - R - 0.004, ya + Math.sin(a) * 0.0089, fm - 0.004 + Math.cos(a) * 0.0089, 0.0075, 0.0012, 0.0012, { rx: a });
      }
    }
    glass(t, x0, ya, fm - 0.026, 0.0108);
    glass(t, x0, ya, fm + 0.026, 0.0108);
    const eyeF = fm - 0.031 - (o.eye ?? 0.10);
    t.special(reticleMesh('reddot', x0, ya, fm + 0.012, fm + 0.012 - eyeF, 4));
    res = { sightY: ya, eyeF, lensRadius: 0, x: x0 };
  } else if (type === 'holo') {
    // EOTech EXPS3
    const H = o.h ?? 0.036;
    const ya = railTop + H;
    const base = [[fm - 0.048, 0], [fm + 0.048, 0], [fm + 0.048, 0.016, 0.004], [fm + 0.040, 0.0245, 0.004], [fm - 0.046, 0.0245, 0.002], [fm - 0.048, 0.021, 0.002]];
    t.side('anodized', base.map((p) => [p[0], p[1] + railTop, p[2]]), 0.033, { x: x0, bevel: 0.001 });
    railJaws(t, 'anodized', x0, railTop, fm - 0.01, 0.05);
    const outer = [[-0.0198, 0.019], [0.0198, 0.019], [0.0198, 0.051, 0.007], [-0.0198, 0.051, 0.007]];
    const hole = [[-0.0152, 0.0248, 0.0025], [-0.0152, 0.0472, 0.003], [0.0152, 0.0472, 0.003], [0.0152, 0.0248, 0.0025]];
    t.section('anodized', outer, fm - 0.046, fm + 0.012, { x: x0, y: railTop, holes: [hole], bevel: 0.0012 });
    t.cylX('anodized', x0 + 0.0175, railTop + 0.011, fm + 0.031, 0.0088, 0.006, { seg: 18 });
    if (fp) {
      t.cylX('anodized', x0 + 0.0208, railTop + 0.011, fm + 0.031, 0.0072, 0.0012, { seg: 18, tint: 1.4 });
      t.rbox('anodized', x0 - 0.0185, railTop + 0.006, fm - 0.012, 0.004, 0.007, 0.032, 0.0015); // QD lever
      for (let i = 0; i < 3; i++) t.rbox('rubber', x0 - 0.017, railTop + 0.0175, fm - 0.040 + i * 0.008, 0.003, 0.006, 0.006, 0.0012);
      t.hole('anodized', x0, railTop + 0.0225, fm - 0.0466, 0.006, 0.003, 0.0008, { tint: 0.4 });
    }
    t.box('glass', x0, ya, fm + 0.008, 0.0305, 0.0225, 0.0006);
    t.box('glass', x0, ya, fm - 0.042, 0.0305, 0.0225, 0.0006);
    const eyeF = fm - 0.046 - (o.eye ?? 0.10);
    t.special(reticleMesh('holo', x0, ya, fm + 0.004, fm + 0.004 - eyeF, 32.5));
    res = { sightY: ya, eyeF, lensRadius: 0, x: x0 };
  } else if (type === 'acog') {
    // Trijicon TA31 on a TA51 flat-top mount
    const H = o.h ?? 0.035;
    const ya = railTop + H;
    t.rbox('anodized', x0, railTop + 0.006, fm - 0.004, 0.026, 0.012, 0.072, 0.0025);
    railJaws(t, 'anodized', x0, railTop, fm - 0.004, 0.068);
    for (const df of [-0.030, 0.022]) {
      t.cylX('anodized', x0 - 0.019, railTop + 0.002, fm + df, 0.0078, 0.008, { seg: 16 });
      if (fp) t.cylX('steel', x0 - 0.0238, railTop + 0.002, fm + df, 0.004, 0.0016, { seg: 10 });
    }
    t.rbox('anodized', x0, ya - 0.0175, fm + 0.004, 0.024, 0.012, 0.084, 0.003);
    t.lathe('anodized', [[0, fm - 0.0688], [0.0110, fm - 0.0688], [0.0118, fm - 0.074], [0.0160, fm - 0.074], [0.0165, fm - 0.071],
      [0.0165, fm - 0.060], [0.0151, fm - 0.0565], [0.0151, fm - 0.040], [0.0176, fm - 0.030], [0.0205, fm + 0.005], [0.0218, fm + 0.042],
      [0.0236, fm + 0.050], [0.0236, fm + 0.0715], [0.0229, fm + 0.0745], [0.0174, fm + 0.0745], [0.0168, fm + 0.0712], [0, fm + 0.0712]],
    { x: x0, y: ya, seg });
    t.cylY('anodized', x0, ya + 0.0215, fm + 0.002, 0.0088, 0.009, { seg: 16 });
    t.cylX('anodized', x0 + 0.0215, ya, fm + 0.002, 0.0088, 0.009, { seg: 16 });
    if (fp) {
      t.rbox('anodized', x0, ya + 0.0222, fm - 0.040, 0.0085, 0.006, 0.040, 0.002);
      t.rbox('anodized', x0, ya + 0.0222, fm + 0.036, 0.0085, 0.005, 0.026, 0.002);
      t.tube('glow', 0.0013, fm - 0.058, fm - 0.022, { x: x0, y: ya + 0.0258, seg: 6, tint: [1, 0.12, 0.05] });
    }
    const lr = 0.0109;
    t.special(lensMesh(x0, ya, fm - 0.0690, lr));
    glass(t, x0, ya, fm + 0.0714, 0.0168, 'lensCoat');
    const eyeF = fm - 0.074 - (o.eye ?? 0.040);
    res = { sightY: ya, eyeF, lensRadius: lr, x: x0 };
  } else if (type === 'pso') {
    // PSO-1 with side (dovetail) mount on the left
    const ya = o.axisY ?? railTop + 0.035;
    t.lathe('metal', [[0, fm - 0.150], [0.0118, fm - 0.150], [0.0124, fm - 0.153], [0.0180, fm - 0.153], [0.0183, fm - 0.148],
      [0.0183, fm - 0.092], [0.0151, fm - 0.079], [0.0151, fm + 0.086], [0.0158, fm + 0.096], [0.0174, fm + 0.138], [0.0174, fm + 0.168],
      [0.0168, fm + 0.171], [0.0150, fm + 0.171], [0.0146, fm + 0.166], [0, fm + 0.166]], { x: x0, y: ya, seg });
    t.lathe('rubber', [[0.0146, fm - 0.208], [0.0196, fm - 0.208], [0.0199, fm - 0.203], [0.0186, fm - 0.185], [0.0176, fm - 0.165],
      [0.0186, fm - 0.156], [0.0186, fm - 0.150], [0.0150, fm - 0.150], [0.0146, fm - 0.208]], { x: x0, y: ya, seg });
    t.cylY('metal', x0, ya + 0.0235, fm - 0.004, 0.0165, 0.019, { seg: 22 });
    t.cylY('metal', x0, ya + 0.013, fm - 0.004, 0.0125, 0.006, { seg: 16 });
    t.cylX('metal', x0 + 0.024, ya, fm - 0.004, 0.0135, 0.016, { seg: 22 });
    t.cylX('metal', x0 + 0.014, ya, fm - 0.004, 0.0105, 0.006, { seg: 16 });
    t.cylX('metal', x0 - 0.019, ya + 0.004, fm + 0.050, 0.0072, 0.012, { seg: 14 });
    if (fp) {
      t.cylY('steel', x0, ya + 0.0335, fm - 0.004, 0.0158, 0.0012, { seg: 22, tint: 0.5 });
      t.cylX('steel', x0 + 0.0322, ya, fm - 0.004, 0.0128, 0.0012, { seg: 22, tint: 0.5 });
    }
    // side mount: bracket under the scope + plate down to the receiver's left dovetail
    const sr = o.sideRail || { y: railTop - 0.03, x: -0.016 };
    const px = sr.x - 0.006;
    t.rbox('metal', (x0 + px) / 2, ya - 0.017, fm - 0.012, Math.abs(x0 - px) + 0.016, 0.010, 0.094, 0.003);
    const plate = [[fm - 0.074, sr.y - 0.012, 0.004], [fm + 0.036, sr.y - 0.012, 0.004], [fm + 0.040, sr.y + 0.004, 0.006], [fm + 0.032, ya - 0.012, 0.004],
      [fm - 0.060, ya - 0.012, 0.004], [fm - 0.074, ya - 0.022, 0.006]];
    t.side('metal', plate, 0.008, { x: px });
    if (fp) {
      t.rbox('metal', px - 0.006, sr.y + 0.004, fm - 0.064, 0.006, 0.010, 0.030, 0.002); // clamp lever
      t.cylX('steel', px - 0.0045, sr.y - 0.002, fm - 0.040, 0.004, 0.003, { seg: 10 });
    }
    const lr = 0.0116;
    t.special(lensMesh(x0, ya, fm - 0.1506, lr));
    glass(t, x0, ya, fm + 0.1664, 0.0146, 'lensCoat');
    const eyeF = fm - 0.150 - (o.eye ?? 0.068);
    res = { sightY: ya, eyeF, lensRadius: lr, x: x0 };
  } else if (type === 'scope8') {
    const H = o.h ?? 0.033;
    const ya = railTop + H;
    const sm = o.mat || 'blued';
    t.lathe(sm, [[0, fm - 0.180], [0.0168, fm - 0.180], [0.0173, fm - 0.186], [0.0214, fm - 0.186], [0.0222, fm - 0.181],
      [0.0222, fm - 0.151], [0.0228, fm - 0.148], [0.0228, fm - 0.128], [0.0216, fm - 0.124], [0.0182, fm - 0.111], [0.0151, fm - 0.098],
      [0.0151, fm - 0.036], [0.0183, fm - 0.031], [0.0183, fm + 0.031], [0.0151, fm + 0.036], [0.0151, fm + 0.084],
      [0.0284, fm + 0.130], [0.0290, fm + 0.135], [0.0290, fm + 0.160], [0.0283, fm + 0.163], [0.0283, fm + 0.236],
      [0.0279, fm + 0.239], [0.0252, fm + 0.239], [0.0249, fm + 0.233], [0, fm + 0.233]], { x: x0, y: ya, seg: b.fp ? 28 : 10 });
    // turrets
    t.cylY(sm, x0, ya + 0.0205, fm, 0.0125, 0.007, { seg: 18 });
    t.cylY(sm, x0, ya + 0.0335, fm, 0.0168, 0.020, { seg: 24 });
    t.cylX(sm, x0 + 0.0205, ya, fm, 0.0125, 0.007, { seg: 18 });
    t.cylX(sm, x0 + 0.0315, ya, fm, 0.0158, 0.016, { seg: 24 });
    t.cylX(sm, x0 - 0.024, ya, fm, 0.0135, 0.014, { seg: 20 });
    if (fp) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        t.box(sm, x0 + Math.sin(a) * 0.0168, ya + 0.0345, fm + Math.cos(a) * 0.0168, 0.0016, 0.012, 0.0016, { ry: a });
        t.box(sm, x0 + 0.0322, ya + Math.sin(a) * 0.0158, fm + Math.cos(a) * 0.0158, 0.010, 0.0016, 0.0016, { rx: a });
      }
      t.cylY('paint', x0, ya + 0.0437, fm, 0.012, 0.0006, { seg: 18, tint: [0.9, 0.85, 0.75] });
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        t.box(sm, x0 + Math.cos(a) * 0.0229, ya + Math.sin(a) * 0.0229, fm - 0.138, 0.0016, 0.0016, 0.016, { rz: a });
      }
    }
    // rings
    for (const df of [-0.068, 0.060]) {
      t.lathe(sm, [[0.0150, fm + df - 0.0075], [0.0186, fm + df - 0.0075], [0.0188, fm + df + 0.0075], [0.0150, fm + df + 0.0075], [0.0150, fm + df - 0.0075]], { x: x0, y: ya, seg: b.fp ? 24 : 8 });
      t.rbox(sm, x0, (railTop + ya - 0.015) / 2, fm + df, 0.022, ya - 0.015 - railTop, 0.015, 0.002);
      railJaws(t, sm, x0, railTop, fm + df, 0.015);
      if (fp) {
        t.cylX('steel', x0 + 0.0125, railTop + 0.002, fm + df, 0.0035, 0.004, { seg: 10 });
        for (const s of [-1, 1]) t.cylX(sm, x0 + s * 0.0185, ya - 0.003, fm + df, 0.0026, 0.004, { seg: 8 });
      }
    }
    const lr = 0.0166;
    t.special(lensMesh(x0, ya, fm - 0.1802, lr));
    glass(t, x0, ya, fm + 0.2332, 0.0250, 'lensCoat');
    const eyeF = fm - 0.186 - (o.eye ?? 0.080);
    res = { sightY: ya, eyeF, lensRadius: lr, x: x0 };
  } else {
    return null;
  }
  b.anchor('sight', res.x, res.sightY, res.eyeF);
  b.root.meta.sightY = res.sightY;
  b.root.meta.lensRadius = res.lensRadius;
  return res;
}

/** Set the sight anchor for iron sights: rear aperture/notch at rearF, eye `relief` behind it. */
export function ironSight(b, sightY, rearF, relief = 0.08, x = 0) {
  b.anchor('sight', x, sightY, rearF - relief);
  b.root.meta.sightY = sightY;
  b.root.meta.lensRadius = 0;
}

// ------------------------------------------------------------------ grips

/**
 * Pistol-grip side outline along an axis starting at top centre (f, y), tilted `deg` back from
 * vertical, length L. front(s) / back(s) return half-depths at distance s down the axis.
 * Returns { pts, point(s) -> [f, y] on the axis }.
 */
export function gripOutline(f, y, deg, L, front, back, n = 10, bottomR = 0.007, o = {}) {
  const a = (deg * Math.PI) / 180;
  const dx = -Math.sin(a); const dy = -Math.cos(a);
  const px = Math.cos(a); const py = -Math.sin(a);
  const F = []; const B = [];
  const ext = o.topY !== undefined ? (o.ext ?? 0.02) : 0;
  for (let i = 0; i <= n; i++) {
    const s = -ext + ((L + ext) * i) / n;
    const sc = Math.max(0, s);
    F.push([f + dx * s + px * front(sc), y + dy * s + py * front(sc)]);
    B.push([f + dx * s - px * back(sc), y + dy * s - py * back(sc)]);
  }
  if (o.topY !== undefined) for (const p of [...F, ...B]) if (p[1] > o.topY) p[1] = o.topY;
  F[n][2] = bottomR;
  B[n][2] = bottomR;
  return { pts: [...F, ...B.reverse()], point: (s) => [f + dx * s, y + dy * s], dir: [dx, dy], perp: [px, py] };
}

/** Smooth bump helper for grip profiles: amplitude a at s0 with width w. */
export const bump = (s, s0, w, a) => a * Math.exp(-((s - s0) * (s - s0)) / (w * w));
