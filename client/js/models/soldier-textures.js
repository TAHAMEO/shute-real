// Procedural textures for the soldier models: camouflage patterns, cloth / nylon detail and normal
// maps, faces (skin tones, stubble, balaclava). Everything is painted on canvas or computed into
// DataTextures at runtime and cached, so all soldiers share the same GPU textures.
import * as THREE from 'three';

const cache = new Map();

function cached(key, make) {
  let v = cache.get(key);
  if (!v) { v = make(); cache.set(key, v); }
  return v;
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d', { willReadFrequently: true });
    return c;
  }
  return new OffscreenCanvas(w, h);
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(cv, { srgb = true, repeat = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ blob painting helpers

/** Irregular smooth blob outline (relative points). */
function blobShape(rand, r, sx = 1, sy = 1, rot = 0, irr = 0.45, n = 11) {
  const pts = [];
  const c = Math.cos(rot); const s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.35;
    const rr = r * (1 - irr * 0.5 + irr * rand());
    const x = Math.cos(a) * rr * sx;
    const y = Math.sin(a) * rr * sy;
    pts.push([x * c - y * s, x * s + y * c]);
  }
  pts.ext = r * Math.max(sx, sy) * (1 + irr);
  return pts;
}

/** Vertical "flame" outline used by flora-like patterns. */
function flameShape(rand, w, h, rot = 0) {
  const pts = [];
  const n = 9;
  const ph = rand() * 6.28;
  const c = Math.cos(rot); const s = Math.sin(rot);
  const push = (x, y) => pts.push([x * c - y * s, x * s + y * c]);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = (t - 0.5) * h;
    const width = w * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.02)) * (0.75 + 0.5 * rand());
    push(width * 0.5 + Math.sin(t * 7 + ph) * w * 0.25, y);
  }
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const y = (t - 0.5) * h;
    const width = w * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.02)) * (0.75 + 0.5 * rand());
    push(-width * 0.5 + Math.sin(t * 7 + ph) * w * 0.25, y);
  }
  pts.ext = Math.max(w, h);
  return pts;
}

function tracePath(ctx, pts, cx, cy) {
  const n = pts.length;
  const mx = (i) => (pts[i][0] + pts[(i + 1) % n][0]) * 0.5 + cx;
  const my = (i) => (pts[i][1] + pts[(i + 1) % n][1]) * 0.5 + cy;
  ctx.moveTo(mx(n - 1), my(n - 1));
  for (let i = 0; i < n; i++) ctx.quadraticCurveTo(pts[i][0] + cx, pts[i][1] + cy, mx(i), my(i));
  ctx.closePath();
}

/** Fill a shape at (cx, cy), wrapped around a S×S tile. */
function fillWrapped(ctx, S, pts, cx, cy, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  const e = pts.ext;
  for (let dx = -S; dx <= S; dx += S) {
    for (let dy = -S; dy <= S; dy += S) {
      const x = cx + dx; const y = cy + dy;
      if (x + e < 0 || x - e > S || y + e < 0 || y - e > S) continue;
      tracePath(ctx, pts, x, y);
    }
  }
  ctx.fill();
}

/** Twig / branch stroke, wrapped. */
function twigWrapped(ctx, S, rand, cx, cy, len, width, color) {
  const segs = [];
  let x = 0; let y = 0;
  let a = rand() * Math.PI * 2;
  const n = 4 + Math.floor(rand() * 3);
  segs.push([[x, y]]);
  for (let i = 0; i < n; i++) {
    a += (rand() - 0.5) * 1.1;
    x += Math.cos(a) * len / n; y += Math.sin(a) * len / n;
    segs[0].push([x, y]);
    if (rand() < 0.3) {
      const b = a + (rand() < 0.5 ? 1 : -1) * (0.6 + rand() * 0.6);
      const l = len / n * (0.8 + rand());
      segs.push([[x, y], [x + Math.cos(b) * l, y + Math.sin(b) * l]]);
    }
  }
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [k, seg] of segs.entries()) {
    ctx.lineWidth = k === 0 ? width : width * 0.7;
    ctx.beginPath();
    for (let dx = -S; dx <= S; dx += S) {
      for (let dy = -S; dy <= S; dy += S) {
        const ox = cx + dx; const oy = cy + dy;
        if (ox + len < 0 || ox - len > S || oy + len < 0 || oy - len > S) continue;
        ctx.moveTo(seg[0][0] + ox, seg[0][1] + oy);
        for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i][0] + ox, seg[i][1] + oy);
      }
    }
    ctx.stroke();
  }
}

/** Fast tileable box blur of a canvas (separable, wrap-around, `passes` iterations). */
function boxBlurTile(cv, r, passes = 2) {
  if (r < 1) return;
  const S = cv.width;
  const ctx = cv.getContext('2d');
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const tmp = new Float32Array(S * 3);
  const inv = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let dir = 0; dir < 2; dir++) {
      for (let a = 0; a < S; a++) {
        // load line
        for (let b = 0; b < S; b++) {
          const i = (dir ? b * S + a : a * S + b) * 4;
          tmp[b * 3] = d[i]; tmp[b * 3 + 1] = d[i + 1]; tmp[b * 3 + 2] = d[i + 2];
        }
        let sr = 0; let sg = 0; let sb = 0;
        for (let k = -r; k <= r; k++) { const j = ((k % S) + S) % S; sr += tmp[j * 3]; sg += tmp[j * 3 + 1]; sb += tmp[j * 3 + 2]; }
        for (let b = 0; b < S; b++) {
          const i = (dir ? b * S + a : a * S + b) * 4;
          d[i] = sr * inv; d[i + 1] = sg * inv; d[i + 2] = sb * inv;
          const jo = ((b - r) % S + S) % S; const ji = (b + r + 1) % S;
          sr += tmp[ji * 3] - tmp[jo * 3]; sg += tmp[ji * 3 + 1] - tmp[jo * 3 + 1]; sb += tmp[ji * 3 + 2] - tmp[jo * 3 + 2];
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Soft radial blob (no filters), wrapped around the tile. */
function softBlobWrapped(ctx, S, cx, cy, rx, ry, color, alpha) {
  const r = Math.max(rx, ry);
  for (let dx = -S; dx <= S; dx += S) {
    for (let dy = -S; dy <= S; dy += S) {
      const x = cx + dx; const y = cy + dy;
      if (x + r < 0 || x - r > S || y + r < 0 || y - r > S) continue;
      ctx.save();
      ctx.translate(x, y); ctx.scale(rx / r, ry / r);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, `rgba(${color},${alpha})`);
      g.addColorStop(0.55, `rgba(${color},${alpha * 0.7})`);
      g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
}

/** Paint a layer directly (sharp); softness comes from one final box blur pass. */
function layer(dst, blur, paint) {
  void blur;
  paint(dst.getContext('2d'), dst.width);
}

/** Per-pixel fabric noise + faint weave + low frequency fade / dirt. */
function fabricGrain(cv, rand, amount = 7, fade = 10) {
  const S = cv.width;
  const ctx = cv.getContext('2d');
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  // tileable low-frequency fade field
  const f1 = rand() * 6.28; const f2 = rand() * 6.28; const f3 = rand() * 6.28;
  for (let y = 0; y < S; y++) {
    const vy = (y / S) * Math.PI * 2;
    for (let x = 0; x < S; x++) {
      const vx = (x / S) * Math.PI * 2;
      const low = Math.sin(vx * 2 + f1 + Math.sin(vy * 3 + f2)) * 0.5 + Math.sin(vy * 2 + f3 + Math.cos(vx * 3)) * 0.5;
      const weave = ((x + y) & 1 ? 1 : -1) * 2 + (((x >> 1) + (y >> 1)) & 1 ? 1.5 : -1.5);
      const n = (rand() - 0.5) * amount + weave + low * fade;
      const i = (y * S + x) * 4;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.9));
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ------------------------------------------------------------------ camouflage

const CAMO_SIZE = 1024;

/** Camouflage pattern ids. */
export const CAMO_PATTERNS = ['multicam', 'woodland', 'flora', 'desert', 'urban'];

/** Physical size (m) covered by one tile of a camo texture. */
export const CAMO_TILE_M = 0.5;

const CAMO_PAINTERS = {
  multicam(cv, rand) {
    const S = cv.width;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#8b8462';
    ctx.fillRect(0, 0, S, S);
    // large soft tonal zones
    for (let i = 0; i < 30; i++) {
      const c3 = i % 3 === 0 ? '165,154,118' : i % 3 === 1 ? '108,114,80' : '132,116,86';
      softBlobWrapped(ctx, S, rand() * S, rand() * S, S * (0.06 + rand() * 0.07), S * (0.1 + rand() * 0.1), c3, 0.75);
    }
    // mid tone blobs (olive, brown, tan)
    layer(cv, 2.5, (c) => {
      for (let i = 0; i < 80; i++) {
        const k = rand();
        const col = k < 0.36 ? '#5e6040' : k < 0.7 ? '#76603f' : '#a09271';
        fillWrapped(c, S, blobShape(rand, S * (0.018 + rand() * 0.035), 0.7 + rand() * 0.5, 1.1 + rand() * 0.9, rand() * 3), rand() * S, rand() * S, col);
      }
    });
    // dark brown branches
    layer(cv, 1.2, (c) => {
      for (let i = 0; i < 46; i++) {
        fillWrapped(c, S, blobShape(rand, S * (0.008 + rand() * 0.016), 0.6, 1.6 + rand(), rand() * 3, 0.7, 8), rand() * S, rand() * S, '#47372a');
      }
      for (let i = 0; i < 70; i++) twigWrapped(c, S, rand, rand() * S, rand() * S, S * (0.02 + rand() * 0.045), 2 + rand() * 4, '#3e3125');
    });
    // cream highlights
    layer(cv, 1.2, (c) => {
      for (let i = 0; i < 44; i++) {
        fillWrapped(c, S, blobShape(rand, S * (0.005 + rand() * 0.011), 0.7, 1.4, rand() * 3, 0.6, 7), rand() * S, rand() * S, '#c7bb95');
      }
    });
  },
  woodland(cv, rand) {
    const S = cv.width;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#7c8059';
    ctx.fillRect(0, 0, S, S);
    layer(cv, 1.6, (c) => {
      for (let i = 0; i < 22; i++) fillWrapped(c, S, blobShape(rand, S * (0.05 + rand() * 0.05), 1.7 + rand() * 0.6, 0.7, rand() * 0.8 - 0.4, 0.6, 12), rand() * S, rand() * S, '#6a4f36');
      for (let i = 0; i < 24; i++) fillWrapped(c, S, blobShape(rand, S * (0.045 + rand() * 0.05), 1.6 + rand() * 0.6, 0.75, rand() * 0.8 - 0.4, 0.6, 12), rand() * S, rand() * S, '#3d4a2f');
      for (let i = 0; i < 30; i++) fillWrapped(c, S, blobShape(rand, S * (0.012 + rand() * 0.02), 1.8, 0.6, rand() * 0.8 - 0.4, 0.7, 9), rand() * S, rand() * S, '#25231e');
      for (let i = 0; i < 26; i++) twigWrapped(c, S, rand, rand() * S, rand() * S, S * 0.05, 6 + rand() * 6, '#25231e');
    });
  },
  flora(cv, rand) {
    const S = cv.width;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#a69771';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 16; i++) softBlobWrapped(ctx, S, rand() * S, rand() * S, S * 0.07, S * 0.13, '140,126,94', 0.6);
    layer(cv, 1.6, (c) => {
      for (let i = 0; i < 70; i++) {
        const k = rand();
        const col = k < 0.45 ? '#8a7856' : k < 0.8 ? '#939273' : '#b8ab88';
        fillWrapped(c, S, flameShape(rand, S * (0.025 + rand() * 0.04), S * (0.12 + rand() * 0.18), (rand() - 0.5) * 0.25), rand() * S, rand() * S, col);
      }
      for (let i = 0; i < 46; i++) fillWrapped(c, S, flameShape(rand, S * (0.01 + rand() * 0.015), S * (0.06 + rand() * 0.1), (rand() - 0.5) * 0.3), rand() * S, rand() * S, '#7c6447');
    });
  },
  desert(cv, rand) {
    const S = cv.width;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#c2b08a';
    ctx.fillRect(0, 0, S, S);
    layer(cv, 3, (c) => {
      for (let i = 0; i < 20; i++) fillWrapped(c, S, blobShape(rand, S * (0.05 + rand() * 0.05), 1.7, 0.8, rand() - 0.5, 0.6, 12), rand() * S, rand() * S, '#a99c7a');
      for (let i = 0; i < 18; i++) fillWrapped(c, S, blobShape(rand, S * (0.04 + rand() * 0.04), 1.6, 0.8, rand() - 0.5, 0.6, 12), rand() * S, rand() * S, '#8c7151');
      for (let i = 0; i < 30; i++) fillWrapped(c, S, blobShape(rand, S * (0.01 + rand() * 0.015), 1.3, 0.8, rand() * 3, 0.6, 8), rand() * S, rand() * S, '#d6c8a6');
    });
  },
  urban(cv, rand) {
    const S = cv.width;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#86877f';
    ctx.fillRect(0, 0, S, S);
    layer(cv, 1.5, (c) => {
      for (let i = 0; i < 26; i++) fillWrapped(c, S, blobShape(rand, S * (0.04 + rand() * 0.05), 1.6, 0.8, rand() - 0.5, 0.6, 12), rand() * S, rand() * S, '#5a5b57');
      for (let i = 0; i < 20; i++) fillWrapped(c, S, blobShape(rand, S * (0.025 + rand() * 0.035), 1.5, 0.8, rand() - 0.5, 0.6, 10), rand() * S, rand() * S, '#2f302e');
      for (let i = 0; i < 26; i++) fillWrapped(c, S, blobShape(rand, S * (0.015 + rand() * 0.02), 1.3, 0.8, rand() * 3, 0.6, 9), rand() * S, rand() * S, '#aeafa8');
    });
  },
};

/**
 * Tileable camouflage colour texture (sRGB). One tile covers CAMO_TILE_M metres.
 * @param {string} pattern one of CAMO_PATTERNS
 */
export function getCamoTexture(pattern) {
  const p = CAMO_PAINTERS[pattern] ? pattern : 'multicam';
  return cached(`camo:${p}`, () => {
    const cv = makeCanvas(CAMO_SIZE, CAMO_SIZE);
    const rand = rng(0x51A7 + CAMO_PATTERNS.indexOf(p) * 7919);
    CAMO_PAINTERS[p](cv, rand);
    boxBlurTile(cv, 1, 2);
    fabricGrain(cv, rand, 9, 7);
    return canvasTexture(cv);
  });
}

// ------------------------------------------------------------------ normal maps

function heightToNormalTexture(h, W, H, strength) {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const yu = ((y + 1) % H) * W; const yd = ((y - 1 + H) % H) * W; const yc = y * W;
    for (let x = 0; x < W; x++) {
      const xr = (x + 1) % W; const xl = (x - 1 + W) % W;
      const dx = (h[yc + xr] - h[yc + xl]) * 0.5 * strength;
      const dy = (h[yu + x] - h[yd + x]) * 0.5 * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (yc + x) * 4;
      data[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Tileable value noise (periodic) used for height fields. */
function periodicNoise(W, H, cells, rand) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = (y / H) * cells; const iy = Math.floor(fy); const ty = fy - iy;
    const sy = ty * ty * (3 - 2 * ty);
    const y0 = iy % cells; const y1 = (iy + 1) % cells;
    for (let x = 0; x < W; x++) {
      const fx = (x / W) * cells; const ix = Math.floor(fx); const tx = fx - ix;
      const sx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cells; const x1 = (ix + 1) % cells;
      const a = g[y0 * cells + x0]; const b = g[y0 * cells + x1];
      const c = g[y1 * cells + x0]; const d = g[y1 * cells + x1];
      out[y * W + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

const FABRIC_N = 1024;

/**
 * Cloth normal map: soft folds/wrinkles + ripstop grid + weave. One tile = CAMO_TILE_M metres
 * at repeat 1. Returns a clone sharing the GPU image, with its own repeat.
 * @param {number} repeat texture repeat relative to the camo tile (1 = same scale)
 */
export function getFabricNormal(repeat = 1) {
  const base = cached('fabricNormal', () => {
    const W = FABRIC_N;
    const rand = rng(0xFAB1C);
    const h = new Float32Array(W * W);
    const mask1 = periodicNoise(W, W, 4, rand);
    const mask2 = periodicNoise(W, W, 8, rand);
    const fine = periodicNoise(W, W, 128, rand);
    const folds = [];
    for (let k = 0; k < 7; k++) {
      folds.push({ f: [3, 5, 6, 8, 9, 11, 13][k], g: 1 + (k % 3), ph: rand() * 6.28, ph2: rand() * 6.28, amp: 9 / (1 + k * 0.5), warp: 0.08 + rand() * 0.12 });
    }
    const TAU = Math.PI * 2;
    for (let y = 0; y < W; y++) {
      const v = y / W;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const i = y * W + x;
        // folds run around limbs (lines of constant v), modulated by low frequency masks
        let fold = 0;
        for (let k = 0; k < folds.length; k++) {
          const F = folds[k];
          const s = Math.sin(TAU * (F.f * v + F.warp * Math.sin(TAU * (F.g * u) + F.ph2)) + F.ph);
          fold += F.amp * 0.5 * (1 + s) * (k % 2 ? mask1[i] : mask2[i]);
        }
        // ripstop grid every 16 px (8 mm), raised 2 px threads
        const rip = ((x & 15) < 2 || (y & 15) < 2) ? 0.55 : 0;
        // plain weave bumps (period 4 px) with slight per-thread variation
        const weave = 0.16 * Math.sin((x * Math.PI) / 2) * Math.sin((y * Math.PI) / 2) + 0.05 * fine[i];
        h[i] = fold + rip + weave;
      }
    }
    return heightToNormalTexture(h, W, W, 1.0);
  });
  if (repeat === 1) return base;
  return cached(`fabricNormal:${repeat}`, () => {
    const t = base.clone();
    t.repeat.set(repeat, repeat);
    t.needsUpdate = true;
    return t;
  });
}

const NYLON_N = 512;
/** Physical size (m) of one tile of the nylon (gear) textures. */
export const NYLON_TILE_M = 0.25;

/**
 * Cordura nylon detail: light grey colour map (multiplied by vertex colours) + normal map.
 * @returns {{ map: THREE.Texture, normalMap: THREE.Texture }}
 */
export function getNylonTextures() {
  return cached('nylon', () => {
    const W = NYLON_N;
    const rand = rng(0xC0D7A);
    const h = new Float32Array(W * W);
    const blotch = periodicNoise(W, W, 6, rand);
    const fine = periodicNoise(W, W, 96, rand);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const warp = Math.sin((x * Math.PI) / 3) ** 2;
        const weft = Math.sin((y * Math.PI) / 3) ** 2;
        const over = (((x / 3) | 0) + ((y / 3) | 0)) & 1;
        h[i] = (over ? warp : weft) * 0.35 + fine[i] * 0.25;
      }
    }
    const normalMap = heightToNormalTexture(h, W, W, 1.0);
    const cv = makeCanvas(W, W);
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(W, W);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const v = 214 + (h[i] - 0.3) * 40 - (blotch[i] - 0.5) * 26 + (rand() - 0.5) * 8;
        const o = i * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.max(0, Math.min(255, v));
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { map: canvasTexture(cv), normalMap };
  });
}

// ------------------------------------------------------------------ faces

/** Skin tone palette (sRGB hex), light → dark. */
export const SKIN_TONES = ['#d8a888', '#c38a66', '#a8714f', '#8a5a3c', '#6a4129', '#4a2d1c'];
const HAIR = ['#5a4330', '#2e2219', '#231a13', '#1e1712', '#17120e', '#120e0b'];

/** Face texture layout: u wraps around the head (0.5 = face centre), v from chin (0) to crown (1). */
export const FACE_TEX = { W: 512, H: 256, y0: -0.078, y1: 0.172 };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb(c, k = 1, a = 1) {
  return `rgba(${Math.round(Math.min(255, c[0] * k))},${Math.round(Math.min(255, c[1] * k))},${Math.round(Math.min(255, c[2] * k))},${a})`;
}

/**
 * Face/head texture for a skin tone and style.
 * @param {number} tone index into SKIN_TONES
 * @param {'clean'|'stubble'|'beard'|'balaclava'} style
 * @param {string} [knit] balaclava colour (hex)
 */
export function getFaceTexture(tone = 0, style = 'stubble', knit = '#26272a') {
  const ti = ((tone % SKIN_TONES.length) + SKIN_TONES.length) % SKIN_TONES.length;
  return cached(`face:${ti}:${style}:${knit}`, () => {
    const { W, H } = FACE_TEX;
    const cv = makeCanvas(W, H);
    const ctx = cv.getContext('2d');
    const rand = rng(1234 + ti * 31 + style.length * 7);
    const skin = hexToRgb(SKIN_TONES[ti]);
    const hair = hexToRgb(HAIR[ti]);
    const X = (u) => u * W;
    const Y = (v) => (1 - v) * H;
    const vy = (y) => (y - FACE_TEX.y0) / (FACE_TEX.y1 - FACE_TEX.y0);
    const softDot = (x, y, rx, ry, col, a0 = 1) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      g.addColorStop(0, col.replace(/[\d.]+\)$/, `${a0})`));
      g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
      ctx.save();
      ctx.translate(x, y); ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); ctx.translate(-x, -y);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, Math.max(rx, ry), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };
    // base skin with subtle variation
    ctx.fillStyle = rgb(skin);
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) {
      softDot(rand() * W, rand() * H, 6 + rand() * 18, 6 + rand() * 18, rgb(skin, 0.9 + rand() * 0.2, 1), 0.18);
    }
    const ex = 0.068; // eye u offset
    const eyeV = vy(0.045);
    // warm / red zones (cheeks, nose, ears, lips area)
    softDot(X(0.5 - 0.09), Y(vy(0.012)), 30, 18, 'rgba(190,80,70,1)', 0.14);
    softDot(X(0.5 + 0.09), Y(vy(0.012)), 30, 18, 'rgba(190,80,70,1)', 0.14);
    softDot(X(0.5), Y(vy(0.02)), 14, 22, 'rgba(180,80,70,1)', 0.12);
    softDot(X(0.25), Y(vy(0.03)), 18, 26, 'rgba(170,70,60,1)', 0.16);
    softDot(X(0.75), Y(vy(0.03)), 18, 26, 'rgba(170,70,60,1)', 0.16);
    // eye sockets shading
    for (const s of [-1, 1]) softDot(X(0.5 + s * ex), Y(eyeV + 0.01), 26, 15, 'rgba(60,35,30,1)', 0.35);
    // beard / stubble
    const speckle = (count, accept, color, alphaFn, size) => {
      const img = ctx.getImageData(0, 0, W, H);
      const d = img.data;
      for (let i = 0; i < count; i++) {
        const u = rand(); const v = rand();
        if (!accept(u, v)) continue;
        const a = alphaFn();
        const x0 = Math.floor(u * W); const y0 = Math.floor((1 - v) * H);
        for (let yy = 0; yy < size; yy++) {
          for (let xx = 0; xx < size; xx++) {
            const x = (x0 + xx) % W; const y = Math.min(H - 1, y0 + yy);
            const o = (y * W + x) * 4;
            d[o] += (color[0] - d[o]) * a; d[o + 1] += (color[1] - d[o + 1]) * a; d[o + 2] += (color[2] - d[o + 2]) * a;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
    };
    if (style === 'stubble' || style === 'beard') {
      const dens = style === 'beard' ? 1 : 0.55;
      speckle(style === 'beard' ? 30000 : 18000, (u0, v) => {
        const u = 0.32 + u0 * 0.36;
        const du = Math.abs(u - 0.5);
        if (v > vy(0.002)) return false;
        if (v > vy(-0.012) && du > 0.05) return false;
        if (Math.abs(v - vy(-0.028)) < 0.022 && du < 0.045) return false;
        return du < 0.18;
      }, hair, () => (0.18 + rand() * 0.25) * dens, 1);
    }
    // lips
    const lipV = vy(-0.028);
    ctx.fillStyle = rgb([skin[0] * 0.78 + 30, skin[1] * 0.6, skin[2] * 0.6], 1, 0.85);
    ctx.beginPath();
    ctx.ellipse(X(0.5), Y(lipV), 22, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgb(skin, 0.45, 0.8);
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(X(0.5) - 22, Y(lipV)); ctx.quadraticCurveTo(X(0.5), Y(lipV) + 1.5, X(0.5) + 22, Y(lipV)); ctx.stroke();
    // eyes
    const iris = ti <= 1 && rand() < 0.5 ? '#4a6a7a' : '#3a2a1e';
    for (const s of [-1, 1]) {
      const cx = X(0.5 + s * ex); const cy = Y(eyeV);
      ctx.fillStyle = '#d9d2c8';
      ctx.beginPath(); ctx.ellipse(cx, cy, 12, 4.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = iris;
      ctx.beginPath(); ctx.arc(cx + s * 0.5, cy, 4.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0c0a09';
      ctx.beginPath(); ctx.arc(cx + s * 0.5, cy, 1.9, 0, Math.PI * 2); ctx.fill();
      // upper lid line + crease
      ctx.strokeStyle = 'rgba(25,15,12,0.9)';
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.ellipse(cx, cy + 0.8, 12.5, 5.4, 0, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
      ctx.strokeStyle = rgb(skin, 0.7, 0.6);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(cx, cy - 1, 13, 8, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      // brows
      ctx.strokeStyle = rgb(hair, 1, 0.92);
      ctx.lineWidth = 4.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - s * 15, Y(vy(0.061)) + 1.5);
      ctx.quadraticCurveTo(cx + s * 2, Y(vy(0.066)), cx + s * 16, Y(vy(0.062)) + 2);
      ctx.stroke();
    }
    // nose shading (sides + nostrils)
    softDot(X(0.5 - 0.022), Y(vy(0.02)), 5, 16, 'rgba(90,50,40,1)', 0.25);
    softDot(X(0.5 + 0.022), Y(vy(0.02)), 5, 16, 'rgba(90,50,40,1)', 0.25);
    softDot(X(0.5 - 0.012), Y(vy(-0.003)), 4, 2.5, 'rgba(40,20,15,1)', 0.7);
    softDot(X(0.5 + 0.012), Y(vy(-0.003)), 4, 2.5, 'rgba(40,20,15,1)', 0.7);
    // short hair (visible without a helmet): top, back and sides above the ears
    speckle(60000, (u, v) => {
      const du = Math.abs(u - 0.5);
      const line = du < 0.16 ? vy(0.128) + (du / 0.16) * 0.02 : du < 0.26 ? vy(0.1) - (du - 0.16) * 0.6 : vy(-0.035);
      if (v < line) return false;
      return !(du > 0.2 && du < 0.3 && v < vy(0.07));
    }, hair, () => 0.45 + rand() * 0.45, 2);
    if (style === 'balaclava') {
      const k = hexToRgb(knit);
      const keep = makeCanvas(W, H);
      keep.getContext('2d').drawImage(cv, 0, 0);
      ctx.fillStyle = rgb(k);
      ctx.fillRect(0, 0, W, H);
      for (let x = 0; x < W; x += 3) {
        ctx.fillStyle = `rgba(0,0,0,${0.12 + rand() * 0.08})`;
        ctx.fillRect(x, 0, 1, H);
      }
      for (let i = 0; i < 4000; i++) {
        ctx.fillStyle = `rgba(255,255,255,${rand() * 0.06})`;
        ctx.fillRect(rand() * W, rand() * H, 2, 1);
      }
      // eye opening shows the skin + eyes
      ctx.save();
      ctx.beginPath();
      const rx = X(0.5 - 0.115); const ry = Y(vy(0.068)); const rw = X(0.23); const rh = Y(vy(0.024)) - Y(vy(0.068));
      ctx.roundRect(rx, ry, rw, rh, 9);
      ctx.clip();
      ctx.drawImage(keep, 0, 0);
      ctx.restore();
      ctx.strokeStyle = rgb(k, 0.7, 1);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(rx, ry, rw, rh, 9); ctx.stroke();
    }
    // neck strip (bottom rows, used by the neck tube): plain skin / knit without features
    ctx.fillStyle = style === 'balaclava' ? rgb(hexToRgb(knit)) : rgb(skin, 0.96);
    ctx.fillRect(0, H - 9, W, 9);
    return canvasTexture(cv, { repeat: false });
  });
}

/** Releases every cached soldier texture (call when leaving the game). */
export function disposeSoldierTextures() {
  for (const v of cache.values()) {
    if (v && v.isTexture) v.dispose();
    else if (v && typeof v === 'object') for (const t of Object.values(v)) if (t && t.isTexture) t.dispose();
  }
  cache.clear();
}
