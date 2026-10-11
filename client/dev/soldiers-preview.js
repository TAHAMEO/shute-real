// Dev preview for the procedural soldier + first-person arms.
// ?anim=idle|walk|run|sprint|strafe|back|crouch|crouchwalk|prone|crawl|jump|ads|reload|lean|death
// &team=0|1|-1 &t=SECONDS &cam=front|side|threequarter|back|close|top &lod=low &real=1 &pitch=0.3
// &vars=0,1,2 &fp=1 [&ads=1 &reload=1] &live=1 (keep animating) &move=1 (really move, camera follows)
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { SoldierModel, createFirstPersonArms, soldierStats } from '../js/models/soldier.js';

const q = new URLSearchParams(location.search);
const anim = q.get('anim') || 'idle';
const T = Number(q.get('t') ?? 1.2);
const camMode = q.get('cam') || 'threequarter';
const lod = q.get('lod') === 'low' ? 'low' : 'high';
const fp = q.get('fp') === '1';
const live = q.get('live') === '1';
const hud = document.getElementById('hud');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sky = new Sky();
sky.scale.setScalar(4000);
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(fp ? 150 : 35));
sky.material.uniforms.sunPosition.value.copy(sunDir);
sky.material.uniforms.turbidity.value = 3;
sky.material.uniforms.rayleigh.value = 1.2;
scene.add(sky);
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const sky2 = new Sky(); sky2.scale.setScalar(4000);
sky2.material.uniforms.sunPosition.value.copy(sunDir);
sky2.material.uniforms.showSunDisc.value = 0;
envScene.add(sky2);
scene.environment = pmrem.fromScene(envScene, 0.02).texture;
scene.environmentIntensity = 0.3;

const sun = new THREE.DirectionalLight(0xfff1dc, 2.8);
sun.position.copy(sunDir).multiplyScalar(30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 80 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbfd4ee, 0x5a5040, 0.35));

// ground with a little procedural texture
const gc = document.createElement('canvas'); gc.width = gc.height = 256;
const g2 = gc.getContext('2d');
g2.fillStyle = '#6b6a4a'; g2.fillRect(0, 0, 256, 256);
for (let i = 0; i < 5000; i++) {
  const v = Math.random();
  g2.fillStyle = v < 0.5 ? 'rgba(80,90,50,0.5)' : v < 0.8 ? 'rgba(120,110,80,0.5)' : 'rgba(60,55,40,0.6)';
  g2.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 3);
}
const gt = new THREE.CanvasTexture(gc); gt.colorSpace = THREE.SRGBColorSpace; gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(30, 30);
gt.anisotropy = 8;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ map: gt, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

/** Placeholder rifle: origin at the pistol grip, bore along −Z, anchors like weapon-models.js. */
function makePlaceholderRifle() {
  const root = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2c2d, roughness: 0.42, metalness: 0.6 });
  const poly = new THREE.MeshStandardMaterial({ color: 0x1d1d1c, roughness: 0.7, metalness: 0.05 });
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; root.add(m); return m; };
  const by = 0.045;
  add(new THREE.BoxGeometry(0.034, 0.06, 0.24), metal, 0, by - 0.006, -0.03);
  add(new THREE.BoxGeometry(0.024, 0.016, 0.26), metal, 0, by + 0.031, -0.04);
  add(new THREE.BoxGeometry(0.03, 0.045, 0.17), poly, 0, by - 0.008, 0.175);
  add(new THREE.BoxGeometry(0.036, 0.12, 0.03), poly, 0, by - 0.022, 0.255);
  add(new THREE.BoxGeometry(0.028, 0.105, 0.036), poly, 0, -0.03, 0.012, 0.35);
  add(new THREE.CylinderGeometry(0.024, 0.024, 0.26, 12), poly, 0, by, -0.28, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.009, 0.009, 0.2, 8), metal, 0, by, -0.5, Math.PI / 2);
  add(new THREE.BoxGeometry(0.024, 0.15, 0.07), poly, 0, -0.06, -0.085, -0.2);
  for (const [x, y, w, h] of [[0, 0.123, 0.03, 0.006], [0, 0.103, 0.03, 0.006], [0.0125, 0.113, 0.005, 0.02], [-0.0125, 0.113, 0.005, 0.02]]) add(new THREE.BoxGeometry(w, h, 0.006), metal, x, y, 0.035);
  add(new THREE.BoxGeometry(0.003, 0.03, 0.004), metal, 0, by + 0.05, -0.38);
  const anchors = {};
  for (const [n, p] of Object.entries({ rightHand: [0, 0, 0], leftHand: [0, 0.03, -0.28], sight: [0, 0.113, 0.035], muzzle: [0, by, -0.6], eject: [0.02, by, -0.05], magazine: [0, -0.03, -0.085], stock: [0, by - 0.012, 0.27] })) {
    const o = new THREE.Object3D(); o.name = `anchor:${n}`; o.position.fromArray(p); root.add(o); anchors[n] = o;
  }
  return { root, anchors };
}

let realMod = null;
if (q.get('real') === '1') {
  try { realMod = await import('/js/models/weapon-models.js'); } catch (e) { console.warn('weapon-models.js unavailable:', e.message); }
}
function makeWeapon(lodW) {
  if (realMod) {
    try { return realMod.buildWeaponModel(q.get('weapon') || 'm4a1', {}, { lod: lodW }); } catch (e) { console.warn('buildWeaponModel failed:', e.message); }
  }
  return makePlaceholderRifle();
}

const camera = new THREE.PerspectiveCamera(fp ? 70 : 40, innerWidth / innerHeight, fp ? 0.01 : 0.05, 5000);
const DT = 1 / 60;

if (fp) {
  // ---------------------------------------------------------------- first-person view
  ground.position.y = -1.62;
  const ads = q.get('ads') === '1';
  const weapon = makeWeapon('fp');
  scene.add(weapon.root);
  const sightPos = new THREE.Vector3();
  if (ads) {
    weapon.root.updateMatrixWorld(true);
    sightPos.copy(weapon.anchors.sight.position);
    weapon.root.position.copy(sightPos).negate();
  } else {
    weapon.root.position.set(0.16, -0.18, -0.38);
    weapon.root.rotation.y = 0.05;
  }
  const arms = createFirstPersonArms({ team: Number(q.get('team') ?? 0) });
  scene.add(arms.root);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  const reload = q.get('reload') === '1';
  const step = () => {
    weapon.root.updateMatrixWorld(true);
    arms.update(weapon.anchors.rightHand, q.get('noleft') === '1' ? null : weapon.anchors.leftHand, { leftOverride: reload ? weapon.anchors.magazine : null, snap: true });
  };
  step();
  renderer.render(scene, camera);
  let tris = 0; for (const m of arms.meshes) tris += m.geometry.index.count / 3;
  console.log(`fp arms: ${tris} triangles, ${arms.meshes.length} draw calls, ${arms.bones.length} bones`);
  hud.textContent = `FP arms ${ads ? 'ADS' : 'hip'}  tris ${tris}`;
  window.__READY = true;
  if (live) renderer.setAnimationLoop(() => { step(); renderer.render(scene, camera); });
} else {
  // ---------------------------------------------------------------- third-person row
  const teamQ = q.get('team');
  const vars = (q.get('vars') || '0,1,2').split(',').map(Number);
  const list = [];
  for (const team of teamQ === null ? [0, 1] : [Number(teamQ)]) for (const v of vars) list.push({ team, variant: v });
  const n = list.length;
  const spacing = camMode === 'side' ? 1.6 : 1.25;
  const yaw0 = { front: Math.PI, side: Math.PI / 2, threequarter: Math.PI - 0.75, back: 0, close: Math.PI, top: Math.PI - 0.75 }[camMode] ?? Math.PI - 0.75;
  const t0 = performance.now();
  const soldiers = list.map((it, i) => {
    const s = new SoldierModel({ team: it.team, variant: it.variant, lod });
    s.root.position.set((i - (n - 1) / 2) * spacing, 0, 0);
    s.root.rotation.y = yaw0;
    if (q.get('unarmed') !== '1') s.attachWeapon(makeWeapon('tp'));
    scene.add(s.root);
    return s;
  });
  console.log(`build soldiers: ${(performance.now() - t0).toFixed(0)} ms`);
  const st = soldiers[0] ? soldierStats(soldiers[0]) : null;
  if (st) {
    const lowS = new SoldierModel({ team: list[0].team, variant: list[0].variant, lod: 'low' });
    const ls = soldierStats(lowS);
    lowS.dispose();
    console.log(`soldier high: ${st.triangles} tris, ${st.drawCalls} draw calls, ${st.bones} bones | low: ${ls.triangles} tris, ${ls.drawCalls} draw calls`);
    for (let i = 0; i < soldiers.length; i++) console.log(`  #${i} team ${list[i].team} v${list[i].variant}: ${soldierStats(soldiers[i]).triangles} tris`);
  }
  const pitch0 = Number(q.get('pitch') ?? 0);
  const speedOf = { walk: 1.5, run: 4.6, sprint: 6.9, strafe: 3.2, back: 2.4, crouchwalk: 2.5, crawl: 1.0 };
  const localVel = (a) => {
    const sp = speedOf[a] || 0;
    if (a === 'strafe') return new THREE.Vector3(sp, 0, 0);
    if (a === 'back') return new THREE.Vector3(0, 0, sp);
    return new THREE.Vector3(0, 0, -sp);
  };
  const vel = new THREE.Vector3();
  const state = {
    velocity: vel, yaw: 0, pitch: pitch0, stance: 0, sprinting: false, ads: false, grounded: true,
    lean: 0, reloading: false, firing: false, alive: true,
  };
  const deathDirs = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0.3), new THREE.Vector3(-0.6, 0, 1), new THREE.Vector3(0.3, 0, -1), new THREE.Vector3(-1, 0, -0.2)];
  let time = 0;
  const step = (dt) => {
    time += dt;
    soldiers.forEach((s, i) => {
      const yaw = s.root.rotation.y;
      vel.copy(localVel(anim)).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      state.yaw = yaw;
      state.stance = ['crouch', 'crouchwalk'].includes(anim) ? 1 : ['prone', 'crawl'].includes(anim) ? 2 : 0;
      state.sprinting = anim === 'sprint';
      state.ads = anim === 'ads' || q.get('ads') === '1';
      state.reloading = anim === 'reload';
      state.lean = anim === 'lean' ? (i % 2 ? -1 : 1) : 0;
      state.firing = anim === 'ads' && Math.floor(time / 0.075) !== Math.floor((time - dt) / 0.075) && (time % 1.2) < 0.6;
      if (anim === 'jump') {
        const ph = time % 1.1;
        state.grounded = ph > 0.9;
        vel.y = state.grounded ? 0 : 4.4 - 9.81 * ph;
        s.root.position.y = state.grounded ? 0 : Math.max(0, 4.4 * ph - 4.905 * ph * ph);
      }
      if (anim === 'death' && Math.abs(time - 0.25) < dt * 0.5) s.playDeath(deathDirs[i % deathDirs.length].clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw));
      if (q.get('move') === '1') s.root.position.addScaledVector(vel, dt);
      s.update(dt, state);
    });
  };
  const steps = Math.round(T / DT);
  for (let i = 0; i < steps; i++) step(DT);
  // camera
  const mid = new THREE.Vector3();
  if (q.get('move') === '1') mid.copy(soldiers[Math.floor(n / 2)].root.position);
  const half = ((n - 1) / 2) * spacing;
  const dist = Math.max(4.2, half * 2.5 + 2.5);
  if (camMode === 'close') {
    const s0 = soldiers[0];
    const head = s0.getHeadWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, s0.root.rotation.y);
    camera.fov = 30;
    camera.position.copy(head).addScaledVector(fwd, 1.15).add(new THREE.Vector3(0.35, 0.05, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, s0.root.rotation.y));
    camera.lookAt(head.x, head.y - 0.12, head.z);
  } else if (camMode === 'top') {
    camera.position.set(mid.x + 0.5, 6, mid.z + 4);
    camera.lookAt(mid.x, 0.3, mid.z);
  } else {
    const prone = ['prone', 'crawl', 'death'].includes(anim);
    camera.position.set(mid.x, prone ? 1.6 : 1.25, mid.z + dist);
    camera.lookAt(mid.x, prone ? 0.25 : 0.92, mid.z + (prone ? 0.5 : 0));
  }
  camera.updateProjectionMatrix();
  sun.target.position.copy(mid);
  sun.position.copy(mid).addScaledVector(sunDir, 30);
  const t1 = performance.now();
  renderer.render(scene, camera);
  console.log(`first render: ${(performance.now() - t1).toFixed(0)} ms`);
  hud.textContent = `anim=${anim} t=${T}s lod=${lod}  ${st ? `${st.triangles} tris/${st.drawCalls} calls per soldier` : ''}  draw calls ${renderer.info.render.calls}`;
  console.log(`frame draw calls: ${renderer.info.render.calls}, triangles: ${renderer.info.render.triangles}`);
  window.__READY = true;
  if (live) {
    let last = performance.now();
    renderer.setAnimationLoop(() => {
      const now = performance.now();
      step(Math.min(0.05, (now - last) / 1000));
      last = now;
      renderer.render(scene, camera);
    });
  }
}
