// Navigation grid + A* pathfinding for bots.
import { SHAPE_BOX, SHAPE_CYL } from './collision.js';
import { PLAYER } from './constants.js';

export class NavGrid {
  /**
   * @param {import('./world.js').World} world
   * @param {number} cell grid cell size (m)
   */
  constructor(world, cell = 2) {
    this.world = world;
    this.cell = cell;
    const extent = world.playRadius + 50;
    this.extent = extent;
    this.origin = -extent;
    this.n = Math.ceil((extent * 2) / cell);
    const n = this.n;
    this.blocked = new Uint8Array(n * n);
    const t = world.terrain;
    // Slopes + outside area.
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = this.origin + (ix + 0.5) * cell;
        const z = this.origin + (iz + 0.5) * cell;
        if (x * x + z * z > (world.playRadius + 40) * (world.playRadius + 40)) { this.blocked[iz * n + ix] = 1; continue; }
        if (t.flatness(x, z) < PLAYER.maxSlope + 0.04) this.blocked[iz * n + ix] = 1;
      }
    }
    // Colliders.
    const inflate = PLAYER.radius + 0.15;
    for (const c of world.collision.colliders) {
      if (!c.walk) continue;
      if (c.maxX < this.origin || c.minX > -this.origin || c.maxZ < this.origin || c.minZ > -this.origin) continue;
      const x0 = Math.max(0, Math.floor((c.minX - inflate - this.origin) / cell));
      const x1 = Math.min(n - 1, Math.floor((c.maxX + inflate - this.origin) / cell));
      const z0 = Math.max(0, Math.floor((c.minZ - inflate - this.origin) / cell));
      const z1 = Math.min(n - 1, Math.floor((c.maxZ + inflate - this.origin) / cell));
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const x = this.origin + (ix + 0.5) * cell;
          const z = this.origin + (iz + 0.5) * cell;
          const g = t.heightAt(x, z);
          const lowY = g + PLAYER.stepHeight;
          const highY = g + PLAYER.height[0];
          if (c.maxY <= lowY || c.minY >= highY) continue;
          let inside = false;
          const half = cell * 0.5;
          if (c.shape === SHAPE_BOX) {
            const px = x - c.cx, pz = z - c.cz;
            const lx = px * c.cos - pz * c.sin, lz = px * c.sin + pz * c.cos;
            inside = Math.abs(lx) <= c.hx + inflate + half * 0.5 && Math.abs(lz) <= c.hz + inflate + half * 0.5;
          } else if (c.shape === SHAPE_CYL) {
            const dx = x - c.x, dz = z - c.z;
            const r = c.r + inflate + half * 0.4;
            inside = dx * dx + dz * dz <= r * r;
          } else {
            const px = x - c.x, pz = z - c.z;
            const lx = px * c.cos - pz * c.sin, lz = px * c.sin + pz * c.cos;
            const ax = c.rx * 0.85 + inflate, az = c.rz * 0.85 + inflate;
            inside = (lx * lx) / (ax * ax) + (lz * lz) / (az * az) <= 1;
          }
          if (inside) this.blocked[iz * n + ix] = 1;
        }
      }
    }
    this._g = new Float32Array(n * n);
    this._from = new Int32Array(n * n);
    this._stamp = new Uint32Array(n * n);
    this._closed = new Uint32Array(n * n);
    this._run = 0;
    this._heap = new Int32Array(n * n);
    this._f = new Float32Array(n * n);
  }

  toCell(x, z) {
    const ix = Math.floor((x - this.origin) / this.cell);
    const iz = Math.floor((z - this.origin) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) return -1;
    return iz * this.n + ix;
  }

  cellCenter(i, out) {
    out.x = this.origin + ((i % this.n) + 0.5) * this.cell;
    out.z = this.origin + (Math.floor(i / this.n) + 0.5) * this.cell;
    return out;
  }

  isFree(x, z) {
    const i = this.toCell(x, z);
    return i >= 0 && !this.blocked[i];
  }

  /** Nearest free cell index to (x, z) within a small radius, or -1. */
  nearestFree(x, z, maxR = 6) {
    const i0 = this.toCell(x, z);
    if (i0 >= 0 && !this.blocked[i0]) return i0;
    const n = this.n;
    const cx = Math.floor((x - this.origin) / this.cell), cz = Math.floor((z - this.origin) / this.cell);
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const ix = cx + dx, iz = cz + dz;
          if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
          const i = iz * n + ix;
          if (!this.blocked[i]) return i;
        }
      }
    }
    return -1;
  }

  /** Grid line of sight between two cells (no blocked cell on the line). */
  lineFree(a, b) {
    const n = this.n;
    let x0 = a % n, z0 = Math.floor(a / n);
    const x1 = b % n, z1 = Math.floor(b / n);
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    for (let k = 0; k < 2000; k++) {
      if (this.blocked[z0 * n + x0]) return false;
      if (x0 === x1 && z0 === z1) return true;
      const e2 = 2 * err;
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }
      // Don't cut diagonally between two blocked cells.
      if (this.blocked[z0 * n + x0]) return false;
    }
    return true;
  }

  /**
   * A* from (sx, sz) to (tx, tz). Returns an array of {x, z} waypoints (smoothed) or null.
   */
  findPath(sx, sz, tx, tz, maxExpand = 25000) {
    const start = this.nearestFree(sx, sz);
    const goal = this.nearestFree(tx, tz);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: tx, z: tz }];
    const n = this.n;
    const run = ++this._run;
    const g = this._g, f = this._f, from = this._from, stamp = this._stamp, closed = this._closed, heap = this._heap;
    const gx = goal % n, gz = Math.floor(goal / n);
    const h = (i) => {
      const dx = Math.abs((i % n) - gx), dz = Math.abs(Math.floor(i / n) - gz);
      return (dx + dz + (1.4142 - 2) * Math.min(dx, dz)) * 1.02;
    };
    let size = 0;
    const push = (i) => {
      let k = size++;
      heap[k] = i;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f[heap[p]] <= f[heap[k]]) break;
        const t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--size];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < size && f[heap[l]] < f[heap[m]]) m = l;
        if (r < size && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        const t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m;
      }
      return top;
    };
    stamp[start] = run; g[start] = 0; f[start] = h(start); from[start] = -1;
    push(start);
    let expanded = 0;
    let found = false;
    let bestI = start, bestH = Infinity;
    const DX = [1, -1, 0, 0, 1, 1, -1, -1];
    const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
    const COST = [1, 1, 1, 1, 1.4142, 1.4142, 1.4142, 1.4142];
    while (size > 0) {
      const cur = pop();
      if (closed[cur] === run) continue;
      closed[cur] = run;
      if (cur === goal) { found = true; break; }
      const hc = h(cur);
      if (hc < bestH) { bestH = hc; bestI = cur; }
      if (++expanded > maxExpand) break;
      const cx = cur % n, cz = Math.floor(cur / n);
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k], nz = cz + DZ[k];
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const ni = nz * n + nx;
        if (this.blocked[ni] || closed[ni] === run) continue;
        if (k >= 4 && (this.blocked[cz * n + nx] || this.blocked[nz * n + cx])) continue; // no corner cutting
        const ng = g[cur] + COST[k];
        if (stamp[ni] !== run || ng < g[ni]) {
          stamp[ni] = run; g[ni] = ng; from[ni] = cur; f[ni] = ng + h(ni);
          push(ni);
        }
      }
    }
    const end = found ? goal : bestI;
    // Reconstruct.
    const cells = [];
    for (let i = end; i !== -1; i = from[i]) cells.push(i);
    cells.reverse();
    // String pulling.
    const pts = [];
    let anchor = 0;
    const tmp = { x: 0, z: 0 };
    for (let i = 2; i < cells.length; i++) {
      if (!this.lineFree(cells[anchor], cells[i])) {
        anchor = i - 1;
        this.cellCenter(cells[anchor], tmp);
        pts.push({ x: tmp.x, z: tmp.z });
      }
    }
    if (found) pts.push({ x: tx, z: tz });
    else { this.cellCenter(end, tmp); pts.push({ x: tmp.x, z: tmp.z }); }
    return pts;
  }

  /** Random free point near (x, z) within radius r (or anywhere if r is falsy). */
  randomFree(rng, x = 0, z = 0, r = 0) {
    for (let k = 0; k < 60; k++) {
      let px, pz;
      if (r) { px = x + rng.range(-r, r); pz = z + rng.range(-r, r); } else {
        const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * this.world.playRadius * 0.95;
        px = Math.cos(a) * d; pz = Math.sin(a) * d;
      }
      if (this.isFree(px, pz)) return { x: px, z: pz };
    }
    return null;
  }
}

const navCache = new WeakMap();
export function getNavGrid(world) {
  let g = navCache.get(world);
  if (!g) { g = new NavGrid(world, 2); navCache.set(world, g); }
  return g;
}
