// SHUTE REAL procedural audio engine (Web Audio API, no assets, no Three.js dependency).
//
// Graph:
//   voices ─┬─(local, wide)─> localBus ─> mid + decorrelated side (pseudo-stereo) ─┐
//           ├─(remote)──────> HRTF PannerNode ─────────────────────────────────────┤
//           └─ reverb sends ─> outdoor / indoor ConvolverNodes ─────────────────────┴─> sfx (volume) ─┐
//   ambience ─────────────────────────────────────────────────────────> ambient (volume) ─┤
//                                       world ─> low-health LPF ─> explosion LPF ─> duck ─┴─> master
//   ui (volume) ─────────────────────────────────────────────────────────────────────────────> master
//   ear (tinnitus, heartbeat; follows sfx volume, never muffled) ─────────────────────────────> master
//   master (volume) ─> DynamicsCompressor (limiter) ─> trim ─> soft clipper ─> destination
//
// Positions are plain {x, y, z} objects in metres (same axes as the game world).
// Every public method is safe to call before init() or without Web Audio: it simply does nothing.

import {
  buildBank, resolveGunProfile, GUN_PROFILES, FOOT_SURFACES, IMPACT_SURFACES, CASING_KINDS, MECH_NAMES,
  UI_NAMES, HITMARKER_KINDS, AMBIENT_PRESETS, clamp, dbToGain,
} from './audio-synth.js';

const SPEED_OF_SOUND = 343;
const MAX_VOICES = 48;
const MAX_HRTF = 20; // beyond this many simultaneous HRTF panners, new voices use 'equalpower'
const NYQ_SAFE = 20000;

/** Per-category voice caps, PannerNode tuning (inverse model) and culling distance (m). */
const CATS = {
  gun: { cap: 28, ref: 12, rolloff: 0.35, cull: 4000 },
  gunFar: { cap: 10, ref: 12, rolloff: 0.35, cull: 4000 },
  expl: { cap: 6, ref: 15, rolloff: 0.4, cull: 5000 },
  foot: { cap: 16, ref: 2, rolloff: 1.15, cull: 70 },
  impact: { cap: 16, ref: 3, rolloff: 1.1, cull: 220 },
  whiz: { cap: 8, ref: 3, rolloff: 1, cull: 80 },
  casing: { cap: 12, ref: 1.5, rolloff: 1.4, cull: 30 },
  mech: { cap: 10, ref: 1.5, rolloff: 1.3, cull: 45 },
  body: { cap: 8, ref: 2, rolloff: 1.2, cull: 60 },
  smoke: { cap: 4, ref: 4, rolloff: 0.9, cull: 120 },
  ui: { cap: 8 },
  ear: { cap: 6 },
  amb: { cap: 12, ref: 12, rolloff: 0.6, cull: 2000 },
};

// Loudness over distance in dB (log-distance interpolation). Gentler than physics on purpose:
// distant gunfire is gameplay information and must stay audible.
const GUN_CURVE = [[0, 0], [10, -2], [25, -5], [50, -9], [100, -13], [200, -17], [400, -20.5], [800, -24], [1500, -27.5], [3000, -34]];
const SUP_CURVE = [[0, 0], [10, -3], [25, -8], [50, -14], [100, -22], [200, -32], [350, -46], [450, -60]];
const EXPL_CURVE = [[0, 2], [10, 0], [25, -4], [50, -8], [100, -12], [200, -16], [400, -19.5], [800, -23], [1500, -26.5], [3000, -32]];

const FOOT_ALIAS = { sand: 'dirt', mud: 'dirt', soil: 'dirt', water: 'dirt', snow: 'grass', leaves: 'grass', stone: 'rock',
  asphalt: 'concrete', tile: 'concrete', brick: 'concrete', planks: 'wood', steel: 'metal' };
const IMPACT_ALIAS = { ...FOOT_ALIAS, gravel: 'rock', glass: 'metal', body: 'flesh', player: 'flesh', snow: 'dirt', leaves: 'grass' };

const AMBIENT = {
  valley: { windLp: [320, 950], windGain: [0.16, 0.42], gust: [3, 8], birds: [1.6, 5], species: [3, 2, 2, 3, 1], insects: 0.2 },
  outpost: { windLp: [450, 1300], windGain: [0.12, 0.3], gust: [2.5, 7], birds: [3, 8], species: [2, 1, 3, 2, 2], rustle: [2, 6] },
  alpine: { windLp: [550, 2300], windGain: [0.32, 0.95], gust: [1.4, 4.2], howl: true, rockfall: [22, 65] },
};

const taper = (v) => v * v; // slider value 0..1 -> gain (perceptual-ish)
const rnd = (a, b) => a + Math.random() * (b - a);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const vec = (p, d = 0) => ({ x: finite(p && p.x) ? p.x : d, y: finite(p && p.y) ? p.y : d, z: finite(p && p.z) ? p.z : d });
const isVec = (p) => !!p && typeof p === 'object' && (finite(p.x) || finite(p.y) || finite(p.z));

function curveDb(curve, d) {
  if (d <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [d1, v1] = curve[i];
    if (d <= d1) {
      const [d0, v0] = curve[i - 1];
      const u = (Math.log(d + 1) - Math.log(d0 + 1)) / (Math.log(d1 + 1) - Math.log(d0 + 1));
      return v0 + (v1 - v0) * u;
    }
  }
  return curve[curve.length - 1][1];
}

/** Air absorption: low-pass cutoff for a source at distance d (0 = no filter). */
function airLowpass(d) {
  if (d <= 20) return 0;
  return clamp(20000 * Math.pow(20 / d, 0.75), 650, NYQ_SAFE);
}

/** Gain the PannerNode's inverse distance model applies at distance d. */
function pannerInverse(d, c) {
  return c.ref / (c.ref + c.rolloff * (Math.max(d, c.ref) - c.ref));
}

/** Soft clipper: transparent below 0.9, smooth knee to 1.0, for input up to +-2. */
function softClipCurve() {
  const n = 4096; const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2; const a = Math.abs(x);
    const y = a <= 0.9 ? a : 0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1);
    c[i] = (Math.sign(x) * y) / 2;
  }
  return c;
}

/**
 * Procedural audio engine for SHUTE REAL. See the module header for the routing graph.
 */
export class AudioEngine {
  constructor() {
    this._ctx = null;
    this._bank = null;
    this._ready = false;
    this._failed = false;
    this._disposed = false;
    this._paused = false;
    this._initPromise = null;
    this._vol = { master: 1, sfx: 1, ambient: 0.6, ui: 0.8 };
    this._lp = { x: 0, y: 0, z: 0 };
    this._lf = { x: 0, y: 0, z: -1 };
    this._lu = { x: 0, y: 1, z: 0 };
    this._voices = [];
    this._hrtf = 0;
    this._lastPick = new Map();
    this._amb = null;
    this._pendingAmbient = null;
    this._lowHealth = 0;
    this._heartTimer = 0;
    this._nextBeat = 0;
    this._unlock = null;
    this._tinnitus = null;
  }

  // ------------------------------------------------------------------ lifecycle

  /**
   * Create/resume the AudioContext and synthesise the sound bank. Call from a user gesture.
   * Safe to call more than once (returns the same promise). Never rejects.
   * @returns {Promise<void>}
   */
  init() {
    if (!this._initPromise) {
      this._initPromise = this._init().catch((e) => {
        this._failed = true;
        console.warn('[audio] init failed:', e);
      });
    } else if (this._ctx && this._ctx.state === 'suspended' && !this._paused) {
      this._ctx.resume().catch(() => {});
    }
    return this._initPromise;
  }

  async _init() {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC || typeof OfflineAudioContext === 'undefined') { this._failed = true; return; }
    let ctx;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch { ctx = new AC(); }
    this._ctx = ctx;
    this._buildGraph();
    this._applyVolumes(0);
    this._applyListener();
    this._installUnlock();
    try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 250))]); } catch { /* needs a gesture */ }
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    const t0 = performance.now();
    const bank = await buildBank({ sampleRate: ctx.sampleRate, concurrency: clamp(cores, 2, 6), isCancelled: () => this._disposed });
    if (this._disposed) return;
    this._bank = bank;
    this._bankMs = Math.round(performance.now() - t0);
    try { this._convOut.buffer = bank.ir.outdoor; } catch (e) { console.warn('[audio] outdoor IR', e); }
    try { this._convIn.buffer = bank.ir.indoor; } catch (e) { console.warn('[audio] indoor IR', e); }
    this._ready = true;
    if (this._pendingAmbient) { const p = this._pendingAmbient; this._pendingAmbient = null; this.startAmbient(p); }
    if (this._lowHealth > 0) this.setLowHealth(this._lowHealth);
  }

  /** True once the context exists and the sound bank is synthesised. */
  get ready() { return this._ready && !this._disposed; }

  /** The AudioContext (null before init / when unavailable). */
  get context() { return this._ctx; }

  /** Dev/diagnostics: the synthesised bank (nested AudioBuffers, meta, stats). */
  get bank() { return this._bank; }

  /** Dev/diagnostics: final node before the destination (tap it with an AnalyserNode). */
  get outputNode() { return this._out || null; }

  /** Dev/diagnostics snapshot. */
  get stats() {
    const b = this._bank && this._bank.stats;
    return {
      state: this._ctx ? this._ctx.state : 'none',
      sampleRate: this._ctx ? this._ctx.sampleRate : 0,
      voices: this._voices.length,
      hrtf: this._hrtf,
      bankMs: this._bankMs || 0,
      synthMs: b ? b.ms : 0,
      maxBlockMs: b ? b.maxBlockMs : 0,
      buffers: b ? b.buffers : 0,
      bytes: b ? b.bytes : 0,
      rates: b ? b.rates : null,
    };
  }

  /** Release everything (stops sounds, timers, closes the context). The engine can't be reused. */
  dispose() {
    try {
      this._disposed = true;
      this._ready = false;
      this._stopHeart();
      if (this._amb) { clearInterval(this._amb.timer); this._amb = null; }
      for (const v of this._voices.slice()) this._release(v);
      this._voices = [];
      this._removeUnlock();
      if (this._ctx && this._ctx.state !== 'closed') this._ctx.close().catch(() => {});
    } catch (e) {
      console.warn('[audio] dispose', e);
    }
    this._ctx = null;
    this._bank = null;
  }

  /**
   * Pause/resume (menus): mutes the world (sfx + ambience) and pauses ambience/heartbeat
   * scheduling; UI sounds keep working. `{ suspendContext: true }` also suspends the AudioContext.
   */
  setPaused(paused, { suspendContext = false } = {}) {
    try {
      this._paused = !!paused;
      const ctx = this._ctx;
      if (!ctx) return;
      const t = ctx.currentTime;
      this._pauseGain.gain.setTargetAtTime(this._paused ? 0 : 1, t, this._paused ? 0.03 : 0.08);
      if (this._paused) {
        if (suspendContext) setTimeout(() => { if (this._paused && this._ctx) this._ctx.suspend().catch(() => {}); }, 150);
      } else {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        this._nextBeat = 0;
      }
    } catch (e) { this._warn(e); }
  }

  // ------------------------------------------------------------------ mix

  /**
   * Bus volumes (0..1 slider values, squared taper). Missing keys keep their current value
   * (defaults: master 1, sfx 1, ambient 0.6, ui 0.8). Works before init().
   */
  setVolumes({ master, sfx, ambient, ui } = {}) {
    try {
      const v = this._vol;
      if (finite(master)) v.master = clamp(master, 0, 1);
      if (finite(sfx)) v.sfx = clamp(sfx, 0, 1);
      if (finite(ambient)) v.ambient = clamp(ambient, 0, 1);
      if (finite(ui)) v.ui = clamp(ui, 0, 1);
      this._applyVolumes(0.04);
    } catch (e) { this._warn(e); }
  }

  /**
   * Listener pose (call every frame). Plain {x,y,z}; forward/up need not be normalised.
   * Uses listener AudioParams when available (Chromium), else setPosition/setOrientation (Firefox).
   */
  setListener(position, forward, up) {
    try {
      if (isVec(position)) this._lp = vec(position);
      const f = isVec(forward) ? vec(forward) : this._lf;
      let u = isVec(up) ? vec(up) : this._lu;
      const fl = Math.hypot(f.x, f.y, f.z);
      if (fl > 1e-6) this._lf = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
      // keep up orthogonal to forward (looking straight up/down would make the basis degenerate)
      const F = this._lf; const dp = u.x * F.x + u.y * F.y + u.z * F.z;
      u = { x: u.x - dp * F.x, y: u.y - dp * F.y, z: u.z - dp * F.z };
      const ul = Math.hypot(u.x, u.y, u.z);
      if (ul > 1e-4) this._lu = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
      this._applyListener();
    } catch (e) { this._warn(e); }
  }

  // ------------------------------------------------------------------ weapons

  /**
   * Gunshot. Local shots are unpanned, punchy and wide. Remote shots are delayed by distance/343 s
   * beyond 25 m, darkened by air absorption, gain from a custom distance curve, and cross-faded into
   * a dull "far" thump with rolling echo from ~130 m. Unknown profiles fall back by prefix.
   * @param {string} profile weapon `sound` profile (e.g. 'rifle556')
   * @param {{position?:{x,y,z}|null,isLocal?:boolean,suppressed?:boolean,indoor?:boolean}} [opts]
   */
  playGunshot(profile, { position = null, isLocal = false, suppressed = false, indoor = false } = {}) {
    try {
      if (!this._world()) return;
      const name = resolveGunProfile(profile); const P = GUN_PROFILES[name];
      const set = this._bank.gun[name];
      if (!set) return;
      const sup = !!suppressed;
      const jitterEq = () => [
        { type: 'highshelf', f: 3500, g: rnd(-1.5, 1.5) },
        { type: 'peaking', f: rnd(350, 1300), q: 1.2, g: rnd(-1.5, 1.5) },
      ];
      if (isLocal || !isVec(position)) {
        const buf = this._pick(sup ? set.s : set.n, `gun.${name}.${sup}`);
        this._voice(buf, {
          cat: 'gun', wide: true, gain: 0.9 * dbToGain(rnd(-0.8, 0.8)), rate: 1 + rnd(-0.015, 0.015), eq: jitterEq(),
          send: (indoor ? 0.12 : 0.42) * P.tail * (sup ? 0.4 : 1), sendIn: indoor ? 0.6 * (sup ? 0.45 : 1) : 0,
        });
        return;
      }
      const d = this._dist(position);
      if (sup && d > 450) return;
      const C = CATS.gun; const inv = pannerInverse(d, C);
      const when = this._ctx.currentTime + (d > 25 ? d / SPEED_OF_SOUND : 0);
      const g = dbToGain(curveDb(sup ? SUP_CURVE : GUN_CURVE, d)) * 0.85 * dbToGain(rnd(-1, 1));
      const lp = airLowpass(d) * (indoor ? 0.7 : 1);
      const farW = sup ? 0 : smoothstep(130, 420, d);
      const rate = 1 + rnd(-0.02, 0.02);
      const send = P.tail * (indoor ? 0.12 : 0.33) * Math.sqrt(1 + d / 120) * (sup ? 0.45 : 1);
      if (farW < 1) {
        const buf = this._pick(sup ? set.s : set.n, `gun.${name}.${sup}`);
        this._voice(buf, {
          cat: 'gun', pos: position, panner: C, when, rate, lp, eq: jitterEq(), hp: d > 8 ? 45 : 0,
          gain: (g * Math.cos(farW * Math.PI * 0.5)) / inv, send: send * inv, sendIn: indoor ? 0.45 * inv : 0,
        });
      }
      const far = this._bank.gunFar[P.far];
      if (farW > 0 && far) {
        this._voice(this._pick(far, `far.${P.far}`), {
          cat: 'gunFar', pos: position, panner: C, when, rate, lp: Math.max(lp, 900),
          gain: (g * Math.sin(farW * Math.PI * 0.5) * 1.1) / inv, send: send * 0.35 * inv,
        });
      }
    } catch (e) { this._warn(e); }
  }

  /**
   * Weapon handling / equipment foley ('mag_out', 'mag_in', 'charge', 'bolt_up', ... see MECH_NAMES).
   * @param {string} name
   * @param {{position?:{x,y,z}|null,isLocal?:boolean}} [opts]
   */
  playMechanical(name, { position = null, isLocal = true } = {}) {
    try {
      if (!this._world()) return;
      const buf = this._bank.mech[name];
      if (!buf) return;
      const rate = 1 + rnd(-0.035, 0.035);
      if (isLocal || !isVec(position)) {
        this._voice(buf, { cat: 'mech', gain: 0.55 * dbToGain(rnd(-1, 1)), rate });
        return;
      }
      const d = this._dist(position);
      if (d > CATS.mech.cull) return;
      this._voice(buf, { cat: 'mech', pos: position, panner: CATS.mech, gain: 0.75, rate, lp: airLowpass(d) });
    } catch (e) { this._warn(e); }
  }

  // ------------------------------------------------------------------ movement

  /**
   * Footstep on a surface ('grass','dirt','gravel','wood','concrete','metal','rock').
   * @param {string} surface
   * @param {{position?:{x,y,z}|null,isLocal?:boolean,sprinting?:boolean,crouched?:boolean}} [opts]
   */
  playFootstep(surface, { position = null, isLocal = false, sprinting = false, crouched = false } = {}) {
    try {
      if (!this._world()) return;
      const s = this._surface(surface, FOOT_ALIAS, this._bank.foot, 'dirt');
      const buf = this._pick(this._bank.foot[s], `foot.${s}`);
      const local = isLocal || !isVec(position);
      let gain = (local ? 0.3 : 0.62) * dbToGain(rnd(-1.5, 1.5));
      if (sprinting) gain *= 1.7;
      if (crouched) gain *= 0.38;
      const rate = (1 + rnd(-0.05, 0.05)) * (sprinting ? 1.04 : crouched ? 0.95 : 1);
      const eq = sprinting ? [{ type: 'highshelf', f: 3000, g: 2 }] : null;
      const lpCrouch = crouched ? 2400 : 0;
      if (local) {
        this._voice(buf, { cat: 'foot', gain, rate, lp: lpCrouch, eq });
        if (sprinting && Math.random() < 0.35) this._voice(this._pick(this._bank.gear, 'gear'), { cat: 'foot', gain: gain * 0.35, rate: rnd(0.95, 1.05) });
        return;
      }
      const d = this._dist(position);
      if (d > (sprinting ? 70 : crouched ? 25 : 50)) return;
      const lp = Math.min(lpCrouch || NYQ_SAFE, airLowpass(d) || NYQ_SAFE);
      this._voice(buf, { cat: 'foot', pos: position, panner: CATS.foot, gain, rate, lp: lp < NYQ_SAFE ? lp : 0, eq });
      if (sprinting && Math.random() < 0.35) this._voice(this._pick(this._bank.gear, 'gear'), { cat: 'foot', pos: position, panner: CATS.foot, gain: gain * 0.35 });
    } catch (e) { this._warn(e); }
  }

  /** Jump push-off (cloth, gear, scuff). @param {{position?:{x,y,z}|null,isLocal?:boolean}} [opts] */
  playJump({ position = null, isLocal = false } = {}) {
    try {
      if (!this._world()) return;
      const buf = this._pick(this._bank.jump, 'jump');
      if (isLocal || !isVec(position)) { this._voice(buf, { cat: 'body', gain: 0.4, rate: rnd(0.96, 1.04) }); return; }
      if (this._dist(position) > CATS.body.cull) return;
      this._voice(buf, { cat: 'body', pos: position, panner: CATS.body, gain: 0.6, rate: rnd(0.96, 1.04) });
    } catch (e) { this._warn(e); }
  }

  /**
   * Landing thud scaled by intensity (0..1), plus both feet on the surface.
   * @param {number} intensity
   * @param {{position?:{x,y,z}|null,isLocal?:boolean,surface?:string}} [opts]
   */
  playLand(intensity = 0.5, { position = null, isLocal = false, surface = 'dirt' } = {}) {
    try {
      if (!this._world()) return;
      const i = clamp(finite(intensity) ? intensity : 0.5, 0, 1);
      const local = isLocal || !isVec(position);
      if (!local && this._dist(position) > CATS.body.cull) return;
      const pos = local ? null : position;
      const base = local ? 0.5 : 0.7;
      this._voice(this._pick(this._bank.land, 'land'), {
        cat: 'body', pos, panner: CATS.body, gain: base * (0.2 + 0.8 * i), rate: rnd(0.95, 1.05) * (1.06 - 0.12 * i), lp: 1200 + 16000 * i,
      });
      const s = this._surface(surface, FOOT_ALIAS, this._bank.foot, 'dirt');
      const t = this._ctx.currentTime;
      for (let k = 0; k < 2; k++) {
        this._voice(this._pick(this._bank.foot[s], `foot.${s}`), {
          cat: 'foot', pos, panner: CATS.foot, when: t + k * rnd(0.015, 0.035), gain: (local ? 0.3 : 0.6) * (0.5 + 0.9 * i), rate: rnd(0.93, 1.02),
        });
      }
    } catch (e) { this._warn(e); }
  }

  // ------------------------------------------------------------------ bullets

  /**
   * Bullet impact ('dirt','grass','wood','metal','concrete','rock','flesh').
   * @param {string} surface
   * @param {{x,y,z}} position
   */
  playImpact(surface, position) {
    try {
      if (!this._world()) return;
      const s = this._surface(surface, IMPACT_ALIAS, this._bank.impact, 'dirt');
      const buf = this._pick(this._bank.impact[s], `impact.${s}`);
      const hard = s === 'metal' || s === 'concrete' || s === 'rock';
      if (!isVec(position)) { this._voice(buf, { cat: 'impact', gain: 0.5, rate: rnd(0.92, 1.08), send: hard ? 0.1 : 0.04 }); return; }
      const d = this._dist(position);
      if (d > CATS.impact.cull) return;
      this._voice(buf, {
        cat: 'impact', pos: position, panner: CATS.impact, gain: 0.85 * dbToGain(rnd(-1.5, 1.5)), rate: rnd(0.92, 1.08),
        lp: airLowpass(d), send: hard ? 0.12 : 0.05, when: this._ctx.currentTime + (d > 25 ? d / SPEED_OF_SOUND : 0),
      });
    } catch (e) { this._warn(e); }
  }

  /**
   * Bullet passing close to the listener: supersonic = sharp crack + zip, subsonic = whoosh.
   * @param {{x,y,z}} position closest point of the trajectory
   * @param {boolean} [supersonic=true]
   */
  playWhiz(position, supersonic = true) {
    try {
      if (!this._world()) return;
      const buf = this._pick(supersonic ? this._bank.whiz.super : this._bank.whiz.sub, `whiz.${!!supersonic}`);
      const o = { cat: 'whiz', gain: supersonic ? 1 : 0.6, rate: rnd(0.94, 1.06), send: supersonic ? 0.3 : 0.06 };
      if (isVec(position)) {
        if (this._dist(position) > CATS.whiz.cull) return;
        Object.assign(o, { pos: position, panner: CATS.whiz });
      }
      this._voice(buf, o);
    } catch (e) { this._warn(e); }
  }

  /**
   * Spent casing tinkling on the ground after a short fall delay ('rifle','pistol','shotgun','big').
   * @param {string} kind
   * @param {{x,y,z}} position
   */
  playShellCasing(kind, position) {
    try {
      if (!this._world() || kind === 'none') return;
      const k = this._bank.casing[kind] ? kind : 'rifle';
      const buf = this._pick(this._bank.casing[k], `casing.${k}`);
      const when = this._ctx.currentTime + rnd(0.32, 0.56);
      if (!isVec(position)) { this._voice(buf, { cat: 'casing', gain: 0.22, rate: rnd(0.92, 1.08), when }); return; }
      if (this._dist(position) > CATS.casing.cull) return;
      this._voice(buf, { cat: 'casing', pos: position, panner: CATS.casing, gain: 0.35, rate: rnd(0.92, 1.08), when });
    } catch (e) { this._warn(e); }
  }

  /** Hit confirmation ('hit' | 'head' | 'kill' | 'headkill'), UI bus. */
  playHitmarker(kind = 'hit') {
    try {
      if (!this._ready || this._disposed) return;
      const k = this._bank.hit[kind] ? kind : 'hit';
      const gain = { hit: 0.55, head: 0.65, kill: 0.7, headkill: 0.75 }[k];
      this._voice(this._bank.hit[k], { cat: 'ui', dest: this._uiIn, gain, rate: rnd(0.985, 1.015) });
    } catch (e) { this._warn(e); }
  }

  // ------------------------------------------------------------------ explosives

  /**
   * Frag grenade. `distance` overrides the listener distance. Closer than 12 m adds tinnitus and
   * briefly muffles the world.
   * @param {{x,y,z}} position
   * @param {{distance?:number}} [opts]
   */
  playExplosion(position, { distance } = {}) {
    try {
      if (!this._world()) return;
      const hasPos = isVec(position);
      const d = Math.max(0, finite(distance) ? distance : hasPos ? this._dist(position) : 15);
      const ctx = this._ctx; const C = CATS.expl;
      const when = ctx.currentTime + (d > 25 ? d / SPEED_OF_SOUND : 0);
      const inv = hasPos ? pannerInverse(this._dist(position), C) : 1;
      const g = dbToGain(curveDb(EXPL_CURVE, d)) * 0.95;
      const w = smoothstep(140, 450, d);
      const pos = hasPos ? position : null;
      const lp = airLowpass(d);
      const rate = rnd(0.95, 1.04);
      if (w < 1) {
        this._voice(this._pick(this._bank.explosion.near, 'expl.near'), {
          cat: 'expl', pos, panner: C, when, rate, lp, gain: (g * Math.cos(w * Math.PI * 0.5)) / inv, send: 0.45 * inv,
        });
      }
      if (w > 0) {
        this._voice(this._pick(this._bank.explosion.far, 'expl.far'), {
          cat: 'expl', pos, panner: C, when, rate, lp: lp ? Math.max(lp, 700) : 0, gain: (g * Math.sin(w * Math.PI * 0.5) * 1.15) / inv, send: 0.2 * inv,
        });
      }
      if (d < 12) this._earTrauma(when, 1 - d / 12);
    } catch (e) { this._warn(e); }
  }

  /** Smoke grenade hiss (~3 s). @param {{x,y,z}} position */
  playSmoke(position) {
    try {
      if (!this._world()) return;
      const o = { cat: 'smoke', gain: 0.7, rate: rnd(0.96, 1.04), send: 0.08 };
      if (isVec(position)) {
        if (this._dist(position) > CATS.smoke.cull) return;
        Object.assign(o, { pos: position, panner: CATS.smoke });
      }
      this._voice(this._bank.smoke, o);
    } catch (e) { this._warn(e); }
  }

  // ------------------------------------------------------------------ UI / body

  /** Interface sounds ('hover','click','back','error','spawn','match_start','match_end','countdown','killstreak','join','leave','chat'). */
  playUI(name) {
    try {
      if (!this._ready || this._disposed) return;
      const buf = this._bank.ui[name];
      if (!buf) return;
      const gain = { hover: 0.35, click: 0.6, back: 0.6, error: 0.6, spawn: 0.75, match_start: 0.85, match_end: 0.85,
        countdown: 0.6, killstreak: 0.7, join: 0.5, leave: 0.5, chat: 0.5 }[name] || 0.6;
      this._voice(buf, { cat: 'ui', dest: this._uiIn, gain });
    } catch (e) { this._warn(e); }
  }

  /** Body hit: heavy thump + muffled grunt (local) or a thwack + grunt (others). */
  playHurt(isLocal = true) {
    try {
      if (!this._world()) return;
      const buf = this._pick(isLocal ? this._bank.hurt.local : this._bank.hurt.remote, `hurt.${!!isLocal}`);
      if (isLocal) this._voice(buf, { cat: 'body', gain: 0.8, rate: rnd(0.95, 1.05) });
      else this._voice(buf, { cat: 'body', gain: 0.45, rate: rnd(0.92, 1.08), lp: 3500 });
    } catch (e) { this._warn(e); }
  }

  // ------------------------------------------------------------------ ambience

  /** Start an ambience preset: 'valley' | 'outpost' | 'alpine' (cross-fades from the current one). */
  startAmbient(preset) {
    try {
      const name = AMBIENT[preset] ? preset : 'valley';
      if (!this._ready) { this._pendingAmbient = name; return; }
      if (this._amb && this._amb.preset === name) return;
      this.stopAmbient();
      const ctx = this._ctx; const B = this._bank; const cfg = AMBIENT[name]; const t = ctx.currentTime;
      const amb = { preset: name, cfg, nodes: [], sources: [], bus: ctx.createGain(), timer: 0, nextGust: t + 0.5,
        nextBird: t + rnd(0.5, 2), nextRustle: t + rnd(1, 3), nextRock: t + rnd(8, 20), nextHowl: t, gust: 0.5 };
      amb.bus.gain.setValueAtTime(0, t);
      amb.bus.gain.setTargetAtTime(1, t, 0.6);
      amb.bus.connect(this._ambIn);
      const keep = (n) => { amb.nodes.push(n); return n; };
      // wind bed: two decorrelated reads of the seamless noise loop -> stereo
      const merger = keep(ctx.createChannelMerger(2));
      for (let c = 0; c < 2; c++) {
        const s = ctx.createBufferSource();
        s.buffer = B.wind; s.loop = true; s.playbackRate.value = c ? 0.93 : 1.07;
        s.connect(merger, 0, c);
        s.start(t, c ? B.wind.duration * 0.5 : 0);
        amb.sources.push(s); keep(s);
      }
      amb.windLp = keep(this._biquad('lowpass', cfg.windLp[0], -3.01));
      amb.windGain = keep(ctx.createGain()); amb.windGain.gain.value = cfg.windGain[0];
      merger.connect(amb.windLp); amb.windLp.connect(amb.windGain); amb.windGain.connect(amb.bus);
      if (cfg.howl) { // resonant howl bands + deep rumble driven by the same noise
        amb.howl = [0, 1, 2].map((k) => {
          const bp = keep(this._biquad('bandpass', 380 + k * 230, 14 + k * 4));
          const g = keep(ctx.createGain()); g.gain.value = 0;
          merger.connect(bp); bp.connect(g); g.connect(amb.bus);
          return { bp, g };
        });
        const rum = keep(this._biquad('lowpass', 140, -3.01)); const rg = keep(ctx.createGain()); rg.gain.value = 0.5;
        merger.connect(rum); rum.connect(rg); rg.connect(amb.bus);
        amb.rumble = rg;
      }
      if (cfg.insects && B.insects) {
        const im = keep(ctx.createChannelMerger(2));
        for (let c = 0; c < 2; c++) {
          const s = ctx.createBufferSource(); s.buffer = B.insects; s.loop = true;
          s.playbackRate.value = c ? 1.013 : 0.987;
          s.connect(im, 0, c); s.start(t, c ? B.insects.duration * 0.37 : 0);
          amb.sources.push(s); keep(s);
        }
        const ig = keep(ctx.createGain()); ig.gain.value = cfg.insects;
        const ihp = keep(this._biquad('highpass', 2500, -3.01));
        im.connect(ihp); ihp.connect(ig); ig.connect(amb.bus);
      }
      amb.timer = setInterval(() => this._ambTick(), 200);
      this._amb = amb;
      this._ambTick();
    } catch (e) { this._warn(e); }
  }

  /** Fade out and stop the current ambience. */
  stopAmbient() {
    try {
      this._pendingAmbient = null;
      const amb = this._amb;
      if (!amb || !this._ctx) return;
      this._amb = null;
      clearInterval(amb.timer);
      const t = this._ctx.currentTime;
      amb.bus.gain.cancelScheduledValues(t);
      amb.bus.gain.setValueAtTime(amb.bus.gain.value, t);
      amb.bus.gain.setTargetAtTime(0, t, 0.35);
      for (const s of amb.sources) { try { s.stop(t + 2.5); } catch { /* already stopped */ } }
      setTimeout(() => {
        for (const n of amb.nodes) { try { n.disconnect(); } catch { /* ignore */ } }
        try { amb.bus.disconnect(); } catch { /* ignore */ }
      }, 2700);
    } catch (e) { this._warn(e); }
  }

  _ambTick() {
    const amb = this._amb; const ctx = this._ctx;
    if (!amb || !ctx || this._paused || ctx.state !== 'running') return;
    const t = ctx.currentTime; const cfg = amb.cfg; const B = this._bank;
    if (t >= amb.nextGust) { // gusts: wind level and brightness drift to a new random target
      const s = Math.pow(Math.random(), cfg.howl ? 0.7 : 1.3); amb.gust = s;
      const tc = rnd(0.5, 1.8);
      amb.windGain.gain.setTargetAtTime(cfg.windGain[0] + (cfg.windGain[1] - cfg.windGain[0]) * s, t, tc);
      amb.windLp.frequency.setTargetAtTime(cfg.windLp[0] * Math.pow(cfg.windLp[1] / cfg.windLp[0], s), t, tc);
      if (amb.howl) {
        amb.howl.forEach((h, k) => {
          h.g.gain.setTargetAtTime((0.9 + k * 0.35) * s * s * rnd(0.6, 1.2), t, tc * 1.3);
          h.bp.frequency.setTargetAtTime(rnd(320, 980) * (1 + k * 0.25), t, rnd(1, 2.5));
        });
        amb.rumble.gain.setTargetAtTime(0.35 + 0.5 * s, t, tc);
      }
      amb.nextGust = t + rnd(cfg.gust[0], cfg.gust[1]);
    }
    if (cfg.birds && t + 0.3 >= amb.nextBird) {
      const species = this._weighted(cfg.species);
      const pos = this._aroundListener(rnd(12, 70), rnd(3, 14));
      const lvl = rnd(0.12, 0.4);
      this._bird(Math.max(t, amb.nextBird), species, pos, lvl);
      if (Math.random() < 0.3) this._bird(amb.nextBird + rnd(0.8, 2), species, this._aroundListener(rnd(15, 70), rnd(3, 14)), lvl * rnd(0.6, 1));
      amb.nextBird = t + rnd(cfg.birds[0], cfg.birds[1]);
    }
    if (cfg.rustle && t + 0.3 >= amb.nextRustle && B.rustle.length) {
      const pos = this._aroundListener(rnd(6, 28), rnd(1, 7));
      this._voice(this._pick(B.rustle, 'rustle'), { cat: 'amb', dest: amb.bus, pos, panner: CATS.amb, gain: (0.12 + 0.3 * amb.gust) * rnd(0.6, 1.1), rate: rnd(0.85, 1.15) });
      amb.nextRustle = t + rnd(cfg.rustle[0], cfg.rustle[1]) * (1.3 - 0.6 * amb.gust);
    }
    if (cfg.rockfall && t >= amb.nextRock && B.rockfall.length) {
      const d = rnd(160, 520); const pos = this._aroundListener(d, rnd(20, 120));
      this._voice(this._pick(B.rockfall, 'rock'), { cat: 'amb', dest: amb.bus, pos, panner: CATS.amb, gain: rnd(0.35, 0.6) * (CATS.amb.ref / d) * 25, rate: rnd(0.85, 1.1), lp: airLowpass(d) });
      amb.nextRock = t + rnd(cfg.rockfall[0], cfg.rockfall[1]);
    }
  }

  /** One procedural bird phrase: FM sine sweeps scheduled on a carrier oscillator. */
  _bird(t, species, pos, level) {
    const ctx = this._ctx; const amb = this._amb;
    if (!amb) return;
    const car = ctx.createOscillator(); const mod = ctx.createOscillator(); const modG = ctx.createGain();
    const env = ctx.createGain(); env.gain.value = 0;
    mod.connect(modG); modG.connect(car.frequency); car.connect(env);
    const notes = [];
    const pitch = rnd(0.9, 1.12);
    switch (species) {
      case 0: { // warbler trill
        const n = Math.round(rnd(8, 14)); let dt = 0; const sp = rnd(0.06, 0.08);
        for (let i = 0; i < n; i++) { notes.push([dt, 0.045, 5200, 4200, 1 - i / (n * 1.6), 0, 0]); dt += sp * (1 - i * 0.012); }
        break;
      }
      case 1: // two-tone whistle
        notes.push([0, 0.28, 3900, 3750, 1, 7, 35], [0.38, 0.32, 3250, 3120, 0.85, 7, 30]);
        break;
      case 2: { // "tsip" chirp series
        const n = Math.round(rnd(3, 6)); let dt = 0;
        for (let i = 0; i < n; i++) { notes.push([dt, 0.03, 3000, 6400, 1, 0, 0]); dt += rnd(0.17, 0.27); }
        break;
      }
      case 3: { // rich FM warble
        const n = Math.round(rnd(6, 10)); let dt = 0;
        for (let i = 0; i < n; i++) {
          const f = rnd(2500, 5000); const d = rnd(0.06, 0.12);
          notes.push([dt, d, f, f * rnd(0.85, 1.15), rnd(0.6, 1), rnd(40, 90), rnd(200, 600)]); dt += d + rnd(0.015, 0.04);
        }
        break;
      }
      default: // distant dove "coo"
        for (let i = 0; i < 3; i++) notes.push([i * 0.55, 0.36, 560, 500, i === 1 ? 1 : 0.8, 6, 8]);
        level *= 1.6;
        break;
    }
    let end = t;
    for (const [dt, dur, f0, f1, a, fmR, fmD] of notes) {
      const s = t + dt; const e = s + dur;
      car.frequency.setValueAtTime(f0 * pitch, s);
      car.frequency.exponentialRampToValueAtTime(f1 * pitch, e);
      mod.frequency.setValueAtTime(fmR || 1, s);
      modG.gain.setValueAtTime(fmD || 0, s);
      env.gain.setValueAtTime(0, s);
      env.gain.linearRampToValueAtTime(a * level, s + Math.min(0.012, dur * 0.3));
      env.gain.setValueAtTime(a * level, e - Math.min(0.015, dur * 0.3));
      env.gain.linearRampToValueAtTime(0, e);
      end = e;
    }
    const hp = this._biquad('highpass', species === 4 ? 250 : 1500, -3.01);
    const pn = this._panner(pos, CATS.amb);
    env.connect(hp); hp.connect(pn); pn.connect(amb.bus);
    car.start(t); mod.start(t); car.stop(end + 0.05); mod.stop(end + 0.05);
    const hrtf = pn.panningModel === 'HRTF';
    car.onended = () => {
      for (const n of [car, mod, modG, env, hp, pn]) { try { n.disconnect(); } catch { /* ignore */ } }
      if (hrtf) this._hrtf = Math.max(0, this._hrtf - 1);
    };
  }

  // ------------------------------------------------------------------ health

  /** Low-health effect 0..1: heartbeat loop (rate/level rise) + low-pass muffling of the world. */
  setLowHealth(intensity) {
    try {
      const i = clamp(finite(intensity) ? intensity : 0, 0, 1);
      this._lowHealth = i;
      if (!this._ctx || !this._lhFilter) return;
      const f = i <= 0.001 ? this._nyq() : 14000 * Math.pow(650 / 14000, Math.pow(i, 1.1));
      this._lhFilter.frequency.setTargetAtTime(Math.min(f, this._nyq()), this._ctx.currentTime, 0.25);
      if (i > 0.02 && this._ready) {
        if (!this._heartTimer) { this._nextBeat = 0; this._heartTimer = setInterval(() => this._heartTick(), 90); this._heartTick(); }
      } else this._stopHeart();
    } catch (e) { this._warn(e); }
  }

  _heartTick() {
    const ctx = this._ctx; const i = this._lowHealth;
    if (!ctx || !this._bank || this._paused || ctx.state !== 'running' || i <= 0.02) return;
    const now = ctx.currentTime;
    if (this._nextBeat < now) this._nextBeat = now + 0.03;
    while (this._nextBeat < now + 0.25) {
      this._voice(this._bank.heart, { cat: 'ear', dest: this._earIn, gain: 0.3 + 0.7 * i, when: this._nextBeat, rate: 1 + 0.08 * i });
      this._nextBeat += 60 / (62 + 58 * i);
    }
  }

  _stopHeart() {
    if (this._heartTimer) { clearInterval(this._heartTimer); this._heartTimer = 0; }
  }

  /** Near-explosion ear trauma: tinnitus tone + world muffle and duck, recovering over ~3 s. */
  _earTrauma(t, m) {
    const ctx = this._ctx;
    const f = this._exFilter.frequency;
    f.setTargetAtTime(2600 * Math.pow(320 / 2600, m), t, 0.006);
    f.setTargetAtTime(this._nyq(), t + 0.35 + 0.5 * m, 0.9 + 0.5 * m);
    const dg = this._duck.gain;
    dg.setTargetAtTime(1 - 0.55 * m, t, 0.008);
    dg.setTargetAtTime(1, t + 0.3 + 0.4 * m, 0.8);
    if (this._tinnitus) { try { this._tinnitus.stop(); } catch { /* ignore */ } }
    const freq = rnd(3800, 4400);
    const o1 = ctx.createOscillator(); const o2 = ctx.createOscillator(); const g = ctx.createGain();
    o1.frequency.value = freq; o2.frequency.value = freq * 1.0016;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05 * m + 0.012, t + 0.05);
    g.gain.setTargetAtTime(0, t + 0.3, 0.85);
    o1.connect(g); o2.connect(g); g.connect(this._earIn);
    o1.start(t); o2.start(t); o1.stop(t + 4.5); o2.stop(t + 4.5);
    o1.onended = () => { for (const n of [o1, o2, g]) { try { n.disconnect(); } catch { /* ignore */ } } };
    this._tinnitus = { stop: () => { const n = ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setTargetAtTime(0, n, 0.02); } };
  }

  // ------------------------------------------------------------------ internals: graph

  _buildGraph() {
    const ctx = this._ctx;
    const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    // master chain: limiter-style compressor -> trim -> soft clipper (absolute ceiling)
    this._master = gain(1);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.18;
    const trim = gain(0.8); const clipIn = gain(0.5); const clip = ctx.createWaveShaper(); const clipOut = gain(2);
    clip.curve = softClipCurve(); clip.oversample = 'none';
    this._master.connect(comp); comp.connect(trim); trim.connect(clipIn); clipIn.connect(clip); clip.connect(clipOut);
    clipOut.connect(ctx.destination);
    this._comp = comp; this._out = clipOut;
    // world (sfx + ambience) -> low-health LPF -> explosion LPF -> duck -> pause -> master
    const world = gain(1);
    this._lhFilter = this._biquad('lowpass', this._nyq(), -3.01);
    this._exFilter = this._biquad('lowpass', this._nyq(), -3.01);
    this._duck = gain(1); this._pauseGain = gain(this._paused ? 0 : 1);
    world.connect(this._lhFilter); this._lhFilter.connect(this._exFilter); this._exFilter.connect(this._duck);
    this._duck.connect(this._pauseGain); this._pauseGain.connect(this._master);
    this._worldBus = world;
    this._sfxIn = gain(1); this._sfxIn.connect(world);
    this._ambIn = gain(1); this._ambIn.connect(world);
    this._uiIn = gain(1); this._uiIn.connect(this._master);
    this._earIn = gain(1); this._earIn.connect(this._master);
    // local "wide" bus: mid + decorrelated, high-passed side signal (Lauridsen pseudo-stereo)
    this._localIn = gain(1); this._localIn.connect(this._sfxIn);
    const sideHp = this._biquad('highpass', 1100, -3.01); const sideDelay = ctx.createDelay(0.05);
    sideDelay.delayTime.value = 0.0085;
    const sL = gain(0.32); const sR = gain(-0.32); const merger = ctx.createChannelMerger(2);
    this._localIn.connect(sideHp); sideHp.connect(sideDelay); sideDelay.connect(sL); sideDelay.connect(sR);
    sL.connect(merger, 0, 0); sR.connect(merger, 0, 1); merger.connect(this._sfxIn);
    // reverb sends (buffers assigned once the bank's impulse responses exist)
    this._sendOut = gain(1); this._convOut = ctx.createConvolver(); this._convOut.normalize = false;
    this._sendIn = gain(1); this._convIn = ctx.createConvolver(); this._convIn.normalize = false;
    this._sendOut.connect(this._convOut); this._convOut.connect(this._sfxIn);
    this._sendIn.connect(this._convIn); this._convIn.connect(this._sfxIn);
  }

  _applyVolumes(tc = 0.04) {
    const ctx = this._ctx;
    if (!ctx || !this._master) return;
    const t = ctx.currentTime; const v = this._vol;
    const set = (node, val) => { if (tc > 0) node.gain.setTargetAtTime(val, t, tc); else node.gain.value = val; };
    set(this._master, taper(v.master));
    set(this._sfxIn, taper(v.sfx));
    set(this._earIn, taper(v.sfx));
    set(this._ambIn, taper(v.ambient));
    set(this._uiIn, taper(v.ui));
  }

  _applyListener() {
    const ctx = this._ctx;
    if (!ctx) return;
    const L = ctx.listener; const p = this._lp; const f = this._lf; const u = this._lu;
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
      L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
    } else {
      if (L.setPosition) L.setPosition(p.x, p.y, p.z);
      if (L.setOrientation) L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  _installUnlock() {
    if (typeof window === 'undefined' || this._unlock) return;
    const fn = () => {
      const ctx = this._ctx;
      if (!ctx || this._disposed) return;
      if (ctx.state === 'suspended' && !this._paused) ctx.resume().then(() => { if (ctx.state === 'running') this._removeUnlock(); }).catch(() => {});
      else if (ctx.state === 'running') this._removeUnlock();
    };
    this._unlock = fn;
    for (const e of ['pointerdown', 'keydown', 'touchend', 'mousedown']) window.addEventListener(e, fn, { capture: true, passive: true });
  }

  _removeUnlock() {
    if (!this._unlock || typeof window === 'undefined') return;
    for (const e of ['pointerdown', 'keydown', 'touchend', 'mousedown']) window.removeEventListener(e, this._unlock, { capture: true });
    this._unlock = null;
  }

  // ------------------------------------------------------------------ internals: voices

  /** World sounds play only when ready and not paused. */
  _world() { return this._ready && !this._disposed && !this._paused && !!this._ctx; }

  _nyq() { return Math.min(NYQ_SAFE, (this._ctx ? this._ctx.sampleRate : 44100) * 0.45); }

  _biquad(type, f, q, g = 0) {
    const n = this._ctx.createBiquadFilter();
    n.type = type; n.frequency.value = clamp(f, 10, this._nyq()); n.Q.value = q; n.gain.value = g;
    return n;
  }

  _panner(pos, c) {
    const pn = this._ctx.createPanner();
    const hrtf = this._hrtf < MAX_HRTF;
    pn.panningModel = hrtf ? 'HRTF' : 'equalpower';
    if (hrtf) this._hrtf++;
    pn.distanceModel = 'inverse';
    pn.refDistance = c.ref; pn.rolloffFactor = c.rolloff; pn.maxDistance = 10000;
    const p = vec(pos);
    if (pn.positionX) { pn.positionX.value = p.x; pn.positionY.value = p.y; pn.positionZ.value = p.z; } else pn.setPosition(p.x, p.y, p.z);
    return pn;
  }

  _dist(p) {
    const q = vec(p); const l = this._lp;
    return Math.hypot(q.x - l.x, q.y - l.y, q.z - l.z);
  }

  _aroundListener(dist, height) {
    const a = Math.random() * Math.PI * 2; const l = this._lp;
    return { x: l.x + Math.cos(a) * dist, y: l.y + height, z: l.z + Math.sin(a) * dist };
  }

  _weighted(weights) {
    let sum = 0; for (const w of weights) sum += w;
    let r = Math.random() * sum;
    for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
    return weights.length - 1;
  }

  _surface(name, alias, table, def) {
    const s = String(name || '').toLowerCase();
    if (table[s] && table[s].length) return s;
    const a = alias[s];
    return a && table[a] ? a : def;
  }

  /** Random variant, never the same one twice in a row. */
  _pick(arr, key) {
    if (!arr) return null;
    const list = arr.filter(Boolean);
    if (list.length <= 1) return list[0] || null;
    let i = Math.floor(Math.random() * list.length);
    if (i === this._lastPick.get(key)) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
    this._lastPick.set(key, i);
    return list[i];
  }

  /**
   * Start one voice: source -> [hp] -> [lp] -> [eq] -> gain -> [panner] -> bus, + reverb sends.
   * Enforces per-category caps and the global voice limit by stealing the oldest voice.
   */
  _voice(buf, o) {
    const ctx = this._ctx;
    if (!ctx || !buf) return null;
    const cat = o.cat || 'misc'; const C = CATS[cat] || { cap: 16 };
    let n = 0; let oldest = null;
    for (const v of this._voices) if (v.cat === cat) { n++; if (!oldest) oldest = v; }
    if (n >= C.cap && oldest) this._steal(oldest);
    while (this._voices.length >= MAX_VOICES) this._steal(this._voices[0]);
    const t = Math.max(ctx.currentTime, o.when || 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (o.rate && o.rate !== 1) src.playbackRate.value = o.rate;
    const nodes = [src]; let head = src;
    const link = (node) => { head.connect(node); head = node; nodes.push(node); };
    if (o.hp) link(this._biquad('highpass', o.hp, -3.01));
    if (o.lp && o.lp < this._nyq()) link(this._biquad('lowpass', o.lp, -3.01));
    if (o.eq) for (const e of o.eq) link(this._biquad(e.type, e.f, e.q || 0.707, e.g || 0));
    const g = ctx.createGain(); g.gain.value = finite(o.gain) ? o.gain : 1; link(g);
    let hrtf = false;
    if (o.pos) {
      const pn = this._panner(o.pos, o.panner || C);
      hrtf = pn.panningModel === 'HRTF';
      link(pn);
    }
    head.connect(o.pos ? (o.dest || this._sfxIn) : o.wide ? this._localIn : (o.dest || this._sfxIn));
    if (o.send > 0) { const s = ctx.createGain(); s.gain.value = o.send; g.connect(s); s.connect(this._sendOut); nodes.push(s); }
    if (o.sendIn > 0) { const s = ctx.createGain(); s.gain.value = o.sendIn; g.connect(s); s.connect(this._sendIn); nodes.push(s); }
    const v = { src, nodes, gain: g, cat, hrtf, done: false };
    src.onended = () => this._release(v);
    src.start(t);
    this._voices.push(v);
    return v;
  }

  _steal(v) {
    const i = this._voices.indexOf(v);
    if (i >= 0) this._voices.splice(i, 1);
    try {
      const t = this._ctx.currentTime;
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0, t + 0.015);
      v.src.stop(t + 0.02);
    } catch { /* not started yet / already stopped */ }
    setTimeout(() => this._release(v), 80);
  }

  _release(v) {
    if (v.done) return;
    v.done = true;
    const i = this._voices.indexOf(v);
    if (i >= 0) this._voices.splice(i, 1);
    if (v.hrtf) this._hrtf = Math.max(0, this._hrtf - 1);
    for (const n of v.nodes) { try { n.disconnect(); } catch { /* ignore */ } }
  }

  _warn(e) {
    if (!this._warned) { this._warned = 0; }
    if (this._warned++ < 5) console.warn('[audio]', e);
  }
}

/** Name tables, handy for UIs and tests. */
export const AUDIO_NAMES = {
  gunProfiles: Object.keys(GUN_PROFILES), mechanical: MECH_NAMES, footsteps: FOOT_SURFACES, impacts: IMPACT_SURFACES,
  casings: CASING_KINDS, hitmarkers: HITMARKER_KINDS, ui: UI_NAMES, ambient: AMBIENT_PRESETS,
};
