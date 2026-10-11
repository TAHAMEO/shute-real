// Heightfield terrain shared by server and client.
// Heights live on a regular grid; heightAt() interpolates over the same two triangles per cell
// that the client renders, so feet/physics match the visible ground exactly.
import { SimplexNoise, smoothstep, clamp } from './noise.js';
import { dsin, dcos } from './dmath.js';

export class Terrain {
  /**
   * @param {number} size world size in meters (square, centred on the origin)
   * @param {number} res  number of cells per side
   */
  constructor(size, res) {
    this.size = size;
    this.half = size / 2;
    this.res = res;
    this.n = res + 1;
    this.cell = size / res;
    this.invCell = res / size;
    this.heights = new Float32Array(this.n * this.n);
    this.minHeight = 0;
    this.maxHeight = 0;
  }

  /** Height of grid vertex (ix, iz), clamped to the grid. */
  h(ix, iz) {
    const n = this.n;
    ix = ix < 0 ? 0 : ix > n - 1 ? n - 1 : ix;
    iz = iz < 0 ? 0 : iz > n - 1 ? n - 1 : iz;
    return this.heights[iz * n + ix];
  }

  heightAt(x, z) {
    const res = this.res;
    let gx = (x + this.half) * this.invCell;
    let gz = (z + this.half) * this.invCell;
    if (gx < 0) gx = 0; else if (gx > res - 1e-6) gx = res - 1e-6;
    if (gz < 0) gz = 0; else if (gz > res - 1e-6) gz = res - 1e-6;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const n = this.n;
    const H = this.heights;
    const i = iz * n + ix;
    const h00 = H[i];
    const h11 = H[i + n + 1];
    if (fx >= fz) {
      const h10 = H[i + 1];
      return h00 + fx * (h10 - h00) + fz * (h11 - h10);
    }
    const h01 = H[i + n];
    return h00 + fz * (h01 - h00) + fx * (h11 - h01);
  }

  /** Smooth normal (central differences). Writes into out {x,y,z} and returns it. */
  normalAt(x, z, out = { x: 0, y: 1, z: 0 }) {
    const e = this.cell;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    let nx = hl - hr;
    let ny = 2 * e;
    let nz = hd - hu;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    out.x = nx / len;
    out.y = ny / len;
    out.z = nz / len;
    return out;
  }

  /** cos(slope angle): 1 = flat, 0 = vertical. */
  flatness(x, z) {
    const e = this.cell;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const ny = 2 * e;
    return ny / Math.sqrt(dx * dx + ny * ny + dz * dz);
  }

  inside(x, z, margin = 0) {
    return x > -this.half + margin && x < this.half - margin && z > -this.half + margin && z < this.half - margin;
  }

  /**
   * Ray vs terrain. dir must be normalized. Returns distance or -1.
   * Adaptive marching (bigger steps high above ground) + bisection refinement.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    const minStep = this.cell * 0.5;
    let t = 0;
    let diff = oy - this.heightAt(ox, oz);
    if (diff < 0) return 0;
    let prevT = 0;
    while (t < maxDist) {
      const step = diff * 0.3 > minStep ? diff * 0.3 : minStep;
      prevT = t;
      t += step;
      if (t > maxDist) t = maxDist;
      const x = ox + dx * t;
      const z = oz + dz * t;
      if (x < -this.half || x > this.half || z < -this.half || z > this.half) {
        // Outside the grid: only the clamped border can still be hit; keep marching.
      }
      diff = oy + dy * t - this.heightAt(x, z);
      if (diff <= 0) {
        let a = prevT;
        let b = t;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) * 0.5;
          const d = oy + dy * m - this.heightAt(ox + dx * m, oz + dz * m);
          if (d > 0) a = m; else b = m;
        }
        return (a + b) * 0.5;
      }
      if (t >= maxDist) break;
    }
    return -1;
  }

  computeRange() {
    let mn = Infinity;
    let mx = -Infinity;
    const H = this.heights;
    for (let i = 0; i < H.length; i++) {
      const v = H[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    this.minHeight = mn;
    this.maxHeight = mx;
  }

  /** Iterate grid vertices: fn(x, z, index). */
  forEachVertex(fn) {
    const n = this.n;
    for (let iz = 0; iz < n; iz++) {
      const z = -this.half + iz * this.cell;
      for (let ix = 0; ix < n; ix++) {
        fn(-this.half + ix * this.cell, z, iz * n + ix);
      }
    }
  }

  /**
   * Flatten a rotated rectangle to `height` (with a smooth blend border).
   * cx, cz centre; hw, hd half sizes; rot yaw; border blend distance.
   */
  flattenRect(cx, cz, hw, hd, rot, height, border = 6) {
    const c = dcos(rot);
    const s = dsin(rot);
    const r = Math.sqrt(hw * hw + hd * hd) + border;
    const ix0 = Math.max(0, Math.floor((cx - r + this.half) * this.invCell));
    const ix1 = Math.min(this.n - 1, Math.ceil((cx + r + this.half) * this.invCell));
    const iz0 = Math.max(0, Math.floor((cz - r + this.half) * this.invCell));
    const iz1 = Math.min(this.n - 1, Math.ceil((cz + r + this.half) * this.invCell));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = -this.half + ix * this.cell - cx;
        const z = -this.half + iz * this.cell - cz;
        // local coordinates (inverse yaw rotation)
        const lx = x * c - z * s;
        const lz = x * s + z * c;
        const ox = Math.max(0, Math.abs(lx) - hw);
        const oz = Math.max(0, Math.abs(lz) - hd);
        const d = Math.sqrt(ox * ox + oz * oz);
        if (d >= border) continue;
        const w = 1 - smoothstep(0, border, d);
        const i = iz * this.n + ix;
        this.heights[i] += (height - this.heights[i]) * w;
      }
    }
  }

  /** Flatten/smooth along a polyline (roads). Pulls heights towards a smoothed centre-line profile. */
  carveRoad(points, width, depth = 0.25, border = 4) {
    // Smoothed centreline heights.
    const prof = points.map((p) => this.heightAt(p[0], p[1]));
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 1; i < prof.length - 1; i++) prof[i] = (prof[i - 1] + prof[i] * 2 + prof[i + 1]) / 4;
    }
    const hw = width / 2;
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i];
      const [bx, bz] = points[i + 1];
      const ha = prof[i] - depth;
      const hb = prof[i + 1] - depth;
      const minX = Math.min(ax, bx) - hw - border;
      const maxX = Math.max(ax, bx) + hw + border;
      const minZ = Math.min(az, bz) - hw - border;
      const maxZ = Math.max(az, bz) + hw + border;
      const ix0 = Math.max(0, Math.floor((minX + this.half) * this.invCell));
      const ix1 = Math.min(this.n - 1, Math.ceil((maxX + this.half) * this.invCell));
      const iz0 = Math.max(0, Math.floor((minZ + this.half) * this.invCell));
      const iz1 = Math.min(this.n - 1, Math.ceil((maxZ + this.half) * this.invCell));
      const abx = bx - ax;
      const abz = bz - az;
      const len2 = abx * abx + abz * abz || 1;
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = -this.half + ix * this.cell;
          const z = -this.half + iz * this.cell;
          let t = ((x - ax) * abx + (z - az) * abz) / len2;
          t = clamp(t, 0, 1);
          const px = ax + abx * t - x;
          const pz = az + abz * t - z;
          const d = Math.sqrt(px * px + pz * pz);
          const reach = hw + border;
          if (d >= reach) continue;
          const target = ha + (hb - ha) * t;
          const w = d <= hw ? 1 : 1 - smoothstep(hw, reach, d);
          const k = iz * this.n + ix;
          this.heights[k] += (target - this.heights[k]) * w * 0.85;
        }
      }
    }
  }

  /** Add a smooth bump (hill if h > 0, depression if h < 0). Polynomial falloff (deterministic). */
  addBump(cx, cz, radius, h) {
    const ix0 = Math.max(0, Math.floor((cx - radius + this.half) * this.invCell));
    const ix1 = Math.min(this.n - 1, Math.ceil((cx + radius + this.half) * this.invCell));
    const iz0 = Math.max(0, Math.floor((cz - radius + this.half) * this.invCell));
    const iz1 = Math.min(this.n - 1, Math.ceil((cz + radius + this.half) * this.invCell));
    const r2 = radius * radius;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = -this.half + ix * this.cell - cx;
        const z = -this.half + iz * this.cell - cz;
        const d2 = (x * x + z * z) / r2;
        if (d2 >= 1) continue;
        const f = (1 - d2) * (1 - d2);
        this.heights[iz * this.n + ix] += h * f;
      }
    }
  }
}

/**
 * Generate the base terrain of a map from noise parameters.
 * p = { size, res, seed, base, hills:{amp,scale,octaves}, detail:{amp,scale}, ridges:{amp,scale},
 *       mountains:{amp, scale, start, full}, playRadius, flattenPlay, terraces }
 */
export function generateBaseTerrain(p) {
  const t = new Terrain(p.size, p.res);
  const noise = new SimplexNoise(p.seed);
  const noise2 = new SimplexNoise(p.seed + 7919);
  const half = t.half;
  const hills = p.hills || { amp: 15, scale: 0.003, octaves: 5 };
  const detail = p.detail || { amp: 1.2, scale: 0.03 };
  const mtn = p.mountains || { amp: 180, scale: 0.0018, start: 0.55, full: 0.95 };
  const ridges = p.ridges || null;
  const playR = p.playRadius || half * 0.5;
  const flattenPlay = p.flattenPlay ?? 0.4;
  t.forEachVertex((x, z, i) => {
    // Distance from centre normalised by half size (squared-ish "rounded square" metric).
    const nx = x / half;
    const nz = z / half;
    const rr = Math.sqrt(nx * nx + nz * nz);
    // Warp the distance a bit so the mountain ring is irregular.
    const warp = noise2.noise2(x * 0.0021, z * 0.0021) * 0.12;
    const edge = smoothstep(mtn.start, mtn.full, rr + warp);
    let h = p.base || 0;
    // Rolling hills.
    const hl = noise.fbm(x * hills.scale, z * hills.scale, hills.octaves || 5);
    // Reduce hills in the play area core so fights happen on readable terrain.
    const dPlay = Math.sqrt(x * x + z * z);
    const core = 1 - flattenPlay * (1 - smoothstep(playR * 0.4, playR * 1.1, dPlay));
    h += hl * hills.amp * core;
    // Secondary ridges / valleys inside the play area.
    if (ridges) {
      const rg = noise2.ridged(x * ridges.scale + 3.7, z * ridges.scale - 1.3, 4);
      h += (rg - 0.35) * ridges.amp * core;
    }
    // Mountain ring.
    if (edge > 0) {
      const m = noise.ridged(x * mtn.scale + 11.1, z * mtn.scale - 7.7, 6);
      const big = 0.55 + 0.45 * noise2.fbm(x * mtn.scale * 0.5, z * mtn.scale * 0.5, 3);
      h += edge * edge * (m * mtn.amp * big + mtn.amp * 0.18);
    }
    // Small detail.
    h += noise2.fbm(x * detail.scale, z * detail.scale, 3) * detail.amp;
    if (p.terraces) {
      // Soft terracing for rocky plateaus.
      const step = p.terraces.step;
      const k = h / step;
      const f = k - Math.floor(k);
      const tf = f * f * (3 - 2 * f);
      h = (Math.floor(k) + (f * (1 - p.terraces.strength) + tf * p.terraces.strength)) * step;
    }
    t.heights[i] = h;
  });
  t.computeRange();
  return t;
}
