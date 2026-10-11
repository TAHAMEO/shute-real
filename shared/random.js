// Deterministic random numbers. Only integer math and basic float arithmetic are used,
// so results are bit-identical in every JS engine (server: V8, clients: V8/SpiderMonkey).

/** 32-bit string hash (FNV-1a). */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hash of integer coordinates -> [0,1). */
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class RNG {
  constructor(seed = 1) {
    this.state = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
    if (this.state === 0) this.state = 0x6d2b79f5;
  }

  /** Float in [0, 1). mulberry32. */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) {
    return a + (b - a) * this.next();
  }

  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Approximately normal distribution (Irwin-Hall, deterministic without Math.log). */
  normal(mean = 0, sd = 1) {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.next();
    return mean + (s - 3) * sd * 1.4142;
  }

  /** Weighted pick: items = [[value, weight], ...]. */
  weighted(items) {
    let total = 0;
    for (const it of items) total += it[1];
    let r = this.next() * total;
    for (const it of items) {
      r -= it[1];
      if (r <= 0) return it[0];
    }
    return items[items.length - 1][0];
  }

  fork(salt) {
    return new RNG((Math.imul(this.state ^ hashString(String(salt)), 0x9e3779b1) >>> 0) || 1);
  }
}
