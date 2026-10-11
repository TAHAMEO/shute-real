// Local weapon handling: fire modes, recoil, spread, ADS, reloads, bolt/pump cycling,
// weapon switching, grenades, melee and bullet zeroing.
import * as THREE from 'three';
import { WEAPONS, WEAPON_INDEX, weaponHandling, fireInterval, EQUIPMENT } from '/shared/weapons.js';
import { STANCE, PLAYER } from '/shared/constants.js';

const DEG = Math.PI / 180;
const MODE_NAMES = { auto: 'AUTO', semi: 'SEMI', burst: 'BURST', bolt: 'BOLT', pump: 'PUMP' };

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Random direction in a cone (half-angle ang) around f, using basis (r, u). */
function coneDir(f, r, u, ang, out) {
  const rad = Math.sqrt(Math.random()) * Math.tan(ang);
  const a = Math.random() * Math.PI * 2;
  out.copy(f).addScaledVector(r, Math.cos(a) * rad).addScaledVector(u, Math.sin(a) * rad).normalize();
  return out;
}

export class WeaponController {
  constructor(game) {
    this.game = game;
    this.slots = { primary: null, secondary: null };
    this.current = 'primary';
    this.state = 'idle';
    this.stateT = 0;
    this.stateDur = 0;
    this.pending = null;
    this.adsAmount = 0;
    this.adsToggled = false;
    this.nextFire = 0;
    this.burstLeft = 0;
    this.triggerReleased = true;
    this.dryClicked = false;
    this.bloom = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilTargetPitch = 0;
    this.recoilTargetYaw = 0;
    this.lastShot = -10;
    this.burstShots = 0;
    this.sprintBlock = 0;
    this.zeroing = 100;
    this.frags = 2;
    this.smokes = 1;
    this.time = 0;
    this.thrown = false;
    this.meleeDone = false;
    this.shellsThisReload = 0;
  }

  get slot() { return this.slots[this.current]; }
  get def() { return this.slot?.def; }
  get busy() { return this.state !== 'idle'; }

  _makeSlot(id, att) {
    const def = WEAPONS[id];
    return { id, def, att: { ...att }, h: weaponHandling(id, att), mag: def.mag, reserve: def.reserve, mode: 0, needsCycle: false };
  }

  setLoadout(lo) {
    this.slots.primary = this._makeSlot(lo.primary, lo.primaryAtt);
    this.slots.secondary = this._makeSlot(lo.secondary, lo.secondaryAtt);
    this.current = 'primary';
    this.frags = 2;
    this.smokes = 1;
    this.adsAmount = 0;
    this.bloom = 0;
    this.recoilPitch = this.recoilYaw = this.recoilTargetPitch = this.recoilTargetYaw = 0;
    this.zeroing = 100;
    this._setState('equip', this.def.equipTime);
    this.game.viewmodel?.setWeapon(this.slot, 'equip');
    this._hud();
  }

  _setState(s, dur = 0) {
    this.state = s;
    this.stateT = 0;
    this.stateDur = dur;
  }

  // ---------------------------------------------------------------------------- per frame
  update(dt, active) {
    const g = this.game;
    const p = g.player;
    const inp = g.input;
    const slot = this.slot;
    if (!slot) return;
    const def = slot.def;
    this.time += dt;

    // ---- timed states
    if (this.state !== 'idle') {
      this.stateT += dt;
      this._tickState(dt);
    }

    // ---- input
    let wantAds = false;
    let trigger = false;
    let pressed = false;
    if (active) {
      if (g.settings.controls.toggleAds) {
        if (inp.mouseHit(2)) this.adsToggled = !this.adsToggled;
        wantAds = this.adsToggled;
      } else wantAds = inp.mouseDown(2);
      trigger = inp.mouseDown(0);
      pressed = inp.mouseHit(0);
      if (inp.hit('reload')) this.reload();
      if (inp.hit('fireMode')) this.cycleFireMode();
      if (inp.hit('primary')) this.switchTo('primary');
      if (inp.hit('secondary')) this.switchTo('secondary');
      const wheel = inp.mouse.wheel;
      if (wheel !== 0 && !this._wheelUsed) {
        this.switchTo(this.current === 'primary' ? 'secondary' : 'primary');
        this._wheelUsed = true;
      }
      if (wheel === 0) this._wheelUsed = false;
      if (inp.hit('frag')) this.throwGrenade('frag');
      if (inp.hit('smoke')) this.throwGrenade('smoke');
      if (inp.hit('melee')) this.melee();
      if (inp.hit('inspect') && this.state === 'idle') g.viewmodel?.playInspect();
      if (slot.h.magnification > 1) {
        if (inp.hit('zeroUp')) { this.zeroing = Math.min(1000, this.zeroing + 100); this._zeroMsg(); }
        if (inp.hit('zeroDown')) { this.zeroing = Math.max(100, this.zeroing - 100); this._zeroMsg(); }
      }
    } else {
      this.adsToggled = false;
    }
    if (!trigger) { this.triggerReleased = true; this.dryClicked = false; }

    // ---- ADS
    const blockAds = this.state === 'reload' || this.state === 'switch' || this.state === 'equip' || this.state === 'throw' || this.state === 'melee'
      || (this.state === 'reloadShell' && def.reloadType === 'shell') || p.sprinting;
    const adsTarget = wantAds && !blockAds ? 1 : 0;
    const rate = 1 / Math.max(0.08, slot.h.adsTime);
    this.adsAmount += Math.sign(adsTarget - this.adsAmount) * Math.min(Math.abs(adsTarget - this.adsAmount), rate * dt);
    p.ads = this.adsAmount > 0.4;
    p.adsAmount = this.adsAmount;
    p.speedMult = def.moveSpeed;
    if (p.sprinting) this.sprintBlock = def.sprintToFire;
    else this.sprintBlock = Math.max(0, this.sprintBlock - dt);

    // ---- firing
    const mode = def.fireModes[slot.mode];
    const ready = (this.state === 'idle' || this.state === 'reloadShell') && !slot.needsCycle && this.sprintBlock <= 0 && !p.sprinting && this.time >= this.nextFire;
    let want = false;
    if (mode === 'auto') want = trigger;
    else if (mode === 'burst') {
      if (pressed && this.burstLeft <= 0 && this.triggerReleased) { this.burstLeft = def.burst; this.triggerReleased = false; }
      want = this.burstLeft > 0;
    } else {
      want = trigger && this.triggerReleased;
    }
    if (want && ready && active) {
      if (slot.mag <= 0) {
        if (!this.dryClicked) {
          g.audio?.playMechanical('dry_fire');
          this.dryClicked = true;
          this.triggerReleased = false;
          if (slot.reserve > 0) this.reload();
        }
        this.burstLeft = 0;
      } else {
        if (this.state === 'reloadShell') this._setState('idle');
        this._fire();
        if (mode !== 'auto') this.triggerReleased = false;
      }
    }

    // ---- recoil recovery and spread bloom decay
    const sinceShot = this.time - this.lastShot;
    if (sinceShot > 0.09) {
      const rec = def.recoil.recover * DEG;
      this.recoilTargetPitch -= Math.sign(this.recoilTargetPitch) * Math.min(Math.abs(this.recoilTargetPitch), rec * dt * 1.4);
      this.recoilTargetYaw -= Math.sign(this.recoilTargetYaw) * Math.min(Math.abs(this.recoilTargetYaw), rec * dt * 1.4);
    }
    if (sinceShot > 0.3) this.burstShots = 0;
    const k = Math.min(1, dt * 22);
    this.recoilPitch += (this.recoilTargetPitch - this.recoilPitch) * k;
    this.recoilYaw += (this.recoilTargetYaw - this.recoilYaw) * k;
    p.recoilPitch = this.recoilPitch;
    p.recoilYaw = this.recoilYaw;
    this.bloom = Math.max(0, this.bloom - dt * def.spread.max * 1.6);
  }

  _tickState() {
    const g = this.game;
    const slot = this.slot;
    const def = slot.def;
    const t = this.stateT;
    switch (this.state) {
      case 'equip':
      case 'cycle':
        if (t >= this.stateDur) {
          if (this.state === 'cycle') slot.needsCycle = false;
          this._setState('idle');
        }
        break;
      case 'switch':
        if (t >= this.stateDur) {
          this.current = this.pending;
          this.pending = null;
          this.adsAmount = 0;
          this._setState('equip', this.def.equipTime * 0.8);
          g.viewmodel?.setWeapon(this.slot, 'equip');
          g.audio?.playMechanical('equip');
          this._hud();
        }
        break;
      case 'reload':
        if (t >= this.stateDur) {
          const need = def.mag - slot.mag;
          const take = def.reloadType === 'speedloader' ? Math.min(need, slot.reserve) : Math.min(need, slot.reserve);
          slot.mag += take;
          slot.reserve -= take;
          if (def.fireModes.includes('bolt') || def.fireModes.includes('pump')) slot.needsCycle = false;
          this._setState('idle');
          this._hud();
        }
        break;
      case 'reloadShell':
        if (t >= this.stateDur) {
          if (slot.mag < def.mag && slot.reserve > 0) {
            slot.mag++;
            slot.reserve--;
            this.shellsThisReload++;
            g.audio?.playMechanical('shell_insert');
            g.viewmodel?.onShellInsert();
            this._hud();
          }
          if (slot.mag < def.mag && slot.reserve > 0) {
            this._setState('reloadShell', def.reload);
          } else {
            g.viewmodel?.endShellReload();
            if (def.fireModes.includes('pump') || def.fireModes.includes('bolt')) {
              if (slot.needsCycle || this.shellsThisReload > 0) {
                this._setState('cycle', 0.55);
                slot.needsCycle = true;
                g.viewmodel?.playCycle(0.55);
                g.audio?.playMechanical(def.fireModes.includes('pump') ? 'pump_back' : 'bolt_back');
                break;
              }
            }
            this._setState('idle');
          }
        }
        break;
      case 'throw':
        if (!this.thrown && t >= 0.42) {
          this.thrown = true;
          this._releaseGrenade();
        }
        if (t >= this.stateDur) {
          this._setState('idle');
          g.viewmodel?.setWeapon(this.slot, 'equip');
        }
        break;
      case 'melee':
        if (!this.meleeDone && t >= 0.16) {
          this.meleeDone = true;
          this._meleeHit();
        }
        if (t >= this.stateDur) {
          this._setState('idle');
          g.viewmodel?.setWeapon(this.slot, 'raise');
        }
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------- actions
  _fire() {
    const g = this.game;
    const p = g.player;
    const slot = this.slot;
    const def = slot.def;
    const h = slot.h;
    const mode = def.fireModes[slot.mode];
    slot.mag--;
    this.nextFire = this.time + fireInterval(def);
    if (mode === 'burst') this.burstLeft--;
    this.lastShot = this.time;

    // Aim basis from the camera (includes recoil, sway and lean).
    const cam = g.rs.camera;
    cam.updateMatrixWorld();
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    // Zeroing: tilt up so the bullet crosses the line of sight at the zero distance.
    const tZero = this.zeroing / def.velocity;
    const zeroAng = Math.atan2(0.5 * PLAYER.gravity * tZero * tZero, this.zeroing);
    _q.setFromAxisAngle(_right, zeroAng);
    _fwd.applyQuaternion(_q);
    _up.applyQuaternion(_q);

    const spread = this.currentSpread();
    const origin = cam.position;
    const muzzle = g.viewmodel?.muzzleWorld(new THREE.Vector3()) || origin.clone();
    const dirs = [];
    const tracerEvery = def.category === 'LMG' ? 3 : 1;
    for (let i = 0; i < def.pellets; i++) {
      coneDir(_fwd, _right, _up, spread, _dir);
      dirs.push([+_dir.x.toFixed(4), +_dir.y.toFixed(4), +_dir.z.toFixed(4)]);
      g.projectiles.fire({
        ox: origin.x, oy: origin.y, oz: origin.z, dx: _dir.x, dy: _dir.y, dz: _dir.z,
        speed: def.velocity, local: true, shooterId: g.myId, weaponId: def.id,
        visual: muzzle, maxDist: Math.min(1500, def.range[1] * 5 + 300), pen: def.penetration,
        tracer: def.pellets > 1 ? i < 3 : true, tracerBright: def.category === 'LMG' && (slot.mag % tracerEvery === 0),
        weaponIndex: WEAPON_INDEX[def.id],
      });
    }
    g.session?.sendFire(WEAPON_INDEX[def.id], [origin.x, origin.y, origin.z], dirs);
    g.audio?.playGunshot(def.sound, { isLocal: true, suppressed: h.suppressed });

    // Recoil.
    const stance = p.body.stance;
    let mult = stance === STANCE.PRONE ? 0.6 : stance === STANCE.CROUCH ? 0.85 : 1;
    if (def.bipod && stance === STANCE.PRONE) mult *= 0.6;
    mult *= 1 - this.adsAmount * 0.18;
    const first = this.burstShots === 0 ? 1.3 : 1;
    const kickV = h.recoilV * first * mult * DEG;
    const kickH = (Math.random() * 2 - 1 + 0.25) * h.recoilH * mult * DEG;
    // Part of the kick permanently moves the aim (player must pull down), the rest recovers.
    p.pitch += kickV * 0.4;
    p.yaw -= kickH * 0.4;
    this.recoilTargetPitch += kickV * 0.6;
    this.recoilTargetYaw -= kickH * 0.6;
    this.burstShots++;
    this.bloom = Math.min(def.spread.max, this.bloom + def.spread.bloom);
    g.viewmodel?.onFire(h.suppressed);
    if (mode === 'bolt' || mode === 'pump') {
      slot.needsCycle = true;
      const dur = Math.max(0.45, fireInterval(def) - 0.1);
      this._setState('cycle', dur);
      g.viewmodel?.playCycle(dur, 0.12);
      setTimeout(() => g.audio?.playMechanical(mode === 'pump' ? 'pump_back' : 'bolt_up'), 160);
      setTimeout(() => g.audio?.playMechanical(mode === 'pump' ? 'pump_forward' : 'bolt_forward'), 160 + dur * 450);
    }
    this._hud();
    if (slot.mag === 0 && slot.reserve > 0 && mode !== 'auto') {
      // Auto reload empty semi/bolt weapons after a short beat.
      this._autoReloadAt = this.time + 0.35;
    }
  }

  /** Current spread half-angle in radians. */
  currentSpread() {
    const p = this.game.player;
    const def = this.def;
    const s = def.spread;
    const a = this.adsAmount;
    let deg = s.hip + (s.ads - s.hip) * a;
    if (def.category !== 'SHOTGUN') {
      const mv = Math.min(1.5, p.body.moveSpeed / PLAYER.speed.walk);
      deg += mv * s.move * (1 - a * 0.65);
      if (!p.body.onGround) deg += s.hip * 1.2;
      deg += this.bloom * (1 - a * 0.5);
      const st = p.body.stance;
      deg *= st === STANCE.PRONE ? 0.6 : st === STANCE.CROUCH ? 0.8 : 1;
    }
    return Math.min(deg, 12) * DEG;
  }

  reload() {
    const slot = this.slot;
    const def = slot.def;
    if (this.state !== 'idle' && this.state !== 'cycle') return;
    if (slot.mag >= def.mag || slot.reserve <= 0) return;
    const g = this.game;
    this.adsAmount = Math.min(this.adsAmount, 0.3);
    this.burstLeft = 0;
    if (def.reloadType === 'shell') {
      this.shellsThisReload = 0;
      this._setState('reloadShell', 0.45 + def.reload);
      g.viewmodel?.startShellReload();
    } else {
      const empty = slot.mag === 0;
      const dur = empty ? def.reloadEmpty : def.reload;
      this._setState('reload', dur);
      g.viewmodel?.playReload(dur, empty);
    }
  }

  cycleFireMode() {
    const slot = this.slot;
    const modes = slot.def.fireModes;
    if (modes.length < 2) return;
    slot.mode = (slot.mode + 1) % modes.length;
    this.game.audio?.playMechanical('fire_mode');
    this.game.hud?.showMessage(MODE_NAMES[modes[slot.mode]], { kind: 'info', duration: 1.2 });
    this._hud();
  }

  switchTo(name) {
    if (name === this.current || !this.slots[name]) return;
    if (this.state === 'throw' || this.state === 'melee' || this.state === 'switch') return;
    this.pending = name;
    this.adsAmount = 0;
    this._setState('switch', 0.28);
    this.game.viewmodel?.lower(0.28);
    this.game.audio?.playMechanical('switch_weapon');
  }

  throwGrenade(kind) {
    const count = kind === 'frag' ? this.frags : this.smokes;
    if (count <= 0 || this.state === 'throw' || this.state === 'melee' || this.state === 'switch') return;
    if (kind === 'frag') this.frags--; else this.smokes--;
    this.throwKind = kind;
    this.thrown = false;
    this.adsAmount = 0;
    this._setState('throw', 0.95);
    this.game.viewmodel?.playThrow(kind);
    this.game.audio?.playMechanical('pin_pull');
    this._hud();
  }

  _releaseGrenade() {
    const g = this.game;
    const cam = g.rs.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const E = EQUIPMENT[this.throwKind];
    const speed = E.throwSpeed;
    const o = cam.position.clone().addScaledVector(_fwd, 0.4).addScaledVector(_right, 0.12);
    // Make sure we don't start inside a wall.
    const hit = g.world.collision.raycast(cam.position.x, cam.position.y, cam.position.z, _fwd.x, _fwd.y, _fwd.z, 0.6);
    if (hit) o.copy(cam.position).addScaledVector(_fwd, Math.max(0, hit.t - 0.15));
    const b = g.player.body;
    const v = [_fwd.x * speed + b.vx * 0.5, _fwd.y * speed + 2.8 + b.vy * 0.3, _fwd.z * speed + b.vz * 0.5];
    g.session?.sendNade(this.throwKind, [o.x, o.y, o.z], v);
    g.audio?.playMechanical('throw');
  }

  melee() {
    if (this.state === 'melee' || this.state === 'throw' || this.state === 'switch') return;
    this.meleeDone = false;
    this.adsAmount = 0;
    this._setState('melee', EQUIPMENT.knife.cooldown);
    this.game.viewmodel?.playMelee();
    this.game.audio?.playMechanical('knife_swing');
  }

  _meleeHit() {
    const g = this.game;
    const cam = g.rs.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    let best = null, bestD = EQUIPMENT.knife.range + 0.4;
    for (const r of g.remotes.list) {
      if (!r.alive || !g.session.isEnemy(r.id)) continue;
      const dx = r.pos.x - cam.position.x, dz = r.pos.z - cam.position.z;
      const dy = r.pos.y + 1.0 - cam.position.y;
      const d = Math.hypot(dx, dz);
      if (d > bestD || Math.abs(dy) > 1.6) continue;
      const dot = (dx * _fwd.x + dz * _fwd.z) / (d || 1) / (Math.hypot(_fwd.x, _fwd.z) || 1);
      if (dot < 0.75) continue;
      bestD = d;
      best = r;
    }
    if (best) {
      g.session?.sendMelee(best.id);
      g.audio?.playMechanical('knife_hit');
      g.hud?.showHitmarker('hit');
      g.effects.blood(best.pos.x, best.pos.y + 1.2, best.pos.z, _fwd.x, 0, _fwd.z);
    } else {
      // Melee into a wall?
      const hit = g.world.collision.raycast(cam.position.x, cam.position.y, cam.position.z, _fwd.x, _fwd.y, _fwd.z, 1.6);
      if (hit) {
        g.effects.impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.terrain ? g.world.surfaceAt(hit.x, hit.z) : hit.mat);
        g.audio?.playImpact(hit.terrain ? g.world.surfaceAt(hit.x, hit.z) : hit.mat, { x: hit.x, y: hit.y, z: hit.z });
      }
    }
  }

  _zeroMsg() {
    this.game.hud?.showMessage(`ZERO ${this.zeroing} M`, { kind: 'info', duration: 1.2 });
    this.game.audio?.playUI('click');
  }

  /** Called every frame by the game after update (handles delayed auto reload). */
  postUpdate() {
    if (this._autoReloadAt && this.time >= this._autoReloadAt) {
      this._autoReloadAt = 0;
      if (this.slot.mag === 0 && this.state === 'idle') this.reload();
    }
  }

  _hud() {
    const g = this.game;
    const slot = this.slot;
    if (!g.hud || !slot) return;
    const def = slot.def;
    g.hud.setAmmo({
      mag: slot.mag, magSize: def.mag, reserve: slot.reserve, weaponName: def.name,
      fireMode: MODE_NAMES[def.fireModes[slot.mode]] || 'SEMI', frags: this.frags, smokes: this.smokes,
      reloading: this.state === 'reload' || this.state === 'reloadShell',
    });
  }

  /** Crosshair gap in CSS pixels for the HUD. */
  crosshairGap(fovDeg, screenH) {
    const s = this.currentSpread();
    return Math.max(2, (Math.tan(s) / Math.tan((fovDeg * DEG) / 2)) * (screenH / 2));
  }
}
