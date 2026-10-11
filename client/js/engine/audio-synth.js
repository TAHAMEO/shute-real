// Procedural sound synthesis for the SHUTE REAL audio engine (no assets, no Three.js).
//
// Layer signals (noise bursts, Friedlander blast pulses, pitched thumps, modal metal hits,
// grain clouds, glottal pulses, impulse responses) are generated with small JS DSP routines.
// Every sound is then mixed, filtered, saturated and/or convolved in its own short
// OfflineAudioContext. Contexts are rendered a few at a time in parallel (each renders on its
// own audio thread), and the main thread yields between items, so building the whole bank
// never blocks for more than a few milliseconds at a time.

const TAU = Math.PI * 2;
const DENORM = 1e-20;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(1e-12, Math.abs(g)));
const qdb = (q) => 20 * Math.log10(q); // traditional Q -> Web Audio lowpass/highpass resonance (dB)
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ------------------------------------------------------------------------------ randomness

/** FNV-1a string hash (seed source). */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small seeded PRNG (mulberry32) with helpers. */
export class Rng {
  constructor(seed = 1) { this.s = (seed >>> 0) || 1; }
  f() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  bi() { return this.f() * 2 - 1; }
  range(a, b) { return a + (b - a) * this.f(); }
  /** v jittered by +-amt (relative). */
  j(v, amt = 0.05) { return v * (1 + this.bi() * amt); }
  int(a, b) { return a + Math.floor(this.f() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.f() * arr.length) % arr.length]; }
  bool(p = 0.5) { return this.f() < p; }
}

// ------------------------------------------------------------------------------ JS DSP

export function white(n, rng) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = rng.f() * 2 - 1;
  return a;
}

/** RBJ biquad coefficients [b0, b1, b2, a1, a2]; q is a traditional Q (shelves: slope-ish). */
export function coefs(type, f, q, sr, gainDb = 0) {
  const w0 = (TAU * clamp(f, 5, sr * 0.49)) / sr;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * Math.max(0.05, q));
  const A = Math.pow(10, gainDb / 40);
  let b0; let b1; let b2; let a0; let a1; let a2;
  switch (type) {
    case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'peaking':
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cw + s); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s);
      a0 = A + 1 + (A - 1) * cw + s; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s; break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s);
      a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s; break;
    }
    default: return [1, 0, 0, 0, 0];
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** Static biquad, in place. */
export function biquad(x, type, f, q, sr, gainDb = 0) {
  const c = coefs(type, f, q, sr, gainDb);
  const b0 = c[0]; const b1 = c[1]; const b2 = c[2]; const a1 = c[3]; const a2 = c[4];
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const xi = x[i] + DENORM; // tiny offset keeps the recursion out of (very slow) denormal range
    const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}

/** Time-varying biquad (coefficients refreshed every 32 samples); fAt(u) gives Hz for u in 0..1. */
export function biquadSweep(x, type, fAt, q, sr) {
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0; let c = null;
  const n = x.length;
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) c = coefs(type, fAt(i / n), q, sr);
    const xi = x[i] + DENORM;
    const y = c[0] * xi + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}

export function peakOf(x) {
  let m = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; }
  return m;
}

export function normPeak(x, peak = 1) {
  const m = peakOf(x);
  if (m > 1e-12) { const k = peak / m; for (let i = 0; i < x.length; i++) x[i] *= k; }
  return x;
}

/** dst[off + i] += src[i] * gain. */
export function mixInto(dst, src, gain = 1, off = 0) {
  const n = Math.min(src.length, dst.length - off);
  for (let i = 0; i < n; i++) dst[off + i] += src[i] * gain;
  return dst;
}

/** Exponential-approach curve from a to b with time constant tau (in units of u). */
const expTo = (a, b, tau) => (u) => b + (a - b) * Math.exp(-u / tau);
/** Log-linear sweep from a to b. */
const logSweep = (a, b) => (u) => a * Math.pow(b / a, u);

/**
 * Sample-rate bound DSP helper used by the recipes. All times in seconds, amplitudes linear.
 */
export class Synth {
  constructor(sr, rng) { this.sr = sr; this.rng = rng; }
  n(t) { return Math.max(1, Math.ceil(t * this.sr)); }
  idx(t) { return Math.max(0, Math.round(t * this.sr)); }
  buf(t) { return new Float32Array(this.n(t)); }
  filt(x, type, f, q = 0.707, g = 0) { return biquad(x, type, f, q, this.sr, g); }

  /** In-place linear-attack / hold / exponential-decay envelope starting at sample i0. */
  env(x, attack, decay, hold = 0, i0 = 0) {
    const a = attack * this.sr; const h = hold * this.sr;
    const k = Math.exp(-1 / Math.max(1, decay * this.sr));
    let g = 1;
    for (let i = 0; i < Math.min(i0, x.length); i++) x[i] = 0;
    for (let i = i0; i < x.length; i++) {
      const n = i - i0;
      if (n < a) x[i] *= n / a;
      else if (n >= a + h) { x[i] *= g; g *= k; if (g < 1e-9) g = 0; }
    }
    return x;
  }

  /** Filtered white-noise burst with envelope, normalised to peak 1. filters: [[type, f, q?, gainDb?]]. */
  noise(dur, { attack = 0.0005, decay = 0.05, hold = 0, filters = [] } = {}) {
    const x = white(this.n(dur), this.rng);
    for (const [type, f, q = 0.707, g = 0] of filters) this.filt(x, type, f, q, g);
    this.env(x, attack, decay, hold);
    return normPeak(x);
  }

  addNoise(x, t0, amp, opts) {
    const y = this.noise(opts.dur || Math.min(1, (opts.decay || 0.05) * 7 + (opts.attack || 0) + (opts.hold || 0)), opts);
    return mixInto(x, y, amp, this.idx(t0));
  }

  /** Friedlander blast-wave pulse: instant rise, positive phase of length T then a negative phase. */
  friedlander(x, t0, T, amp = 1, b = 1.6) {
    const i0 = this.idx(t0); const n = Math.ceil(T * 7 * this.sr); const ts = T * this.sr;
    for (let k = 0; k < n && i0 + k < x.length; k++) {
      const u = k / ts;
      x[i0 + k] += amp * (1 - u) * Math.exp(-b * u);
    }
    return x;
  }

  /** Pitched thump: sine whose frequency glides exponentially f0 -> f1 (time constant drop). */
  sweep(x, t0, { f0, f1, drop = 0.04, attack = 0.001, decay = 0.08, amp = 1, drive = 0 }) {
    const sr = this.sr; const i0 = this.idx(t0);
    const n = Math.min(x.length - i0, Math.ceil((attack + decay * 8) * sr));
    if (n <= 0) return x;
    const k = Math.exp(-1 / Math.max(1, decay * sr)); const kd = Math.exp(-16 / Math.max(1, drop * sr));
    const na = Math.max(1, attack * sr); const norm = drive ? 1 / tanhA(drive) : 1;
    // phasor rotation; the rotation step (frequency) is refreshed every 16 samples
    let re = 1; let im = 0; let cw = 1; let sw = 0; let g = 1; let fd = f0 - f1;
    for (let i = 0; i < n; i++) {
      if ((i & 15) === 0) { const w = (TAU * (f1 + fd)) / sr; cw = Math.cos(w); sw = Math.sin(w); fd *= kd; }
      const t = re * cw - im * sw; im = re * sw + im * cw; re = t;
      const v = drive ? tanhA(drive * im) * norm : im;
      let e;
      if (i < na) e = i / na; else { e = g; g *= k; }
      x[i0 + i] += amp * v * e;
    }
    return x;
  }

  /** Exponentially decaying sinusoid (one mode of a struck object). */
  mode(x, t0, f, decay, amp, phase = 0) {
    const sr = this.sr;
    if (f >= sr * 0.47 || f <= 0) return x;
    const i0 = this.idx(t0); const n = Math.min(x.length - i0, Math.ceil(decay * 7 * sr));
    const w = (TAU * f) / sr; const cw = Math.cos(w); const sw = Math.sin(w); const r = Math.exp(-1 / Math.max(1, decay * sr));
    let re = Math.cos(phase); let im = Math.sin(phase); let a = amp;
    for (let i = 0; i < n; i++) {
      x[i0 + i] += a * im;
      const t = re * cw - im * sw; im = re * sw + im * cw; re = t; a *= r;
    }
    return x;
  }

  /** Tiny broadband contact click (differentiated noise, fast decay). */
  tick(x, t0, amp, decay = 0.0006) {
    const i0 = this.idx(t0); const n = Math.ceil(decay * 8 * this.sr); const k = Math.exp(-1 / Math.max(1, decay * this.sr));
    let prev = 0; let g = amp;
    for (let i = 0; i < n && i0 + i < x.length; i++) {
      const w = this.rng.bi();
      x[i0 + i] += (w - prev) * 0.5 * g;
      prev = w; g *= k;
    }
    return x;
  }

  /**
   * Struck metal (modal synthesis): inharmonic modes around f + contact click + optional low thump.
   */
  hit(x, t0, { f = 2500, decay = 0.015, amp = 1, modes = 5, spread = 0.08, tilt = 0.72, noise = 0.6, noiseDecay = 0.0007,
    low = 0, lowF = 400, lowDecay = 0.012, ratios = METAL_RATIOS } = {}) {
    const r = this.rng;
    for (let k = 0; k < modes; k++) {
      const fk = f * ratios[k % ratios.length] * (1 + r.bi() * spread);
      const dk = decay * Math.pow(0.82, k) * r.range(0.75, 1.25);
      this.mode(x, t0, fk, dk, amp * Math.pow(tilt, k) * r.range(0.55, 1), r.f() * TAU);
    }
    if (noise) this.tick(x, t0, amp * noise * 1.6, noiseDecay);
    if (low) this.sweep(x, t0, { f0: lowF * 1.5, f1: lowF, drop: lowDecay * 0.6, attack: 0.0004, decay: lowDecay, amp: amp * low });
    return x;
  }

  /** Smooth random modulation signal in -1..1 (cosine-interpolated random points at rate Hz). */
  smooth(n, rate) {
    const out = new Float32Array(n); const step = Math.max(1, this.sr / rate); const inv = 1 / step;
    let a = this.rng.bi(); let b = this.rng.bi(); let pos = 0;
    for (let i = 0; i < n; i++) {
      const u = pos * inv;
      out[i] = a + (b - a) * u * u * (3 - 2 * u);
      if (++pos >= step) { pos -= step; a = b; b = this.rng.bi(); }
    }
    return out;
  }

  /** Cloud of tiny resonant grains (gravel, debris, leaves, links...). */
  grains(x, { t0 = 0, dur = 0.1, count = 30, fLo = 1500, fHi = 6000, dLo = 0.002, dHi = 0.008, amp = 1, skew = 1.4,
    ampSkew = 2, fade = 0.7, modes = 2, noise = 0.4 } = {}) {
    const r = this.rng;
    for (let i = 0; i < count; i++) {
      const u = Math.pow(r.f(), skew);
      const t = t0 + u * dur;
      const a = amp * Math.pow(r.f(), ampSkew) * (1 - fade * u);
      const f = fLo * Math.pow(fHi / fLo, r.f());
      const d = r.range(dLo, dHi);
      this.mode(x, t, f, d, a, r.f() * TAU);
      if (modes > 1) this.mode(x, t, f * r.range(1.45, 2.5), d * 0.6, a * 0.55, r.f() * TAU);
      if (noise) this.tick(x, t, a * noise, 0.0003);
    }
    return x;
  }

  /** Friction / sliding metal: band-limited noise with rough amplitude modulation. */
  slide(x, t0, dur, { f = 2500, f1 = f, q = 0.9, amp = 0.4, rough = 0.6, rate = 90 } = {}) {
    const i0 = this.idx(t0); const n = Math.min(x.length - i0, this.n(dur));
    if (n <= 8) return x;
    const w = white(n, this.rng);
    biquadSweep(w, 'bandpass', logSweep(f, f1), q, this.sr);
    normPeak(w);
    const m = this.smooth(n, rate);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const e = Math.min(1, u / 0.15) * Math.min(1, (1 - u) / 0.3);
      x[i0 + i] += w[i] * e * (1 - rough + rough * Math.min(1, Math.abs(m[i]) * 1.8)) * amp;
    }
    return x;
  }

  /** Cloth / gear rustle: crinkly band-passed noise with a bell envelope. */
  rustle(x, t0, dur, amp, { f = 2200, q = 0.6, crinkle = 0.75, rate = 28 } = {}) {
    const i0 = this.idx(t0); const n = Math.min(x.length - i0, this.n(dur));
    if (n <= 8) return x;
    const w = white(n, this.rng);
    biquad(w, 'bandpass', f, q, this.sr);
    biquad(w, 'highpass', 500, 0.707, this.sr);
    normPeak(w);
    const m1 = this.smooth(n, rate); const m2 = this.smooth(n, rate * 3.3);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const e = Math.pow(Math.sin(Math.PI * u), 1.3);
      const c = Math.min(1.5, Math.abs(m1[i]) * Math.abs(m2[i]) * 4);
      x[i0 + i] += w[i] * e * (1 - crinkle + crinkle * c) * amp;
    }
    return x;
  }

  /** Air whoosh: noise through a moving band-pass (f0 -> fMid -> f1), swelling envelope. */
  whoosh(x, t0, dur, { f0 = 300, fMid = 900, f1 = 500, q = 1.2, amp = 0.5, peakAt = 0.45 } = {}) {
    const i0 = this.idx(t0); const n = Math.min(x.length - i0, this.n(dur));
    if (n <= 8) return x;
    const w = white(n, this.rng);
    const fAt = (u) => (u < peakAt ? f0 * Math.pow(fMid / f0, u / peakAt) : fMid * Math.pow(f1 / fMid, (u - peakAt) / (1 - peakAt)));
    biquadSweep(w, 'bandpass', fAt, q, this.sr);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const e = u < peakAt ? Math.sin((0.5 * Math.PI * u) / peakAt) : Math.pow(Math.cos((0.5 * Math.PI * (u - peakAt)) / (1 - peakAt)), 1.6);
      w[i] *= e * Math.sqrt(1000 / fAt(u)); // keep level roughly constant across the sweep
    }
    normPeak(w);
    return mixInto(x, w, amp, i0);
  }

  /** Low soft-impact thump. */
  thud(x, t0, f, decay, amp) {
    return this.sweep(x, t0, { f0: f * 1.7, f1: f, drop: decay * 0.5, attack: 0.0015, decay, amp, drive: 1.2 });
  }

  /** Springy metallic ring with decaying pitch wobble (buffer springs, grenade spoons). */
  spring(x, t0, f, dur, amp, { wob = 0.035, rate = 38, f2 = 2.7 } = {}) {
    const sr = this.sr; const i0 = this.idx(t0); const n = Math.min(x.length - i0, this.n(dur * 5));
    const k = Math.exp(-1 / Math.max(1, dur * sr));
    let p1 = this.rng.f() * TAU; let p2 = this.rng.f() * TAU; let g = amp;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const m = 1 + wob * Math.sin(TAU * rate * t) * Math.exp(-t / (dur * 1.5));
      p1 += (TAU * f * m) / sr; p2 += (TAU * f * f2 * m) / sr;
      x[i0 + i] += g * (Math.sin(p1) + 0.45 * Math.sin(p2));
      g *= k;
    }
    return x;
  }

  /** Glottal pulse train (Rosenberg) with jitter/shimmer, differentiated (lip radiation). */
  glottal(dur, { f0 = 120, f1 = 95, open = 0.5, close = 0.2, jitter = 0.02, shimmer = 0.1, breath = 0.06 } = {}) {
    const n = this.n(dur); const out = new Float32Array(n); const r = this.rng;
    let ph = 0; let per = 1; let amp = 1; let prev = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      ph += (f0 * Math.pow(f1 / f0, u) * per) / this.sr;
      if (ph >= 1) { ph -= 1; per = 1 + r.bi() * jitter; amp = 1 + r.bi() * shimmer; }
      let g;
      if (ph < open) g = 0.5 - 0.5 * Math.cos((Math.PI * ph) / open);
      else if (ph < open + close) g = Math.cos((0.5 * Math.PI * (ph - open)) / close);
      else g = 0;
      const v = g * amp;
      out[i] = v - prev + r.bi() * breath * (0.3 + v);
      prev = v;
    }
    return out;
  }
}

/** Fast tanh (Pade 3/2), exact enough for saturation curves; clamps beyond +-3. */
function tanhA(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

const METAL_RATIOS = [1, 1.52, 2.07, 2.74, 3.43, 4.18, 5.03, 6.11];
const PLATE_RATIOS = [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.16, 3.5, 3.9, 4.36];
const BRASS_RATIOS = [1, 2.32, 2.95, 4.1, 5.06];

/** Soft saturation, in place: tanh(drive*x)/tanh(drive). */
export function softDrive(x, drive) {
  const k = 1 / Math.tanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(drive * x[i]) * k;
  return x;
}

/** Turn a buffer into a seamless loop by cross-fading its last `xfade` samples into the head. */
export function makeSeamless(x, xfade) {
  const n = x.length - xfade; const out = new Float32Array(n);
  out.set(x.subarray(0, n));
  for (let i = 0; i < xfade; i++) {
    const a = i / xfade;
    out[i] = x[i] * Math.sqrt(a) + x[n + i] * Math.sqrt(1 - a);
  }
  return out;
}

// ------------------------------------------------------------------------------ impulse responses

/**
 * Adds a smeared reflection: optional direct spike (bright, early reflections only) plus
 * low-passed decaying noise with a soft onset of `rise` seconds.
 */
function smearTap(h, sr, rng, t, amp, smear, lpHz, spike = 0.6, rise = 0) {
  const i0 = Math.round(t * sr); if (i0 >= h.length) return;
  const n = Math.max(2, Math.ceil((smear * 6 + rise) * sr)); const k = Math.exp(-1 / Math.max(1, smear * sr));
  const a = Math.exp((-TAU * lpHz) / sr); const nr = rise * sr;
  let g = amp; let s1 = 0; let s2 = 0;
  if (spike) h[i0] += amp * spike;
  for (let i = 0; i < n && i0 + i < h.length; i++) {
    s1 = s1 * a + (1 - a) * rng.bi() * 3; s2 = s2 * a + (1 - a) * s1; // 2-pole low-pass
    const e = i < nr ? 0.5 - 0.5 * Math.cos((Math.PI * i) / nr) : g;
    if (i >= nr) g *= k;
    h[i0 + i] += (spike ? s1 : s2 * 1.6) * e * 0.5;
  }
}

/** Diffuse decaying noise with time-varying low-pass (HF dies first) and a build-up. */
function diffuseTail(h, sr, rng, { start, build, rt60, amp, fHi, fLo, fTau, hp = 70 }) {
  const i0 = Math.round(start * sr); const kd = Math.exp(-6.91 / (rt60 * sr));
  const hpA = Math.exp((-TAU * hp) / sr);
  let g = amp; let lp = 0; let hpPrev = 0; let hpOut = 0; let a = 0;
  for (let i = i0; i < h.length; i++) {
    const t = (i - i0) / sr;
    if (((i - i0) & 63) === 0) a = Math.exp((-TAU * (fLo + (fHi - fLo) * Math.exp(-t / fTau))) / sr);
    lp = lp * a + (1 - a) * rng.bi() + DENORM;
    hpOut = hpA * (hpOut + lp - hpPrev); hpPrev = lp; // one-pole high-pass
    h[i] += hpOut * g * (1 - Math.exp(-t / build)) * 2.2;
    g *= kd;
  }
}

function normEnergy(chans, e = 1) {
  for (const h of chans) {
    let s = 0; for (let i = 0; i < h.length; i++) s += h[i] * h[i];
    const k = Math.sqrt(e / Math.max(1e-12, s)); for (let i = 0; i < h.length; i++) h[i] *= k;
  }
  return chans;
}

/** One channel of the outdoor impulse response (see outdoorIR). */
export function outdoorIRChannel(sr, rng, c, { dur = 2.6, rt60 = 2.4 } = {}) {
  const h = new Float32Array(Math.ceil(dur * sr));
  const taps = [0.011, 0.017, 0.024, 0.033, 0.045, 0.058, 0.074, 0.093, 0.117, 0.146, 0.18];
  taps.forEach((t, k) => {
    const tt = t * rng.range(0.85, 1.18) + c * rng.range(0.0005, 0.0025);
    const amp = 0.5 * Math.pow(0.84, k) * rng.range(0.6, 1.2) * (rng.f() < 0.3 ? -1 : 1);
    smearTap(h, sr, rng, tt, amp, 0.0004 + k * 0.0003, 9000 - k * 600);
  });
  // dull, smeared slap-backs from tree lines / terrain
  [[0.27, 0.065], [0.44, 0.05], [0.71, 0.04], [1.08, 0.028], [1.55, 0.018]].forEach(([t, a], k) => {
    smearTap(h, sr, rng, t * rng.range(0.9, 1.12) + c * 0.004, a * rng.range(0.7, 1.2), 0.03 + k * 0.018, 1700 - k * 250, 0, 0.012 + k * 0.006);
  });
  diffuseTail(h, sr, rng, { start: 0.008, build: 0.07, rt60: rt60 * rng.range(0.95, 1.05), amp: 0.16, fHi: 5200, fLo: 420, fTau: 0.38 });
  return normEnergy([h], 1)[0];
}

/**
 * Outdoor impulse response (stereo): sparse early reflections (ground/trees), a few slap-back
 * echoes from terrain and a long diffuse tail whose highs decay first. Energy-normalised.
 */
export function outdoorIR(sr, rng, opts = {}) {
  return [outdoorIRChannel(sr, rng, 0, opts), outdoorIRChannel(sr, rng, 1, opts)];
}

/** One channel of the indoor impulse response (see indoorIR). */
export function indoorIRChannel(sr, rng, c, { dur = 1.1, rt60 = 0.8 } = {}) {
  const h = new Float32Array(Math.ceil(dur * sr));
  for (let k = 0; k < 26; k++) {
    const t = 0.0015 + Math.pow(k / 26, 1.4) * 0.045 * rng.range(0.85, 1.15) + c * 0.0007;
    smearTap(h, sr, rng, t, 0.55 * Math.pow(0.9, k) * (rng.f() < 0.4 ? -1 : 1), 0.0003 + k * 0.0001, 11000 - k * 200);
  }
  diffuseTail(h, sr, rng, { start: 0.003, build: 0.012, rt60, amp: 0.3, fHi: 9000, fLo: 1400, fTau: 0.3, hp: 90 });
  const s = new Synth(sr, rng);
  [118, 176, 233, 301].forEach((f) => s.mode(h, 0.004, f * rng.range(0.95, 1.05), 0.09, 0.012, rng.f() * TAU));
  return normEnergy([h], 1)[0];
}

/** Indoor impulse response (stereo): dense early reflections, short bright room tail, boxy modes. */
export function indoorIR(sr, rng, opts = {}) {
  return [indoorIRChannel(sr, rng, 0, opts), indoorIRChannel(sr, rng, 1, opts)];
}

/**
 * Valley echo IR (mono) used to bake the rolling echo of distant shots/explosions: discrete
 * echo clusters smeared in time and darkened with delay, plus a low diffuse rumble.
 */
export function echoIR(sr, rng, { dur = 3, rt60 = 3.2, density = 1 } = {}) {
  const h = new Float32Array(Math.ceil(dur * sr));
  const echoes = [[0.19, 0.55], [0.36, 0.45], [0.58, 0.42], [0.86, 0.34], [1.18, 0.27], [1.6, 0.2], [2.08, 0.14], [2.6, 0.09]];
  echoes.forEach(([t, a], k) => {
    if (t > dur - 0.1) return;
    const tt = t * rng.range(0.88, 1.12);
    for (let m = 0; m < 2 + Math.round(density * 2); m++) {
      smearTap(h, sr, rng, tt + m * rng.range(0.008, 0.03), a * rng.range(0.4, 1) * (m ? 0.6 : 1), 0.02 + k * 0.012, 1400 - k * 110, 0, 0.01 + k * 0.005);
    }
  });
  diffuseTail(h, sr, rng, { start: 0.05, build: 0.25, rt60, amp: 0.1, fHi: 900, fLo: 260, fTau: 0.8, hp: 35 });
  normEnergy([h], 1);
  return h;
}

// ------------------------------------------------------------------------------ OfflineAudioContext graph helper

const curveCache = new Map();
function tanhCurve(drive) {
  const key = Math.round(drive * 100);
  if (curveCache.has(key)) return curveCache.get(key);
  const n = 2048; const c = new Float32Array(n); const k = 1 / Math.tanh(drive);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(drive * x) * k; }
  curveCache.set(key, c);
  return c;
}

/** Thin wrapper around one OfflineAudioContext render. */
export class Graph {
  constructor(sr, dur, channels = 1) {
    this.sr = sr; this.dur = dur;
    this.ctx = new OfflineAudioContext(channels, Math.max(256, Math.ceil(dur * sr)), sr);
    this.out = this.ctx.destination;
  }
  buffer(chans) {
    const b = this.ctx.createBuffer(chans.length, chans[0].length, this.sr);
    chans.forEach((d, i) => b.copyToChannel(d, i));
    return b;
  }
  src(data, at = 0, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = data instanceof Float32Array ? this.buffer([data]) : data;
    if (rate !== 1) s.playbackRate.value = rate;
    s.start(at);
    return s;
  }
  biquad(type, f, q, g = 0) {
    const n = this.ctx.createBiquadFilter();
    n.type = type; n.frequency.value = clamp(f, 10, this.sr * 0.48); n.Q.value = q; n.gain.value = g;
    return n;
  }
  lp(f, q = 0.707) { return this.biquad('lowpass', f, qdb(q)); }
  hp(f, q = 0.707) { return this.biquad('highpass', f, qdb(q)); }
  bp(f, q = 1) { return this.biquad('bandpass', f, q); }
  pk(f, q, g) { return this.biquad('peaking', f, q, g); }
  ls(f, g) { return this.biquad('lowshelf', f, 0, g); }
  hs(f, g) { return this.biquad('highshelf', f, 0, g); }
  gain(v = 1) { const n = this.ctx.createGain(); n.gain.value = v; return n; }
  delay(t) { const n = this.ctx.createDelay(Math.max(1, t + 0.05)); n.delayTime.value = t; return n; }
  shaper(drive = 2) { const n = this.ctx.createWaveShaper(); n.curve = tanhCurve(drive); n.oversample = 'none'; return n; }
  conv(chans) { const c = this.ctx.createConvolver(); c.normalize = false; c.buffer = this.buffer(chans); return c; }
  chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
  /** data -> filters -> gain(level) -> dest. Returns the gain node (connect it elsewhere too if needed). */
  layer(data, level, dest, filters = [], at = 0) {
    const gn = this.gain(level);
    this.chain(this.src(data, at), ...filters, gn);
    gn.connect(dest || this.out);
    return gn;
  }
  /** Band-limited oscillator note with glide and AD envelope (automation). */
  tone(type, at, { f0, f1 = f0, glide = 0.05, attack = 0.003, hold = 0, decay = 0.1, amp = 1, dest = null, detune = 0 }) {
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + glide);
    if (detune) o.detune.value = detune;
    const gn = this.ctx.createGain();
    gn.gain.setValueAtTime(0, at);
    gn.gain.linearRampToValueAtTime(amp, at + attack);
    if (hold) gn.gain.setValueAtTime(amp, at + attack + hold);
    gn.gain.setTargetAtTime(0, at + attack + hold, decay);
    o.connect(gn); gn.connect(dest || this.out);
    o.start(at); o.stop(Math.min(this.dur, at + attack + hold + decay * 8));
    return gn;
  }
  render() { return this.ctx.startRendering(); }
}

// ------------------------------------------------------------------------------ weapon profiles

const G = (o) => Object.assign({
  T: 0.0006, crackHP: 800, crackLvl: 1, crackNoise: 0.003, crackNoiseAmt: 0.55,
  boomF0: 130, boomF1: 58, boomDrop: 0.015, boomDecay: 0.04, boomLvl: 0.6,
  rumbleLvl: 0.45, rumbleLP: 240,
  bodyLP: 4000, bodyDecay: 0.032, bodyLvl: 0.6, brightDecay: 0.009, brightLvl: 0.45,
  blastF: 2000, blastQ: 1, blastDecay: 0.014, blastLvl: 0.6,
  er: 0.3, erDelay: 0.0085, drive: 2.4, lowShelf: 2,
  mech: null, mechLvl: 0.2, loud: 0, tail: 1, supersonic: true, far: 'rifle', len: 0.45,
}, o);

/** Gunshot synthesis parameters per weapon `sound` profile (see shared/weapons.js). */
export const GUN_PROFILES = {
  pistol9: G({ T: 0.00045, crackHP: 950, crackLvl: 0.9, crackNoise: 0.0025, boomF0: 160, boomF1: 70, boomDrop: 0.012,
    boomDecay: 0.028, boomLvl: 0.5, rumbleLvl: 0.35, bodyLP: 3300, bodyDecay: 0.022, bodyLvl: 0.5, brightDecay: 0.007,
    blastF: 1850, blastQ: 1.1, blastDecay: 0.011, blastLvl: 0.6, er: 0.26, erDelay: 0.0075, drive: 2, mech: 'pistol',
    mechLvl: 0.2, loud: -2.5, tail: 0.8, supersonic: false, far: 'light', len: 0.32 }),
  pistol45: G({ T: 0.0007, crackHP: 700, crackLvl: 0.8, crackNoise: 0.003, boomF0: 130, boomF1: 58, boomDrop: 0.015,
    boomDecay: 0.036, boomLvl: 0.6, rumbleLvl: 0.45, bodyLP: 2500, bodyDecay: 0.028, bodyLvl: 0.6, brightDecay: 0.008,
    brightLvl: 0.35, blastF: 1100, blastQ: 1, blastDecay: 0.015, blastLvl: 0.65, er: 0.28, drive: 2.2, mech: 'pistol',
    mechLvl: 0.21, loud: -2, tail: 0.85, supersonic: false, far: 'light', len: 0.35 }),
  pistol50: G({ T: 0.0011, crackHP: 520, crackLvl: 1, crackNoise: 0.004, boomF0: 105, boomF1: 46, boomDrop: 0.02,
    boomDecay: 0.05, boomLvl: 0.75, rumbleLvl: 0.55, bodyLP: 2300, bodyDecay: 0.04, bodyLvl: 0.75, brightDecay: 0.012,
    blastF: 820, blastQ: 0.9, blastDecay: 0.02, blastLvl: 0.7, er: 0.32, drive: 2.4, mech: 'pistolHeavy', mechLvl: 0.24,
    loud: -0.5, tail: 1.1, far: 'magnum', len: 0.45 }),
  revolver: G({ T: 0.0009, crackHP: 620, crackLvl: 1, crackNoise: 0.006, crackNoiseAmt: 0.8, boomF0: 115, boomF1: 50,
    boomDrop: 0.018, boomDecay: 0.045, boomLvl: 0.7, rumbleLvl: 0.5, bodyLP: 2700, bodyDecay: 0.036, bodyLvl: 0.7,
    brightDecay: 0.011, blastF: 950, blastQ: 0.9, blastDecay: 0.018, blastLvl: 0.7, er: 0.3, drive: 2.4, mech: 'revolver',
    mechLvl: 0.12, loud: -1, tail: 1.05, far: 'magnum', len: 0.42 }),
  smg9: G({ T: 0.00048, crackHP: 900, crackLvl: 0.9, crackNoise: 0.0026, boomF0: 150, boomF1: 66, boomDrop: 0.013,
    boomDecay: 0.03, boomLvl: 0.52, rumbleLvl: 0.38, bodyLP: 3500, bodyDecay: 0.024, bodyLvl: 0.52, brightDecay: 0.007,
    blastF: 1700, blastQ: 1.1, blastDecay: 0.012, blastLvl: 0.62, er: 0.26, drive: 2, mech: 'smg', mechLvl: 0.26,
    loud: -2.5, tail: 0.85, supersonic: false, far: 'light', len: 0.32 }),
  smg45: G({ T: 0.00068, crackHP: 720, crackLvl: 0.82, crackNoise: 0.003, boomF0: 125, boomF1: 56, boomDrop: 0.015,
    boomDecay: 0.038, boomLvl: 0.6, rumbleLvl: 0.45, bodyLP: 2600, bodyDecay: 0.03, bodyLvl: 0.6, brightDecay: 0.008,
    brightLvl: 0.35, blastF: 1050, blastQ: 1, blastDecay: 0.016, blastLvl: 0.66, er: 0.28, drive: 2.2, mech: 'smgHeavy',
    mechLvl: 0.28, loud: -2, tail: 0.9, supersonic: false, far: 'light', len: 0.35 }),
  smg46: G({ T: 0.0004, crackHP: 1250, crackLvl: 1, crackNoise: 0.0022, boomF0: 175, boomF1: 78, boomDrop: 0.011,
    boomDecay: 0.024, boomLvl: 0.42, rumbleLvl: 0.3, bodyLP: 4300, bodyDecay: 0.02, bodyLvl: 0.45, brightDecay: 0.007,
    brightLvl: 0.5, blastF: 2600, blastQ: 1.2, blastDecay: 0.01, blastLvl: 0.65, er: 0.22, drive: 2, mech: 'smg',
    mechLvl: 0.22, loud: -2.5, tail: 0.8, far: 'light', len: 0.3 }),
  smg57: G({ T: 0.00042, crackHP: 1150, crackLvl: 1, crackNoise: 0.0023, boomF0: 165, boomF1: 74, boomDrop: 0.012,
    boomDecay: 0.026, boomLvl: 0.44, rumbleLvl: 0.32, bodyLP: 4100, bodyDecay: 0.021, bodyLvl: 0.47, brightDecay: 0.0075,
    brightLvl: 0.48, blastF: 2300, blastQ: 1.15, blastDecay: 0.011, blastLvl: 0.64, er: 0.22, drive: 2, mech: 'smgBullpup',
    mechLvl: 0.24, loud: -2.5, tail: 0.8, far: 'light', len: 0.3 }),
  rifle556: G({ T: 0.0005, crackHP: 900, crackLvl: 1, crackNoise: 0.0028, boomF0: 135, boomF1: 60, boomDrop: 0.015,
    boomDecay: 0.04, boomLvl: 0.6, rumbleLvl: 0.45, bodyLP: 4600, bodyDecay: 0.032, bodyLvl: 0.6, brightDecay: 0.011,
    brightLvl: 0.5, blastF: 2200, blastQ: 1, blastDecay: 0.015, blastLvl: 0.7, er: 0.3, drive: 2.4, mech: 'rifle',
    mechLvl: 0.2, loud: -1, tail: 1, far: 'rifle', len: 0.42 }),
  rifle545: G({ T: 0.00047, crackHP: 1000, crackLvl: 1, crackNoise: 0.0026, boomF0: 145, boomF1: 64, boomDrop: 0.014,
    boomDecay: 0.036, boomLvl: 0.55, rumbleLvl: 0.4, bodyLP: 4900, bodyDecay: 0.03, bodyLvl: 0.56, brightDecay: 0.01,
    brightLvl: 0.52, blastF: 2500, blastQ: 1.05, blastDecay: 0.014, blastLvl: 0.68, er: 0.29, drive: 2.3, mech: 'akLight',
    mechLvl: 0.24, loud: -1.2, tail: 1, far: 'rifle', len: 0.4 }),
  rifle762: G({ T: 0.0007, crackHP: 720, crackLvl: 0.95, crackNoise: 0.0032, boomF0: 115, boomF1: 52, boomDrop: 0.018,
    boomDecay: 0.05, boomLvl: 0.72, rumbleLvl: 0.55, bodyLP: 3700, bodyDecay: 0.04, bodyLvl: 0.7, brightDecay: 0.013,
    brightLvl: 0.45, blastF: 1400, blastQ: 0.9, blastDecay: 0.019, blastLvl: 0.75, er: 0.32, drive: 2.6, mech: 'ak',
    mechLvl: 0.27, loud: -0.5, tail: 1.15, far: 'battle', len: 0.45 }),
  rifle308: G({ T: 0.0008, crackHP: 660, crackLvl: 1, crackNoise: 0.0034, boomF0: 105, boomF1: 48, boomDrop: 0.02,
    boomDecay: 0.058, boomLvl: 0.78, rumbleLvl: 0.6, bodyLP: 3500, bodyDecay: 0.046, bodyLvl: 0.75, brightDecay: 0.014,
    brightLvl: 0.45, blastF: 1250, blastQ: 0.9, blastDecay: 0.021, blastLvl: 0.75, er: 0.33, drive: 2.8, mech: 'rifleHeavy',
    mechLvl: 0.22, loud: 0, tail: 1.2, far: 'battle', len: 0.48 }),
  lmg556: G({ T: 0.0005, crackHP: 900, crackLvl: 1, crackNoise: 0.0028, boomF0: 132, boomF1: 58, boomDrop: 0.015,
    boomDecay: 0.042, boomLvl: 0.62, rumbleLvl: 0.47, bodyLP: 4500, bodyDecay: 0.034, bodyLvl: 0.62, brightDecay: 0.011,
    brightLvl: 0.5, blastF: 2150, blastQ: 1, blastDecay: 0.015, blastLvl: 0.7, er: 0.3, drive: 2.4, mech: 'lmg', mechLvl: 0.3,
    loud: -0.8, tail: 1.1, far: 'rifle', len: 0.42 }),
  lmg762: G({ T: 0.0008, crackHP: 660, crackLvl: 1, crackNoise: 0.0034, boomF0: 104, boomF1: 47, boomDrop: 0.02,
    boomDecay: 0.058, boomLvl: 0.78, rumbleLvl: 0.6, bodyLP: 3400, bodyDecay: 0.046, bodyLvl: 0.76, brightDecay: 0.014,
    brightLvl: 0.45, blastF: 1200, blastQ: 0.9, blastDecay: 0.021, blastLvl: 0.76, er: 0.33, drive: 2.8, mech: 'lmgHeavy',
    mechLvl: 0.32, loud: 0, tail: 1.25, far: 'battle', len: 0.48 }),
  dmr762: G({ T: 0.00078, crackHP: 680, crackLvl: 1, crackNoise: 0.0035, boomF0: 104, boomF1: 47, boomDrop: 0.02,
    boomDecay: 0.06, boomLvl: 0.8, rumbleLvl: 0.62, bodyLP: 3600, bodyDecay: 0.048, bodyLvl: 0.76, brightDecay: 0.015,
    brightLvl: 0.5, blastF: 1300, blastQ: 0.9, blastDecay: 0.021, blastLvl: 0.76, er: 0.34, drive: 2.8, mech: 'dmr',
    mechLvl: 0.24, loud: 0.3, tail: 1.3, far: 'battle', len: 0.5 }),
  dmr308: G({ T: 0.0008, crackHP: 660, crackLvl: 1, crackNoise: 0.0034, boomF0: 105, boomF1: 48, boomDrop: 0.02,
    boomDecay: 0.058, boomLvl: 0.78, rumbleLvl: 0.6, bodyLP: 3500, bodyDecay: 0.046, bodyLvl: 0.75, brightDecay: 0.014,
    brightLvl: 0.48, blastF: 1250, blastQ: 0.9, blastDecay: 0.021, blastLvl: 0.75, er: 0.34, drive: 2.8, mech: 'dmr',
    mechLvl: 0.22, loud: 0.2, tail: 1.25, far: 'battle', len: 0.5 }),
  sniper308: G({ T: 0.00082, crackHP: 650, crackLvl: 1, crackNoise: 0.0036, boomF0: 100, boomF1: 46, boomDrop: 0.021,
    boomDecay: 0.062, boomLvl: 0.8, rumbleLvl: 0.62, bodyLP: 3500, bodyDecay: 0.05, bodyLvl: 0.78, brightDecay: 0.015,
    brightLvl: 0.5, blastF: 1250, blastQ: 0.9, blastDecay: 0.022, blastLvl: 0.76, er: 0.35, drive: 2.9, mech: null,
    loud: 0.5, tail: 1.35, far: 'battle', len: 0.5 }),
  sniper338: G({ T: 0.0012, crackHP: 520, crackLvl: 1, crackNoise: 0.0045, crackNoiseAmt: 0.65, boomF0: 85, boomF1: 38,
    boomDrop: 0.026, boomDecay: 0.08, boomLvl: 0.9, rumbleLvl: 0.7, rumbleLP: 200, bodyLP: 3100, bodyDecay: 0.065,
    bodyLvl: 0.85, brightDecay: 0.018, brightLvl: 0.5, blastF: 920, blastQ: 0.8, blastDecay: 0.028, blastLvl: 0.8, er: 0.36,
    drive: 3, mech: null, loud: 1.5, tail: 1.6, far: 'magnumRifle', len: 0.62 }),
  sniper50: G({ T: 0.0016, crackHP: 420, crackLvl: 1, crackNoise: 0.006, crackNoiseAmt: 0.75, boomF0: 70, boomF1: 32,
    boomDrop: 0.032, boomDecay: 0.1, boomLvl: 1, rumbleLvl: 0.8, rumbleLP: 180, bodyLP: 2700, bodyDecay: 0.085,
    bodyLvl: 0.95, brightDecay: 0.022, brightLvl: 0.55, blastF: 720, blastQ: 0.7, blastDecay: 0.036, blastLvl: 0.85, er: 0.4,
    drive: 3.2, mech: 'barrett', mechLvl: 0.28, loud: 2.5, tail: 1.9, far: 'fifty', len: 0.75 }),
  shotgun: G({ T: 0.0012, crackHP: 520, crackLvl: 0.75, crackNoise: 0.005, crackNoiseAmt: 0.7, boomF0: 95, boomF1: 44,
    boomDrop: 0.024, boomDecay: 0.07, boomLvl: 0.85, rumbleLvl: 0.65, rumbleLP: 220, bodyLP: 2300, bodyDecay: 0.06,
    bodyLvl: 0.9, brightDecay: 0.016, brightLvl: 0.4, blastF: 620, blastQ: 0.7, blastDecay: 0.03, blastLvl: 0.85, er: 0.36,
    drive: 2.8, mech: null, loud: 0.5, tail: 1.25, supersonic: false, far: 'shotgun', len: 0.55 }),
};
export const GUN_PROFILE_NAMES = Object.keys(GUN_PROFILES);

const PROFILE_PREFIX_DEFAULTS = [
  ['revolver', 'revolver'], ['pistol', 'pistol9'], ['smg', 'smg9'], ['rifle', 'rifle556'], ['lmg', 'lmg556'],
  ['dmr', 'dmr308'], ['sniper', 'sniper308'], ['shotgun', 'shotgun'], ['mg', 'lmg762'], ['ar', 'rifle556'],
];

/** Map any profile name to a known one: exact -> longest known prefix -> category prefix -> rifle556. */
export function resolveGunProfile(name) {
  const s = String(name || '').toLowerCase();
  if (GUN_PROFILES[s]) return s;
  let best = null;
  for (const k of GUN_PROFILE_NAMES) if (s.startsWith(k) && (!best || k.length > best.length)) best = k;
  if (best) return best;
  for (const [p, t] of PROFILE_PREFIX_DEFAULTS) if (s.startsWith(p)) return t;
  return 'rifle556';
}

/** Distant-shot classes (one rolling-echo "far" bank per class). */
export const FAR_CLASSES = {
  light: { T: 0.0022, f0: 112, f1: 56, decay: 0.05, lp: 950, pop: 820, echo: 0.6, ir: 2.6, rt60: 2.6 },
  magnum: { T: 0.003, f0: 92, f1: 46, decay: 0.075, lp: 850, pop: 680, echo: 0.68, ir: 2.8, rt60: 2.9 },
  rifle: { T: 0.0026, f0: 98, f1: 48, decay: 0.065, lp: 1050, pop: 900, echo: 0.72, ir: 2.9, rt60: 3 },
  battle: { T: 0.0035, f0: 82, f1: 40, decay: 0.085, lp: 920, pop: 760, echo: 0.8, ir: 3.1, rt60: 3.2 },
  magnumRifle: { T: 0.0046, f0: 70, f1: 34, decay: 0.12, lp: 820, pop: 620, echo: 0.9, ir: 3.4, rt60: 3.5 },
  fifty: { T: 0.006, f0: 56, f1: 28, decay: 0.16, lp: 720, pop: 520, echo: 1, ir: 3.7, rt60: 3.8 },
  shotgun: { T: 0.0042, f0: 82, f1: 40, decay: 0.1, lp: 820, pop: 560, echo: 0.76, ir: 3, rt60: 3.1 },
};

// ------------------------------------------------------------------------------ name tables

export const MECH_NAMES = ['mag_out', 'mag_in', 'charge', 'bolt_up', 'bolt_back', 'bolt_forward', 'bolt_down', 'pump_back',
  'pump_forward', 'shell_insert', 'cylinder_open', 'cylinder_close', 'dry_fire', 'switch_weapon', 'ads_in', 'ads_out',
  'fire_mode', 'pin_pull', 'spoon', 'throw', 'knife_swing', 'knife_hit', 'equip', 'belt_open', 'belt_close'];
export const FOOT_SURFACES = ['grass', 'dirt', 'gravel', 'wood', 'concrete', 'metal', 'rock'];
export const IMPACT_SURFACES = ['dirt', 'grass', 'wood', 'metal', 'concrete', 'rock', 'flesh'];
export const CASING_KINDS = ['rifle', 'pistol', 'shotgun', 'big'];
export const HITMARKER_KINDS = ['hit', 'head', 'kill', 'headkill'];
export const UI_NAMES = ['hover', 'click', 'back', 'error', 'spawn', 'match_start', 'match_end', 'countdown', 'killstreak',
  'join', 'leave', 'chat'];
export const AMBIENT_PRESETS = ['valley', 'outpost', 'alpine'];

// ------------------------------------------------------------------------------ recipes: weapons

/** Mechanical action layer baked into the shot (bolt carrier, slide, belt feed...). */
function mechLayer(s, type, len) {
  const x = s.buf(len); const r = s.rng;
  const H = (t, o) => s.hit(x, r.j(t, 0.06), { ...o, f: r.j(o.f, 0.04) });
  const rattle = (n, fLo, fHi, t0, t1, a) => {
    for (let i = 0; i < n; i++) {
      H(r.range(t0, t1), { f: r.range(fLo, fHi), decay: r.range(0.002, 0.005), amp: r.range(0.15, 0.4) * a, modes: 3, noise: 0.8 });
    }
  };
  switch (type) {
    case 'pistol':
      H(0.005, { f: 3700, decay: 0.006, amp: 0.45 });
      H(0.02, { f: 2400, decay: 0.012, amp: 0.7, low: 0.35, lowF: 650 });
      H(0.042, { f: 3000, decay: 0.01, amp: 1, low: 0.3, lowF: 850 });
      break;
    case 'pistolHeavy':
      H(0.007, { f: 3000, decay: 0.008, amp: 0.45 });
      H(0.027, { f: 1900, decay: 0.016, amp: 0.75, low: 0.4, lowF: 520 });
      H(0.056, { f: 2500, decay: 0.014, amp: 1, low: 0.35, lowF: 700 });
      break;
    case 'revolver':
      s.tick(x, 0, 0.5, 0.0004);
      [2120, 3370, 5230, 7400].forEach((f, k) => s.mode(x, 0.0008, r.j(f, 0.03), 0.05 - k * 0.008, 0.5 / (k + 1), r.f() * TAU));
      break;
    case 'smg':
      H(0.008, { f: 2600, decay: 0.008, amp: 0.5 });
      H(0.036, { f: 1700, decay: 0.018, amp: 1, low: 0.5, lowF: 420, lowDecay: 0.015 });
      H(0.0385, { f: 4200, decay: 0.006, amp: 0.4, modes: 3 });
      break;
    case 'smgHeavy':
      H(0.01, { f: 2100, decay: 0.01, amp: 0.55, low: 0.3, lowF: 500 });
      H(0.043, { f: 1450, decay: 0.022, amp: 1, low: 0.6, lowF: 360, lowDecay: 0.018 });
      H(0.046, { f: 3700, decay: 0.007, amp: 0.4, modes: 3 });
      break;
    case 'smgBullpup':
      H(0.008, { f: 2400, decay: 0.008, amp: 0.5 });
      H(0.035, { f: 1600, decay: 0.016, amp: 1, low: 0.6, lowF: 380, lowDecay: 0.016 });
      s.addNoise(x, 0.035, 0.5, { attack: 0.0005, decay: 0.008, filters: [['bandpass', 1100, 1.4]] });
      s.filt(x, 'lowpass', 3800, 0.7);
      break;
    case 'rifle':
      H(0.004, { f: 3600, decay: 0.006, amp: 0.4, modes: 4 });
      s.spring(x, 0.016, r.j(1150, 0.05), 0.022, 0.22);
      H(0.052, { f: 2200, decay: 0.014, amp: 1, low: 0.4, lowF: 600 });
      H(0.055, { f: 5000, decay: 0.004, amp: 0.45, modes: 3 });
      break;
    case 'akLight':
      H(0.011, { f: 1750, decay: 0.012, amp: 0.65, low: 0.35, lowF: 460 });
      H(0.06, { f: 1450, decay: 0.019, amp: 1, low: 0.5, lowF: 420, lowDecay: 0.018 });
      H(0.063, { f: 3900, decay: 0.007, amp: 0.45, modes: 3 });
      break;
    case 'ak':
      H(0.012, { f: 1500, decay: 0.014, amp: 0.7, low: 0.4, lowF: 420 });
      H(0.064, { f: 1250, decay: 0.022, amp: 1, low: 0.6, lowF: 380, lowDecay: 0.02 });
      H(0.067, { f: 3600, decay: 0.008, amp: 0.5, modes: 3 });
      break;
    case 'rifleHeavy':
      H(0.01, { f: 1900, decay: 0.012, amp: 0.6, low: 0.4, lowF: 500 });
      H(0.068, { f: 1600, decay: 0.02, amp: 1, low: 0.5, lowF: 450 });
      H(0.071, { f: 4200, decay: 0.006, amp: 0.4, modes: 3 });
      break;
    case 'lmg':
      H(0.004, { f: 3500, decay: 0.006, amp: 0.4, modes: 4 });
      H(0.028, { f: 2800, decay: 0.009, amp: 0.6 });
      H(0.05, { f: 2100, decay: 0.015, amp: 1, low: 0.45, lowF: 560 });
      rattle(9, 3000, 6500, 0.012, 0.085, 1);
      break;
    case 'lmgHeavy':
      H(0.012, { f: 1500, decay: 0.014, amp: 0.7, low: 0.4, lowF: 420 });
      H(0.034, { f: 2300, decay: 0.01, amp: 0.55 });
      H(0.062, { f: 1250, decay: 0.022, amp: 1, low: 0.6, lowF: 380, lowDecay: 0.02 });
      rattle(9, 2200, 4800, 0.015, 0.09, 1);
      break;
    case 'dmr':
      H(0.009, { f: 2600, decay: 0.008, amp: 0.5 });
      H(0.07, { f: 1500, decay: 0.022, amp: 1, low: 0.55, lowF: 420 });
      H(0.073, { f: 3900, decay: 0.008, amp: 0.5, modes: 3 });
      break;
    case 'barrett':
      H(0.018, { f: 520, decay: 0.05, amp: 0.8, modes: 6, spread: 0.1, low: 0.6, lowF: 140, lowDecay: 0.04 });
      H(0.11, { f: 760, decay: 0.045, amp: 1, modes: 6, low: 0.5, lowF: 180, lowDecay: 0.03 });
      H(0.113, { f: 2900, decay: 0.012, amp: 0.5, modes: 4 });
      break;
    default: break;
  }
  return normPeak(x);
}

/**
 * Close-range (dry) gunshot: crack + boom + body + blast resonance + ground bounce, pre-mixed in
 * JS, then saturated / EQ'd in the graph, with the clean action layer added after the saturator.
 */
function rGun(g, s, P, sup) {
  const r = s.rng; const L = g.dur;
  const sum = s.buf(L); // pre-saturation mix
  const erA = s.buf(L); // feeds the first (ground) reflection: crack + blast
  const erB = s.buf(L); // feeds the second reflection: body
  const add = (src, lvl, er) => { mixInto(sum, src, lvl); if (er) mixInto(er, src, lvl); };

  // (1) crack: Friedlander blast pulse + short noise burst, high-passed
  const crack = s.buf(0.04);
  s.friedlander(crack, 0, r.j(P.T, 0.1), 1, 1.6);
  mixInto(crack, s.noise(0.04, { attack: 0, decay: r.j(P.crackNoise, 0.15), filters: [['highpass', 1500]] }), P.crackNoiseAmt);
  s.filt(crack, 'highpass', r.j(P.crackHP, 0.1));
  add(normPeak(crack), P.crackLvl * (sup ? (P.supersonic ? 0.3 : 0.05) : 1), erA);

  // (2) boom: pitch-dropping sine thump with a little drive for audible harmonics
  s.sweep(sum, 0, { f0: r.j(P.boomF0, 0.05), f1: r.j(P.boomF1, 0.04), drop: P.boomDrop, attack: 0.0008,
    decay: r.j(P.boomDecay, 0.07) * (sup ? 0.55 : 1), amp: P.boomLvl * (sup ? 0.38 : 1), drive: 1.6 });

  // (2b) rumble: low-passed noise so the low end is not purely tonal
  const rumDecay = r.j(P.boomDecay * 1.5, 0.1) * (sup ? 0.6 : 1);
  add(s.noise(Math.min(L, rumDecay * 7 + 0.01), { attack: 0.001, decay: rumDecay,
    filters: [['lowpass', r.j(P.rumbleLP, 0.1), 0.7], ['lowpass', P.rumbleLP * 1.4, 0.7], ['highpass', 30]] }), P.rumbleLvl * (sup ? 0.4 : 1));

  // (3) body: low-passed noise; (3b) bright noise that dies much faster (HF decays first)
  const bodyDecay = r.j(P.bodyDecay, 0.08) * (sup ? 0.6 : 1);
  add(s.noise(Math.min(L, bodyDecay * 7 + 0.01), { attack: 0.0003, decay: bodyDecay,
    filters: [['lowpass', r.j(P.bodyLP, 0.08) * (sup ? 0.45 : 1), 0.6], ['highpass', 55]] }), P.bodyLvl * (sup ? 0.5 : 1), erB);
  add(s.noise(Math.min(L, P.brightDecay * 7 + 0.005), { attack: 0, decay: r.j(P.brightDecay, 0.1),
    filters: [['highpass', 2600], ['lowpass', 13000]] }), P.brightLvl * (sup ? 0.1 : 1));

  // (4) blast resonance: the calibre's "voice"
  const blastF = r.j(P.blastF, 0.06);
  add(s.noise(Math.min(L, P.blastDecay * 7 + 0.005), { attack: 0.0002, decay: r.j(P.blastDecay, 0.1),
    filters: [['bandpass', blastF, P.blastQ], ['bandpass', blastF * 1.08, P.blastQ]] }), P.blastLvl * (sup ? 0.3 : 1), erA);

  if (sup) { // muted "thwap" of gas leaving the can + low puff
    add(s.noise(0.2, { attack: 0.0012, decay: r.j(0.026, 0.1), filters: [['bandpass', blastF * 0.55, 1.3], ['lowpass', 2600]] }), 0.9);
    add(s.noise(0.3, { attack: 0.002, decay: r.j(0.04, 0.1), filters: [['lowpass', 650], ['highpass', 60]] }), 0.6);
  }

  // ground bounce / near reflections thicken the transient (as recorded at shoulder height)
  s.filt(erA, 'lowpass', 3000); mixInto(sum, erA, P.er * (sup ? 0.6 : 1), s.idx(r.j(P.erDelay, 0.15)));
  s.filt(erB, 'lowpass', 1900); mixInto(sum, erB, P.er * 0.45, s.idx(r.j(P.erDelay * 2.6, 0.2)));

  const post = g.gain(1);
  g.chain(g.src(sum), g.gain(1 / (P.crackLvl + 0.6 * P.boomLvl + 0.3 * P.bodyLvl)),
    g.shaper(sup ? Math.max(1.2, P.drive * 0.55) : P.drive), post, g.hp(28), g.ls(110, P.lowShelf), g.out);
  // (5) action / mechanism, clean (after the saturator)
  if (P.mech) g.layer(mechLayer(s, P.mech, Math.min(L, 0.2)), P.mechLvl * (sup ? 1.9 : 1), post, [g.hp(350)]);
}

/**
 * Rolling valley echo synthesised directly (cheaper than convolution): smeared, darkening
 * low-passed echo clusters with low thump replicas, then a diffuse rumble. Adds into x.
 */
function rollingEcho(s, x, { lp = 900, f0 = 90, f1 = 45, decay = 0.08, echo = 0.8, rt60 = 3, start = 0 }) {
  const r = s.rng; const L = x.length / s.sr;
  const echoes = [[0.19, 0.55], [0.29, 0.22], [0.36, 0.45], [0.47, 0.2], [0.58, 0.42], [0.72, 0.18], [0.86, 0.34], [1.02, 0.15],
    [1.18, 0.27], [1.4, 0.12], [1.6, 0.2], [1.85, 0.1], [2.08, 0.14], [2.6, 0.09], [3.15, 0.06]];
  echoes.forEach(([t, a], k) => {
    const tt = start + t * r.range(0.9, 1.1);
    if (tt > L - 0.25) return;
    const smear = 0.035 + t * 0.06;
    const fc = Math.max(220, lp * (1 - Math.min(0.75, t * 0.32)));
    const amp = a * echo * r.range(0.75, 1.15);
    const burst = s.noise(Math.min(L - tt, smear * 9 + 0.05), { attack: 0.004, decay: smear, filters: [['lowpass', fc, 0.6], ['lowpass', fc * 1.3, 0.6], ['highpass', 40]] });
    const rise = Math.min(burst.length, s.n(smear * 0.7));
    for (let i = 0; i < rise; i++) burst[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / rise); // soft onset
    mixInto(x, burst, amp * 0.55, s.idx(tt));
    s.sweep(x, tt, { f0: f0 * 0.85, f1, drop: 0.05, attack: 0.01 + smear * 0.4, decay: decay * 1.2 + smear * 0.6, amp: amp * 0.3 });
  });
  const t0 = start + 0.06; const dur = L - t0;
  if (dur > 0.3) {
    mixInto(x, s.noise(dur, { attack: 0.3, decay: rt60 / 6.91, filters: [['lowpass', 420], ['highpass', 35]] }), 0.16 * echo, s.idx(t0));
  }
  return x;
}

/** Distant shot: dull thump + rolling valley echo (rendered at a low sample rate). */
function rGunFar(g, s, C) {
  const r = s.rng; const x = s.buf(g.dur);
  const thump = s.buf(0.25);
  s.friedlander(thump, 0.001, r.j(C.T, 0.1), 1, 1.4);
  s.filt(thump, 'lowpass', C.lp * 1.3); s.filt(thump, 'highpass', 35);
  mixInto(x, normPeak(thump), 0.75);
  s.sweep(x, 0, { f0: r.j(C.f0, 0.05), f1: C.f1, drop: 0.05, attack: 0.002, decay: r.j(C.decay, 0.08), amp: 0.8, drive: 1.2 });
  mixInto(x, s.noise(C.decay * 9, { attack: 0.001, decay: r.j(C.decay * 1.2, 0.1), filters: [['lowpass', C.lp, 0.6], ['highpass', 40]] }), 0.6);
  mixInto(x, s.noise(0.2, { attack: 0.0005, decay: 0.02, filters: [['bandpass', r.j(C.pop, 0.08), 1.3]] }), 0.45);
  rollingEcho(s, x, { lp: C.lp, f0: C.f0, f1: C.f1, decay: C.decay, echo: C.echo, rt60: C.rt60 });
  g.chain(g.src(x), g.gain(0.8), g.shaper(1.4), g.hp(30), g.out);
}

// ------------------------------------------------------------------------------ recipes: mechanical foley

const MECH = {
  mag_out: [0.5, (s, x) => {
    s.hit(x, 0.004, { f: 4200, decay: 0.004, amp: 0.5, modes: 3 });
    s.slide(x, 0.03, 0.15, { f: 2500, f1: 2000, amp: 0.35, rough: 0.6 });
    s.hit(x, 0.05, { f: 1800, decay: 0.012, amp: 0.65, low: 0.35, lowF: 340 });
    s.thud(x, 0.21, 190, 0.025, 0.3);
    s.rustle(x, 0.19, 0.14, 0.12);
  }],
  mag_in: [0.4, (s, x) => {
    s.slide(x, 0.0, 0.085, { f: 1800, f1: 2400, amp: 0.3, rough: 0.5 });
    s.hit(x, 0.085, { f: 1500, decay: 0.018, amp: 1, low: 0.6, lowF: 260, lowDecay: 0.02, modes: 6 });
    s.hit(x, 0.09, { f: 4300, decay: 0.006, amp: 0.6, modes: 3 });
    s.thud(x, 0.098, 140, 0.03, 0.4);
  }],
  charge: [0.55, (s, x) => {
    s.hit(x, 0.004, { f: 3500, decay: 0.005, amp: 0.35, modes: 3 });
    s.slide(x, 0.02, 0.14, { f: 2600, f1: 3200, amp: 0.4, rough: 0.8, rate: 140 });
    s.grains(x, { t0: 0.03, dur: 0.12, count: 6, fLo: 3000, fHi: 6000, dLo: 0.002, dHi: 0.004, amp: 0.3 });
    s.hit(x, 0.162, { f: 2600, decay: 0.01, amp: 0.6 });
    s.hit(x, 0.26, { f: 1600, decay: 0.025, amp: 1, low: 0.7, lowF: 300, modes: 7 });
    s.hit(x, 0.262, { f: 3800, decay: 0.008, amp: 0.5, modes: 3 });
    s.spring(x, 0.264, 900, 0.03, 0.12);
    s.hit(x, 0.285, { f: 4400, decay: 0.004, amp: 0.35, modes: 3 });
  }],
  bolt_up: [0.22, (s, x) => {
    s.slide(x, 0.0, 0.045, { f: 3000, amp: 0.2, rough: 0.5 });
    s.hit(x, 0.012, { f: 2100, decay: 0.012, amp: 0.8, low: 0.3, lowF: 500 });
    s.hit(x, 0.036, { f: 3400, decay: 0.006, amp: 0.4, modes: 3 });
  }],
  bolt_back: [0.34, (s, x) => {
    s.slide(x, 0.0, 0.16, { f: 2000, f1: 2900, amp: 0.45, rough: 0.7, rate: 110 });
    s.hit(x, 0.16, { f: 1900, decay: 0.015, amp: 0.9, low: 0.4, lowF: 450 });
    s.hit(x, 0.185, { f: 4800, decay: 0.03, amp: 0.28, modes: 4, ratios: BRASS_RATIOS });
  }],
  bolt_forward: [0.3, (s, x) => {
    s.slide(x, 0.0, 0.13, { f: 2800, f1: 2000, amp: 0.4, rough: 0.7, rate: 110 });
    s.hit(x, 0.13, { f: 1400, decay: 0.02, amp: 1, low: 0.6, lowF: 330 });
    s.hit(x, 0.133, { f: 3600, decay: 0.006, amp: 0.4, modes: 3 });
  }],
  bolt_down: [0.2, (s, x) => {
    s.hit(x, 0.01, { f: 1800, decay: 0.014, amp: 1, low: 0.5, lowF: 420 });
    s.hit(x, 0.015, { f: 4200, decay: 0.005, amp: 0.5, modes: 3 });
  }],
  pump_back: [0.28, (s, x) => {
    s.slide(x, 0.0, 0.075, { f: 1500, f1: 1900, amp: 0.4, rough: 0.5 });
    s.hit(x, 0.076, { f: 1100, decay: 0.02, amp: 1, low: 0.7, lowF: 240, modes: 6 });
    s.addNoise(x, 0.076, 0.5, { attack: 0.0004, decay: 0.012, filters: [['bandpass', 700, 1.5]] });
    s.hit(x, 0.085, { f: 3000, decay: 0.01, amp: 0.3, modes: 3 });
  }],
  pump_forward: [0.28, (s, x) => {
    s.slide(x, 0.0, 0.068, { f: 1900, f1: 1500, amp: 0.35, rough: 0.5 });
    s.hit(x, 0.07, { f: 1300, decay: 0.02, amp: 1, low: 0.6, lowF: 280, modes: 6 });
    s.addNoise(x, 0.07, 0.4, { attack: 0.0004, decay: 0.01, filters: [['bandpass', 800, 1.5]] });
    s.hit(x, 0.076, { f: 3900, decay: 0.006, amp: 0.5, modes: 3 });
  }],
  shell_insert: [0.26, (s, x) => {
    s.slide(x, 0.0, 0.05, { f: 1800, amp: 0.25, rough: 0.5 });
    s.hit(x, 0.05, { f: 2200, decay: 0.01, amp: 0.7, low: 0.3, lowF: 600 });
    s.thud(x, 0.05, 220, 0.02, 0.35);
    s.hit(x, 0.072, { f: 5000, decay: 0.004, amp: 0.5, modes: 3 });
  }],
  cylinder_open: [0.42, (s, x) => {
    s.hit(x, 0.0, { f: 3800, decay: 0.006, amp: 0.6, modes: 4 });
    s.slide(x, 0.01, 0.11, { f: 3200, amp: 0.22, rough: 0.6 });
    s.hit(x, 0.12, { f: 2600, decay: 0.03, amp: 0.6 });
    for (let k = 0; k < 6; k++) s.hit(x, 0.14 + k * 0.025 * (1 + k * 0.15), { f: 4600, decay: 0.003, amp: 0.25 * (1 - k * 0.12), modes: 2 });
  }],
  cylinder_close: [0.34, (s, x) => {
    s.slide(x, 0.0, 0.06, { f: 2900, amp: 0.2, rough: 0.5 });
    s.hit(x, 0.065, { f: 2300, decay: 0.03, amp: 1, low: 0.4, lowF: 520, modes: 6 });
    s.hit(x, 0.068, { f: 4500, decay: 0.005, amp: 0.6, modes: 3 });
    s.mode(x, 0.066, 3100, 0.08, 0.12);
  }],
  dry_fire: [0.14, (s, x) => {
    s.hit(x, 0.003, { f: 3300, decay: 0.006, amp: 1, modes: 4, noise: 0.8 });
    s.hit(x, 0.004, { f: 1200, decay: 0.008, amp: 0.4, modes: 3 });
    s.hit(x, 0.055, { f: 5200, decay: 0.003, amp: 0.3, modes: 2 });
  }],
  switch_weapon: [0.62, (s, x) => {
    s.rustle(x, 0.0, 0.36, 0.45);
    s.whoosh(x, 0.05, 0.26, { f0: 400, fMid: 1100, f1: 600, amp: 0.3 });
    s.grains(x, { t0: 0.08, dur: 0.2, count: 6, fLo: 2500, fHi: 5000, dLo: 0.005, dHi: 0.012, amp: 0.2 });
    s.thud(x, 0.32, 160, 0.03, 0.5);
    s.hit(x, 0.33, { f: 2400, decay: 0.012, amp: 0.35 });
  }],
  ads_in: [0.26, (s, x) => {
    s.rustle(x, 0.0, 0.16, 0.4);
    s.thud(x, 0.09, 120, 0.03, 0.45);
    s.hit(x, 0.095, { f: 3200, decay: 0.004, amp: 0.15, modes: 3 });
  }],
  ads_out: [0.22, (s, x) => {
    s.rustle(x, 0.0, 0.14, 0.3);
    s.thud(x, 0.05, 150, 0.02, 0.2);
  }],
  fire_mode: [0.12, (s, x) => {
    s.hit(x, 0.003, { f: 3800, decay: 0.005, amp: 0.8, modes: 4 });
    s.hit(x, 0.028, { f: 4600, decay: 0.004, amp: 0.6, modes: 3 });
  }],
  pin_pull: [0.4, (s, x) => {
    const r = s.rng; const n = s.n(0.11); const sc = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n; ph += (TAU * (3000 + 2200 * u)) / s.sr;
      sc[i] = Math.sin(ph) * (0.4 + 0.6 * Math.abs(r.bi())) * Math.sin(Math.PI * u);
    }
    mixInto(x, sc, 0.25);
    s.slide(x, 0.0, 0.11, { f: 4200, amp: 0.35, rough: 0.8, rate: 160 });
    s.hit(x, 0.112, { f: 4000, decay: 0.01, amp: 0.6, modes: 4 });
    [2600, 4100, 6100].forEach((f) => s.mode(x, 0.13, r.j(f, 0.03), 0.06, 0.12, r.f() * TAU));
  }],
  spoon: [0.48, (s, x) => {
    s.hit(x, 0.005, { f: 2900, decay: 0.04, amp: 0.8, modes: 5 });
    s.spring(x, 0.006, 1700, 0.03, 0.25);
    s.hit(x, 0.26, { f: 5200, decay: 0.015, amp: 0.3, modes: 3 });
    s.hit(x, 0.33, { f: 5600, decay: 0.012, amp: 0.18, modes: 3 });
  }],
  throw: [0.52, (s, x) => {
    s.rustle(x, 0.0, 0.2, 0.3);
    s.whoosh(x, 0.05, 0.32, { f0: 250, fMid: 900, f1: 380, q: 1.1, amp: 0.75, peakAt: 0.5 });
  }],
  knife_swing: [0.36, (s, x) => {
    s.whoosh(x, 0.0, 0.22, { f0: 900, fMid: 2600, f1: 1200, q: 1.3, amp: 0.8, peakAt: 0.5 });
    s.whoosh(x, 0.05, 0.12, { f0: 4000, fMid: 7000, f1: 5000, q: 1.5, amp: 0.25, peakAt: 0.4 });
    s.rustle(x, 0.0, 0.15, 0.12);
  }],
  knife_hit: [0.36, (s, x) => {
    s.thud(x, 0.0, 110, 0.04, 0.9);
    s.addNoise(x, 0.0, 0.6, { attack: 0.0005, decay: 0.025, filters: [['bandpass', 900, 1.8]] });
    s.addNoise(x, 0.005, 0.5, { attack: 0.002, decay: 0.04, filters: [['bandpass', 400, 1.2]] });
    s.addNoise(x, 0.0, 0.3, { attack: 0.0005, decay: 0.02, filters: [['highpass', 2500]] });
    s.grains(x, { t0: 0.0, dur: 0.05, count: 10, fLo: 2500, fHi: 6000, dLo: 0.001, dHi: 0.003, amp: 0.2, modes: 1 });
    s.hit(x, 0.002, { f: 5000, decay: 0.004, amp: 0.2, modes: 2 });
  }],
  equip: [0.46, (s, x) => {
    s.rustle(x, 0.0, 0.26, 0.35);
    s.hit(x, 0.08, { f: 2800, decay: 0.01, amp: 0.4 });
    s.grains(x, { t0: 0.06, dur: 0.15, count: 5, fLo: 2600, fHi: 5200, dLo: 0.004, dHi: 0.01, amp: 0.18 });
    s.thud(x, 0.2, 170, 0.025, 0.45);
  }],
  belt_open: [0.46, (s, x) => {
    const r = s.rng;
    s.hit(x, 0.0, { f: 3600, decay: 0.006, amp: 0.6, modes: 4 });
    const n = s.n(0.13); const cr = white(n, r);
    biquadSweep(cr, 'bandpass', logSweep(700, 1100), 9, s.sr);
    const m = s.smooth(n, 60);
    for (let i = 0; i < n; i++) cr[i] *= Math.abs(m[i]) * Math.sin((Math.PI * i) / n);
    mixInto(x, normPeak(cr), 0.2, s.idx(0.02));
    s.spring(x, 0.03, 1300, 0.025, 0.2);
    s.hit(x, 0.16, { f: 1200, decay: 0.03, amp: 0.9, low: 0.4, lowF: 300, modes: 6 });
  }],
  belt_close: [0.42, (s, x) => {
    s.whoosh(x, 0.0, 0.07, { f0: 600, fMid: 1200, f1: 900, amp: 0.15 });
    s.hit(x, 0.07, { f: 1000, decay: 0.035, amp: 1, low: 0.7, lowF: 240, modes: 7 });
    s.hit(x, 0.075, { f: 4200, decay: 0.006, amp: 0.6, modes: 3 });
    s.grains(x, { t0: 0.08, dur: 0.12, count: 8, fLo: 2500, fHi: 5000, dLo: 0.003, dHi: 0.008, amp: 0.25 });
  }],
};

function rMech(g, s, name) {
  const [len, fn] = MECH[name];
  const x = s.buf(len);
  fn(s, x);
  g.layer(normPeak(x), 1, g.out, [g.hp(60)]);
}

// ------------------------------------------------------------------------------ recipes: movement

function stepLayer(s, x, surface, t, k) {
  const r = s.rng;
  switch (surface) {
    case 'grass':
      s.thud(x, t, r.j(85, 0.1), 0.02, 0.3 * k);
      s.grains(x, { t0: t, dur: 0.12, count: Math.round(40 * k), fLo: 1800, fHi: 7000, dLo: 0.0008, dHi: 0.0025, amp: 0.3 * k, modes: 1, noise: 0.6 });
      s.rustle(x, t, 0.14, 0.35 * k, { f: 3800, q: 0.7, crinkle: 0.9, rate: 60 });
      break;
    case 'dirt':
      s.thud(x, t, r.j(80, 0.1), 0.028, 0.55 * k);
      s.addNoise(x, t, 0.45 * k, { attack: 0.001, decay: 0.03, filters: [['lowpass', 1300], ['highpass', 90]] });
      s.grains(x, { t0: t, dur: 0.09, count: Math.round(30 * k), fLo: 1200, fHi: 4000, dLo: 0.0008, dHi: 0.002, amp: 0.25 * k, modes: 1, noise: 0.7 });
      break;
    case 'gravel':
      s.thud(x, t, r.j(90, 0.1), 0.022, 0.4 * k);
      s.grains(x, { t0: t, dur: 0.13, count: Math.round(85 * k), fLo: 1300, fHi: 6500, dLo: 0.002, dHi: 0.007, amp: 0.6 * k, skew: 1.7, modes: 2 });
      s.addNoise(x, t, 0.2 * k, { attack: 0.002, decay: 0.04, filters: [['bandpass', 2500, 0.7]] });
      break;
    case 'wood': {
      const f0 = r.j(150, 0.12);
      [1, 2.31, 4.07, 6.72].forEach((m, i) => s.mode(x, t, f0 * m * r.j(1, 0.04), (0.05 - i * 0.01) * r.j(1, 0.2), (0.6 / (i + 1)) * k, r.f() * TAU));
      s.addNoise(x, t, 0.35 * k, { attack: 0, decay: 0.004, filters: [['lowpass', 4000], ['highpass', 300]] });
      s.addNoise(x, t, 0.3 * k, { attack: 0.0005, decay: 0.012, filters: [['bandpass', r.j(700, 0.1), 2]] });
      break;
    }
    case 'concrete':
      s.addNoise(x, t, 0.65 * k, { attack: 0, decay: 0.007, filters: [['highpass', 700], ['peaking', 3200, 1, 4]] });
      s.thud(x, t, r.j(110, 0.1), 0.014, 0.3 * k);
      s.grains(x, { t0: t + 0.002, dur: 0.06, count: Math.round(22 * k), fLo: 2500, fHi: 7500, dLo: 0.0006, dHi: 0.002, amp: 0.25 * k, modes: 1, noise: 0.8 });
      break;
    case 'metal': {
      s.hit(x, t, { f: r.j(330, 0.1), decay: 0.12, amp: 0.55 * k, modes: 10, spread: 0.05, tilt: 0.85, noise: 0.4, ratios: PLATE_RATIOS });
      s.hit(x, t, { f: r.j(1450, 0.1), decay: 0.05, amp: 0.3 * k, modes: 5, tilt: 0.7, noise: 0.2 });
      s.thud(x, t, r.j(95, 0.1), 0.05, 0.45 * k);
      break;
    }
    case 'rock':
      s.addNoise(x, t, 0.55 * k, { attack: 0, decay: 0.009, filters: [['bandpass', r.j(1800, 0.1), 0.8]] });
      s.thud(x, t, r.j(85, 0.1), 0.02, 0.45 * k);
      s.grains(x, { t0: t + 0.003, dur: 0.07, count: Math.round(20 * k), fLo: 1500, fHi: 5000, dLo: 0.0015, dHi: 0.005, amp: 0.3 * k, modes: 2 });
      break;
    default: break;
  }
}

function rFoot(g, s, surface) {
  const r = s.rng; const x = s.buf(0.4);
  const heel = 0.003; const toe = heel + r.range(0.045, 0.08);
  stepLayer(s, x, surface, heel, 1);
  stepLayer(s, x, surface, toe, r.range(0.35, 0.55));
  if (surface !== 'metal' && surface !== 'wood') s.slide(x, heel + 0.01, r.range(0.06, 0.1), { f: 2600, amp: 0.06, rough: 0.8 });
  const filters = { grass: [g.lp(7500)], dirt: [g.lp(5000)], wood: [g.pk(250, 1, 2)], metal: [], concrete: [g.pk(3500, 1, 2)], gravel: [], rock: [] }[surface];
  g.layer(normPeak(x), 1, g.out, [g.hp(45), ...filters]);
}

function rGear(g, s) {
  const x = s.buf(0.3);
  s.rustle(x, 0.0, 0.2, 0.5, { f: 1800, q: 0.6 });
  s.grains(x, { t0: 0.01, dur: 0.16, count: 7, fLo: 2400, fHi: 5200, dLo: 0.006, dHi: 0.016, amp: 0.35, modes: 2 });
  s.addNoise(x, s.rng.range(0.02, 0.08), 0.25, { attack: 0.0005, decay: 0.006, filters: [['bandpass', 1100, 1.5]] });
  g.layer(normPeak(x), 1, g.out, [g.hp(200)]);
}

function rJump(g, s) {
  const x = s.buf(0.45);
  s.addNoise(x, 0.0, 0.5, { attack: 0.001, decay: 0.035, filters: [['lowpass', 2000], ['highpass', 80]] });
  s.thud(x, 0.0, 90, 0.02, 0.4);
  s.whoosh(x, 0.02, 0.28, { f0: 400, fMid: 1300, f1: 700, amp: 0.35 });
  s.rustle(x, 0.02, 0.25, 0.3);
  s.grains(x, { t0: 0.03, dur: 0.2, count: 6, fLo: 2400, fHi: 5000, dLo: 0.005, dHi: 0.012, amp: 0.2 });
  g.layer(normPeak(x), 1, g.out, [g.hp(50)]);
}

function rLand(g, s) {
  const x = s.buf(0.5); const r = s.rng;
  s.sweep(x, 0.0, { f0: 110, f1: 45, drop: 0.03, attack: 0.002, decay: 0.07, amp: 1, drive: 1.5 });
  s.addNoise(x, 0.0, 0.6, { attack: 0.001, decay: 0.05, filters: [['lowpass', 900], ['highpass', 60]] });
  s.rustle(x, 0.01, 0.22, 0.3);
  s.grains(x, { t0: r.range(0.02, 0.05), dur: 0.2, count: 9, fLo: 2200, fHi: 5200, dLo: 0.005, dHi: 0.015, amp: 0.3 });
  g.layer(normPeak(x), 1, g.out, [g.hp(35)]);
}

// ------------------------------------------------------------------------------ recipes: bullets & impacts

function rImpact(g, s, surface, v) {
  const r = s.rng; const x = s.buf(surface === 'metal' ? 0.75 : 0.5);
  switch (surface) {
    case 'dirt':
      s.sweep(x, 0, { f0: 140, f1: 60, drop: 0.015, attack: 0.0005, decay: 0.03, amp: 0.8 });
      s.addNoise(x, 0, 0.7, { attack: 0, decay: 0.022, filters: [['lowpass', 2200], ['highpass', 80]] });
      s.tick(x, 0, 0.6, 0.0006);
      s.grains(x, { t0: 0.01, dur: 0.3, count: 70, fLo: 1200, fHi: 4500, dLo: 0.0008, dHi: 0.0025, amp: 0.3, skew: 1.6, modes: 1, noise: 0.8 });
      break;
    case 'grass':
      s.sweep(x, 0, { f0: 130, f1: 60, drop: 0.015, attack: 0.0005, decay: 0.025, amp: 0.6 });
      s.addNoise(x, 0, 0.5, { attack: 0, decay: 0.018, filters: [['lowpass', 2500], ['highpass', 100]] });
      s.rustle(x, 0.0, 0.16, 0.45, { f: 4200, q: 0.7, crinkle: 0.9, rate: 70 });
      s.grains(x, { t0: 0.01, dur: 0.2, count: 35, fLo: 1500, fHi: 5000, dLo: 0.0008, dHi: 0.002, amp: 0.2, modes: 1, noise: 0.8 });
      break;
    case 'wood': {
      s.tick(x, 0, 1, 0.0005);
      const f0 = r.j(420, 0.1);
      [1, 2.26, 4.1].forEach((m, i) => s.mode(x, 0, f0 * m, 0.035 - i * 0.008, 0.6 / (i + 1), r.f() * TAU));
      s.addNoise(x, 0, 0.6, { attack: 0, decay: 0.01, filters: [['bandpass', r.j(1600, 0.1), 0.9]] });
      s.grains(x, { t0: 0.002, dur: 0.09, count: 30, fLo: 2000, fHi: 6500, dLo: 0.0008, dHi: 0.003, amp: 0.35, modes: 1, noise: 0.7 });
      break;
    }
    case 'metal':
      s.tick(x, 0, 1, 0.0004);
      s.hit(x, 0, { f: r.j(1150, 0.12), decay: 0.22, amp: 0.7, modes: 8, spread: 0.06, tilt: 0.82, noise: 0.5, ratios: PLATE_RATIOS });
      s.hit(x, 0, { f: r.j(3900, 0.1), decay: 0.06, amp: 0.4, modes: 4, noise: 0 });
      if (v === 1) { // ricochet whine
        const n = s.n(0.45); const wh = new Float32Array(n); let ph = 0; const f0 = r.range(2600, 3600);
        for (let i = 0; i < n; i++) {
          const u = i / n; ph += (TAU * f0 * (1 - 0.45 * u) * (1 + 0.012 * Math.sin(TAU * 31 * u))) / s.sr;
          wh[i] = Math.sin(ph) * Math.min(1, u * 25) * Math.pow(1 - u, 1.5);
        }
        mixInto(x, wh, 0.22, s.idx(0.02));
      }
      break;
    case 'concrete':
      s.addNoise(x, 0, 1, { attack: 0, decay: 0.004, filters: [['highpass', 1000]] });
      s.addNoise(x, 0, 0.6, { attack: 0, decay: 0.015, filters: [['bandpass', r.j(1300, 0.1), 1]] });
      s.grains(x, { t0: 0.004, dur: 0.3, count: 60, fLo: 1000, fHi: 5500, dLo: 0.001, dHi: 0.004, amp: 0.35, skew: 1.8, modes: 2 });
      s.addNoise(x, 0.01, 0.12, { attack: 0.01, decay: 0.12, filters: [['highpass', 3000]] });
      break;
    case 'rock':
      s.addNoise(x, 0, 0.9, { attack: 0, decay: 0.005, filters: [['highpass', 800]] });
      s.addNoise(x, 0, 0.55, { attack: 0, decay: 0.014, filters: [['bandpass', r.j(1100, 0.1), 1]] });
      s.hit(x, 0, { f: r.j(2500, 0.1), decay: 0.02, amp: 0.35, modes: 3, noise: 0 });
      s.grains(x, { t0: 0.004, dur: 0.22, count: 40, fLo: 1200, fHi: 5000, dLo: 0.0015, dHi: 0.005, amp: 0.3, skew: 1.8, modes: 2 });
      if (v === 2) {
        const n = s.n(0.35); const wh = new Float32Array(n); let ph = 0; const f0 = r.range(2200, 3000);
        for (let i = 0; i < n; i++) {
          const u = i / n; ph += (TAU * f0 * (1 - 0.4 * u)) / s.sr;
          wh[i] = Math.sin(ph) * Math.min(1, u * 30) * Math.pow(1 - u, 1.6);
        }
        mixInto(x, wh, 0.16, s.idx(0.015));
      }
      break;
    case 'flesh':
      s.sweep(x, 0, { f0: 170, f1: 80, drop: 0.02, attack: 0.0008, decay: 0.035, amp: 1, drive: 1.5 });
      s.addNoise(x, 0, 0.65, { attack: 0.0004, decay: 0.02, filters: [['bandpass', r.j(900, 0.1), 1.5]] });
      s.addNoise(x, 0.004, 0.4, { attack: 0.002, decay: 0.035, filters: [['lowpass', 600]] });
      s.addNoise(x, 0, 0.25, { attack: 0, decay: 0.006, filters: [['highpass', 2500]] });
      break;
    default: break;
  }
  g.layer(normPeak(x), 1, g.out, [g.hp(40)]);
}

function rWhiz(g, s, supersonic) {
  const r = s.rng; const x = s.buf(supersonic ? 0.3 : 0.4);
  if (supersonic) {
    // N-wave of the bullet's shock cone + bright noise, then terrain slaps and the turbulent zip
    const D = r.range(0.00032, 0.0005); const n = Math.ceil(D * s.sr);
    const crack = new Float32Array(s.n(0.02));
    for (let i = 0; i <= n; i++) crack[i] = 1 - (2 * i) / n;
    mixInto(crack, s.noise(0.02, { attack: 0, decay: 0.0015, filters: [['highpass', 3000]] }), 0.35);
    s.filt(crack, 'highpass', 250);
    mixInto(x, crack, 1);
    const slap = crack.slice(); s.filt(slap, 'lowpass', 3500);
    mixInto(x, slap, 0.28, s.idx(r.range(0.012, 0.024)));
    mixInto(x, slap, 0.13, s.idx(r.range(0.04, 0.07)));
    const zip = white(s.n(0.12), r);
    biquadSweep(zip, 'bandpass', logSweep(5500, 2000), 2, s.sr);
    s.env(zip, 0.004, 0.035);
    mixInto(x, normPeak(zip), 0.28, s.idx(0.003));
  } else {
    const n = s.n(0.3); const w = white(n, r);
    biquadSweep(w, 'bandpass', logSweep(r.range(2600, 3200), r.range(700, 900)), 1.8, s.sr);
    const fl = s.smooth(n, r.range(70, 110));
    for (let i = 0; i < n; i++) {
      const u = i / n; const e = u < 0.3 ? Math.sin((0.5 * Math.PI * u) / 0.3) : Math.pow(1 - (u - 0.3) / 0.7, 2);
      w[i] *= e * (0.75 + 0.25 * fl[i]);
    }
    mixInto(x, normPeak(w), 0.9, s.idx(0.005));
  }
  g.layer(normPeak(x), 1, g.out, [g.hp(supersonic ? 150 : 200)]);
}

function rCasing(g, s, kind) {
  const r = s.rng; const x = s.buf(kind === 'big' ? 0.8 : 0.6);
  const P = {
    rifle: { f: 3900, decay: 0.05, bounces: 4, amp: 1, gap: 0.12 },
    pistol: { f: 5600, decay: 0.032, bounces: 3, amp: 0.8, gap: 0.09 },
    shotgun: { f: 900, decay: 0.012, bounces: 3, amp: 0.9, gap: 0.11 },
    big: { f: 2600, decay: 0.09, bounces: 4, amp: 1, gap: 0.15 },
  }[kind];
  let t = 0.002; let a = P.amp; let gap = r.j(P.gap, 0.2);
  for (let b = 0; b < P.bounces; b++) {
    if (kind === 'shotgun') {
      s.addNoise(x, t, a * 0.7, { attack: 0, decay: 0.006, filters: [['bandpass', r.j(1300, 0.15), 1.2]] });
      s.hit(x, t, { f: r.j(P.f, 0.1), decay: P.decay, amp: a * 0.5, modes: 3, noise: 0.3 });
      s.hit(x, t, { f: r.j(5600, 0.1), decay: 0.015, amp: a * 0.35, modes: 3, noise: 0, ratios: BRASS_RATIOS });
    } else {
      s.hit(x, t, { f: r.j(P.f, 0.06), decay: P.decay * r.range(0.7, 1.1), amp: a, modes: 5, spread: 0.03, tilt: 0.8, noise: 0.4, ratios: BRASS_RATIOS });
    }
    t += gap; gap *= r.range(0.5, 0.68); a *= r.range(0.45, 0.62);
  }
  if (kind !== 'shotgun') { // short roll
    for (let k = 0; k < 6; k++) s.hit(x, t + k * r.range(0.008, 0.016), { f: r.j(P.f * 1.4, 0.1), decay: 0.004, amp: a * 0.5, modes: 2, noise: 0.3 });
  }
  g.layer(normPeak(x), 1, g.out, [g.hp(300)]);
}

// ------------------------------------------------------------------------------ recipes: explosives

function rExplosion(g, s) {
  const r = s.rng; const L = g.dur;
  const sum = g.gain(0.55); const post = g.gain(1);
  g.chain(sum, g.shaper(3), post, g.hp(22), g.out);
  const blast = s.buf(0.08);
  s.friedlander(blast, 0, r.j(0.0028, 0.1), 1, 1.3);
  mixInto(blast, s.noise(0.08, { attack: 0, decay: 0.006, filters: [['highpass', 700]] }), 0.6);
  g.layer(normPeak(blast), 1, sum);
  const boom = s.buf(1.8);
  s.sweep(boom, 0, { f0: r.j(64, 0.05), f1: 26, drop: 0.12, attack: 0.002, decay: r.j(0.38, 0.08), amp: 1, drive: 1.6 });
  g.layer(boom, 1, sum);
  g.layer(s.noise(1.4, { attack: 0.0008, decay: r.j(0.17, 0.1), filters: [['lowpass', 1500, 0.6], ['highpass', 40]] }), 0.85, sum);
  g.layer(s.noise(Math.min(L, 2.6), { attack: 0.015, decay: r.j(0.6, 0.1), filters: [['lowpass', 260], ['lowpass', 260]] }), 0.75, sum);
  g.layer(s.noise(0.3, { attack: 0.0003, decay: 0.045, filters: [['bandpass', r.j(2600, 0.1), 0.8]] }), 0.6, sum);
  // falling debris / dirt pattering, clean
  const deb = s.buf(L);
  s.grains(deb, { t0: 0.16, dur: Math.min(2.1, L - 0.3), count: 160, fLo: 900, fHi: 6000, dLo: 0.0015, dHi: 0.01, amp: 1, skew: 1.7, fade: 0.85, modes: 2, noise: 0.5 });
  for (let k = 0; k < 10; k++) s.thud(deb, r.range(0.25, 1.3), r.range(140, 380), 0.02, r.range(0.4, 1));
  g.layer(normPeak(deb), 0.13, post, [g.hp(300)]);
}

function rExplosionFar(g, s) {
  const r = s.rng; const x = s.buf(g.dur);
  s.sweep(x, 0, { f0: r.j(55, 0.05), f1: 24, drop: 0.15, attack: 0.004, decay: r.j(0.42, 0.08), amp: 1, drive: 1.3 });
  mixInto(x, s.noise(1.6, { attack: 0.003, decay: 0.25, filters: [['lowpass', 700], ['highpass', 30]] }), 0.8);
  mixInto(x, s.noise(2.5, { attack: 0.05, decay: 0.7, filters: [['lowpass', 220], ['lowpass', 220]] }), 0.6);
  rollingEcho(s, x, { lp: 650, f0: 55, f1: 26, decay: 0.3, echo: 1.2, rt60: 4 });
  g.chain(g.src(x), g.gain(0.7), g.shaper(1.6), g.hp(25), g.out);
}

function rSmoke(g, s) {
  const r = s.rng; const L = g.dur; const n = s.n(L);
  const x = new Float32Array(n);
  s.addNoise(x, 0.0, 0.6, { attack: 0.0008, decay: 0.025, filters: [['bandpass', 1200, 0.8]] });
  s.thud(x, 0.0, 120, 0.03, 0.4);
  const hiss = white(n, r); s.filt(hiss, 'highpass', 1800); s.filt(hiss, 'peaking', 4300, 0.7, 5); normPeak(hiss);
  const roar = white(n, r); s.filt(roar, 'bandpass', 900, 0.7); normPeak(roar);
  const m1 = s.smooth(n, 13); const m2 = s.smooth(n, 41);
  for (let i = 0; i < n; i++) {
    const t = i / s.sr;
    const e = t < 0.05 ? 0 : Math.min(1, (t - 0.05) / 0.15) * (1 - 0.15 * (t / L)) * Math.min(1, (L - t) / 0.5);
    const fl = 1 + 0.32 * m1[i] + 0.14 * m2[i];
    x[i] += (hiss[i] * 0.55 + roar[i] * 0.16) * e * fl;
  }
  g.layer(normPeak(x), 1, g.out, [g.hp(80)]);
}

// ------------------------------------------------------------------------------ recipes: feedback, UI, body

function rHitmarker(g, s, kind) {
  const x = s.buf(0.5); const r = s.rng;
  const click = () => {
    s.tick(x, 0.0, 0.7, 0.0005);
    s.mode(x, 0.0, 3200, 0.012, 0.6, 0);
    s.mode(x, 0.0, 1650, 0.008, 0.25, 0);
  };
  const ding = (a) => [1, 2.76, 5.4, 8.9].forEach((m, i) => s.mode(x, 0.0, 2650 * m, 0.16 / (1 + i * 0.7), (a * 0.5) / (1 + i), r.f() * TAU));
  const thunk = (a) => {
    s.sweep(x, 0.0, { f0: 190, f1: 75, drop: 0.03, attack: 0.001, decay: 0.05, amp: a, drive: 1.4 });
    s.mode(x, 0.0, 1100, 0.02, 0.3 * a, 0);
  };
  if (kind === 'hit') click();
  if (kind === 'head') { click(); ding(0.9); }
  if (kind === 'kill') { click(); thunk(0.9); s.mode(x, 0.045, 2400, 0.05, 0.25, 0); }
  if (kind === 'headkill') { click(); ding(1); thunk(1); s.mode(x, 0.05, 3600, 0.08, 0.2, 0); }
  g.layer(normPeak(x), 1, g.out, [g.hp(60)]);
}

function rUI(g, s, name) {
  const T = (type, at, o) => g.tone(type, at, o);
  const bus = g.gain(1); g.chain(bus, g.lp(9000), g.out);
  const x = s.buf(g.dur);
  switch (name) {
    case 'hover': T('sine', 0, { f0: 2400, decay: 0.012, amp: 0.5, dest: bus }); s.tick(x, 0, 0.15, 0.0004); break;
    case 'click':
      s.tick(x, 0, 0.5, 0.0005);
      T('sine', 0, { f0: 1800, f1: 1450, glide: 0.02, decay: 0.018, amp: 0.7, dest: bus });
      T('sine', 0, { f0: 300, decay: 0.012, amp: 0.4, dest: bus });
      break;
    case 'back':
      T('sine', 0, { f0: 1200, decay: 0.03, amp: 0.6, dest: bus });
      T('sine', 0.05, { f0: 800, decay: 0.04, amp: 0.6, dest: bus });
      break;
    case 'error':
      T('triangle', 0, { f0: 220, attack: 0.004, hold: 0.06, decay: 0.02, amp: 0.8, dest: bus });
      T('triangle', 0.11, { f0: 185, attack: 0.004, hold: 0.08, decay: 0.03, amp: 0.8, dest: bus });
      T('square', 0, { f0: 110, attack: 0.004, hold: 0.06, decay: 0.02, amp: 0.15, dest: bus });
      break;
    case 'spawn':
      s.whoosh(x, 0.0, 0.38, { f0: 400, fMid: 3000, f1: 2000, amp: 0.4, peakAt: 0.85 });
      s.thud(x, 0.36, 70, 0.08, 0.8);
      T('sine', 0.36, { f0: 440, decay: 0.15, amp: 0.25, dest: bus });
      T('sine', 0.36, { f0: 660, decay: 0.12, amp: 0.18, dest: bus });
      break;
    case 'match_start':
      s.thud(x, 0.0, 50, 0.3, 1);
      s.whoosh(x, 0.0, 0.7, { f0: 200, fMid: 2500, f1: 3500, amp: 0.3, peakAt: 0.9 });
      [220, 261.6, 329.6, 440].forEach((f, i) => {
        T('sawtooth', 0.7, { f0: f, attack: 0.01, hold: 0.2, decay: 0.25, amp: 0.13, dest: bus, detune: (i % 2 ? 6 : -6) });
      });
      s.thud(x, 0.7, 55, 0.25, 0.9);
      break;
    case 'match_end':
      s.thud(x, 0.0, 48, 0.35, 1);
      [[329.6, 0], [261.6, 0.18], [220, 0.36], [164.8, 0.54]].forEach(([f, t]) => T('sawtooth', t, { f0: f, attack: 0.01, hold: 0.15, decay: 0.25, amp: 0.12, dest: bus }));
      T('sine', 0.54, { f0: 110, attack: 0.01, hold: 0.3, decay: 0.3, amp: 0.4, dest: bus });
      break;
    case 'countdown':
      T('sine', 0, { f0: 880, attack: 0.002, hold: 0.09, decay: 0.03, amp: 0.7, dest: bus });
      T('sine', 0, { f0: 1760, attack: 0.002, hold: 0.06, decay: 0.02, amp: 0.12, dest: bus });
      break;
    case 'killstreak':
      [[660, 0], [880, 0.08], [1320, 0.16], [1760, 0.24]].forEach(([f, t]) => {
        T('triangle', t, { f0: f, decay: 0.09, amp: 0.45, dest: bus });
        T('sine', t, { f0: f * 2.01, decay: 0.05, amp: 0.12, dest: bus });
      });
      s.thud(x, 0, 80, 0.08, 0.5);
      break;
    case 'join':
      T('sine', 0, { f0: 660, decay: 0.05, amp: 0.5, dest: bus });
      T('sine', 0.08, { f0: 990, decay: 0.08, amp: 0.5, dest: bus });
      break;
    case 'leave':
      T('sine', 0, { f0: 990, decay: 0.05, amp: 0.5, dest: bus });
      T('sine', 0.08, { f0: 660, decay: 0.08, amp: 0.5, dest: bus });
      break;
    case 'chat': T('sine', 0, { f0: 1400, f1: 900, glide: 0.03, decay: 0.03, amp: 0.6, dest: bus }); break;
    default: break;
  }
  g.layer(x, 1, bus);
}

function rHurt(g, s, local) {
  const r = s.rng; const x = s.buf(0.45);
  if (local) {
    s.sweep(x, 0, { f0: 92, f1: 44, drop: 0.03, attack: 0.001, decay: 0.09, amp: 1, drive: 2 });
    s.addNoise(x, 0, 0.5, { attack: 0.0005, decay: 0.025, filters: [['lowpass', 1500]] });
  } else {
    s.sweep(x, 0, { f0: 160, f1: 75, drop: 0.02, attack: 0.001, decay: 0.035, amp: 0.7, drive: 1.5 });
    s.addNoise(x, 0, 0.5, { attack: 0.0004, decay: 0.02, filters: [['bandpass', 900, 1.4]] });
  }
  // muffled grunt: glottal pulses through vowel formants, then a breath
  const gr = s.glottal(0.24, { f0: r.range(118, 135), f1: r.range(88, 100), jitter: 0.03, shimmer: 0.12, breath: 0.08 });
  s.env(gr, 0.025, 0.07, 0.06);
  const f = r.j(1, 0.04);
  const grunt = g.gain(local ? 0.55 : 0.75);
  const at = r.range(0.035, 0.06);
  const src = g.src(gr, at);
  [[560 * f, 6, 1], [1000 * f, 9, 0.45], [2400 * f, 14, 0.2]].forEach(([ff, q, a]) => g.chain(src, g.bp(ff, q), g.gain(a * 6), grunt));
  g.chain(grunt, g.lp(1900), g.out);
  s.addNoise(x, at + 0.16, 0.12, { attack: 0.02, decay: 0.05, filters: [['bandpass', 1700, 1.2]] });
  g.layer(normPeak(x), 0.9, g.out, [g.hp(35)]);
}

function rHeart(g, s) {
  const x = s.buf(0.6);
  s.sweep(x, 0.0, { f0: 70, f1: 42, drop: 0.03, attack: 0.006, decay: 0.06, amp: 1, drive: 1.3 });
  s.addNoise(x, 0.0, 0.2, { attack: 0.004, decay: 0.03, filters: [['lowpass', 180]] });
  s.sweep(x, 0.27, { f0: 82, f1: 50, drop: 0.025, attack: 0.005, decay: 0.045, amp: 0.75, drive: 1.3 });
  g.layer(normPeak(x), 1, g.out, [g.hp(25), g.lp(500)]);
}

// ------------------------------------------------------------------------------ recipes: ambience assets

function rRustle(g, s) {
  const r = s.rng; const L = g.dur; const n = s.n(L);
  const x = new Float32Array(n);
  const w = white(n, r); s.filt(w, 'bandpass', r.range(2600, 3600), 0.5); s.filt(w, 'highpass', 900); normPeak(w);
  const m1 = s.smooth(n, 2.2); const m2 = s.smooth(n, 23); const m3 = s.smooth(n, 70);
  for (let i = 0; i < n; i++) {
    const u = i / n; const e = Math.pow(Math.sin(Math.PI * u), 0.8) * (0.55 + 0.45 * m1[i]);
    x[i] = w[i] * e * (0.35 + 0.65 * Math.min(1.4, Math.abs(m2[i] * m3[i]) * 3));
  }
  s.grains(x, { t0: 0.1, dur: L - 0.3, count: Math.round(L * 60), fLo: 2500, fHi: 8000, dLo: 0.0006, dHi: 0.002, amp: 0.5, skew: 1, ampSkew: 2.5, fade: 0, modes: 1, noise: 0.8 });
  g.layer(normPeak(x), 1, g.out, [g.hp(600)]);
}

function rRockfall(g, s) {
  const r = s.rng; const L = g.dur; const x = s.buf(L);
  const hits = 55;
  for (let k = 0; k < hits; k++) {
    const u = r.f(); const t = 0.05 + (L - 0.9) * (u < 0.15 ? u * 2 : 0.3 + 0.7 * Math.pow(r.f(), 0.8));
    const big = r.f() < 0.25;
    s.hit(x, t, { f: r.range(big ? 250 : 500, big ? 600 : 1400), decay: r.range(0.02, 0.06), amp: r.range(0.2, big ? 1 : 0.5), modes: 4, spread: 0.2, tilt: 0.6, noise: 0.5, low: big ? 0.6 : 0.2, lowF: r.range(70, 140), lowDecay: 0.04 });
  }
  const n = x.length; const rum = white(n, r); s.filt(rum, 'lowpass', 200); s.filt(rum, 'lowpass', 200); normPeak(rum);
  const m = s.smooth(n, 3);
  for (let i = 0; i < n; i++) { const u = i / n; x[i] += rum[i] * 0.35 * Math.sin(Math.PI * Math.min(1, u * 1.3)) * (0.7 + 0.3 * m[i]); }
  const xr = x.slice(); s.filt(xr, 'lowpass', 1500);
  mixInto(x, xr, 0.35, s.idx(0.23)); mixInto(x, xr, 0.2, s.idx(0.51));
  g.layer(normPeak(x), 1, g.out, [g.hp(35), g.lp(3500)]);
}

/** Seamless pink-ish wind noise bed (JS only). */
export function windNoise(sr, rng, dur = 6) {
  const xf = Math.round(sr * 0.5); const n = Math.ceil(dur * sr) + xf;
  const x = new Float32Array(n);
  let b0 = 0; let b1 = 0; let b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.bi();
    b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
    x[i] = b0 + b1 + b2 + w * 0.1848;
  }
  biquad(x, 'highpass', 30, 0.707, sr);
  return normPeak(makeSeamless(x, xf), 0.9);
}

/** Seamless loop of distant crickets + faint insect hiss (JS only). Integer cycles -> loops perfectly. */
export function insectLoop(sr, rng, dur = 6) {
  const n = Math.round(dur * sr); const x = new Float32Array(n);
  const crickets = [[4300, 2, 0.5], [4750, 3, 0.35], [5100, 5, 0.25], [3950, 4, 0.3]];
  for (const [fc, rate, amp] of crickets) {
    const f = Math.round(fc * dur) / dur; // integer number of carrier cycles per loop
    const w = (TAU * f) / sr;
    const chirps = Math.max(1, Math.round((rate * dur) / 2.2));
    const chirpLen = n / chirps; const pulses = rng.int(3, 5); const pulseLen = sr / rng.range(28, 36);
    const on = Math.round(pulseLen * 0.6); const off0 = Math.round(rng.f() * chirpLen);
    for (let c = 0; c < chirps; c++) {
      for (let p = 0; p < pulses; p++) {
        const s0 = Math.round(off0 + c * chirpLen + p * pulseLen);
        for (let k = 0; k < on; k++) {
          const i = (s0 + k) % n; // wrap around the loop seam
          x[i] += Math.sin(w * i) * Math.sin((Math.PI * k) / on) * amp;
        }
      }
    }
  }
  const h = white(n, rng); biquad(h, 'bandpass', 7200, 1.2, sr); normPeak(h);
  const m = new Synth(sr, rng).smooth(n, 0.5);
  for (let i = 0; i < n; i++) {
    const u = i / n; const wrap = Math.min(1, u * 20, (1 - u) * 20); // fade the hiss at the seam
    x[i] += h[i] * 0.06 * (0.6 + 0.4 * m[i]) * wrap;
  }
  return normPeak(x, 0.9);
}

// ------------------------------------------------------------------------------ bank building

/** K-weighting-ish loudness (dB RMS) over the first `win` seconds, plus peak. */
export function measure(data, sr, win = 0.15) {
  const n = Math.min(data.length, Math.ceil(win * sr));
  const y = data.slice(0, n);
  biquad(y, 'highpass', 100, 0.5, sr); biquad(y, 'highshelf', 1600, 0.707, sr, 4);
  let e = 0; for (let i = 0; i < n; i++) e += y[i] * y[i];
  let p = 0; for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > p) p = a; }
  return { peak: p, peakDb: gainToDb(p), loudDb: 10 * Math.log10(Math.max(1e-12, e / Math.max(1, n))) };
}

/** Normalise, soft-limit peaks to <= 1, trim the silent tail and fade it out. */
function finalize(buf, norm) {
  const sr = buf.sampleRate; const d = buf.getChannelData(0);
  if (norm) {
    let k = 1;
    if (norm.peak !== undefined) k = dbToGain(norm.peak) / Math.max(1e-9, peakOf(d));
    else if (norm.loud !== undefined) k = dbToGain(norm.loud - measure(d, sr, norm.win || 0.15).loudDb);
    for (let i = 0; i < d.length; i++) {
      let v = d[i] * k; const a = Math.abs(v);
      if (a > 0.9) v = Math.sign(v) * (0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1));
      d[i] = v;
    }
  }
  const thr = dbToGain(norm && norm.trim !== undefined ? norm.trim : -66);
  let last = d.length - 1;
  while (last > 0 && Math.abs(d[last]) < thr) last--;
  const len = Math.min(d.length, last + Math.ceil(0.01 * sr));
  const fade = Math.min(len, Math.ceil(0.006 * sr));
  for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  if (len >= d.length - 64) return buf;
  const out = new AudioBuffer({ length: Math.max(1, len), numberOfChannels: 1, sampleRate: sr });
  out.copyToChannel(d.subarray(0, len), 0);
  return out;
}

/** Wrap JS channel data in an AudioBuffer. */
export function toBuffer(chans, sr) {
  const b = new AudioBuffer({ length: chans[0].length, numberOfChannels: chans.length, sampleRate: sr });
  chans.forEach((d, i) => b.copyToChannel(d, i));
  return b;
}

/** Bytes used by a set of AudioBuffers (float32 per channel). */
export function bufferBytes(bufs) {
  let b = 0;
  for (const x of bufs) if (x) b += x.length * x.numberOfChannels * 4;
  return b;
}

/** Collects every AudioBuffer in a nested bank object. */
export function listBuffers(o, out = []) {
  if (!o) return out;
  if (typeof AudioBuffer !== 'undefined' && o instanceof AudioBuffer) { out.push(o); return out; }
  if (Array.isArray(o)) { o.forEach((v) => listBuffers(v, out)); return out; }
  if (typeof o === 'object') Object.values(o).forEach((v) => listBuffers(v, out));
  return out;
}

const GUN_REF_DB = -14; // K-weighted loudness of the first 100 ms for profile loud = 0

/**
 * Synthesise the whole sound bank.
 * @param {{ sampleRate: number, concurrency?: number, onProgress?: (done:number,total:number)=>void, isCancelled?: ()=>boolean }} opts
 * @returns {Promise<object>} bank with nested AudioBuffers, `meta` (WeakMap buffer->{name,peakDb,loudDb}) and `stats`.
 */
export async function buildBank({ sampleRate, concurrency = 4, onProgress = null, isCancelled = null } = {}) {
  const t0 = now();
  const ctxRate = sampleRate || 48000;
  const hi = Math.min(48000, ctxRate); const lo = Math.round(hi / 2); const far = 11025;
  const bank = {
    gun: {}, gunFar: {}, mech: {}, foot: {}, impact: {}, casing: {}, hit: {}, ui: {}, whiz: { super: [], sub: [] },
    hurt: { local: [], remote: [] }, explosion: { near: [], far: [] }, gear: [], jump: [], land: [], rustle: [],
    rockfall: [], heart: null, smoke: null, wind: null, insects: null, ir: {}, meta: new WeakMap(), stats: {},
  };
  const jobs = [];
  const job = (name, sr, dur, recipe, put, norm) => jobs.push({ name, sr, dur, recipe, put, norm });
  const arr = (o, k) => (o[k] = o[k] || []);

  // UI & feedback first: they are needed immediately (menus)
  const longUI = ['spawn', 'match_start', 'match_end', 'killstreak', 'error'];
  for (const n of UI_NAMES) {
    job(`ui.${n}`, longUI.includes(n) ? lo : hi, n.startsWith('match') ? 1.7 : n === 'spawn' ? 0.9 : 0.6, (g, s) => rUI(g, s, n),
      (b) => { bank.ui[n] = b; }, { peak: -3, trim: -60 });
  }
  for (const k of HITMARKER_KINDS) job(`hit.${k}`, hi, 0.5, (g, s) => rHitmarker(g, s, k), (b) => { bank.hit[k] = b; }, { peak: -2, trim: -60 });
  // weapons
  for (const p of GUN_PROFILE_NAMES) {
    const P = GUN_PROFILES[p]; bank.gun[p] = { n: [], s: [] };
    for (let v = 0; v < 3; v++) job(`gun.${p}.${v}`, hi, P.len, (g, s) => rGun(g, s, P, false), (b) => { bank.gun[p].n[v] = b; }, { loud: GUN_REF_DB + P.loud, win: 0.1, trim: -58 });
    for (let v = 0; v < 2; v++) {
      job(`gun.${p}.sup${v}`, hi, Math.min(P.len, 0.45), (g, s) => rGun(g, s, P, true), (b) => { bank.gun[p].s[v] = b; },
        { loud: GUN_REF_DB + P.loud - (P.supersonic ? 8 : 11), win: 0.1, trim: -58 });
    }
  }
  for (const c of Object.keys(FAR_CLASSES)) {
    const C = FAR_CLASSES[c];
    for (let v = 0; v < 2; v++) job(`far.${c}.${v}`, far, C.ir + 0.35, (g, s) => rGunFar(g, s, C), (b) => { arr(bank.gunFar, c)[v] = b; }, { loud: -17, win: 0.3, trim: -56 });
  }
  for (const m of MECH_NAMES) job(`mech.${m}`, hi, MECH[m][0], (g, s) => rMech(g, s, m), (b) => { bank.mech[m] = b; }, { peak: -3, trim: -60 });
  for (const f of FOOT_SURFACES) for (let v = 0; v < 4; v++) job(`foot.${f}.${v}`, hi, 0.4, (g, s) => rFoot(g, s, f), (b) => { arr(bank.foot, f)[v] = b; }, { peak: -3, trim: -58 });
  for (const f of IMPACT_SURFACES) for (let v = 0; v < 3; v++) job(`impact.${f}.${v}`, hi, f === 'metal' ? 0.75 : 0.5, (g, s) => rImpact(g, s, f, v), (b) => { arr(bank.impact, f)[v] = b; }, { peak: -2, trim: -60 });
  for (let v = 0; v < 3; v++) {
    job(`whiz.super.${v}`, hi, 0.3, (g, s) => rWhiz(g, s, true), (b) => { bank.whiz.super[v] = b; }, { peak: -1 });
    job(`whiz.sub.${v}`, hi, 0.4, (g, s) => rWhiz(g, s, false), (b) => { bank.whiz.sub[v] = b; }, { peak: -3 });
  }
  for (const k of CASING_KINDS) for (let v = 0; v < 3; v++) job(`casing.${k}.${v}`, hi, k === 'big' ? 0.8 : 0.6, (g, s) => rCasing(g, s, k), (b) => { arr(bank.casing, k)[v] = b; }, { peak: -3, trim: -58 });
  for (let v = 0; v < 3; v++) job(`gear.${v}`, hi, 0.3, (g, s) => rGear(g, s), (b) => { bank.gear[v] = b; }, { peak: -3 });
  for (let v = 0; v < 2; v++) job(`jump.${v}`, hi, 0.45, (g, s) => rJump(g, s), (b) => { bank.jump[v] = b; }, { peak: -3 });
  for (let v = 0; v < 3; v++) job(`land.${v}`, hi, 0.5, (g, s) => rLand(g, s), (b) => { bank.land[v] = b; }, { peak: -2 });
  for (let v = 0; v < 2; v++) {
    job(`hurt.local.${v}`, hi, 0.45, (g, s) => rHurt(g, s, true), (b) => { bank.hurt.local[v] = b; }, { peak: -2 });
    job(`hurt.remote.${v}`, hi, 0.45, (g, s) => rHurt(g, s, false), (b) => { bank.hurt.remote[v] = b; }, { peak: -3 });
  }
  job('heart', lo, 0.6, (g, s) => rHeart(g, s), (b) => { bank.heart = b; }, { peak: -3 });
  for (let v = 0; v < 2; v++) {
    job(`explosion.near.${v}`, lo, 2.6, (g, s) => rExplosion(g, s), (b) => { bank.explosion.near[v] = b; }, { peak: -0.5, trim: -60 });
    job(`explosion.far.${v}`, far, 4.2, (g, s) => rExplosionFar(g, s), (b) => { bank.explosion.far[v] = b; }, { loud: -15, win: 0.5, trim: -56 });
  }
  job('smoke', lo, 3.3, (g, s) => rSmoke(g, s), (b) => { bank.smoke = b; }, { peak: -3 });
  for (let v = 0; v < 3; v++) job(`rustle.${v}`, lo, 2.4, (g, s) => rRustle(g, s), (b) => { bank.rustle[v] = b; }, { peak: -3 });
  for (let v = 0; v < 2; v++) job(`rockfall.${v}`, far, 4.2, (g, s) => rRockfall(g, s), (b) => { bank.rockfall[v] = b; }, { peak: -2, trim: -60 });

  // JS-only assets (no rendering): loops and impulse responses at the context rate
  const irRng = new Rng(hashString('ir')); const irCh = [];
  const jsAssets = [
    () => { irCh[0] = outdoorIRChannel(ctxRate, irRng, 0); },
    () => { irCh[1] = outdoorIRChannel(ctxRate, irRng, 1); bank.ir.outdoor = toBuffer([irCh[0], irCh[1]], ctxRate); },
    () => { irCh[2] = indoorIRChannel(ctxRate, irRng, 0); },
    () => { irCh[3] = indoorIRChannel(ctxRate, irRng, 1); bank.ir.indoor = toBuffer([irCh[2], irCh[3]], ctxRate); },
    () => { bank.wind = toBuffer([windNoise(lo, new Rng(hashString('wind')))], lo); },
    () => { bank.insects = toBuffer([insectLoop(lo, new Rng(hashString('insects')))], lo); },
  ];

  const total = jobs.length + jsAssets.length; let done = 0; let maxBlock = 0; let next = 0; const timings = [];
  const tick = () => { done++; if (onProgress) { try { onProgress(done, total); } catch { /* ignore */ } } };
  for (const a of jsAssets) {
    const ts = now(); a(); maxBlock = Math.max(maxBlock, now() - ts); tick();
    await new Promise((res) => setTimeout(res, 0));
  }
  const worker = async () => {
    while (next < jobs.length) {
      if (isCancelled && isCancelled()) return;
      const jb = jobs[next++];
      let ts = now();
      try {
        const g = new Graph(jb.sr, jb.dur);
        const s = new Synth(jb.sr, new Rng(hashString(jb.name)));
        jb.recipe(g, s);
        const p = g.render();
        const tb = now() - ts;
        const tr0 = now();
        const rendered = await p;
        const tr = now() - tr0;
        ts = now();
        const b = finalize(rendered, jb.norm);
        const m = measure(b.getChannelData(0), b.sampleRate);
        bank.meta.set(b, { name: jb.name, peakDb: m.peakDb, loudDb: m.loudDb });
        jb.put(b);
        const tf = now() - ts;
        maxBlock = Math.max(maxBlock, tb, tf);
        timings.push({ name: jb.name, build: tb, render: tr, fin: tf, bytes: b.length * 4 });
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('[audio] synth failed:', jb.name, e);
      }
      tick();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  const bufs = listBuffers(bank);
  bank.stats = { ms: Math.round(now() - t0), maxBlockMs: Math.round(maxBlock * 10) / 10, buffers: bufs.length, bytes: bufferBytes(bufs), rates: { hi, lo, far, ctx: ctxRate }, timings };
  return bank;
}
