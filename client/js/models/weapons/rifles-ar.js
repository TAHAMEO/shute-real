// AR-pattern and western battle rifles: M4A1, HK416, SCAR-H, G36C, Mk14 EBR, M110 SASS.
// Gun space: bore on y = 0, f = 0 at the rear face of the upper receiver (see weapon-parts.js).
import {
  rail, buisRear, buisFront, trigger, pin, slingLoop, boxMag, muzzle, foregrip, bipod, optic,
  ironSight, gripOutline, bump, pivotZ, pivotX,
} from './accessories.js';
import { rrect } from '../weapon-parts.js';
import { magOutline } from './accessories.js';

const AR_SIGHT_Y = 0.064; // iron sight line above bore (flat-top AR with BUIS)
const EJECT_ROT = [0, 0.35, 0.25]; // right, slightly forward and up

// ------------------------------------------------------------------ shared AR pieces

/** AR-15 (k = 1) / AR-10 (k ~ 1.12) upper + lower receivers, trigger group and top rail. */
function arReceivers(b, o = {}) {
  const k = o.k || 1;
  const UM = o.upperMat || 'anodized';
  const LM = o.lowerMat || 'anodized';
  const fp = b.fp;
  const L = 0.178 * k;
  const hw = 0.0122 * (o.wk || 1);
  // upper: "tombstone" cross-section extruded front to back
  const sec = [[-hw, -0.0105], [-hw + 0.0037, -0.0145, 0.003], [hw - 0.0037, -0.0145, 0.003], [hw, -0.0105],
    [hw, 0.0186, 0.0012], [hw - 0.0018, 0.0205], [-hw + 0.0018, 0.0205], [-hw, 0.0186, 0.0012]];
  b.section(UM, sec, 0, L, { bevel: 0.0009 });
  rail(b, UM, 0.002, L - 0.002, 0.0205);
  // ejection port with visible bolt carrier, open dust cover, brass deflector, forward assist
  const pf0 = 0.060 * k; const pf1 = 0.122 * k; const pc = (pf0 + pf1) / 2;
  b.hole(UM, hw + 0.0001, 0.0010, pc, 0.0006, 0.0172, pf1 - pf0);
  b.box('steel', hw + 0.0002, 0.0014, pc - 0.004, 0.0006, 0.0115, pf1 - pf0 - 0.016, { tint: 0.5 });
  if (fp) b.box('steel', hw + 0.0003, -0.0035, pf1 - 0.012, 0.0006, 0.0032, 0.010, { tint: 0.75 });
  b.box(UM, hw + 0.0008, -0.0085 + 0.0082, pc, 0.0012, 0.0164, pf1 - pf0 + 0.002, { pre: pivotZ(hw + 0.0008, -0.0085, -1.95) });
  if (fp) b.tube('steel', 0.0011, pf0 - 0.003, pf1 + 0.003, { x: hw + 0.0008, y: -0.0085, seg: 6 });
  b.side(UM, [[0.040 * k, 0.001], [0.058 * k, 0.001], [0.058 * k, 0.0175, 0.002], [0.049 * k, 0.0175, 0.003]], 0.005, { x: hw + 0.0018 });
  b.tube(UM, 0.0086, 0.004 * k, 0.046 * k, { x: hw - 0.0005, y: 0.0062, seg: b.q.segS });
  b.lathe(UM, [[0, -0.003], [0.0058, -0.003], [0.0066, -0.0015], [0.0066, 0.006]], { x: hw - 0.0005, y: 0.0062, seg: b.q.segS });
  if (fp) for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.box(UM, hw - 0.0005 + Math.sin(a) * 0.0066, 0.0062 + Math.cos(a) * 0.0066, 0.0015, 0.0012, 0.0012, 0.006, { rz: -a });
  }
  // lower receiver with the buffer tower at the rear
  const lb = -0.034;
  b.side(LM, [[0.000, 0.0065], [-0.010, 0.0065, 0.004], [-0.013, 0.002, 0.003], [-0.013, -0.020, 0.004], [-0.004, -0.031, 0.004],
    [0.032, lb, 0.002], [0.170 * k, lb], [0.176 * k, -0.024, 0.003], [0.176 * k, -0.0145], [0, -0.0145]], 0.0236);
  const mw0 = 0.100 * k; const mw1 = 0.172 * k;
  const mwb = o.magwellBottom ?? -0.068;
  b.side(LM, [[mw0, -0.016], [mw1, -0.016], [mw1 + 0.001, mwb + 0.010, 0.002], [mw1 + 0.004, mwb, 0.0015], [mw0 - 0.002, mwb, 0.0015], [mw0, mwb + 0.008]], 0.030 * (o.wk || 1));
  // trigger guard + trigger
  b.side(LM, [[0.030, -0.031], [0.101 * k, -0.031], [0.101 * k, -0.040, 0.003], [0.097 * k, -0.0545, 0.004], [0.040, -0.0565, 0.006], [0.028, -0.046, 0.004]], 0.012,
    { holes: [[[0.037, -0.0345], [0.095 * k, -0.0345], [0.093 * k, -0.0515, 0.003], [0.043, -0.0525, 0.004], [0.036, -0.044, 0.003]]] });
  trigger(b, 'metal', 0.064, -0.032);
  if (fp) {
    // mag release with fence (right), bolt catch (left), pins, selector
    b.cylX(LM, 0.0157, -0.0390, 0.094 * k, 0.0045, 0.0018, { seg: 14 });
    b.cylX('steel', 0.0168, -0.0390, 0.094 * k, 0.0036, 0.0018, { seg: 14, tint: 0.6 });
    b.side(LM, [[0.084 * k, -0.031], [0.104 * k, -0.031], [0.104 * k, -0.047, 0.002], [0.084 * k, -0.047, 0.002]], 0.0315, { tint: 0.95 });
    b.rbox(LM, -0.0156, -0.0245, 0.106 * k, 0.0032, 0.011, 0.013, 0.0012);
    for (const s of [-1, 1]) {
      pin(b, 'steel', s * 0.0120, -0.006, -0.007, 0.0024);
      pin(b, 'steel', s * 0.0120, -0.020, 0.168 * k, 0.0024);
      pin(b, 'steel', s * 0.0120, -0.0265, 0.050, 0.0018);
      pin(b, 'steel', s * 0.0120, -0.0265, 0.066, 0.0018);
    }
    b.cylX(LM, -0.0124, -0.0225, 0.026, 0.0052, 0.0016, { seg: 14 });
    b.rbox(LM, -0.0136, -0.0160, 0.026, 0.0018, 0.012, 0.0045, 0.0008);
    b.cylX('steel', 0.0124, -0.0225, 0.026, 0.0032, 0.0016, { seg: 10 });
  }
  return { L, k, magF: (mw0 + mw1) / 2, magTop: -0.016, magwellBottom: mwb };
}

/** AR pistol grip (A2 finger swell when style === 'a2'). Returns the grip point [f, y]. */
function arGrip(b, mat, f, y, style = 'a2') {
  const g = gripOutline(f, y, 25, 0.108,
    (s) => 0.0146 + bump(s, 0.044, 0.010, style === 'a2' ? 0.0034 : 0) - (s > 0.094 ? (s - 0.094) * 0.25 : 0),
    (s) => 0.0150 + bump(s, 0.068, 0.025, 0.0016) + (s < 0.014 ? (0.014 - s) * 0.42 : 0), 14, 0.008);
  b.side(mat, g.pts, 0.0265, { bevel: 0.0024 });
  if (b.fp) {
    // grip screw access hole on the bottom
    const p = g.point(0.1085);
    b.dot(mat, 0, p[1], p[0], 0.0035, 'y', { tint: 0.1 });
  }
  return g.point(0.021);
}

/** Buffer tube, castle nut, end plate with sling loop. */
function bufferTube(b, len = 0.185) {
  b.tube('anodized', 0.0146, -0.013 - len, -0.013, { seg: b.q.seg });
  b.lathe('anodized', [[0.0146, -0.0215], [0.0172, -0.0212], [0.0174, -0.0145], [0.0146, -0.0140]], { seg: b.q.seg });
  b.box('anodized', -0.001, -0.004, -0.0135, 0.031, 0.030, 0.0022);
  if (b.fp) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      b.box('anodized', Math.sin(a) * 0.0172, Math.cos(a) * 0.0172, -0.018, 0.003, 0.0012, 0.008, { rz: -a, tint: 0.2 });
    }
    for (let i = 0; i < 6; i++) b.dot('anodized', 0, -0.0145, -0.105 - i * 0.0125, 0.0018, 'y', { tint: 0.08 });
    slingLoop(b, 'metal', -0.0175, -0.010, -0.0140, 0.0065, { ry: 0, rx: 0 });
  }
}

/** M4 collapsible stock (CTR style) at full extension; butt at fb. mat = furniture material. */
function carStock(b, fb = -0.2625, mat = 'polymer') {
  const f0 = fb + 0.152;
  b.section(mat, rrect(-0.0172, -0.0192, 0.0172, 0.0208, 0.0075), fb + 0.012, f0, { bevel: 0.0018 });
  b.side(mat, [[fb + 0.112, -0.014], [fb + 0.010, -0.014], [fb + 0.010, -0.094, 0.003], [fb + 0.024, -0.0975, 0.005],
    [fb + 0.060, -0.068, 0.02], [fb + 0.112, -0.020, 0.006]], 0.0235, { bevel: 0.0015 });
  b.side(mat, [[fb + 0.031, 0.0205, 0.004], [fb + 0.008, 0.0215, 0.003], [fb + 0.008, -0.0975, 0.003], [fb + 0.026, -0.0975, 0.003],
    [fb + 0.031, -0.090, 0.003]], 0.0355, { bevel: 0.002 });
  b.side('rubber', [[fb + 0.0085, 0.0215], [fb, 0.0205, 0.002], [fb, -0.0975, 0.003], [fb + 0.0085, -0.0995]], 0.038, { bevel: 0.0015 });
  b.rbox(mat, 0, -0.0215, f0 - 0.024, 0.015, 0.009, 0.036, 0.003);
  if (b.fp) {
    b.rbox(mat, 0, -0.0262, f0 - 0.034, 0.008, 0.004, 0.022, 0.0015, { tint: 0.8 });
    for (const s of [-1, 1]) b.hole(mat, s * 0.0118, -0.083, fb + 0.030, 0.0006, 0.007, 0.024, { rx: -0.6 });
    b.hole(mat, 0, -0.0195, fb + 0.060, 0.010, 0.0006, 0.016);
  }
}

/** Quad rail handguard from f0 to f1. o: { mat, top, side, bottom, cap } (rail base distances). */
function quadRail(b, f0, f1, o = {}) {
  const mat = o.mat || 'anodized';
  const t = o.top ?? 0.0205; const sd = o.side ?? 0.0205; const bt = o.bottom ?? 0.0205;
  const c = o.chamfer ?? 0.0100;
  b.section(mat, [[-sd, -bt + c], [-sd + c, -bt], [sd - c, -bt], [sd, -bt + c], [sd, t - c], [sd - c, t], [-sd + c, t], [-sd, t - c]], f0, f1, { bevel: 0.0012 });
  rail(b, mat, f0 + 0.003, f1 - 0.003, t);
  rail(b, mat, f0 + 0.003, f1 - 0.003 - (o.bottomShort || 0), bt, { roll: Math.PI });
  if (o.sides !== false) {
    rail(b, mat, f0 + 0.003 + (o.sideStart || 0), f1 - 0.003, sd, { roll: Math.PI / 2 });
    rail(b, mat, f0 + 0.003 + (o.sideStart || 0), f1 - 0.003, sd, { roll: -Math.PI / 2 });
  }
  if (o.cap !== false) {
    const r = Math.max(t, sd) + 0.0015;
    b.lathe(mat, [[0.0150, f0 - 0.006], [r, f0 - 0.006], [r + 0.0007, f0 - 0.004], [r + 0.0007, f0 + 0.001], [0.0150, f0 + 0.001]], { seg: b.q.seg });
  }
  return { top: t + 0.0095, bottom: -(bt + 0.0095) };
}

/** Standard magazine group for STANAG 30-rd (USGI aluminium or PMAG). */
function stanag(b, magF, magTop, o = {}) {
  const m = b.group('magazine', 0, magTop, magF);
  boxMag(m, o.mat || 'anodized', {
    fc: magF, yTop: magTop, depth: 0.0605, width: 0.0225, straight: o.straight ?? 0.086, arc: o.arc ?? 0.078, radius: 0.185,
    ribs: 'side', ribTop: 0.06, plateMat: o.plateMat || 'polymer', plate: 0.0055, tint: o.tint,
  });
  return m;
}

/** Attach optic / BUIS for a flat-top whose top rail is at railTop, rear BUIS at fr, front at ff. */
function flatTopSights(b, att, o) {
  const { railTop, fr, ff, sightY = AR_SIGHT_Y } = o;
  const iron = att.optic === 'iron';
  if (!(att.optic === 'acog' && o.noRearWithAcog !== false)) buisRear(b, 'anodized', fr, railTop, sightY, iron);
  if (ff !== null && ff !== undefined) buisFront(b, 'anodized', ff, railTop, sightY, iron);
  if (iron) {
    ironSight(b, sightY, fr - 0.0016);
  } else {
    const fm = o.opticF?.[att.optic] ?? { reddot: 0.072, holo: 0.085, acog: 0.054, scope8: 0.150 }[att.optic];
    optic(b, att.optic, fm, railTop, o.opticOpts || {});
  }
}

// ------------------------------------------------------------------ M4A1

function m4a1(b, att) {
  const R = arReceivers(b);
  const gp = arGrip(b, 'polymer', 0.017, -0.026, 'a2');
  bufferTube(b);
  carStock(b, -0.2625);
  quadRail(b, 0.182, 0.345);
  // barrel with M203 step, low profile gas block
  b.lathe('blued', [[0.0098, 0.176], [0.0098, 0.418], [0.0091, 0.4215], [0.0091, 0.515], [0.0079, 0.5165], [0.0079, 0.523], [0, 0.523]], { seg: b.q.segS + 2 });
  b.rbox('metal', 0, 0.0035, 0.356, 0.0225, 0.026, 0.020, 0.003);
  if (b.fp) for (const s of [-1, 1]) b.cylX('steel', s * 0.0114, -0.004, 0.356, 0.0016, 0.001, { seg: 8 });
  muzzle(b, att.muzzle, 0.523, 0.0079, { style: 'ar' });
  flatTopSights(b, att, { railTop: 0.030, fr: 0.016, ff: 0.334 });
  // charging handle (bolt group)
  const bolt = b.group('bolt', 0, 0.0155, -0.006);
  bolt.rbox('anodized', 0, 0.0155, -0.0072, 0.034, 0.0065, 0.0095, 0.002);
  bolt.rbox('anodized', -0.0195, 0.0152, -0.0062, 0.010, 0.0078, 0.0125, 0.002);
  bolt.box('anodized', 0, 0.0155, 0.018, 0.009, 0.0055, 0.046);
  stanag(b, R.magF, R.magTop, { mat: 'anodized', tint: 1.25 });
  if (b.fp) slingLoop(b, 'metal', 0, -0.035, 0.330, 0.007, { ry: Math.PI / 2 });
  // anchors
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.0135, 0.001, 0.090, EJECT_ROT);
  const lh = att.grip !== 'none' ? foregrip(b, att.grip, 0.292, -0.030) : null;
  b.anchor('leftHand', ...(lh ? [lh[0], lh[1], lh[2]] : [0, -0.034, 0.300]));
}

// ------------------------------------------------------------------ HK416

/** HK416 telescoping stock (sloped, deeper body, big pad); butt at fb. */
function hkStock(b, fb) {
  const f0 = fb + 0.160;
  b.section('polymer', rrect(-0.0175, -0.0195, 0.0175, 0.0215, 0.007), fb + 0.012, f0, { bevel: 0.0018 });
  b.side('polymer', [[fb + 0.140, -0.012], [fb + 0.010, -0.012], [fb + 0.010, -0.101, 0.004], [fb + 0.036, -0.1055, 0.006],
    [fb + 0.072, -0.080, 0.008], [fb + 0.098, -0.052, 0.006], [fb + 0.122, -0.030, 0.006], [fb + 0.140, -0.024, 0.004]], 0.030, { bevel: 0.0018 });
  b.side('polymer', [[fb + 0.040, 0.0225, 0.006], [fb + 0.008, 0.0225, 0.003], [fb + 0.008, -0.1045, 0.003], [fb + 0.034, -0.1050, 0.004],
    [fb + 0.040, -0.096, 0.004]], 0.0375, { bevel: 0.002 });
  b.side('rubber', [[fb + 0.0090, 0.0225], [fb, 0.0215, 0.002], [fb, -0.1035, 0.003], [fb + 0.0090, -0.1055]], 0.040, { bevel: 0.0015 });
  b.rbox('polymer', 0, -0.0225, f0 - 0.026, 0.016, 0.010, 0.040, 0.003);
  if (b.fp) {
    for (const s of [-1, 1]) {
      b.rbox('polymer', s * 0.0188, -0.004, fb + 0.026, 0.002, 0.010, 0.018, 0.0012);
    }
  }
}

function hk416(b, att) {
  const R = arReceivers(b);
  const g = gripOutline(0.017, -0.026, 22, 0.110,
    (s) => 0.0150 - bump(s, 0.022, 0.008, 0.0012) + bump(s, 0.060, 0.012, 0.0012) - (s > 0.098 ? (s - 0.098) * 0.2 : 0),
    (s) => 0.0152 + bump(s, 0.066, 0.022, 0.0022) + (s < 0.014 ? (0.014 - s) * 0.45 : 0) + bump(s, 0.104, 0.006, 0.0018), 14, 0.007);
  b.side('polymer', g.pts, 0.0275, { bevel: 0.0024 });
  const gp = g.point(0.021);
  bufferTube(b, 0.200);
  hkStock(b, -0.300);
  const hg = quadRail(b, 0.184, 0.425, { top: 0.0205, side: 0.0228, bottom: 0.0262, chamfer: 0.0112, bottomShort: 0.012 });
  // front end cap of the HK rail system (sloped bottom)
  b.side('anodized', [[0.425, 0.012], [0.433, 0.010, 0.002], [0.433, -0.010, 0.003], [0.420, -0.030, 0.004], [0.409, -0.030]], 0.042, { bevel: 0.0012 });
  b.lathe('blued', [[0.0102, 0.178], [0.0102, 0.523], [0, 0.523]], { seg: b.q.segS + 2 });
  if (b.fp) for (let i = 0; i < 5; i++) for (const s of [-1, 1]) b.hole('anodized', s * 0.0215, -0.015, 0.215 + i * 0.045, 0.0006, 0.004, 0.022);
  muzzle(b, att.muzzle, 0.523, 0.0085, { style: 'ar' });
  const iron = att.optic === 'iron';
  if (att.optic !== 'acog') buisRear(b, 'anodized', 0.018, 0.030, AR_SIGHT_Y, iron, { style: 'drum', aperture: 0.0019 });
  buisFront(b, 'anodized', 0.414, 0.030, AR_SIGHT_Y, iron, { style: 'hood' });
  if (iron) ironSight(b, AR_SIGHT_Y, 0.018 - 0.0016);
  else optic(b, att.optic, { reddot: 0.072, holo: 0.085, acog: 0.054 }[att.optic], 0.030);
  const bolt = b.group('bolt', 0, 0.0155, -0.006);
  bolt.rbox('anodized', 0, 0.0155, -0.0072, 0.036, 0.0065, 0.0095, 0.002);
  bolt.rbox('anodized', -0.0200, 0.0152, -0.0062, 0.011, 0.0078, 0.0125, 0.002);
  bolt.rbox('anodized', 0.0200, 0.0152, -0.0062, 0.011, 0.0078, 0.0125, 0.002);
  bolt.box('anodized', 0, 0.0155, 0.018, 0.009, 0.0055, 0.046);
  stanag(b, R.magF, R.magTop, { mat: 'metal', plateMat: 'metal', tint: 1.15 });
  if (b.fp) slingLoop(b, 'metal', 0.026, -0.012, 0.400, 0.007, { ry: 0 });
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.0135, 0.001, 0.090, EJECT_ROT);
  const lh = att.grip !== 'none' ? foregrip(b, att.grip, 0.315, hg.bottom) : null;
  b.anchor('leftHand', ...(lh || [0, hg.bottom - 0.004, 0.330]));
}

// ------------------------------------------------------------------ SCAR-H (Mk17)

function scarh(b, att) {
  const fp = b.fp;
  const UM = 'tanMetal';
  // monolithic upper with integral handguard
  b.side(UM, [[0.000, -0.016, 0.002], [0.205, -0.016], [0.212, -0.0255, 0.003], [0.450, -0.0255, 0.003], [0.452, 0.020, 0.002], [0.000, 0.0225, 0.002]], 0.038, { bevel: 0.0011 });
  rail(b, UM, 0.002, 0.448, 0.0225);
  rail(b, UM, 0.222, 0.446, 0.0255, { roll: Math.PI });
  rail(b, UM, 0.318, 0.446, 0.019, { roll: Math.PI / 2 });
  rail(b, UM, 0.318, 0.446, 0.019, { roll: -Math.PI / 2 });
  if (fp) {
    // ejection port (right), charging slot (left), vent holes
    b.hole(UM, 0.0192, 0.003, 0.118, 0.0006, 0.015, 0.064);
    b.box('steel', 0.0190, 0.003, 0.114, 0.0006, 0.010, 0.050, { tint: 0.45 });
    b.hole(UM, -0.0192, 0.004, 0.215, 0.0006, 0.0045, 0.180);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.hole(UM, s * 0.0192, -0.010, 0.250 + i * 0.016, 0.0006, 0.0075, 0.009);
    pin(b, 'steel', 0.0192, -0.010, 0.020, 0.0026);
    pin(b, 'steel', -0.0192, -0.010, 0.020, 0.0026);
  }
  // lower receiver (polymer) with magwell
  b.side('tan', [[-0.002, -0.0155], [0.207, -0.0155], [0.207, -0.034, 0.004], [0.199, -0.076, 0.003], [0.128, -0.076, 0.003],
    [0.126, -0.040, 0.003], [0.040, -0.038], [0.012, -0.033, 0.006], [-0.002, -0.026, 0.004]], 0.034, { bevel: 0.0014 });
  b.side('tan', [[0.038, -0.034], [0.128, -0.034], [0.124, -0.0425, 0.003], [0.118, -0.058, 0.006], [0.050, -0.0605, 0.008], [0.036, -0.050, 0.004]], 0.013,
    { holes: [[[0.047, -0.039], [0.116, -0.039], [0.113, -0.0535, 0.004], [0.054, -0.0555, 0.006], [0.045, -0.047, 0.003]]] });
  trigger(b, 'metal', 0.078, -0.035);
  if (fp) {
    b.cylX('tan', -0.0175, -0.026, 0.026, 0.0055, 0.002, { seg: 14 });
    b.rbox('metal', -0.0188, -0.0195, 0.026, 0.0018, 0.012, 0.0045, 0.0008);
    b.cylX('metal', 0.0178, -0.0425, 0.124, 0.0042, 0.003, { seg: 12 });
  }
  const g = gripOutline(0.024, -0.030, 22, 0.106,
    (s) => 0.0148 + bump(s, 0.044, 0.010, 0.003) - (s > 0.094 ? (s - 0.094) * 0.25 : 0),
    (s) => 0.0152 + bump(s, 0.066, 0.024, 0.0018) + (s < 0.014 ? (0.014 - s) * 0.4 : 0), 14, 0.008);
  b.side('tan', g.pts, 0.027, { bevel: 0.0024 });
  const gp = g.point(0.021);
  // folding stock (extended) with skeleton window, cheek riser, pad
  b.rbox('polymer', 0, 0.002, -0.013, 0.036, 0.040, 0.028, 0.004);
  b.side('tan', [[-0.026, 0.0215, 0.003], [-0.250, 0.0275, 0.004], [-0.262, 0.022, 0.003], [-0.262, -0.090, 0.004], [-0.250, -0.098, 0.004],
    [-0.214, -0.094, 0.006], [-0.030, -0.022, 0.008], [-0.026, -0.012, 0.003]], 0.032,
  { holes: [[[-0.070, 0.006, 0.004], [-0.206, 0.0115, 0.006], [-0.206, -0.068, 0.006], [-0.190, -0.071, 0.006]]], bevel: 0.0016 });
  b.side('tan', [[-0.095, 0.020], [-0.232, 0.026], [-0.232, 0.036, 0.004], [-0.105, 0.031, 0.004]], 0.030, { bevel: 0.0016 });
  b.side('rubber', [[-0.262, 0.026], [-0.272, 0.025, 0.002], [-0.272, -0.094, 0.003], [-0.262, -0.098]], 0.036);
  if (fp) for (const s of [-1, 1]) b.rbox('polymer', s * 0.0165, -0.010, -0.060, 0.003, 0.012, 0.018, 0.0012);
  // barrel, gas block with regulator, front sight
  b.lathe('blued', [[0.0108, 0.440], [0.0108, 0.566], [0, 0.566]], { seg: b.q.segS + 2 });
  b.rbox('metal', 0, 0.004, 0.462, 0.026, 0.030, 0.024, 0.003);
  b.cylX('metal', -0.016, -0.004, 0.462, 0.006, 0.010, { seg: 12 });
  muzzle(b, att.muzzle, 0.566, 0.0088, { style: 'scar' });
  const sy = 0.032 + 0.036;
  const iron = att.optic === 'iron';
  if (att.optic !== 'acog') buisRear(b, 'anodized', 0.020, 0.032, sy, iron);
  buisFront(b, 'anodized', 0.438, 0.032, sy, iron);
  if (iron) ironSight(b, sy, 0.020 - 0.0016);
  else optic(b, att.optic, { reddot: 0.078, holo: 0.090, acog: 0.060 }[att.optic], 0.032);
  // reciprocating charging handle on the left
  const bolt = b.group('bolt', -0.019, 0.006, 0.262);
  bolt.rbox('metal', -0.026, 0.008, 0.262, 0.016, 0.006, 0.010, 0.002, { rz: -0.35 });
  bolt.cylX('polymer', -0.037, 0.0115, 0.262, 0.0062, 0.012, { seg: 12, rz: -0.35 });
  // magazine: 20 rd 7.62 steel, nearly straight
  const m = b.group('magazine', 0, -0.018, 0.163);
  boxMag(m, 'metal', { fc: 0.163, yTop: -0.018, depth: 0.066, width: 0.0255, straight: 0.118, arc: 0.028, radius: 0.32, ribs: 'side', ribTop: 0.07, plateMat: 'metal', plate: 0.006, roundR: 0.0058 });
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.020, 0.004, 0.118, EJECT_ROT);
  const lh = att.grip !== 'none' ? foregrip(b, att.grip, 0.360, -0.035) : null;
  b.anchor('leftHand', ...(lh || [0, -0.038, 0.370]));
}

// ------------------------------------------------------------------ G36C

function g36c(b, att) {
  const fp = b.fp;
  const PM = 'polymer';
  // receiver shell with integral magwell
  b.side(PM, [[0.000, 0.021, 0.003], [0.000, -0.023, 0.003], [0.118, -0.025], [0.126, -0.033, 0.003], [0.128, -0.069, 0.003], [0.203, -0.069, 0.003],
    [0.207, -0.034, 0.004], [0.268, -0.029, 0.003], [0.268, 0.021, 0.002]], 0.040, { bevel: 0.0016 });
  // short handguard with vent slots
  b.side(PM, [[0.266, 0.019], [0.348, 0.016, 0.004], [0.356, 0.006, 0.004], [0.356, -0.017, 0.004], [0.344, -0.027, 0.005], [0.266, -0.029]], 0.043, { bevel: 0.0016 });
  if (fp) for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.hole(PM, s * 0.0216, -0.004, 0.284 + i * 0.018, 0.0006, 0.022, 0.0075);
  if (att.grip !== 'none') rail(b, PM, 0.280, 0.342, 0.0275, { roll: Math.PI });
  // carry handle with rail
  b.side(PM, [[0.024, 0.019], [0.226, 0.019], [0.231, 0.050, 0.003], [0.212, 0.0525, 0.002], [0.040, 0.0525, 0.002], [0.019, 0.050, 0.003]], 0.030,
    { holes: [[[0.050, 0.027, 0.004], [0.196, 0.027, 0.004], [0.196, 0.0425, 0.003], [0.050, 0.0425, 0.003]]], bevel: 0.0014 });
  const railTop = rail(b, PM, 0.034, 0.214, 0.0525);
  // fixed irons on the carry handle rail
  const sy = railTop + 0.0105;
  b.rbox(PM, 0, railTop + 0.0035, 0.031, 0.020, 0.007, 0.016, 0.002);
  b.section(PM, ringStemPts(0, sy, 0.0072, 0.0050, railTop + 0.005), 0.026, 0.031, { holes: [circleHole(0, sy, 0.0020, fp ? 14 : 8)] });
  b.rbox(PM, 0, railTop + 0.0035, 0.219, 0.020, 0.007, 0.012, 0.002);
  b.section(PM, frontPostPts(sy, railTop + 0.005), 0.216, 0.2195);
  // ejection port, deflector
  if (fp) {
    b.hole(PM, 0.0201, 0.004, 0.106, 0.0006, 0.016, 0.058);
    b.box('steel', 0.0198, 0.004, 0.102, 0.0006, 0.011, 0.044, { tint: 0.45 });
    b.side(PM, [[0.068, -0.004], [0.078, -0.004], [0.078, 0.016, 0.002], [0.071, 0.016, 0.002]], 0.004, { x: 0.0215 });
    for (const s of [-1, 1]) { pin(b, 'steel', s * 0.0201, -0.012, 0.010, 0.0028); pin(b, 'steel', s * 0.0201, -0.014, 0.112, 0.0028); pin(b, 'steel', s * 0.0201, 0.006, 0.250, 0.0028); }
  }
  // trigger group with integral guard + pistol grip
  b.side(PM, [[0.020, -0.022], [0.120, -0.024], [0.120, -0.036, 0.003], [0.112, -0.058, 0.006], [0.060, -0.060, 0.008], [0.044, -0.050, 0.004], [0.020, -0.036, 0.004]], 0.014,
    { holes: [[[0.058, -0.032], [0.110, -0.032], [0.106, -0.052, 0.004], [0.065, -0.054, 0.005], [0.058, -0.046, 0.003]]], tint: 1.25 });
  trigger(b, 'metal', 0.082, -0.030);
  const g = gripOutline(0.034, -0.028, 18, 0.104,
    (s) => 0.0152 + bump(s, 0.030, 0.006, 0.0012) + bump(s, 0.055, 0.006, 0.0012) + bump(s, 0.078, 0.006, 0.0012) - (s > 0.094 ? (s - 0.094) * 0.3 : 0),
    (s) => 0.0150 + bump(s, 0.064, 0.024, 0.0020) + (s < 0.012 ? (0.012 - s) * 0.4 : 0), 16, 0.008);
  b.side(PM, g.pts, 0.0285, { bevel: 0.0024, tint: 1.25 });
  const gp = g.point(0.021);
  if (fp) b.rbox(PM, -0.0145, -0.017, 0.040, 0.004, 0.010, 0.016, 0.002, { tint: 1.3 });
  // skeleton folding stock (unfolded)
  b.rbox(PM, 0, -0.001, -0.004, 0.034, 0.036, 0.012, 0.004);
  b.side(PM, [[-0.006, 0.019, 0.003], [-0.222, 0.0235, 0.005], [-0.236, 0.016, 0.004], [-0.236, -0.090, 0.004], [-0.222, -0.098, 0.005],
    [-0.196, -0.095, 0.008], [-0.010, -0.026, 0.006]], 0.034,
  { holes: [[[-0.032, 0.003, 0.004], [-0.200, 0.006, 0.006], [-0.212, -0.004, 0.004], [-0.212, -0.064, 0.006], [-0.196, -0.072, 0.008], [-0.060, -0.022, 0.008]]], bevel: 0.0016 });
  b.side('rubber', [[-0.236, 0.017], [-0.244, 0.016, 0.002], [-0.244, -0.093, 0.003], [-0.236, -0.096]], 0.036);
  // barrel + 4 prong flash hider
  b.lathe('blued', [[0.0098, 0.352], [0.0098, 0.392], [0, 0.392]], { seg: b.q.segS });
  b.lathe('metal', [[0.0125, 0.352], [0.0125, 0.361], [0.0105, 0.363]], { seg: b.q.segS });
  muzzle(b, att.muzzle, 0.392, 0.0082, { style: 'prong4' });
  // cocking handle on top (under the carry handle)
  const bolt = b.group('bolt', 0, 0.026, 0.205);
  bolt.rbox(PM, 0, 0.026, 0.205, 0.010, 0.010, 0.012, 0.002);
  bolt.rbox(PM, 0.010, 0.030, 0.208, 0.020, 0.005, 0.010, 0.002, { ry: 0.25 });
  // translucent magazine with visible rounds
  const m = b.group('magazine', 0, -0.018, 0.165);
  const mp = { fc: 0.165, yTop: -0.018, depth: 0.060, width: 0.026, straight: 0.072, arc: 0.088, radius: 0.19, plate: 0.0055 };
  boxMag(m, 'smoky', { ...mp, ribs: 'none', plateMat: 'polymer', rounds: false });
  if (fp) {
    const inner = magOutline({ ...mp, depth: 0.050, yTop: -0.022, straight: 0.068, arc: 0.080 });
    m.side('brass', inner.pts, 0.018, { bevel: 0.0005, tint: 0.85 });
    for (const s of [-1, 1]) m.cylX('polymer', s * 0.0135, -0.050, 0.150, 0.0032, 0.003, { seg: 8 });
  }
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.0215, 0.004, 0.106, EJECT_ROT);
  if (att.optic === 'iron') ironSight(b, sy, 0.0285);
  else optic(b, att.optic, { reddot: 0.098, holo: 0.110 }[att.optic], railTop, { h: att.optic === 'reddot' ? 0.030 : 0.036 });
  const lh = att.grip !== 'none' ? foregrip(b, att.grip, 0.312, -0.037) : null;
  b.anchor('leftHand', ...(lh || [0, -0.033, 0.312]));
}

// ------------------------------------------------------------------ Mk14 EBR

function mk14(b, att) {
  const fp = b.fp;
  const CM = 'anodized';
  // chassis lower with magwell + trigger guard opening
  b.side(CM, [[-0.012, 0.012], [0.258, 0.012], [0.258, -0.036], [0.216, -0.036, 0.002], [0.214, -0.064, 0.003], [0.128, -0.064, 0.003],
    [0.126, -0.038], [0.024, -0.036], [-0.012, -0.026, 0.006]], 0.046, { bevel: 0.0013 });
  b.side(CM, [[0.032, -0.033], [0.122, -0.033], [0.118, -0.044, 0.003], [0.110, -0.058, 0.006], [0.046, -0.060, 0.008], [0.032, -0.050, 0.004]], 0.014,
    { holes: [[[0.042, -0.037], [0.112, -0.037], [0.106, -0.054, 0.004], [0.051, -0.055, 0.006], [0.042, -0.047, 0.003]]] });
  trigger(b, 'metal', 0.076, -0.034);
  // M14 receiver visible inside the chassis, bridge rail mount above
  b.section('metal', rrect(-0.0145, 0.010, 0.0145, 0.025, 0.004), 0.004, 0.236);
  b.box('steel', 0.004, 0.0255, 0.070, 0.016, 0.004, 0.090, { tint: 0.55 });
  b.side(CM, [[-0.004, 0.012], [0.026, 0.012], [0.030, 0.034], [-0.004, 0.034]], 0.046);
  b.side(CM, [[0.214, 0.012], [0.258, 0.012], [0.258, 0.034], [0.210, 0.034]], 0.046);
  b.side(CM, [[0.024, 0.029], [0.214, 0.029], [0.214, 0.034], [0.024, 0.034]], 0.036);
  const railTop = rail(b, CM, -0.002, 0.520, 0.034);
  // forend with rails
  b.section(CM, [[-0.024, -0.020], [-0.018, -0.028], [0.018, -0.028], [0.024, -0.020], [0.024, 0.034], [-0.024, 0.034]], 0.258, 0.522, { bevel: 0.0012 });
  rail(b, CM, 0.300, 0.518, 0.028, { roll: Math.PI });
  rail(b, CM, 0.330, 0.518, 0.024, { roll: Math.PI / 2, x: 0 });
  rail(b, CM, 0.330, 0.518, 0.024, { roll: -Math.PI / 2 });
  if (fp) for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.hole(CM, s * 0.0242, -0.016, 0.278 + i * 0.012, 0.0006, 0.008, 0.007);
  // barrel, gas cylinder + front band
  b.lathe('blued', [[0.0112, 0.258], [0.0112, 0.540], [0.0098, 0.548], [0.0098, 0.596], [0, 0.596]], { seg: b.q.segS + 2 });
  b.tube('metal', 0.0085, 0.520, 0.566, { y: -0.020, seg: b.q.segS });
  b.rbox('metal', 0, -0.009, 0.548, 0.020, 0.036, 0.018, 0.003);
  muzzle(b, att.muzzle, 0.596, 0.0090, { style: 'prong4' });
  // pistol grip
  const g = gripOutline(0.020, -0.030, 22, 0.108,
    (s) => 0.0148 + bump(s, 0.044, 0.010, 0.0032) - (s > 0.094 ? (s - 0.094) * 0.25 : 0),
    (s) => 0.0150 + bump(s, 0.068, 0.025, 0.0016) + (s < 0.014 ? (0.014 - s) * 0.42 : 0), 14, 0.008);
  b.side('polymer', g.pts, 0.0265, { bevel: 0.0024 });
  const gp = g.point(0.021);
  // telescoping Sage-style stock with tall cheek riser
  b.tube(CM, 0.0158, -0.200, -0.010, { y: 0.004, seg: b.q.segS + 2 });
  const fb = -0.282;
  b.section('polymer', rrect(-0.019, -0.016, 0.019, 0.026, 0.008), fb + 0.012, fb + 0.165, { bevel: 0.0018 });
  b.side('polymer', [[fb + 0.040, 0.026], [fb + 0.140, 0.026], [fb + 0.132, 0.046, 0.006], [fb + 0.040, 0.046, 0.006]], 0.034, { bevel: 0.002 });
  b.side('polymer', [[fb + 0.125, -0.010], [fb + 0.010, -0.010], [fb + 0.010, -0.092, 0.004], [fb + 0.030, -0.096, 0.006], [fb + 0.070, -0.060, 0.02], [fb + 0.125, -0.020, 0.006]], 0.026, { bevel: 0.0016 });
  b.side('polymer', [[fb + 0.030, 0.046, 0.006], [fb + 0.008, 0.046, 0.003], [fb + 0.008, -0.095, 0.003], [fb + 0.026, -0.096, 0.003], [fb + 0.030, -0.088]], 0.038, { bevel: 0.002 });
  b.side('rubber', [[fb + 0.008, 0.046], [fb, 0.045, 0.002], [fb, -0.094, 0.003], [fb + 0.008, -0.096]], 0.040);
  if (fp) for (const s of [-1, 1]) b.cylX(CM, s * 0.020, 0.036, fb + 0.090, 0.0045, 0.004, { seg: 10 });
  // op-rod handle (bolt) on the right
  const bolt = b.group('bolt', 0.024, 0.016, 0.205);
  bolt.rbox('metal', 0.030, 0.016, 0.205, 0.014, 0.008, 0.012, 0.002);
  bolt.cylX('metal', 0.038, 0.017, 0.207, 0.0058, 0.006, { seg: 12 });
  if (fp) b.hole(CM, 0.0232, 0.016, 0.170, 0.0006, 0.010, 0.080);
  // magazine: M14 20 rd
  const m = b.group('magazine', 0, -0.016, 0.171);
  boxMag(m, 'metal', { fc: 0.171, yTop: -0.016, depth: 0.078, width: 0.0255, straight: 0.098, arc: 0.042, radius: 0.36, ribs: 'side', ribTop: 0.058, plateMat: 'metal', plate: 0.006, roundR: 0.0058 });
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.016, 0.026, 0.080, [0, 0.3, 0.6]);
  optic(b, att.optic, { reddot: 0.080, holo: 0.090, acog: 0.050, scope8: 0.160 }[att.optic], railTop, { h: att.optic === 'scope8' ? 0.031 : undefined });
  const lh = att.grip !== 'none' ? foregrip(b, att.grip, 0.400, -0.0375) : null;
  b.anchor('leftHand', ...(lh || [0, -0.040, 0.420]));
}

// ------------------------------------------------------------------ M110 SASS

/** PRS-style precision stock (fixed, adjustable comb); butt at fb. */
function prsStock(b, mat, fb) {
  b.tube(mat, 0.0165, -0.075, -0.012, { seg: b.q.segS + 2 });
  b.side(mat, [[-0.070, 0.019, 0.004], [fb + 0.020, 0.0215, 0.004], [fb + 0.010, 0.010, 0.003], [fb + 0.010, -0.096, 0.004], [fb + 0.030, -0.101, 0.005],
    [fb + 0.080, -0.080, 0.006], [fb + 0.150, -0.046, 0.01], [-0.070, -0.024, 0.006]], 0.034, { bevel: 0.0018, holes: [[[fb + 0.050, -0.010, 0.006], [fb + 0.130, -0.010, 0.006], [fb + 0.050, -0.062, 0.006]]] });
  b.side(mat, [[-0.110, 0.022], [fb + 0.040, 0.024], [fb + 0.040, 0.040, 0.005], [-0.118, 0.038, 0.006]], 0.032, { bevel: 0.0018 });
  b.side('rubber', [[fb + 0.010, 0.023], [fb, 0.022, 0.002], [fb, -0.098, 0.003], [fb + 0.010, -0.101]], 0.040);
  if (b.fp) {
    b.cylX('metal', -0.020, 0.030, -0.140, 0.0065, 0.008, { seg: 14 });
    b.cylX('metal', -0.020, -0.030, -0.110, 0.0070, 0.008, { seg: 14 });
    b.tube('steel', 0.0035, -0.112, -0.070, { y: 0.030, seg: 8 });
  }
}

function m110(b, att) {
  const k = 1.12;
  const R = arReceivers(b, { k, upperMat: 'tanMetal', lowerMat: 'tanMetal', magwellBottom: -0.072 });
  const gp = arGrip(b, 'tan', 0.017, -0.026, 'a2');
  prsStock(b, 'tan', -0.272);
  const hg = quadRail(b, 0.206, 0.540, { mat: 'tanMetal', top: 0.0205, side: 0.0215, bottom: 0.0225, chamfer: 0.012, sideStart: 0.16 });
  b.lathe('blued', [[0.0115, 0.200], [0.0115, 0.683], [0, 0.683]], { seg: b.q.segS + 2 });
  if (b.fp) for (let i = 0; i < 6; i++) for (const s of [-1, 1]) b.hole('tanMetal', s * 0.0212, 0.002, 0.230 + i * 0.026, 0.0006, 0.010, 0.016);
  muzzle(b, att.muzzle, 0.683, 0.0092, { style: 'ar', r: 0.020, len: 0.180 });
  bipod(b, 'metal', 0.470, hg.bottom, 0.185);
  const bolt = b.group('bolt', 0, 0.0155, -0.006);
  bolt.rbox('anodized', 0, 0.0155, -0.0072, 0.036, 0.0065, 0.0095, 0.002);
  bolt.rbox('anodized', -0.0205, 0.0152, -0.0062, 0.012, 0.008, 0.0125, 0.002);
  bolt.box('anodized', 0, 0.0155, 0.018, 0.009, 0.0055, 0.046);
  const m = b.group('magazine', 0, R.magTop, R.magF);
  boxMag(m, 'metal', { fc: R.magF, yTop: R.magTop, depth: 0.070, width: 0.0258, straight: 0.080, arc: 0.036, radius: 0.30, ribs: 'side', ribTop: 0.062, plateMat: 'metal', plate: 0.006, roundR: 0.0058 });
  b.setOrigin(0, gp[1], gp[0]);
  b.anchor('rightHand', 0, gp[1], gp[0]);
  b.anchor('eject', 0.0135, 0.001, 0.100, EJECT_ROT);
  optic(b, att.optic, { reddot: 0.072, acog: 0.054, scope8: 0.205 }[att.optic], 0.030, { mat: 'blued' });
  const lh = att.grip !== 'none' ? foregrip(b, att.grip, 0.360, hg.bottom) : null;
  b.anchor('leftHand', ...(lh || [0, hg.bottom - 0.004, 0.380]));
}

/** Ring-on-stem outline (re-export of the accessory helper shape for fixed sights). */
function ringStemPts(cx, cy, ro, sw, y0) {
  const phi = Math.acos(Math.min(0.999, sw / ro));
  const yj = cy - Math.sqrt(Math.max(0, ro * ro - sw * sw));
  const pts = [[cx - sw, y0], [cx + sw, y0], [cx + sw, yj]];
  for (let i = 1; i < 16; i++) {
    const a = -phi + (i / 16) * (Math.PI + 2 * phi);
    pts.push([cx + Math.cos(a) * ro, cy + Math.sin(a) * ro]);
  }
  pts.push([cx - sw, yj]);
  return pts;
}
function circleHole(cx, cy, r, n) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return pts;
}
/** Fixed front post with protective ears; post tip at sy. */
function frontPostPts(sy, y0, o = {}) {
  const pw = o.pw ?? 0.0008; const ear = sy + (o.ear ?? 0.005); const win = sy - (o.win ?? 0.006);
  const hw = o.hw ?? 0.0075; const iw = o.iw ?? 0.0052;
  return [[-hw, y0], [hw, y0], [hw, ear, 0.0015], [iw, ear, 0.001], [iw, win, 0.0012], [pw, win, 0.0006],
    [pw, sy - 0.0005], [pw * 0.6, sy], [-pw * 0.6, sy], [-pw, sy - 0.0005], [-pw, win, 0.0006], [-iw, win, 0.0012],
    [-iw, ear, 0.001], [-hw, ear, 0.0015]];
}

export const AR_BUILDERS = { m4a1, hk416, scarh, g36c, mk14, m110 };
export { arReceivers, arGrip, bufferTube, carStock, quadRail, stanag, flatTopSights, ringStemPts, circleHole, frontPostPts, AR_SIGHT_Y, EJECT_ROT };
