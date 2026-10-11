// Pistols: Glock 18C, M9 Beretta, M1911, Desert Eagle, .357 revolver.
// Gun space: bore on y = 0, f = 0 at the rear of the slide (revolver: rear of the frame).
// The slide is the 'bolt' group (translate +Z); slide-mounted parts (sights, RMR) move with it.
import { extrudeSide, rrect, circlePts } from '../weapon-parts.js';
import { trigger, pin, muzzle, optic, ironSight, gripOutline, bump, pivotX } from './accessories.js';

const PISTOL_RELIEF = 0.30;

/** Rear notch sight outline (x, y): base y0, top edges at sy. */
function notch(sy, y0, hw = 0.0065, nw = 0.0017, nd = 0.0028) {
  const pts = [[-hw, y0], [hw, y0], [hw, sy, 0.0005], [nw, sy]];
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI; pts.push([nw * Math.cos(a), sy - nd + nw - nw * Math.sin(a)]); }
  pts.push([-nw, sy], [-hw, sy, 0.0005]);
  return pts;
}

/** Three-dot style sights in builder t (slide group). */
function dotSights(t, rearF, frontF, top, sy, o = {}) {
  t.section(o.mat || 'metal', notch(sy, top - 0.0005, o.hw), rearF - 0.004, rearF + 0.004, { bevel: 0.0004 });
  t.rbox(o.mat || 'metal', 0, top + (sy - top) / 2 - 0.0005, frontF, 0.0032, sy - top + 0.001, 0.006, 0.0008);
  if (t.fp) {
    const dm = o.dots || 'paint';
    t.dot(dm, 0, sy - 0.0016, frontF - 0.0031, 0.0009, 'z', { tint: o.dotTint || 1, depth: 0.0004 });
    for (const s of [-1, 1]) t.dot(dm, s * 0.0038, sy - 0.0016, rearF - 0.0041, 0.0009, 'z', { tint: o.dotTint || 1, depth: 0.0004 });
  }
}

/** Magazine group inside a grip tilted `deg`; top centre at (fTop, yTop), length along the grip axis. */
function gripMag(b, mat, fTop, yTop, deg, len, depth, width, o = {}) {
  const tilt = (deg * Math.PI) / 180;
  const m = b.group('magazine', 0, yTop, fTop, -tilt);
  const pv = pivotX(yTop, fTop, -tilt);
  m.geo(mat, extrudeSide([[fTop - depth / 2, yTop], [fTop + depth / 2, yTop], [fTop + depth / 2, yTop - len, 0.002], [fTop - depth / 2, yTop - len, 0.002]], width, m.q, { bevel: 0.0006 }), pv, { tint: o.tint });
  const pm = o.plateMat || mat;
  const ex = o.plateExtra ?? 0.002;
  m.geo(pm, extrudeSide([[fTop - depth / 2 - ex, yTop - len + 0.002], [fTop + depth / 2 + ex, yTop - len + 0.002], [fTop + depth / 2 + ex, yTop - len - (o.plate ?? 0.006), 0.002],
    [fTop - depth / 2 - ex, yTop - len - (o.plate ?? 0.006), 0.002]], width + (o.plateWide ?? 0.003), m.q, { bevel: 0.0008 }), pv);
  if (m.fp) m.geo('brass', extrudeSide([[fTop - depth / 2 + 0.003, yTop + 0.006], [fTop + depth / 2 - 0.004, yTop + 0.006], [fTop + depth / 2 - 0.006, yTop], [fTop - depth / 2 + 0.003, yTop]], width * 0.45, m.q, { bevel: 0.0005 }), pv);
  return m;
}

function suppressorOrBore(b, att, f, rb, y = 0) {
  if (att.muzzle === 'suppressor') {
    b.tube('blued', 0.0062, f, f + 0.012, { y, seg: b.q.segS });
    muzzle(b, 'suppressor', f + 0.012, 0.0062, { y, r: 0.0168, len: 0.150 });
  } else {
    muzzle(b, 'none', f, rb, { y });
  }
}

function cupHand(b, gp) {
  b.anchor('leftHand', -0.020, gp[1] - 0.042, gp[0] + 0.016);
}

// ------------------------------------------------------------------ Glock 18C

function glock18(b, att) {
  const fp = b.fp;
  const L = 0.186;
  const top = 0.0175;
  const sy = 0.0238;
  const slide = b.group('bolt', 0, 0, 0);
  slide.section('blued', [[-0.01275, -0.0075], [0.01275, -0.0075], [0.01275, 0.0125], [0.0100, top, 0.0015], [-0.0100, top, 0.0015], [-0.01275, 0.0125]], 0, L, { bevel: 0.0009 });
  slide.lathe('steel', [[0.0058, L - 0.002], [0.0068, L - 0.002], [0.0068, L + 0.0004], [0.0058, L + 0.0004]], { seg: 14, tint: 0.6 });
  if (fp) {
    for (let i = 0; i < 7; i++) for (const s of [-1, 1]) slide.box('blued', s * 0.0128, 0.003, 0.010 + i * 0.0042, 0.0008, 0.016, 0.0014, { tint: 0.25 });
    slide.hole('blued', 0.0070, 0.0145, 0.116, 0.010, 0.006, 0.040, { rz: -0.4 });
    slide.box('steel', 0.0030, 0.0150, 0.116, 0.010, 0.002, 0.034, { tint: 0.55 });
    for (const df of [0.160, 0.172]) slide.hole('blued', 0, top + 0.0001, df, 0.0045, 0.0006, 0.007);
    slide.rbox('polymer', -0.0136, 0.003, 0.012, 0.002, 0.006, 0.010, 0.001);
  }
  dotSights(slide, 0.010, 0.178, top, sy, { mat: 'polymer' });
  // frame
  b.side('polymer', [[0.004, -0.0075], [0.184, -0.0075], [0.186, -0.012, 0.002], [0.184, -0.0205, 0.003], [0.118, -0.0205], [0.050, -0.016], [0.004, -0.014, 0.003]], 0.0235, { bevel: 0.0012 });
  b.side('polymer', [[0.068, -0.016], [0.120, -0.018], [0.122, -0.026, 0.002], [0.121, -0.040, 0.004], [0.084, -0.042, 0.006], [0.066, -0.032, 0.006]], 0.0105,
    { holes: [[[0.077, -0.0195], [0.115, -0.0205], [0.114, -0.035, 0.003], [0.087, -0.037, 0.005], [0.076, -0.029, 0.004]]], bevel: 0.0008 });
  if (fp) for (let i = 0; i < 2; i++) b.hole('polymer', 0, -0.0207, 0.150 + i * 0.012, 0.016, 0.0006, 0.004);
  trigger(b, 'polymer', 0.098, -0.014, { scale: 0.85, width: 0.006 });
  const g = gripOutline(0.031, -0.010, 22, 0.106,
    (s) => 0.0225 + bump(s, 0.044, 0.007, 0.0016) + bump(s, 0.064, 0.007, 0.0016) + bump(s, 0.084, 0.007, 0.0016) - (s > 0.096 ? (s - 0.096) * 0.3 : 0),
    (s) => 0.0232 + bump(s, 0.066, 0.025, 0.0010) + (s < 0.014 ? (0.014 - s) * 0.5 : 0), 16, 0.004, { topY: -0.0085 });
  b.side('polymer', g.pts, 0.0298, { bevel: 0.0026 });
  const gp = g.point(0.020);
  if (fp) {
    b.rbox('polymer', -0.0152, -0.0215, 0.064, 0.0022, 0.006, 0.008, 0.001);
    b.rbox('metal', -0.0122, -0.010, 0.074, 0.0016, 0.004, 0.022, 0.0008);
    for (const s of [-1, 1]) b.rbox('metal', s * 0.0122, -0.0115, 0.120, 0.0012, 0.006, 0.010, 0.0006);
  }
  // barrel end + 19 rd magazine
  gripMag(b, 'polymer', 0.031, -0.012, 22, 0.114, 0.034, 0.021, { plate: 0.008, plateExtra: 0.0016, plateWide: 0.006 });
  suppressorOrBore(b, att, L, 0.0058);
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.0128, 0.012, 0.116, [0, 0.15, 0.75]);
  cupHand(b, gp);
  if (att.optic === 'reddot') optic(b, 'reddot', 0.044, top, { pistol: true, slide, eye: PISTOL_RELIEF });
  else ironSight(b, sy, 0.010, PISTOL_RELIEF);
}

// ------------------------------------------------------------------ M9 Beretta

function m9(b, att) {
  const fp = b.fp;
  const L = 0.210;
  const top = 0.0165;
  const sy = 0.0225;
  const slide = b.group('bolt', 0, 0, 0);
  const sec = [[-0.0128, -0.008], [0.0128, -0.008], [0.0128, 0.009], [0.0098, top, 0.004], [-0.0098, top, 0.004], [-0.0128, 0.009]];
  slide.section('blued', sec, 0, 0.064, { bevel: 0.0009 });
  for (const s of [-1, 1]) {
    slide.side('blued', [[0.060, -0.008], [0.196, -0.008], [0.196, 0.006], [0.186, 0.008, 0.004], [0.176, 0.0035, 0.003], [0.082, 0.0035, 0.003], [0.072, 0.010, 0.004], [0.060, 0.012]], 0.0050, { x: s * 0.0103 });
  }
  slide.section('blued', sec, 0.192, L, { bevel: 0.0009, holes: [circlePts(0, 0, 0.0074, 0.0074, fp ? 18 : 8)] });
  slide.lathe('steel', [[0.0070, 0.062], [0.0072, 0.064], [0.0072, L + 0.001], [0.0055, L + 0.001]], { seg: fp ? 18 : 8, tint: 0.75 });
  if (fp) {
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) slide.box('blued', s * 0.0128, 0.002, 0.012 + i * 0.005, 0.0008, 0.014, 0.0016, { tint: 0.25 });
    for (const s of [-1, 1]) {
      slide.rbox('blued', s * 0.0150, 0.006, 0.020, 0.0045, 0.006, 0.012, 0.0015);
      slide.cylX('blued', s * 0.0134, 0.006, 0.026, 0.0045, 0.002, { seg: 12 });
    }
  }
  dotSights(slide, 0.012, 0.203, top, sy);
  // frame: rails, dust cover, rounded guard with hook
  b.side('anodized', [[-0.004, -0.008], [0.200, -0.008], [0.202, -0.014, 0.003], [0.194, -0.022, 0.004], [0.128, -0.022], [0.040, -0.016], [-0.004, -0.016, 0.003]], 0.024, { bevel: 0.0012 });
  b.side('anodized', [[0.064, -0.018], [0.130, -0.020], [0.140, -0.026, 0.004], [0.138, -0.034], [0.130, -0.040, 0.006], [0.092, -0.046, 0.01], [0.066, -0.034, 0.006]], 0.0105,
    { holes: [[[0.074, -0.021], [0.124, -0.0225], [0.124, -0.034, 0.006], [0.094, -0.040, 0.008], [0.074, -0.031, 0.005]]], bevel: 0.0008 });
  trigger(b, 'metal', 0.096, -0.016, { scale: 0.95, width: 0.006 });
  // exposed hammer
  b.side('metal', [[-0.002, -0.006], [0.006, -0.006], [0.006, 0.010, 0.002], [-0.004, 0.019, 0.002], [-0.012, 0.018, 0.002], [-0.006, 0.008, 0.002]], 0.008);
  const g = gripOutline(0.033, -0.012, 17, 0.100,
    (s) => 0.0242 - (s > 0.090 ? (s - 0.090) * 0.3 : 0), (s) => 0.0248 + bump(s, 0.066, 0.025, 0.0012) + (s < 0.010 ? (0.010 - s) * 0.4 : 0), 14, 0.006, { topY: -0.0090 });
  b.side('polymerCheck', g.pts, 0.0315, { bevel: 0.0026 });
  b.side('anodized', gripOutline(0.033, -0.012, 17, 0.100, (s) => 0.0250, (s) => 0.0254, 5, 0.006, { topY: -0.0085 }).pts, 0.0240, { bevel: 0.001 });
  const gp = g.point(0.020);
  if (fp) {
    b.rbox('anodized', -0.0128, -0.012, 0.126, 0.0022, 0.006, 0.008, 0.001);
    b.cylX('steel', -0.0126, -0.013, 0.140, 0.003, 0.002, { seg: 10 });
    b.rbox('anodized', -0.0128, -0.010, 0.060, 0.0018, 0.004, 0.024, 0.0008);
    for (const s of [-1, 1]) pin(b, 'steel', s * 0.0158, -0.040, 0.020, 0.0022);
  }
  gripMag(b, 'metal', 0.033, -0.014, 17, 0.098, 0.034, 0.0215, { plateMat: 'polymer', plate: 0.005 });
  suppressorOrBore(b, att, L, 0.0055);
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.0110, 0.008, 0.120, [0, 0.15, 0.75]);
  cupHand(b, gp);
  if (att.optic === 'reddot') optic(b, 'reddot', 0.034, top - 0.002, { pistol: true, slide, eye: PISTOL_RELIEF });
  else ironSight(b, sy, 0.012, PISTOL_RELIEF);
}

// ------------------------------------------------------------------ M1911

function m1911(b, att) {
  const fp = b.fp;
  const L = 0.209;
  const top = 0.0160;
  const sy = 0.0215;
  const slide = b.group('bolt', 0, 0, 0);
  slide.section('blued', [[-0.0116, -0.008], [0.0116, -0.008], [0.0116, 0.0095], [0.0080, top, 0.004], [-0.0080, top, 0.004], [-0.0116, 0.0095]], 0, L, { bevel: 0.0009 });
  slide.lathe('steel', [[0.0060, L - 0.002], [0.0098, L - 0.002], [0.0100, L + 0.004], [0.0060, L + 0.004]], { seg: fp ? 18 : 8, tint: 0.7 });
  if (fp) {
    for (let i = 0; i < 8; i++) for (const s of [-1, 1]) slide.box('blued', s * 0.0116, 0.002, 0.010 + i * 0.0038, 0.0008, 0.014, 0.0013, { tint: 0.25, rx: 0.15 });
    slide.hole('blued', 0.0117, 0.006, 0.104, 0.0006, 0.010, 0.044);
    slide.box('steel', 0.0114, 0.006, 0.104, 0.0006, 0.007, 0.036, { tint: 0.6 });
  }
  dotSights(slide, 0.012, 0.198, top, sy, { hw: 0.0058 });
  // frame, dust cover, recoil plug, guard
  b.side('metal', [[-0.004, -0.008], [0.200, -0.008], [0.200, -0.020, 0.004], [0.126, -0.020], [0.040, -0.016], [-0.004, -0.016, 0.003]], 0.0230, { bevel: 0.0012 });
  b.lathe('metal', [[0, 0.198], [0.0068, 0.198], [0.0068, 0.212], [0.0058, 0.2135], [0, 0.2135]], { y: -0.0135, seg: fp ? 16 : 8 });
  b.side('metal', [[0.066, -0.016], [0.126, -0.018], [0.128, -0.026, 0.004], [0.124, -0.038, 0.008], [0.090, -0.042, 0.01], [0.066, -0.032, 0.006]], 0.0100,
    { holes: [[[0.075, -0.0195], [0.120, -0.021], [0.118, -0.033, 0.006], [0.092, -0.037, 0.008], [0.075, -0.029, 0.005]]], bevel: 0.0008 });
  b.side('metal', [[0.080, -0.013], [0.090, -0.013], [0.090, -0.028, 0.001], [0.080, -0.028, 0.001]], 0.0060);
  // hammer, grip safety (beavertail)
  b.side('metal', [[-0.002, -0.006], [0.006, -0.006], [0.006, 0.008, 0.002], [-0.002, 0.016, 0.002], [-0.014, 0.014, 0.003], [-0.006, 0.006, 0.002]], 0.0075);
  b.side('metal', [[0.000, -0.010], [-0.016, -0.012, 0.004], [-0.018, -0.018, 0.004], [-0.006, -0.040, 0.006], [0.002, -0.030]], 0.0215);
  const g = gripOutline(0.030, -0.014, 18, 0.092, (s) => 0.0215 - (s > 0.084 ? (s - 0.084) * 0.3 : 0), (s) => 0.0222 + (s < 0.01 ? (0.01 - s) * 0.4 : 0), 12, 0.004, { topY: -0.0090 });
  b.side('metal', g.pts, 0.0220, { bevel: 0.001 });
  const panel = gripOutline(0.030, -0.020, 18, 0.080, () => 0.0200, () => 0.0200, 6, 0.006);
  for (const s of [-1, 1]) {
    b.side('woodCheck', panel.pts, 0.0040, { x: s * 0.0128, bevel: 0.0012 });
    if (fp) for (const t of [0.012, 0.066]) { const p = panel.point(t); pin(b, 'steel', s * 0.0151, p[1], p[0], 0.0024, { len: 0.001 }); }
  }
  const gp = g.point(0.022);
  if (fp) {
    b.rbox('metal', -0.0128, -0.006, 0.016, 0.0024, 0.006, 0.016, 0.001);
    b.rbox('metal', -0.0122, -0.011, 0.066, 0.0018, 0.006, 0.040, 0.001);
    b.cylX('metal', -0.0128, -0.012, 0.088, 0.0045, 0.002, { seg: 12 });
    b.rbox('steel', -0.0118, -0.026, 0.065, 0.0016, 0.006, 0.006, 0.001);
  }
  gripMag(b, 'blued', 0.030, -0.016, 18, 0.086, 0.032, 0.0165, { plate: 0.004, plateExtra: 0.001, plateWide: 0.001 });
  suppressorOrBore(b, att, L + 0.004, 0.0060);
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.0118, 0.006, 0.104, [0, 0.15, 0.75]);
  cupHand(b, gp);
  if (att.optic === 'reddot') optic(b, 'reddot', 0.034, top - 0.002, { pistol: true, slide, eye: PISTOL_RELIEF });
  else ironSight(b, sy, 0.012, PISTOL_RELIEF);
}

// ------------------------------------------------------------------ Desert Eagle

function deagle(b, att) {
  const fp = b.fp;
  const S = 'stainless';
  const sy = 0.0300;
  const slide = b.group('bolt', 0, 0, 0);
  slide.section(S, [[-0.0160, -0.010], [0.0160, -0.010], [0.0160, 0.012], [0.0118, 0.020, 0.004], [-0.0118, 0.020, 0.004], [-0.0160, 0.012]], 0, 0.136, { bevel: 0.001 });
  if (fp) {
    for (let i = 0; i < 7; i++) for (const s of [-1, 1]) slide.box(S, s * 0.0160, 0.002, 0.012 + i * 0.005, 0.0008, 0.016, 0.0016, { tint: 0.4 });
    slide.hole(S, 0.0161, 0.005, 0.098, 0.0006, 0.012, 0.040);
    for (const s of [-1, 1]) slide.rbox(S, s * 0.0178, 0.004, 0.016, 0.004, 0.007, 0.014, 0.002);
  }
  slide.section(S, notchPts(sy, 0.019), 0.008, 0.016);
  // fixed triangular barrel with top rail + front sight, frame under it
  b.section(S, [[-0.0150, -0.011], [0.0150, -0.011], [0.0150, 0.002], [0.0058, 0.020, 0.002], [-0.0058, 0.020, 0.002], [-0.0150, 0.002]], 0.136, 0.270, { bevel: 0.001 });
  b.section(S, rrect(-0.0050, 0.019, 0.0050, 0.0235, 0.001), 0.140, 0.268, {});
  if (fp) for (let i = 0; i < 10; i++) b.hole(S, 0, 0.0236, 0.150 + i * 0.011, 0.008, 0.0006, 0.004);
  b.rbox(S, 0, (0.0235 + sy) / 2, 0.262, 0.0036, sy - 0.0235, 0.008, 0.0008);
  if (fp) b.dot(S, 0, 0, 0.2702, 0.0068, 'z', { tint: 0.03 });
  b.anchor('muzzle', 0, 0, 0.270);
  b.side(S, [[-0.004, -0.010], [0.244, -0.010], [0.246, -0.020, 0.004], [0.236, -0.028, 0.004], [0.154, -0.028], [0.050, -0.020], [-0.004, -0.020, 0.003]], 0.0290, { bevel: 0.0012 });
  b.side(S, [[0.084, -0.022], [0.154, -0.024], [0.160, -0.030, 0.003], [0.158, -0.040], [0.150, -0.050, 0.006], [0.110, -0.054, 0.01], [0.084, -0.040, 0.006]], 0.0110,
    { holes: [[[0.094, -0.026], [0.146, -0.0275], [0.146, -0.040, 0.006], [0.112, -0.047, 0.008], [0.094, -0.036, 0.005]]], bevel: 0.0008 });
  trigger(b, S, 0.114, -0.020, { scale: 1.05, width: 0.007 });
  b.side(S, [[-0.002, -0.008], [0.006, -0.008], [0.006, 0.010, 0.002], [-0.004, 0.020, 0.003], [-0.014, 0.017, 0.003], [-0.008, 0.006, 0.002]], 0.009);
  const g = gripOutline(0.042, -0.016, 16, 0.108, (s) => 0.0262 - (s > 0.098 ? (s - 0.098) * 0.3 : 0), (s) => 0.0268 + bump(s, 0.07, 0.025, 0.0012) + (s < 0.012 ? (0.012 - s) * 0.45 : 0), 14, 0.006, { topY: -0.0105 });
  b.side('polymer', g.pts, 0.0345, { bevel: 0.0028 });
  b.side(S, gripOutline(0.042, -0.016, 16, 0.108, () => 0.0270, () => 0.0274, 5, 0.006, { topY: -0.0100 }).pts, 0.0255, { bevel: 0.001 });
  const gp = g.point(0.021);
  gripMag(b, S, 0.042, -0.018, 16, 0.110, 0.042, 0.0240, { plate: 0.005 });
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.0162, 0.006, 0.098, [0, 0.15, 0.75]);
  cupHand(b, gp);
  if (att.optic === 'reddot') optic(b, 'reddot', 0.215, 0.0235, { pistol: true, eye: PISTOL_RELIEF });
  else ironSight(b, sy, 0.012, PISTOL_RELIEF);
}

function notchPts(sy, y0) { return notch(sy, y0, 0.0080, 0.0019, 0.0030); }

// ------------------------------------------------------------------ .357 revolver (S&W 686 style, 4")

function r357(b, att) {
  const fp = b.fp;
  const S = 'stainless';
  const cy = -0.0115; // cylinder axis height (top chamber aligned with the bore)
  const sy = 0.0265;
  // frame with cylinder window, top strap, recoil shield
  b.side(S, [[-0.006, 0.010, 0.004], [0.004, 0.0195, 0.004], [0.074, 0.0195], [0.076, 0.010], [0.076, -0.016], [0.066, -0.022, 0.004], [0.066, -0.042, 0.004],
    [0.010, -0.044, 0.004], [-0.006, -0.032, 0.004]], 0.0300, { holes: [[[0.011, 0.0105, 0.002], [0.060, 0.0105, 0.002], [0.060, -0.0335, 0.002], [0.011, -0.0335, 0.002]]], bevel: 0.001 });
  // barrel with full underlug, rib, front ramp
  b.section(S, rrect(-0.0090, -0.021, 0.0090, 0.0115, 0.005), 0.074, 0.190, { bevel: 0.0012 });
  b.section(S, rrect(-0.0042, 0.011, 0.0042, 0.0150, 0.001), 0.074, 0.188, {});
  b.side(S, [[0.160, 0.0160], [0.186, 0.0160], [0.186, sy, 0.001], [0.180, sy, 0.001]], 0.0030);
  if (fp) {
    b.side('paint', [[0.181, sy - 0.0035], [0.1855, sy - 0.0035], [0.1855, sy - 0.0012], [0.1818, sy - 0.0012]], 0.0032, { tint: [0.85, 0.08, 0.05] });
    b.dot(S, 0, 0, 0.1902, 0.0046, 'z', { tint: 0.03 });
  }
  b.anchor('muzzle', 0, 0, 0.190);
  // adjustable rear sight on the top strap
  b.rbox(S, 0, 0.0215, 0.012, 0.010, 0.004, 0.020, 0.0015, { tint: 0.35 });
  b.section(S, notch(sy, 0.0215, 0.0062, 0.0016, 0.0028), 0.006, 0.010, { tint: 0.35 });
  // hammer, trigger, guard, cylinder latch
  b.side(S, [[-0.004, 0.000], [0.004, 0.004], [0.004, 0.012, 0.002], [-0.006, 0.022, 0.003], [-0.020, 0.024, 0.003], [-0.012, 0.012, 0.003]], 0.0080);
  b.side(S, [[0.026, -0.040], [0.068, -0.040], [0.066, -0.050, 0.004], [0.056, -0.062, 0.01], [0.032, -0.062, 0.01], [0.022, -0.050, 0.004]], 0.0090,
    { holes: [[[0.032, -0.043], [0.060, -0.043], [0.056, -0.055, 0.006], [0.038, -0.057, 0.006], [0.030, -0.050, 0.004]]] });
  trigger(b, S, 0.044, -0.040, { scale: 0.9, width: 0.0065 });
  if (fp) b.rbox(S, -0.0158, -0.008, 0.002, 0.003, 0.008, 0.012, 0.0012);
  // round-butt grip with wood panels
  const g = gripOutline(-0.002, -0.028, 18, 0.096, (s) => 0.0185 + bump(s, 0.03, 0.01, 0.0018) - (s > 0.086 ? (s - 0.086) * 0.4 : 0), (s) => 0.0205 + bump(s, 0.06, 0.025, 0.0015), 14, 0.012, { topY: -0.020 });
  b.side('woodCheck', g.pts, 0.0345, { bevel: 0.003 });
  const gp = g.point(0.022);
  // swing-out cylinder: group pivots on the crane axis (rotate +Z to swing out left); child spins on the bore-parallel cylinder axis
  const px = -0.006; const py = -0.034;
  const crane = b.group('cylinder', px, py, 0);
  crane.side(S, [[0.058, cy], [0.064, cy], [0.064, py], [0.058, py]], 0.008, { x: -0.003 });
  crane.tube('steel', 0.0032, 0.058, 0.128, { y: cy, seg: 10, tint: 0.7 });
  crane.lathe('steel', [[0, 0.128], [0.0048, 0.128], [0.0048, 0.138], [0, 0.138]], { y: cy, seg: 10, tint: 0.7 });
  const spin = crane.group('cylinderSpin', 0, cy, 0);
  spin.lathe(S, [[0.004, 0.0125], [0.0185, 0.0125], [0.0196, 0.0140], [0.0196, 0.0555], [0.0185, 0.0575], [0.004, 0.0575]], { y: cy, seg: fp ? 30 : 10 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const ca = Math.sin(a); const cb = Math.cos(a);
    if (fp) {
      spin.dot(S, ca * 0.0115, cy + cb * 0.0115, 0.0577, 0.0047, 'z', { tint: 0.04 });
      spin.tube('brass', 0.0055, 0.0118, 0.0128, { x: ca * 0.0115, y: cy + cb * 0.0115, seg: 12 });
      const fa = a + Math.PI / 6;
      spin.box(S, Math.sin(fa) * 0.0192, cy + Math.cos(fa) * 0.0192, 0.036, 0.0040, 0.0016, 0.024, { rz: -fa, tint: 0.35 });
    }
  }
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0, cy, 0.012, [0, -Math.PI / 2, 0]);
  cupHand(b, gp);
  ironSight(b, sy, 0.008, PISTOL_RELIEF);
}

export const PISTOL_BUILDERS = { glock18, m9, m1911, deagle, r357 };
