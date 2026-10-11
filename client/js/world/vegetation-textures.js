// Procedural textures for SHUTE REAL vegetation and rocks.
// Everything is generated in code: tileable noise fields (CPU), bark albedo + normal maps,
// canvas-painted foliage cards (needles, sprays, leaves, fronds, twigs) with alpha, and a
// tileable granite albedo/normal pair for rocks.
import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Random numbers / hashing
// ---------------------------------------------------------------------------------------------

/** Small fast seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash (uint32). */
export function hashInt(x) {
  x = Math.imul((x ^ (x >>> 16)) >>> 0, 0x7feb352d);
  x = Math.imul((x ^ (x >>> 15)) >>> 0, 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Deterministic hash of a world position (+ salt) to [0, 1). */
export function hash2(x, z, salt = 0) {
  const ix = Math.floor(x * 16) | 0;
  const iz = Math.floor(z * 16) | 0;
  return hashInt(hashInt(ix ^ Math.imul(salt + 1, 0x9e3779b1)) ^ Math.imul(iz, 0x85ebca6b)) / 4294967296;
}

const smooth5 = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------------------------
// Tileable 2D noise fields (CPU, row-separable so they are fast enough at 512²)
// ---------------------------------------------------------------------------------------------

function addValueOctave(out, w, h, cx, cy, amp, rng) {
  const lat = new Float32Array(cx * cy);
  for (let i = 0; i < lat.length; i++) lat[i] = rng() * 2 - 1;
  const x0 = new Int32Array(w);
  const x1 = new Int32Array(w);
  const xt = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const fx = (x + 0.5) * cx / w;
    const i = Math.floor(fx);
    x0[x] = i % cx;
    x1[x] = (i + 1) % cx;
    xt[x] = smooth5(fx - i);
  }
  const row = new Float32Array(cx);
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) * cy / h;
    const j = Math.floor(fy);
    const t = smooth5(fy - j);
    const j0 = (j % cy) * cx;
    const j1 = ((j + 1) % cy) * cx;
    for (let i = 0; i < cx; i++) {
      const a = lat[j0 + i];
      row[i] = a + (lat[j1 + i] - a) * t;
    }
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const a = row[x0[x]];
      out[o + x] += (a + (row[x1[x]] - a) * xt[x]) * amp;
    }
  }
}

/**
 * Tileable fractal value noise in roughly [-1, 1].
 * cx/cy = lattice cells across the texture for the first octave (anisotropic allowed).
 */
export function fbm(w, h, { cx = 4, cy = cx, octaves = 5, gain = 0.5, seed = 1 } = {}) {
  const out = new Float32Array(w * h);
  const rng = mulberry32(seed * 7919 + 13);
  let amp = 1;
  let sum = 0;
  let fx = cx;
  let fy = cy;
  for (let o = 0; o < octaves; o++) {
    addValueOctave(out, w, h, Math.min(w, Math.max(1, Math.round(fx))), Math.min(h, Math.max(1, Math.round(fy))), amp, rng);
    sum += amp;
    amp *= gain;
    fx *= 2;
    fy *= 2;
  }
  const inv = 1 / sum;
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}

/**
 * Tileable Worley (cellular) noise. Distances are measured in cell units, so cx != cy gives
 * elongated cells. Returns { f1, f2, id } (id = random [0,1) per nearest cell).
 */
export function worley(w, h, cx, cy, seed = 1, jitter = 0.9) {
  const rng = mulberry32(seed * 104729 + 7);
  const n = cx * cy;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pid = new Float32Array(n);
  for (let j = 0; j < cy; j++) {
    for (let i = 0; i < cx; i++) {
      const k = j * cx + i;
      px[k] = i + 0.5 + (rng() - 0.5) * jitter;
      py[k] = j + 0.5 + (rng() - 0.5) * jitter;
      pid[k] = rng();
    }
  }
  const f1 = new Float32Array(w * h);
  const f2 = new Float32Array(w * h);
  const id = new Float32Array(w * h);
  const qx = new Float32Array(9);
  const qy = new Float32Array(9);
  const qi = new Float32Array(9);
  const sx = cx / w;
  const sy = cy / h;
  for (let cj = 0; cj < cy; cj++) {
    const yStart = Math.max(0, Math.ceil(cj / sy - 0.5));
    const yEnd = Math.min(h, Math.ceil((cj + 1) / sy - 0.5));
    for (let ci = 0; ci < cx; ci++) {
      let m = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = ci + di;
          const jj = cj + dj;
          const wi = (ii + cx) % cx;
          const wj = (jj + cy) % cy;
          const k = wj * cx + wi;
          qx[m] = px[k] + (ii - wi);
          qy[m] = py[k] + (jj - wj);
          qi[m] = pid[k];
          m++;
        }
      }
      const xStart = Math.max(0, Math.ceil(ci / sx - 0.5));
      const xEnd = Math.min(w, Math.ceil((ci + 1) / sx - 0.5));
      for (let y = yStart; y < yEnd; y++) {
        const fy = (y + 0.5) * sy;
        const o = y * w;
        for (let x = xStart; x < xEnd; x++) {
          const fx = (x + 0.5) * sx;
          let d1 = 1e9;
          let d2 = 1e9;
          let best = 0;
          for (let k = 0; k < 9; k++) {
            const dx = fx - qx[k];
            const dy = fy - qy[k];
            const d = dx * dx + dy * dy;
            if (d < d1) { d2 = d1; d1 = d; best = qi[k]; } else if (d < d2) d2 = d;
          }
          f1[o + x] = Math.sqrt(d1);
          f2[o + x] = Math.sqrt(d2);
          id[o + x] = best;
        }
      }
    }
  }
  return { f1, f2, id };
}

/** Samples `src` (wrap-around) at positions displaced by (wx, wy) * amp pixels. Bilinear. */
export function warpField(src, S, wx, wy, ampX, ampY = ampX, nearest = false) {
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let fx = x + wx[i] * ampX;
      let fy = y + wy[i] * ampY;
      fx -= Math.floor(fx / S) * S;
      fy -= Math.floor(fy / S) * S;
      const x0 = fx | 0;
      const y0 = fy | 0;
      if (nearest) { out[i] = src[(y0 % S) * S + (x0 % S)]; continue; }
      const tx = fx - x0;
      const ty = fy - y0;
      const x1 = (x0 + 1) % S;
      const y1 = (y0 + 1) % S;
      const a = src[y0 * S + x0];
      const b = src[y0 * S + x1];
      const c = src[y1 * S + x0];
      const d = src[y1 * S + x1];
      out[i] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

/** Tangent-space normal map (RGBA8, wrap-around) from a height field. Row index = +v. */
export function heightToNormal(hgt, w, h, strength, out = new Uint8Array(w * h * 4), offset = 0) {
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w;
    const yp = ((y + 1) % h) * w;
    const yo = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      const dx = (hgt[yo + xp] - hgt[yo + xm]) * strength;
      const dy = (hgt[yp + x] - hgt[ym + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = offset + (yo + x) * 4;
      out[i] = (-dx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Foliage painters (canvas 2D, transparent background). Coordinates are normalised [0,1]
// with y down (canvas convention). Strokes/fills are batched per colour bucket for speed.
// ---------------------------------------------------------------------------------------------

const TAU = Math.PI * 2;

function hsl(h, s, l, a = 1) {
  return `hsla(${h.toFixed(0)},${(s * 100).toFixed(0)}%,${(l * 100).toFixed(1)}%,${a})`;
}

/** Collects line segments / quadratic curves / polygons per style and draws each bucket once. */
class Batch {
  constructor() {
    this.lines = new Map();
    this.polys = new Map();
  }

  line(style, width, x0, y0, x1, y1, cx = null, cy = null) {
    const key = `${style}|${width}`;
    let a = this.lines.get(key);
    if (!a) { a = []; this.lines.set(key, a); }
    a.push(x0, y0, cx === null ? (x0 + x1) * 0.5 : cx, cy === null ? (y0 + y1) * 0.5 : cy, x1, y1);
  }

  poly(style, pts) {
    let a = this.polys.get(style);
    if (!a) { a = []; this.polys.set(style, a); }
    a.push(pts);
  }

  flush(ctx) {
    for (const [style, list] of this.polys) {
      ctx.fillStyle = style;
      ctx.beginPath();
      for (const p of list) {
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
        ctx.closePath();
      }
      ctx.fill();
    }
    for (const [key, a] of this.lines) {
      const k = key.lastIndexOf('|');
      ctx.strokeStyle = key.slice(0, k);
      ctx.lineWidth = +key.slice(k + 1);
      ctx.beginPath();
      for (let i = 0; i < a.length; i += 6) {
        ctx.moveTo(a[i], a[i + 1]);
        ctx.quadraticCurveTo(a[i + 2], a[i + 3], a[i + 4], a[i + 5]);
      }
      ctx.stroke();
    }
    this.lines.clear();
    this.polys.clear();
  }
}

/** Curved polyline from (x,y) along angle a (0 = up), bending by `bend` rad over its length. */
function curvePath(x, y, a, len, bend, steps = 8, wobble = 0, rng = Math.random) {
  const pts = [[x, y]];
  let ang = a;
  const step = len / steps;
  for (let i = 0; i < steps; i++) {
    ang += bend / steps + (rng() - 0.5) * wobble;
    x += Math.sin(ang) * step;
    y -= Math.cos(ang) * step;
    pts.push([x, y]);
  }
  return pts;
}

function pathPoint(pts, t) {
  const f = Math.max(0, Math.min(1, t)) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const k = f - i;
  const a = pts[i];
  const b = pts[i + 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return { x: a[0] + dx * k, y: a[1] + dy * k, ang: Math.atan2(dx, -dy) };
}

function pathLen(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

function strokeTwig(batch, pts, w0, w1, style) {
  for (let i = 0; i < pts.length - 1; i++) {
    const t = i / Math.max(1, pts.length - 2);
    const w = Math.round((w0 + (w1 - w0) * t) * 2000) / 2000;
    batch.line(style, w, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  }
}

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];

/** Needle brushes along a shoot: paired needles angled forward, palette chosen by layer. */
function needleShoot(batch, rng, pts, { count, len, spread, width, pal, tipShort = 0.4, skip = 0.12 }) {
  for (let i = 0; i < count; i++) {
    const t = 0.06 + 0.94 * (i / count);
    const p = pathPoint(pts, t);
    const lenT = len * (1 - tipShort * smoothstep(0.7, 1.0, t));
    for (let side = -1; side <= 1; side += 2) {
      if (rng() < skip) continue;
      const da = side * (spread[0] + rng() * (spread[1] - spread[0]));
      const ang = p.ang + da;
      const L = lenT * (0.75 + rng() * 0.45);
      const x1 = p.x + Math.sin(ang) * L;
      const y1 = p.y - Math.cos(ang) * L;
      const cx = p.x + Math.sin(ang - da * 0.25) * L * 0.55;
      const cy = p.y - Math.cos(ang - da * 0.25) * L * 0.55;
      batch.line(pick(pal, rng), width, p.x, p.y, x1, y1, cx, cy);
    }
  }
}

function paintPine(ctx, rng) {
  // Radial needle clump: shoots radiate from the centre, each a dense brush of long needles.
  const batch = new Batch();
  const dark = [hsl(105, 0.42, 0.09), hsl(110, 0.4, 0.11), hsl(98, 0.38, 0.1), hsl(115, 0.36, 0.12)];
  const mid = [hsl(100, 0.4, 0.15), hsl(108, 0.38, 0.17), hsl(95, 0.42, 0.16), hsl(112, 0.34, 0.19)];
  const lite = [hsl(92, 0.42, 0.22), hsl(100, 0.38, 0.25), hsl(88, 0.45, 0.24), hsl(105, 0.3, 0.28)];
  const twig = hsl(25, 0.3, 0.2);
  const shoots = [];
  const n = 12 + Math.floor(rng() * 3);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + (rng() - 0.5) * 0.4;
    const len = 0.24 + rng() * 0.16;
    const r0 = 0.02 + rng() * 0.04;
    shoots.push(curvePath(0.5 + Math.sin(a) * r0, 0.5 - Math.cos(a) * r0, a, len, (rng() - 0.5) * 0.6, 6, 0.08, rng));
  }
  // inner short shoots to fill the core
  for (let k = 0; k < 7; k++) {
    const a = rng() * TAU;
    shoots.push(curvePath(0.5, 0.5, a, 0.1 + rng() * 0.1, 0, 4, 0.1, rng));
  }
  for (const s of shoots) strokeTwig(batch, s, 0.008, 0.004, twig);
  batch.flush(ctx);
  for (const s of shoots) needleShoot(batch, rng, s, { count: 30, len: 0.075, spread: [0.25, 0.75], width: 0.0045, pal: dark, skip: 0.05 });
  batch.flush(ctx);
  for (const s of shoots) needleShoot(batch, rng, s, { count: 26, len: 0.07, spread: [0.3, 0.8], width: 0.004, pal: mid });
  batch.flush(ctx);
  for (const s of shoots) needleShoot(batch, rng, s.slice(Math.floor(s.length / 3)), { count: 16, len: 0.06, spread: [0.35, 0.85], width: 0.0035, pal: lite, skip: 0.3 });
  batch.flush(ctx);
}

function paintSpruce(ctx, rng) {
  // Flat spray: main axis with alternating side branchlets (fan), dense short needles.
  const batch = new Batch();
  const dark = [hsl(130, 0.32, 0.08), hsl(140, 0.3, 0.1), hsl(125, 0.34, 0.09)];
  const mid = [hsl(128, 0.32, 0.14), hsl(138, 0.28, 0.16), hsl(122, 0.34, 0.13), hsl(145, 0.25, 0.15)];
  const main = curvePath(0.5, 1.0, (rng() - 0.5) * 0.15, 0.92, (rng() - 0.5) * 0.2, 10, 0.03, rng);
  const twigs = [main];
  const n = 16;
  for (let k = 0; k < n; k++) {
    const t = 0.08 + 0.86 * (k / (n - 1));
    const p = pathPoint(main, t);
    const side = k % 2 === 0 ? -1 : 1;
    const env = Math.sin(Math.PI * Math.min(1, 0.2 + 0.9 * (1 - t))) * 0.85 + 0.15;
    const len = (0.3 + rng() * 0.1) * env + 0.03;
    const a = p.ang + side * (0.9 + rng() * 0.3);
    const tw = curvePath(p.x, p.y, a, len, -side * 0.4, 6, 0.04, rng);
    twigs.push(tw);
    if (len > 0.12) {
      for (let q = 0; q < 3; q++) {
        const pp = pathPoint(tw, 0.3 + q * 0.22);
        twigs.push(curvePath(pp.x, pp.y, pp.ang + side * 0.75 * (q % 2 ? -1 : 1), len * (0.38 - q * 0.06), 0, 3, 0.05, rng));
      }
    }
  }
  for (const t of twigs) strokeTwig(batch, t, 0.007, 0.003, hsl(25, 0.35, 0.2));
  batch.flush(ctx);
  for (const pal of [dark, mid]) {
    for (const tw of twigs) {
      const count = Math.ceil(pathLen(tw) / 0.0055);
      needleShoot(batch, rng, tw, { count, len: 0.03, spread: [0.8, 1.3], width: pal === dark ? 0.0048 : 0.0042, pal, tipShort: 0.3, skip: pal === dark ? 0 : 0.2 });
    }
    batch.flush(ctx);
  }
}

function paintAraucaria(ctx, rng) {
  // Fan of rope-like branchlets covered by overlapping stiff pointed leaves.
  const batch = new Batch();
  const pals = [
    [hsl(110, 0.42, 0.09), hsl(118, 0.4, 0.11), hsl(104, 0.44, 0.1)],
    [hsl(108, 0.42, 0.15), hsl(116, 0.38, 0.17), hsl(100, 0.45, 0.16), hsl(120, 0.35, 0.19)],
  ];
  const n = 9 + Math.floor(rng() * 3);
  const ropes = [];
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1) - 0.5;
    const a = f * 2.6 + (rng() - 0.5) * 0.2;
    const len = 0.42 + rng() * 0.12 - Math.abs(f) * 0.1;
    ropes.push(curvePath(0.5 + f * 0.05, 0.96, a, len, -f * 1.2 + (rng() - 0.5) * 0.3, 8, 0.05, rng));
  }
  for (const r of ropes) strokeTwig(batch, r, 0.014, 0.007, hsl(30, 0.3, 0.18));
  batch.flush(ctx);
  for (let layer = 0; layer < 2; layer++) {
    for (const r of ropes) {
      const count = 64;
      for (let i = 0; i < count; i++) {
        const t = (i + rng() * 0.5) / count;
        const p = pathPoint(r, t);
        const w = 0.042 * (1 - 0.4 * t) * (layer ? 0.85 : 1);
        for (let s = 0; s < 3; s++) {
          const side = s === 0 ? -1 : s === 1 ? 1 : (rng() - 0.5) * 0.5;
          const ang = p.ang + side * (0.5 + rng() * 0.45);
          const L = w * (0.85 + rng() * 0.5);
          const x1 = p.x + Math.sin(ang) * L;
          const y1 = p.y - Math.cos(ang) * L;
          const nx = Math.cos(ang) * L * 0.16;
          const ny = Math.sin(ang) * L * 0.16;
          batch.poly(pick(pals[layer], rng), [p.x - nx, p.y - ny, x1, y1, p.x + nx, p.y + ny]);
        }
      }
    }
    batch.flush(ctx);
  }
}

function leafPoly(x, y, ang, len, width, shape) {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const steps = shape === 'oak' ? 16 : 8;
  const half = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let hw;
    if (shape === 'birch') hw = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.9) * (1 - 0.25 * t);
    else if (shape === 'oak') hw = Math.sin(Math.PI * Math.pow(t, 0.8)) * (0.6 + 0.4 * Math.abs(Math.sin(t * Math.PI * 4.5)));
    else hw = Math.sin(Math.PI * t);
    half.push(t * len, hw * width * 0.5);
  }
  const pts = [];
  for (let i = 0; i < half.length; i += 2) pts.push(x + sa * half[i] + ca * half[i + 1], y - ca * half[i] + sa * half[i + 1]);
  for (let i = half.length - 4; i > 0; i -= 2) pts.push(x + sa * half[i] - ca * half[i + 1], y - ca * half[i] - sa * half[i + 1]);
  return pts;
}

function paintLeafCluster(ctx, rng, { shape, count, size, hue, sat, lum, droop = 0, spread = 1.2, twigHue = 28 }) {
  // Fan-shaped twig system from the bottom centre, leaves along all outer twigs.
  const batch = new Batch();
  const twigs = [];
  const main = curvePath(0.5, 1.0, (rng() - 0.5) * 0.2, 0.5, (rng() - 0.5) * 0.3, 8, 0.06, rng);
  twigs.push(main);
  const nb = 9 + Math.floor(rng() * 3);
  for (let k = 0; k < nb; k++) {
    const t = 0.15 + 0.85 * (k / nb) + rng() * 0.05;
    const p = pathPoint(main, t);
    const side = k % 2 ? 1 : -1;
    const a = p.ang + side * spread * (0.35 + rng() * 0.75);
    const tw = curvePath(p.x, p.y, a, 0.22 + rng() * 0.2, side * droop + (rng() - 0.5) * 0.4, 6, 0.1, rng);
    twigs.push(tw);
    const pp = pathPoint(tw, 0.5);
    twigs.push(curvePath(pp.x, pp.y, pp.ang - side * 0.6, 0.1 + rng() * 0.08, 0, 3, 0.1, rng));
  }
  for (const t of twigs) strokeTwig(batch, t, 0.006, 0.0025, hsl(twigHue, 0.25, 0.2));
  batch.flush(ctx);
  const leaves = [];
  for (let i = 0; i < count; i++) {
    const tw = twigs[1 + Math.floor(rng() * (twigs.length - 1))];
    const t = 0.15 + 0.85 * Math.sqrt(rng());
    const p = pathPoint(tw, t);
    const side = rng() < 0.5 ? -1 : 1;
    const ang = p.ang + side * (0.3 + rng() * 1.1) + droop * 0.5 * side;
    leaves.push({ x: p.x, y: p.y, ang, L: size * (0.75 + rng() * 0.5), depth: rng() });
  }
  leaves.sort((a, b) => a.depth - b.depth);
  // 3 depth layers so overlapping order stays plausible
  for (let layer = 0; layer < 3; layer++) {
    const pal = [];
    for (let k = 0; k < 4; k++) pal.push(hsl(hue + (k - 1.5) * 5, sat * (0.88 + 0.08 * k), lum * (0.68 + 0.17 * layer + 0.05 * k)));
    const rib = hsl(hue + 6, sat * 0.6, Math.min(0.6, lum * (1.05 + 0.2 * layer)), 0.6);
    for (const lf of leaves) {
      if (Math.min(2, Math.floor(lf.depth * 3)) !== layer) continue;
      const petiole = lf.L * 0.18;
      const px = lf.x + Math.sin(lf.ang) * petiole;
      const py = lf.y - Math.cos(lf.ang) * petiole;
      batch.line(hsl(hue, sat * 0.5, lum * 0.6), 0.003, lf.x, lf.y, px, py);
      batch.poly(pick(pal, rng), leafPoly(px, py, lf.ang, lf.L, lf.L * (shape === 'oak' ? 0.64 : shape === 'birch' ? 0.7 : 0.56), shape));
      batch.line(rib, 0.0025, px, py, px + Math.sin(lf.ang) * lf.L * 0.8, py - Math.cos(lf.ang) * lf.L * 0.8);
    }
    batch.flush(ctx);
  }
}

function paintFern(ctx, rng) {
  // One pinnate frond, rachis from bottom centre to the top, lanceolate outline.
  const batch = new Batch();
  const rachis = curvePath(0.5, 1.0, (rng() - 0.5) * 0.08, 0.96, (rng() - 0.5) * 0.15, 16, 0.01, rng);
  strokeTwig(batch, rachis, 0.011, 0.004, hsl(78, 0.4, 0.26));
  const pal = [hsl(84, 0.52, 0.22), hsl(90, 0.5, 0.25), hsl(80, 0.55, 0.27), hsl(95, 0.45, 0.29), hsl(86, 0.55, 0.31)];
  const pairs = 20;
  for (let k = 0; k < pairs; k++) {
    const t = 0.05 + 0.93 * (k / pairs);
    const p = pathPoint(rachis, t);
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.9)), 0.8) * (1 - 0.35 * t);
    const L = 0.46 * env * (0.92 + rng() * 0.1) + 0.02;
    for (let side = -1; side <= 1; side += 2) {
      const a = p.ang + side * (1.2 - 0.3 * t);
      const pin = curvePath(p.x, p.y, a, L, -side * 0.3, 7, 0, rng);
      strokeTwig(batch, pin, 0.0035, 0.002, hsl(82, 0.45, 0.28));
      const lobes = Math.max(3, Math.round(L / 0.02));
      for (let q = 0; q < lobes; q++) {
        const s = (q + 0.5) / lobes;
        const pp = pathPoint(pin, s);
        const w = 0.02 * (1 - 0.55 * s) * (0.65 + env * 0.45);
        for (let ls = -1; ls <= 1; ls += 2) {
          const la = pp.ang + ls * 1.25;
          const cx = pp.x + Math.sin(la) * w * 0.5;
          const cy = pp.y - Math.cos(la) * w * 0.5;
          const poly = [];
          for (let e = 0; e < 7; e++) {
            const th = (e / 7) * TAU;
            const ex = Math.cos(th) * w * 0.62;
            const ey = Math.sin(th) * w * 0.4;
            poly.push(cx + ex * Math.cos(la) - ey * Math.sin(la), cy + ex * Math.sin(la) + ey * Math.cos(la));
          }
          batch.poly(pick(pal, rng), poly);
        }
      }
    }
  }
  batch.flush(ctx);
}

function paintJuniper(ctx, rng) {
  // Dense branching twigs covered by short sharp blue-green needles.
  const batch = new Batch();
  const twigs = [];
  const grow = (x, y, a, len, depth) => {
    const p = curvePath(x, y, a, len, (rng() - 0.5) * 0.6, 5, 0.1, rng);
    twigs.push({ p, depth });
    if (depth < 3) {
      const nb = 2 + Math.floor(rng() * 2);
      for (let k = 0; k < nb; k++) {
        const pt = pathPoint(p, 0.35 + rng() * 0.6);
        grow(pt.x, pt.y, pt.ang + (rng() < 0.5 ? -1 : 1) * (0.4 + rng() * 0.6), len * (0.55 + rng() * 0.2), depth + 1);
      }
    }
  };
  for (let k = 0; k < 4; k++) grow(0.5 + (k - 1.5) * 0.04, 1.0, (k - 1.5) * 0.45 + (rng() - 0.5) * 0.3, 0.4, 0);
  for (const t of twigs) strokeTwig(batch, t.p, 0.008 / (t.depth + 1), 0.0025, hsl(25, 0.3, 0.22));
  batch.flush(ctx);
  const pals = [
    [hsl(150, 0.18, 0.13), hsl(160, 0.16, 0.15), hsl(145, 0.2, 0.14)],
    [hsl(152, 0.18, 0.24), hsl(165, 0.16, 0.28), hsl(148, 0.2, 0.22), hsl(170, 0.14, 0.32)],
  ];
  for (const pal of pals) {
    for (const t of twigs) needleShoot(batch, rng, t.p, { count: 24 - t.depth * 3, len: 0.032, spread: [0.5, 1.0], width: 0.0045, pal, skip: 0.1 });
    batch.flush(ctx);
  }
}

function paintTwigs(ctx, rng) {
  // Bare dead twigs (fine branching silhouette).
  const batch = new Batch();
  const pal = [hsl(28, 0.12, 0.2), hsl(30, 0.1, 0.25), hsl(25, 0.12, 0.3)];
  const grow = (x, y, a, len, w, depth) => {
    const p = curvePath(x, y, a, len, (rng() - 0.5) * 0.5, 5, 0.12, rng);
    strokeTwig(batch, p, w, w * 0.6, pick(pal, rng));
    if (depth < 4) {
      const nb = 2 + (rng() < 0.4 ? 1 : 0);
      for (let k = 0; k < nb; k++) {
        const pt = pathPoint(p, 0.4 + rng() * 0.6);
        grow(pt.x, pt.y, pt.ang + (k % 2 ? 1 : -1) * (0.3 + rng() * 0.6), len * (0.55 + rng() * 0.2), w * 0.62, depth + 1);
      }
    }
  };
  grow(0.5, 1.0, (rng() - 0.5) * 0.3, 0.42, 0.016, 0);
  batch.flush(ctx);
}

// ---------------------------------------------------------------------------------------------
// GPU texture generation: bark (procedural shader) and foliage (canvas + pull-push dilation)
// are rendered straight into array render targets, so nothing is read back to the CPU.
// ---------------------------------------------------------------------------------------------

/** Layer indices of the vegetation texture arrays. Bark layers come first (they own normal maps). */
export const VEG_LAYERS = {
  barkPine: 0,
  barkAraucaria: 1,
  barkSpruce: 2,
  barkBirch: 3,
  barkOak: 4,
  barkDead: 5,
  pine: 6,
  spruce: 7,
  araucaria: 8,
  birch: 9,
  oak: 10,
  shrub: 11,
  fern: 12,
  juniper: 13,
  twigs: 14,
};
export const VEG_BARK_LAYERS = 6;
export const VEG_LAYER_COUNT = 15;

const BARK_STRENGTH = [9, 7, 6, 5, 10, 7];

const FOLIAGE = [
  ['pine', (c, r) => paintPine(c, r), 11],
  ['spruce', (c, r) => paintSpruce(c, r), 12],
  ['araucaria', (c, r) => paintAraucaria(c, r), 13],
  ['birch', (c, r) => paintLeafCluster(c, r, { shape: 'birch', count: 300, size: 0.06, hue: 86, sat: 0.5, lum: 0.32, droop: 0.6 }), 14],
  ['oak', (c, r) => paintLeafCluster(c, r, { shape: 'oak', count: 210, size: 0.088, hue: 95, sat: 0.42, lum: 0.23, droop: 0.1, spread: 1.3 }), 15],
  ['shrub', (c, r) => paintLeafCluster(c, r, { shape: 'ellipse', count: 260, size: 0.075, hue: 92, sat: 0.4, lum: 0.25, droop: 0.2, spread: 1.4 }), 16],
  ['fern', (c, r) => paintFern(c, r), 17],
  ['juniper', (c, r) => paintJuniper(c, r), 18],
  ['twigs', (c, r) => paintTwigs(c, r), 19],
];

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

/** Tileable GPU noise: hash (no sin), periodic gradient noise, fbm, periodic Worley. */
export const GLSL_TILE_NOISE = /* glsl */`
vec2 tnHash22( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.xx + p3.yz ) * p3.zy );
}
float tnHash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float tnGrad( vec2 p, vec2 per, float seed ) {
  vec2 i = floor( p );
  vec2 f = p - i;
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  vec2 s = vec2( seed * 37.0, seed * 91.0 );
  vec2 g00 = tnHash22( mod( i, per ) + s ) * 2.0 - 1.0;
  vec2 g10 = tnHash22( mod( i + vec2( 1.0, 0.0 ), per ) + s ) * 2.0 - 1.0;
  vec2 g01 = tnHash22( mod( i + vec2( 0.0, 1.0 ), per ) + s ) * 2.0 - 1.0;
  vec2 g11 = tnHash22( mod( i + vec2( 1.0, 1.0 ), per ) + s ) * 2.0 - 1.0;
  float a = dot( g00, f );
  float b = dot( g10, f - vec2( 1.0, 0.0 ) );
  float c = dot( g01, f - vec2( 0.0, 1.0 ) );
  float d = dot( g11, f - vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ) * 1.7;
}
// uv in [0,1), freq = integer lattice cells per tile for the first octave
float tnFbm( vec2 uv, vec2 freq, int oct, float seed ) {
  float s = 0.0;
  float a = 1.0;
  float n = 0.0;
  for ( int o = 0; o < 7; o ++ ) {
    if ( o >= oct ) break;
    s += a * tnGrad( uv * freq, freq, seed + float( o ) * 1.7 );
    n += a;
    freq *= 2.0;
    a *= 0.5;
  }
  return s / n;
}
// returns ( f1, f2, cell id ) in cell units
vec3 tnWorley( vec2 uv, vec2 cells, float jitter, float seed ) {
  vec2 p = uv * cells;
  vec2 i = floor( p );
  vec2 f = p - i;
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  vec2 s = vec2( seed * 13.0, seed * 29.0 );
  for ( int y = - 1; y <= 1; y ++ ) {
    for ( int x = - 1; x <= 1; x ++ ) {
      vec2 g = vec2( float( x ), float( y ) );
      vec2 c = mod( i + g, cells );
      vec2 o = 0.5 + ( tnHash22( c + s ) - 0.5 ) * jitter;
      vec2 r = g + o - f;
      float d = dot( r, r );
      if ( d < d1 ) { d2 = d1; d1 = d; id = tnHash12( c + s + 17.0 ); } else if ( d < d2 ) { d2 = d; }
    }
  }
  return vec3( sqrt( d1 ), sqrt( d2 ), id );
}
`;

const BARK_FRAG = /* glsl */`
uniform int uType;
varying vec2 vUv;
${GLSL_TILE_NOISE}
vec3 C( float r, float g, float b ) { return vec3( r, g, b ) / 255.0; }

float lenticels( vec2 uv ) {
  vec2 cells = vec2( 4.0, 34.0 );
  vec2 p = uv * cells;
  vec2 i = floor( p );
  float m = 0.0;
  for ( int y = - 1; y <= 1; y ++ ) {
    for ( int x = - 1; x <= 1; x ++ ) {
      vec2 g = vec2( float( x ), float( y ) );
      vec2 c = mod( i + g, cells );
      vec2 h = tnHash22( c + 51.0 );
      float on = step( 0.22, tnHash12( c + 53.0 ) );
      vec2 d = p - ( i + g + h );
      float len = 0.12 + 0.85 * tnHash12( c + 55.0 ) * tnHash12( c + 57.0 );
      float th = 0.08 + 0.14 * tnHash12( c + 59.0 );
      float ax = abs( d.x ) / len;
      float taper = max( 0.0, 1.0 - ax * ax );
      float dy = abs( d.y - d.x * 0.02 );
      float v = on * step( ax, 1.0 ) * ( 1.0 - smoothstep( th * taper * 0.45, th * taper + 1e-4, dy ) );
      m = max( m, v * ( 0.55 + 0.45 * tnHash12( c + 61.0 ) ) );
    }
  }
  return m;
}

vec4 barkPine( vec2 uv ) {
  vec2 w = vec2( tnFbm( uv, vec2( 4.0 ), 4, 1.0 ), tnFbm( uv, vec2( 4.0 ), 4, 7.0 ) );
  vec3 W = tnWorley( uv + w * vec2( 0.05, 0.07 ), vec2( 7.0, 3.0 ), 0.9, 3.0 );
  float mid = tnFbm( uv, vec2( 16.0 ), 3, 11.0 );
  float horz = tnFbm( uv, vec2( 4.0, 40.0 ), 3, 13.0 );
  float vert = tnFbm( uv, vec2( 48.0, 3.0 ), 3, 17.0 );
  float e = W.y - W.x + mid * 0.05;
  float plate = smoothstep( 0.03, 0.16, e );
  float fl = horz * 3.5 + mid;
  float lip = smoothstep( 0.0, 0.18, abs( fl - floor( fl + 0.5 ) ) );
  float h = plate * ( 0.55 + 0.2 * mid + 0.12 * lip + 0.12 * smoothstep( 0.15, 0.5, e ) ) + 0.04 * vert;
  vec3 c = mix( C( 96.0, 84.0, 76.0 ), C( 132.0, 86.0, 66.0 ), W.z ) * ( 0.82 + 0.22 * mid + 0.1 * lip );
  c = mix( c, C( 150.0, 86.0, 60.0 ), ( 1.0 - lip ) * plate * 0.55 );
  c = mix( C( 30.0, 24.0, 21.0 ), c, plate );
  return vec4( c, h );
}

vec4 barkAraucaria( vec2 uv ) {
  float low = tnFbm( uv, vec2( 4.0 ), 4, 21.0 );
  float mid = tnFbm( uv, vec2( 16.0 ), 3, 22.0 );
  float vert = tnFbm( uv, vec2( 48.0, 3.0 ), 3, 23.0 );
  float f = fract( uv.y * 10.0 + low * 0.5 + vert * 0.08 );
  float ring = smoothstep( 0.0, 0.07, f ) * ( 1.0 - smoothstep( 0.1, 0.32, f ) );
  float groove = smoothstep( 0.86, 1.0, f );
  float crack = 1.0 - smoothstep( 0.0, 0.12, abs( vert * 2.2 ) );
  float h = 0.5 + 0.12 * vert + 0.22 * ring - 0.28 * groove - 0.09 * crack + 0.07 * mid;
  vec3 c = C( 108.0, 98.0, 90.0 ) * ( 0.84 + 0.2 * low + 0.12 * vert + 0.06 * mid );
  c = mix( c, C( 58.0, 50.0, 46.0 ), max( groove * 0.7, crack * 0.35 ) );
  c = mix( c, C( 132.0, 120.0, 106.0 ), ring * 0.3 );
  return vec4( c, h );
}

vec4 barkSpruce( vec2 uv ) {
  vec2 w = vec2( tnFbm( uv, vec2( 4.0 ), 4, 31.0 ), tnFbm( uv, vec2( 4.0 ), 4, 32.0 ) );
  vec3 W = tnWorley( uv + w * vec2( 0.017, 0.02 ), vec2( 15.0, 13.0 ), 0.9, 33.0 );
  float low = tnFbm( uv, vec2( 4.0 ), 4, 34.0 );
  float mid = tnFbm( uv, vec2( 16.0 ), 3, 35.0 );
  float vert = tnFbm( uv, vec2( 48.0, 3.0 ), 3, 36.0 );
  float sc = smoothstep( 0.02, 0.2, W.y - W.x );
  float h = 0.32 + 0.38 * sc + 0.12 * mid + 0.06 * vert;
  vec3 c = mix( C( 100.0, 88.0, 78.0 ), C( 124.0, 84.0, 68.0 ), W.z ) * ( 0.86 + 0.2 * low + 0.1 * mid );
  c = mix( c, C( 52.0, 42.0, 36.0 ), ( 1.0 - sc ) * 0.75 );
  return vec4( c, h );
}

vec4 barkBirch( vec2 uv ) {
  float low = tnFbm( uv, vec2( 4.0 ), 4, 41.0 );
  float low2 = tnFbm( uv, vec2( 4.0 ), 4, 42.0 );
  float mid = tnFbm( uv, vec2( 16.0 ), 3, 43.0 );
  float horz = tnFbm( uv, vec2( 4.0, 40.0 ), 3, 44.0 );
  float patchy = smoothstep( 0.3, 0.48, low2 * 0.9 + horz * 0.45 );
  float l = lenticels( uv );
  float h = 0.6 + 0.08 * mid - 0.45 * l - 0.15 * patchy;
  vec3 c = C( 226.0, 222.0, 210.0 ) * ( 0.94 + 0.08 * low + 0.04 * mid );
  c = mix( c, C( 214.0, 190.0, 168.0 ), smoothstep( 0.1, 0.5, low ) * 0.35 );
  c = mix( c, C( 46.0, 42.0, 40.0 ), patchy * 0.85 );
  c = mix( c, C( 52.0, 46.0, 44.0 ), l );
  return vec4( c, h );
}

vec4 barkOak( vec2 uv ) {
  vec2 w = vec2( tnFbm( uv, vec2( 4.0 ), 4, 51.0 ), tnFbm( uv, vec2( 4.0 ), 4, 52.0 ) );
  vec3 W = tnWorley( uv + w * vec2( 0.055, 0.05 ), vec2( 11.0, 3.0 ), 0.9, 53.0 );
  float low = tnFbm( uv, vec2( 4.0 ), 4, 54.0 );
  float mid = tnFbm( uv, vec2( 16.0 ), 3, 55.0 );
  float vert = tnFbm( uv, vec2( 48.0, 3.0 ), 3, 56.0 );
  float horz = tnFbm( uv, vec2( 4.0, 40.0 ), 3, 57.0 );
  float e = W.y - W.x + vert * 0.06;
  float crossing = smoothstep( 0.55, 0.75, abs( horz * 2.0 ) ) * 0.6;
  float ridge = smoothstep( 0.05, 0.3, e ) * ( 1.0 - crossing );
  float h = ridge * ( 0.72 + 0.14 * mid ) + 0.04 + 0.04 * vert;
  float top = smoothstep( 0.45, 0.8, h );
  vec3 c = mix( C( 70.0, 64.0, 57.0 ), C( 116.0, 110.0, 100.0 ), top ) * ( 0.86 + 0.18 * mid + 0.1 * low );
  c = mix( c, C( 30.0, 31.0, 24.0 ), 1.0 - smoothstep( 0.0, 0.25, ridge ) );
  return vec4( c, h );
}

vec4 barkDead( vec2 uv ) {
  vec2 w = vec2( tnFbm( uv, vec2( 4.0 ), 4, 61.0 ), tnFbm( uv, vec2( 4.0 ), 4, 62.0 ) );
  vec3 W = tnWorley( uv + w * vec2( 0.028, 0.1 ), vec2( 9.0, 1.0 ), 0.9, 63.0 );
  float low = tnFbm( uv, vec2( 4.0 ), 4, 64.0 );
  float low2 = tnFbm( uv, vec2( 4.0 ), 4, 65.0 );
  float mid = tnFbm( uv, vec2( 16.0 ), 3, 66.0 );
  float vert = tnFbm( uv, vec2( 48.0, 3.0 ), 3, 67.0 );
  float crack = 1.0 - smoothstep( 0.0, 0.05, W.y - W.x + vert * 0.03 );
  float rem = smoothstep( 0.42, 0.5, low2 + mid * 0.2 );
  float h = 0.55 + 0.2 * vert - 0.45 * crack + rem * ( 0.12 + 0.12 * mid );
  vec3 c = C( 146.0, 141.0, 132.0 ) * ( 0.9 + 0.2 * vert + 0.08 * mid );
  c = mix( c, C( 124.0, 110.0, 92.0 ), smoothstep( -0.2, 0.35, low ) * 0.3 );
  c = mix( c, C( 72.0, 60.0, 50.0 ), rem );
  c = mix( c, C( 36.0, 33.0, 30.0 ), crack );
  return vec4( c, h );
}

void main() {
  vec4 r;
  if ( uType == 0 ) r = barkPine( vUv );
  else if ( uType == 1 ) r = barkAraucaria( vUv );
  else if ( uType == 2 ) r = barkSpruce( vUv );
  else if ( uType == 3 ) r = barkBirch( vUv );
  else if ( uType == 4 ) r = barkOak( vUv );
  else r = barkDead( vUv );
  gl_FragColor = r;
}
`;

const SRGB_GLSL = /* glsl */`
vec3 tnToLinear( vec3 c ) {
  return mix( c * 0.0773993808, pow( c * 0.9478672986 + 0.0521327014, vec3( 2.4 ) ), step( 0.04045, c ) );
}
`;

// pass B/C: albedo (sRGB -> linear, the target re-encodes) and normal from the height channel
const BARK_OUT_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform int uMode;
uniform vec2 uTexel;
uniform float uStrength;
varying vec2 vUv;
${SRGB_GLSL}
void main() {
  if ( uMode == 0 ) {
    gl_FragColor = vec4( tnToLinear( clamp( texture2D( tSrc, vUv ).rgb, 0.0, 1.0 ) ), 1.0 );
  } else {
    float hl = texture2D( tSrc, vUv - vec2( uTexel.x, 0.0 ) ).a;
    float hr = texture2D( tSrc, vUv + vec2( uTexel.x, 0.0 ) ).a;
    float hd = texture2D( tSrc, vUv - vec2( 0.0, uTexel.y ) ).a;
    float hu = texture2D( tSrc, vUv + vec2( 0.0, uTexel.y ) ).a;
    vec3 n = normalize( vec3( - ( hr - hl ) * uStrength, - ( hu - hd ) * uStrength, 1.0 ) );
    gl_FragColor = vec4( n * 0.5 + 0.5, 1.0 );
  }
}
`;

// pull-push dilation of a premultiplied, mipmapped canvas texture (values are sRGB-encoded)
const DILATE_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform float uMaxLod;
varying vec2 vUv;
${SRGB_GLSL}
void main() {
  vec4 top = textureLod( tSrc, vUv, uMaxLod );
  vec3 fill = top.rgb / max( top.a, 1e-4 );
  for ( int l = 12; l >= 0; l -- ) {
    float fl = float( l );
    if ( fl >= uMaxLod ) continue;
    vec4 s = textureLod( tSrc, vUv, fl );
    fill = s.rgb + ( 1.0 - s.a ) * fill;
  }
  gl_FragColor = vec4( tnToLinear( clamp( fill, 0.0, 1.0 ) ), textureLod( tSrc, vUv, 0.0 ).a );
}
`;

function makeArrayTarget(S, layers, srgb, anisotropy) {
  const rt = new THREE.WebGLArrayRenderTarget(S, S, layers, { depthBuffer: false });
  const t = rt.texture;
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = anisotropy;
  t.generateMipmaps = false;
  return rt;
}

/**
 * Generates the vegetation albedo array (sRGB, alpha = coverage) and the bark normal-map array
 * on the GPU (bark: procedural shader; foliage: canvas painting + pull-push dilation).
 * @param {THREE.WebGLRenderer} renderer
 * @param {number} size texture resolution per layer (power of two)
 * @param {number} anisotropy
 * @returns {{ albedo: THREE.DataArrayTexture, normal: THREE.DataArrayTexture, size: number, timings: object, dispose: Function }}
 */
export function createVegetationTextures(renderer, size = 512, anisotropy = 4) {
  const t0 = performance.now();
  const S = size;
  const albedoRT = makeArrayTarget(S, VEG_LAYER_COUNT, true, anisotropy);
  const normalRT = makeArrayTarget(S, VEG_BARK_LAYERS, false, anisotropy);
  const halfFloat = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const temp = new THREE.WebGLRenderTarget(S, S, {
    type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
  const barkMat = new THREE.ShaderMaterial({ uniforms: { uType: { value: 0 } }, vertexShader: QUAD_VERT, fragmentShader: BARK_FRAG });
  const outMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: temp.texture }, uMode: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / S, 1 / S) }, uStrength: { value: 1 } },
    vertexShader: QUAD_VERT,
    fragmentShader: BARK_OUT_FRAG,
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const canvasTex = new THREE.CanvasTexture(canvas);
  canvasTex.premultiplyAlpha = true;
  canvasTex.colorSpace = THREE.NoColorSpace;
  canvasTex.minFilter = THREE.LinearMipmapLinearFilter;
  canvasTex.generateMipmaps = true;
  const dilateMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: canvasTex }, uMaxLod: { value: Math.log2(S) } },
    vertexShader: QUAD_VERT,
    fragmentShader: DILATE_FRAG,
  });
  for (const m of [barkMat, outMat, dilateMat]) { m.depthTest = false; m.depthWrite = false; m.toneMapped = false; }
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), barkMat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = { target: renderer.getRenderTarget(), auto: renderer.autoClear, shadow: renderer.shadowMap.autoUpdate };
  renderer.autoClear = false;
  renderer.shadowMap.autoUpdate = false;
  const pass = (mat, target, layer) => {
    quad.material = mat;
    renderer.setRenderTarget(target, layer);
    renderer.render(scene, cam);
  };
  const strengthScale = S / 512;
  for (let l = 0; l < VEG_BARK_LAYERS; l++) {
    barkMat.uniforms.uType.value = l;
    pass(barkMat, temp, 0);
    outMat.uniforms.uMode.value = 0;
    pass(outMat, albedoRT, l);
    outMat.uniforms.uMode.value = 1;
    outMat.uniforms.uStrength.value = BARK_STRENGTH[l] * strengthScale;
    pass(outMat, normalRT, l);
  }
  const t1 = performance.now();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let paintMs = 0;
  for (const [name, paint, seed] of FOLIAGE) {
    const ta = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    paint(ctx, mulberry32(seed * 977));
    paintMs += performance.now() - ta;
    canvasTex.needsUpdate = true;
    pass(dilateMat, albedoRT, VEG_LAYERS[name]);
  }
  // build the mip chains once
  for (const rt of [albedoRT, normalRT]) {
    rt.texture.generateMipmaps = true;
    quad.visible = false;
    renderer.setRenderTarget(rt, 0);
    renderer.render(scene, cam);
    quad.visible = true;
  }
  renderer.setRenderTarget(prev.target);
  renderer.autoClear = prev.auto;
  renderer.shadowMap.autoUpdate = prev.shadow;
  temp.dispose();
  canvasTex.dispose();
  quad.geometry.dispose();
  for (const m of [barkMat, outMat, dilateMat]) m.dispose();
  const t2 = performance.now();
  return {
    albedo: albedoRT.texture,
    normal: normalRT.texture,
    size: S,
    timings: { bark: t1 - t0, foliage: t2 - t1, paint: paintMs },
    dispose() {
      albedoRT.dispose();
      normalRT.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Rock textures (used by rocks.js): tileable granite albedo (+ lichen mask in alpha) and normal.
// ---------------------------------------------------------------------------------------------

/**
 * @param {number} S resolution
 * @returns {{ albedo: THREE.DataTexture, normal: THREE.DataTexture }}
 */
export function createRockTextures(S = 512, anisotropy = 4) {
  const N1 = fbm(S, S, { cx: 4, cy: 4, octaves: 6, gain: 0.55, seed: 31 });
  const N2 = fbm(S, S, { cx: 24, cy: 24, octaves: 3, seed: 32 });
  const N3 = fbm(S, S, { cx: 8, cy: 8, octaves: 3, seed: 37 });
  const W = worley(S, S, 4, 4, 33, 0.95);
  const L = fbm(S, S, { cx: 6, cy: 6, octaves: 5, gain: 0.6, seed: 34 });
  const rng = mulberry32(36);
  const speck = new Float32Array(S * S);
  // mineral grains: feldspar (light), biotite/hornblende (dark), quartz (grey) - small round blobs
  const grains = Math.round(5200 * (S / 512) * (S / 512));
  const sc = S / 512;
  for (let k = 0; k < grains; k++) {
    const x = rng() * S;
    const y = rng() * S;
    const v = rng() < 0.5 ? -(0.45 + rng() * 0.55) : 0.25 + rng() * 0.5;
    const r = (0.7 + rng() * rng() * 2.2) * sc;
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d > 1) continue;
        const j = ((Math.floor(y + dy) % S + S) % S) * S + ((Math.floor(x + dx) % S + S) % S);
        speck[j] = v * (1 - d * d * 0.5);
      }
    }
  }
  const albedo = new Uint8Array(S * S * 4);
  const hgt = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    // a few long joints only (masked cell edges), not a tile-like network
    const crack = (1 - smoothstep(0.0, 0.022, W.f2[i] - W.f1[i] + N2[i] * 0.012)) * smoothstep(0.05, 0.25, N3[i]);
    hgt[i] = 0.5 + 0.38 * N1[i] + 0.07 * N2[i] + 0.035 * speck[i] - 0.35 * crack;
    const t = 0.9 + 0.22 * N1[i] + 0.06 * N2[i];
    let r = 166 * t;
    let g = 162 * t;
    let b = 155 * t;
    const pink = smoothstep(0.1, 0.5, N2[i] + N1[i] * 0.5) * 0.12;
    r += 16 * pink; b -= 8 * pink;
    const sp = speck[i];
    if (sp < 0) { r = lerp(r, 58, -sp); g = lerp(g, 56, -sp); b = lerp(b, 54, -sp); } else if (sp > 0) { r = lerp(r, 226, sp); g = lerp(g, 222, sp); b = lerp(b, 212, sp); }
    r = lerp(r, 78, crack * 0.75); g = lerp(g, 74, crack * 0.75); b = lerp(b, 70, crack * 0.75);
    const k = i * 4;
    albedo[k] = Math.max(0, Math.min(255, r));
    albedo[k + 1] = Math.max(0, Math.min(255, g));
    albedo[k + 2] = Math.max(0, Math.min(255, b));
    albedo[k + 3] = Math.round(smoothstep(0.02, 0.22, L[i] + N2[i] * 0.12) * 255);
  }
  const normal = heightToNormal(hgt, S, S, 5 * S / 512);
  const mk = (data, srgb) => {
    const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = anisotropy;
    tex.needsUpdate = true;
    return tex;
  };
  return { albedo: mk(albedo, true), normal: mk(normal, false) };
}
