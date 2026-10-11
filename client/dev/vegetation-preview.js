// Dev preview for client/js/world/vegetation.js and rocks.js.
// Views: ?view=lineup | forest | rocks | closeup&species=pine
// Options: &sun=golden|noon|overcast  &t=<wind time>  &wind=0..1  &q=low|medium|high|ultra
//          &species=<name> (lineup/closeup)  &v=<variant> (closeup)  &frames=N  &info=0
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { VegetationSystem, TREE_SPECIES, BUSH_SPECIES } from '../js/world/vegetation.js';
import { RockSystem, ROCK_TYPES } from '../js/world/rocks.js';
import { mulberry32 } from '../js/world/vegetation-textures.js';

const params = new URLSearchParams(location.search);
const view = params.get('view') || 'lineup';
const quality = params.get('q') || 'high';
const windT = parseFloat(params.get('t') || '3.7');
const windS = parseFloat(params.get('wind') || '0.35');
const sunName = params.get('sun') || (view === 'rocks' ? 'overcast' : view === 'forest' ? 'golden' : 'golden');
const frames = parseInt(params.get('frames') || '3', 10);
const info = document.getElementById('info');
if (params.get('info') === '0') info.style.display = 'none';

const SUNS = {
  golden: { el: 9, az: 230, color: '#ffd2a0', intensity: 3.4, sky: { turbidity: 5.5, rayleigh: 2.4, mieCoefficient: 0.007, mieDirectionalG: 0.86, cloudCoverage: 0.32, cloudDensity: 0.45 }, fog: '#cdb995', fogDensity: 0.0011, env: 0.75, exposure: 0.62, ground: '#6f6c3c' },
  noon: { el: 58, az: 150, color: '#fff3e2', intensity: 3.6, sky: { turbidity: 3, rayleigh: 1.1, mieCoefficient: 0.004, mieDirectionalG: 0.8, cloudCoverage: 0.25, cloudDensity: 0.35 }, fog: '#b9c8d8', fogDensity: 0.0008, env: 0.9, exposure: 0.55, ground: '#56632f' },
  overcast: { el: 38, az: 200, color: '#e4e8ee', intensity: 1.1, sky: { turbidity: 10, rayleigh: 0.6, mieCoefficient: 0.02, mieDirectionalG: 0.7, cloudCoverage: 0.92, cloudDensity: 0.85 }, fog: '#9ea3a6', fogDensity: 0.0016, env: 0.42, exposure: 0.5, ground: '#55594a' },
};
const sun = SUNS[sunName] || SUNS.golden;

main();

// ------------------------------------------------------------------------------------------------
// 3D views
// ------------------------------------------------------------------------------------------------

function groundTexture(color) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const base = new THREE.Color(color);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry32(77);
  for (let i = 0; i < 9000; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const k = 0.75 + rng() * 0.5;
    const col = base.clone().multiplyScalar(k);
    col.offsetHSL((rng() - 0.5) * 0.04, (rng() - 0.5) * 0.1, 0);
    ctx.strokeStyle = `#${col.getHexString()}`;
    ctx.lineWidth = 1 + rng() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 6, y - 4 - rng() * 8);
    ctx.stroke();
  }
  for (let i = 0; i < 60; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 20 + rng() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = base.clone().multiplyScalar(0.7 + rng() * 0.5);
    g.addColorStop(0, `#${col.getHexString()}55`);
    g.addColorStop(1, `#${col.getHexString()}00`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(800, 800);
  t.anisotropy = 8;
  return t;
}

function valueNoise2(seed) {
  const rng = mulberry32(seed);
  const g = new Float32Array(256 * 256);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const at = (x, y) => g[((y & 255) << 8) | (x & 255)];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function lineupScene() {
  const trees = [];
  const bushes = [];
  const rocks = [];
  const only = params.get('species');
  if (only) {
    for (let v = 0; v < 3; v++) trees.push({ x: (v - 1) * 15, y: 0, z: -4, rot: 0.6 + v * 2.1, scale: 1, species: only, variant: v });
  } else {
    Object.keys(TREE_SPECIES).forEach((sp, si) => {
      for (let v = 0; v < 3; v++) trees.push({ x: (si - 2.5) * 13 + (v - 1) * 4.4, y: 0, z: -v * 15, rot: 0.5 + v * 2.2 + si, scale: 1, species: sp, variant: v });
    });
  }
  BUSH_SPECIES.forEach((sp, si) => {
    for (let v = 0; v < 2; v++) bushes.push({ x: (si * 2 + v - 2.5) * 3.2, y: 0, z: 16, rot: si + v, scale: 1, species: sp, variant: v });
  });
  const R = {
    boulder: [1.7, 1.2, 1.5], slab: [2.4, 0.7, 1.8], spire: [1.3, 3.8, 1.2], cliff: [4.5, 3.0, 3.2], pebble: [0.45, 0.32, 0.4],
  };
  ROCK_TYPES.forEach((type, ti) => {
    for (let v = 0; v < 2; v++) {
      const side = v ? 1 : -1;
      const s = R[type];
      rocks.push({ x: side * (18 + ti * 4.2), y: s[1] * 0.3, z: 20 - ti * 3.5, rotY: ti + v * 2, sx: s[0], sy: s[1], sz: s[2], type, variant: v * 3 + ti % 3 });
    }
  });
  const cam = only ? { pos: [0, 4.5, 30], look: [0, 9, -4], fov: 50 } : { pos: [0, 7, 40], look: [0, 8.5, -10], fov: 55 };
  return { trees, bushes, rocks, cam, shadowCenter: [0, 0, 0], shadowSize: 70 };
}

function forestScene() {
  const rng = mulberry32(12345);
  const n1 = valueNoise2(3);
  const n2 = valueNoise2(4);
  const trees = [];
  const bushes = [];
  const rocks = [];
  const mix = params.get('mix') || 'valley';
  const pick = mix === 'outpost'
    ? () => { const r = rng(); return r < 0.3 ? 'birch' : r < 0.55 ? 'oak' : r < 0.85 ? 'spruce' : 'pine'; }
    : mix === 'ridge'
      ? () => (rng() < 0.75 ? 'dead' : 'spruce')
      : () => { const r = rng(); return r < 0.52 ? 'pine' : r < 0.78 ? 'araucaria' : r < 0.9 ? 'spruce' : r < 0.97 ? 'birch' : 'dead'; };
  const count = parseInt(params.get('trees') || '3000', 10);
  let guard = 0;
  while (trees.length < count && guard++ < count * 40) {
    const x = (rng() - 0.5) * 800;
    const z = 60 - rng() * 800;
    const d = n1(x * 0.012 + 10, z * 0.012 + 10) * 0.7 + n2(x * 0.04, z * 0.04) * 0.3;
    const clear = Math.hypot(x, z + 10) < 55 ? 0 : 1;
    if (rng() > Math.pow(Math.max(0, (d - 0.35) / 0.4), 1.4) * clear) continue;
    trees.push({ x, y: 0, z, rot: rng() * Math.PI * 2, scale: 0.75 + rng() * 0.45, species: pick() });
  }
  const nb = parseInt(params.get('bushes') || '9000', 10);
  guard = 0;
  while (bushes.length < nb && guard++ < nb * 30) {
    const x = (rng() - 0.5) * 500;
    const z = 50 - rng() * 500;
    const d = n1(x * 0.012 + 10, z * 0.012 + 10);
    if (rng() > 0.25 + d * 0.6) continue;
    const r = rng();
    bushes.push({ x, y: 0, z, rot: rng() * 6.28, scale: 0.6 + rng() * 0.8, species: r < 0.5 ? 'shrub' : r < 0.8 ? 'juniper' : 'fern' });
  }
  const nr = parseInt(params.get('rocks') || '60', 10);
  for (let i = 0; i < nr; i++) {
    const far = i > 60;
    const x = (rng() - 0.5) * (far ? 1800 : 300);
    const z = (far ? 900 : 30) - rng() * (far ? 1800 : 300);
    const r = rng();
    const type = r < 0.3 ? 'slab' : r < 0.45 && far ? 'cliff' : r < 0.55 && far ? 'spire' : r < 0.75 ? 'pebble' : 'boulder';
    const s = type === 'pebble' ? 0.25 + rng() * 0.35 : far ? 1.5 + rng() * 6 : 0.8 + rng() * 2.6;
    const st = type === 'spire' ? [0.6, 2.6, 0.6] : type === 'cliff' ? [1.6, 0.9, 1.0] : type === 'slab' ? [1.5, 0.45, 1.1] : [1, 0.7, 1];
    rocks.push({ x, y: s * st[1] * 0.3, z, rotY: rng() * 6.28, sx: s * st[0] * (0.8 + rng() * 0.4), sy: s * st[1], sz: s * st[2] * (0.8 + rng() * 0.4), type });
  }
  return { trees, bushes, rocks, cam: { pos: [0, 1.7, 40], look: [8, 5, -120], fov: 62 }, shadowCenter: [0, 0, -20], shadowSize: 110 };
}

function rocksScene() {
  const rng = mulberry32(777);
  const rocks = [];
  const trees = [];
  const bushes = [];
  const add = (x, z, type, s, sink, st) => {
    const sx = s * (st ? st[0] : 0.8 + rng() * 0.45);
    const sy = s * (st ? st[1] : 0.55 + rng() * 0.35);
    const sz = s * (st ? st[2] : 0.8 + rng() * 0.45);
    rocks.push({ x, y: sy * (1 - sink * 2) * 0.5, z, rotY: rng() * 6.28, sx, sy, sz, type });
  };
  // spires and cliffs in the mid/background
  for (let i = 0; i < 46; i++) {
    const x = (rng() - 0.5) * 520;
    const z = -40 - rng() * 520;
    const s = 4 + rng() * 8;
    const r = rng();
    if (r < 0.45) add(x, z, 'spire', s * 0.8, 0.12, [0.55 + rng() * 0.25, 1.8 + rng() * 1.6, 0.55 + rng() * 0.25]);
    else if (r < 0.8) add(x, z, 'cliff', s, 0.3, [1.3 + rng() * 0.7, 0.7 + rng() * 0.4, 0.8 + rng() * 0.4]);
    else add(x, z, 'boulder', s * 0.6, 0.3);
  }
  // boulder clusters nearer (the first one right in front of the camera)
  for (let c = 0; c < 26; c++) {
    const cx = c === 0 ? 4 : (rng() - 0.5) * 220;
    const cz = c === 0 ? 12 : 10 - rng() * 240;
    const n = 3 + Math.floor(rng() * 5);
    const spire = c === 0 || rng() < 0.4;
    for (let i = 0; i < n; i++) {
      const x = cx + (rng() - 0.5) * 18;
      const z = cz + (rng() - 0.5) * 18;
      const s = 1 + rng() * 3.2;
      if (spire && i < 2) add(x, z, 'spire', s * 0.7, 0.15, [0.6 + rng() * 0.3, 1.8 + rng() * 1.4, 0.6 + rng() * 0.3]);
      else add(x, z, rng() < 0.35 ? 'slab' : 'boulder', s, 0.35, rng() < 0.35 ? [1.2 + rng() * 0.6, 0.35 + rng() * 0.2, 0.9 + rng() * 0.4] : null);
    }
    for (let i = 0; i < n * 2; i++) add(cx + (rng() - 0.5) * 28, cz + (rng() - 0.5) * 28, 'pebble', 0.25 + rng() * 0.35, 0.3);
  }
  for (let i = 0; i < 30; i++) trees.push({ x: (rng() - 0.5) * 400, y: 0, z: -rng() * 400, rot: rng() * 6.28, scale: 0.7 + rng() * 0.4, species: rng() < 0.7 ? 'dead' : 'spruce' });
  for (let i = 0; i < 300; i++) bushes.push({ x: (rng() - 0.5) * 200, y: 0, z: 20 - rng() * 200, rot: rng() * 6.28, scale: 0.5 + rng() * 0.6, species: rng() < 0.85 ? 'juniper' : 'shrub' });
  return { trees, bushes, rocks, cam: { pos: [0, 2.2, 38], look: [5, 9, -60], fov: 60 }, shadowCenter: [0, 0, -10], shadowSize: 90 };
}

function closeupScene() {
  const species = params.get('species') || 'pine';
  const v = parseInt(params.get('v') || '0', 10);
  const trees = [{ x: 0, y: 0, z: 0, rot: 0.3, scale: 1, species, variant: v }];
  const rng = mulberry32(5);
  for (let i = 0; i < 12; i++) {
    const a = rng() * 6.28;
    const r = 25 + rng() * 40;
    trees.push({ x: Math.sin(a) * r, y: 0, z: Math.cos(a) * r - 20, rot: rng() * 6.28, scale: 0.8 + rng() * 0.4, species });
  }
  const bushes = [];
  for (let i = 0; i < 14; i++) {
    const a = rng() * 6.28;
    const r = 2 + rng() * 7;
    bushes.push({ x: Math.sin(a) * r, y: 0, z: Math.cos(a) * r, rot: rng() * 6.28, scale: 0.6 + rng() * 0.5, species: BUSH_SPECIES[i % 3] });
  }
  const H = TREE_SPECIES[species]?.height || 15;
  const look = params.get('look') || 'up';
  const cam = look === 'up'
    ? { pos: [2.6, 1.6, 3.05], look: [0, H * 0.55, -1.2], fov: 70 }
    : { pos: [3, 1.7, 9], look: [0, 3, 0], fov: 60 };
  return { trees, bushes, rocks: [{ x: 3.2, y: 0.25, z: -2.5, rotY: 1, sx: 1.2, sy: 0.8, sz: 1.0, type: 'boulder' }], cam, shadowCenter: [0, 0, 0], shadowSize: 40 };
}

async function main() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = sun.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 4000);

  // sky + environment
  const el = THREE.MathUtils.degToRad(sun.el);
  const az = THREE.MathUtils.degToRad(parseFloat(params.get('az') || sun.az));
  const sunDir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const su = sky.material.uniforms;
  for (const [k, v] of Object.entries(sun.sky)) if (su[k]) su[k].value = v;
  su.sunPosition.value.copy(sunDir);
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(10000);
  for (const [k, v] of Object.entries(sun.sky)) if (envSky.material.uniforms[k]) envSky.material.uniforms[k].value = v;
  envSky.material.uniforms.sunPosition.value.copy(sunDir);
  if (envSky.material.uniforms.showSunDisc) envSky.material.uniforms.showSunDisc.value = 0;
  envScene.add(envSky);
  const envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = sun.env;
  scene.fog = new THREE.FogExp2(new THREE.Color(sun.fog), sun.fogDensity);

  // sun light
  const light = new THREE.DirectionalLight(new THREE.Color(sun.color), sun.intensity);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.04;
  scene.add(light);
  scene.add(light.target);

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshStandardMaterial({ map: groundTexture(sun.ground), roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const def = view === 'forest' ? forestScene() : view === 'rocks' ? rocksScene() : view === 'closeup' ? closeupScene() : lineupScene();
  camera.position.fromArray(def.cam.pos);
  camera.fov = def.cam.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(new THREE.Vector3().fromArray(def.cam.look));
  camera.updateMatrixWorld();

  const sc = light.shadow.camera;
  const S = def.shadowSize;
  sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.near = 1; sc.far = 600;
  sc.updateProjectionMatrix();
  const center = new THREE.Vector3().fromArray(def.shadowCenter);
  light.target.position.copy(center);
  light.position.copy(center).addScaledVector(sunDir, 300);

  const veg = new VegetationSystem({ renderer, scene, quality });
  veg.setWind(windS, 0.8, 0.6);
  if (params.has('trans')) veg.uniforms.uVegTrans.value.w = parseFloat(params.get('trans'));
  if (params.has('envi')) scene.environmentIntensity = parseFloat(params.get('envi'));
  if (params.has('sunI')) light.intensity = parseFloat(params.get('sunI'));
  const rocks = new RockSystem({ scene, quality });
  const t0 = performance.now();
  await veg.build({ trees: def.trees, bushes: def.bushes });
  const t1 = performance.now();
  rocks.build(def.rocks);
  const t2 = performance.now();
  window.__veg = veg;
  window.__rocks = rocks;
  window.__scene = scene;
  window.__camera = camera;
  window.__renderer = renderer;

  let rs;
  for (let f = 0; f < frames; f++) {
    veg.update(camera, windT + f / 60);
    rocks.update(camera);
    const fr0 = performance.now();
    renderer.render(scene, camera);
    rs = { ms: performance.now() - fr0, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  }
  const vs = veg.stats;
  const rst = rocks.stats;
  const lines = [
    `view=${view} sun=${sunName} q=${quality} trees=${def.trees.length} bushes=${def.bushes.length} rocks=${def.rocks.length}`,
    `veg build ${(t1 - t0).toFixed(0)} ms ${JSON.stringify(veg.buildTimings, (k, v) => (typeof v === 'number' ? Math.round(v) : v))}`,
    `rock build ${(t2 - t1).toFixed(0)} ms (library ${rst.libraryMs?.toFixed(0)} ms)`,
    `veg stats ${JSON.stringify(vs, (k, v) => (typeof v === 'number' ? Math.round(v) : v))}`,
    `rock stats ${JSON.stringify(rst, (k, v) => (typeof v === 'number' ? Math.round(v) : v))}`,
    `renderer: ${rs.calls} calls (incl. shadow pass), ${rs.tris} tris, last frame ${rs.ms.toFixed(0)} ms`,
  ];
  info.textContent = lines.join('\n');
  console.log(lines.join('\n'));
  console.log('variants', JSON.stringify(veg.variantInfo));
  window.__READY = true;
}
