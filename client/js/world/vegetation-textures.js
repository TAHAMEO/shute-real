// Procedural textures for SHUTE REAL vegetation and rocks.
// Everything is generated in code: tileable noise fields (CPU), bark albedo + normal maps,
// and canvas-painted foliage cards (needles, sprays, leaves, fronds, twigs) with alpha.
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
    const yStart = Math.ceil(cj / sy - 0.5);
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
      for (let y = Math.max(0, yStart); y < yEnd; y++) {
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
// Bark generators: return { rgb: Uint8Array RGBA, height: Float32Array }
// The texture tile covers ~1 m of bark; u = around the trunk, v = along it.
// ---------------------------------------------------------------------------------------------

function newBark(S) {
  return { rgba: new Uint8Array(S * S * 4), height: new Float32Array(S * S) };
}

function put(rgba, i, r, g, b) {
  const k = i * 4;
  rgba[k] = r < 0 ? 0 : r > 255 ? 255 : r;
  rgba[k + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
  rgba[k + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  rgba[k + 3] = 255;
}

function barkPine(S, seed) {
  const out = newBark(S);
  const W = worley(S, S, 7, 3, seed, 0.8);
  const F = worley(S, S, 22, 12, seed + 5, 0.9);
  const N1 = fbm(S, S, { cx: 6, cy: 3, octaves: 4, seed: seed + 1 });
  const N2 = fbm(S, S, { cx: 32, cy: 8, octaves: 3, seed: seed + 2 });
  for (let i = 0; i < S * S; i++) {
    const e = W.f2[i] - W.f1[i] + N1[i] * 0.06;
    const plate = smoothstep(0.03, 0.2, e);
    const flake = smoothstep(0.0, 0.16, F.f2[i] - F.f1[i]);
    const cid = W.id[i];
    const h = plate * (0.55 + 0.18 * N2[i] + 0.2 * flake + 0.1 * smoothstep(0.2, 0.6, e)) + (1 - plate) * 0.05 * (1 + N1[i]);
    out.height[i] = h;
    const t = 0.82 + 0.3 * N2[i] + 0.12 * flake;
    let r = lerp(118, 150, cid) * t;
    let g = lerp(100, 90, cid) * t;
    let b = lerp(88, 70, cid) * t;
    // reddish flaky inner bark where flakes are lifted
    const red = (1 - flake) * plate * 0.6;
    r = lerp(r, 168, red); g = lerp(g, 92, red); b = lerp(b, 62, red);
    const dark = 1 - plate;
    put(out.rgba, i, lerp(r, 32, dark), lerp(g, 25, dark), lerp(b, 22, dark));
  }
  return out;
}

function barkAraucaria(S, seed) {
  const out = newBark(S);
  const N1 = fbm(S, S, { cx: 4, cy: 4, octaves: 4, seed: seed + 1 });
  const N2 = fbm(S, S, { cx: 48, cy: 4, octaves: 3, seed: seed + 2 });
  const N3 = fbm(S, S, { cx: 16, cy: 16, octaves: 3, seed: seed + 3 });
  const rings = 11;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const v = (y + 0.5) / S;
      const ph = v * rings + N1[i] * 0.35 + Math.sin((x / S) * Math.PI * 2) * 0.08;
      const f = ph - Math.floor(ph);
      const ring = smoothstep(0.0, 0.08, f) * (1 - smoothstep(0.12, 0.3, f));
      const groove = smoothstep(0.85, 1.0, f);
      const h = 0.5 + 0.12 * N2[i] + 0.25 * ring - 0.3 * groove + 0.08 * N3[i];
      out.height[i] = h;
      const t = 0.85 + 0.25 * N1[i] + 0.12 * N2[i];
      let r = 112 * t;
      let g = 102 * t;
      let b = 92 * t;
      r = lerp(r, 70, groove * 0.7); g = lerp(g, 60, groove * 0.7); b = lerp(b, 54, groove * 0.7);
      r = lerp(r, 140, ring * 0.35); g = lerp(g, 128, ring * 0.35); b = lerp(b, 112, ring * 0.35);
      put(out.rgba, i, r, g, b);
    }
  }
  return out;
}

function barkSpruce(S, seed) {
  const out = newBark(S);
  const W = worley(S, S, 14, 10, seed, 0.9);
  const N1 = fbm(S, S, { cx: 4, cy: 4, octaves: 4, seed: seed + 1 });
  const N2 = fbm(S, S, { cx: 24, cy: 24, octaves: 3, seed: seed + 2 });
  for (let i = 0; i < S * S; i++) {
    const e = W.f2[i] - W.f1[i];
    const scale = smoothstep(0.02, 0.25, e);
    const lift = smoothstep(0.2, 0.7, W.f1[i]);
    const h = 0.3 + 0.45 * scale - 0.15 * lift + 0.1 * N2[i];
    out.height[i] = h;
    const t = 0.85 + 0.25 * N1[i] + 0.1 * N2[i];
    let r = lerp(104, 128, W.id[i]) * t;
    let g = lerp(88, 86, W.id[i]) * t;
    let b = lerp(76, 70, W.id[i]) * t;
    const dark = 1 - scale;
    put(out.rgba, i, lerp(r, 50, dark), lerp(g, 40, dark), lerp(b, 34, dark));
  }
  return out;
}

function barkBirch(S, seed) {
  const out = newBark(S);
  const rng = mulberry32(seed);
  const N1 = fbm(S, S, { cx: 3, cy: 6, octaves: 5, seed: seed + 1 });
  const N2 = fbm(S, S, { cx: 16, cy: 64, octaves: 3, seed: seed + 2 });
  const N3 = fbm(S, S, { cx: 6, cy: 3, octaves: 4, seed: seed + 3 });
  const lent = new Float32Array(S * S);
  // horizontal lenticels (dark dashes), wrapped
  const count = Math.round(150 * (S / 512) * (S / 512) + 40);
  for (let k = 0; k < count; k++) {
    const cxp = rng() * S;
    const cyp = rng() * S;
    const len = (0.03 + rng() * rng() * 0.22) * S;
    const th = Math.max(1, (1.2 + rng() * 2.5) * S / 512);
    const strength = 0.5 + rng() * 0.5;
    for (let dx = -len / 2; dx <= len / 2; dx++) {
      const taper = 1 - Math.pow(Math.abs(dx) / (len / 2), 2);
      const tt = th * (0.4 + 0.6 * taper);
      for (let dy = -Math.ceil(tt); dy <= Math.ceil(tt); dy++) {
        const a = clamp01(1 - Math.abs(dy) / tt) * strength;
        const xx = ((Math.round(cxp + dx) % S) + S) % S;
        const yy = ((Math.round(cyp + dy + dx * 0.03) % S) + S) % S;
        const j = yy * S + xx;
        if (a > lent[j]) lent[j] = a;
      }
    }
  }
  for (let i = 0; i < S * S; i++) {
    const patch = smoothstep(0.32, 0.5, N3[i] + N1[i] * 0.4);
    const l = lent[i];
    const h = 0.6 + 0.1 * N2[i] - 0.45 * l - 0.15 * patch;
    out.height[i] = h;
    const t = 0.94 + 0.08 * N1[i] + 0.04 * N2[i];
    let r = 226 * t;
    let g = 222 * t;
    let b = 210 * t;
    // warm peeling tint
    const warm = smoothstep(0.1, 0.5, N1[i]) * 0.35;
    r = lerp(r, 214, warm); g = lerp(g, 190, warm); b = lerp(b, 168, warm);
    r = lerp(r, 48, patch * 0.85); g = lerp(g, 44, patch * 0.85); b = lerp(b, 42, patch * 0.85);
    r = lerp(r, 52, l); g = lerp(g, 46, l); b = lerp(b, 44, l);
    put(out.rgba, i, r, g, b);
  }
  return out;
}

function barkOak(S, seed) {
  const out = newBark(S);
  const W = worley(S, S, 9, 3, seed, 0.85);
  const W2 = worley(S, S, 18, 5, seed + 9, 0.9);
  const N1 = fbm(S, S, { cx: 8, cy: 2, octaves: 5, seed: seed + 1 });
  const N2 = fbm(S, S, { cx: 24, cy: 24, octaves: 3, seed: seed + 2 });
  for (let i = 0; i < S * S; i++) {
    const e = W.f2[i] - W.f1[i] + N1[i] * 0.12;
    const e2 = W2.f2[i] - W2.f1[i];
    const ridge = smoothstep(0.04, 0.35, e) * (0.75 + 0.25 * smoothstep(0.0, 0.2, e2));
    const h = ridge * (0.7 + 0.15 * N2[i]) + 0.05;
    out.height[i] = h;
    const t = 0.85 + 0.2 * N2[i] + 0.1 * N1[i];
    const top = smoothstep(0.55, 0.85, h);
    let r = lerp(78, 112, top) * t;
    let g = lerp(70, 104, top) * t;
    let b = lerp(62, 94, top) * t;
    const dark = 1 - ridge;
    // faint green algae in furrows
    r = lerp(r, 34, dark); g = lerp(g, 34, dark); b = lerp(b, 26, dark);
    put(out.rgba, i, r, g, b);
  }
  return out;
}

function barkDead(S, seed) {
  const out = newBark(S);
  const G = fbm(S, S, { cx: 40, cy: 2, octaves: 4, seed: seed + 1 });
  const C = worley(S, S, 6, 2, seed + 4, 0.9);
  const N1 = fbm(S, S, { cx: 3, cy: 3, octaves: 4, seed: seed + 2 });
  const N2 = fbm(S, S, { cx: 16, cy: 16, octaves: 3, seed: seed + 3 });
  for (let i = 0; i < S * S; i++) {
    const crack = 1 - smoothstep(0.0, 0.06, C.f2[i] - C.f1[i] + G[i] * 0.03);
    const barkPatch = smoothstep(0.2, 0.32, N1[i] + N2[i] * 0.15);
    const h = 0.55 + 0.18 * G[i] - 0.45 * crack + barkPatch * (0.18 + 0.15 * N2[i]);
    out.height[i] = h;
    const t = 0.9 + 0.22 * G[i] + 0.1 * N2[i];
    let r = 150 * t;
    let g = 144 * t;
    let b = 134 * t;
    const brown = smoothstep(-0.2, 0.3, N1[i]) * 0.35;
    r = lerp(r, 130, brown); g = lerp(g, 112, brown); b = lerp(b, 92, brown);
    r = lerp(r, 70, barkPatch); g = lerp(g, 56, barkPatch); b = lerp(b, 46, barkPatch);
    r = lerp(r, 38, crack); g = lerp(g, 34, crack); b = lerp(b, 30, crack);
    put(out.rgba, i, r, g, b);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Foliage painters (canvas 2D, transparent background). Coordinates are normalised [0,1]
// with y down (canvas convention); the card's attachment point is the bottom centre.
// ---------------------------------------------------------------------------------------------

const TAU = Math.PI * 2;

function hsl(h, s, l, a = 1) {
  return `hsla(${h.toFixed(1)},${(s * 100).toFixed(1)}%,${(l * 100).toFixed(1)}%,${a})`;
}

function strokeLine(ctx, x0, y0, x1, y1, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function strokePath(ctx, pts, w0, w1, color) {
  ctx.strokeStyle = color;
  for (let i = 0; i < pts.length - 1; i++) {
    const t = i / Math.max(1, pts.length - 2);
    ctx.lineWidth = w0 + (w1 - w0) * t;
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
    ctx.stroke();
  }
}

/** Curved path from (x,y) along angle a (0 = up), bending by `bend` rad over its length. */
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
  const f = t * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const k = f - i;
  const a = pts[i];
  const b = pts[i + 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return { x: a[0] + dx * k, y: a[1] + dy * k, ang: Math.atan2(dx, -dy) };
}

function paintPine(ctx, rng) {
  // A branch end with several brush-like shoots covered in long paired needles.
  const shoots = [];
  const main = curvePath(0.5, 1.0, (rng() - 0.5) * 0.2, 0.42, (rng() - 0.5) * 0.3, 8, 0.05, rng);
  const n = 7 + Math.floor(rng() * 3);
  for (let k = 0; k < n; k++) {
    const t = 0.35 + 0.65 * (k / (n - 1)) * (0.85 + rng() * 0.15);
    const p = pathPoint(main, Math.min(1, t));
    const side = k % 2 === 0 ? -1 : 1;
    const spread = (1 - t) * 0.9 + 0.25;
    const a = p.ang + side * spread * (0.6 + rng() * 0.5) + (rng() - 0.5) * 0.2;
    const len = 0.17 + rng() * 0.12;
    shoots.push(curvePath(p.x, p.y, a, len, -side * (0.2 + rng() * 0.3), 6, 0.06, rng));
  }
  shoots.push(curvePath(main[main.length - 1][0], main[main.length - 1][1], pathPoint(main, 1).ang, 0.2, 0.1, 6, 0.05, rng));
  ctx.lineCap = 'round';
  strokePath(ctx, main, 0.014, 0.006, hsl(25, 0.3, 0.2));
  for (const s of shoots) strokePath(ctx, s, 0.007, 0.004, hsl(28, 0.32, 0.24));
  // needles, two layers (inner darker, outer lighter)
  for (let layer = 0; layer < 2; layer++) {
    for (const s of shoots) {
      const count = 46;
      for (let i = 0; i < count; i++) {
        const t = 0.08 + 0.92 * (i / count) + (rng() - 0.5) * 0.02;
        const p = pathPoint(s, Math.min(1, t));
        const tipShort = 1 - 0.35 * smoothstep(0.75, 1.0, t);
        for (let side = -1; side <= 1; side += 2) {
          if (rng() < 0.15) continue;
          const da = side * (0.35 + rng() * 0.55) - (layer ? 0 : side * 0.15);
          const ang = p.ang + da;
          const len = (0.055 + rng() * 0.035) * tipShort;
          const x1 = p.x + Math.sin(ang) * len;
          const y1 = p.y - Math.cos(ang) * len;
          const l = layer === 0 ? 0.13 + rng() * 0.06 : 0.19 + rng() * 0.1;
          const hue = 95 + rng() * 25;
          ctx.lineWidth = 0.0042 + rng() * 0.0018;
          ctx.strokeStyle = hsl(hue, 0.35 + rng() * 0.15, l);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.quadraticCurveTo(p.x + Math.sin(ang - side * 0.15) * len * 0.6, p.y - Math.cos(ang - side * 0.15) * len * 0.6, x1, y1);
          ctx.stroke();
        }
      }
    }
  }
}

function paintSpruce(ctx, rng) {
  // Flat spray: main axis with alternating side branchlets, dense short needles.
  const main = curvePath(0.5, 1.0, (rng() - 0.5) * 0.15, 0.9, (rng() - 0.5) * 0.25, 10, 0.03, rng);
  const twigs = [main];
  const n = 13;
  for (let k = 0; k < n; k++) {
    const t = 0.12 + 0.82 * (k / (n - 1));
    const p = pathPoint(main, t);
    const side = k % 2 === 0 ? -1 : 1;
    const env = Math.sin(Math.PI * (0.15 + 0.85 * (1 - t))) * 0.75 + 0.1;
    const len = (0.16 + rng() * 0.08) * env + 0.04;
    const a = p.ang + side * (0.85 + rng() * 0.35);
    const tw = curvePath(p.x, p.y, a, len, -side * 0.35, 5, 0.04, rng);
    twigs.push(tw);
    // secondary twiglets
    if (len > 0.12) {
      for (let q = 0; q < 2; q++) {
        const pp = pathPoint(tw, 0.4 + q * 0.3);
        twigs.push(curvePath(pp.x, pp.y, pp.ang + side * 0.7 * (q ? -1 : 1), len * 0.35, 0, 3, 0.05, rng));
      }
    }
  }
  ctx.lineCap = 'round';
  for (const t of twigs) strokePath(ctx, t, 0.007, 0.003, hsl(25, 0.35, 0.22));
  for (let layer = 0; layer < 2; layer++) {
    for (const tw of twigs) {
      const len = tw.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - tw[i - 1][0], p[1] - tw[i - 1][1]) : 0), 0);
      const count = Math.ceil(len / 0.0065);
      for (let i = 0; i < count; i++) {
        const p = pathPoint(tw, i / count);
        for (let side = -1; side <= 1; side += 2) {
          const ang = p.ang + side * (0.9 + rng() * 0.5);
          const l = (0.022 + rng() * 0.014);
          ctx.lineWidth = 0.004 + rng() * 0.002;
          const lum = layer ? 0.15 + rng() * 0.08 : 0.1 + rng() * 0.05;
          ctx.strokeStyle = hsl(118 + rng() * 22, 0.32 + rng() * 0.12, lum);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + Math.sin(ang) * l, p.y - Math.cos(ang) * l);
          ctx.stroke();
        }
      }
    }
  }
}

function paintAraucaria(ctx, rng) {
  // Candelabra of rope-like branchlets covered by overlapping stiff pointed leaves.
  const n = 6 + Math.floor(rng() * 2);
  const ropes = [];
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1) - 0.5;
    const a = f * 2.0 + (rng() - 0.5) * 0.2;
    const len = 0.36 + rng() * 0.16 - Math.abs(f) * 0.12;
    ropes.push(curvePath(0.5 + f * 0.06, 0.97, a, len, -f * 1.4 + (rng() - 0.5) * 0.3, 8, 0.05, rng));
  }
  ctx.lineCap = 'round';
  for (const r of ropes) strokePath(ctx, r, 0.016, 0.008, hsl(30, 0.3, 0.2));
  for (const r of ropes) {
    const count = 70;
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const p = pathPoint(r, t);
      const w = 0.032 * (1 - 0.45 * t);
      for (let s = 0; s < 3; s++) {
        const side = s === 0 ? -1 : s === 1 ? 1 : (rng() - 0.5) * 0.4;
        const ang = p.ang + side * (0.55 + rng() * 0.4);
        const L = w * (0.9 + rng() * 0.6);
        const x1 = p.x + Math.sin(ang) * L;
        const y1 = p.y - Math.cos(ang) * L;
        const nx = Math.cos(ang) * L * 0.18;
        const ny = Math.sin(ang) * L * 0.18;
        const lum = 0.12 + rng() * 0.1 + (s === 2 ? 0.05 : 0);
        ctx.fillStyle = hsl(105 + rng() * 25, 0.4 + rng() * 0.15, lum);
        ctx.beginPath();
        ctx.moveTo(p.x - nx, p.y - ny);
        ctx.lineTo(x1, y1);
        ctx.lineTo(p.x + nx, p.y + ny);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

function leafPath(ctx, x, y, ang, len, width, shape) {
  // shape: 'birch' (ovate, pointed), 'oak' (lobed), 'ellipse'
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const P = (u, v) => [x + sa * u + ca * v, y - ca * u + sa * v];
  ctx.beginPath();
  const steps = shape === 'oak' ? 18 : 10;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let hw;
    if (shape === 'birch') hw = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.9) * (1 - 0.25 * t);
    else if (shape === 'oak') hw = Math.sin(Math.PI * Math.pow(t, 0.8)) * (0.62 + 0.38 * Math.abs(Math.sin(t * Math.PI * 4.5)));
    else hw = Math.sin(Math.PI * t);
    pts.push([t * len, hw * width * 0.5]);
  }
  let p = P(0, 0);
  ctx.moveTo(p[0], p[1]);
  for (let i = 1; i < pts.length; i++) { p = P(pts[i][0], pts[i][1]); ctx.lineTo(p[0], p[1]); }
  for (let i = pts.length - 2; i > 0; i--) { p = P(pts[i][0], -pts[i][1]); ctx.lineTo(p[0], p[1]); }
  ctx.closePath();
}

function paintLeafCluster(ctx, rng, { shape, count, size, hue, sat, lum, twigHue = 28, droop = 0, spread = 0.9 }) {
  // twig skeleton
  const twigs = [];
  const main = curvePath(0.5, 1.0, (rng() - 0.5) * 0.3, 0.55, (rng() - 0.5) * 0.4, 8, 0.08, rng);
  twigs.push(main);
  const nb = 6 + Math.floor(rng() * 3);
  for (let k = 0; k < nb; k++) {
    const t = 0.25 + 0.75 * (k / nb) + rng() * 0.08;
    const p = pathPoint(main, Math.min(1, t));
    const side = k % 2 ? 1 : -1;
    const a = p.ang + side * spread * (0.5 + rng() * 0.6);
    twigs.push(curvePath(p.x, p.y, a, 0.18 + rng() * 0.18, side * droop + (rng() - 0.5) * 0.4, 6, 0.1, rng));
  }
  ctx.lineCap = 'round';
  for (const t of twigs) strokePath(ctx, t, 0.006, 0.0025, hsl(twigHue, 0.25, 0.22));
  // leaves: distribute along twigs (more at the outer parts), back layer darker
  const leaves = [];
  for (let i = 0; i < count; i++) {
    const tw = twigs[1 + Math.floor(rng() * (twigs.length - 1))] || main;
    const t = 0.2 + 0.8 * Math.sqrt(rng());
    const p = pathPoint(tw, t);
    const side = rng() < 0.5 ? -1 : 1;
    const ang = p.ang + side * (0.3 + rng() * 1.1) + droop * 0.5 * side;
    const L = size * (0.75 + rng() * 0.5);
    leaves.push({ x: p.x, y: p.y, ang, L, depth: rng() });
  }
  leaves.sort((a, b) => a.depth - b.depth);
  for (const lf of leaves) {
    const l = lum * (0.7 + 0.55 * lf.depth) * (0.9 + rng() * 0.2);
    ctx.fillStyle = hsl(hue + (rng() - 0.5) * 16, sat * (0.85 + rng() * 0.3), l);
    const petiole = lf.L * 0.18;
    const px = lf.x + Math.sin(lf.ang) * petiole;
    const py = lf.y - Math.cos(lf.ang) * petiole;
    ctx.lineWidth = 0.003;
    ctx.strokeStyle = hsl(hue, sat * 0.6, l * 0.8);
    ctx.beginPath(); ctx.moveTo(lf.x, lf.y); ctx.lineTo(px, py); ctx.stroke();
    leafPath(ctx, px, py, lf.ang, lf.L, lf.L * (shape === 'oak' ? 0.62 : shape === 'birch' ? 0.68 : 0.55), shape);
    ctx.fill();
    // midrib highlight
    ctx.strokeStyle = hsl(hue + 8, sat * 0.6, Math.min(0.6, l * 1.35), 0.55);
    ctx.lineWidth = 0.0025;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.sin(lf.ang) * lf.L * 0.85, py - Math.cos(lf.ang) * lf.L * 0.85);
    ctx.stroke();
  }
}

function paintFern(ctx, rng) {
  // One pinnate frond, rachis from bottom centre to the top.
  const rachis = curvePath(0.5, 1.0, (rng() - 0.5) * 0.08, 0.96, (rng() - 0.5) * 0.15, 16, 0.01, rng);
  ctx.lineCap = 'round';
  strokePath(ctx, rachis, 0.012, 0.004, hsl(80, 0.4, 0.28));
  const pairs = 22;
  for (let k = 0; k < pairs; k++) {
    const t = 0.06 + 0.92 * (k / pairs);
    const p = pathPoint(rachis, t);
    const env = Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * (1 - t) * 0.92 + 0.08 * (1 - t))), 0.7);
    const L = 0.43 * env * (0.92 + rng() * 0.1) + 0.02;
    for (let side = -1; side <= 1; side += 2) {
      const a = p.ang + side * (1.25 - 0.25 * t);
      const pin = curvePath(p.x, p.y, a, L, -side * 0.25, 8, 0.0, rng);
      strokePath(ctx, pin, 0.004, 0.002, hsl(82, 0.45, 0.3));
      const lobes = Math.max(3, Math.round(L / 0.016));
      for (let q = 0; q < lobes; q++) {
        const s = (q + 0.5) / lobes;
        const pp = pathPoint(pin, s);
        const w = 0.017 * (1 - 0.6 * s) * (0.6 + env * 0.5);
        for (let ls = -1; ls <= 1; ls += 2) {
          const la = pp.ang + ls * 1.2;
          ctx.fillStyle = hsl(84 + rng() * 14, 0.5 + rng() * 0.12, 0.25 + rng() * 0.1 + (ls > 0 ? 0.03 : 0));
          ctx.beginPath();
          ctx.ellipse(pp.x + Math.sin(la) * w * 0.55, pp.y - Math.cos(la) * w * 0.55, w * 0.65, w * 0.42, -la + Math.PI / 2 + 0.6 * ls, 0, TAU);
          ctx.fill();
        }
      }
    }
  }
}

function paintJuniper(ctx, rng) {
  // Dense branching twigs covered by short sharp blue-green needles.
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
  for (let k = 0; k < 3; k++) grow(0.5 + (k - 1) * 0.05, 1.0, (k - 1) * 0.5 + (rng() - 0.5) * 0.3, 0.38, 0);
  ctx.lineCap = 'round';
  for (const t of twigs) strokePath(ctx, t.p, 0.008 / (t.depth + 1), 0.0025, hsl(25, 0.3, 0.24));
  for (let layer = 0; layer < 2; layer++) {
    for (const t of twigs) {
      const count = 26 - t.depth * 3;
      for (let i = 0; i < count; i++) {
        const p = pathPoint(t.p, 0.1 + 0.9 * i / count);
        for (let s = 0; s < 2; s++) {
          const ang = p.ang + (s ? 1 : -1) * (0.5 + rng() * 0.5);
          const L = 0.022 + rng() * 0.016;
          const lum = layer ? 0.24 + rng() * 0.12 : 0.15 + rng() * 0.06;
          ctx.strokeStyle = hsl(145 + rng() * 25, 0.16 + rng() * 0.1, lum);
          ctx.lineWidth = 0.0045;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + Math.sin(ang) * L, p.y - Math.cos(ang) * L);
          ctx.stroke();
        }
      }
    }
  }
}

function paintTwigs(ctx, rng) {
  // Bare dead twigs (fine branching silhouette).
  ctx.lineCap = 'round';
  const grow = (x, y, a, len, w, depth) => {
    const p = curvePath(x, y, a, len, (rng() - 0.5) * 0.5, 5, 0.12, rng);
    const g = 0.22 + rng() * 0.12;
    strokePath(ctx, p, w, w * 0.6, hsl(28, 0.12, g));
    if (depth < 4) {
      const nb = 2 + (rng() < 0.4 ? 1 : 0);
      for (let k = 0; k < nb; k++) {
        const pt = pathPoint(p, 0.4 + rng() * 0.6);
        grow(pt.x, pt.y, pt.ang + (k % 2 ? 1 : -1) * (0.3 + rng() * 0.6), len * (0.55 + rng() * 0.2), w * 0.62, depth + 1);
      }
    }
  };
  grow(0.5, 1.0, (rng() - 0.5) * 0.3, 0.42, 0.016, 0);
}

// ---------------------------------------------------------------------------------------------
// Pull-push colour dilation: fills transparent texels with nearby opaque colours so mipmaps
// of alpha-tested foliage do not get dark halos. Operates in place on RGBA8 (unpremultiplied).
// ---------------------------------------------------------------------------------------------

function dilateColors(data, size) {
  const levels = [];
  let s = size;
  // level 0 premultiplied float
  let cur = new Float32Array(s * s * 4);
  for (let i = 0; i < s * s; i++) {
    const a = data[i * 4 + 3] / 255;
    cur[i * 4] = (data[i * 4] / 255) * a;
    cur[i * 4 + 1] = (data[i * 4 + 1] / 255) * a;
    cur[i * 4 + 2] = (data[i * 4 + 2] / 255) * a;
    cur[i * 4 + 3] = a;
  }
  levels.push({ s, d: cur });
  while (s > 1) {
    const ns = s >> 1;
    const nd = new Float32Array(ns * ns * 4);
    for (let y = 0; y < ns; y++) {
      for (let x = 0; x < ns; x++) {
        const o = (y * ns + x) * 4;
        const a = ((2 * y) * s + 2 * x) * 4;
        const b = a + 4;
        const c = a + s * 4;
        const d = c + 4;
        for (let k = 0; k < 4; k++) nd[o + k] = (cur[a + k] + cur[b + k] + cur[c + k] + cur[d + k]) * 0.25;
      }
    }
    levels.push({ s: ns, d: nd });
    cur = nd;
    s = ns;
  }
  // push: full colour at coarsest level, then composite each level over the upsampled coarser one
  const top = levels[levels.length - 1].d;
  let full = new Float32Array(3);
  const ta = Math.max(top[3], 1e-6);
  full[0] = top[0] / ta; full[1] = top[1] / ta; full[2] = top[2] / ta;
  let fs = 1;
  for (let l = levels.length - 2; l >= 0; l--) {
    const { s: ls, d } = levels[l];
    const nf = new Float32Array(ls * ls * 3);
    for (let y = 0; y < ls; y++) {
      // bilinear upsample coordinates in the coarser level
      const fy = Math.min(fs - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const y0 = Math.floor(fy);
      const y1 = Math.min(fs - 1, y0 + 1);
      const ty = fy - y0;
      for (let x = 0; x < ls; x++) {
        const fx = Math.min(fs - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const x0 = Math.floor(fx);
        const x1 = Math.min(fs - 1, x0 + 1);
        const tx = fx - x0;
        const o = (y * ls + x);
        const a = d[o * 4 + 3];
        for (let k = 0; k < 3; k++) {
          const c00 = full[(y0 * fs + x0) * 3 + k];
          const c10 = full[(y0 * fs + x1) * 3 + k];
          const c01 = full[(y1 * fs + x0) * 3 + k];
          const c11 = full[(y1 * fs + x1) * 3 + k];
          const up = (c00 * (1 - tx) + c10 * tx) * (1 - ty) + (c01 * (1 - tx) + c11 * tx) * ty;
          nf[o * 3 + k] = d[o * 4 + k] + (1 - a) * up;
        }
      }
    }
    full = nf;
    fs = ls;
  }
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(Math.min(1, full[i * 3]) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, full[i * 3 + 1]) * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, full[i * 3 + 2]) * 255);
  }
}

// ---------------------------------------------------------------------------------------------
// Public: vegetation texture arrays
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

const BARKS = [
  [barkPine, 101, 9],
  [barkAraucaria, 202, 7],
  [barkSpruce, 303, 6],
  [barkBirch, 404, 5],
  [barkOak, 505, 10],
  [barkDead, 606, 7],
];

const FOLIAGE = [
  ['pine', (c, r) => paintPine(c, r), 11],
  ['spruce', (c, r) => paintSpruce(c, r), 12],
  ['araucaria', (c, r) => paintAraucaria(c, r), 13],
  ['birch', (c, r) => paintLeafCluster(c, r, { shape: 'birch', count: 170, size: 0.055, hue: 88, sat: 0.5, lum: 0.33, droop: 0.6 }), 14],
  ['oak', (c, r) => paintLeafCluster(c, r, { shape: 'oak', count: 125, size: 0.085, hue: 95, sat: 0.42, lum: 0.24, droop: 0.1, spread: 1.1 }), 15],
  ['shrub', (c, r) => paintLeafCluster(c, r, { shape: 'ellipse', count: 160, size: 0.07, hue: 92, sat: 0.4, lum: 0.26, droop: 0.2, spread: 1.2 }), 16],
  ['fern', (c, r) => paintFern(c, r), 17],
  ['juniper', (c, r) => paintJuniper(c, r), 18],
  ['twigs', (c, r) => paintTwigs(c, r), 19],
];

/**
 * Generates the vegetation albedo array (sRGB, alpha = coverage) and the bark normal-map array.
 * @param {number} size texture resolution per layer (power of two)
 * @param {number} anisotropy
 * @returns {{ albedo: THREE.DataArrayTexture, normal: THREE.DataArrayTexture, size: number, timings: object }}
 */
export function createVegetationTextures(size = 512, anisotropy = 4) {
  const t0 = performance.now();
  const S = size;
  const layerBytes = S * S * 4;
  const albedo = new Uint8Array(layerBytes * VEG_LAYER_COUNT);
  const normal = new Uint8Array(layerBytes * VEG_BARK_LAYERS);
  const strengthScale = S / 512;
  BARKS.forEach(([fn, seed, strength], layer) => {
    const b = fn(S, seed);
    albedo.set(b.rgba, layer * layerBytes);
    heightToNormal(b.height, S, S, strength * strengthScale, normal, layer * layerBytes);
  });
  const t1 = performance.now();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (const [name, paint, seed] of FOLIAGE) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    paint(ctx, mulberry32(seed * 977));
    const img = ctx.getImageData(0, 0, S, S);
    const data = img.data;
    dilateColors(data, S);
    // flip vertically so the canvas top is v = 1
    const base = VEG_LAYERS[name] * layerBytes;
    const row = S * 4;
    for (let y = 0; y < S; y++) albedo.set(data.subarray((S - 1 - y) * row, (S - y) * row), base + y * row);
  }
  const t2 = performance.now();
  const mk = (data, layers, srgb) => {
    const tex = new THREE.DataArrayTexture(data, S, S, layers);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = anisotropy;
    tex.needsUpdate = true;
    return tex;
  };
  return {
    albedo: mk(albedo, VEG_LAYER_COUNT, true),
    normal: mk(normal, VEG_BARK_LAYERS, false),
    size: S,
    timings: { bark: t1 - t0, foliage: t2 - t1 },
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
  const N2 = fbm(S, S, { cx: 32, cy: 32, octaves: 3, seed: 32 });
  const W = worley(S, S, 5, 5, 33, 0.95);
  const Wf = worley(S, S, 11, 11, 35, 0.95);
  const L = fbm(S, S, { cx: 6, cy: 6, octaves: 5, gain: 0.6, seed: 34 });
  const rng = mulberry32(36);
  const speck = new Float32Array(S * S);
  // mineral speckles: feldspar (light) and biotite (dark) grains
  const grains = Math.round(9000 * (S / 512) * (S / 512));
  for (let k = 0; k < grains; k++) {
    const x = Math.floor(rng() * S);
    const y = Math.floor(rng() * S);
    const v = rng() < 0.55 ? -(0.5 + rng() * 0.5) : 0.3 + rng() * 0.5;
    const r = rng() < 0.85 ? 0 : 1;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) speck[((y + dy + S) % S) * S + ((x + dx + S) % S)] = v;
  }
  const albedo = new Uint8Array(S * S * 4);
  const hgt = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const crack = 1 - smoothstep(0.0, 0.035, W.f2[i] - W.f1[i] + N2[i] * 0.01);
    const crack2 = 1 - smoothstep(0.0, 0.03, Wf.f2[i] - Wf.f1[i] + N2[i] * 0.02);
    const c = Math.max(crack, crack2 * 0.55);
    hgt[i] = 0.5 + 0.35 * N1[i] + 0.06 * N2[i] + 0.02 * speck[i] - 0.4 * c;
    const t = 0.9 + 0.2 * N1[i] + 0.06 * N2[i];
    let r = 168 * t;
    let g = 164 * t;
    let b = 156 * t;
    // pinkish feldspar tint patches
    const pink = smoothstep(0.1, 0.5, N2[i] + N1[i] * 0.5) * 0.12;
    r += 18 * pink; b -= 8 * pink;
    const sp = speck[i];
    if (sp < 0) { r = lerp(r, 50, -sp); g = lerp(g, 48, -sp); b = lerp(b, 46, -sp); } else if (sp > 0) { r = lerp(r, 228, sp); g = lerp(g, 224, sp); b = lerp(b, 214, sp); }
    r = lerp(r, 70, c * 0.8); g = lerp(g, 66, c * 0.8); b = lerp(b, 62, c * 0.8);
    const k = i * 4;
    albedo[k] = Math.max(0, Math.min(255, r));
    albedo[k + 1] = Math.max(0, Math.min(255, g));
    albedo[k + 2] = Math.max(0, Math.min(255, b));
    // lichen mask (blotchy, sharp-edged patches)
    albedo[k + 3] = Math.round(smoothstep(0.02, 0.22, L[i] + N2[i] * 0.12) * 255);
  }
  const normal = heightToNormal(hgt, S, S, 6 * S / 512);
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
