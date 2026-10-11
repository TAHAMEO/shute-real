// Shared GLSL snippets: hashing, tileable (periodic) noise, fbm, voronoi, colour helpers.

export const GLSL_NOISE = /* glsl */ `
// Hash without sine (Dave Hoskins), stable across GPUs.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// Periodic gradient noise: tiles with period 'per' (integer lattice units).
vec2 pgrad(vec2 i, vec2 per) {
  i = mod(i, per);
  vec2 h = hash22(i + 0.5) * 2.0 - 1.0;
  return normalize(h + 1e-4);
}
float pnoise(vec2 p, vec2 per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(pgrad(i, per), f);
  float b = dot(pgrad(i + vec2(1.0, 0.0), per), f - vec2(1.0, 0.0));
  float c = dot(pgrad(i + vec2(0.0, 1.0), per), f - vec2(0.0, 1.0));
  float d = dot(pgrad(i + vec2(1.0, 1.0), per), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.414;
}
// fbm over a [0,1) tile, base frequency 'freq' (integer), tiles seamlessly.
float pfbm(vec2 uv, float freq, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  vec2 per = vec2(freq);
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * pnoise(uv * per, per);
    n += a;
    a *= 0.5;
    per *= 2.0;
  }
  return s / n;
}
float pridged(vec2 uv, float freq, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  vec2 per = vec2(freq);
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float v = 1.0 - abs(pnoise(uv * per, per));
    s += a * v * v;
    n += a;
    a *= 0.5;
    per *= 2.0;
  }
  return s / n;
}
// Periodic voronoi: returns (F1 distance, F2 distance, cell id hash).
vec3 pvoronoi(vec2 p, vec2 per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 cell = mod(i + g, per);
      vec2 o = hash22(cell + 0.37);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = hash12(cell + 7.1); }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
vec3 srgbToLinear(vec3 c) { return pow(c, vec3(2.2)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Non-periodic value noise (for world-space effects).
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float vfbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
`;

/** ACES filmic tone mapping (Stephen Hill fit) + helpers for the final pass. */
export const GLSL_TONEMAP = /* glsl */ `
vec3 RRTAndODTFitSR(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilmic(vec3 color) {
  const mat3 ACESInputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602));
  color = ACESInputMat * color;
  color = RRTAndODTFitSR(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;
