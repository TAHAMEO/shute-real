// Procedural surface recipes (GLSL) for terrain and structures, baked by TextureBaker.
// Every recipe tiles seamlessly over uv in [0,1). `tile` = real-world size (m) of one tile.

const v3 = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `vec3(${(((n >> 16) & 255) / 255).toFixed(4)}, ${(((n >> 8) & 255) / 255).toFixed(4)}, ${((n & 255) / 255).toFixed(4)})`;
};

// ------------------------------------------------------------------ terrain
export const TERRAIN_RECIPES = {
  grass: {
    name: 't_grass', tile: 5, size: 1024, normalStrength: 1.6,
    glsl: /* glsl */ `
      float blades(vec2 uv) {
        // Short strokes: a lattice of cells each holding a randomly oriented blade segment.
        vec2 per = vec2(96.0);
        vec2 p = uv * per;
        vec2 ip = floor(p);
        float m = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 c = ip + vec2(float(x), float(y));
          vec2 cw = mod(c, per);
          vec2 r = hash22(cw);
          vec2 a = c + r;
          float ang = (hash12(cw + 3.1) - 0.5) * 1.6 + 1.5708;
          vec2 dir = vec2(cos(ang), sin(ang));
          float len = 0.9 + hash12(cw + 9.2) * 1.4;
          vec2 pa = p - a;
          float t = clamp(dot(pa, dir), 0.0, len);
          float d = length(pa - dir * t);
          float w = 0.09 * (1.0 - t / len * 0.7);
          m = max(m, (1.0 - smoothstep(w * 0.6, w, d)) * (0.55 + 0.45 * t / len));
        }
        return m;
      }
      float H(vec2 uv) {
        return pfbm(uv, 6.0, 4) * 0.25 + 0.3 + blades(uv) * 0.5;
      }
      vec3 C(vec2 uv, float h) {
        float patches = pfbm(uv + 0.31, 3.0, 4) * 0.5 + 0.5;
        float fine = pfbm(uv, 24.0, 3) * 0.5 + 0.5;
        vec3 green = ${v3('#55622a')};
        vec3 dry = ${v3('#8f8045')};
        vec3 soil = ${v3('#4c3f2c')};
        float b = blades(uv);
        vec3 col = mix(green, dry, smoothstep(0.3, 0.8, patches * 0.7 + fine * 0.3));
        col = mix(soil, col, smoothstep(0.08, 0.5, b + fine * 0.35));
        col *= 0.85 + b * 0.3;
        return col;
      }
      float R(vec2 uv, float h) { return 0.88; }
    `,
  },
  dirt: {
    name: 't_dirt', tile: 4, size: 1024, normalStrength: 2.4,
    glsl: /* glsl */ `
      float pebbles(vec2 uv, out float id) {
        vec3 v = pvoronoi(uv * 34.0, vec2(34.0));
        id = v.z;
        float r = 0.12 + fract(id * 7.3) * 0.32;
        return (1.0 - smoothstep(r * 0.5, r, v.x)) * step(0.72, id);
      }
      float H(vec2 uv) {
        float id;
        float p = pebbles(uv, id);
        float base = pfbm(uv, 5.0, 5) * 0.5 + 0.5;
        float ruts = pridged(uv + 0.2, 3.0, 3);
        return base * 0.45 + p * 0.45 + ruts * 0.1;
      }
      vec3 C(vec2 uv, float h) {
        float id;
        float p = pebbles(uv, id);
        float n = pfbm(uv + 0.7, 8.0, 5) * 0.5 + 0.5;
        vec3 soil = mix(${v3('#5a4532')}, ${v3('#8a6d4d')}, n);
        float dryPatch = smoothstep(0.45, 0.7, pfbm(uv + 0.13, 3.0, 3) * 0.5 + 0.5);
        soil = mix(soil, ${v3('#9c8462')}, dryPatch * 0.5);
        vec3 stone = mix(${v3('#6a6157')}, ${v3('#9a9081')}, hash12(vec2(id * 91.0)));
        vec3 col = mix(soil, stone, p);
        col *= 0.8 + h * 0.35;
        return col;
      }
      float R(vec2 uv, float h) { return 0.92; }
    `,
  },
  rock: {
    name: 't_rock', tile: 9, size: 1024, normalStrength: 3.0,
    glsl: /* glsl */ `
      float cracks(vec2 uv) {
        vec2 w = vec2(pfbm(uv + 1.7, 3.0, 3), pfbm(uv + 4.1, 3.0, 3)) * 0.18;
        vec3 v = pvoronoi((uv + w) * 4.0, vec2(4.0));
        float line = 1.0 - smoothstep(0.0, 0.025, v.y - v.x);
        float mask = smoothstep(0.45, 0.6, pfbm(uv + 8.2, 2.0, 3) * 0.5 + 0.5);
        return line * mask;
      }
      float H(vec2 uv) {
        float r = pridged(uv + 0.3, 3.0, 6);
        float strata = pfbm(vec2(uv.x * 0.5, uv.y * 3.0) + pfbm(uv, 2.0, 2) * 0.3, 4.0, 4) * 0.5 + 0.5;
        float fine = pfbm(uv, 48.0, 3);
        return r * 0.55 + strata * 0.25 - cracks(uv) * 0.3 + fine * 0.06 + 0.1;
      }
      vec3 C(vec2 uv, float h) {
        float n = pfbm(uv + 0.5, 5.0, 5) * 0.5 + 0.5;
        vec3 col = mix(${v3('#5f5c57')}, ${v3('#a6a298')}, smoothstep(0.15, 0.9, n * 0.55 + h * 0.6));
        float sp = pnoise(uv * 320.0, vec2(320.0));
        col = mix(col, ${v3('#34322f')}, smoothstep(0.5, 0.75, sp) * 0.45);
        col = mix(col, ${v3('#dcd7cc')}, smoothstep(0.55, 0.8, -sp) * 0.3);
        float li = pfbm(uv + 3.3, 6.0, 5) * 0.5 + 0.5;
        col = mix(col, ${v3('#878a52')}, smoothstep(0.63, 0.75, li) * 0.5);
        col = mix(col, ${v3('#c4c6b6')}, smoothstep(0.66, 0.72, pfbm(uv + 7.7, 10.0, 3) * 0.5 + 0.5) * 0.35);
        col *= 1.0 - cracks(uv) * 0.5;
        col *= 0.88 + (pfbm(uv + 11.0, 2.0, 3) * 0.5 + 0.5) * 0.2;
        return col;
      }
      float R(vec2 uv, float h) { return 0.84 - h * 0.12; }
    `,
  },
  forest: {
    name: 't_forest', tile: 4, size: 1024, normalStrength: 2.0,
    glsl: /* glsl */ `
      float needles(vec2 uv, out float tint) {
        vec2 per = vec2(64.0);
        vec2 p = uv * per;
        vec2 ip = floor(p);
        float m = 0.0;
        tint = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 c = mod(ip + vec2(float(x), float(y)), per);
          for (int k = 0; k < 2; k++) {
            vec2 cc = c + float(k) * 13.7;
            vec2 a = ip + vec2(float(x), float(y)) + hash22(cc);
            float ang = hash12(cc + 1.3) * 6.2831;
            vec2 dir = vec2(cos(ang), sin(ang));
            vec2 pa = p - a;
            float t = clamp(dot(pa, dir), -0.9, 0.9);
            float d = length(pa - dir * t);
            float v = 1.0 - smoothstep(0.03, 0.07, d);
            if (v > m) { m = v; tint = hash12(cc + 5.5); }
          }
        }
        return m;
      }
      float H(vec2 uv) {
        float tint;
        return pfbm(uv, 6.0, 4) * 0.3 + 0.35 + needles(uv, tint) * 0.4;
      }
      vec3 C(vec2 uv, float h) {
        float tint;
        float nd = needles(uv, tint);
        vec3 soil = mix(${v3('#3a2c1e')}, ${v3('#5a4430')}, pfbm(uv, 10.0, 4) * 0.5 + 0.5);
        vec3 needle = mix(${v3('#7a5634')}, ${v3('#a87a49')}, tint);
        needle = mix(needle, ${v3('#4f5a2c')}, step(0.85, tint) * 0.7);
        vec3 col = mix(soil, needle, nd);
        float moss = smoothstep(0.55, 0.75, pfbm(uv + 2.0, 4.0, 4) * 0.5 + 0.5);
        col = mix(col, ${v3('#4d5a26')}, moss * 0.45 * (1.0 - nd));
        return col;
      }
      float R(vec2 uv, float h) { return 0.9; }
    `,
  },
  gravel: {
    name: 't_gravel', tile: 3, size: 1024, normalStrength: 3.0,
    glsl: /* glsl */ `
      float H(vec2 uv) {
        vec3 v = pvoronoi(uv * 40.0, vec2(40.0));
        float stone = 1.0 - smoothstep(0.25, 0.62, v.x);
        vec3 v2 = pvoronoi(uv * 90.0 + 0.5, vec2(90.0));
        float small = 1.0 - smoothstep(0.2, 0.6, v2.x);
        return stone * 0.6 + small * 0.3 + pfbm(uv, 8.0, 3) * 0.1;
      }
      vec3 C(vec2 uv, float h) {
        vec3 v = pvoronoi(uv * 40.0, vec2(40.0));
        vec3 a = mix(${v3('#6b6862')}, ${v3('#a19d93')}, v.z);
        a = mix(a, ${v3('#857560')}, step(0.8, v.z) * 0.6);
        vec3 grit = ${v3('#4f4a42')};
        return mix(grit, a, smoothstep(0.1, 0.5, h)) * (0.85 + h * 0.3);
      }
      float R(vec2 uv, float h) { return 0.85; }
    `,
  },
};

// ------------------------------------------------------------------ structures
function woodRecipe(name, light, dark, gapColor, opts = {}) {
  const boards = opts.boards || 10;
  const vertical = opts.vertical ? 1 : 0;
  return {
    name, tile: opts.tile || 2, size: 1024, normalStrength: 2.2,
    glsl: /* glsl */ `
      vec2 orient(vec2 uv) { return ${vertical} == 1 ? uv.yx : uv; }
      float board(vec2 uv, out float id, out float across) {
        uv = orient(uv);
        float b = uv.y * ${boards.toFixed(1)};
        id = floor(b);
        across = fract(b);
        return id;
      }
      float grain(vec2 uv, float id) {
        uv = orient(uv);
        float off = hash12(vec2(id, 3.0)) * 10.0;
        float g = pnoise(vec2(uv.x * 6.0 + off, uv.y * 120.0), vec2(6.0, 120.0));
        g += 0.5 * pnoise(vec2(uv.x * 24.0 + off, uv.y * 300.0), vec2(24.0, 300.0));
        return g;
      }
      float H(vec2 uv) {
        float id, ac;
        board(uv, id, ac);
        float gap = smoothstep(0.0, 0.06, ac) * smoothstep(1.0, 0.94, ac);
        return gap * (0.7 + grain(uv, id) * 0.08 + hash12(vec2(id, 1.0)) * 0.15);
      }
      vec3 C(vec2 uv, float h) {
        float id, ac;
        board(uv, id, ac);
        float r = hash12(vec2(id, 7.0));
        float g = grain(uv, id);
        vec3 col = mix(${v3(dark)}, ${v3(light)}, clamp(r * 0.6 + 0.2 + g * 0.25, 0.0, 1.0));
        // weathering streaks + dirt
        float w = pfbm(uv + 0.4, 4.0, 4) * 0.5 + 0.5;
        col = mix(col, col * 0.7, smoothstep(0.55, 0.8, w) * 0.6);
        float gap = smoothstep(0.0, 0.06, ac) * smoothstep(1.0, 0.94, ac);
        col = mix(${v3(gapColor)}, col, gap);
        // nails
        vec2 ou = orient(uv);
        vec2 nailP = vec2(fract(ou.x * 2.0 + hash12(vec2(id, 2.0)) * 0.1) - 0.5, ac - 0.5);
        col = mix(col, ${v3('#2a2622')}, (1.0 - smoothstep(0.004, 0.012, length(nailP * vec2(1.0, 0.25)))) * 0.8);
        return col;
      }
      float R(vec2 uv, float h) { return 0.78 + h * 0.1; }
    `,
  };
}

function corrugatedRecipe(name, base, rust) {
  return {
    name, tile: 2, size: 1024, normalStrength: 2.5,
    glsl: /* glsl */ `
      float H(vec2 uv) {
        float s = sin(uv.x * 6.2831 * 24.0) * 0.5 + 0.5;
        return s * 0.8 + pfbm(uv, 8.0, 3) * 0.05 + 0.1;
      }
      vec3 C(vec2 uv, float h) {
        float n = pfbm(uv, 4.0, 4) * 0.5 + 0.5;
        vec3 col = mix(${v3(base)} * 0.8, ${v3(base)}, n);
        // vertical rust streaks running down the slope
        float streak = pfbm(vec2(uv.x * 1.0, uv.y * 0.2) + 0.7, 8.0, 4) * 0.5 + 0.5;
        float rustAmt = smoothstep(${rust.toFixed(2)}, ${(rust + 0.25).toFixed(2)}, pfbm(uv + 1.3, 3.0, 5) * 0.5 + 0.5 + streak * 0.25);
        vec3 rustCol = mix(${v3('#6b3a1e')}, ${v3('#a35a2a')}, pfbm(uv + 5.0, 16.0, 3) * 0.5 + 0.5);
        col = mix(col, rustCol, rustAmt);
        col *= 0.75 + h * 0.35;
        return col;
      }
      float R(vec2 uv, float h) { return 0.55; }
    `,
  };
}

function concreteRecipe(name, light, dark, opts = {}) {
  return {
    name, tile: opts.tile || 3, size: 1024, normalStrength: 1.6,
    glsl: /* glsl */ `
      float H(vec2 uv) {
        float pores = 1.0 - smoothstep(0.55, 0.7, pnoise(uv * 180.0, vec2(180.0)));
        float form = ${opts.formLines ? 'smoothstep(0.0, 0.01, abs(fract(uv.y * 4.0) - 0.5) - 0.49) * 0.0 + (1.0 - smoothstep(0.0, 0.012, abs(fract(uv.y * 4.0) - 0.5) - 0.488))' : '0.0'};
        return 0.6 + pfbm(uv, 6.0, 5) * 0.15 - (1.0 - pores) * 0.25 - form * 0.2;
      }
      vec3 C(vec2 uv, float h) {
        float n = pfbm(uv + 0.2, 5.0, 6) * 0.5 + 0.5;
        vec3 col = mix(${v3(dark)}, ${v3(light)}, n);
        float stain = pfbm(vec2(uv.x * 3.0, uv.y * 0.6) + 2.0, 4.0, 4) * 0.5 + 0.5;
        col = mix(col, col * 0.72, smoothstep(0.55, 0.85, stain) * 0.7);
        float pores = smoothstep(0.55, 0.7, pnoise(uv * 180.0, vec2(180.0)));
        col *= 1.0 - pores * 0.25;
        float moss = smoothstep(0.7, 0.85, pfbm(uv + 9.0, 6.0, 4) * 0.5 + 0.5);
        col = mix(col, ${v3('#5d6136')}, moss * ${opts.moss ? '0.4' : '0.0'});
        return col;
      }
      float R(vec2 uv, float h) { return 0.9; }
    `,
  };
}

export const STRUCTURE_RECIPES = {
  wood: woodRecipe('s_wood', '#8a6a48', '#4e3a26', '#1c140c'),
  wood_dark: woodRecipe('s_wood_dark', '#5e4630', '#2e2218', '#120d08'),
  plank_grey: woodRecipe('s_plank_grey', '#9a9286', '#5b544b', '#1e1b17', { boards: 8 }),
  wood_floor: woodRecipe('s_wood_floor', '#7a5e40', '#46341f', '#1a120a', { boards: 12, vertical: true }),
  wood_beam: {
    name: 's_wood_beam', tile: 1.5, size: 512, normalStrength: 1.5,
    glsl: /* glsl */ `
      float H(vec2 uv) { return 0.5 + pnoise(vec2(uv.x * 4.0, uv.y * 64.0), vec2(4.0, 64.0)) * 0.2; }
      vec3 C(vec2 uv, float h) {
        float g = pnoise(vec2(uv.x * 8.0, uv.y * 96.0), vec2(8.0, 96.0)) * 0.5 + 0.5;
        return mix(${v3('#2f2216')}, ${v3('#5d4530')}, g * 0.7 + (pfbm(uv, 3.0, 3) * 0.5 + 0.5) * 0.3);
      }
      float R(vec2 uv, float h) { return 0.8; }
    `,
  },
  corrugated: corrugatedRecipe('s_corrugated', '#8d9196', 0.72),
  corrugated_rust: corrugatedRecipe('s_corrugated_rust', '#7b746c', 0.42),
  concrete: concreteRecipe('s_concrete', '#b0aca3', '#7f7b73', { formLines: true, moss: true }),
  concrete_dark: concreteRecipe('s_concrete_dark', '#5d5b57', '#3a3936', { tile: 4 }),
  plaster: concreteRecipe('s_plaster', '#c9b89a', '#a08c6d', { tile: 3 }),
  plaster_white: concreteRecipe('s_plaster_white', '#dcd6cb', '#b4ab9c', { tile: 3 }),
  stone: {
    name: 's_stone', tile: 2.5, size: 1024, normalStrength: 3.2,
    glsl: /* glsl */ `
      vec3 cell(vec2 uv) { return pvoronoi(uv * vec2(6.0, 9.0), vec2(6.0, 9.0)); }
      float H(vec2 uv) {
        vec3 v = cell(uv);
        float mortar = smoothstep(0.02, 0.12, v.y - v.x);
        return mortar * (0.6 + pfbm(uv, 12.0, 3) * 0.2 + v.z * 0.15);
      }
      vec3 C(vec2 uv, float h) {
        vec3 v = cell(uv);
        vec3 stone = mix(${v3('#6c665c')}, ${v3('#a59d8d')}, v.z);
        stone = mix(stone, ${v3('#857055')}, step(0.75, v.z) * 0.5);
        stone *= 0.8 + (pfbm(uv, 16.0, 3) * 0.5 + 0.5) * 0.35;
        float mortar = smoothstep(0.02, 0.12, v.y - v.x);
        return mix(${v3('#58534a')}, stone, mortar);
      }
      float R(vec2 uv, float h) { return 0.88; }
    `,
  },
  brick: {
    name: 's_brick', tile: 1.5, size: 1024, normalStrength: 2.5,
    glsl: /* glsl */ `
      vec2 brickUv(vec2 uv, out vec2 id) {
        vec2 p = uv * vec2(6.0, 20.0);
        float row = floor(p.y);
        p.x += mod(row, 2.0) * 0.5;
        id = vec2(floor(p.x), row);
        return fract(p);
      }
      float H(vec2 uv) {
        vec2 id; vec2 f = brickUv(uv, id);
        float m = smoothstep(0.0, 0.05, f.x) * smoothstep(1.0, 0.95, f.x) * smoothstep(0.0, 0.12, f.y) * smoothstep(1.0, 0.88, f.y);
        return m * (0.7 + pfbm(uv, 16.0, 3) * 0.15);
      }
      vec3 C(vec2 uv, float h) {
        vec2 id; vec2 f = brickUv(uv, id);
        float r = hash12(mod(id, vec2(6.0, 20.0)));
        vec3 b = mix(${v3('#7a3424')}, ${v3('#a5543a')}, r);
        b *= 0.85 + (pfbm(uv, 24.0, 3) * 0.5 + 0.5) * 0.3;
        float m = smoothstep(0.0, 0.05, f.x) * smoothstep(1.0, 0.95, f.x) * smoothstep(0.0, 0.12, f.y) * smoothstep(1.0, 0.88, f.y);
        return mix(${v3('#8f877a')}, b, m);
      }
      float R(vec2 uv, float h) { return 0.85; }
    `,
  },
  container: {
    name: 's_container', tile: 2.6, size: 1024, normalStrength: 3.0,
    glsl: /* glsl */ `
      float H(vec2 uv) {
        float x = fract(uv.x * 9.0);
        float rib = smoothstep(0.1, 0.25, x) * (1.0 - smoothstep(0.55, 0.7, x));
        return rib * 0.8 + 0.1 + pfbm(uv, 8.0, 3) * 0.04;
      }
      vec3 C(vec2 uv, float h) {
        // light neutral paint (tinted by material colour) + rust + grime toward the bottom
        vec3 paint = vec3(0.86) * (0.9 + (pfbm(uv, 6.0, 4) * 0.5 + 0.5) * 0.15);
        float rust = smoothstep(0.62, 0.8, pfbm(uv + 4.4, 5.0, 5) * 0.5 + 0.5 + (1.0 - uv.y) * 0.15);
        vec3 col = mix(paint, ${v3('#6a3b1f')} * 1.6, rust);
        col *= mix(0.62, 1.0, smoothstep(0.0, 0.35, uv.y));
        float scratch = smoothstep(0.92, 0.97, pnoise(vec2(uv.x * 4.0, uv.y * 200.0), vec2(4.0, 200.0)));
        col = mix(col, vec3(0.35, 0.3, 0.27), scratch * 0.5);
        return col;
      }
      float R(vec2 uv, float h) { return 0.6; }
    `,
  },
  metal_rust: {
    name: 's_metal_rust', tile: 2, size: 512, normalStrength: 2.0,
    glsl: /* glsl */ `
      float H(vec2 uv) { return 0.5 + pfbm(uv, 8.0, 5) * 0.2; }
      vec3 C(vec2 uv, float h) {
        float n = pfbm(uv + 0.5, 4.0, 6) * 0.5 + 0.5;
        vec3 paint = ${v3('#5a5f52')};
        vec3 rust = mix(${v3('#5a2f17')}, ${v3('#a4572b')}, pfbm(uv, 16.0, 3) * 0.5 + 0.5);
        return mix(paint, rust, smoothstep(0.35, 0.6, n));
      }
      float R(vec2 uv, float h) { return 0.7; }
    `,
  },
  metal_dark: {
    name: 's_metal_dark', tile: 2, size: 512, normalStrength: 1.0,
    glsl: /* glsl */ `
      float H(vec2 uv) { return 0.5 + pfbm(uv, 16.0, 3) * 0.05; }
      vec3 C(vec2 uv, float h) {
        float n = pfbm(uv, 6.0, 4) * 0.5 + 0.5;
        vec3 col = mix(${v3('#2c2e2f')}, ${v3('#45484a')}, n);
        float sc = smoothstep(0.9, 0.97, pnoise(vec2(uv.x * 160.0, uv.y * 6.0), vec2(160.0, 6.0)));
        return mix(col, ${v3('#7d7f80')}, sc * 0.4);
      }
      float R(vec2 uv, float h) { return 0.5; }
    `,
  },
  steel: {
    name: 's_steel', tile: 2, size: 512, normalStrength: 0.8,
    glsl: /* glsl */ `
      float H(vec2 uv) { return 0.5 + pfbm(uv, 12.0, 3) * 0.05; }
      vec3 C(vec2 uv, float h) {
        float n = pfbm(uv, 5.0, 5) * 0.5 + 0.5;
        vec3 col = mix(${v3('#7c8084')}, ${v3('#a7abae')}, n);
        float rust = smoothstep(0.7, 0.85, pfbm(uv + 3.0, 4.0, 4) * 0.5 + 0.5);
        return mix(col, ${v3('#7b4a2a')}, rust * 0.6);
      }
      float R(vec2 uv, float h) { return 0.45; }
    `,
  },
  sandbag: {
    name: 's_sandbag', tile: 1, size: 512, normalStrength: 1.6,
    glsl: /* glsl */ `
      float H(vec2 uv) {
        float weave = (sin(uv.x * 6.2831 * 90.0) * sin(uv.y * 6.2831 * 90.0)) * 0.5 + 0.5;
        return 0.5 + weave * 0.15 + pfbm(uv, 6.0, 4) * 0.2;
      }
      vec3 C(vec2 uv, float h) {
        float n = pfbm(uv, 4.0, 5) * 0.5 + 0.5;
        vec3 col = mix(${v3('#6f6248')}, ${v3('#a39272')}, n);
        float dirt = smoothstep(0.55, 0.8, pfbm(uv + 2.0, 3.0, 4) * 0.5 + 0.5);
        col = mix(col, ${v3('#4b3f2c')}, dirt * 0.5);
        return col * (0.85 + h * 0.3);
      }
      float R(vec2 uv, float h) { return 0.95; }
    `,
  },
  hay: {
    name: 's_hay', tile: 1.5, size: 512, normalStrength: 2.0,
    glsl: /* glsl */ `
      float H(vec2 uv) {
        float s = pnoise(vec2(uv.x * 8.0, uv.y * 140.0), vec2(8.0, 140.0)) * 0.5 + 0.5;
        float s2 = pnoise(vec2(uv.x * 140.0, uv.y * 8.0) + 3.0, vec2(140.0, 8.0)) * 0.5 + 0.5;
        return max(s, s2 * 0.8);
      }
      vec3 C(vec2 uv, float h) {
        vec3 col = mix(${v3('#8a7537')}, ${v3('#d9bf6a')}, h);
        col = mix(col, ${v3('#6d6a3a')}, smoothstep(0.6, 0.8, pfbm(uv, 4.0, 4) * 0.5 + 0.5) * 0.4);
        return col;
      }
      float R(vec2 uv, float h) { return 0.95; }
    `,
  },
  tarp: {
    name: 's_tarp', tile: 2, size: 512, normalStrength: 1.2,
    glsl: /* glsl */ `
      float H(vec2 uv) {
        float weave = (sin(uv.x * 6.2831 * 160.0) + sin(uv.y * 6.2831 * 160.0)) * 0.25 + 0.5;
        return 0.4 + weave * 0.1 + pfbm(uv, 3.0, 4) * 0.35;
      }
      vec3 C(vec2 uv, float h) {
        float n = pfbm(uv, 5.0, 4) * 0.5 + 0.5;
        return mix(${v3('#3f4429')}, ${v3('#5d6340')}, n) * (0.85 + h * 0.25);
      }
      float R(vec2 uv, float h) { return 0.92; }
    `,
  },
};

/** Real-world tile size (m) for each structure material tag. */
export const STRUCTURE_TILE = Object.fromEntries(Object.entries(STRUCTURE_RECIPES).map(([k, r]) => [k, r.tile]));
