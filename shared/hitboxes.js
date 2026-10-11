// Player hitboxes (capsules) derived from the network state, identical on client and server.
import { STANCE } from './constants.js';
import { HIT_ZONES } from './weapons.js';

const { HEAD, TORSO, LIMB } = HIT_ZONES;

/** Allocate a reusable hitbox set. */
export function createHitboxes() {
  const caps = [];
  for (let i = 0; i < 4; i++) caps.push({ ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0, zone: 0 });
  return { caps, cx: 0, cy: 0, cz: 0, radius: 1.2 };
}

function set(c, ax, ay, az, bx, by, bz, r, zone) {
  c.ax = ax; c.ay = ay; c.az = az; c.bx = bx; c.by = by; c.bz = bz; c.r = r; c.zone = zone;
}

/**
 * Fill hitboxes for a player at feet position (x, y, z) facing yaw with a stance and lean (-1..1).
 */
export function updateHitboxes(h, x, y, z, yaw, stance, lean = 0) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw); // forward
  const rx = Math.cos(yaw), rz = -Math.sin(yaw); // right
  const c = h.caps;
  if (stance === STANCE.PRONE) {
    set(c[0], x + fx * 0.78, y + 0.3, z + fz * 0.78, x + fx * 0.78, y + 0.3, z + fz * 0.78, 0.13, HEAD);
    set(c[1], x + fx * 0.5, y + 0.22, z + fz * 0.5, x - fx * 0.05, y + 0.2, z - fz * 0.05, 0.2, TORSO);
    set(c[2], x - fx * 0.15, y + 0.15, z - fz * 0.15, x - fx * 0.98, y + 0.12, z - fz * 0.98, 0.15, LIMB);
    set(c[3], x + fx * 0.3 + rx * 0.25, y + 0.15, z + fz * 0.3 + rz * 0.25, x + fx * 0.75 + rx * 0.15, y + 0.2, z + fz * 0.75 + rz * 0.15, 0.08, LIMB);
    h.cx = x; h.cy = y + 0.25; h.cz = z; h.radius = 1.3;
    return h;
  }
  const crouch = stance === STANCE.CROUCH;
  const lx = rx * lean * 0.32, lz = rz * lean * 0.32; // upper-body lean offset
  const headY = crouch ? 1.12 : 1.62;
  const chestTop = crouch ? 0.98 : 1.45;
  const chestBot = crouch ? 0.6 : 1.02;
  const fwdLean = crouch ? 0.12 : 0.03;
  set(c[0], x + lx + fx * (fwdLean + 0.04), y + headY, z + lz + fz * (fwdLean + 0.04), x + lx + fx * (fwdLean + 0.04), y + headY, z + lz + fz * (fwdLean + 0.04), 0.13, HEAD);
  set(c[1], x + lx * 0.7 + fx * fwdLean, y + chestTop, z + lz * 0.7 + fz * fwdLean, x + lx * 0.2, y + chestBot, z + lz * 0.2, 0.22, TORSO);
  if (crouch) {
    set(c[2], x, y + 0.55, z, x + fx * 0.25, y + 0.12, z + fz * 0.25, 0.18, LIMB);
  } else {
    set(c[2], x, y + 0.95, z, x, y + 0.12, z, 0.17, LIMB);
  }
  // Arms + weapon region (extends forward from the chest).
  const ay = y + (crouch ? 0.85 : 1.3);
  set(c[3], x + lx + rx * 0.12, ay, z + lz + rz * 0.12, x + lx + fx * 0.45 + rx * 0.05, ay + 0.02, z + lz + fz * 0.45 + rz * 0.05, 0.1, LIMB);
  h.cx = x; h.cy = y + (crouch ? 0.65 : 0.9); h.cz = z; h.radius = crouch ? 0.9 : 1.15;
  return h;
}

/**
 * Ray (origin o, normalized dir d) vs a hitbox set. Returns { t, zone } of the closest hit
 * within maxT, or null. Uses a bounding-sphere early-out.
 */
const _res = { t: 0, zone: 0 };
export function rayHitboxes(h, ox, oy, oz, dx, dy, dz, maxT) {
  // Bounding sphere.
  const sx = ox - h.cx, sy = oy - h.cy, sz = oz - h.cz;
  const b = sx * dx + sy * dy + sz * dz;
  const cc = sx * sx + sy * sy + sz * sz - h.radius * h.radius;
  if (cc > 0 && b > 0) return null;
  if (b * b - cc < 0) return null;
  let best = maxT;
  let zone = -1;
  for (let i = 0; i < h.caps.length; i++) {
    const t = rayCapsule(h.caps[i], ox, oy, oz, dx, dy, dz);
    if (t >= 0 && t < best) { best = t; zone = h.caps[i].zone; }
  }
  if (zone < 0) return null;
  _res.t = best; _res.zone = zone;
  return _res;
}

/** Ray vs capsule; returns t >= 0 or -1. */
export function rayCapsule(c, ox, oy, oz, dx, dy, dz) {
  const bax = c.bx - c.ax, bay = c.by - c.ay, baz = c.bz - c.az;
  const oax = ox - c.ax, oay = oy - c.ay, oaz = oz - c.az;
  const baba = bax * bax + bay * bay + baz * baz;
  const r = c.r;
  if (baba < 1e-8) return raySphere(c.ax, c.ay, c.az, r, ox, oy, oz, dx, dy, dz);
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  const b = baba * rdoa - baoa * bard;
  const cc = baba * oaoa - baoa * baoa - r * r * baba;
  const hh = b * b - a * cc;
  if (hh >= 0) {
    const t = (-b - Math.sqrt(hh)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0) return t;
    // Caps.
    const t2 = y <= 0
      ? raySphere(c.ax, c.ay, c.az, r, ox, oy, oz, dx, dy, dz)
      : raySphere(c.bx, c.by, c.bz, r, ox, oy, oz, dx, dy, dz);
    return t2;
  }
  return -1;
}

function raySphere(cx, cy, cz, r, ox, oy, oz, dx, dy, dz) {
  const sx = ox - cx, sy = oy - cy, sz = oz - cz;
  const b = sx * dx + sy * dy + sz * dz;
  const c = sx * sx + sy * sy + sz * sz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t >= 0) return t;
  return c < 0 ? 0 : -1;
}

/** Closest distance between a segment and a point (for explosion / melee range checks). */
export function pointDistanceToHitboxes(h, px, py, pz) {
  let best = Infinity;
  for (const c of h.caps) {
    const bax = c.bx - c.ax, bay = c.by - c.ay, baz = c.bz - c.az;
    const pax = px - c.ax, pay = py - c.ay, paz = pz - c.az;
    const l2 = bax * bax + bay * bay + baz * baz;
    let t = l2 > 1e-8 ? (pax * bax + pay * bay + paz * baz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - c.r;
    if (d < best) best = d;
  }
  return Math.max(0, best);
}
