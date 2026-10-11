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

__GPU_SECTION__
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
