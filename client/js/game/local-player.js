// Local player: fixed-step movement with the shared physics, mouse look, stances, leaning,
// head bob, camera effects and footstep events.
import * as THREE from 'three';
import { createBody, stepBody, eyeHeight, fallDamage, canStance } from '/shared/physics.js';
import { STANCE, PLAYER } from '/shared/constants.js';

const FIXED_DT = 1 / 60;
const TAU = Math.PI * 2;

export class LocalPlayer {
  constructor(world) {
    this.world = world;
    this.body = createBody();
    this.prev = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.lean = 0;
    this.leanTarget = 0;
    this.alive = false;
    this.stanceWanted = STANCE.STAND;
    this.eyeY = eyeHeight(STANCE.STAND);
    this.acc = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.landDip = 0;
    this.landVel = 0;
    this.shake = 0;
    this.shakeT = 0;
    this.recoilPitch = 0; // camera recoil offsets (radians), added by the weapon system
    this.recoilYaw = 0;
    this.speedMult = 1;
    this.ads = false;
    this.adsAmount = 0;
    this.sprinting = false;
    this.moving = false;
    this.events = [];
    this.headBob = true;
    this.fov = 80;
    this.zoom = 1;
    this.lastStepPhase = 0;
    this.input = { fwd: 0, right: 0, jump: false, sprint: false, stance: 0, yaw: 0, ads: false, speedMult: 1 };
    this._jumpQueued = false;
  }

  spawn(x, y, z, yaw) {
    const b = this.body;
    b.x = x; b.y = y; b.z = z;
    b.vx = b.vy = b.vz = 0;
    b.onGround = true;
    b.stance = STANCE.STAND;
    b.fallStartY = y;
    this.prev.set(x, y, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.lean = 0;
    this.leanTarget = 0;
    this.stanceWanted = STANCE.STAND;
    this.eyeY = eyeHeight(STANCE.STAND);
    this.alive = true;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
  }

  /** Apply mouse look (pixels) with sensitivity (deg per 100 px ~ 1.0 setting). */
  look(dx, dy, sens, invertY) {
    const k = 0.0022 * sens;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (invertY ? -1 : 1);
    const lim = Math.PI / 2 - 0.02;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
    if (this.yaw > Math.PI) this.yaw -= TAU;
    if (this.yaw < -Math.PI) this.yaw += TAU;
  }

  /** Read controls (called once per rendered frame). */
  readControls(input, settings, blockSprint) {
    const c = this.input;
    c.fwd = (input.down('forward') ? 1 : 0) - (input.down('back') ? 1 : 0);
    c.right = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
    c.sprint = input.down('sprint') && !blockSprint;
    if (input.hit('jump')) this._jumpQueued = true;
    const toggle = settings.controls.toggleCrouch;
    if (input.hit('crouch')) {
      if (toggle) this.stanceWanted = this.stanceWanted === STANCE.CROUCH ? STANCE.STAND : STANCE.CROUCH;
      else this.stanceWanted = STANCE.CROUCH;
    }
    if (!toggle && !input.down('crouch') && this.stanceWanted === STANCE.CROUCH) this.stanceWanted = STANCE.STAND;
    if (input.hit('prone')) this.stanceWanted = this.stanceWanted === STANCE.PRONE ? STANCE.STAND : STANCE.PRONE;
    if (c.sprint && c.fwd > 0 && this.stanceWanted !== STANCE.STAND) this.stanceWanted = STANCE.STAND;
    this.leanTarget = (input.down('leanRight') ? 1 : 0) - (input.down('leanLeft') ? 1 : 0);
    if (this.body.stance === STANCE.PRONE) this.leanTarget *= 0.4;
  }

  /** Advance physics with a fixed timestep. Returns accumulated events. */
  update(dt) {
    this.events.length = 0;
    if (!this.alive) return this.events;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= FIXED_DT) {
      this.acc -= FIXED_DT;
      this._fixed(FIXED_DT);
    }
    // Smooth eye height for stance changes.
    const target = eyeHeight(this.body.stance);
    this.eyeY += (target - this.eyeY) * Math.min(1, dt * 10);
    // Lean, blocked by walls.
    let lt = this.leanTarget;
    if (lt !== 0) {
      const b = this.body;
      const rx = Math.cos(this.yaw) * lt, rz = -Math.sin(this.yaw) * lt;
      const hit = this.world.collision.raycast(b.x, b.y + this.eyeY, b.z, rx, 0, rz, 0.65);
      if (hit) lt *= Math.max(0, (hit.t - 0.25) / 0.4);
    }
    this.lean += (lt - this.lean) * Math.min(1, dt * 8);
    // Landing dip spring.
    this.landVel += (-this.landDip * 120 - this.landVel * 16) * dt;
    this.landDip += this.landVel * dt;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.shakeT += dt;
    return this.events;
  }

  _fixed(dt) {
    const b = this.body;
    const c = this.input;
    this.prev.set(b.x, b.y, b.z);
    c.yaw = this.yaw;
    c.ads = this.ads;
    c.speedMult = this.speedMult;
    c.jump = this._jumpQueued;
    c.stance = this.stanceWanted;
    this._jumpQueued = false;
    const wasGround = b.onGround;
    const ev = stepBody(this.world, b, c, dt);
    if (this.stanceWanted !== b.stance && !canStance(this.world, b, this.stanceWanted)) {
      // Not enough headroom: keep the current stance as the wish so it doesn't pop later.
    }
    if (ev.jumped) this.events.push({ type: 'jump', surface: b.surface });
    if (ev.landed && !wasGround) {
      const impact = ev.impact;
      this.landVel -= Math.min(4, impact * 0.35);
      this.events.push({ type: 'land', impact: Math.min(1, impact / 8), surface: b.surface });
      const dmg = fallDamage(ev.fallDistance);
      if (dmg > 0) this.events.push({ type: 'fall', damage: dmg });
    }
    // Head bob + footsteps from distance travelled on the ground.
    const sp = b.moveSpeed;
    this.moving = sp > 0.5 && b.onGround;
    this.sprinting = b.sprinting && this.moving;
    if (b.onGround && sp > 0.3) {
      const stride = b.stance === STANCE.PRONE ? 0.9 : b.stance === STANCE.CROUCH ? 1.15 : this.sprinting ? 1.9 : 1.45;
      const prevPhase = this.bobPhase;
      this.bobPhase += (sp * dt / stride) * Math.PI;
      if (Math.floor(prevPhase / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) {
        this.events.push({ type: 'step', surface: b.surface, sprint: this.sprinting, crouch: b.stance !== STANCE.STAND, speed: sp });
      }
    }
    const targetBob = b.onGround ? Math.min(1, sp / PLAYER.speed.walk) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 8);
  }

  /** Interpolated feet position for rendering. */
  renderPos(out) {
    const a = this.acc / FIXED_DT;
    const b = this.body;
    return out.set(this.prev.x + (b.x - this.prev.x) * a, this.prev.y + (b.y - this.prev.y) * a, this.prev.z + (b.z - this.prev.z) * a);
  }

  /** Place the camera (head) for this frame. */
  applyCamera(camera, dt) {
    const p = this.renderPos(camera.position);
    const bobScale = this.headBob ? 1 : 0.25;
    const adsDamp = 1 - this.adsAmount * 0.85;
    const amp = this.bobAmount * bobScale * adsDamp * (this.sprinting ? 1.6 : 1);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.045 * amp - 0.02 * amp;
    const bobX = Math.cos(this.bobPhase) * 0.025 * amp;
    // Lean: shift the head sideways and roll.
    const leanShift = this.lean * 0.42;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    p.x += rx * (leanShift + bobX);
    p.z += rz * (leanShift + bobX);
    p.y += this.eyeY + bobY + this.landDip - Math.abs(this.lean) * 0.06;
    const shake = this.shake * this.shake;
    const sx = (Math.sin(this.shakeT * 47) + Math.sin(this.shakeT * 31)) * 0.012 * shake;
    const sy = (Math.sin(this.shakeT * 53) + Math.cos(this.shakeT * 29)) * 0.012 * shake;
    camera.rotation.set(this.pitch + this.recoilPitch + sy, this.yaw + this.recoilYaw + sx, -this.lean * 0.12 + Math.sin(this.bobPhase) * 0.004 * amp, 'YXZ');
    camera.updateMatrixWorld();
  }

  get eyePosition() {
    const b = this.body;
    return new THREE.Vector3(b.x + Math.cos(this.yaw) * this.lean * 0.42, b.y + this.eyeY, b.z - Math.sin(this.yaw) * this.lean * 0.42);
  }

  addShake(amount) {
    this.shake = Math.min(1.5, this.shake + amount);
  }
}
