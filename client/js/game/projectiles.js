// Bullets in flight: ballistic simulation (gravity), world + hitbox collision, penetration,
// tracers, impacts, and near-miss "whiz" for the local player.
import * as THREE from 'three';
import { rayHitboxes } from '/shared/hitboxes.js';
import { HIT_ZONES } from '/shared/weapons.js';

const GRAVITY = 9.81;

export class Projectiles {
  /**
   * @param {object} o { world, effects, audio, remotes (RemotePlayers), onLocalHit(victimId, zone, dist, pen, point) }
   */
  constructor(o) {
    this.world = o.world;
    this.effects = o.effects;
    this.audio = o.audio;
    this.remotes = o.remotes;
    this.onLocalHit = o.onLocalHit;
    this.list = [];
    this.max = 300;
    this.listener = new THREE.Vector3();
    this.localId = -1;
  }

  /**
   * Fire a bullet.
   * b = { ox, oy, oz, dx, dy, dz, speed, local, shooterId, weaponId, tracer, visual: {x,y,z} muzzle pos, maxDist, pen, suppressed }
   */
  fire(b) {
    if (this.list.length >= this.max) this.list.shift();
    const vis = b.visual || { x: b.ox, y: b.oy, z: b.oz };
    this.list.push({
      x: b.ox, y: b.oy, z: b.oz,
      vx: b.dx * b.speed, vy: b.dy * b.speed, vz: b.dz * b.speed,
      speed: b.speed, traveled: 0, maxDist: b.maxDist || 1200,
      local: !!b.local, shooterId: b.shooterId, weaponId: b.weaponId,
      tracer: b.tracer !== false, tracerBright: !!b.tracerBright,
      offX: vis.x - b.ox, offY: vis.y - b.oy, offZ: vis.z - b.oz,
      pen: b.pen ?? 1, penetrated: false, whizzed: false, age: 0,
      px: vis.x, py: vis.y, pz: vis.z,
    });
  }

  update(dt, listenerPos) {
    this.listener.copy(listenerPos);
    const col = this.world.collision;
    const tracers = this.effects.tracers;
    tracers.begin();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.age += dt;
      let remaining = dt;
      let alive = true;
      // Sub-step long frames so curved trajectories stay accurate.
      while (remaining > 1e-6 && alive) {
        const step = Math.min(remaining, 1 / 60);
        remaining -= step;
        const nvx = b.vx, nvy = b.vy - GRAVITY * step, nvz = b.vz;
        const sx = (b.vx + nvx) * 0.5 * step, sy = (b.vy + nvy) * 0.5 * step, sz = (b.vz + nvz) * 0.5 * step;
        const segLen = Math.sqrt(sx * sx + sy * sy + sz * sz);
        if (segLen < 1e-6) break;
        const dx = sx / segLen, dy = sy / segLen, dz = sz / segLen;
        // World.
        const hit = col.raycast(b.x, b.y, b.z, dx, dy, dz, segLen);
        let hitT = hit ? hit.t : segLen;
        // Players (local bullets only — the server is authoritative for everyone else's).
        let victim = null, zone = 0;
        if (b.local) {
          for (const r of this.remotes.list) {
            if (!r.alive || r.id === this.localId) continue;
            const h = rayHitboxes(r.hitboxes, b.x, b.y, b.z, dx, dy, dz, hitT);
            if (h) { hitT = h.t; victim = r; zone = h.zone; }
          }
        } else {
          this._whiz(b, dx, dy, dz, segLen);
        }
        const hx = b.x + dx * hitT, hy = b.y + dy * hitT, hz = b.z + dz * hitT;
        if (victim) {
          b.traveled += hitT;
          this.effects.blood(hx, hy, hz, dx, dy, dz);
          this.onLocalHit?.(victim.id, zone, b.traveled, b.penetrated, { x: hx, y: hy, z: hz }, b);
          alive = false;
        } else if (hit) {
          b.traveled += hitT;
          const surface = hit.terrain ? this.world.surfaceAt(hx, hz) : hit.mat;
          this.effects.impact(hx, hy, hz, hit.nx, hit.ny, hit.nz, surface, false);
          if (this.audio && b.age < 4) this.audio.playImpact(surface, { x: hx, y: hy, z: hz });
          const c = hit.collider;
          if (c && c.pen && b.pen > 0) {
            // Punch through thin cover: continue from just past the surface with reduced damage.
            b.pen--;
            b.penetrated = true;
            b.x = hx + dx * 0.35; b.y = hy + dy * 0.35; b.z = hz + dz * 0.35;
            b.vx = nvx * 0.75; b.vy = nvy * 0.75; b.vz = nvz * 0.75;
            this.effects.impact(b.x, b.y, b.z, dx, dy, dz, surface, false);
          } else {
            alive = false;
          }
        } else {
          b.x += sx; b.y += sy; b.z += sz;
          b.vx = nvx; b.vy = nvy; b.vz = nvz;
          b.traveled += segLen;
          if (b.traveled > b.maxDist || b.y < this.world.terrain.minHeight - 20) alive = false;
        }
        if (!alive) {
          b.x = hx; b.y = hy; b.z = hz;
        }
      }
      // Tracer: visual offset from the muzzle that converges onto the true path.
      const conv = Math.max(0, 1 - b.traveled / 25);
      const vx = b.x + b.offX * conv, vy = b.y + b.offY * conv, vz = b.z + b.offZ * conv;
      if (b.tracer) {
        const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
        const len = Math.min(b.traveled + 0.5, b.tracerBright ? 9 : 6);
        const tx = vx - (b.vx / sp) * len, ty = vy - (b.vy / sp) * len, tz = vz - (b.vz / sp) * len;
        const k = b.tracerBright ? 1 : 0.55;
        if (b.age > 0.008) tracers.push(tx, ty, tz, vx, vy, vz, 3.2 * k, 2.1 * k, 0.9 * k, b.tracerBright ? 0.05 : 0.03);
      }
      b.px = vx; b.py = vy; b.pz = vz;
      if (!alive) this.list.splice(i, 1);
    }
    tracers.end();
  }

  _whiz(b, dx, dy, dz, segLen) {
    if (b.whizzed || !this.audio) return;
    const L = this.listener;
    const wx = L.x - b.x, wy = L.y - b.y, wz = L.z - b.z;
    const t = wx * dx + wy * dy + wz * dz;
    if (t < 0 || t > segLen) return;
    const cx = wx - dx * t, cy = wy - dy * t, cz = wz - dz * t;
    const d2 = cx * cx + cy * cy + cz * cz;
    if (d2 < 3.5 * 3.5) {
      b.whizzed = true;
      this.audio.playWhiz({ x: b.x + dx * t, y: b.y + dy * t, z: b.z + dz * t }, b.speed > 343);
      this.onNearMiss?.(Math.sqrt(d2));
    }
  }

  clear() {
    this.list.length = 0;
  }
}

export { HIT_ZONES };
