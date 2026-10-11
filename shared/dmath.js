// Deterministic trig for world generation. Math.sin/cos may differ in the last bit between
// JS engines; these use only + - * / so the server and all clients agree exactly.
const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

export function dsin(x) {
  x = x - TWO_PI * Math.round(x / TWO_PI);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  // Taylor series to x^15 (error < 1e-11 on [-pi/2, pi/2]).
  return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110 * (1 - x2 / 156 * (1 - x2 / 210)))))));
}

export function dcos(x) {
  return dsin(x + HALF_PI);
}

export { PI, TWO_PI, HALF_PI };

/** Deterministic atan2 (polynomial, max error ~1e-9 rad). */
export function datan2(y, x) {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x), ay = Math.abs(y);
  const swap = ay > ax;
  const a = swap ? ax / ay : ay / ax; // in [0, 1]
  // Range reduction: atan(a) = pi/4 + atan((a - 1) / (a + 1)) for a > tan(pi/8).
  let r;
  if (a > 0.41421356237309503) {
    const b = (a - 1) / (a + 1);
    r = 0.7853981633974483 + atanSmall(b);
  } else {
    r = atanSmall(a);
  }
  if (swap) r = HALF_PI - r;
  if (x < 0) r = PI - r;
  return y < 0 ? -r : r;
}

function atanSmall(z) {
  // |z| <= tan(pi/8) ~ 0.4142: Taylor series converges quickly.
  const z2 = z * z;
  let term = z, sum = z;
  for (let k = 1; k < 16; k++) {
    term *= -z2;
    sum += term / (2 * k + 1);
  }
  return sum;
}
