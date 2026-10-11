// Other players and bots: snapshot interpolation, soldier models + held weapons, hitboxes
// for local hit detection, footsteps, muzzle flashes and remote gunfire.
import * as THREE from 'three';
import { createHitboxes, updateHitboxes } from '/shared/hitboxes.js';
import { weaponByIndex, WEAPONS, MUZZLES } from '/shared/weapons.js';
import { STANCE } from '/shared/constants.js';
import { eyeHeight } from '/shared/physics.js';
import { buildWeaponModel } from '../models/weapon-models.js';

const INTERP_DELAY = 0.1; // seconds
const FLAG_ADS = 2, FLAG_SPRINT = 4, FLAG_RELOAD = 8, FLAG_GROUND = 16, FLAG_PROTECT = 32, FLAG_FIRING = 128;

let SoldierModel = null;
const soldierReady = import('../models/soldier.js').then((m) => { SoldierModel = m.SoldierModel; }).catch((e) => console.warn('Soldier model unavailable:', e));

function angLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

class RemotePlayer {
  constructor(info) {
    this.id = info.id;
    this.name = info.name;
    this.team = info.team;
    this.isBot = info.isBot;
    this.variant = info.variant ?? info.id;
    this.loadout = info.loadout || null;
    this.alive = false;
    this.buffer = [];
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.stance = 0;
    this.flags = 0;
    this.lean = 0;
    this.weaponIdx = -1;
    this.weaponId = null;
    this.hitboxes = createHitboxes();
    this.model = null;
    this.weaponModel = null;
    this.firingT = 0;
    this.stepPhase = 0;
    this.lastPos = new THREE.Vector3();
    this.dead = false;
    this.visible = true;
    this.hp = 100;
  }
}

export class RemotePlayers {
  constructor(game) {
    this.game = game;
    this.scene = game.rs.scene;
    this.list = [];
    this.byId = new Map();
    this.group = new THREE.Group();
    this.group.name = 'remote-players';
    this.scene.add(this.group);
    this._v = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this.lodTimer = 0;
  }

  get(id) { return this.byId.get(id); }

  add(info) {
    if (info.id === this.game.myId) return null;
    let r = this.byId.get(info.id);
    if (!r) {
      r = new RemotePlayer(info);
      this.byId.set(r.id, r);
      this.list.push(r);
      this._ensureModel(r);
    } else {
      r.name = info.name;
      r.team = info.team;
      if (info.loadout) r.loadout = info.loadout;
    }
    return r;
  }

  remove(id) {
    const r = this.byId.get(id);
    if (!r) return;
    this.byId.delete(id);
    this.list.splice(this.list.indexOf(r), 1);
    if (r.model) { this.group.remove(r.model.root); r.model.dispose?.(); }
  }

  clear() {
    for (const r of [...this.list]) this.remove(r.id);
  }

  setTeam(id, team) {
    const r = this.byId.get(id);
    if (!r || r.team === team) return;
    r.team = team;
    if (r.model) { this.group.remove(r.model.root); r.model.dispose?.(); r.model = null; r.weaponId = null; }
    this._ensureModel(r);
  }

  _ensureModel(r) {
    if (r.model) return;
    if (!SoldierModel) {
      soldierReady.then(() => { if (this.byId.get(r.id) === r) this._ensureModel(r); });
      return;
    }
    const team = this.game.session?.modeTeams ? r.team : -1;
    r.model = new SoldierModel({ team: team ?? -1, variant: r.variant, lod: 'high' });
    r.model.root.visible = r.alive;
    this.group.add(r.model.root);
    r.weaponId = null;
    this._ensureWeapon(r);
  }

  _ensureWeapon(r) {
    if (!r.model) return;
    const w = r.weaponIdx >= 0 ? weaponByIndex(r.weaponIdx) : (r.loadout ? WEAPONS[r.loadout.primary] : null);
    const id = w ? w.id : null;
    if (!id || id === r.weaponId) return;
    r.weaponId = id;
    let att = {};
    if (r.loadout) att = id === r.loadout.primary ? r.loadout.primaryAtt : id === r.loadout.secondary ? r.loadout.secondaryAtt : {};
    try {
      const wm = buildWeaponModel(id, att, { lod: 'tp' });
      wm.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      r.weaponModel = wm;
      r.model.attachWeapon(wm);
      r.suppressed = MUZZLES[att.muzzle]?.suppressed || false;
    } catch (e) {
      console.warn('weapon model failed', id, e);
    }
  }

  onSpawn(m) {
    const r = this.byId.get(m.id);
    if (!r) return;
    r.alive = true;
    r.dead = false;
    r.hp = 100;
    if (m.lo) r.loadout = m.lo;
    if (m.team !== undefined && m.team !== r.team) this.setTeam(r.id, m.team);
    r.buffer.length = 0;
    r.pos.set(m.x, m.y, m.z);
    r.lastPos.copy(r.pos);
    r.yaw = m.yaw;
    r.weaponIdx = -1;
    r.weaponId = null;
    if (r.model) {
      r.model.reset();
      r.model.root.visible = true;
      this._ensureWeapon(r);
    }
  }

  onDeath(id, fromPos) {
    const r = this.byId.get(id);
    if (!r) return;
    r.alive = false;
    r.dead = true;
    if (r.model) {
      const dir = fromPos ? this._dir.set(r.pos.x - fromPos.x, 0, r.pos.z - fromPos.z).normalize() : this._dir.set(0, 0, 1);
      r.model.playDeath(dir.clone());
    }
  }

  /** Snapshot from the server: msg.p = [[id, x,y,z, yaw,pitch, stance, flags, w, lean, vx, vz], ...] */
  onSnapshot(msg, serverTime) {
    const seen = new Set();
    for (const s of msg.p) {
      const id = s[0];
      if (id === this.game.myId) continue;
      const r = this.byId.get(id);
      if (!r) continue;
      seen.add(id);
      if (!r.alive && !r.dead) {
        r.alive = true;
        if (r.model) { r.model.reset(); r.model.root.visible = true; }
      }
      r.buffer.push({ t: serverTime, x: s[1], y: s[2], z: s[3], yaw: s[4], pitch: s[5], stance: s[6], flags: s[7], w: s[8], lean: s[9], vx: s[10], vz: s[11] });
      if (r.buffer.length > 30) r.buffer.shift();
    }
  }

  /** Remote gunfire (relayed by the server). */
  onFire(m) {
    const r = this.byId.get(m.id);
    const w = weaponByIndex(m.w);
    if (!w) return;
    const g = this.game;
    const o = m.o;
    // Visual origin: the soldier's muzzle when we have a model.
    let vis = { x: o[0], y: o[1] - 0.15, z: o[2] };
    if (r && r.weaponModel?.anchors.muzzle && r.model?.root.visible) {
      r.weaponModel.anchors.muzzle.getWorldPosition(this._v);
      vis = { x: this._v.x, y: this._v.y, z: this._v.z };
    }
    const dirs = m.d || [];
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      g.projectiles.fire({
        ox: o[0], oy: o[1], oz: o[2], dx: d[0], dy: d[1], dz: d[2], speed: w.velocity, local: false, shooterId: m.id,
        weaponId: w.id, visual: vis, maxDist: 900, pen: w.penetration, tracer: w.pellets > 1 ? i < 2 : true,
      });
    }
    if (dirs[0]) {
      this._dir.set(dirs[0][0], dirs[0][1], dirs[0][2]);
      g.effects.muzzleFlash(vis, this._dir, w.category === 'PISTOL' ? 0.7 : 1, !!m.s);
    }
    g.audio?.playGunshot(w.sound, { position: { x: o[0], y: o[1], z: o[2] }, suppressed: !!m.s });
    if (r) r.firingT = 0.12;
  }

  update(dt, serverNow, camera) {
    const renderT = serverNow - INTERP_DELAY;
    const g = this.game;
    const world = g.world;
    this.lodTimer -= dt;
    const doLod = this.lodTimer <= 0;
    if (doLod) this.lodTimer = 0.5;
    for (const r of this.list) {
      // Interpolate.
      const buf = r.buffer;
      if (r.alive && buf.length) {
        let i = buf.length - 1;
        while (i > 0 && buf[i].t > renderT) i--;
        const a = buf[i];
        const b = buf[Math.min(i + 1, buf.length - 1)];
        let t = 0;
        if (a === b) {
          // Past the newest state: extrapolate briefly with the last velocity.
          const ex = Math.max(0, Math.min(0.2, renderT - a.t));
          r.pos.set(a.x + a.vx * ex, a.y, a.z + a.vz * ex);
        } else {
          t = Math.min(1, Math.max(0, (renderT - a.t) / (b.t - a.t)));
          r.pos.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
        }
        r.yaw = angLerp(a.yaw, b.yaw, t);
        r.pitch = a.pitch + (b.pitch - a.pitch) * t;
        r.lean = a.lean + (b.lean - a.lean) * t;
        const cur = t < 0.5 ? a : b;
        r.stance = cur.stance;
        r.flags = cur.flags;
        if (cur.w !== r.weaponIdx) { r.weaponIdx = cur.w; this._ensureWeapon(r); }
        r.vel.set(b.vx, 0, b.vz);
        // Trim old states.
        while (buf.length > 2 && buf[1].t < renderT - 0.5) buf.shift();
      }
      updateHitboxes(r.hitboxes, r.pos.x, r.pos.y, r.pos.z, r.yaw, r.stance, r.lean);
      // Footsteps.
      if (r.alive && (r.flags & FLAG_GROUND)) {
        const moved = Math.hypot(r.pos.x - r.lastPos.x, r.pos.z - r.lastPos.z);
        if (moved < 3) {
          const stride = r.stance === STANCE.PRONE ? 0.9 : r.stance === STANCE.CROUCH ? 1.15 : (r.flags & FLAG_SPRINT) ? 1.9 : 1.45;
          const prev = r.stepPhase;
          r.stepPhase += moved / stride;
          if (Math.floor(prev) !== Math.floor(r.stepPhase) && g.audio) {
            const d2 = r.pos.distanceToSquared(camera.position);
            if (d2 < 60 * 60) {
              const ground = world.terrain.heightAt(r.pos.x, r.pos.z);
              const surface = r.pos.y - ground > 0.3 ? 'wood' : world.surfaceAt(r.pos.x, r.pos.z);
              g.audio.playFootstep(surface, { position: { x: r.pos.x, y: r.pos.y, z: r.pos.z }, sprinting: !!(r.flags & FLAG_SPRINT), crouched: r.stance !== 0 });
            }
          }
        }
      }
      r.lastPos.copy(r.pos);
      r.firingT = Math.max(0, r.firingT - dt);
      // Model.
      if (!r.model) continue;
      const m = r.model;
      m.root.position.copy(r.pos);
      m.root.rotation.y = r.yaw;
      if (doLod) {
        const d = r.pos.distanceTo(camera.position);
        m.setLod?.(d > 45 ? 'low' : 'high');
      }
      m.update(dt, {
        velocity: r.vel, yaw: r.yaw, pitch: r.pitch, stance: r.stance,
        sprinting: !!(r.flags & FLAG_SPRINT), ads: !!(r.flags & FLAG_ADS), grounded: !!(r.flags & FLAG_GROUND),
        lean: r.lean, reloading: !!(r.flags & FLAG_RELOAD), firing: r.firingT > 0.1 || !!(r.flags & FLAG_FIRING) && r.firingT > 0, alive: r.alive || !r.dead,
      });
      if (!r.alive && !r.dead) m.root.visible = false;
    }
  }

  /** Screen-space nameplates for the HUD. */
  nameplates(camera, width, height, myTeam, teams, aimRay) {
    const out = [];
    for (const r of this.list) {
      if (!r.alive || !r.model) continue;
      const friendly = teams && r.team === myTeam;
      const head = this._v.set(r.pos.x, r.pos.y + eyeHeight(r.stance) + 0.45, r.pos.z);
      const dist = head.distanceTo(camera.position);
      if (dist > (friendly ? 220 : 70)) continue;
      if (!friendly) {
        // Enemies only when aimed at.
        if (!aimRay) continue;
        const to = this._dir.copy(head).sub(camera.position).normalize();
        if (to.dot(aimRay) < 0.9975) continue;
        if (this.game.world.collision.segmentBlocked(camera.position.x, camera.position.y, camera.position.z, head.x, head.y - 0.3, head.z)) continue;
      }
      head.project(camera);
      if (head.z > 1 || head.z < -1) continue;
      out.push({ id: r.id, screenX: (head.x * 0.5 + 0.5) * width, screenY: (-head.y * 0.5 + 0.5) * height, name: r.name, team: r.team, friendly, distance: Math.round(dist), health: r.hp });
    }
    return out;
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
  }
}
