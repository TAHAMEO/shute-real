// First-person viewmodel: weapon + arms in camera space, procedural animation (sway, bob,
// sprint, recoil, reload, bolt/pump cycling, throw, melee, inspect), local muzzle flash,
// shell ejection and picture-in-picture magnified scopes.
import * as THREE from 'three';
import { OPTICS } from '/shared/weapons.js';
import { buildWeaponModel, buildEquipmentModel } from '../models/weapon-models.js';

const DEG = Math.PI / 180;
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const seg = (u, a, b) => clamp01((u - a) / (b - a));

const HIP = {
  AR: [0.115, -0.158, -0.27], SMG: [0.105, -0.15, -0.255], LMG: [0.13, -0.19, -0.27], DMR: [0.12, -0.165, -0.27],
  SNIPER: [0.125, -0.17, -0.27], SHOTGUN: [0.115, -0.16, -0.27], PISTOL: [0.09, -0.12, -0.31],
};

// ------------------------------------------------------------------ scope lens shader
const LENS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const LENS_FRAG = /* glsl */ `
uniform sampler2D tScope;
uniform float uActive;
uniform float uReticle; // 0 acog, 1 pso, 2 scope8
uniform float uAspectFix;
varying vec2 vUv;
float line(float d, float w) { return 1.0 - smoothstep(w * 0.6, w, abs(d)); }
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c);
  vec3 col;
  if (uActive > 0.5) {
    col = texture2D(tScope, vec2(0.5) + c).rgb;
  } else {
    col = vec3(0.02, 0.025, 0.035) + vec3(0.05, 0.06, 0.08) * (1.0 - r * 2.0);
  }
  // Reticle.
  float ret = 0.0;
  vec3 retCol = vec3(0.0);
  if (uReticle < 0.5) {
    // ACOG: red chevron + thin stadia lines
    vec2 p = c;
    float chev = line(abs(p.x) - (-p.y) * 0.9, 0.006) * step(-0.045, p.y) * step(p.y, 0.0);
    retCol = vec3(1.8, 0.15, 0.08);
    ret = chev;
    float stadia = line(p.x, 0.004) * step(p.y, -0.05) * step(-0.36, p.y);
    col = mix(col, vec3(0.0), stadia);
  } else if (uReticle < 1.5) {
    // PSO-1: chevrons + horizontal ticks
    vec2 p = c;
    float chev = line(abs(p.x) - (-p.y) * 0.8, 0.006) * step(-0.035, p.y) * step(p.y, 0.0);
    for (int i = 1; i < 4; i++) {
      vec2 q = p - vec2(0.0, -0.06 * float(i));
      chev += line(abs(q.x) - (-q.y) * 0.8, 0.005) * step(-0.025, q.y) * step(q.y, 0.0);
    }
    float h = line(p.y, 0.004) * step(0.04, abs(p.x)) * step(abs(p.x), 0.3);
    col = mix(col, vec3(0.0), clamp(chev + h, 0.0, 1.0));
    ret = 0.0;
  } else {
    // Tactical mil-dot crosshair with thick outer posts
    vec2 p = c;
    float thin = line(p.x, 0.0035) + line(p.y, 0.0035);
    float thick = (line(p.x, 0.012) * step(0.18, abs(p.y))) + (line(p.y, 0.012) * step(0.18, abs(p.x)));
    float dots = 0.0;
    for (int i = 1; i < 6; i++) {
      float o = 0.032 * float(i);
      dots += 1.0 - smoothstep(0.004, 0.006, length(p - vec2(o, 0.0)));
      dots += 1.0 - smoothstep(0.004, 0.006, length(p - vec2(-o, 0.0)));
      dots += 1.0 - smoothstep(0.004, 0.006, length(p - vec2(0.0, o)));
      dots += 1.0 - smoothstep(0.004, 0.006, length(p - vec2(0.0, -o)));
    }
    col = mix(col, vec3(0.0), clamp(thin + thick + dots, 0.0, 1.0));
    float cdot = 1.0 - smoothstep(0.002, 0.004, r);
    ret = cdot;
    retCol = vec3(2.0, 0.1, 0.05);
  }
  col = mix(col, retCol, ret);
  // Eye-box vignette + dark rim.
  float v = smoothstep(0.5, 0.36, r);
  col *= v;
  gl_FragColor = vec4(col, 1.0);
}
`;

function makeFlashMaterial() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  for (let k = 0; k < 7; k++) {
    g.rotate((Math.PI * 2) / 7 + Math.random() * 0.2);
    const gr = g.createLinearGradient(0, 0, 0, -60);
    gr.addColorStop(0, 'rgba(255,250,220,1)');
    gr.addColorStop(1, 'rgba(255,170,60,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(-7, 0); g.lineTo(0, -40 - Math.random() * 22); g.lineTo(7, 0);
    g.fill();
  }
  const cg = g.createRadialGradient(0, 0, 0, 0, 0, 26);
  cg.addColorStop(0, 'rgba(255,255,240,1)');
  cg.addColorStop(1, 'rgba(255,190,90,0)');
  g.fillStyle = cg;
  g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(3, 2.4, 1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
}

export class Viewmodel {
  constructor(game) {
    this.game = game;
    this.rs = game.rs;
    this.scene = game.rs.vmScene;
    this.root = new THREE.Group();          // camera-space pose
    this.holder = new THREE.Group();        // weapon root parent (reload tilt etc.)
    this.root.add(this.holder);
    this.scene.add(this.root);
    this.cache = new Map();
    this.weapon = null;                     // { model, slot, key, hip, ads, magRest, boltRest }
    this.arms = null;
    this.leftTarget = new THREE.Object3D(); // animated support-hand target
    this.rightTarget = new THREE.Object3D();
    this.holder.add(this.leftTarget, this.rightTarget);
    this.flashMat = makeFlashMaterial();
    this.flash = new THREE.Group();
    const fq = new THREE.PlaneGeometry(1, 1);
    const front = new THREE.Mesh(fq, this.flashMat);
    const side1 = new THREE.Mesh(fq, this.flashMat); side1.rotation.y = Math.PI / 2; side1.scale.set(1.6, 0.7, 1); side1.position.z = -0.05;
    const side2 = new THREE.Mesh(fq, this.flashMat); side2.rotation.set(Math.PI / 2, 0, Math.PI / 2); side2.scale.set(1.6, 0.7, 1); side2.position.z = -0.05;
    this.flash.add(front, side1, side2);
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffb070, 0, 2.5, 2);
    this.scene.add(this.flashLight);
    this.flashT = 0;
    // Animation state.
    this.t = 0;
    this.kickZ = 0; this.kickZv = 0; this.kickRot = 0; this.kickRotv = 0; this.kickRoll = 0;
    this.swayX = 0; this.swayY = 0; this.swayVx = 0; this.swayVy = 0;
    this.sprintAmt = 0;
    this.raiseAmt = 1; this.raiseTarget = 1;
    this.anim = null; // { type, t, dur, ... }
    this.lens = null;
    this.lensMat = null;
    this.scopeCam = new THREE.PerspectiveCamera(10, 1, 0.2, 3000);
    this.visible = true;
    this.equipItem = null; // grenade/knife model while throwing/meleeing
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._m = new THREE.Matrix4();
    this._tmp = new THREE.Vector3();
    this._initArms();
  }

  async _initArms() {
    try {
      const mod = await import('../models/soldier.js');
      if (mod.createFirstPersonArms) {
        this.arms = mod.createFirstPersonArms({ team: this.game.myTeam ?? 0 });
        this.scene.add(this.arms.root);
      }
    } catch (e) {
      console.warn('First-person arms unavailable:', e);
    }
  }

  setTeam(team) {
    if (!this.arms || this._armsTeam === team) return;
    this._armsTeam = team;
    import('../models/soldier.js').then((mod) => {
      if (!mod.createFirstPersonArms) return;
      this.scene.remove(this.arms.root);
      this.arms.dispose?.();
      this.arms = mod.createFirstPersonArms({ team: team < 0 ? 0 : team });
      this.scene.add(this.arms.root);
    }).catch(() => {});
  }

  _model(slot) {
    const key = slot.id + '|' + slot.att.optic + '|' + slot.att.muzzle + '|' + slot.att.grip;
    if (this.cache.has(key)) return this.cache.get(key);
    const model = buildWeaponModel(slot.id, slot.att, { lod: 'fp' });
    model.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
    const a = model.anchors;
    const sight = a.sight ? a.sight.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 0.07, 0.05);
    model.root.updateMatrixWorld(true);
    const sightLocal = a.sight ? model.root.worldToLocal(a.sight.getWorldPosition(new THREE.Vector3())) : sight;
    const entry = {
      key, model, slot,
      sightLocal,
      magRest: a.magazine ? a.magazine.position.clone() : null,
      boltRest: a.bolt ? a.bolt.position.clone() : null,
      boltRotRest: a.bolt ? a.bolt.rotation.clone() : null,
      cylRest: a.cylinder ? a.cylinder.rotation.clone() : null,
    };
    // Picture-in-picture lens.
    const optic = OPTICS[slot.att.optic];
    if (a.lens && optic?.pip) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: LENS_VERT, fragmentShader: LENS_FRAG,
        uniforms: {
          tScope: { value: null }, uActive: { value: 0 }, uAspectFix: { value: 1 },
          uReticle: { value: slot.att.optic === 'acog' ? 0 : slot.att.optic === 'pso' ? 1 : 2 },
        },
      });
      a.lens.material = mat;
      entry.lensMat = mat;
      entry.magnification = optic.magnification || 4;
    }
    this.cache.set(key, entry);
    return entry;
  }

  /** Show the weapon for a weapon slot (from WeaponController). anim: 'equip' | 'raise' | null */
  setWeapon(slot, anim = 'equip') {
    const e = this._model(slot);
    if (this.weapon && this.weapon.model.root.parent) this.holder.remove(this.weapon.model.root);
    this.weapon = e;
    this.holder.add(e.model.root);
    this._resetParts();
    this.anim = null;
    this._hideItem();
    if (anim) { this.raiseAmt = 0; this.raiseTarget = 1; }
    const def = slot.def;
    this.hip = HIP[def.category] || HIP.AR;
  }

  _resetParts() {
    const w = this.weapon;
    if (!w) return;
    const a = w.model.anchors;
    if (a.magazine && w.magRest) { a.magazine.position.copy(w.magRest); a.magazine.visible = true; }
    if (a.bolt && w.boltRest) { a.bolt.position.copy(w.boltRest); a.bolt.rotation.copy(w.boltRotRest); }
    if (a.cylinder && w.cylRest) a.cylinder.rotation.copy(w.cylRest);
  }

  lower(dur) { this.raiseTarget = 0; this._lowerSpeed = 1 / Math.max(0.05, dur); }

  onFire(suppressed) {
    const def = this.weapon?.slot.def;
    if (!def) return;
    const heavy = def.recoil.kick;
    const ads = this.game.weapons.adsAmount;
    this.kickZv += (0.9 + heavy * 0.5) * (1 - ads * 0.45);
    this.kickRotv += (2.2 + heavy * 2.5) * DEG * 60 * (1 - ads * 0.6);
    this.kickRoll = (Math.random() - 0.5) * 1.5 * DEG * heavy;
    // Muzzle flash.
    const a = this.weapon.model.anchors;
    if (a.muzzle) {
      a.muzzle.add(this.flash);
      this.flash.position.set(0, 0, -0.04);
      const s = suppressed ? 0.05 : 0.11 + Math.random() * 0.05;
      this.flash.scale.setScalar(s * (def.category === 'PISTOL' ? 0.7 : 1) * (def.category === 'SHOTGUN' || def.category === 'SNIPER' ? 1.5 : 1));
      this.flash.rotation.z = Math.random() * Math.PI;
      this.flash.visible = true;
      this.flashT = suppressed ? 0.02 : 0.05;
      this.flashLight.intensity = suppressed ? 0 : 3;
      a.muzzle.getWorldPosition(this.flashLight.position);
      if (!suppressed) {
        const c = this.rs.camera;
        this._v.set(0.1, -0.05, -0.8).applyQuaternion(c.quaternion).add(c.position);
        this.game.effects.flashLight(this._v.x, this._v.y, this._v.z, 0xffb060, 18, 0.06, 9);
      }
    }
    // Pistol slide / automatic bolt motion.
    if (a.bolt && def.category === 'PISTOL') this.anim = this.anim || { type: 'slide', t: 0, dur: 0.09, lock: this.game.weapons.slot.mag === 0 };
    // Shell ejection (world space).
    if (a.eject && def.shell !== 'none' && !def.fireModes.includes('bolt') && !def.fireModes.includes('pump')) this._eject(def.shell);
  }

  _eject(kind) {
    const a = this.weapon.model.anchors;
    const cam = this.rs.camera;
    a.eject.updateWorldMatrix(true, false);
    const pos = a.eject.getWorldPosition(new THREE.Vector3());
    // vm camera space -> world: vm camera sits at the origin with identity rotation.
    pos.applyQuaternion(cam.quaternion).add(cam.position);
    const right = new THREE.Vector3(1, 0, 0).transformDirection(a.eject.matrixWorld).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    this.game.effects.ejectShell(pos, right, up, kind);
    const audio = this.game.audio;
    if (audio && Math.random() < 0.7) audio.playShellCasing(kind, { x: pos.x, y: pos.y - 1.4, z: pos.z });
  }

  /** World position of the muzzle (for tracer origins). */
  muzzleWorld(out) {
    const a = this.weapon?.model.anchors;
    const cam = this.rs.camera;
    if (!a?.muzzle) return out.copy(cam.position);
    this.root.updateMatrixWorld(true);
    a.muzzle.getWorldPosition(out);
    // The viewmodel is drawn with a narrower FOV; approximate by scaling toward the view axis.
    const k = Math.tan((this.rs.camera.fov * DEG) / 2) / Math.tan((this.rs.vmCamera.fov * DEG) / 2);
    out.x *= k; out.y *= k;
    return out.applyQuaternion(cam.quaternion).add(cam.position);
  }

  playReload(dur, empty) {
    this.anim = { type: 'reload', t: 0, dur, empty, events: new Set() };
  }

  startShellReload() { this.anim = { type: 'shell', t: 0, dur: 1e9, insertT: -1 }; }
  onShellInsert() { if (this.anim?.type === 'shell') this.anim.insertT = this.anim.t; }
  endShellReload() { if (this.anim?.type === 'shell') this.anim = { type: 'shellEnd', t: 0, dur: 0.3 }; }

  playCycle(dur, delay = 0) {
    this.anim = { type: 'cycle', t: -delay, dur, pump: this.weapon?.slot.def.fireModes.includes('pump') };
    const def = this.weapon?.slot.def;
    if (def && def.shell !== 'none') setTimeout(() => { if (this.weapon && this.weapon.slot.def === def) this._eject(def.shell); }, (delay + dur * 0.5) * 1000);
  }

  playThrow(kind) {
    this.anim = { type: 'throw', t: 0, dur: 0.95, kind };
    this._showItem(kind);
  }

  playMelee() {
    this.anim = { type: 'melee', t: 0, dur: 0.6 };
    this._showItem('knife');
  }

  playInspect() { this.anim = { type: 'inspect', t: 0, dur: 2.4 }; }

  _showItem(kind) {
    this._hideItem();
    try {
      const m = buildEquipmentModel(kind, { lod: 'fp' });
      m.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
      this.equipItem = m;
      this.scene.add(m.root);
    } catch {
      this.equipItem = null;
    }
  }

  _hideItem() {
    if (this.equipItem) {
      this.scene.remove(this.equipItem.root);
      this.equipItem.dispose?.();
      this.equipItem = null;
    }
  }

  setVisible(v) {
    this.visible = v;
    this.root.visible = v;
    if (this.arms) this.arms.setVisible?.(v);
  }

  /**
   * Per-frame update. look = { dx, dy } mouse delta this frame (pixels).
   */
  update(dt, look) {
    const w = this.weapon;
    if (!w) return;
    const g = this.game;
    const p = g.player;
    const wc = g.weapons;
    const def = w.slot.def;
    this.t += dt;
    const ads = smooth(clamp01(wc.adsAmount));
    // ---- springs
    this.kickZv += (-this.kickZ * 220 - this.kickZv * 22) * dt;
    this.kickZ += this.kickZv * dt;
    this.kickRotv += (-this.kickRot * 260 - this.kickRotv * 20) * dt;
    this.kickRot += this.kickRotv * dt;
    this.kickRoll *= Math.max(0, 1 - dt * 10);
    // Sway from mouse movement.
    const sens = 0.00045 * (1 - ads * 0.75);
    this.swayVx += (-look.dx * sens - this.swayX * 120 - this.swayVx * 16) * dt * 60 * dt;
    this.swayVy += (-look.dy * sens - this.swayY * 120 - this.swayVy * 16) * dt * 60 * dt;
    this.swayX = Math.max(-0.06, Math.min(0.06, this.swayX + this.swayVx));
    this.swayY = Math.max(-0.06, Math.min(0.06, this.swayY + this.swayVy));
    this.swayX *= Math.max(0, 1 - dt * 6);
    this.swayY *= Math.max(0, 1 - dt * 6);
    // Sprint and raise.
    const sprintT = p.sprinting && !wc.busy ? 1 : 0;
    this.sprintAmt += (sprintT - this.sprintAmt) * Math.min(1, dt * 8);
    const rs = this._lowerSpeed || 3;
    if (this.raiseAmt < this.raiseTarget) this.raiseAmt = Math.min(this.raiseTarget, this.raiseAmt + dt / Math.max(0.15, def.equipTime * 0.8));
    else if (this.raiseAmt > this.raiseTarget) this.raiseAmt = Math.max(this.raiseTarget, this.raiseAmt - dt * rs);
    const raise = smooth(this.raiseAmt);

    // ---- base pose (hip <-> ADS)
    const hip = this.hip;
    const sl = w.sightLocal;
    const bobA = p.bobAmount * (1 - ads * 0.85) * (p.sprinting ? 1.8 : 1);
    const bobX = Math.sin(p.bobPhase) * 0.011 * bobA;
    const bobY = -Math.abs(Math.cos(p.bobPhase)) * 0.009 * bobA;
    const breathe = Math.sin(this.t * 1.6) * 0.0018 * (1 - ads * 0.7);
    const px = hip[0] + (-sl.x - hip[0]) * ads;
    const py = hip[1] + (-sl.y - hip[1]) * ads;
    const pz = hip[2] + (-sl.z - hip[2]) * ads;
    let rx = 0, ry = 1.5 * DEG * (1 - ads), rz = 0;
    let ox = 0, oy = 0, oz = 0;
    // Sprint pose.
    const sp = smooth(this.sprintAmt);
    ry += sp * 38 * DEG; rx -= sp * 14 * DEG; rz += sp * 16 * DEG;
    ox += sp * -0.02; oy += sp * -0.05; oz += sp * 0.05;
    // Lowered (switching/equipping).
    rx -= (1 - raise) * 55 * DEG; oy -= (1 - raise) * 0.18;
    // Stance.
    if (p.body.stance === 2) { oy -= 0.01 * (1 - ads); rz += 4 * DEG * (1 - ads); }

    // ---- action animations
    const a = w.model.anchors;
    let leftOverride = null;
    let hideLeft = false;
    this.leftTarget.visible = false;
    const an = this.anim;
    if (an) {
      an.t += dt;
      const u = an.dur > 0 ? clamp01(an.t / an.dur) : 1;
      if (an.type === 'reload') {
        const tilt = smooth(seg(u, 0, 0.15)) * (1 - smooth(seg(u, 0.82, 1)));
        rz += tilt * 24 * DEG; rx += tilt * 9 * DEG; oy -= tilt * 0.03; ox -= tilt * 0.02;
        if (a.magazine && w.magRest) {
          const out = smooth(seg(u, 0.14, 0.3));
          const back = smooth(seg(u, 0.45, 0.62));
          const off = out * (1 - back);
          a.magazine.position.set(w.magRest.x, w.magRest.y - off * 0.3, w.magRest.z + off * 0.05);
          a.magazine.visible = !(u > 0.3 && u < 0.45);
          if (u > 0.18 && !an.events.has('out')) { an.events.add('out'); g.audio?.playMechanical('mag_out'); }
          if (u > 0.6 && !an.events.has('in')) { an.events.add('in'); g.audio?.playMechanical('mag_in'); }
          // Support hand follows the magazine.
          a.magazine.updateWorldMatrix(true, false);
          const handOnMag = seg(u, 0.1, 0.18) * (1 - seg(u, 0.66, 0.78));
          if (handOnMag > 0) {
            a.magazine.getWorldPosition(this._tmp);
            this.holder.worldToLocal(this._tmp);
            this.leftTarget.position.copy(this._tmp);
            if (u > 0.3 && u < 0.45) this.leftTarget.position.y -= 0.25 * Math.sin(seg(u, 0.3, 0.45) * Math.PI);
            leftOverride = this.leftTarget;
          }
        } else if (a.cylinder && w.cylRest) {
          // Revolver: swing the cylinder out.
          const open = smooth(seg(u, 0.1, 0.25)) * (1 - smooth(seg(u, 0.75, 0.9)));
          a.cylinder.rotation.set(w.cylRest.x, w.cylRest.y, w.cylRest.z - open * 1.2);
          rz += open * 20 * DEG;
          if (u > 0.2 && !an.events.has('open')) { an.events.add('open'); g.audio?.playMechanical('cylinder_open'); }
          if (u > 0.78 && !an.events.has('close')) { an.events.add('close'); g.audio?.playMechanical('cylinder_close'); }
        }
        if (an.empty && a.bolt && w.boltRest) {
          const pull = Math.sin(seg(u, 0.72, 0.86) * Math.PI);
          a.bolt.position.z = w.boltRest.z + pull * 0.07;
          if (u > 0.74 && !an.events.has('charge')) { an.events.add('charge'); g.audio?.playMechanical(def.category === 'PISTOL' ? 'bolt_forward' : 'charge'); }
        }
        if (u >= 1) { this.anim = null; this._resetParts(); }
      } else if (an.type === 'shell' || an.type === 'shellEnd') {
        const inT = an.type === 'shell' ? smooth(clamp01(an.t / 0.3)) : 1 - smooth(u);
        rz += inT * 22 * DEG; rx += inT * 8 * DEG; oy -= inT * 0.025;
        if (an.type === 'shell' && an.insertT >= 0) {
          const k = an.t - an.insertT;
          if (k < 0.25) { oz += Math.sin((k / 0.25) * Math.PI) * 0.01; }
        }
        // Left hand moves between pocket and loading port.
        this.leftTarget.position.set(0.0, -0.08 - Math.abs(Math.sin(an.t * 6)) * 0.06, -0.12);
        leftOverride = this.leftTarget;
        if (an.type === 'shellEnd' && u >= 1) this.anim = null;
      } else if (an.type === 'cycle') {
        if (an.t >= 0 && a.bolt && w.boltRest) {
          const uu = clamp01(an.t / an.dur);
          if (an.pump) {
            const pull = Math.sin(uu * Math.PI);
            a.bolt.position.z = w.boltRest.z + pull * 0.09;
            oz += pull * 0.01;
          } else {
            const up = smooth(seg(uu, 0, 0.2)) * (1 - smooth(seg(uu, 0.8, 1)));
            const back = Math.sin(seg(uu, 0.2, 0.8) * Math.PI);
            a.bolt.rotation.set(w.boltRotRest.x, w.boltRotRest.y, w.boltRotRest.z + up * 1.1);
            a.bolt.position.z = w.boltRest.z + back * 0.09;
            rz += up * 6 * DEG;
          }
        }
        if (an.t >= an.dur) { this.anim = null; this._resetParts(); }
      } else if (an.type === 'slide') {
        if (a.bolt && w.boltRest) {
          const k = an.lock ? 1 : Math.sin(u * Math.PI);
          a.bolt.position.z = w.boltRest.z + k * 0.028;
        }
        if (u >= 1) { if (!an.lock) this._resetParts(); this.anim = an.lock ? { type: 'locked', t: 0, dur: 1e9 } : null; }
      } else if (an.type === 'locked') {
        if (a.bolt && w.boltRest) a.bolt.position.z = w.boltRest.z + 0.028;
        if (g.weapons.slot.mag > 0) { this.anim = null; this._resetParts(); }
      } else if (an.type === 'throw') {
        // Lower weapon, wind up, throw.
        rx -= 60 * DEG; oy -= 0.25;
        const wind = smooth(seg(u, 0, 0.35));
        const fling = smooth(seg(u, 0.38, 0.55));
        if (this.equipItem) {
          const r = this.equipItem.root;
          r.visible = u < 0.47;
          r.position.set(0.18 - fling * 0.12, -0.16 + wind * 0.12 + fling * 0.1, -0.25 + wind * 0.1 - fling * 0.45);
          r.rotation.set(-wind * 0.8 + fling * 1.5, 0, 0);
        }
        hideLeft = true;
        if (u >= 1) { this.anim = null; this._hideItem(); }
      } else if (an.type === 'melee') {
        rx -= 50 * DEG; oy -= 0.22;
        if (this.equipItem) {
          const r = this.equipItem.root;
          const sw = smooth(seg(u, 0.05, 0.4));
          r.position.set(0.25 - sw * 0.35, -0.12 + Math.sin(sw * Math.PI) * 0.06, -0.3 - Math.sin(sw * Math.PI) * 0.12);
          r.rotation.set(-0.3, 0.6 - sw * 1.6, -1.2 + sw * 0.9);
          r.visible = true;
        }
        hideLeft = true;
        if (u >= 1) { this.anim = null; this._hideItem(); }
      } else if (an.type === 'inspect') {
        const k = Math.sin(u * Math.PI);
        ry -= k * 45 * DEG; rz += k * 25 * DEG; ox -= k * 0.06; oz += k * 0.04;
        if (u >= 1) this.anim = null;
      }
    }

    // ---- compose
    this.root.position.set(px + ox + bobX + this.swayX * 0.6, py + oy + bobY + breathe + this.swayY * 0.6, pz + oz + this.kickZ * 0.06);
    this._e.set(rx + this.kickRot + this.swayY * 1.2, ry + this.swayX * 1.4, rz + this.kickRoll + this.swayX * 0.6, 'YXZ');
    this.root.quaternion.setFromEuler(this._e);
    this.root.updateMatrixWorld(true);

    // ---- arms
    if (this.arms) {
      let right = a.rightHand || w.model.root;
      if (this.equipItem && this.equipItem.root.visible) {
        this.equipItem.root.updateMatrixWorld(true);
        right = this.equipItem.anchors.rightHand || this.equipItem.root;
      }
      let left = a.leftHand;
      if (an && an.type === 'cycle' && an.pump && left) {
        // left hand rides the pump
        left = a.bolt || left;
      }
      this.arms.update(right, hideLeft ? null : left, { leftOverride });
    }

    // ---- muzzle flash decay
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.flash.visible = false; this.flashLight.intensity = 0; }
    }

    // ---- picture-in-picture scope
    if (w.lensMat) {
      const active = wc.adsAmount > 0.55 && g.settings.graphics.pipScopes !== false;
      w.lensMat.uniforms.uActive.value = active ? 1 : 0;
      if (active) {
        const cam = this.rs.camera;
        this.scopeCam.position.copy(cam.position);
        this.scopeCam.quaternion.copy(cam.quaternion);
        const lensAngle = 3.2; // degrees the lens covers in the eye's view at ADS (approx)
        this.scopeCam.fov = Math.max(0.6, (cam.fov / w.magnification) * 0.55 + lensAngle * 0.2);
        this.scopeCam.far = cam.far;
        this.scopeCam.updateProjectionMatrix();
        this.scopeCam.updateMatrixWorld();
        w.lensMat.uniforms.tScope.value = this.rs.renderScope(this.scopeCam, 512);
      }
    }
  }

  dispose() {
    this.scene.remove(this.root, this.flashLight);
    if (this.arms) { this.scene.remove(this.arms.root); this.arms.dispose?.(); }
    for (const e of this.cache.values()) { e.model.dispose(); e.lensMat?.dispose(); }
    this.cache.clear();
  }
}
