// Procedural structure templates. Each template returns a list of parts (boxes and a few
// visual primitives) in structure-local space (y = 0 at the structure's base pad).
// The SAME parts drive the client meshes and the shared colliders, so what you see is what
// blocks you. Rotations use three.js Euler order 'YXZ': ry (yaw), rx (pitch), rz (roll).

const DEG = Math.PI / 180;

/** Material tags -> surface type (impact effects / footsteps) and bullet penetrability. */
export const MATERIALS = {
  wood: { surface: 'wood', pen: true },
  wood_dark: { surface: 'wood', pen: true },
  wood_floor: { surface: 'wood', pen: false },
  wood_beam: { surface: 'wood', pen: false },
  plank_grey: { surface: 'wood', pen: true },
  corrugated: { surface: 'metal', pen: true },
  corrugated_rust: { surface: 'metal', pen: true },
  metal_dark: { surface: 'metal', pen: false },
  metal_rust: { surface: 'metal', pen: true },
  steel: { surface: 'metal', pen: false },
  container_red: { surface: 'metal', pen: true },
  container_blue: { surface: 'metal', pen: true },
  container_green: { surface: 'metal', pen: true },
  container_tan: { surface: 'metal', pen: true },
  concrete: { surface: 'concrete', pen: false },
  concrete_dark: { surface: 'concrete', pen: false },
  plaster: { surface: 'concrete', pen: false },
  plaster_white: { surface: 'concrete', pen: false },
  brick: { surface: 'concrete', pen: false },
  stone: { surface: 'rock', pen: false },
  sandbag: { surface: 'dirt', pen: false },
  hay: { surface: 'grass', pen: true },
  tarp: { surface: 'grass', pen: true },
  tarp_tan: { surface: 'grass', pen: true },
  glass: { surface: 'glass', pen: true },
  red_light: { surface: 'metal', pen: true },
  black_metal: { surface: 'metal', pen: false },
  invisible: { surface: 'concrete', pen: false },
  barrel_blue: { surface: 'metal', pen: true },
  barrel_red: { surface: 'metal', pen: true },
  barrel_green: { surface: 'metal', pen: true },
  chainlink: { surface: 'metal', pen: true },
};

function P(x, y, z, w, h, d, mat, o = {}) {
  return { x, y, z, w, h, d, mat, ry: o.ry || 0, rx: o.rx || 0, rz: o.rz || 0,
    shape: o.shape || 'box', col: o.col !== false, walk: o.walk, shoot: o.shoot, pen: o.pen,
    visible: o.visible !== false, ...o.extra };
}

/**
 * Wall with rectangular openings. axis 'x' = wall runs along X at z = fixed; 'z' = along Z at x = fixed.
 * openings: [{ c (centre along the wall), w (width), y0, y1 }] (y relative to the structure base).
 */
function wall(parts, { axis, fixed, from, to, y0, y1, t, mat, openings = [], frameMat = null, pen }) {
  const ops = [...openings].sort((a, b) => a.c - b.c);
  let cur = from;
  const add = (a, b, ya, yb) => {
    if (b - a < 0.02 || yb - ya < 0.02) return;
    const c = (a + b) / 2, len = b - a, cy = (ya + yb) / 2, hh = yb - ya;
    if (axis === 'x') parts.push(P(c, cy, fixed, len, hh, t, mat, { pen }));
    else parts.push(P(fixed, cy, c, t, hh, len, mat, { pen }));
  };
  for (const o of ops) {
    const a = o.c - o.w / 2;
    const b = o.c + o.w / 2;
    add(cur, a, y0, y1);
    add(a, b, y0, o.y0);
    add(a, b, o.y1, y1);
    if (frameMat) {
      const ft = 0.07;
      const fd = t + 0.06;
      // Frame: left, right, top, (sill)
      const fp = (c2, cy, w2, h2) => {
        if (axis === 'x') parts.push(P(c2, cy, fixed, w2, h2, fd, frameMat, { col: false }));
        else parts.push(P(fixed, cy, c2, fd, h2, w2, frameMat, { col: false }));
      };
      fp(a + ft / 2, (o.y0 + o.y1) / 2, ft, o.y1 - o.y0);
      fp(b - ft / 2, (o.y0 + o.y1) / 2, ft, o.y1 - o.y0);
      fp(o.c, o.y1 - ft / 2, o.w, ft);
      if (o.y0 > y0 + 0.05) fp(o.c, o.y0 + ft / 2, o.w + 0.12, ft);
    }
    cur = b;
  }
  add(cur, to, y0, y1);
}

/** Gable roof with the ridge along X (axis 'x') or Z. Returns ridge height above wallTop. */
function gableRoof(parts, { W, D, wallTop, pitch, overhang = 0.45, mat, thick = 0.08, axis = 'x', gableMat, wallT = 0.16 }) {
  const tanA = Math.tan(pitch);
  const cosA = Math.cos(pitch);
  const span = axis === 'x' ? D : W; // across the ridge
  const len = (axis === 'x' ? W : D) + overhang * 2;
  const halfSpan = span / 2 + overhang;
  const slope = halfSpan / cosA;
  const ridge = (span / 2) * tanA;
  const cy = wallTop + tanA * (span / 2 - overhang) / 2 + (thick / 2) / cosA;
  const off = halfSpan / 2;
  if (axis === 'x') {
    parts.push(P(0, cy, off, len, thick, slope, mat, { rx: pitch, walk: false }));
    parts.push(P(0, cy, -off, len, thick, slope, mat, { rx: -pitch, walk: false }));
    parts.push(P(0, wallTop + ridge + 0.05, 0, len, 0.08, 0.3, 'metal_dark', { col: false }));
    if (gableMat) {
      parts.push(P(W / 2 - wallT / 2, wallTop + ridge / 2, 0, D, ridge, wallT, gableMat, { shape: 'gable', ry: Math.PI / 2, col: false }));
      parts.push(P(-W / 2 + wallT / 2, wallTop + ridge / 2, 0, D, ridge, wallT, gableMat, { shape: 'gable', ry: Math.PI / 2, col: false }));
    }
  } else {
    parts.push(P(off, cy, 0, slope, thick, len, mat, { rz: -pitch, walk: false }));
    parts.push(P(-off, cy, 0, slope, thick, len, mat, { rz: pitch, walk: false }));
    parts.push(P(0, wallTop + ridge + 0.05, 0, 0.3, 0.08, len, 'metal_dark', { col: false }));
    if (gableMat) {
      parts.push(P(0, wallTop + ridge / 2, D / 2 - wallT / 2, W, ridge, wallT, gableMat, { shape: 'gable', col: false }));
      parts.push(P(0, wallTop + ridge / 2, -D / 2 + wallT / 2, W, ridge, wallT, gableMat, { shape: 'gable', col: false }));
    }
  }
  return ridge;
}

/** Solid staircase rising along +Z from (x, 0, z0). Visual treads + invisible solid colliders. */
function stairs(parts, { x, z0, width, rise, run, steps, mat, dir = 1, axis = 'z' }) {
  for (let i = 1; i <= steps; i++) {
    const top = i * rise;
    const pos = z0 + dir * (i - 0.5) * run;
    if (axis === 'z') {
      parts.push(P(x, top / 2, pos, width, top, run, 'invisible', { visible: false }));
      parts.push(P(x, top - 0.03, pos, width, 0.06, run + 0.02, mat, { col: false }));
    } else {
      parts.push(P(pos, top / 2, x, run, top, width, 'invisible', { visible: false }));
      parts.push(P(pos, top - 0.03, x, run + 0.02, 0.06, width, mat, { col: false }));
    }
  }
  // Stringers (visual).
  const len = steps * run;
  const h = steps * rise;
  const ang = Math.atan2(h, len);
  const sl = Math.sqrt(len * len + h * h);
  for (const s of [-1, 1]) {
    if (axis === 'z') {
      parts.push(P(x + s * (width / 2 + 0.03), h / 2 - 0.1, z0 + dir * len / 2, 0.06, 0.25, sl, 'wood_beam', { rx: dir * -ang, col: false }));
    } else {
      parts.push(P(z0 + dir * len / 2, h / 2 - 0.1, x + s * (width / 2 + 0.03), sl, 0.25, 0.06, 'wood_beam', { rz: dir * ang, col: false }));
    }
  }
}

// ---------------------------------------------------------------------------- templates

function houseWood(rng, o = {}) {
  const parts = [];
  const W = o.w || rng.pick([7, 8, 9]);
  const D = o.d || rng.pick([5.5, 6, 6.5]);
  const t = 0.16;
  const floorTop = 0.55;
  const wallTop = floorTop + 2.65;
  const wallMat = o.wallMat || rng.pick(['wood', 'wood', 'plank_grey', 'wood_dark']);
  const roofMat = rng.pick(['corrugated', 'corrugated_rust']);
  parts.push(P(0, 0.12, 0, W + 0.25, 0.85, D + 0.25, 'stone'));
  parts.push(P(0, floorTop - 0.05, 0, W, 0.1, D, 'wood_floor'));
  const doorX = rng.pick([-W / 4, 0, W / 4]);
  const winY0 = floorTop + 0.9, winY1 = floorTop + 2.0;
  wall(parts, { axis: 'x', fixed: D / 2 - t / 2, from: -W / 2, to: W / 2, y0: floorTop, y1: wallTop, t, mat: wallMat, frameMat: 'wood_beam',
    openings: [{ c: doorX, w: 1.1, y0: floorTop, y1: floorTop + 2.1 }, { c: doorX > 0 ? -W / 4 - 0.3 : W / 4 + 0.3, w: 1.2, y0: winY0, y1: winY1 }] });
  wall(parts, { axis: 'x', fixed: -D / 2 + t / 2, from: -W / 2, to: W / 2, y0: floorTop, y1: wallTop, t, mat: wallMat, frameMat: 'wood_beam',
    openings: [{ c: -W / 4, w: 1.2, y0: winY0, y1: winY1 }, { c: W / 4, w: 1.2, y0: winY0, y1: winY1 }] });
  const sideDoor = rng.chance(0.5);
  wall(parts, { axis: 'z', fixed: W / 2 - t / 2, from: -D / 2 + t, to: D / 2 - t, y0: floorTop, y1: wallTop, t, mat: wallMat, frameMat: 'wood_beam',
    openings: sideDoor ? [{ c: 0, w: 1.0, y0: floorTop, y1: floorTop + 2.1 }] : [{ c: 0, w: 1.1, y0: winY0, y1: winY1 }] });
  wall(parts, { axis: 'z', fixed: -W / 2 + t / 2, from: -D / 2 + t, to: D / 2 - t, y0: floorTop, y1: wallTop, t, mat: wallMat, frameMat: 'wood_beam',
    openings: [{ c: 0, w: 1.1, y0: winY0, y1: winY1 }] });
  // Corner posts.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(P(sx * (W / 2 - 0.05), (floorTop + wallTop) / 2, sz * (D / 2 - 0.05), 0.2, wallTop - floorTop, 0.2, 'wood_beam', { col: false }));
  }
  // Top beam.
  parts.push(P(0, wallTop + 0.06, D / 2 - t / 2, W + 0.1, 0.14, t + 0.06, 'wood_beam', { col: false }));
  parts.push(P(0, wallTop + 0.06, -D / 2 + t / 2, W + 0.1, 0.14, t + 0.06, 'wood_beam', { col: false }));
  gableRoof(parts, { W, D, wallTop: wallTop + 0.12, pitch: 26 * DEG, overhang: 0.5, mat: roofMat, axis: 'x', gableMat: wallMat, wallT: t });
  // Entrance steps.
  parts.push(P(doorX, 0.14, D / 2 + 0.35, 1.4, 0.3, 0.6, 'wood_floor'));
  if (sideDoor) parts.push(P(W / 2 + 0.35, 0.14, 0, 0.6, 0.3, 1.3, 'wood_floor'));
  // Chimney.
  if (rng.chance(0.6)) parts.push(P(-W / 2 + 1.2, wallTop + 1.1, -D / 4, 0.6, 2.6, 0.6, 'brick', { walk: false }));
  // Furniture.
  parts.push(P(W / 2 - 0.9, floorTop + 0.4, -D / 2 + 0.6, 1.4, 0.8, 0.7, 'wood_dark'));
  parts.push(P(-W / 4, floorTop + 0.38, 0.2, 1.4, 0.06, 0.8, 'wood_dark', { col: false }));
  parts.push(P(-W / 4, floorTop + 0.18, 0.2, 1.2, 0.36, 0.6, 'invisible', { visible: false }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(P(-W / 4 + sx * 0.62, floorTop + 0.18, 0.2 + sz * 0.32, 0.06, 0.36, 0.06, 'wood_dark', { col: false }));
  }
  if (rng.chance(0.7)) parts.push(P(-W / 2 + 0.6, floorTop + 0.45, D / 2 - 0.7, 0.9, 0.9, 0.9, 'wood'));
  return { parts, hw: W / 2 + 0.6, hd: D / 2 + 1.0, door: [doorX, D / 2 + 1.2] };
}

function housePlaster(rng, o = {}) {
  const parts = [];
  const W = o.w || rng.pick([8, 9, 10]);
  const D = o.d || rng.pick([6, 7]);
  const t = 0.25;
  const floorTop = 0.2;
  const wallTop = floorTop + 3.0;
  const mat = rng.pick(['plaster', 'plaster_white', 'plaster']);
  parts.push(P(0, 0.0, 0, W + 0.1, 0.4, D + 0.1, 'concrete'));
  const doorX = rng.pick([-W / 4, W / 4]);
  const wy0 = floorTop + 1.0, wy1 = floorTop + 2.2;
  wall(parts, { axis: 'x', fixed: D / 2 - t / 2, from: -W / 2, to: W / 2, y0: floorTop, y1: wallTop, t, mat, frameMat: 'wood_dark',
    openings: [{ c: doorX, w: 1.1, y0: floorTop, y1: floorTop + 2.15 }, { c: -doorX, w: 1.1, y0: wy0, y1: wy1 }] });
  wall(parts, { axis: 'x', fixed: -D / 2 + t / 2, from: -W / 2, to: W / 2, y0: floorTop, y1: wallTop, t, mat, frameMat: 'wood_dark',
    openings: [{ c: -W / 4, w: 1.0, y0: wy0, y1: wy1 }, { c: W / 4, w: 1.0, y0: wy0, y1: wy1 }] });
  wall(parts, { axis: 'z', fixed: W / 2 - t / 2, from: -D / 2 + t, to: D / 2 - t, y0: floorTop, y1: wallTop, t, mat, frameMat: 'wood_dark',
    openings: [{ c: 0, w: 1.0, y0: wy0, y1: wy1 }] });
  wall(parts, { axis: 'z', fixed: -W / 2 + t / 2, from: -D / 2 + t, to: D / 2 - t, y0: floorTop, y1: wallTop, t, mat, frameMat: 'wood_dark',
    openings: [{ c: 0.6, w: 1.0, y0: floorTop, y1: floorTop + 2.1 }] });
  // Interior wall with doorway.
  wall(parts, { axis: 'z', fixed: 0.5, from: -D / 2 + t, to: D / 2 - t, y0: floorTop, y1: wallTop, t: 0.15, mat,
    openings: [{ c: -D / 4, w: 1.0, y0: floorTop, y1: floorTop + 2.1 }] });
  // Flat roof + parapet.
  parts.push(P(0, wallTop + 0.12, 0, W + 0.2, 0.24, D + 0.2, 'concrete'));
  const roofTop = wallTop + 0.24;
  const stair = o.stairs ?? rng.chance(0.6);
  const ph = 0.55;
  parts.push(P(0, roofTop + ph / 2, -D / 2 - 0.05, W + 0.2, ph, 0.2, mat));
  parts.push(P(-W / 2 - 0.05, roofTop + ph / 2, 0, 0.2, ph, D + 0.2, mat));
  if (stair) {
    // Gap in the front-right parapet for the external stairs that run along the +X side.
    parts.push(P(-0.7, roofTop + ph / 2, D / 2 + 0.05, W - 1.2, ph, 0.2, mat));
    parts.push(P(W / 2 + 0.05, roofTop + ph / 2, -0.75, 0.2, ph, D - 1.3, mat));
    const steps = Math.round(roofTop / 0.24);
    const rise = roofTop / steps;
    stairs(parts, { x: W / 2 + 0.75, z0: -D / 2 - 0.2 + 0.0, width: 1.1, rise, run: (D + 0.3) / steps * 1.0, steps, mat: 'concrete', dir: 1 });
    parts.push(P(W / 2 + 0.75, roofTop / 2, D / 2 + 0.35, 1.1, roofTop, 0.6, 'concrete'));
  } else {
    parts.push(P(0, roofTop + ph / 2, D / 2 + 0.05, W + 0.2, ph, 0.2, mat));
    parts.push(P(W / 2 + 0.05, roofTop + ph / 2, 0, 0.2, ph, D + 0.2, mat));
  }
  // Window shutters (visual).
  parts.push(P(-doorX - 0.75, (wy0 + wy1) / 2, D / 2 + 0.03, 0.42, wy1 - wy0, 0.04, 'wood_dark', { col: false }));
  parts.push(P(-doorX + 0.75, (wy0 + wy1) / 2, D / 2 + 0.03, 0.42, wy1 - wy0, 0.04, 'wood_dark', { col: false }));
  // Furniture.
  parts.push(P(-W / 2 + 0.8, floorTop + 0.45, -D / 2 + 0.6, 1.2, 0.9, 0.6, 'wood_dark'));
  parts.push(P(W / 2 - 1.0, floorTop + 0.4, D / 2 - 0.8, 0.9, 0.8, 0.9, 'wood'));
  return { parts, hw: W / 2 + (stair ? 1.6 : 0.6), hd: D / 2 + 1.0, door: [doorX, D / 2 + 1.2] };
}

function barn(rng) {
  const parts = [];
  const W = 10, D = 14;
  const t = 0.18;
  const wallTop = 4.2;
  const mat = rng.pick(['wood_dark', 'plank_grey']);
  const dw = 3.6, dh = 3.6;
  wall(parts, { axis: 'x', fixed: D / 2 - t / 2, from: -W / 2, to: W / 2, y0: 0, y1: wallTop, t, mat, frameMat: 'wood_beam',
    openings: [{ c: 0, w: dw, y0: 0, y1: dh }] });
  wall(parts, { axis: 'x', fixed: -D / 2 + t / 2, from: -W / 2, to: W / 2, y0: 0, y1: wallTop, t, mat, frameMat: 'wood_beam',
    openings: [{ c: 0, w: dw, y0: 0, y1: dh }] });
  wall(parts, { axis: 'z', fixed: W / 2 - t / 2, from: -D / 2 + t, to: D / 2 - t, y0: 0, y1: wallTop, t, mat, frameMat: 'wood_beam',
    openings: [{ c: -3, w: 1.0, y0: 1.4, y1: 2.4 }, { c: 3, w: 1.0, y0: 0, y1: 2.1 }] });
  wall(parts, { axis: 'z', fixed: -W / 2 + t / 2, from: -D / 2 + t, to: D / 2 - t, y0: 0, y1: wallTop, t, mat, frameMat: 'wood_beam',
    openings: [{ c: -3, w: 1.0, y0: 1.4, y1: 2.4 }, { c: 3, w: 1.0, y0: 1.4, y1: 2.4 }] });
  gableRoof(parts, { W, D, wallTop, pitch: 34 * DEG, overhang: 0.6, mat: 'corrugated_rust', axis: 'z', gableMat: mat, wallT: t });
  // Open barn door leaves (visual + cover).
  parts.push(P(dw / 2 + 0.9, dh / 2, D / 2 + 0.85, 0.08, dh, 1.75, mat, { ry: 0 }));
  parts.push(P(-dw / 2 - 0.9, dh / 2, -D / 2 - 0.85, 0.08, dh, 1.75, mat, { ry: 0 }));
  // Hay bales inside.
  for (let i = 0; i < 6; i++) {
    const x = rng.range(-W / 2 + 1.2, W / 2 - 1.2);
    const z = rng.range(-D / 2 + 1.5, D / 2 - 1.5);
    if (Math.abs(x) < 1.6) continue;
    parts.push(P(x, 0.3, z, 1.2, 0.6, 0.6, 'hay', { ry: rng.pick([0, Math.PI / 2]) }));
    if (rng.chance(0.5)) parts.push(P(x, 0.9, z, 1.2, 0.6, 0.6, 'hay'));
  }
  // Loft beams (visual).
  for (let z = -D / 2 + 2; z < D / 2; z += 3) parts.push(P(0, wallTop - 0.1, z, W - 0.3, 0.22, 0.22, 'wood_beam', { col: false }));
  return { parts, hw: W / 2 + 0.8, hd: D / 2 + 2.6, door: [0, D / 2 + 2] };
}

function shed(rng) {
  const parts = [];
  const W = 3.2, D = 3.6, t = 0.12;
  const h0 = 2.4, h1 = 2.9;
  const mat = rng.pick(['wood', 'plank_grey', 'corrugated_rust']);
  wall(parts, { axis: 'x', fixed: D / 2 - t / 2, from: -W / 2, to: W / 2, y0: 0, y1: h0, t, mat, frameMat: 'wood_beam', openings: [{ c: 0.4, w: 1.0, y0: 0, y1: 2.0 }] });
  wall(parts, { axis: 'x', fixed: -D / 2 + t / 2, from: -W / 2, to: W / 2, y0: 0, y1: h1, t, mat });
  wall(parts, { axis: 'z', fixed: W / 2 - t / 2, from: -D / 2 + t, to: D / 2 - t, y0: 0, y1: h0, t, mat });
  wall(parts, { axis: 'z', fixed: -W / 2 + t / 2, from: -D / 2 + t, to: D / 2 - t, y0: 0, y1: h0, t, mat, openings: [{ c: 0, w: 0.7, y0: 1.2, y1: 1.8 }] });
  const pitch = Math.atan2(h1 - h0, D);
  parts.push(P(0, (h0 + h1) / 2 + 0.08, 0, W + 0.5, 0.06, D + 0.6, 'corrugated_rust', { rx: pitch, walk: false }));
  parts.push(P(-0.8, 0.4, -D / 2 + 0.6, 0.8, 0.8, 0.8, 'wood'));
  return { parts, hw: W / 2 + 0.4, hd: D / 2 + 1.2, door: [0.4, D / 2 + 1] };
}

function container(rng, o = {}) {
  const parts = [];
  const L = 6.06, Wd = 2.44, H = 2.59;
  const mat = o.mat || rng.pick(['container_red', 'container_blue', 'container_green', 'container_tan']);
  const open = o.open ?? rng.chance(0.55);
  if (!open) {
    parts.push(P(0, H / 2, 0, L, H, Wd, mat, { extra: { detail: 'container' } }));
  } else {
    const t = 0.06;
    parts.push(P(0, 0.08, 0, L, 0.16, Wd, mat, { extra: { detail: 'container_floor' } }));
    parts.push(P(0, H - t / 2, 0, L, t, Wd, mat));
    parts.push(P(0, H / 2, Wd / 2 - t / 2, L, H, t, mat, { extra: { detail: 'container_side' } }));
    parts.push(P(0, H / 2, -Wd / 2 + t / 2, L, H, t, mat, { extra: { detail: 'container_side' } }));
    parts.push(P(-L / 2 + t / 2, H / 2, 0, t, H, Wd, mat));
    // Open doors swung out.
    parts.push(P(L / 2 + 0.6, H / 2, Wd / 2 + 0.05, 1.2, H - 0.1, 0.05, mat, { ry: -0.35 }));
    parts.push(P(L / 2 + 0.6, H / 2, -Wd / 2 - 0.05, 1.2, H - 0.1, 0.05, mat, { ry: 0.35 }));
  }
  return { parts, hw: L / 2 + (open ? 1.2 : 0.3), hd: Wd / 2 + 0.4 };
}

function containerStack(rng) {
  const a = container(rng, { open: false });
  const b = container(rng, { open: false });
  const parts = [...a.parts];
  for (const p of b.parts) parts.push({ ...p, y: p.y + 2.59, x: p.x + rng.range(-0.4, 0.4) });
  return { parts, hw: 3.6, hd: 1.6 };
}

function twallRow(rng, o = {}) {
  const parts = [];
  const n = o.n || 6;
  const seg = 1.25;
  const len = n * seg;
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + seg * (i + 0.5);
    parts.push(P(x, 0.2, 0, 1.2, 0.4, 1.1, 'concrete', { extra: { detail: 'twall_base' } }));
    parts.push(P(x, 0.4 + 1.5, 0, 1.2, 3.0, 0.32, 'concrete', { extra: { detail: 'twall' } }));
  }
  return { parts, hw: len / 2 + 0.3, hd: 0.9 };
}

function jersey(rng, o = {}) {
  const n = o.n || 1;
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(P((i - (n - 1) / 2) * 3.05, 0.41, 0, 3.0, 0.82, 0.6, 'concrete', { extra: { detail: 'jersey' } }));
  return { parts, hw: n * 1.6, hd: 0.6 };
}

function sandbags(rng, o = {}) {
  const parts = [];
  const len = o.len || rng.pick([3, 4, 5]);
  const h = o.h || 0.95;
  parts.push(P(0, h / 2, 0, len, h, 0.65, 'sandbag', { shape: 'sandbags' }));
  if (o.wings !== false) {
    parts.push(P(len / 2 + 0.25, h / 2, -0.9, 0.65, h, 1.6, 'sandbag', { shape: 'sandbags' }));
    parts.push(P(-len / 2 - 0.25, h / 2, -0.9, 0.65, h, 1.6, 'sandbag', { shape: 'sandbags' }));
  }
  return { parts, hw: len / 2 + 0.7, hd: 1.8 };
}

function guardTower(rng) {
  const parts = [];
  const S = 3.0;
  const deck = 3.64;
  const postH = 6.1;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(P(sx * (S / 2 - 0.1), postH / 2, sz * (S / 2 - 0.1), 0.2, postH, 0.2, 'wood_beam'));
  }
  // Cross bracing (visual).
  const bl = Math.sqrt(S * S + deck * deck);
  const ba = Math.atan2(deck, S);
  parts.push(P(0, deck / 2, S / 2 - 0.1, bl, 0.12, 0.08, 'wood_beam', { rz: ba, col: false }));
  parts.push(P(0, deck / 2, -S / 2 + 0.1, bl, 0.12, 0.08, 'wood_beam', { rz: -ba, col: false }));
  parts.push(P(S / 2 - 0.1, deck / 2, 0, 0.08, 0.12, bl, 'wood_beam', { rx: ba, col: false }));
  // Deck.
  parts.push(P(0, deck - 0.08, 0, S + 0.4, 0.16, S + 0.4, 'wood_floor'));
  // Railing walls with sandbags on 3 sides; the +Z side has a gap for the stairs.
  const rh = 1.05;
  parts.push(P(0, deck + rh / 2, -S / 2 - 0.15, S + 0.4, rh, 0.12, 'wood', { pen: true }));
  parts.push(P(S / 2 + 0.15, deck + rh / 2, 0, 0.12, rh, S + 0.4, 'wood', { pen: true }));
  parts.push(P(-S / 2 - 0.15, deck + rh / 2, 0, 0.12, rh, S + 0.4, 'wood', { pen: true }));
  parts.push(P(-0.75, deck + rh / 2, S / 2 + 0.15, S + 0.4 - 1.5, rh, 0.12, 'wood', { pen: true }));
  // Roof.
  parts.push(P(0, postH + 0.05, 0, S + 1.0, 0.08, S + 1.0, 'corrugated_rust', { rx: 0.08, walk: false }));
  // Stairs from the ground up to the deck gap (+X half of the +Z side), running along +Z then turning is complex:
  // we run them straight out along +Z.
  const steps = 14;
  stairs(parts, { x: S / 2 - 0.5, z0: S / 2 + 0.2 + steps * 0.3, width: 0.95, rise: deck / steps, run: 0.3, steps, mat: 'wood_floor', dir: -1 });
  return { parts, hw: S / 2 + 0.8, hd: S / 2 + steps * 0.3 + 1.0 };
}

function radioTower(rng, o = {}) {
  const parts = [];
  const H = o.h || 42;
  const B = 4.0;
  parts.push(P(0, H / 2, 0, B, H, B, 'steel', { shape: 'lattice', col: false, extra: { top: 0.9 } }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(P(sx * (B / 2 - 0.12), 3, sz * (B / 2 - 0.12), 0.3, 6, 0.3, 'steel'));
    parts.push(P(sx * (B / 2 - 0.12), 0.25, sz * (B / 2 - 0.12), 0.9, 0.5, 0.9, 'concrete'));
  }
  parts.push(P(0, H + 0.2, 0, 0.35, 0.35, 0.35, 'red_light', { shape: 'sphere', col: false, extra: { light: 'blink' } }));
  parts.push(P(0, H * 0.55, 0, 0.3, 0.3, 0.3, 'red_light', { shape: 'sphere', col: false, extra: { light: 'blink' } }));
  // Dish antennas (visual).
  parts.push(P(0.9, H * 0.7, 0.9, 1.2, 1.2, 0.3, 'steel', { shape: 'dish', col: false, ry: Math.PI / 4 }));
  parts.push(P(-0.9, H * 0.62, -0.9, 1.0, 1.0, 0.3, 'steel', { shape: 'dish', col: false, ry: Math.PI * 1.25 }));
  return { parts, hw: B / 2 + 0.6, hd: B / 2 + 0.6 };
}

function signalTower(rng) {
  // The mysterious tower of Ashen Ridge: a dark obelisk with a glowing red cross-ring.
  const parts = [];
  parts.push(P(0, 1.5, 0, 14, 3, 14, 'concrete_dark'));
  parts.push(P(0, 3.6, 0, 9, 1.2, 9, 'concrete_dark'));
  const H = 78;
  parts.push(P(0, 4.2 + H / 2, 0, 4.2, H, 4.2, 'black_metal', { shape: 'frustum', extra: { top: 0.55 } }));
  // Collision approximation of the column.
  parts.push(P(0, 4.2 + 15, 0, 4.0, 30, 4.0, 'invisible', { visible: false }));
  parts.push(P(0, 4.2 + 45, 0, 3.4, 30, 3.4, 'invisible', { visible: false }));
  // Glowing signal: an X of light bars + ring.
  const gy = 28;
  parts.push(P(0, gy, 2.25, 0.35, 7, 0.1, 'red_light', { rz: 0.75, col: false, extra: { light: 'glow' } }));
  parts.push(P(0, gy, 2.25, 0.35, 7, 0.1, 'red_light', { rz: -0.75, col: false, extra: { light: 'glow' } }));
  parts.push(P(0, gy, -2.25, 0.35, 7, 0.1, 'red_light', { rz: 0.75, col: false, extra: { light: 'glow' } }));
  parts.push(P(0, gy, -2.25, 0.35, 7, 0.1, 'red_light', { rz: -0.75, col: false, extra: { light: 'glow' } }));
  parts.push(P(2.25, gy, 0, 0.1, 7, 0.35, 'red_light', { rx: 0.75, col: false, extra: { light: 'glow' } }));
  parts.push(P(2.25, gy, 0, 0.1, 7, 0.35, 'red_light', { rx: -0.75, col: false, extra: { light: 'glow' } }));
  parts.push(P(-2.25, gy, 0, 0.1, 7, 0.35, 'red_light', { rx: 0.75, col: false, extra: { light: 'glow' } }));
  parts.push(P(-2.25, gy, 0, 0.1, 7, 0.35, 'red_light', { rx: -0.75, col: false, extra: { light: 'glow' } }));
  parts.push(P(0, 4.2 + H + 0.6, 0, 0.8, 0.8, 0.8, 'red_light', { shape: 'sphere', col: false, extra: { light: 'blink' } }));
  // Access steps up the plinth.
  stairs(parts, { x: 0, z0: 7 + 3.0, width: 3, rise: 0.3, run: 0.3, steps: 10, mat: 'concrete_dark', dir: -1 });
  return { parts, hw: 8, hd: 11 };
}

function bunker(rng) {
  const parts = [];
  const W = 6, D = 4.6, t = 0.45, H = 2.5;
  const mat = 'concrete';
  wall(parts, { axis: 'x', fixed: D / 2 - t / 2, from: -W / 2, to: W / 2, y0: 0, y1: H, t, mat, openings: [{ c: 0, w: 3.2, y0: 1.3, y1: 1.6 }] });
  wall(parts, { axis: 'x', fixed: -D / 2 + t / 2, from: -W / 2, to: W / 2, y0: 0, y1: H, t, mat, openings: [{ c: 1.8, w: 1.1, y0: 0, y1: 2.0 }] });
  wall(parts, { axis: 'z', fixed: W / 2 - t / 2, from: -D / 2 + t, to: D / 2 - t, y0: 0, y1: H, t, mat, openings: [{ c: 0, w: 1.2, y0: 1.3, y1: 1.6 }] });
  wall(parts, { axis: 'z', fixed: -W / 2 + t / 2, from: -D / 2 + t, to: D / 2 - t, y0: 0, y1: H, t, mat, openings: [{ c: 0, w: 1.2, y0: 1.3, y1: 1.6 }] });
  parts.push(P(0, H + 0.2, 0, W + 0.5, 0.4, D + 0.5, mat));
  // Blast wall in front of the entrance.
  parts.push(P(1.8, 1.0, -D / 2 - 1.3, 2.2, 2.0, 0.4, mat));
  // Sandbags on the roof edge.
  parts.push(P(0, H + 0.4 + 0.3, D / 2 + 0.05, W + 0.4, 0.6, 0.5, 'sandbag', { shape: 'sandbags' }));
  return { parts, hw: W / 2 + 0.6, hd: D / 2 + 2.0 };
}

function tent(rng) {
  const parts = [];
  const W = 4.5, D = 6, H = 2.6;
  const mat = rng.pick(['tarp', 'tarp_tan']);
  parts.push(P(0, H / 2, 0, W, H, D, mat, { shape: 'gable', ry: Math.PI / 2, col: false, extra: { gableAxis: 'z' } }));
  parts.push(P(0, H * 0.35, 0, W * 0.8, H * 0.7, D, 'invisible', { visible: false, pen: true }));
  parts.push(P(0, H * 0.82, 0, W * 0.35, H * 0.3, D, 'invisible', { visible: false, pen: true }));
  return { parts, hw: W / 2 + 0.6, hd: D / 2 + 0.6 };
}

function carWreck(rng) {
  const parts = [];
  const mat = rng.pick(['metal_rust', 'metal_rust', 'container_blue', 'container_red']);
  parts.push(P(0, 0.75, 0, 4.2, 0.85, 1.8, mat, { extra: { detail: 'car_body' } }));
  parts.push(P(-0.3, 1.5, 0, 2.2, 0.7, 1.6, mat, { pen: true, extra: { detail: 'car_cabin' } }));
  for (const sx of [-1.35, 1.35]) for (const sz of [-0.85, 0.85]) {
    parts.push(P(sx, 0.36, sz, 0.72, 0.72, 0.25, 'black_metal', { shape: 'cylx', ry: Math.PI / 2, col: false }));
  }
  return { parts, hw: 2.6, hd: 1.4 };
}

function truckWreck(rng) {
  const parts = [];
  const mat = rng.pick(['metal_rust', 'container_green']);
  parts.push(P(-2.6, 1.6, 0, 2.0, 1.9, 2.3, mat, { extra: { detail: 'truck_cab' } }));
  parts.push(P(1.2, 1.05, 0, 5.4, 0.3, 2.4, 'metal_dark'));
  parts.push(P(1.2, 1.6, 1.15, 5.4, 0.8, 0.08, 'wood_dark'));
  parts.push(P(1.2, 1.6, -1.15, 5.4, 0.8, 0.08, 'wood_dark'));
  parts.push(P(3.85, 1.6, 0, 0.08, 0.8, 2.3, 'wood_dark'));
  for (const sx of [-2.6, 0.6, 2.4]) for (const sz of [-1.0, 1.0]) {
    parts.push(P(sx, 0.5, sz, 1.0, 1.0, 0.35, 'black_metal', { shape: 'cylx', ry: Math.PI / 2, col: false }));
  }
  parts.push(P(0, 0.5, 0, 6.5, 0.6, 1.6, 'invisible', { visible: false }));
  return { parts, hw: 4.2, hd: 1.6 };
}

function crateStack(rng) {
  const parts = [];
  const n = rng.int(2, 5);
  for (let i = 0; i < n; i++) {
    const s = rng.pick([0.9, 1.0, 1.2]);
    const x = rng.range(-1.2, 1.2);
    const z = rng.range(-1.0, 1.0);
    parts.push(P(x, s / 2, z, s, s, s, 'wood', { ry: rng.range(-0.3, 0.3), extra: { detail: 'crate' } }));
    if (rng.chance(0.4)) parts.push(P(x, s + 0.4, z, 0.8, 0.8, 0.8, 'wood', { ry: rng.range(-0.5, 0.5), extra: { detail: 'crate' } }));
  }
  return { parts, hw: 2.0, hd: 1.8 };
}

function barrels(rng) {
  const parts = [];
  const n = rng.int(2, 5);
  const mat = rng.pick(['barrel_blue', 'barrel_red', 'barrel_green', 'metal_rust']);
  for (let i = 0; i < n; i++) {
    const x = (i % 3) * 0.65 - 0.65;
    const z = Math.floor(i / 3) * 0.65;
    parts.push(P(x, 0.45, z, 0.6, 0.9, 0.6, mat, { shape: 'cyl' }));
  }
  return { parts, hw: 1.4, hd: 1.2 };
}

function hayBales(rng) {
  const parts = [];
  const n = rng.int(2, 4);
  for (let i = 0; i < n; i++) {
    const x = i * 1.7 - (n - 1) * 0.85;
    parts.push(P(x, 0.75, rng.range(-0.3, 0.3), 1.2, 1.5, 1.5, 'hay', { shape: 'cylx', extra: { detail: 'haybale' } }));
  }
  return { parts, hw: n * 0.9 + 0.5, hd: 1.2 };
}

function logPile(rng) {
  const parts = [];
  const L = 4;
  const rows = [3, 2, 1];
  let y = 0.18;
  for (const r of rows) {
    for (let i = 0; i < r; i++) {
      parts.push(P(0, y, (i - (r - 1) / 2) * 0.36, L, 0.36, 0.36, 'wood_dark', { shape: 'cylx', col: false }));
    }
    y += 0.31;
  }
  parts.push(P(0, 0.45, 0, L, 0.9, 1.1, 'invisible', { visible: false }));
  return { parts, hw: L / 2 + 0.4, hd: 1.0 };
}

function well(rng) {
  const parts = [];
  parts.push(P(0, 0.45, 0, 1.6, 0.9, 1.6, 'stone', { shape: 'cyl' }));
  parts.push(P(0.75, 1.3, 0, 0.12, 2.6, 0.12, 'wood_beam'));
  parts.push(P(-0.75, 1.3, 0, 0.12, 2.6, 0.12, 'wood_beam'));
  parts.push(P(0, 2.6, 0, 2.0, 0.06, 1.4, 'wood', { rx: 0.3, col: false }));
  return { parts, hw: 1.2, hd: 1.2 };
}

function powerPole(rng) {
  return { parts: [P(0, 4.5, 0, 0.26, 9, 0.26, 'wood_beam', { shape: 'cyl' }), P(0, 8.3, 0, 1.8, 0.12, 0.12, 'wood_beam', { col: false })], hw: 0.4, hd: 0.4 };
}

function fenceSegment(rng, o = {}) {
  const parts = [];
  const len = o.len || 2.4;
  const mat = o.mat || 'wood';
  parts.push(P(-len / 2, 0.55, 0, 0.12, 1.1, 0.12, 'wood_beam'));
  if (o.end) parts.push(P(len / 2, 0.55, 0, 0.12, 1.1, 0.12, 'wood_beam'));
  parts.push(P(0, 0.45, 0, len, 0.1, 0.05, mat, { pen: true }));
  parts.push(P(0, 0.85, 0, len, 0.1, 0.05, mat, { pen: true }));
  return { parts, hw: len / 2 + 0.2, hd: 0.3 };
}

function chainFence(rng, o = {}) {
  const parts = [];
  const len = o.len || 3;
  parts.push(P(-len / 2, 1.1, 0, 0.07, 2.2, 0.07, 'steel', { shape: 'cyl' }));
  if (o.end) parts.push(P(len / 2, 1.1, 0, 0.07, 2.2, 0.07, 'steel', { shape: 'cyl' }));
  parts.push(P(0, 1.05, 0, len, 2.0, 0.03, 'chainlink', { pen: true, shoot: false, extra: { detail: 'chainlink' } }));
  return { parts, hw: len / 2 + 0.2, hd: 0.3 };
}

function ruin(rng) {
  // Remains of a stone farmhouse: broken walls of uneven height.
  const parts = [];
  const W = 8, D = 6, t = 0.4;
  const mat = 'stone';
  const segs = [
    ['x', D / 2 - t / 2, -W / 2, -0.6, 2.6], ['x', D / 2 - t / 2, 0.8, W / 2, 1.4],
    ['x', -D / 2 + t / 2, -W / 2, W / 2, 2.2],
    ['z', W / 2 - t / 2, -D / 2 + t, 0.2, 2.8], ['z', -W / 2 + t / 2, -D / 2 + t, D / 2 - t, 1.1],
  ];
  for (const [axis, fixed, a, b, h] of segs) {
    const hh = h * rng.range(0.8, 1.1);
    wall(parts, { axis, fixed, from: a, to: b, y0: 0, y1: hh, t, mat, openings: hh > 2 ? [{ c: (a + b) / 2, w: 0.9, y0: 1.0, y1: 1.8 }] : [] });
  }
  for (let i = 0; i < 6; i++) {
    parts.push(P(rng.range(-W / 2, W / 2), 0.2, rng.range(-D / 2, D / 2), rng.range(0.4, 0.9), rng.range(0.25, 0.45), rng.range(0.3, 0.7), 'stone', { ry: rng.range(0, 3), col: false }));
  }
  return { parts, hw: W / 2 + 0.6, hd: D / 2 + 0.6 };
}

export const TEMPLATES = {
  house_wood: houseWood,
  house_plaster: housePlaster,
  barn,
  shed,
  container,
  container_stack: containerStack,
  twall: twallRow,
  jersey,
  sandbags,
  guard_tower: guardTower,
  radio_tower: radioTower,
  signal_tower: signalTower,
  bunker,
  tent,
  car_wreck: carWreck,
  truck_wreck: truckWreck,
  crates: crateStack,
  barrels,
  hay_bales: hayBales,
  log_pile: logPile,
  well,
  power_pole: powerPole,
  fence: fenceSegment,
  chain_fence: chainFence,
  ruin,
};

export function buildStructure(type, rng, opts) {
  const fn = TEMPLATES[type];
  if (!fn) throw new Error('Unknown structure type ' + type);
  return fn(rng, opts || {});
}
