// Bot brain: perception, decision making, aiming, shooting and navigation.
// Runs inside the GameRoom (server for multiplayer, browser for solo).
import { STANCE, PLAYER } from './constants.js';
import { WEAPONS, fireInterval } from './weapons.js';
import { eyeHeight } from './physics.js';

export const BOT_SKILL = {
  easy: { reaction: 0.75, aimError: 1.5, settle: 1.6, turnRate: 3.2, detect: 120, headshot: 0.04, burstMul: 0.7, semiDelay: 0.42, strafe: 0.4, crouch: 0.15, spread: 1.0 },
  normal: { reaction: 0.42, aimError: 1.0, settle: 1.0, turnRate: 5.2, detect: 175, headshot: 0.12, burstMul: 1.0, semiDelay: 0.3, strafe: 0.7, crouch: 0.3, spread: 0.85 },
  hard: { reaction: 0.24, aimError: 0.7, settle: 0.6, turnRate: 8.5, detect: 250, headshot: 0.26, burstMul: 1.2, semiDelay: 0.2, strafe: 0.9, crouch: 0.45, spread: 0.7 },
};

const PREFERRED_RANGE = { SHOTGUN: 9, SMG: 18, PISTOL: 14, AR: 34, LMG: 42, DMR: 70, SNIPER: 110 };
const BURST = { SHOTGUN: [1, 1], SMG: [5, 10], PISTOL: [1, 3], AR: [3, 7], LMG: [6, 14], DMR: [1, 1], SNIPER: [1, 1] };
const DEG = Math.PI / 180;

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class BotBrain {
  constructor(room, player, difficulty = 'normal') {
    this.room = room;
    this.p = player;
    this.skill = BOT_SKILL[difficulty] || BOT_SKILL.normal;
    this.rng = room.rng.fork('bot' + player.id);
    this.reset();
  }

  reset() {
    this.state = 'roam';
    this.target = null;
    this.targetVisible = false;
    this.lastSeen = { x: 0, y: 0, z: 0 };
    this.lastSeenTime = -100;
    this.acquiredAt = 0;
    this.reactionUntil = 0;
    this.alert = null;
    this.alertTime = -100;
    this.nextPerceive = 0;
    this.path = null;
    this.pathIdx = 0;
    this.goal = null;
    this.nextRepath = 0;
    this.nextShot = 0;
    this.burstLeft = 0;
    this.errYaw = 0; this.errPitch = 0;
    this.errYawT = 0; this.errPitchT = 0;
    this.nextErr = 0;
    this.recoil = 0;
    this.strafeDir = 1;
    this.nextStrafe = 0;
    this.crouchUntil = 0;
    this.stuckCheckPos = { x: this.p.body.x, z: this.p.body.z };
    this.stuckCheckTime = this.room.now;
    this.stuckCount = 0;
    this.jumpReq = false;
    this.aimHead = false;
    this.nadeTried = false;
    this.lookYaw = this.p.yaw;
    this.scanTime = 0;
    this.retreatUntil = 0;
  }

  get weapon() {
    return WEAPONS[this.p.weapon];
  }

  /** Called by the room when this bot takes damage. */
  onDamaged(attacker) {
    if (!attacker || attacker === this.p) return;
    this.alert = { x: attacker.body.x, y: attacker.body.y, z: attacker.body.z };
    this.alertTime = this.room.now;
    // Getting shot ruins aim a little.
    this.errYawT += (this.rng.next() - 0.5) * 6 * DEG;
    this.errPitchT += (this.rng.next() - 0.5) * 3 * DEG;
    if (this.p.hp < 40 && this.rng.chance(0.5)) this.retreatUntil = this.room.now + 2.5 + this.rng.next() * 2;
  }

  /** Hear gunfire. */
  onShotHeard(shooter, x, z, suppressed) {
    if (!this.room.isEnemy(this.p, shooter)) return;
    const dx = x - this.p.body.x, dz = z - this.p.body.z;
    const d2 = dx * dx + dz * dz;
    const range = suppressed ? 28 : 140;
    if (d2 > range * range) return;
    if (this.targetVisible) return;
    const err = Math.sqrt(d2) * 0.12;
    this.alert = { x: x + (this.rng.next() - 0.5) * err, y: shooter.body.y, z: z + (this.rng.next() - 0.5) * err };
    this.alertTime = this.room.now;
  }

  // ------------------------------------------------------------------------------ perception
  perceive() {
    const room = this.room;
    const p = this.p;
    const b = p.body;
    const ex = b.x, ey = b.y + eyeHeight(b.stance), ez = b.z;
    const w = this.weapon;
    const range = this.skill.detect * (w && (w.category === 'SNIPER' || w.category === 'DMR') ? 1.6 : 1);
    let best = null;
    let bestScore = Infinity;
    const fwdYaw = p.yaw;
    for (const q of room.players.values()) {
      if (q === p || !q.alive || !room.isEnemy(p, q)) continue;
      const qb = q.body;
      const dx = qb.x - ex, dz = qb.z - ez;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > range) continue;
      const isCur = q === this.target;
      const ang = Math.abs(angDiff(Math.atan2(-dx, -dz), fwdYaw));
      const inFov = ang < 70 * DEG || dist < 10 || (isCur && this.room.now - this.lastSeenTime < 1.5);
      if (!inFov) continue;
      // Concealment: prone/crouched targets far away are hard to notice.
      if (!isCur) {
        if (qb.stance === STANCE.PRONE && dist > 45 && this.rng.chance(0.65)) continue;
        if (qb.stance === STANCE.CROUCH && dist > 110 && this.rng.chance(0.4)) continue;
        if (q.spawnProtected && dist > 30 && this.rng.chance(0.5)) continue;
      }
      const qh = eyeHeight(qb.stance);
      const visHead = room.lineOfSight(ex, ey, ez, qb.x, qb.y + qh, qb.z);
      const visBody = visHead || room.lineOfSight(ex, ey, ez, qb.x, qb.y + qh * 0.6, qb.z);
      if (!visBody) continue;
      const score = dist * (isCur ? 0.6 : 1) * (ang < 30 * DEG ? 0.8 : 1);
      if (score < bestScore) { bestScore = score; best = q; }
    }
    if (best) {
      if (best !== this.target || !this.targetVisible) {
        if (best !== this.target || room.now - this.lastSeenTime > 2) {
          const d = Math.hypot(best.body.x - ex, best.body.z - ez);
          this.reactionUntil = room.now + this.skill.reaction * (0.7 + this.rng.next() * 0.6) + d * 0.0015;
          this.acquiredAt = room.now;
          this.aimHead = this.rng.chance(this.skill.headshot);
        }
        this.target = best;
      }
      this.targetVisible = true;
      this.lastSeen.x = best.body.x; this.lastSeen.y = best.body.y; this.lastSeen.z = best.body.z;
      this.lastSeenTime = room.now;
      this.nadeTried = this.nadeTried && room.now - this.lastSeenTime < 20;
    } else {
      this.targetVisible = false;
      if (this.target && !this.target.alive) this.target = null;
    }
  }

  // ------------------------------------------------------------------------------ main update
  /** Fill p.input for this tick and fire if appropriate. */
  update(dt) {
    const room = this.room;
    const p = this.p;
    const b = p.body;
    const now = room.now;
    const input = p.input;
    input.fwd = 0; input.right = 0; input.jump = false; input.sprint = false; input.ads = false;
    if (!p.alive) return;
    if (now >= this.nextPerceive) {
      this.perceive();
      this.nextPerceive = now + 0.1 + this.rng.next() * 0.1;
    }
    const w = this.weapon;
    const cat = w ? w.category : 'AR';

    // ---- decide state
    let state = 'roam';
    if (this.targetVisible && this.target && this.target.alive) state = 'engage';
    else if (this.target && this.target.alive && now - this.lastSeenTime < 9) state = 'hunt';
    else if (this.alert && now - this.alertTime < 10) state = 'investigate';
    if (now < this.retreatUntil && state !== 'engage') state = 'retreat';
    if (state !== this.state) {
      this.state = state;
      this.path = null;
      this.nextRepath = 0;
    }

    // ---- aiming target
    let aimX = null, aimY = 0, aimZ = 0;
    const eyeY = b.y + eyeHeight(b.stance);
    if (state === 'engage') {
      const t = this.target.body;
      const th = eyeHeight(t.stance);
      const yOff = this.aimHead ? th + 0.02 : th * (t.stance === STANCE.PRONE ? 0.7 : 0.72);
      const dist = Math.hypot(t.x - b.x, t.z - b.z);
      const tof = dist / ((w && w.velocity) || 800);
      aimX = t.x + t.vx * tof; aimY = t.y + yOff; aimZ = t.z + t.vz * tof;
    } else if (state === 'hunt') {
      aimX = this.lastSeen.x; aimY = this.lastSeen.y + 1.3; aimZ = this.lastSeen.z;
    } else if (state === 'investigate' && this.alert) {
      aimX = this.alert.x; aimY = this.alert.y + 1.3; aimZ = this.alert.z;
    }

    // ---- aim error model (smooth wandering offset that settles over time)
    if (now >= this.nextErr) {
      // Error is modelled in meters at the target, so it shrinks angularly with distance,
      // then grows a little again at long range.
      const settle = state === 'engage' ? Math.max(0.1, 1 - (now - this.acquiredAt) / this.skill.settle) : 1;
      const dist = Math.max(3, aimX !== null ? Math.hypot(aimX - b.x, aimZ - b.z) : 50);
      const moving = b.moveSpeed > 1 ? 1.4 : 1;
      const tmov = this.target && this.target.body.moveSpeed > 4 ? 1.3 : 1;
      const meters = this.skill.aimError * settle * moving * tmov * (1 + dist / 160);
      const mag = Math.atan2(meters, dist);
      this.errYawT = (this.rng.next() - 0.5) * 2 * mag;
      this.errPitchT = (this.rng.next() - 0.5) * 1.4 * mag;
      this.nextErr = now + 0.25 + this.rng.next() * 0.25;
    }
    const ek = Math.min(1, dt * 4);
    this.errYaw += (this.errYawT - this.errYaw) * ek;
    this.errPitch += (this.errPitchT - this.errPitch) * ek;
    this.recoil = Math.max(0, this.recoil - dt * (w ? w.recoil.recover * 0.9 : 6) * DEG * 10);

    // ---- desired view direction
    let wantYaw = p.yaw, wantPitch = 0;
    if (aimX !== null) {
      const dx = aimX - b.x, dz = aimZ - b.z, dy = aimY - eyeY;
      wantYaw = Math.atan2(-dx, -dz);
      wantPitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
    } else if (this.path && this.pathIdx < this.path.length) {
      const wp = this.path[this.pathIdx];
      wantYaw = Math.atan2(-(wp.x - b.x), -(wp.z - b.z));
      // Occasionally glance around while roaming.
      if (now > this.scanTime) { this.lookYaw = (this.rng.next() - 0.5) * 1.6; this.scanTime = now + 1.5 + this.rng.next() * 2.5; }
      wantYaw += this.lookYaw * 0.5;
      wantPitch = 0;
    }
    if (state === 'engage') {
      wantYaw += this.errYaw;
      wantPitch += this.errPitch + this.recoil;
    }
    const maxTurn = this.skill.turnRate * dt;
    const dyaw = angDiff(wantYaw, p.yaw);
    p.yaw += Math.max(-maxTurn, Math.min(maxTurn, dyaw));
    p.pitch += Math.max(-maxTurn, Math.min(maxTurn, wantPitch - p.pitch));
    p.pitch = Math.max(-1.3, Math.min(1.3, p.pitch));
    input.yaw = p.yaw;

    // ---- weapon handling
    const reloading = now < p.reloadUntil;
    if (!reloading && w) {
      if (p.mag <= 0) this.startReload();
      else if (state === 'roam' && p.mag < w.mag * 0.5) this.startReload();
    }

    // ---- movement
    let moveX = 0, moveZ = 0, sprint = false;
    const tgt = this.target ? this.target.body : null;
    if (state === 'engage') {
      const dist = Math.hypot(tgt.x - b.x, tgt.z - b.z);
      const pref = PREFERRED_RANGE[cat] || 30;
      if (now > this.nextStrafe) {
        this.strafeDir = this.rng.chance(0.5) ? 1 : -1;
        if (this.rng.chance(1 - this.skill.strafe)) this.strafeDir = 0;
        this.nextStrafe = now + 0.5 + this.rng.next() * 1.2;
        if (dist > 25 && this.rng.chance(this.skill.crouch)) this.crouchUntil = now + 1.5 + this.rng.next() * 2;
      }
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      let f = 0;
      if (dist > pref * 1.7) f = 1;
      else if (dist < pref * 0.5 && cat !== 'SHOTGUN') f = -0.7;
      moveX = fx * f + rx * this.strafeDir * 0.8;
      moveZ = fz * f + rz * this.strafeDir * 0.8;
      if (dist > pref * 1.7) {
        // Advance along a path so we don't run into walls.
        this.followPath(tgt.x, tgt.z, now);
        const d = this.pathDir();
        if (d) { moveX = d.x + rx * this.strafeDir * 0.4; moveZ = d.z + rz * this.strafeDir * 0.4; }
      }
      if ((cat === 'SNIPER' || cat === 'DMR') && dist > 40) { moveX *= 0.25; moveZ *= 0.25; }
      input.ads = dist > 14 && cat !== 'SHOTGUN';
    } else if (state === 'hunt' || state === 'investigate') {
      const gx = state === 'hunt' ? this.lastSeen.x : this.alert.x;
      const gz = state === 'hunt' ? this.lastSeen.z : this.alert.z;
      this.followPath(gx, gz, now);
      const d = this.pathDir();
      if (d) { moveX = d.x; moveZ = d.z; }
      const dist = Math.hypot(gx - b.x, gz - b.z);
      sprint = dist > 35;
      if (dist < 3) { if (state === 'hunt') this.target = null; else this.alert = null; }
      // Throw a grenade at the last known position.
      if (state === 'hunt' && !this.nadeTried && p.frags > 0 && dist > 12 && dist < 36 && now - this.lastSeenTime > 1.2) {
        this.nadeTried = true;
        if (this.rng.chance(0.35)) this.throwGrenade(gx, this.lastSeen.y, gz);
      }
    } else if (state === 'retreat') {
      const from = this.alert || this.lastSeen;
      const ax = b.x - from.x, az = b.z - from.z;
      const l = Math.hypot(ax, az) || 1;
      this.followPath(b.x + (ax / l) * 25, b.z + (az / l) * 25, now);
      const d = this.pathDir();
      if (d) { moveX = d.x; moveZ = d.z; sprint = true; }
    } else {
      // Roam: head to a goal; refresh it when reached or stale.
      if (!this.goal || now > this.goal.until || Math.hypot(this.goal.x - b.x, this.goal.z - b.z) < 4) this.pickGoal();
      if (this.goal) {
        this.followPath(this.goal.x, this.goal.z, now);
        const d = this.pathDir();
        if (d) { moveX = d.x; moveZ = d.z; }
        sprint = Math.hypot(this.goal.x - b.x, this.goal.z - b.z) > 25 && this.rng.next() < 0.995;
      }
    }

    // Convert world move direction to local input relative to yaw.
    const ml = Math.hypot(moveX, moveZ);
    if (ml > 0.01) {
      moveX /= Math.max(1, ml); moveZ /= Math.max(1, ml);
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      input.fwd = moveX * fx + moveZ * fz;
      input.right = moveX * rx + moveZ * rz;
    }
    input.sprint = sprint && input.fwd > 0.5 && !reloading;
    input.stance = now < this.crouchUntil && state === 'engage' ? STANCE.CROUCH : STANCE.STAND;
    if ((cat === 'SNIPER') && state === 'engage' && tgt && Math.hypot(tgt.x - b.x, tgt.z - b.z) > 90 && this.rng.chance(0.002)) this.crouchUntil = now + 6;

    // Stuck detection.
    if (now - this.stuckCheckTime > 1.4) {
      const moved = Math.hypot(b.x - this.stuckCheckPos.x, b.z - this.stuckCheckPos.z);
      const wanted = ml > 0.3 && state !== 'engage';
      if (wanted && moved < 0.8) {
        this.stuckCount++;
        this.jumpReq = true;
        this.path = null;
        if (this.stuckCount > 2) { this.goal = null; this.stuckCount = 0; }
      } else this.stuckCount = 0;
      this.stuckCheckPos.x = b.x; this.stuckCheckPos.z = b.z;
      this.stuckCheckTime = now;
    }
    if (this.jumpReq) { input.jump = true; this.jumpReq = false; }

    // ---- fire
    if (state === 'engage' && !reloading && now >= this.reactionUntil && w && p.mag > 0 && now >= this.nextShot) {
      const dist = Math.hypot(tgt.x - b.x, tgt.z - b.z);
      const maxRange = cat === 'SHOTGUN' ? 38 : cat === 'SMG' || cat === 'PISTOL' ? 90 : 450;
      // Only shoot when roughly on target.
      const t = tgt;
      const dx = t.x - b.x, dz = t.z - b.z;
      const trueYaw = Math.atan2(-dx, -dz);
      const yawErr = Math.abs(angDiff(trueYaw, p.yaw));
      const tol = Math.atan2(1.2, dist) * 2 + 1 * DEG + Math.max(0, now - this.acquiredAt - 1.5) * 2 * DEG;
      if (dist < maxRange && yawErr < tol) {
        this.fire(w, dist, cat);
      }
    }
  }

  fire(w, dist, cat) {
    const room = this.room;
    const now = room.now;
    const p = this.p;
    room.botFire(p, this.skill.spread);
    p.mag--;
    this.recoil += w.recoil.v * DEG * (0.5 + this.rng.next() * 0.4) * (cat === 'SNIPER' || cat === 'DMR' ? 0.3 : 1);
    const interval = fireInterval(w);
    const auto = w.fireModes.includes('auto');
    if (auto) {
      if (this.burstLeft <= 0) {
        const [a, bb] = BURST[cat] || [3, 6];
        const shorten = dist > 60 ? 0.5 : 1;
        this.burstLeft = Math.max(1, Math.round((a + this.rng.next() * (bb - a)) * this.skill.burstMul * shorten));
      }
      this.burstLeft--;
      this.nextShot = now + interval * (1 + this.rng.next() * 0.1);
      if (this.burstLeft <= 0) this.nextShot += 0.18 + this.rng.next() * 0.35 + Math.min(0.6, dist / 200);
    } else {
      this.nextShot = now + Math.max(interval, this.skill.semiDelay * (0.7 + this.rng.next() * 0.8) + (cat === 'SNIPER' ? 0.4 : 0));
    }
    if (p.mag <= 0) this.startReload();
  }

  startReload() {
    const p = this.p;
    const w = this.weapon;
    if (!w || this.room.now < p.reloadUntil) return;
    const t = w.reloadType === 'shell' ? Math.min(4, w.reload * (w.mag - p.mag)) + 0.4 : p.mag <= 0 ? w.reloadEmpty : w.reload;
    p.reloadUntil = this.room.now + t;
    p.reloadEndMag = w.mag;
  }

  throwGrenade(x, y, z) {
    const b = this.p.body;
    const dx = x - b.x, dz = z - b.z;
    const dist = Math.hypot(dx, dz);
    // 45-degree-ish lob: v^2 = g*d / sin(2a)
    const ang = 0.6;
    const v = Math.min(19, Math.sqrt((PLAYER.gravity * dist) / Math.sin(2 * ang)) * 1.02);
    const h = Math.cos(ang) * v;
    this.room.botThrow(this.p, 'frag', dx / dist * h, Math.sin(ang) * v, dz / dist * h);
  }

  pickGoal() {
    const room = this.room;
    const nav = room.nav;
    const b = this.p.body;
    // Mostly drift toward where enemies are, sometimes visit POIs.
    const enemies = [];
    for (const q of room.players.values()) if (q.alive && room.isEnemy(this.p, q)) enemies.push(q);
    let gx, gz;
    if (enemies.length && this.rng.chance(0.65)) {
      const e = enemies[Math.floor(this.rng.next() * enemies.length)].body;
      gx = e.x + (this.rng.next() - 0.5) * 60;
      gz = e.z + (this.rng.next() - 0.5) * 60;
    } else {
      const pois = room.world.pois;
      const poi = pois[Math.floor(this.rng.next() * pois.length)];
      gx = poi.x + (this.rng.next() - 0.5) * poi.r * 2;
      gz = poi.z + (this.rng.next() - 0.5) * poi.r * 2;
    }
    const free = nav ? nav.nearestFree(gx, gz, 10) : 0;
    if (nav && free < 0) { this.goal = null; return; }
    if (nav) { const c = nav.cellCenter(free, { x: 0, z: 0 }); gx = c.x; gz = c.z; }
    this.goal = { x: gx, z: gz, until: room.now + 25 + this.rng.next() * 20 };
    this.path = null;
    void b;
  }

  followPath(tx, tz, now) {
    const b = this.p.body;
    const nav = this.room.nav;
    const needNew = !this.path || now > this.nextRepath || (this.pathGoal && Math.hypot(this.pathGoal.x - tx, this.pathGoal.z - tz) > 8);
    if (needNew && nav && this.room.pathBudget > 0) {
      this.room.pathBudget--;
      this.path = nav.findPath(b.x, b.z, tx, tz, 12000) || [{ x: tx, z: tz }];
      this.pathIdx = 0;
      this.pathGoal = { x: tx, z: tz };
      this.nextRepath = now + 3 + this.rng.next() * 2;
    } else if (!this.path) {
      this.path = [{ x: tx, z: tz }];
      this.pathIdx = 0;
    }
    // Advance waypoints.
    while (this.path && this.pathIdx < this.path.length - 1) {
      const wp = this.path[this.pathIdx];
      if (Math.hypot(wp.x - b.x, wp.z - b.z) < 1.6) this.pathIdx++;
      else break;
    }
  }

  pathDir() {
    if (!this.path || this.pathIdx >= this.path.length) return null;
    const b = this.p.body;
    const wp = this.path[this.pathIdx];
    const dx = wp.x - b.x, dz = wp.z - b.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.5) return null;
    return { x: dx / l, z: dz / l };
  }
}
