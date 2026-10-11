// Bullpups: Steyr AUG A3, FN F2000 Tactical, FN P90.
// Gun space: bore on y = 0, f = 0 at the butt (rear end of the stock).
import * as THREE from 'three';
import { extrudeSide } from '../weapon-parts.js';
import { rail, buisRear, buisFront, trigger, pin, boxMag, magOutline, muzzle, foregrip, optic, ironSight, pivotX } from './accessories.js';
import { stanag } from './rifles-ar.js';

// ------------------------------------------------------------------ AUG A3

function aug(b, att) {
  const fp = b.fp;
  const G = 'green';
  // stock shell
  b.side(G, [[0.000, 0.017, 0.006], [0.230, 0.024, 0.006], [0.236, 0.012], [0.445, 0.012], [0.452, 0.000, 0.004], [0.452, -0.020, 0.004],
    [0.420, -0.032, 0.006], [0.206, -0.058, 0.006], [0.124, -0.058, 0.004], [0.040, -0.072, 0.02], [0.000, -0.079, 0.006]], 0.052, { bevel: 0.003 });
  // big trigger guard with integral grip
  b.side(G, [[0.420, -0.026], [0.412, -0.060, 0.006], [0.401, -0.112, 0.012], [0.300, -0.121, 0.01], [0.268, -0.117, 0.01], [0.250, -0.064, 0.02], [0.246, -0.040], [0.300, -0.034]], 0.030,
    { holes: [[[0.302, -0.042, 0.005], [0.398, -0.042, 0.008], [0.391, -0.102, 0.01], [0.318, -0.108, 0.008], [0.297, -0.072, 0.01]]], bevel: 0.003 });
  b.side('rubber', [[0.000, 0.017], [-0.009, 0.016, 0.003], [-0.009, -0.078, 0.004], [0.000, -0.079]], 0.050);
  trigger(b, 'polymer', 0.322, -0.040, { width: 0.008, scale: 1.3 });
  if (fp) {
    // ejection port (right) + cover (left), mag release, cross-bolt safety, sling loops
    b.hole(G, 0.0262, 0.000, 0.150, 0.0006, 0.016, 0.050);
    b.rbox(G, -0.0262, 0.000, 0.150, 0.002, 0.018, 0.054, 0.003, { tint: 0.8 });
    b.rbox('polymer', 0, -0.060, 0.112, 0.016, 0.008, 0.010, 0.002);
    b.cylX('polymer', 0, -0.020, 0.300, 0.0045, 0.058, { seg: 12 });
    b.torus('metal', 0.000, -0.064, 0.050, 0.008, 0.0016, { ry: Math.PI / 2 });
  }
  // receiver with A3 rail
  b.side('anodized', [[0.232, 0.010], [0.446, 0.010], [0.446, 0.030, 0.004], [0.436, 0.036, 0.003], [0.240, 0.036, 0.003], [0.232, 0.030, 0.003]], 0.034, { bevel: 0.001 });
  const rt = rail(b, 'anodized', 0.236, 0.442, 0.036);
  // barrel, gas cylinder, grip collar
  b.lathe('blued', [[0.0108, 0.446], [0.0108, 0.700], [0.0096, 0.704], [0.0096, 0.745], [0, 0.745]], { seg: b.q.segS + 2 });
  b.tube('metal', 0.0085, 0.452, 0.545, { x: 0.010, y: 0.012, seg: b.q.segS });
  b.lathe('polymer', [[0.0180, 0.452], [0.0185, 0.454], [0.0185, 0.478], [0.0160, 0.482]], { seg: b.q.segS + 2 });
  if (fp) b.cylX('metal', 0.0, 0.0, 0.535, 0.006, 0.030, { seg: 10 });
  muzzle(b, att.muzzle, 0.745, 0.0090, { style: 'ar' });
  // integral folding foregrip: folded forward for 'none', vertical for 'vertical', canted for 'angled'
  const pivY = -0.018; const pivF = 0.468;
  const ang = att.grip === 'none' ? -Math.PI / 2 + 0.06 : att.grip === 'angled' ? -0.55 : -0.12;
  const pv = pivotX(pivY, pivF, ang);
  const gpts = [[pivF - 0.014, pivY], [pivF + 0.014, pivY], [pivF + 0.016, pivY - 0.020, 0.006], [pivF + 0.014, pivY - 0.104, 0.01], [pivF - 0.016, pivY - 0.106, 0.01], [pivF - 0.016, pivY - 0.020, 0.006]];
  b.geo(G, extrudeSide(gpts, 0.030, b.q, { bevel: 0.003 }), pv);
  const lv = new THREE.Vector3(0, pivY - 0.055, -pivF).applyMatrix4(pv);
  // charging handle (left)
  const bolt = b.group('bolt', -0.017, 0.022, 0.420);
  bolt.rbox('anodized', -0.022, 0.022, 0.420, 0.012, 0.010, 0.012, 0.002);
  bolt.cylX('polymer', -0.031, 0.024, 0.420, 0.0062, 0.010, { seg: 12 });
  // translucent magazine with rounds
  const m = b.group('magazine', 0, -0.036, 0.165);
  const mp = { fc: 0.165, yTop: -0.036, depth: 0.062, width: 0.028, straight: 0.050, arc: 0.090, radius: 0.20, plate: 0.006 };
  boxMag(m, 'smoky', { ...mp, ribs: 'none', plateMat: 'polymer', rounds: false });
  if (fp) {
    const inner = magOutline({ ...mp, depth: 0.050, s0: 0.004, s1: mp.straight + mp.arc - 0.006 });
    m.side('brass', inner.pts, 0.019, { bevel: 0.0005, tint: 0.85 });
  }
  const gp = [0.272, -0.058];
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.027, 0.000, 0.150, [0, 0.15, 0.2]);
  b.anchor('leftHand', lv.x, lv.y, -lv.z);
  if (att.optic === 'iron') {
    buisRear(b, 'anodized', 0.248, rt, rt + 0.036, true);
    buisFront(b, 'anodized', 0.436, rt, rt + 0.036, true);
    ironSight(b, rt + 0.036, 0.248 - 0.0016);
  } else {
    buisFront(b, 'anodized', 0.436, rt, rt + 0.036, false);
    optic(b, att.optic, { reddot: 0.290, holo: 0.300, acog: 0.276 }[att.optic], rt);
  }
}

// ------------------------------------------------------------------ F2000 Tactical

function f2000(b, att) {
  const fp = b.fp;
  const T = 'tan';
  b.side(T, [[0.000, 0.028, 0.008], [0.585, 0.030, 0.012], [0.622, 0.020, 0.02], [0.636, -0.006, 0.01], [0.628, -0.036, 0.008], [0.380, -0.044, 0.01],
    [0.362, -0.052, 0.006], [0.356, -0.116, 0.01], [0.326, -0.123, 0.01], [0.264, -0.119, 0.01], [0.238, -0.064, 0.02], [0.150, -0.060, 0.01],
    [0.066, -0.060, 0.01], [0.024, -0.086, 0.012], [0.000, -0.088, 0.008]], 0.056,
  { holes: [[[0.292, -0.052, 0.005], [0.350, -0.052, 0.006], [0.345, -0.108, 0.008], [0.302, -0.111, 0.008], [0.284, -0.078, 0.008]]], bevel: 0.004 });
  // side panels / seams, nose band and butt pad
  if (fp) {
    for (const s of [-1, 1]) b.side('polymer', [[0.385, -0.030], [0.600, -0.030], [0.612, -0.004, 0.01], [0.600, 0.018, 0.01], [0.420, 0.018, 0.01]], 0.0012, { x: s * 0.0281 });
    b.hole(T, 0.0281, -0.012, 0.430, 0.0006, 0.010, 0.040);
    b.cylX('polymer', 0, -0.030, 0.310, 0.0050, 0.060, { seg: 12 });
  }
  b.side('polymer', [[0.000, 0.027], [-0.010, 0.026, 0.004], [-0.010, -0.086, 0.004], [0.000, -0.088]], 0.054);
  trigger(b, 'polymer', 0.316, -0.050, { width: 0.008, scale: 1.25 });
  const rt = rail(b, 'polymer', 0.150, 0.580, 0.030);
  b.lathe('blued', [[0.0110, 0.600], [0.0110, 0.645], [0, 0.645]], { seg: b.q.segS });
  muzzle(b, att.muzzle, 0.645, 0.0088, { style: 'ar' });
  const bolt = b.group('bolt', -0.028, 0.012, 0.450);
  bolt.rbox('polymer', -0.031, 0.012, 0.450, 0.008, 0.010, 0.016, 0.003);
  stanag(b, 0.100, -0.040, { mat: 'polymer', plateMat: 'polymer' });
  const gp = [0.262, -0.062];
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.029, -0.010, 0.430, [0, Math.PI / 4, 0]);
  const lh = att.grip !== 'none' ? (rail(b, 'polymer', 0.440, 0.560, 0.044, { roll: Math.PI }), foregrip(b, att.grip, 0.500, -0.0535)) : null;
  b.anchor('leftHand', ...(lh || [0, -0.046, 0.520]));
  const sy = rt + 0.036;
  if (att.optic === 'iron') {
    buisRear(b, 'polymer', 0.168, rt, sy, true);
    buisFront(b, 'polymer', 0.568, rt, sy, true);
    ironSight(b, sy, 0.168 - 0.0016);
  } else {
    buisFront(b, 'polymer', 0.568, rt, sy, false);
    optic(b, att.optic, { reddot: 0.215, holo: 0.228, acog: 0.198 }[att.optic], rt);
  }
}

// ------------------------------------------------------------------ P90

function p90(b, att) {
  const fp = b.fp;
  const P = 'polymer';
  b.side(P, [[0.000, 0.012, 0.02], [0.050, 0.026], [0.392, 0.026], [0.430, 0.016, 0.012], [0.448, 0.008, 0.006], [0.448, -0.014, 0.006],
    [0.416, -0.028, 0.012], [0.398, -0.070, 0.015], [0.388, -0.118, 0.01], [0.350, -0.124, 0.01], [0.230, -0.120, 0.008], [0.090, -0.122, 0.01],
    [0.020, -0.110, 0.02], [0.000, -0.080, 0.02]], 0.055,
  { holes: [[[0.290, -0.034, 0.006], [0.372, -0.034, 0.008], [0.366, -0.108, 0.008], [0.300, -0.110, 0.008], [0.284, -0.075, 0.01]],
    [[0.110, -0.040, 0.012], [0.232, -0.040, 0.008], [0.252, -0.105, 0.008], [0.120, -0.106, 0.012]]], bevel: 0.004 });
  trigger(b, P, 0.312, -0.036, { width: 0.008, scale: 1.2 });
  if (fp) {
    b.cylX(P, 0, -0.050, 0.235, 0.0075, 0.058, { seg: 14, tint: 1.3 });
    b.hole(P, 0, -0.1205, 0.175, 0.020, 0.0006, 0.034);
    for (const s of [-1, 1]) b.side(P, [[0.060, -0.030], [0.250, -0.030], [0.260, 0.010, 0.006], [0.060, 0.010, 0.006]], 0.0012, { x: s * 0.0278, tint: 0.75 });
  }
  // front sight housing / TR rail bridge over the magazine
  b.side(P, [[0.300, 0.024], [0.420, 0.024], [0.410, 0.058, 0.006], [0.310, 0.058, 0.004]], 0.030, { bevel: 0.002 });
  b.side(P, [[0.150, 0.050], [0.170, 0.050], [0.170, 0.058], [0.150, 0.058]], 0.030);
  const rt = rail(b, 'anodized', 0.150, 0.418, 0.058);
  b.lathe('blued', [[0.0090, 0.440], [0.0090, 0.452], [0, 0.452]], { seg: b.q.segS });
  muzzle(b, att.muzzle, 0.448, 0.0080, { style: 'ar' });
  // charging handles both sides
  const bolt = b.group('bolt', 0, 0.004, 0.372);
  for (const s of [-1, 1]) bolt.rbox(P, s * 0.0300, 0.004, 0.372, 0.006, 0.008, 0.014, 0.002);
  // top magazine (translucent) with crosswise rounds; origin at its bottom centre, removal along +Y
  const m = b.group('magazine', 0, 0.026, 0.222);
  m.rbox('smoky', 0, 0.039, 0.222, 0.054, 0.026, 0.330, 0.006);
  m.rbox(P, 0, 0.040, 0.050, 0.050, 0.024, 0.016, 0.004);
  if (fp) {
    for (let i = 0; i < 14; i++) m.cylX('brass', 0, 0.036, 0.075 + i * 0.022, 0.0035, 0.044, { seg: 8, tint: 0.85 });
  }
  const gp = [0.272, -0.052];
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0, -0.121, 0.175, [0, 0, -Math.PI / 2]);
  b.anchor('leftHand', 0, -0.060, 0.400);
  const sy = rt + 0.036;
  if (att.optic === 'iron') {
    buisRear(b, 'anodized', 0.165, rt, sy, true);
    buisFront(b, 'anodized', 0.408, rt, sy, true);
    ironSight(b, sy, 0.165 - 0.0016);
  } else {
    optic(b, att.optic, { reddot: 0.230, holo: 0.244 }[att.optic], rt);
  }
}

export const BULLPUP_BUILDERS = { aug, f2000, p90 };
