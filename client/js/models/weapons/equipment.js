// Equipment: M67 fragmentation grenade, M18 smoke grenade, combat knife (KA-BAR style).
// Origin = right-hand hold point. Grenades: fuze up (+Y). Knife: blade forward (-Z), edge down (-Y).
// Extra named nodes for optional animation: 'pin' (grenades), 'spoon' (grenades), 'anchor:tip' (knife).
import * as THREE from 'three';
import { extrudeSide, creaseNormals, prep } from '../weapon-parts.js';

/** Fuze head with spoon (lever) and pull ring; returns the ring centre [x, y, f]. */
function fuze(b, top, bodyR, o = {}) {
  const fp = b.fp;
  b.tube('metal', 0.0098, 0, 0.016, { pre: new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0, top, 0)), seg: b.q.segS });
  b.lathe('metal', [[0, top + 0.016], [0.0080, top + 0.016], [0.0060, top + 0.020], [0, top + 0.020]].map((p) => [p[0], p[1]]), {
    pre: new THREE.Matrix4().makeRotationX(Math.PI / 2), seg: b.q.segS,
  });
  // spoon: strip from the fuze top curving down the back (+Z) side of the body
  const spoon = b.group('spoon', 0, top + 0.012, -0.004);
  const segs = fp ? 9 : 4;
  const R = bodyR + 0.003;
  const a0 = o.spoonStart ?? 0.25; const a1 = o.spoonEnd ?? 1.75;
  for (let i = 0; i < segs; i++) {
    const t0 = a0 + ((a1 - a0) * i) / segs; const t1 = a0 + ((a1 - a0) * (i + 1)) / segs;
    const tm = (t0 + t1) / 2;
    const len = R * (t1 - t0) + 0.0006;
    const yc = o.spoonCY ?? 0;
    if (len > 0.001) spoon.box('metal', 0, yc + Math.cos(tm) * R, -Math.sin(tm) * R, 0.014, 0.0012, len, { rx: tm, tint: 1.35 });
  }
  spoon.box('metal', 0, top + 0.020, -0.006, 0.014, 0.0012, 0.014, { tint: 1.35 });
  // pin through the fuze + pull ring on the left
  const pin = b.group('pin', -0.012, top + 0.009, 0);
  pin.cylX('steel', -0.004, top + 0.009, 0, 0.0009, 0.026, { seg: 6 });
  const ring = [-0.024, top + 0.004, 0.0];
  pin.torus('steel', ring[0], ring[1], ring[2], 0.0105, 0.0013, { rx: 0, ry: 0, ts: fp ? 20 : 8, rs: fp ? 6 : 3 });
  return ring;
}

// ------------------------------------------------------------------ M67 frag

function frag(b) {
  const fp = b.fp;
  const R = 0.032;
  b.sphere('od', 0, 0, 0, R, { ws: fp ? 30 : 10, hs: fp ? 20 : 7 });
  b.lathe('metal', [[0.0060, R - 0.003], [0.0105, R - 0.006], [0.0105, R + 0.001], [0.0060, R + 0.001]], { pre: new THREE.Matrix4().makeRotationX(Math.PI / 2), seg: b.q.segS });
  if (fp) {
    const y = 0.010; const r = Math.sqrt(R * R - y * y) + 0.0002;
    b.lathe('paint', [[r, y - 0.0035], [r + 0.0002, y - 0.0035], [r + 0.0002, y + 0.0035], [r, y + 0.0035]], { pre: new THREE.Matrix4().makeRotationX(Math.PI / 2), seg: 32, tint: [0.85, 0.7, 0.1] });
  }
  const ring = fuze(b, R - 0.002, R, { spoonStart: 0.35, spoonEnd: 1.9 });
  b.setOrigin(0, 0, 0);
  b.anchor('rightHand', 0, 0, 0);
  b.anchor('leftHand', ring[0], ring[1], ring[2]);
}

// ------------------------------------------------------------------ M18 smoke

function smoke(b) {
  const fp = b.fp;
  const R = 0.031; const H = 0.114;
  const body = prep(new THREE.CylinderGeometry(R, R, H, fp ? 36 : 10, 1, true), b.q, { keepUV: true, creaseAngle: 1.2 });
  b.geo('label', body, null, { keepUV: true });
  b.lathe('od', [[0, H / 2 - 0.002], [R + 0.0012, H / 2 - 0.002], [R + 0.0012, H / 2 + 0.004], [R - 0.004, H / 2 + 0.006], [0, H / 2 + 0.006]].map((p) => [p[0], p[1]]), { pre: new THREE.Matrix4().makeRotationX(Math.PI / 2), seg: b.q.segS + 6 });
  b.lathe('od', [[0, -H / 2 - 0.004], [R - 0.003, -H / 2 - 0.004], [R + 0.0012, -H / 2 - 0.001], [R + 0.0012, -H / 2 + 0.004], [0, -H / 2 + 0.004]], { pre: new THREE.Matrix4().makeRotationX(Math.PI / 2), seg: b.q.segS + 6 });
  if (fp) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      b.cylY('od', Math.cos(a) * 0.019, H / 2 + 0.0062, Math.sin(a) * 0.019, 0.0038, 0.0006, { seg: 10, tint: 0.05 });
    }
    b.lathe('paint', [[R + 0.0001, H / 2 - 0.012], [R + 0.0003, H / 2 - 0.012], [R + 0.0003, H / 2 - 0.004], [R + 0.0001, H / 2 - 0.004]], { pre: new THREE.Matrix4().makeRotationX(Math.PI / 2), seg: 36, tint: [0.3, 0.75, 0.25] });
  }
  const ring = fuze(b, H / 2 + 0.004, R, { spoonStart: 0.0, spoonEnd: 0.0, spoonCY: 0 });
  // long straight spoon down the side
  const sp = b.root.children.find((c) => c.name === 'spoon');
  sp.box('metal', 0, H / 2 - 0.022, -(R + 0.0025), 0.014, 0.050, 0.0012, { tint: 1.35 });
  sp.box('metal', 0, H / 2 + 0.006, -(R - 0.004), 0.014, 0.0012, 0.014, { tint: 1.35, rx: 0.2 });
  b.setOrigin(0, 0, 0);
  b.anchor('rightHand', 0, 0, 0);
  b.anchor('leftHand', ring[0], ring[1], ring[2]);
}

// ------------------------------------------------------------------ combat knife

function knife(b) {
  const fp = b.fp;
  // blade: clip point, ground thin toward the edge
  const g = extrudeSide([[0.060, 0.008], [0.185, 0.008, 0.003], [0.240, -0.002, 0.001], [0.214, -0.013, 0.02], [0.150, -0.0215, 0.03], [0.075, -0.022, 0.004], [0.060, -0.018, 0.003]], 0.0056, b.q, { bevel: 0.0004 });
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i); const z = -p.getZ(i);
    const spine = z > 0.185 ? 0.008 - (z - 0.185) * 0.18 : 0.008;
    const t = Math.min(1, Math.max(0, (spine - y) / 0.026));
    p.setX(i, p.getX(i) * (1 - 0.85 * Math.pow(t, 1.6)));
  }
  creaseNormals(g, 0.5);
  b.geo('steel', g, null, { tint: 0.62 });
  if (fp) for (const s of [-1, 1]) b.box('steel', s * 0.0021, 0.0005, 0.118, 0.0006, 0.0035, 0.085, { tint: 0.3 });
  // guard, handle (stacked leather washers), pommel
  b.section('steel', [[-0.0058, -0.027, 0.004], [0.0058, -0.027, 0.004], [0.0058, 0.017, 0.004], [-0.0058, 0.017, 0.004]], 0.054, 0.060, { tint: 0.5 });
  const pts = [];
  const n = fp ? 14 : 4;
  pts.push([0.0128, -0.056]);
  for (let i = 0; i <= n; i++) {
    const f = -0.054 + (i / n) * 0.108;
    const r = 0.0150 - 0.0016 * Math.cos(((f + 0.054) / 0.108) * Math.PI * 2) * 0.6;
    pts.push([r, f]);
    if (fp && i < n) pts.push([r - 0.0007, f + 0.108 / n / 2]);
  }
  pts.push([0.0128, 0.0545]);
  b.lathe('wood', pts, { pre: new THREE.Matrix4().makeScale(0.72, 1, 1), y: -0.004, seg: b.q.segS + 2, tint: [0.42, 0.32, 0.26] });
  b.lathe('steel', [[0, -0.068], [0.0100, -0.066], [0.0132, -0.060], [0.0132, -0.055], [0.0100, -0.054]], { pre: new THREE.Matrix4().makeScale(0.72, 1, 1), y: -0.004, seg: b.q.segS, tint: 0.5 });
  b.setOrigin(0, 0, 0);
  b.anchor('rightHand', 0, 0, 0);
  b.anchor('tip', 0, -0.002, 0.240);
}

export const EQUIPMENT_BUILDERS = { frag, smoke, knife };
