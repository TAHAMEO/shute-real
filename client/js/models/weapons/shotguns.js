// Shotguns: Remington 870 (pump), Benelli M1014 (semi-auto). Saiga-12 lives in rifles-ak.js.
// Gun space: bore on y = 0, f = 0 at the rear of the receiver.
import { rail, trigger, pin, optic, ironSight, gripOutline, bump, slingLoop } from './accessories.js';
import { rrect } from '../weapon-parts.js';
import { ringStemPts, circleHole, frontPostPts } from './rifles-ar.js';

/** Front ramp with blade sight; blade tip at sy. */
function rampBlade(b, M, f, sy, base) {
  b.side(M, [[f - 0.030, base], [f + 0.004, base], [f + 0.004, sy - 0.004, 0.002], [f - 0.002, sy - 0.004]], 0.007);
  b.side(M, [[f - 0.004, sy - 0.006], [f + 0.003, sy - 0.006], [f + 0.003, sy, 0.0006], [f - 0.002, sy, 0.0006]], 0.0028);
  if (b.fp) b.tube('glow', 0.0009, f - 0.0005, f + 0.0005, { y: sy - 0.0012, seg: 8, tint: [1.4, 1.2, 0.5] });
}

// ------------------------------------------------------------------ Remington 870

function r870(b, att) {
  const fp = b.fp;
  const M = 'metal';
  // receiver
  b.side(M, [[0.000, -0.034, 0.003], [0.000, 0.014, 0.006], [0.022, 0.026, 0.012], [0.198, 0.026, 0.004], [0.206, 0.018, 0.003], [0.206, -0.036, 0.003],
    [0.120, -0.040], [0.020, -0.040, 0.004]], 0.0345, { bevel: 0.0011 });
  if (fp) {
    b.hole(M, 0.0175, 0.002, 0.112, 0.0006, 0.024, 0.070);
    b.box('steel', 0.0172, 0.004, 0.106, 0.0006, 0.016, 0.050, { tint: 0.5 });
    b.hole(M, 0, -0.0402, 0.130, 0.018, 0.0006, 0.090);
    for (const s of [-1, 1]) { pin(b, 'steel', s * 0.0175, -0.030, 0.030, 0.0024); pin(b, 'steel', s * 0.0175, -0.030, 0.110, 0.0024); }
    // side saddle with four shells on the left
    b.rbox('polymer', -0.0195, -0.006, 0.090, 0.004, 0.034, 0.096, 0.003);
    for (let i = 0; i < 4; i++) {
      const f = 0.054 + i * 0.024;
      b.cylY('paint', -0.0315, -0.010, f, 0.0102, 0.050, { seg: 12, tint: [0.75, 0.08, 0.06] });
      b.cylY('brass', -0.0315, 0.0215, f, 0.0108, 0.013, { seg: 12 });
    }
  }
  // trigger group (polymer guard), cross-bolt safety
  b.side('polymer', [[0.020, -0.038], [0.120, -0.038], [0.116, -0.048, 0.004], [0.104, -0.062, 0.006], [0.040, -0.064, 0.008], [0.024, -0.050, 0.004]], 0.016,
    { holes: [[[0.044, -0.042], [0.104, -0.042], [0.098, -0.057, 0.004], [0.050, -0.059, 0.005], [0.042, -0.050, 0.003]]] });
  trigger(b, M, 0.066, -0.040);
  if (fp) b.cylX(M, 0, -0.045, 0.034, 0.0032, 0.024, { seg: 10 });
  // barrel, magazine tube + cap, barrel clamp
  b.lathe('blued', [[0.0110, 0.200], [0.0110, 0.232], [0.0106, 0.236], [0.0106, 0.665], [0, 0.665]], { seg: b.q.segS + 2 });
  if (fp) b.dot('blued', 0, 0, 0.6652, 0.0092, 'z', { tint: 0.03 });
  b.anchor('muzzle', 0, 0, 0.665);
  b.tube('blued', 0.0112, 0.200, 0.590, { y: -0.0235, seg: b.q.segS });
  b.lathe('metal', [[0, 0.590], [0.0122, 0.590], [0.0122, 0.612], [0.0105, 0.618], [0, 0.618]], { y: -0.0235, seg: b.q.segS });
  b.section(M, rrect(-0.0125, -0.036, 0.0125, 0.012, 0.010), 0.572, 0.586, {});
  // front ramp sight
  const sy = 0.0335;
  rampBlade(b, M, 0.652, sy, 0.0095);
  // pump forend (bolt group: translate +Z to cycle)
  const pump = b.group('bolt', 0, -0.0235, 0.355);
  pump.section('polymer', [[-0.0215, -0.012], [-0.0160, -0.020, 0.005], [0.0160, -0.020, 0.005], [0.0215, -0.012], [0.0215, 0.012], [0.0150, 0.017, 0.004], [-0.0150, 0.017, 0.004], [-0.0215, 0.012]].map((p) => [p[0], p[1] - 0.0235, p[2]]), 0.270, 0.440, { bevel: 0.002 });
  if (fp) for (let i = 0; i < 9; i++) pump.section('polymer', [[-0.0222, -0.010], [0.0222, -0.010], [0.0222, 0.008], [-0.0222, 0.008]].map((p) => [p[0], p[1] - 0.0235]), 0.288 + i * 0.016, 0.296 + i * 0.016, { tint: 0.75 });
  for (const s of [-1, 1]) pump.box('steel', s * 0.0128, -0.016, 0.230, 0.0018, 0.005, 0.110, { tint: 0.6 });
  // sporter synthetic stock
  b.side('polymer', [[0.004, 0.018, 0.006], [-0.040, 0.004, 0.012], [-0.290, 0.006, 0.01], [-0.305, 0.004, 0.004], [-0.305, -0.124, 0.004], [-0.290, -0.128, 0.006],
    [-0.110, -0.076, 0.02], [-0.050, -0.064, 0.02], [0.004, -0.040, 0.004]], 0.040, { bevel: 0.0032 });
  b.side('rubber', [[-0.305, 0.005], [-0.323, 0.004, 0.004], [-0.323, -0.125, 0.005], [-0.305, -0.128]], 0.042);
  if (fp) slingLoop(b, 'metal', 0, -0.114, -0.240, 0.008, { ry: Math.PI / 2 });
  // rear notch (fixed) on the receiver top
  b.rbox(M, 0, 0.0285, 0.050, 0.016, 0.006, 0.014, 0.002);
  b.section(M, notchOutline(sy, 0.030), 0.044, 0.047);
  const gp = [-0.030, -0.040];
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.018, 0.004, 0.110, [0, 0.2, 0.5]);
  b.anchor('leftHand', 0, -0.044, 0.355);
  if (att.optic === 'iron') ironSight(b, sy, 0.044, 0.25);
  else {
    const rt = rail(b, 'anodized', 0.060, 0.190, 0.026);
    optic(b, att.optic, { reddot: 0.110, holo: 0.122 }[att.optic], rt);
  }
}

function notchOutline(sy, y0) {
  const nw = 0.0012; const nd = 0.0026;
  const pts = [[-0.0075, y0], [0.0075, y0], [0.0075, sy, 0.0006], [nw, sy]];
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI; pts.push([nw * Math.cos(a), sy - nd + nw - nw * Math.sin(a)]); }
  pts.push([-nw, sy], [-0.0075, sy, 0.0006]);
  return pts;
}

// ------------------------------------------------------------------ Benelli M1014

function m1014(b, att) {
  const fp = b.fp;
  const M = 'anodized';
  b.side(M, [[0.000, -0.034, 0.003], [0.000, 0.020, 0.004], [0.214, 0.020, 0.004], [0.218, 0.012, 0.003], [0.218, -0.036, 0.003], [0.130, -0.040], [0.010, -0.040, 0.004]], 0.036, { bevel: 0.0011 });
  const rt = rail(b, M, 0.004, 0.214, 0.020);
  if (fp) {
    b.hole(M, 0.0181, 0.002, 0.118, 0.0006, 0.024, 0.074);
    b.box('steel', 0.0178, 0.003, 0.114, 0.0006, 0.016, 0.054, { tint: 0.5 });
    b.hole(M, 0, -0.0402, 0.140, 0.018, 0.0006, 0.090);
    for (const s of [-1, 1]) pin(b, 'steel', s * 0.0181, -0.030, 0.040, 0.0024);
  }
  // trigger group + grip
  b.side('polymer', [[0.020, -0.038], [0.124, -0.038], [0.120, -0.048, 0.004], [0.108, -0.062, 0.006], [0.044, -0.064, 0.008], [0.028, -0.050, 0.004]], 0.016,
    { holes: [[[0.048, -0.042], [0.108, -0.042], [0.102, -0.057, 0.004], [0.054, -0.059, 0.005], [0.046, -0.050, 0.003]]] });
  trigger(b, 'metal', 0.072, -0.040);
  const g = gripOutline(0.026, -0.036, 22, 0.104, (s) => 0.0146 + bump(s, 0.044, 0.010, 0.0025), (s) => 0.0152 + bump(s, 0.066, 0.024, 0.0018) + (s < 0.012 ? (0.012 - s) * 0.4 : 0), 12, 0.008);
  b.side('polymer', g.pts, 0.028, { bevel: 0.0024 });
  const gp = g.point(0.021);
  // barrel, mag tube, forend, clamp, front sight with wings
  b.lathe('blued', [[0.0115, 0.212], [0.0115, 0.250], [0.0108, 0.256], [0.0108, 0.685], [0, 0.685]], { seg: b.q.segS + 2 });
  if (fp) b.dot('blued', 0, 0, 0.6852, 0.0092, 'z', { tint: 0.03 });
  b.anchor('muzzle', 0, 0, 0.685);
  b.tube('blued', 0.0115, 0.212, 0.600, { y: -0.025, seg: b.q.segS });
  b.lathe('metal', [[0, 0.600], [0.0124, 0.600], [0.0124, 0.622], [0.0108, 0.628], [0, 0.628]], { y: -0.025, seg: b.q.segS });
  b.section('polymer', [[-0.0225, -0.020], [-0.0170, -0.040, 0.006], [0.0170, -0.040, 0.006], [0.0225, -0.020], [0.0225, 0.004], [0.0150, 0.016, 0.005], [-0.0150, 0.016, 0.005], [-0.0225, 0.004]], 0.220, 0.430, { bevel: 0.0022 });
  if (fp) for (let i = 0; i < 6; i++) for (const s of [-1, 1]) b.hole('polymer', s * 0.0226, -0.012, 0.250 + i * 0.026, 0.0006, 0.016, 0.010, { tint: 0.2 });
  b.section('metal', rrect(-0.0128, -0.038, 0.0128, 0.013, 0.010), 0.582, 0.596, {});
  const sy = rt + 0.0125;
  b.side('metal', [[0.650, 0.006], [0.676, 0.006], [0.676, 0.020], [0.660, 0.020]], 0.016);
  b.section('metal', frontPostPts(sy, 0.016, { ear: 0.003, win: sy - 0.020, hw: 0.0085, iw: 0.006, pw: 0.0009 }), 0.660, 0.672);
  // ghost ring rear sight on the rail
  b.rbox('metal', 0, rt + 0.003, 0.034, 0.020, 0.006, 0.020, 0.002);
  b.section('metal', ringStemPts(0, sy, 0.0072, 0.0050, rt + 0.004), 0.030, 0.034, { holes: [circleHole(0, sy, 0.0028, fp ? 16 : 8)] });
  for (const s of [-1, 1]) b.side('metal', [[0.024, rt + 0.004], [0.040, rt + 0.004], [0.036, sy + 0.010, 0.002], [0.028, sy + 0.010, 0.002]], 0.0025, { x: s * 0.0092 });
  // collapsible stock
  b.tube('anodized', 0.0140, -0.200, -0.004, { y: 0.002, seg: b.q.segS + 2 });
  b.side('polymer', [[-0.120, 0.020, 0.006], [-0.282, 0.022, 0.006], [-0.290, 0.012, 0.004], [-0.290, -0.098, 0.004], [-0.276, -0.104, 0.006], [-0.240, -0.098, 0.008], [-0.130, -0.022, 0.006]], 0.032,
    { holes: [[[-0.150, -0.006, 0.006], [-0.268, -0.004, 0.006], [-0.268, -0.078, 0.008], [-0.248, -0.080, 0.008]]], bevel: 0.002 });
  b.side('rubber', [[-0.290, 0.020], [-0.300, 0.019, 0.003], [-0.300, -0.100, 0.004], [-0.290, -0.104]], 0.036);
  // charging handle (bolt, right)
  const bolt = b.group('bolt', 0.0182, -0.004, 0.150);
  bolt.rbox('metal', 0.024, -0.004, 0.150, 0.012, 0.008, 0.010, 0.002);
  bolt.cylX('metal', 0.032, -0.004, 0.150, 0.0055, 0.008, { seg: 10 });
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.019, 0.003, 0.118, [0, 0.2, 0.5]);
  b.anchor('leftHand', 0, -0.040, 0.330);
  if (att.optic === 'iron') ironSight(b, sy, 0.030);
  else optic(b, att.optic, { reddot: 0.110, holo: 0.122 }[att.optic], rt);
}

export const SHOTGUN_BUILDERS = { r870, m1014 };
