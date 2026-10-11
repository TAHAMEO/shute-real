// Kalashnikov-pattern weapons: AK-47 (AKM), AK-74M, SVD Dragunov, Saiga-12, PKM.
// Gun space: bore on y = 0, f = 0 at the rear of the receiver (stock joint).
import { rail, trigger, pin, slingLoop, boxMag, muzzle, foregrip, bipod, optic, ironSight, gripOutline, bump, magOutline } from './accessories.js';
import { rrect } from '../weapon-parts.js';
import { frontPostPts, ringStemPts, circleHole } from './rifles-ar.js';

const NOTCH_RELIEF = 0.25; // open notch sights: eye sits on the stock comb, ~25 cm behind the notch

/** Rear notch plate outline (x, y): top edges at sy, U notch below. */
function notchPts(sy, y0, hw = 0.0085, nw = 0.0011, nd = 0.0024) {
  const pts = [[-hw, y0], [hw, y0], [hw, sy, 0.0006], [nw, sy]];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    pts.push([nw * Math.cos(a), sy - nd + nw - nw * Math.sin(a)]);
  }
  pts.push([-nw, sy], [-hw, sy, 0.0006]);
  // the U above was generated right-to-left; keep winding consistent
  return pts;
}

// ------------------------------------------------------------------ shared AK parts

/** Stamped AK receiver + dust cover. c: { L, wk, ribs, mat } */
function akReceiver(b, c = {}) {
  const L = c.L || 0.242;
  const w = 0.0300 * (c.wk || 1);
  const M = c.mat || 'metal';
  const bot = c.bottom ?? -0.042;
  b.side(M, [[0.000, 0.009], [L - 0.006, 0.009], [L, 0.004], [L, -0.024, 0.003], [L - 0.012, -0.031, 0.003], [L - 0.042, bot + 0.002], [0.000, bot, 0.002]], w, { bevel: 0.0008 });
  // dust cover
  const dw = w / 2 + 0.0008;
  b.section(M, [[-dw, 0.003], [dw, 0.003], [dw, 0.0135], [dw - 0.004, 0.0212, 0.004], [-dw + 0.004, 0.0212, 0.004], [-dw, 0.0135]], 0.004, L - 0.030, { bevel: 0.0008 });
  b.box(M, 0, 0.0135, 0.0015, 0.010, 0.007, 0.006);
  if (b.fp) {
    if (c.ribs !== false) for (let i = 0; i < 4; i++) b.section(M, [[-dw + 0.003, 0.012], [dw - 0.003, 0.012], [dw - 0.006, 0.0222, 0.002], [-dw + 0.006, 0.0222, 0.002]], 0.020 + i * 0.012, 0.024 + i * 0.012, { tint: 1.1 });
    // carrier slot + ejection port (right), rivets, trigger pins, magwell dimples
    b.hole(M, w / 2 + 0.0001, 0.0045, 0.120, 0.0006, 0.0045, 0.150);
    b.hole(M, w / 2 + 0.0001, 0.001, (c.ejF ?? 0.150), 0.0006, 0.011, 0.052);
    b.box('steel', w / 2 + 0.0002, 0.002, (c.ejF ?? 0.150), 0.0006, 0.008, 0.040, { tint: 0.4 });
    for (const s of [-1, 1]) {
      for (const [f, y] of [[L - 0.030, -0.020], [L - 0.020, -0.028], [L - 0.040, -0.030], [0.012, -0.030], [0.024, -0.034], [0.070, -0.022], [0.098, -0.022]]) pin(b, 'steel', s * (w / 2 + 0.0004), y, f, 0.0016, { tint: 0.7 });
      b.hole(M, s * (w / 2 + 0.0001), -0.022, L - 0.065, 0.0006, 0.008, 0.016, { tint: 0.5 });
    }
  }
  return { L, w };
}

/** Tangent rear sight: block at f..f+0.056, notch plate at f (top edges at sy). */
function akRearSight(b, f, sy, M = 'metal') {
  b.side(M, [[f - 0.002, 0.008], [f + 0.056, 0.008], [f + 0.058, 0.026, 0.004], [f + 0.050, 0.034, 0.004], [f + 0.012, 0.030, 0.006], [f - 0.002, 0.022, 0.004]], 0.026, { bevel: 0.0009 });
  b.side(M, [[f + 0.002, sy - 0.0045], [f + 0.052, 0.0325], [f + 0.054, 0.0355], [f + 0.004, sy - 0.001]], 0.0115);
  b.section(M, notchPts(sy, sy - 0.0085), f, f + 0.003);
  if (b.fp) {
    b.rbox(M, 0, 0.035, f + 0.028, 0.013, 0.006, 0.008, 0.0015, { rx: -0.25 });
    for (const s of [-1, 1]) b.rbox(M, s * 0.009, 0.033, f + 0.028, 0.003, 0.009, 0.006, 0.001, { rx: -0.25 });
  }
}

/** AK front sight block with protective ears and post (tip at sy). */
function akFrontSight(b, f, sy, o = {}) {
  const M = o.mat || 'metal';
  const top = o.top ?? 0.024;
  b.side(M, [[f - 0.020, -0.012, 0.003], [f + 0.014, -0.012, 0.003], [f + 0.014, top - 0.010, 0.004], [f + 0.004, top, 0.003], [f - 0.012, top, 0.003], [f - 0.020, top - 0.012, 0.004]], 0.022, { bevel: 0.0009 });
  if (o.hood) {
    const cy = sy - 0.0015;
    const ro = 0.0105; const ri = 0.0088; const pw = 0.0009;
    const a1 = Math.asin(pw / ri);
    const yb = cy - Math.sqrt(ri * ri - pw * pw);
    const hp = [];
    for (let i = 0; i <= 16; i++) {
      const a = -Math.PI / 2 + a1 + (i / 16) * (Math.PI * 2 - 2 * a1);
      hp.push([Math.cos(a) * ri, cy + Math.sin(a) * ri]);
    }
    hp.push([-pw, yb], [-pw, sy - 0.0006], [-pw * 0.6, sy], [pw * 0.6, sy], [pw, sy - 0.0006], [pw, yb]);
    b.section(M, ringStemPts(0, cy, ro, 0.006, top - 0.004), f - 0.008, f + 0.006, { holes: [hp] });
  } else {
    b.section(M, frontPostPts(sy, top - 0.004, { ear: 0.0045, win: sy - top - 0.002, hw: 0.0085, iw: 0.0062, pw: 0.0009 }), f - 0.008, f + 0.004);
  }
  if (b.fp && o.lug !== false) b.rbox(M, 0, -0.017, f - 0.004, 0.010, 0.008, 0.024, 0.002);
}

/** Gas block (90 degree), gas tube, handguards. c: { fRear, fGas, hgEnd, furniture, ribbed } */
function akGasAndHandguards(b, c) {
  const M = c.mat || 'metal';
  const F = c.furniture;
  const fr = c.fRear; const fg = c.fGas; const he = c.hgEnd;
  b.tube(M, 0.0098, fr, fg + 0.004, { y: 0.025, seg: b.q.segS });
  b.side(M, [[fg - 0.006, -0.0125], [fg + 0.026, -0.0125, 0.003], [fg + 0.026, 0.031, 0.008], [fg + 0.008, 0.0365, 0.004], [fg - 0.006, 0.0345]], 0.0265, { bevel: 0.001 });
  if (b.fp) slingLoop(b, 'metal', -0.016, 0.010, fg + 0.010, 0.0065, { ry: 0, rx: 0 });
  // upper handguard over the gas tube
  const up = [[-0.0128, 0.013], [0.0128, 0.013], [0.0135, 0.025, 0.004], [0.0, 0.0395, 0.012], [-0.0135, 0.025, 0.004]];
  b.section(F, up, fr + 0.018, he - 0.006, { bevel: 0.0015 });
  b.lathe(M, [[0.0118, fr + 0.010], [0.0142, fr + 0.010], [0.0142, fr + 0.018], [0.0118, fr + 0.018]], { y: 0.025, seg: b.q.segS });
  // lower handguard
  b.side(F, [[fr + 0.010, 0.0125], [he, 0.0125], [he, -0.004, 0.004], [he - 0.008, -0.0165, 0.004], [fr + 0.030, -0.0245, 0.01], [fr + 0.010, -0.019, 0.004]], 0.041, { bevel: 0.0022 });
  if (b.fp) {
    if (c.ribbed) for (let i = 0; i < 6; i++) b.side(F, [[fr + 0.034 + i * 0.026, 0.008], [fr + 0.046 + i * 0.026, 0.008], [fr + 0.046 + i * 0.026, -0.018], [fr + 0.034 + i * 0.026, -0.016]], 0.0425, { tint: 0.85 });
    else b.side(F, [[fr + 0.040, 0.002], [he - 0.030, 0.002], [he - 0.034, -0.012, 0.01], [fr + 0.050, -0.018, 0.01]], 0.0432, { bevel: 0.002 });
  }
  b.lathe(M, [[0.0098, he], [0.0212, he], [0.0212, he + 0.007], [0.0098, he + 0.007]], { seg: b.q.segS, y: 0.004 });
  b.lathe(M, [[0.0098, fr + 0.003], [0.0205, fr + 0.003], [0.0205, fr + 0.010], [0.0098, fr + 0.010]], { seg: b.q.segS, y: 0.0 });
}

/** AK pistol grip; returns grip point. */
function akGrip(b, mat, f, y, o = {}) {
  const g = gripOutline(f, y, o.deg ?? 16, o.len ?? 0.098,
    (s) => 0.0145 + bump(s, 0.050, 0.03, 0.0012) - (s > 0.088 ? (s - 0.088) * 0.25 : 0),
    (s) => 0.0155 + bump(s, 0.060, 0.03, 0.0016), 12, 0.006);
  b.side(mat, g.pts, o.width || 0.0275, { bevel: 0.0022 });
  if (b.fp) {
    const p = g.point(o.len ?? 0.098);
    b.dot('metal', 0, p[1] - 0.0003, p[0], 0.004, 'y', { tint: 0.6 });
  }
  return g.point(0.021);
}

function akTriggerGuard(b, f0, f1, y, M = 'metal') {
  b.side(M, [[f0, y], [f1, y], [f1, y - 0.010, 0.003], [f1 - 0.008, y - 0.023, 0.006], [f0 + 0.010, y - 0.023, 0.006], [f0, y - 0.012, 0.003]], 0.010,
    { holes: [[[f0 + 0.008, y - 0.0035], [f1 - 0.008, y - 0.0035], [f1 - 0.013, y - 0.019, 0.004], [f0 + 0.014, y - 0.019, 0.004], [f0 + 0.008, y - 0.012, 0.003]]] });
  b.rbox(M, 0, y - 0.008, f1 + 0.003, 0.010, 0.016, 0.004, 0.001);
  trigger(b, M, f0 + 0.034, y + 0.002);
}

/** Right-side safety/selector lever. */
function akSelector(b, x, f0, f1, M = 'metal') {
  b.side(M, [[f0, -0.003, 0.003], [f1, -0.012], [f1 + 0.002, -0.0075], [f0 + 0.008, 0.0045, 0.004], [f0, 0.002, 0.003]], 0.0018, { x });
  b.side(M, [[f1 - 0.004, -0.014], [f1 + 0.003, -0.014], [f1 + 0.003, -0.005], [f1 - 0.004, -0.006]], 0.006, { x: x + 0.003 });
  if (b.fp) b.cylX(M, x + 0.0012, 0.000, f0 + 0.004, 0.004, 0.002, { seg: 12 });
}

/** Bolt-carrier charging handle (right side). Returns the group. */
function akHandle(b, x, y, f, o = {}) {
  const g = b.group('bolt', x, y, f);
  g.rbox('steel', x + 0.007, y, f, 0.016, 0.0065, 0.010, 0.0015, { tint: o.tint ?? 0.45 });
  g.cylX('steel', x + 0.017, y + 0.0005, f + 0.001, 0.0058, 0.009, { seg: 12, tint: o.tint ?? 0.45 });
  return g;
}

/** Left-side optic mount with a top Picatinny rail over the dust cover. Returns rail top height. */
function akSideMount(b, f0, f1, x, yRail = 0.034) {
  b.rbox('metal', x - 0.0035, -0.001, (f0 + f1) / 2 + 0.03, 0.007, 0.022, f1 - f0 - 0.04, 0.002);
  b.side('anodized', [[f0 + 0.020, -0.008], [f1 - 0.010, -0.008], [f1, yRail, 0.006], [f0, yRail, 0.006]], 0.006, { x: x - 0.008 });
  b.box('anodized', (x - 0.008) / 2, yRail - 0.003, (f0 + f1) / 2, Math.abs(x - 0.008) + 0.004, 0.006, f1 - f0 - 0.004);
  if (b.fp) b.rbox('metal', x - 0.012, 0.0, f0 + 0.04, 0.005, 0.008, 0.026, 0.002);
  return rail(b, 'anodized', f0, f1, yRail);
}

/** Wooden AKM stock (or polymer AK-74M/AK-100 when mat is polymer). fb = butt end. */
function akStock(b, mat, fb, o = {}) {
  const plate = o.plateMat || 'metal';
  b.side(mat, [[0.006, 0.0125, 0.003], [-0.030, 0.0085, 0.01], [fb + 0.008, -0.026, 0.004], [fb + 0.008, -0.148, 0.004],
    [fb + 0.020, -0.150, 0.004], [-0.090, -0.078, 0.03], [-0.030, -0.058, 0.02], [0.006, -0.042, 0.004]], o.width || 0.034, { bevel: 0.0026 });
  b.side(plate, [[fb + 0.008, -0.0245], [fb, -0.0255, 0.002], [fb - 0.0015, -0.150, 0.003], [fb + 0.008, -0.1515]], (o.width || 0.034) + 0.002, { bevel: 0.0012 });
  if (b.fp) {
    if (o.groove) for (const s of [-1, 1]) b.side(mat, [[-0.060, -0.020], [fb + 0.040, -0.040], [fb + 0.040, -0.110, 0.006], [-0.090, -0.070, 0.02]], 0.0012, { x: s * (o.width || 0.034) / 2, tint: 0.7 });
    slingLoop(b, 'metal', -0.0172, -0.120, fb + 0.030, 0.0065, { ry: 0, rx: 0 });
    b.cylX('metal', 0, -0.090, fb - 0.002, 0.004, 0.012, { seg: 10 });
  }
}

/** AK curved magazine group. */
function akMag(b, f, yTop, p) {
  const m = b.group('magazine', 0, yTop, f);
  const bt = boxMag(m, p.mat, {
    fc: f, yTop, depth: p.depth, width: p.width, straight: p.straight, arc: p.arc, radius: p.radius,
    ribs: p.ribs ?? 'ak', ribTop: p.ribTop ?? 0.05, ribGap: p.ribGap ?? 0.032, ribCount: p.ribCount ?? 5,
    plateMat: p.plateMat || p.mat, plate: 0.006, plateExtra: 0.003, roundR: p.roundR || 0.0055, tint: p.tint,
  });
  // front hook lug + rear catch lug
  m.rbox(p.mat, 0, yTop - 0.006, f + p.depth / 2 + 0.002, p.width - 0.004, 0.010, 0.006, 0.0015, { tint: p.tint });
  m.rbox(p.mat, 0, yTop - 0.014, f - p.depth / 2 - 0.0015, 0.012, 0.008, 0.004, 0.001, { tint: p.tint });
  return { m, bt };
}

// ------------------------------------------------------------------ AK-47 (AKM)

function ak47(b, att) {
  const sy = 0.048;
  akReceiver(b, { L: 0.242 });
  akRearSight(b, 0.214, sy);
  b.lathe('blued', [[0.0102, 0.242], [0.0102, 0.282], [0.0095, 0.284], [0.0095, 0.540], [0.0088, 0.545], [0.0088, 0.630], [0, 0.630]], { seg: b.q.segS + 2 });
  akGasAndHandguards(b, { fRear: 0.272, fGas: 0.512, hgEnd: 0.470, furniture: 'woodRed' });
  akFrontSight(b, 0.610, sy);
  if (b.fp) b.tube('steel', 0.0029, 0.300, 0.598, { y: -0.0168, seg: 8, tint: 0.5 });
  muzzle(b, att.muzzle, 0.630, 0.0085, { style: 'ak47' });
  akTriggerGuard(b, 0.058, 0.130, -0.041);
  akSelector(b, 0.0158, 0.030, 0.150);
  const gp = akGrip(b, 'plum', 0.052, -0.038);
  akStock(b, 'woodRed', -0.214);
  akHandle(b, 0.0158, 0.006, 0.196);
  akMag(b, 0.163, -0.035, { mat: 'metal', depth: 0.071, width: 0.0275, straight: 0.020, arc: 0.200, radius: 0.27, tint: 1.1 });
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.017, 0.003, 0.150, [0, 0.3, 0.35]);
  if (att.optic === 'iron') ironSight(b, sy, 0.214, NOTCH_RELIEF);
  else {
    const rt = akSideMount(b, 0.030, 0.205, -0.0158);
    optic(b, att.optic, { reddot: 0.095, holo: 0.108, acog: 0.080 }[att.optic], rt);
  }
  const lh = att.grip !== 'none' ? (rail(b, 'anodized', 0.330, 0.440, 0.0245, { roll: Math.PI }), foregrip(b, att.grip, 0.385, -0.034)) : null;
  b.anchor('leftHand', ...(lh || [0, -0.027, 0.385]));
}

// ------------------------------------------------------------------ AK-74M

function ak74m(b, att) {
  const sy = 0.048;
  akReceiver(b, { L: 0.242 });
  if (b.fp) b.rbox('metal', -0.0162, -0.003, 0.160, 0.003, 0.016, 0.100, 0.001);
  akRearSight(b, 0.214, sy);
  b.lathe('blued', [[0.0102, 0.242], [0.0102, 0.282], [0.0095, 0.284], [0.0095, 0.540], [0.0088, 0.545], [0.0088, 0.630], [0, 0.630]], { seg: b.q.segS + 2 });
  akGasAndHandguards(b, { fRear: 0.272, fGas: 0.512, hgEnd: 0.470, furniture: 'polymer', ribbed: true });
  akFrontSight(b, 0.610, sy);
  if (b.fp) b.tube('steel', 0.0029, 0.300, 0.598, { y: -0.0168, seg: 8, tint: 0.5 });
  muzzle(b, att.muzzle, 0.630, 0.0085, { style: 'ak74' });
  akTriggerGuard(b, 0.058, 0.130, -0.041);
  akSelector(b, 0.0158, 0.030, 0.150);
  const gp = akGrip(b, 'polymer', 0.052, -0.038);
  // side-folding polymer stock (extended), rubber butt pad with grooves
  b.rbox('metal', -0.0005, -0.016, -0.004, 0.034, 0.046, 0.012, 0.004);
  akStock(b, 'polymer', -0.230, { plateMat: 'rubber', groove: true, width: 0.033 });
  akHandle(b, 0.0158, 0.006, 0.196);
  akMag(b, 0.163, -0.035, { mat: 'plum', depth: 0.066, width: 0.0265, straight: 0.020, arc: 0.192, radius: 0.40, ribs: 'ak', ribCount: 3, ribGap: 0.05, ribTop: 0.04 });
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.017, 0.003, 0.150, [0, 0.3, 0.35]);
  if (att.optic === 'iron') ironSight(b, sy, 0.214, NOTCH_RELIEF);
  else {
    const rt = akSideMount(b, 0.030, 0.205, -0.0172);
    optic(b, att.optic, { reddot: 0.095, holo: 0.108, acog: 0.080 }[att.optic], rt);
  }
  const lh = att.grip !== 'none' ? (rail(b, 'anodized', 0.330, 0.440, 0.0245, { roll: Math.PI }), foregrip(b, att.grip, 0.385, -0.034)) : null;
  b.anchor('leftHand', ...(lh || [0, -0.027, 0.385]));
}

// ------------------------------------------------------------------ SVD Dragunov

function svd(b, att) {
  const sy = 0.050;
  const fp = b.fp;
  akReceiver(b, { L: 0.270, wk: 1.03, ejF: 0.165, ribs: false });
  if (fp) b.rbox('metal', -0.0165, -0.004, 0.170, 0.003, 0.018, 0.120, 0.001);
  akRearSight(b, 0.240, sy);
  b.lathe('blued', [[0.0108, 0.270], [0.0108, 0.300], [0.0098, 0.303], [0.0098, 0.700], [0.0090, 0.704], [0.0090, 0.875], [0, 0.875]], { seg: b.q.segS + 2 });
  // gas system + slotted two-piece handguard
  b.tube('metal', 0.0098, 0.300, 0.492, { y: 0.025, seg: b.q.segS });
  b.side('metal', [[0.482, -0.0125], [0.512, -0.0125, 0.003], [0.512, 0.031, 0.008], [0.494, 0.0365, 0.004], [0.482, 0.0345]], 0.0265);
  b.section('wood', rrect(-0.0195, -0.021, 0.0195, 0.036, 0.010), 0.300, 0.476, { bevel: 0.0022 });
  if (fp) for (let i = 0; i < 6; i++) for (const s of [-1, 1]) b.hole('wood', s * 0.0196, 0.010, 0.318 + i * 0.026, 0.0006, 0.012, 0.010, { tint: 0.1 });
  b.lathe('metal', [[0.0098, 0.476], [0.0215, 0.476], [0.0215, 0.484], [0.0098, 0.484]], { y: 0.006, seg: b.q.segS });
  b.lathe('metal', [[0.0098, 0.292], [0.0215, 0.292], [0.0215, 0.300], [0.0098, 0.300]], { y: 0.006, seg: b.q.segS });
  akFrontSight(b, 0.845, sy, { hood: true, lug: true });
  muzzle(b, att.muzzle, 0.875, 0.0088, { style: 'svd', r: 0.019, len: 0.175 });
  // skeleton thumbhole stock with integral grip and cheek rest
  const fb = -0.262;
  b.side('wood', [[0.006, 0.0125, 0.003], [-0.030, 0.0095, 0.01], [fb + 0.010, -0.012, 0.004], [fb + 0.006, -0.138, 0.004], [fb + 0.020, -0.144, 0.004],
    [-0.010, -0.124, 0.008], [0.016, -0.118, 0.006], [0.034, -0.050, 0.006], [0.050, -0.040, 0.004]], 0.033,
  { holes: [[[-0.012, -0.004, 0.006], [-0.105, -0.0115, 0.008], [-0.108, -0.082, 0.008], [-0.030, -0.088, 0.008], [-0.006, -0.050, 0.008]],
    [[-0.132, -0.014, 0.008], [fb + 0.030, -0.020, 0.006], [fb + 0.028, -0.112, 0.008], [-0.132, -0.100, 0.008]]], bevel: 0.0024 });
  b.side('metal', [[fb + 0.010, -0.010], [fb + 0.002, -0.011, 0.002], [fb - 0.002, -0.140, 0.003], [fb + 0.006, -0.1445]], 0.035);
  b.side('wood', [[-0.040, 0.012], [-0.180, 0.002], [-0.182, 0.022, 0.006], [-0.050, 0.026, 0.006]], 0.022, { x: -0.006, bevel: 0.002, tint: 0.85 });
  const gp = [0.026, -0.060];
  akTriggerGuard(b, 0.050, 0.124, -0.041);
  akSelector(b, 0.0162, 0.034, 0.160);
  akHandle(b, 0.0162, 0.006, 0.226);
  const { bt } = akMag(b, 0.168, -0.034, { mat: 'metal', depth: 0.088, width: 0.027, straight: 0.040, arc: 0.060, radius: 0.40, ribs: 'side', ribTop: 0.05, roundR: 0.0058 });
  void bt;
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.017, 0.003, 0.165, [0, 0.3, 0.35]);
  if (att.optic === 'iron') ironSight(b, sy, 0.240, NOTCH_RELIEF);
  else if (att.optic === 'pso') optic(b, 'pso', 0.165, 0.035, { x: -0.004, axisY: 0.071, sideRail: { y: -0.004, x: -0.0165 } });
  else {
    const rt = akSideMount(b, 0.020, 0.232, -0.0175, 0.036);
    optic(b, att.optic, { acog: 0.070, scope8: 0.210 }[att.optic], rt, { h: att.optic === 'scope8' ? 0.031 : undefined });
  }
  b.anchor('leftHand', 0, -0.025, 0.400);
}

// ------------------------------------------------------------------ Saiga-12

function saiga12(b, att) {
  const sy = 0.052;
  const fp = b.fp;
  akReceiver(b, { L: 0.262, wk: 1.12, bottom: -0.046, ejF: 0.155 });
  akRearSight(b, 0.232, sy);
  b.lathe('blued', [[0.0125, 0.262], [0.0125, 0.665], [0, 0.665]], { seg: b.q.segS + 2 });
  b.lathe('metal', [[0.0135, 0.640], [0.0145, 0.642], [0.0145, 0.665], [0.0120, 0.667], [0, 0.667]], { seg: b.q.segS + 2 });
  if (fp) b.dot('metal', 0, 0, 0.6672, 0.0095, 'z', { tint: 0.03 });
  b.anchor('muzzle', 0, 0, 0.667);
  // gas block with regulator, handguard
  b.tube('metal', 0.0105, 0.292, 0.450, { y: 0.028, seg: b.q.segS });
  b.side('metal', [[0.436, -0.015], [0.472, -0.015, 0.003], [0.472, 0.034, 0.008], [0.452, 0.040, 0.004], [0.436, 0.038]], 0.030);
  b.cylX('metal', -0.018, 0.026, 0.455, 0.0075, 0.010, { seg: 14 });
  b.section('polymer', rrect(-0.022, -0.024, 0.022, 0.040, 0.010), 0.300, 0.428, { bevel: 0.002 });
  if (fp) for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.hole('polymer', s * 0.0222, 0.012, 0.318 + i * 0.028, 0.0006, 0.014, 0.012, { tint: 0.15 });
  akFrontSight(b, 0.625, sy, { top: 0.026 });
  akTriggerGuard(b, 0.060, 0.134, -0.045);
  akSelector(b, 0.0176, 0.030, 0.158);
  const gp = akGrip(b, 'polymer', 0.054, -0.042);
  b.rbox('metal', -0.0005, -0.016, -0.004, 0.036, 0.046, 0.012, 0.004);
  akStock(b, 'polymer', -0.230, { plateMat: 'rubber', groove: true, width: 0.034 });
  akHandle(b, 0.0176, 0.006, 0.205);
  akMag(b, 0.168, -0.040, { mat: 'polymer', depth: 0.094, width: 0.0355, straight: 0.050, arc: 0.075, radius: 0.48, ribs: 'side', ribTop: 0.05, roundR: 0.0095, tint: 1.2 });
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.019, 0.003, 0.155, [0, 0.3, 0.35]);
  if (att.optic === 'iron') ironSight(b, sy, 0.232, NOTCH_RELIEF);
  else {
    const rt = akSideMount(b, 0.030, 0.222, -0.0185, 0.036);
    optic(b, att.optic, { reddot: 0.095, holo: 0.108 }[att.optic], rt);
  }
  const lh = att.grip !== 'none' ? (rail(b, 'polymer', 0.322, 0.420, 0.024, { roll: Math.PI }), foregrip(b, att.grip, 0.372, -0.0335)) : null;
  b.anchor('leftHand', ...(lh || [0, -0.026, 0.370]));
}

// ------------------------------------------------------------------ PKM

function pkm(b, att) {
  const sy = 0.058;
  const fp = b.fp;
  const M = 'metal';
  // box receiver with feed cover
  b.side(M, [[0.000, 0.014], [0.286, 0.014], [0.300, 0.004, 0.004], [0.300, -0.044, 0.004], [0.010, -0.050, 0.004], [0.000, -0.040, 0.004]], 0.036, { bevel: 0.0009 });
  b.side(M, [[0.060, 0.014], [0.292, 0.014], [0.292, 0.030, 0.006], [0.250, 0.034, 0.008], [0.080, 0.032, 0.006], [0.060, 0.026, 0.004]], 0.038, { bevel: 0.0012 });
  if (fp) {
    b.cylX(M, 0, 0.022, 0.286, 0.004, 0.040, { seg: 10 });
    b.rbox(M, 0.0195, 0.004, 0.180, 0.004, 0.024, 0.090, 0.002);
    b.hole(M, 0.0181, -0.010, 0.200, 0.0006, 0.010, 0.140);
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) pin(b, 'steel', s * 0.0182, -0.036, 0.040 + i * 0.055, 0.0018, { tint: 0.7 });
    // rear sight leaf at the front of the cover
    b.side(M, [[0.250, 0.030], [0.288, 0.030], [0.288, 0.040, 0.004], [0.256, 0.042]], 0.020);
  }
  b.section(M, notchPts(sy, 0.032), 0.248, 0.251);
  b.side(M, [[0.250, 0.030], [0.288, 0.036], [0.288, 0.040], [0.252, sy - 0.003]], 0.010);
  // barrel (fluted), carry handle, gas cylinder below, front sight + flash hider
  b.lathe('blued', [[0.0130, 0.300], [0.0130, 0.330], [0.0108, 0.334], [0.0108, 0.836], [0.0098, 0.840], [0.0098, 0.880], [0, 0.880]], { seg: b.q.segS + 2 });
  if (fp) for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.box('blued', Math.sin(a) * 0.0106, Math.cos(a) * 0.0106, 0.480, 0.0026, 0.0012, 0.240, { rz: -a, tint: 0.35 }); }
  b.tube(M, 0.0105, 0.300, 0.610, { y: -0.027, seg: b.q.segS });
  b.side(M, [[0.590, -0.040], [0.626, -0.040, 0.004], [0.626, 0.012, 0.004], [0.590, 0.012, 0.004]], 0.026);
  b.side(M, [[0.316, 0.008], [0.336, 0.008], [0.336, 0.030], [0.400, 0.052, 0.008], [0.300, 0.052, 0.008], [0.312, 0.030]], 0.008);
  b.rbox('polymer', 0, 0.056, 0.350, 0.016, 0.012, 0.110, 0.005);
  b.side(M, [[0.850, -0.010], [0.870, -0.010, 0.003], [0.870, 0.020, 0.003], [0.854, 0.020]], 0.022);
  b.section(M, frontPostPts(sy, 0.016, { ear: 0.004, win: sy - 0.022, hw: 0.0085, iw: 0.0062, pw: 0.0009 }), 0.856, 0.868);
  muzzle(b, att.muzzle, 0.880, 0.0098, { style: 'pkm' });
  // bipod at the gas block, legs folded back along the gas tube
  b.rbox(M, 0, -0.044, 0.612, 0.030, 0.014, 0.022, 0.003);
  for (const s of [-1, 1]) {
    b.tube(M, 0.0055, 0.372, 0.610, { x: s * 0.013, y: -0.046, seg: b.q.segXS + 2 });
    b.rbox(M, s * 0.013, -0.046, 0.364, 0.010, 0.010, 0.016, 0.003);
  }
  // trigger group + grip, skeleton stock
  akTriggerGuard(b, 0.040, 0.105, -0.049);
  const g = gripOutline(0.020, -0.046, 14, 0.100, (s) => 0.0148 + bump(s, 0.05, 0.03, 0.0012), (s) => 0.0158 + bump(s, 0.06, 0.03, 0.0015), 12, 0.006);
  b.side('woodRed', g.pts, 0.029, { bevel: 0.0024 });
  const gp = g.point(0.021);
  const fb = -0.250;
  b.side('woodRed', [[0.004, 0.012, 0.004], [fb + 0.012, -0.012, 0.006], [fb + 0.006, -0.136, 0.006], [fb + 0.020, -0.140, 0.006], [-0.040, -0.062, 0.02], [0.004, -0.044, 0.004]], 0.033,
    { holes: [[[-0.030, 0.000, 0.008], [fb + 0.034, -0.018, 0.01], [fb + 0.032, -0.110, 0.012], [-0.050, -0.048, 0.012]]], bevel: 0.0024 });
  b.side(M, [[fb + 0.012, -0.010], [fb + 0.002, -0.011, 0.002], [fb, -0.138, 0.003], [fb + 0.008, -0.141]], 0.036);
  if (fp) b.side(M, [[fb + 0.004, -0.010], [fb - 0.004, -0.011], [fb - 0.006, -0.040], [fb + 0.002, -0.042]], 0.030);
  // charging handle (right, low)
  const bolt = b.group('bolt', 0.0185, -0.022, 0.250);
  bolt.rbox(M, 0.026, -0.022, 0.250, 0.014, 0.008, 0.012, 0.002);
  bolt.cylX('polymer', 0.035, -0.022, 0.250, 0.0062, 0.010, { seg: 12 });
  // 100 rd ammo box under the receiver + belt into the feed tray
  const m = b.group('magazine', 0.012, -0.050, 0.205);
  m.rbox(M, 0.012, -0.112, 0.205, 0.064, 0.124, 0.168, 0.004);
  m.rbox(M, 0.012, -0.049, 0.205, 0.068, 0.006, 0.172, 0.002, { tint: 0.9 });
  if (fp) {
    m.rbox(M, 0.012, -0.110, 0.205, 0.0665, 0.060, 0.100, 0.003, { tint: 0.85 });
    m.cylX(M, 0.047, -0.070, 0.205, 0.004, 0.006, { seg: 10 });
    for (let i = 0; i < 5; i++) {
      const y = -0.046 + i * 0.0105;
      m.tube('brass', 0.0062, 0.160, 0.218, { x: 0.030 - i * 0.002, y, seg: 8 });
      m.tube('brass', [0.0062, 0.0022], 0.218, 0.242, { x: 0.030 - i * 0.002, y, seg: 8 });
      m.box('steel', 0.030 - i * 0.002, y, 0.200, 0.008, 0.0105, 0.018, { tint: 0.4 });
    }
  }
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.020, -0.012, 0.200, [0, 0.0, -0.25]);
  if (att.optic === 'iron') ironSight(b, sy, 0.248, NOTCH_RELIEF);
  else if (att.optic === 'pso') optic(b, 'pso', 0.230, 0.040, { x: -0.006, axisY: 0.078, sideRail: { y: -0.006, x: -0.0185 } });
  else {
    const rt = akSideMount(b, 0.070, 0.236, -0.0195, 0.044);
    optic(b, att.optic, { reddot: 0.120, holo: 0.130 }[att.optic], rt);
  }
  b.anchor('leftHand', 0, -0.040, 0.360);
}

export const AK_BUILDERS = { ak47, ak74m, svd, saiga12, pkm };
