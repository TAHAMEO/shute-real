// Static collision world: terrain + oriented boxes + vertical cylinders + ellipsoids,
// with a uniform spatial hash for queries. Used for player movement, bullets and line of sight.
import { dsin, dcos } from './dmath.js';

export const SHAPE_BOX = 0;
export const SHAPE_CYL = 1;
export const SHAPE_ELL = 2;

const EPS = 1e-6;

export class CollisionWorld {
  constructor(terrain, cellSize = 8) {
    this.terrain = terrain;
    this.cellSize = cellSize;
    this.inv = 1 / cellSize;
    this.half = terrain.half;
    this.gw = Math.ceil(terrain.size / cellSize) + 1;
    this.cells = new Map();
    this.colliders = [];
    this.stamp = 1;
    this._hit = { t: 0, nx: 0, ny: 1, nz: 0, mat: 'dirt', collider: null, terrain: false };
  }

  // ------------------------------------------------------------------ building
  /**
   * Oriented box. Rotation = Ry(yaw) * Rx(pitch) * Rz(roll) (three.js Euler order 'YXZ').
   * walk: participates in player movement (only valid for yaw-only boxes).
   */
  addBox(o) {
    const yaw = o.yaw || 0;
    const pitch = o.pitch || 0;
    const roll = o.roll || 0;
    const cy = dcos(yaw), sy = dsin(yaw);
    const cx = dcos(pitch), sx = dsin(pitch);
    const cz = dcos(roll), sz = dsin(roll);
    // R = Ry * Rx * Rz ; columns are local axes expressed in world space.
    const m00 = cy * cz + sy * sx * sz;
    const m01 = -cy * sz + sy * sx * cz;
    const m02 = sy * cx;
    const m10 = cx * sz;
    const m11 = cx * cz;
    const m12 = -sx;
    const m20 = -sy * cz + cy * sx * sz;
    const m21 = sy * sz + cy * sx * cz;
    const m22 = cy * cx;
    const c = {
      shape: SHAPE_BOX,
      id: this.colliders.length,
      cx: o.cx, cy: o.cy, cz: o.cz,
      hx: o.hx, hy: o.hy, hz: o.hz,
      m: [m00, m01, m02, m10, m11, m12, m20, m21, m22],
      yawOnly: !pitch && !roll,
      cos: cy, sin: sy,
      walk: o.walk !== false && !pitch && !roll,
      shoot: o.shoot !== false,
      pen: !!o.pen,
      mat: o.mat || 'concrete',
      tag: o.tag || null,
      stamp: 0,
    };
    // World AABB.
    const ex = Math.abs(m00) * o.hx + Math.abs(m01) * o.hy + Math.abs(m02) * o.hz;
    const ey = Math.abs(m10) * o.hx + Math.abs(m11) * o.hy + Math.abs(m12) * o.hz;
    const ez = Math.abs(m20) * o.hx + Math.abs(m21) * o.hy + Math.abs(m22) * o.hz;
    c.minX = o.cx - ex; c.maxX = o.cx + ex;
    c.minY = o.cy - ey; c.maxY = o.cy + ey;
    c.minZ = o.cz - ez; c.maxZ = o.cz + ez;
    return this._insert(c);
  }

  /** Vertical cylinder from y0 to y1. */
  addCylinder(o) {
    const c = {
      shape: SHAPE_CYL,
      id: this.colliders.length,
      x: o.x, z: o.z, r: o.r, y0: o.y0, y1: o.y1,
      walk: o.walk !== false,
      shoot: o.shoot !== false,
      pen: !!o.pen,
      mat: o.mat || 'wood',
      tag: o.tag || null,
      stamp: 0,
    };
    c.minX = o.x - o.r; c.maxX = o.x + o.r;
    c.minZ = o.z - o.r; c.maxZ = o.z + o.r;
    c.minY = o.y0; c.maxY = o.y1;
    return this._insert(c);
  }

  /** Ellipsoid (rocks), rotated by yaw around Y. */
  addEllipsoid(o) {
    const c = {
      shape: SHAPE_ELL,
      id: this.colliders.length,
      x: o.x, y: o.y, z: o.z, rx: o.rx, ry: o.ry, rz: o.rz,
      cos: dcos(o.yaw || 0), sin: dsin(o.yaw || 0),
      walk: o.walk !== false,
      shoot: o.shoot !== false,
      pen: false,
      mat: o.mat || 'rock',
      tag: o.tag || null,
      stamp: 0,
    };
    const rxz = Math.max(o.rx, o.rz);
    c.minX = o.x - rxz; c.maxX = o.x + rxz;
    c.minZ = o.z - rxz; c.maxZ = o.z + rxz;
    c.minY = o.y - o.ry; c.maxY = o.y + o.ry;
    return this._insert(c);
  }

  _insert(c) {
    this.colliders.push(c);
    const x0 = this._cx(c.minX), x1 = this._cx(c.maxX);
    const z0 = this._cx(c.minZ), z1 = this._cx(c.maxZ);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const k = z * this.gw + x;
        let list = this.cells.get(k);
        if (!list) { list = []; this.cells.set(k, list); }
        list.push(c);
      }
    }
    return c;
  }

  _cx(v) {
    let i = Math.floor((v + this.half) * this.inv);
    if (i < 0) i = 0;
    if (i > this.gw - 1) i = this.gw - 1;
    return i;
  }

  /** Iterate colliders overlapping an XZ rectangle (each once). */
  query(minX, minZ, maxX, maxZ, fn) {
    const st = ++this.stamp;
    const x0 = this._cx(minX), x1 = this._cx(maxX);
    const z0 = this._cx(minZ), z1 = this._cx(maxZ);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const list = this.cells.get(z * this.gw + x);
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (c.stamp === st) continue;
          c.stamp = st;
          if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
          if (fn(c) === true) return;
        }
      }
    }
  }

  // ------------------------------------------------------------------ ray tests
  /** Ray vs single collider; returns t or -1 and writes the normal into this._n. */
  rayCollider(c, ox, oy, oz, dx, dy, dz, maxT) {
    if (c.shape === SHAPE_BOX) return this._rayBox(c, ox, oy, oz, dx, dy, dz, maxT);
    if (c.shape === SHAPE_CYL) return this._rayCyl(c, ox, oy, oz, dx, dy, dz, maxT);
    return this._rayEll(c, ox, oy, oz, dx, dy, dz, maxT);
  }

  _rayBox(c, ox, oy, oz, dx, dy, dz, maxT) {
    const m = c.m;
    const px = ox - c.cx, py = oy - c.cy, pz = oz - c.cz;
    // Local = R^T * p
    const lox = m[0] * px + m[3] * py + m[6] * pz;
    const loy = m[1] * px + m[4] * py + m[7] * pz;
    const loz = m[2] * px + m[5] * py + m[8] * pz;
    const ldx = m[0] * dx + m[3] * dy + m[6] * dz;
    const ldy = m[1] * dx + m[4] * dy + m[7] * dz;
    const ldz = m[2] * dx + m[5] * dy + m[8] * dz;
    let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
    // X slab
    if (Math.abs(ldx) < EPS) { if (lox < -c.hx || lox > c.hx) return -1; } else {
      let t1 = (-c.hx - lox) / ldx, t2 = (c.hx - lox) / ldx, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
      if (t2 < tmax) tmax = t2;
    }
    if (Math.abs(ldy) < EPS) { if (loy < -c.hy || loy > c.hy) return -1; } else {
      let t1 = (-c.hy - loy) / ldy, t2 = (c.hy - loy) / ldy, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
      if (t2 < tmax) tmax = t2;
    }
    if (Math.abs(ldz) < EPS) { if (loz < -c.hz || loz > c.hz) return -1; } else {
      let t1 = (-c.hz - loz) / ldz, t2 = (c.hz - loz) / ldz, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
      if (t2 < tmax) tmax = t2;
    }
    if (tmax < tmin || tmax < 0 || tmin > maxT) return -1;
    if (tmin < 0) {
      // Origin inside the box.
      this._nx = -dx; this._ny = -dy; this._nz = -dz;
      return 0;
    }
    // Normal = local axis * sign (face entered), to world.
    // sign is -1 when entering through the negative face along the ray direction.
    const lnx = axis === 0 ? sign : 0, lny = axis === 1 ? sign : 0, lnz = axis === 2 ? sign : 0;
    this._nx = m[0] * lnx + m[1] * lny + m[2] * lnz;
    this._ny = m[3] * lnx + m[4] * lny + m[5] * lnz;
    this._nz = m[6] * lnx + m[7] * lny + m[8] * lnz;
    return tmin;
  }

  _rayCyl(c, ox, oy, oz, dx, dy, dz, maxT) {
    const px = ox - c.x, pz = oz - c.z;
    const a = dx * dx + dz * dz;
    let best = -1;
    if (a > EPS) {
      const b = px * dx + pz * dz;
      const cc = px * px + pz * pz - c.r * c.r;
      const disc = b * b - a * cc;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        let t = (-b - sq) / a;
        if (t < 0 && cc < 0) t = 0; // inside
        if (t >= 0 && t <= maxT) {
          const y = oy + dy * t;
          if (y >= c.y0 && y <= c.y1) {
            best = t;
            const hx = px + dx * t, hz = pz + dz * t;
            const l = Math.sqrt(hx * hx + hz * hz) || 1;
            this._nx = hx / l; this._ny = 0; this._nz = hz / l;
          }
        }
      }
    }
    // Caps (top only matters in practice).
    if (Math.abs(dy) > EPS) {
      const t = (c.y1 - oy) / dy;
      if (t >= 0 && t <= maxT && (best < 0 || t < best)) {
        const hx = px + dx * t, hz = pz + dz * t;
        if (hx * hx + hz * hz <= c.r * c.r) { best = t; this._nx = 0; this._ny = 1; this._nz = 0; }
      }
    }
    return best;
  }

  _rayEll(c, ox, oy, oz, dx, dy, dz, maxT) {
    // To unit-sphere space.
    const px = ox - c.x, py = oy - c.y, pz = oz - c.z;
    const lx = (px * c.cos - pz * c.sin) / c.rx;
    const ly = py / c.ry;
    const lz = (px * c.sin + pz * c.cos) / c.rz;
    const vx = (dx * c.cos - dz * c.sin) / c.rx;
    const vy = dy / c.ry;
    const vz = (dx * c.sin + dz * c.cos) / c.rz;
    const a = vx * vx + vy * vy + vz * vz;
    const b = lx * vx + ly * vy + lz * vz;
    const cc = lx * lx + ly * ly + lz * lz - 1;
    const disc = b * b - a * cc;
    if (disc < 0) return -1;
    let t = (-b - Math.sqrt(disc)) / a;
    if (t < 0) { if (cc < 0) t = 0; else return -1; }
    if (t > maxT) return -1;
    // Normal: gradient of the ellipsoid at the hit point.
    const hx = lx + vx * t, hy = ly + vy * t, hz = lz + vz * t;
    const gx = hx / c.rx, gy = hy / c.ry, gz = hz / c.rz;
    // Back to world (rotate local x/z by +yaw).
    let nx = gx * c.cos + gz * c.sin;
    let nz = -gx * c.sin + gz * c.cos;
    let ny = gy;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    this._nx = nx / l; this._ny = ny / l; this._nz = nz / l;
    return t;
  }

  /**
   * Closest hit along a ray. opts: { terrain = true, skipPen = false, filter(c) }.
   * Returns a shared hit object (copy it if you keep it) or null.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, opts = {}) {
    let bestT = maxDist;
    let best = null;
    let bnx = 0, bny = 1, bnz = 0;
    const useTerrain = opts.terrain !== false;
    const skipPen = !!opts.skipPen;
    const filter = opts.filter || null;
    // Walk the grid with a 2D DDA along the XZ projection.
    const cs = this.cellSize;
    let cx = this._cx(ox), cz = this._cx(oz);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const cellMinX = (i) => i * cs - this.half;
    const tDeltaX = Math.abs(dx) > EPS ? cs / Math.abs(dx) : Infinity;
    const tDeltaZ = Math.abs(dz) > EPS ? cs / Math.abs(dz) : Infinity;
    let tMaxX = Math.abs(dx) > EPS ? ((cellMinX(cx + (dx > 0 ? 1 : 0)) - ox) / dx) : Infinity;
    let tMaxZ = Math.abs(dz) > EPS ? ((cellMinX(cz + (dz > 0 ? 1 : 0)) - oz) / dz) : Infinity;
    const st = ++this.stamp;
    let tEnter = 0;
    for (let iter = 0; iter < 4096; iter++) {
      if (cx >= 0 && cz >= 0 && cx < this.gw && cz < this.gw) {
        const list = this.cells.get(cz * this.gw + cx);
        if (list) {
          for (let i = 0; i < list.length; i++) {
            const c = list[i];
            if (c.stamp === st) continue;
            c.stamp = st;
            if (!c.shoot && !opts.includeNonShoot) continue;
            if (skipPen && c.pen) continue;
            if (filter && !filter(c)) continue;
            const t = this.rayCollider(c, ox, oy, oz, dx, dy, dz, bestT);
            if (t >= 0 && t < bestT) {
              bestT = t; best = c; bnx = this._nx; bny = this._ny; bnz = this._nz;
            }
          }
        }
      }
      const tNext = tMaxX < tMaxZ ? tMaxX : tMaxZ;
      if (tNext > bestT || tEnter > maxDist) break;
      tEnter = tNext;
      if (tMaxX < tMaxZ) { cx += stepX; tMaxX += tDeltaX; } else { cz += stepZ; tMaxZ += tDeltaZ; }
      if ((cx < 0 && stepX < 0) || (cz < 0 && stepZ < 0) || (cx >= this.gw && stepX > 0) || (cz >= this.gw && stepZ > 0)) break;
    }
    let terrainHit = false;
    if (useTerrain) {
      const tt = this.terrain.raycast(ox, oy, oz, dx, dy, dz, bestT);
      if (tt >= 0 && tt < bestT) {
        bestT = tt; best = null; terrainHit = true;
        const n = this.terrain.normalAt(ox + dx * tt, oz + dz * tt);
        bnx = n.x; bny = n.y; bnz = n.z;
      }
    }
    if (!best && !terrainHit) return null;
    const h = this._hit;
    h.t = bestT; h.nx = bnx; h.ny = bny; h.nz = bnz;
    h.collider = best; h.terrain = terrainHit;
    h.mat = best ? best.mat : 'terrain';
    h.x = ox + dx * bestT; h.y = oy + dy * bestT; h.z = oz + dz * bestT;
    return h;
  }

  /** True if the straight segment a->b is blocked (terrain or solid colliders). */
  segmentBlocked(ax, ay, az, bx, by, bz, opts = {}) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-4) return false;
    const hit = this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05, opts);
    return !!hit;
  }

  // ------------------------------------------------------------------ movement
  /**
   * Highest walkable support at (x, z) not higher than maxY. Returns height and sets this.groundMat.
   * radius: footprint radius used for box support (slightly less than the body radius).
   */
  groundHeight(x, z, maxY, radius = 0.2) {
    let h = this.terrain.heightAt(x, z);
    let mat = 'terrain';
    this.query(x - radius, z - radius, x + radius, z + radius, (c) => {
      if (!c.walk) return;
      if (c.shape === SHAPE_BOX) {
        const top = c.cy + c.hy;
        if (top > maxY || top <= h) return;
        const px = x - c.cx, pz = z - c.cz;
        const lx = px * c.cos - pz * c.sin;
        const lz = px * c.sin + pz * c.cos;
        if (Math.abs(lx) <= c.hx + radius && Math.abs(lz) <= c.hz + radius) { h = top; mat = c.mat; }
      } else if (c.shape === SHAPE_CYL) {
        const top = c.y1;
        if (top > maxY || top <= h) return;
        const px = x - c.x, pz = z - c.z;
        if (px * px + pz * pz <= (c.r + radius * 0.5) * (c.r + radius * 0.5)) { h = top; mat = c.mat; }
      } else {
        const top = this._ellTop(c, x, z);
        if (top === null || top > maxY || top <= h) return;
        h = top; mat = c.mat;
      }
    });
    this.groundMat = mat;
    return h;
  }

  _ellTop(c, x, z) {
    const px = x - c.x, pz = z - c.z;
    const lx = (px * c.cos - pz * c.sin) / c.rx;
    const lz = (px * c.sin + pz * c.cos) / c.rz;
    const q = 1 - lx * lx - lz * lz;
    if (q <= 0) return null;
    return c.y + c.ry * Math.sqrt(q);
  }

  /** Lowest ceiling above y within the footprint (for stand-up checks / head bumps). */
  ceilingHeight(x, z, y, radius = 0.3) {
    let best = Infinity;
    this.query(x - radius, z - radius, x + radius, z + radius, (c) => {
      if (!c.walk) return;
      if (c.shape === SHAPE_BOX) {
        const bottom = c.cy - c.hy;
        if (bottom < y || bottom >= best) return;
        const px = x - c.cx, pz = z - c.cz;
        const lx = px * c.cos - pz * c.sin;
        const lz = px * c.sin + pz * c.cos;
        if (Math.abs(lx) <= c.hx + radius * 0.7 && Math.abs(lz) <= c.hz + radius * 0.7) best = bottom;
      }
    });
    return best;
  }

  /**
   * Push a vertical body (cylinder radius r, from feet y to y+height) out of colliders.
   * Obstacles whose top is within stepHeight of the feet are ignored (they are stepped onto).
   * Mutates p.x / p.z. Returns true if any contact happened.
   */
  resolveBody(p, r, height, stepHeight) {
    let hit = false;
    const yLow = p.y + stepHeight;
    const yHigh = p.y + height;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.query(p.x - r - 0.5, p.z - r - 0.5, p.x + r + 0.5, p.z + r + 0.5, (c) => {
        if (!c.walk) return;
        if (c.shape === SHAPE_BOX) {
          if (c.cy + c.hy <= yLow || c.cy - c.hy >= yHigh) return;
          const px = p.x - c.cx, pz = p.z - c.cz;
          const lx = px * c.cos - pz * c.sin;
          const lz = px * c.sin + pz * c.cos;
          const qx = Math.max(-c.hx, Math.min(c.hx, lx));
          const qz = Math.max(-c.hz, Math.min(c.hz, lz));
          let ddx = lx - qx, ddz = lz - qz;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 >= r * r) return;
          let nlx, nlz, push;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            nlx = ddx / d; nlz = ddz / d; push = r - d;
          } else {
            // Centre inside the box: push out along the shallowest axis.
            const ox = c.hx - Math.abs(lx), oz = c.hz - Math.abs(lz);
            if (ox < oz) { nlx = lx >= 0 ? 1 : -1; nlz = 0; push = ox + r; } else { nlx = 0; nlz = lz >= 0 ? 1 : -1; push = oz + r; }
          }
          // Local -> world (inverse of the transform above).
          const wx = nlx * c.cos + nlz * c.sin;
          const wz = -nlx * c.sin + nlz * c.cos;
          p.x += wx * push; p.z += wz * push;
          moved = true; hit = true;
        } else if (c.shape === SHAPE_CYL) {
          if (c.y1 <= yLow || c.y0 >= yHigh) return;
          const dx = p.x - c.x, dz = p.z - c.z;
          const rr = r + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr) return;
          const d = Math.sqrt(d2) || 1e-4;
          const push = rr - d;
          p.x += (dx / d) * push; p.z += (dz / d) * push;
          moved = true; hit = true;
        } else {
          // Ellipsoid: use its horizontal cross-section at the step height (clamped to the body range).
          if (c.y + c.ry <= yLow || c.y - c.ry >= yHigh) return;
          const top = this._ellTop(c, p.x, p.z);
          if (top !== null && top <= yLow) return; // walkable (we are on top of it)
          let sy = Math.max(yLow, Math.min(yHigh, c.y));
          const k = (sy - c.y) / c.ry;
          const s2 = 1 - k * k;
          if (s2 <= 0) return;
          const s = Math.sqrt(s2);
          const ax = c.rx * s + r, az = c.rz * s + r;
          const px = p.x - c.x, pz = p.z - c.z;
          const lx = px * c.cos - pz * c.sin;
          const lz = px * c.sin + pz * c.cos;
          const u = lx / ax, v = lz / az;
          const q = u * u + v * v;
          if (q >= 1) return;
          const sc = 1 / Math.sqrt(q || 1e-6);
          let nlx = lx * sc, nlz = lz * sc;
          if (q < 1e-6) { nlx = ax; nlz = 0; }
          const wx = nlx * c.cos + nlz * c.sin;
          const wz = -nlx * c.sin + nlz * c.cos;
          p.x = c.x + wx; p.z = c.z + wz;
          moved = true; hit = true;
        }
      });
      if (!moved) break;
    }
    return hit;
  }
}
