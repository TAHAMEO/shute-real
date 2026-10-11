// Submachine guns: MP5A3, KRISS Vector .45, UMP45, MP7.
// Gun space: bore on y = 0, f = 0 at the rear of the receiver.
import * as THREE from 'three';
import { extrudeSide, rrect } from '../weapon-parts.js';
import {
  rail, buisRear, buisFront, trigger, pin, boxMag, muzzle, foregrip, optic, ironSight, gripOutline, bump, pivotX,
} from './accessories.js';
import { bufferTube, carStock, ringStemPts, circleHole } from './rifles-ar.js';

/** HK rotary diopter rear sight: block with a real aperture, round side caps, wings. */
function hkDrum(b, M, f, sy, base) {
  const r = 0.0105;
  b.rbox(M, 0, (base + sy - 0.010) / 2, f, 0.020, sy - 0.010 - base, 0.024, 0.003);
  b.section(M, rrect(-0.0068, sy - r, 0.0068, sy + r, 0.006), f - r, f + r, { holes: [circleHole(0, sy, 0.0019, b.fp ? 14 : 8)] });
  for (const s of [-1, 1]) {
    b.cylX(M, s * 0.0075, sy, f, r, 0.0016, { seg: b.fp ? 20 : 8 });
    b.side(M, [[f - 0.012, base], [f + 0.012, base], [f + 0.010, sy + 0.012, 0.003], [f - 0.006, sy + 0.012, 0.003]], 0.0025, { x: s * 0.0115 });
  }
}

/** HK hooded front post (ring around the post, tip at sy). */
function hkHoodFront(b, M, f, sy, base, len = 0.012) {
  const cy = sy - 0.0012;
  const ri = 0.0085; const pw = 0.0009;
  const a1 = Math.asin(pw / ri);
  const yb = cy - Math.sqrt(ri * ri - pw * pw);
  const hp = [];
  const n = b.fp ? 18 : 8;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + a1 + (i / n) * (Math.PI * 2 - 2 * a1);
    hp.push([Math.cos(a) * ri, cy + Math.sin(a) * ri]);
  }
  hp.push([-pw, yb], [-pw, sy - 0.0006], [-pw * 0.6, sy], [pw * 0.6, sy], [pw, sy - 0.0006], [pw, yb]);
  b.section(M, ringStemPts(0, cy, 0.0105, 0.007, base), f - len / 2, f + len / 2, { holes: [hp] });
}

// ------------------------------------------------------------------ MP5A3

function mp5(b, att) {
  const fp = b.fp;
  const M = 'metal';
  const sy = 0.046;
  // receiver (rounded top), cocking tube, front sight
  b.section(M, [[-0.0155, -0.020], [0.0155, -0.020], [0.0155, 0.018], [0.0, 0.031, 0.013], [-0.0155, 0.018]], 0.012, 0.272, { bevel: 0.0009 });
  b.section(M, rrect(-0.0150, -0.020, 0.0150, 0.010, 0.004), 0.0, 0.014, {});
  b.tube(M, 0.0105, 0.268, 0.384, { y: 0.020, seg: b.q.segS });
  b.side(M, [[0.372, -0.012], [0.398, -0.012, 0.003], [0.398, 0.030, 0.004], [0.374, 0.030]], 0.022);
  hkHoodFront(b, M, 0.390, sy, 0.028);
  hkDrum(b, M, 0.034, sy, 0.028);
  if (fp) {
    b.hole(M, 0.0156, 0.004, 0.142, 0.0006, 0.014, 0.046);
    b.box('steel', 0.0154, 0.004, 0.142, 0.0006, 0.009, 0.036, { tint: 0.45 });
    b.hole(M, -0.0156, 0.020, 0.300, 0.0006, 0.003, 0.120);
    for (const s of [-1, 1]) { pin(b, 'steel', s * 0.0156, -0.012, 0.020, 0.0025); pin(b, 'steel', s * 0.0156, -0.012, 0.165, 0.0025); }
    for (const fx of [0.06, 0.12, 0.18]) b.box(M, 0, 0.031, fx, 0.010, 0.002, 0.010, { tint: 0.8 });
  }
  // barrel + 3-lug
  b.lathe('blued', [[0.0085, 0.268], [0.0085, 0.392], [0.0092, 0.394], [0.0092, 0.402], [0.0078, 0.405], [0, 0.405]], { seg: b.q.segS + 2 });
  if (fp) for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; b.box('blued', Math.sin(a) * 0.0095, Math.cos(a) * 0.0095, 0.397, 0.004, 0.003, 0.008, { rz: -a }); }
  muzzle(b, att.muzzle, 0.405, 0.0078, { style: 'ar', r: 0.0175, len: 0.150 });
  // slimline handguard
  b.section('polymer', [[-0.019, -0.012], [-0.014, -0.022, 0.005], [0.014, -0.022, 0.005], [0.019, -0.012], [0.019, 0.010], [0.0125, 0.016, 0.004], [-0.0125, 0.016, 0.004], [-0.019, 0.010]], 0.234, 0.350, { bevel: 0.002 });
  if (fp) for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.hole('polymer', s * 0.0191, -0.006, 0.252 + i * 0.024, 0.0006, 0.010, 0.012, { tint: 0.2 });
  // magwell + SEF trigger group with grip
  b.side(M, [[0.165, -0.019], [0.218, -0.019], [0.218, -0.040, 0.003], [0.165, -0.042, 0.003]], 0.0290);
  b.side('polymer', [[0.016, -0.018], [0.165, -0.018], [0.165, -0.030, 0.004], [0.150, -0.032], [0.146, -0.040, 0.004], [0.140, -0.058, 0.006], [0.076, -0.060, 0.008], [0.060, -0.040], [0.016, -0.034, 0.006]], 0.024,
    { holes: [[[0.082, -0.036], [0.136, -0.036], [0.132, -0.052, 0.004], [0.088, -0.054, 0.005], [0.080, -0.044, 0.003]]], bevel: 0.0016 });
  trigger(b, M, 0.104, -0.031);
  const g = gripOutline(0.046, -0.030, 20, 0.098, (s) => 0.0142 + bump(s, 0.040, 0.012, 0.002), (s) => 0.0150 + bump(s, 0.060, 0.024, 0.0016) + (s < 0.012 ? (0.012 - s) * 0.4 : 0), 12, 0.007);
  b.side('polymer', g.pts, 0.027, { bevel: 0.0024 });
  const gp = g.point(0.021);
  if (fp) {
    b.cylX('polymer', -0.0128, -0.024, 0.040, 0.005, 0.002, { seg: 12 });
    b.rbox(M, -0.0140, -0.017, 0.040, 0.0018, 0.012, 0.004, 0.0008);
    b.rbox(M, 0, -0.046, 0.160, 0.012, 0.010, 0.006, 0.002);
  }
  // A3 retractable stock (extended)
  for (const s of [-1, 1]) b.tube('steel', 0.0048, -0.268, 0.004, { x: s * 0.0128, y: 0.000, seg: b.q.segXS + 2, tint: 0.55 });
  b.side(M, [[-0.262, 0.026, 0.004], [-0.272, 0.026, 0.003], [-0.276, -0.004, 0.006], [-0.272, -0.086, 0.004], [-0.262, -0.088, 0.004], [-0.264, -0.060, 0.006], [-0.258, -0.010, 0.004]], 0.034, { bevel: 0.0015 });
  b.side('rubber', [[-0.272, 0.025], [-0.284, 0.024, 0.004], [-0.288, -0.004, 0.008], [-0.284, -0.086, 0.004], [-0.272, -0.087]], 0.036, { bevel: 0.002 });
  // cocking handle on the left of the cocking tube
  const bolt = b.group('bolt', -0.010, 0.020, 0.360);
  bolt.rbox(M, -0.018, 0.022, 0.360, 0.020, 0.005, 0.008, 0.0015, { ry: 0.25, rz: -0.2 });
  bolt.cylY('polymer', -0.029, 0.025, 0.362, 0.0042, 0.010, { seg: 10, rz: -0.2 });
  // curved 30 rd magazine
  const m = b.group('magazine', 0, -0.022, 0.1915);
  boxMag(m, M, { fc: 0.1915, yTop: -0.022, depth: 0.034, width: 0.0235, straight: 0.040, arc: 0.150, radius: 0.22, ribs: 'side', ribTop: 0.035, plateMat: M, plate: 0.005, roundR: 0.0045, roundLen: 0.028, tint: 1.1 });
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.0165, 0.004, 0.142, [0, 0.25, 0.4]);
  const lh = att.grip !== 'none' ? (rail(b, 'anodized', 0.262, 0.336, 0.022, { roll: Math.PI }), foregrip(b, att.grip, 0.300, -0.0315)) : null;
  b.anchor('leftHand', ...(lh || [0, -0.026, 0.300]));
  if (att.optic === 'iron') ironSight(b, sy, 0.034 - 0.006);
  else {
    // HK claw mount with rail
    b.side('anodized', [[0.060, 0.026], [0.210, 0.026], [0.205, 0.046, 0.004], [0.066, 0.046, 0.004]], 0.024);
    if (fp) for (const fx of [0.075, 0.190]) b.box('anodized', 0, 0.026, fx, 0.034, 0.008, 0.012);
    const rt = rail(b, 'anodized', 0.066, 0.204, 0.046);
    optic(b, att.optic, { reddot: 0.100, holo: 0.112 }[att.optic], rt, { h: att.optic === 'reddot' ? 0.028 : 0.030 });
  }
}

// ------------------------------------------------------------------ KRISS Vector .45

function vector(b, att) {
  const fp = b.fp;
  const P = 'polymer';
  // upper / Super V lower block with the angled front face
  b.side(P, [[0.000, 0.030, 0.004], [0.238, 0.030], [0.244, 0.020, 0.004], [0.244, -0.022, 0.004], [0.226, -0.040, 0.006], [0.168, -0.086, 0.008],
    [0.150, -0.088, 0.006], [0.150, -0.044], [0.060, -0.040], [0.020, -0.032, 0.006], [0.000, -0.020, 0.004]], 0.042, { bevel: 0.002 });
  b.side(P, [[0.052, -0.038], [0.150, -0.042], [0.150, -0.050], [0.140, -0.066, 0.006], [0.072, -0.068, 0.008], [0.056, -0.054, 0.004]], 0.020,
    { holes: [[[0.072, -0.044], [0.138, -0.046], [0.134, -0.061, 0.004], [0.078, -0.062, 0.005], [0.070, -0.052, 0.003]]] });
  trigger(b, 'metal', 0.096, -0.040);
  if (fp) {
    b.hole(P, 0.0211, 0.008, 0.140, 0.0006, 0.014, 0.040);
    for (const s of [-1, 1]) b.side(P, [[0.150, -0.020], [0.226, -0.020], [0.212, -0.040], [0.172, -0.072], [0.158, -0.072]], 0.0012, { x: s * 0.0211, tint: 0.7 });
    for (const s of [-1, 1]) { pin(b, 'steel', s * 0.0211, -0.010, 0.040, 0.0026); pin(b, 'steel', s * 0.0211, -0.010, 0.200, 0.0026); }
    b.cylX(P, -0.0215, -0.022, 0.060, 0.005, 0.002, { seg: 12 });
    b.rbox('metal', -0.0225, -0.016, 0.060, 0.0018, 0.012, 0.004, 0.0008);
  }
  const rt = rail(b, 'anodized', 0.004, 0.320, 0.030);
  // front shroud / rail section, barrel
  b.section(P, rrect(-0.019, -0.020, 0.019, 0.030, 0.006), 0.244, 0.322, { bevel: 0.002 });
  rail(b, 'anodized', 0.250, 0.318, 0.019, { roll: -Math.PI / 2 });
  rail(b, 'anodized', 0.250, 0.318, 0.020, { roll: Math.PI });
  b.lathe('blued', [[0.0085, 0.322], [0.0085, 0.338], [0, 0.338]], { seg: b.q.segS });
  muzzle(b, att.muzzle, 0.338, 0.0080, { style: 'ar', r: 0.0185, len: 0.160 });
  const g = gripOutline(0.034, -0.034, 18, 0.100, (s) => 0.0145 + bump(s, 0.042, 0.012, 0.002), (s) => 0.0150 + bump(s, 0.060, 0.024, 0.0016) + (s < 0.012 ? (0.012 - s) * 0.4 : 0), 12, 0.007);
  b.side(P, g.pts, 0.027, { bevel: 0.0024 });
  const gp = g.point(0.021);
  // folding stock adapter + M4 stock
  b.rbox(P, 0, 0.004, -0.010, 0.034, 0.044, 0.020, 0.004);
  b.tube('anodized', 0.0146, -0.200, -0.016, { seg: b.q.segS + 2 });
  carStock(b, -0.290);
  // charging handle (left)
  const bolt = b.group('bolt', -0.021, 0.016, 0.200);
  bolt.rbox('metal', -0.026, 0.016, 0.200, 0.010, 0.008, 0.014, 0.002);
  // long Glock 21 magazine through the lower block
  const m = b.group('magazine', 0, -0.030, 0.190);
  boxMag(m, P, { fc: 0.190, yTop: -0.030, depth: 0.034, width: 0.0245, straight: 0.215, arc: 0, ribs: 'none', plateMat: P, plate: 0.007, roundR: 0.0055, roundLen: 0.026 });
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.022, 0.008, 0.140, [0, 0.25, 0.45]);
  const lh = att.grip !== 'none' ? foregrip(b, att.grip, 0.285, -0.0295) : null;
  b.anchor('leftHand', ...(lh || [0, -0.034, 0.276]));
  const s = rt + 0.036;
  if (att.optic === 'iron') {
    buisRear(b, 'anodized', 0.020, rt, s, true);
    buisFront(b, 'anodized', 0.310, rt, s, true);
    ironSight(b, s, 0.020 - 0.0016);
  } else {
    buisFront(b, 'anodized', 0.310, rt, s, false);
    optic(b, att.optic, { reddot: 0.080, holo: 0.092 }[att.optic], rt);
  }
}

// ------------------------------------------------------------------ UMP45

function ump45(b, att) {
  const fp = b.fp;
  const P = 'polymer';
  const sy = 0.064;
  b.side(P, [[0.000, 0.026, 0.004], [0.300, 0.026, 0.004], [0.312, 0.016, 0.004], [0.312, -0.028, 0.004], [0.250, -0.032, 0.006], [0.222, -0.040, 0.004],
    [0.218, -0.066, 0.003], [0.160, -0.066, 0.003], [0.156, -0.040], [0.140, -0.040], [0.134, -0.060, 0.006], [0.070, -0.062, 0.008], [0.050, -0.044],
    [0.020, -0.034, 0.006], [0.000, -0.026, 0.004]], 0.044, { holes: [[[0.074, -0.040], [0.130, -0.040], [0.126, -0.055, 0.004], [0.080, -0.056, 0.005], [0.072, -0.047, 0.003]]], bevel: 0.002 });
  trigger(b, 'metal', 0.098, -0.034);
  if (fp) {
    b.hole(P, 0.0221, 0.006, 0.140, 0.0006, 0.016, 0.044);
    for (const s of [-1, 1]) { pin(b, 'steel', s * 0.0221, -0.014, 0.024, 0.0026); pin(b, 'steel', s * 0.0221, -0.014, 0.196, 0.0026); }
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) b.box(P, s * 0.0222, -0.012, 0.236 + i * 0.012, 0.0012, 0.020, 0.004, { tint: 0.8 });
    b.cylX(P, -0.0225, -0.024, 0.040, 0.005, 0.002, { seg: 12 });
    b.rbox('metal', -0.0234, -0.017, 0.040, 0.0018, 0.012, 0.004, 0.0008);
  }
  const rt = rail(b, 'anodized', 0.040, 0.272, 0.026);
  hkDrum(b, P, 0.018, sy, 0.026);
  hkHoodFront(b, P, 0.290, sy, 0.026, 0.014);
  rail(b, 'anodized', 0.230, 0.306, 0.022, { roll: -Math.PI / 2 });
  rail(b, 'anodized', 0.230, 0.306, 0.022, { roll: Math.PI / 2 });
  if (att.grip !== 'none') rail(b, 'anodized', 0.250, 0.306, 0.029, { roll: Math.PI });
  b.lathe('blued', [[0.0092, 0.312], [0.0092, 0.346], [0, 0.346]], { seg: b.q.segS });
  muzzle(b, att.muzzle, 0.346, 0.0085, { style: 'ar', r: 0.019, len: 0.160 });
  const g = gripOutline(0.030, -0.030, 16, 0.100, (s) => 0.0145 + bump(s, 0.040, 0.012, 0.0018), (s) => 0.0152 + bump(s, 0.060, 0.024, 0.0016) + (s < 0.012 ? (0.012 - s) * 0.4 : 0), 12, 0.007);
  b.side(P, g.pts, 0.028, { bevel: 0.0024 });
  const gp = g.point(0.021);
  // side-folding skeleton stock (extended)
  b.rbox(P, 0, 0.000, -0.008, 0.036, 0.046, 0.016, 0.004);
  b.side(P, [[-0.010, 0.020, 0.004], [-0.232, 0.024, 0.006], [-0.244, 0.016, 0.004], [-0.244, -0.092, 0.004], [-0.232, -0.098, 0.006], [-0.200, -0.096, 0.008], [-0.010, -0.020, 0.006]], 0.030,
    { holes: [[[-0.030, 0.008, 0.004], [-0.218, 0.011, 0.006], [-0.222, -0.002, 0.004], [-0.222, -0.072, 0.006], [-0.200, -0.078, 0.008], [-0.050, -0.012, 0.006]]], bevel: 0.0016 });
  b.side('rubber', [[-0.244, 0.018], [-0.252, 0.017, 0.002], [-0.252, -0.094, 0.003], [-0.244, -0.097]], 0.032);
  // cocking handle front-left
  const bolt = b.group('bolt', -0.022, 0.016, 0.272);
  bolt.rbox('metal', -0.028, 0.016, 0.272, 0.014, 0.006, 0.010, 0.002, { rz: -0.25 });
  bolt.cylY(P, -0.036, 0.019, 0.272, 0.0045, 0.010, { seg: 10, rz: -0.25 });
  const m = b.group('magazine', 0, -0.024, 0.189);
  boxMag(m, P, { fc: 0.189, yTop: -0.024, depth: 0.050, width: 0.0265, straight: 0.150, arc: 0.012, radius: 0.5, ribs: 'side', ribTop: 0.06, plateMat: P, plate: 0.006, roundR: 0.0058, roundLen: 0.03, tint: 1.25 });
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.023, 0.006, 0.140, [0, 0.25, 0.45]);
  const lh = att.grip !== 'none' ? foregrip(b, att.grip, 0.278, -0.0385) : null;
  b.anchor('leftHand', ...(lh || [0, -0.032, 0.276]));
  if (att.optic === 'iron') ironSight(b, sy, 0.018 - 0.0105);
  else optic(b, att.optic, { reddot: 0.110, holo: 0.122 }[att.optic], rt, { h: 0.046 });
}

// ------------------------------------------------------------------ MP7

function mp7(b, att) {
  const fp = b.fp;
  const P = 'polymer';
  b.side(P, [[0.000, 0.024, 0.004], [0.262, 0.024, 0.004], [0.270, 0.012, 0.004], [0.270, -0.020, 0.004], [0.236, -0.030, 0.006], [0.170, -0.032],
    [0.164, -0.054, 0.004], [0.118, -0.056, 0.006], [0.112, -0.030], [0.030, -0.026, 0.006], [0.000, -0.016, 0.004]], 0.040,
  { holes: [[[0.122, -0.034], [0.160, -0.034], [0.158, -0.049, 0.004], [0.124, -0.050, 0.004]]], bevel: 0.002 });
  trigger(b, 'metal', 0.136, -0.030);
  // grip with the magazine well inside
  const g = gripOutline(0.092, -0.026, 10, 0.098, (s) => 0.0170 - (s > 0.09 ? (s - 0.09) * 0.2 : 0), (s) => 0.0170 + bump(s, 0.055, 0.025, 0.0014), 10, 0.004);
  b.side(P, g.pts, 0.030, { bevel: 0.0024 });
  const gp = g.point(0.021);
  if (fp) {
    b.hole(P, 0.0201, 0.006, 0.120, 0.0006, 0.012, 0.036);
    for (const s of [-1, 1]) pin(b, 'steel', s * 0.0201, -0.012, 0.030, 0.0025);
    b.cylX(P, -0.0205, -0.018, 0.110, 0.0055, 0.002, { seg: 12 });
    b.rbox('metal', -0.0215, -0.011, 0.110, 0.0018, 0.012, 0.004, 0.0008);
  }
  const rt = rail(b, 'anodized', 0.004, 0.262, 0.024);
  rail(b, 'anodized', 0.200, 0.262, 0.020, { roll: -Math.PI / 2 });
  rail(b, 'anodized', 0.200, 0.262, 0.020, { roll: Math.PI / 2 });
  b.lathe('blued', [[0.0080, 0.270], [0.0080, 0.300], [0, 0.300]], { seg: b.q.segS });
  muzzle(b, att.muzzle, 0.300, 0.0072, { style: 'ar', r: 0.0175, len: 0.150 });
  // integral folding foregrip
  const pivY = -0.030; const pivF = 0.230;
  const ang = att.grip === 'none' ? -Math.PI / 2 + 0.05 : att.grip === 'angled' ? -0.5 : -0.08;
  const pv = pivotX(pivY, pivF, ang);
  b.geo(P, extrudeSide([[pivF - 0.012, pivY], [pivF + 0.012, pivY], [pivF + 0.012, pivY - 0.075, 0.008], [pivF - 0.012, pivY - 0.075, 0.008]], 0.026, b.q, { bevel: 0.0025 }), pv);
  const lv = new THREE.Vector3(0, pivY - 0.045, -pivF).applyMatrix4(pv);
  // retractable stock (extended)
  for (const s of [-1, 1]) b.tube('steel', 0.0040, -0.250, 0.004, { x: s * 0.0135, y: 0.004, seg: b.q.segXS + 2, tint: 0.5 });
  b.side(P, [[-0.248, 0.020, 0.004], [-0.262, 0.020, 0.003], [-0.262, -0.070, 0.004], [-0.248, -0.072, 0.004], [-0.250, -0.020, 0.004]], 0.036, { bevel: 0.0018 });
  // T charging handle
  const bolt = b.group('bolt', 0, 0.018, -0.004);
  bolt.rbox(P, 0, 0.018, -0.006, 0.034, 0.007, 0.009, 0.002);
  // 40 rd magazine inside the grip (tilted with the grip; removal along local -Y)
  const tilt = (10 * Math.PI) / 180;
  const m = b.group('magazine', 0, -0.024, 0.092, -tilt);
  const mg = extrudeSide([[0.080, -0.024], [0.104, -0.024], [0.104, -0.185, 0.002], [0.080, -0.185, 0.002]], 0.022, b.q, { bevel: 0.0008 });
  m.geo(P, mg, pivotX(-0.024, 0.092, -tilt), { tint: 1.2 });
  m.geo(P, extrudeSide([[0.077, -0.184], [0.107, -0.184], [0.107, -0.192, 0.002], [0.077, -0.192, 0.002]], 0.026, b.q, { bevel: 0.0008 }), pivotX(-0.024, 0.092, -tilt));
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.021, 0.006, 0.120, [0, 0.25, 0.45]);
  b.anchor('leftHand', lv.x, lv.y, -lv.z);
  const s = rt + 0.036;
  if (att.optic === 'iron') {
    buisRear(b, 'anodized', 0.022, rt, s, true);
    buisFront(b, 'anodized', 0.252, rt, s, true);
    ironSight(b, s, 0.022 - 0.0016);
  } else {
    buisFront(b, 'anodized', 0.252, rt, s, false);
    optic(b, att.optic, { reddot: 0.085, holo: 0.098 }[att.optic], rt);
  }
}

export const SMG_BUILDERS = { mp5, vector, ump45, mp7 };
