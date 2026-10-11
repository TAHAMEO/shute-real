// Dev preview for procedural weapon models.
// Params: ?w=m4a1&optic=acog&muzzle=suppressor&grip=vertical&lod=fp|tp
//         &view=grid|side|left|threequarter|top|ads|fp&anchors=1&ids=a,b,c (grid subset)&cols=4
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WEAPON_LIST } from '/shared/weapons.js';
import { buildWeaponModel, buildEquipmentModel, preloadWeaponAssets, listWeaponModels } from '/js/models/weapon-models.js';

const P = new URLSearchParams(location.search);
const view = P.get('view') || 'grid';
const lod = P.get('lod') === 'tp' ? 'tp' : 'fp';
const showAnchors = P.get('anchors') === '1';
const EQUIP = ['frag', 'smoke', 'knife'];

const W = innerWidth;
const H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(P.get('exp') || 1.0);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(P.get('bg') ? `#${P.get('bg')}` : '#7b8188');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.9;
const sun = new THREE.DirectionalLight(0xfff2e2, 3.0);
sun.position.set(2.5, 4, 3);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xe0e8ff, 0x3a3630, 0.35));

const labels = document.getElementById('labels');
const hud = document.getElementById('hud');

function make(id, att = {}) {
  return EQUIP.includes(id) ? buildEquipmentModel(id, { lod }) : buildWeaponModel(id, att, { lod });
}

function drawCalls(model) {
  let n = 0;
  model.root.traverse((o) => { if (o.isMesh) n++; });
  return n;
}

function addAnchorHelpers(model) {
  for (const [k, a] of Object.entries(model.anchors)) {
    if (!a || k === 'lens' || k === 'reticle') continue;
    const ax = new THREE.AxesHelper(k === 'sight' ? 0.05 : 0.03);
    ax.material.depthTest = false;
    ax.renderOrder = 99;
    a.add(ax);
  }
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false }));
  s.renderOrder = 99;
  model.root.add(s);
}

function bounds(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  obj.traverse((o) => {
    if (o.isMesh && o.name !== 'reticle') {
      o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    }
  });
  return box;
}

/** Place cam to frame box from direction dir (unit, from target to camera). */
function frame(cam, box, dir, fill = 0.92) {
  const c = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  // project box extents on camera axes for a tight fit
  const fwd = dir.clone().negate();
  const up0 = Math.abs(fwd.y) > 0.95 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(fwd, up0).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  let hw = 0; let hh = 0;
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
    hw = Math.max(hw, Math.abs(p.dot(right)));
    hh = Math.max(hh, Math.abs(p.dot(up)));
  }
  const t = Math.tan((cam.fov * Math.PI) / 360);
  const dist = Math.max(hh / t, hw / (t * cam.aspect)) / fill + sphere.radius * 0.3;
  cam.position.copy(c).addScaledVector(dir, dist);
  cam.up.copy(up0);
  cam.lookAt(c);
  cam.near = Math.max(0.005, dist - sphere.radius * 2);
  cam.far = dist + sphere.radius * 3;
  cam.updateProjectionMatrix();
}

const VIEW_DIRS = {
  side: new THREE.Vector3(1, 0.08, 0).normalize(),
  left: new THREE.Vector3(-1, 0.08, 0).normalize(),
  threequarter: new THREE.Vector3(-0.75, 0.45, 0.6).normalize(),
  top: new THREE.Vector3(0, 1, 0.0001).normalize(),
  front: new THREE.Vector3(0.25, 0.15, -1).normalize(),
};

function finish(info) {
  hud.textContent = info;
  requestAnimationFrame(() => { window.__READY = true; });
}

function runGrid() {
  const ids = P.get('ids') ? P.get('ids').split(',') : [...WEAPON_LIST.map((w) => w.id), ...EQUIP];
  const cols = Number(P.get('cols') || 4);
  const rows = Math.ceil(ids.length / cols);
  const cw = Math.floor(W / cols);
  const ch = Math.floor(H / rows);
  const cam = new THREE.PerspectiveCamera(16, cw / ch, 0.01, 50);
  const dir = (VIEW_DIRS[P.get('dir') || 'side'] || VIEW_DIRS.side).clone();
  renderer.setScissorTest(true);
  const stats = [];
  const models = ids.map((id) => {
    const t0 = performance.now();
    const m = make(id);
    const ms = performance.now() - t0;
    m.root.visible = false;
    scene.add(m.root);
    if (showAnchors) addAnchorHelpers(m);
    stats.push({ id, tris: m.info.triangles, calls: drawCalls(m), len: m.info.length, ms: Math.round(ms) });
    return m;
  });
  models.forEach((m, i) => {
    const cx = (i % cols) * cw;
    const cy = Math.floor(i / cols) * ch;
    m.root.visible = true;
    frame(cam, bounds(m.root), dir, 0.9);
    renderer.setViewport(cx, H - cy - ch, cw, ch);
    renderer.setScissor(cx, H - cy - ch, cw, ch);
    renderer.render(scene, cam);
    m.root.visible = false;
    const d = document.createElement('div');
    d.className = 'lbl';
    d.style.left = `${cx + 6}px`;
    d.style.top = `${cy + 4}px`;
    const s = stats[i];
    d.innerHTML = `${ids[i]} <small>${s.tris} tri · ${s.calls} dc · ${s.len.toFixed(3)} m</small>`;
    labels.appendChild(d);
  });
  console.log('STATS ' + JSON.stringify(stats));
  finish(`${lod} grid, ${ids.length} models`);
}

function runSingle() {
  const id = P.get('w') || 'm4a1';
  const att = { optic: P.get('optic') || undefined, muzzle: P.get('muzzle') || undefined, grip: P.get('grip') || undefined };
  const t0 = performance.now();
  const m = make(id, att);
  const ms = performance.now() - t0;
  scene.add(m.root);
  if (showAnchors) addAnchorHelpers(m);
  const info = m.info;
  const line = `${id} ${JSON.stringify({ optic: info.optic, muzzle: info.muzzle, grip: info.grip })} tris=${info.triangles} calls=${drawCalls(m)} len=${info.length} sightH=${info.sightHeight} lensR=${info.lensRadius} build=${ms.toFixed(0)}ms`;
  console.log(line);
  const cam = new THREE.PerspectiveCamera(Number(P.get('fov') || 22), W / H, 0.002, 50);
  if (view === 'ads') {
    const s = m.anchors.sight;
    m.root.updateMatrixWorld(true);
    s.getWorldPosition(cam.position);
    s.getWorldQuaternion(cam.quaternion);
    cam.fov = Number(P.get('fov') || 40);
    cam.near = 0.002;
    cam.updateProjectionMatrix();
    document.getElementById('xh').style.display = 'block';
    scene.background = new THREE.Color('#a9b4bf');
    // distant target board to judge alignment
    const tgt = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.2, 48), new THREE.MeshBasicMaterial({ color: 0x202020 }));
    tgt.position.copy(cam.position).add(new THREE.Vector3(0, 0, -25).applyQuaternion(cam.quaternion));
    tgt.quaternion.copy(cam.quaternion);
    scene.add(tgt);
  } else if (view === 'fp') {
    // rough first-person placement: grip 22 cm right, 20 cm down, 30 cm ahead of the eye
    cam.fov = Number(P.get('fov') || 70);
    cam.updateProjectionMatrix();
    cam.position.set(-0.115, 0.15, 0.20);
    cam.lookAt(-0.115, 0.11, -1);
  } else {
    frame(cam, bounds(m.root), (VIEW_DIRS[view] || VIEW_DIRS.side).clone(), 0.94);
  }
  renderer.render(scene, cam);
  finish(line);
}

preloadWeaponAssets();
console.log('models:', listWeaponModels().length);
if (view === 'grid') runGrid(); else runSingle();
