// Shared, cached materials and procedural textures for weapon / equipment models.
// Everything is generated in code (DataTexture / canvas); nothing is downloaded.
// All MeshStandardMaterials use vertexColors: per-vertex colour carries edge wear
// (values > 1 brighten bevels) and dark "decals" (ports, bores, slots).
import * as THREE from 'three';

let TEX = null;
let MATS = null;
const RETICLES = {};

// ------------------------------------------------------------------ noise helpers

function rng(seed) {
  let s = (Math.imul(seed | 0, 2654435761) >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Tileable fBm value noise (0..1), size x size, first-octave lattice periods px/py. */
function fbm(w, h, px, py, octaves, seed, gain = 0.5) {
  const out = new Float32Array(w * h);
  const r = rng(seed);
  let amp = 1;
  let sum = 0;
  for (let o = 0; o < octaves; o++) {
    const cx = Math.min(px << o, w);
    const cy = Math.min(py << o, h);
    const lat = new Float32Array(cx * cy);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * cy;
      const iy = Math.floor(fy);
      let ty = fy - iy;
      ty = ty * ty * (3 - 2 * ty);
      const y0 = (iy % cy) * cx;
      const y1 = ((iy + 1) % cy) * cx;
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cx;
        const ix = Math.floor(fx);
        let tx = fx - ix;
        tx = tx * tx * (3 - 2 * tx);
        const x0 = ix % cx;
        const x1 = (ix + 1) % cx;
        const a = lat[y0 + x0];
        const b = lat[y0 + x1];
        const c = lat[y1 + x0];
        const d = lat[y1 + x1];
        const top = a + (b - a) * tx;
        const bot = c + (d - c) * tx;
        out[y * w + x] += amp * (top + (bot - top) * ty);
      }
    }
    sum += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}

function normalFromHeight(hgt, w, h, strength) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = hgt[y * w + ((x - 1 + w) % w)];
      const r = hgt[y * w + ((x + 1) % w)];
      const d = hgt[((y - 1 + h) % h) * w + x];
      const u = hgt[((y + 1) % h) * w + x];
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      let nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * w + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

function dataTex(data, w, h, { srgb = false, repeat = 1, aniso = 4 } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ textures

function buildTextures() {
  const S = 256;
  // Metal roughness (G channel), with low-frequency blotches and a few polished scratches.
  const n1 = fbm(S, S, 4, 4, 5, 11);
  const n2 = fbm(S, S, 16, 16, 3, 23);
  const rough = new Uint8Array(S * S * 4);
  const g = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) g[i] = 0.86 + 0.26 * (n1[i] - 0.5) + 0.1 * (n2[i] - 0.5);
  const r = rng(77);
  for (let k = 0; k < 28; k++) {
    let x = r() * S;
    let y = r() * S;
    const ang = r() * Math.PI;
    const len = 10 + r() * 70;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const depth = 0.03 + r() * 0.05;
    for (let s = 0; s < len; s++) {
      const ix = ((Math.floor(x) % S) + S) % S;
      const iy = ((Math.floor(y) % S) + S) % S;
      g[iy * S + ix] -= depth;
      x += dx; y += dy;
    }
  }
  for (let i = 0; i < S * S; i++) {
    const v = Math.min(1, Math.max(0.35, g[i]));
    rough[i * 4] = 255;
    rough[i * 4 + 1] = v * 255;
    rough[i * 4 + 2] = 255;
    rough[i * 4 + 3] = 255;
  }

  // Bead-blast / parkerized micro surface.
  const hm = fbm(S, S, 32, 32, 3, 31, 0.55);
  const metalN = normalFromHeight(hm, S, S, 1.6);
  // Polymer stipple.
  const hp = fbm(S, S, 48, 48, 2, 41, 0.6);
  for (let i = 0; i < hp.length; i++) hp[i] = Math.pow(hp[i], 1.6);
  const polyN = normalFromHeight(hp, S, S, 2.0);

  // Checkering (diamond knurl), tileable.
  const K = 128;
  const N = 16;
  const hk = new Float32Array(K * K);
  for (let y = 0; y < K; y++) {
    for (let x = 0; x < K; x++) {
      const a = ((x + y) / K) * N;
      const b = ((x - y + K) / K) * N;
      const fa = Math.abs((a - Math.floor(a)) - 0.5) * 2;
      const fb = Math.abs((b - Math.floor(b)) - 0.5) * 2;
      hk[y * K + x] = 1 - Math.max(fa, fb);
    }
  }
  const knurlN = normalFromHeight(hk, K, K, 4.0);

  // Walnut / laminate wood, grain running along U.
  const WW = 512;
  const WH = 256;
  const warp = fbm(WW, WH, 2, 3, 4, 51);
  const warp2 = fbm(WW, WH, 4, 8, 3, 52);
  const pores = fbm(WW, WH, 4, 96, 2, 53, 0.6);
  const wood = new Uint8Array(WW * WH * 4);
  const woodH = new Float32Array(WW * WH);
  const light = [112, 64, 36];
  const dark = [50, 25, 13];
  for (let y = 0; y < WH; y++) {
    for (let x = 0; x < WW; x++) {
      const i = y * WW + x;
      const t = (y / WH) * 22 + warp[i] * 3.0 + warp2[i] * 0.6;
      const ring = t - Math.floor(t);
      const late = smooth(0.62, 0.9, ring) * (1 - smooth(0.9, 1.0, ring));
      const p = pores[i];
      let m = 0.32 + 0.28 * late + 0.3 * (p - 0.5) + 0.2 * (warp2[i] - 0.5);
      m = Math.min(1, Math.max(0, m));
      woodH[i] = 1 - late * 0.6 - p * 0.4;
      const o = i * 4;
      wood[o] = light[0] + (dark[0] - light[0]) * m;
      wood[o + 1] = light[1] + (dark[1] - light[1]) * m;
      wood[o + 2] = light[2] + (dark[2] - light[2]) * m;
      wood[o + 3] = 255;
    }
  }
  const woodN = normalFromHeight(woodH, WW, WH, 0.9);

  TEX = {
    rough: dataTex(rough, S, S, { repeat: 0.3 }),
    metalN: dataTex(metalN, S, S, { repeat: 2.5 }),
    polyN: dataTex(polyN, S, S, { repeat: 3 }),
    knurlN: dataTex(knurlN, K, K, { repeat: 5 }),
    wood: dataTex(wood, WW, WH, { srgb: true, repeat: 0.25 }),
    woodN: dataTex(woodN, WW, WH, { repeat: 0.25 }),
  };
  TEX.lens = makeLensTexture();
  TEX.label = makeSmokeLabel();
}

function makeLensTexture() {
  const S = 128;
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = (y + 0.5) / S - 0.5;
      const rr = Math.hypot(u, v) * 2;
      // dark core, purple/green anti-reflection sheen towards the rim, a soft highlight
      const sheen = smooth(0.35, 0.95, rr);
      const hl = Math.exp(-(((u + 0.18) ** 2) + ((v - 0.2) ** 2)) / 0.004) * 0.6;
      const i = (y * S + x) * 4;
      d[i] = Math.min(255, 10 + sheen * 40 + hl * 200);
      d[i + 1] = Math.min(255, 14 + sheen * 22 + hl * 210);
      d[i + 2] = Math.min(255, 20 + sheen * 55 + hl * 230);
      d[i + 3] = 255;
    }
  }
  const t = dataTex(d, S, S, { srgb: true });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function makeSmokeLabel() {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return null;
  const W = 512;
  const H = 256;
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(W, H);
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#4b5034';
  g.fillRect(0, 0, W, H);
  // subtle paint variation
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 10, 1 + Math.random() * 3);
  }
  g.fillStyle = '#d9c64a';
  g.font = 'bold 44px sans-serif';
  g.textAlign = 'center';
  g.fillText('GRENADE, HAND', W / 2, 78);
  g.font = 'bold 54px sans-serif';
  g.fillText('SMOKE GREEN', W / 2, 140);
  g.font = 'bold 40px sans-serif';
  g.fillText('M18', W / 2, 196);
  g.fillRect(0, 226, W, 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ reticles

/**
 * Reticle texture: white shape with alpha (tinted by the material colour).
 * 'reddot': soft 2-4 MOA dot (dot radius = 0.16 of half-size).
 * 'holo': EOTech 65 MOA ring (radius 0.62 of half-size) + 1 MOA dot + 4 ticks.
 */
export function getReticleTexture(kind) {
  if (RETICLES[kind]) return RETICLES[kind];
  const S = kind === 'holo' ? 512 : 256;
  const d = new Uint8Array(S * S * 4);
  const half = S / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5 - half) / half;
      const v = (y + 0.5 - half) / half;
      const rr = Math.hypot(u, v);
      let a = 0;
      if (kind === 'holo') {
        // ring: radius 0.62, line half-width 0.022 (≈2.3 MOA); dot radius 0.04
        const ring = Math.max(0, 1 - Math.abs(rr - 0.62) / 0.024);
        const dot = Math.max(0, 1 - rr / 0.045);
        let tick = 0;
        const ax = Math.abs(u);
        const ay = Math.abs(v);
        if ((ax < 0.02 && ay > 0.5 && ay < 0.64) || (ay < 0.02 && ax > 0.5 && ax < 0.64)) tick = 1;
        a = Math.min(1, Math.pow(ring, 0.6) + Math.pow(dot, 0.5) + tick * 0.9);
        a = Math.max(a, Math.exp(-((rr - 0.62) ** 2) / 0.0012) * 0.18, Math.exp(-(rr * rr) / 0.004) * 0.25);
      } else {
        const core = smooth(0.17, 0.11, rr);
        const halo = Math.exp(-(rr * rr) / 0.06) * 0.22;
        a = Math.min(1, core + halo);
      }
      const i = (y * S + x) * 4;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = a * 255;
    }
  }
  const t = dataTex(d, S, S, { aniso: 8 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  RETICLES[kind] = t;
  return t;
}

/** Fraction of the reticle pane half-size occupied by the main feature (dot radius / ring radius). */
export const RETICLE_FEATURE = { reddot: 0.14, holo: 0.62 };

// ------------------------------------------------------------------ materials

function std(o) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(o.color || '#ffffff'),
    metalness: o.metalness ?? 0,
    roughness: o.roughness ?? 0.6,
    vertexColors: true,
  });
  if (o.rough) m.roughnessMap = TEX.rough;
  if (o.normal) {
    m.normalMap = TEX[o.normal];
    const s = o.ns ?? 0.3;
    m.normalScale.set(s, s);
  }
  if (o.map) m.map = TEX[o.map];
  if (o.transparent) {
    m.transparent = true;
    m.opacity = o.opacity ?? 0.5;
    m.depthWrite = o.depthWrite ?? false;
  }
  if (o.emissive) {
    m.emissive = new THREE.Color(o.emissive);
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  m.name = o.name;
  return m;
}

const DEFS = {
  // anodised aluminium (AR receivers, rails, mounts)
  anodized: { color: '#2e3033', metalness: 0.6, roughness: 0.52, rough: true, normal: 'metalN', ns: 0.05 },
  // parkerized / phosphated steel
  metal: { color: '#2f3031', metalness: 0.75, roughness: 0.48, rough: true, normal: 'metalN', ns: 0.07 },
  // blued / nitrided barrels, slides
  blued: { color: '#202124', metalness: 0.85, roughness: 0.38, rough: true, normal: 'metalN', ns: 0.04 },
  // bright machined steel: bolts, cylinder faces, pins
  steel: { color: '#9fa2a6', metalness: 1.0, roughness: 0.3, rough: true },
  // stainless (revolver, Desert Eagle option)
  stainless: { color: '#b4b6b9', metalness: 1.0, roughness: 0.34, rough: true, normal: 'metalN', ns: 0.04 },
  polymer: { color: '#1f2021', metalness: 0.0, roughness: 0.66, normal: 'polyN', ns: 0.1 },
  polymerCheck: { color: '#1d1d1e', metalness: 0.0, roughness: 0.72, normal: 'knurlN', ns: 0.45 },
  tan: { color: '#86704f', metalness: 0.0, roughness: 0.7, normal: 'polyN', ns: 0.1 },
  tanMetal: { color: '#7f6a4c', metalness: 0.3, roughness: 0.58, rough: true, normal: 'metalN', ns: 0.05 },
  od: { color: '#4b5137', metalness: 0.0, roughness: 0.7, normal: 'polyN', ns: 0.1 },
  green: { color: '#3a4632', metalness: 0.0, roughness: 0.6, normal: 'polyN', ns: 0.1 },
  plum: { color: '#4a2219', metalness: 0.0, roughness: 0.45, normal: 'polyN', ns: 0.06 },
  wood: { color: '#ffffff', metalness: 0.0, roughness: 0.48, map: 'wood', normal: 'woodN', ns: 0.12 },
  woodRed: { color: '#b88672', metalness: 0.0, roughness: 0.42, map: 'wood', normal: 'woodN', ns: 0.1 },
  woodCheck: { color: '#f2d0b8', metalness: 0.0, roughness: 0.55, map: 'wood', normal: 'knurlN', ns: 0.45 },
  rubber: { color: '#171717', metalness: 0.0, roughness: 0.9, normal: 'polyN', ns: 0.15 },
  brass: { color: '#c39a4c', metalness: 1.0, roughness: 0.3, rough: true },
  paint: { color: '#e9e5d6', metalness: 0.0, roughness: 0.6 },
  glass: { color: '#8fc0c4', metalness: 0.0, roughness: 0.04, transparent: true, opacity: 0.14 },
  lensCoat: { color: '#0e161b', metalness: 0.85, roughness: 0.08 },
  smoky: { color: '#3b372d', metalness: 0.0, roughness: 0.3, transparent: true, opacity: 0.78, depthWrite: true },
};

function buildMaterials() {
  MATS = {};
  for (const [name, o] of Object.entries(DEFS)) MATS[name] = std({ ...o, name: `weapon:${name}` });
  MATS.label = new THREE.MeshStandardMaterial({
    name: 'weapon:label', map: TEX.label, color: 0xffffff, roughness: 0.75, metalness: 0, vertexColors: true,
  });
  // Unlit glowing bits (fibre optics, tritium); colour comes from vertex colours.
  MATS.glow = new THREE.MeshBasicMaterial({ name: 'weapon:glow', vertexColors: true, toneMapped: false });
  MATS.lens = new THREE.MeshBasicMaterial({ name: 'weapon:lensPlaceholder', map: TEX.lens });
  MATS.reticle_reddot = makeReticleMaterial('reddot');
  MATS.reticle_holo = makeReticleMaterial('holo');
}

function makeReticleMaterial(kind) {
  const m = new THREE.MeshBasicMaterial({
    name: `weapon:reticle_${kind}`,
    map: getReticleTexture(kind),
    color: new THREE.Color(6.0, 0.16, 0.1),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  return m;
}

/** Build all shared textures and materials (idempotent). */
export function initWeaponMaterials() {
  if (MATS) return MATS;
  buildTextures();
  buildMaterials();
  return MATS;
}

/** Shared material by key (see DEFS + 'label', 'glow', 'lens', 'reticle_reddot', 'reticle_holo'). */
export function getMaterial(key) {
  if (!MATS) initWeaponMaterials();
  const m = MATS[key];
  if (!m) throw new Error(`weapon material '${key}' not defined`);
  return m;
}

export function getAllMaterials() {
  if (!MATS) initWeaponMaterials();
  return MATS;
}
