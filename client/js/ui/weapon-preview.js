// Live 3D weapon preview for the loadout screen: its own small WebGLRenderer (transparent
// background), RoomEnvironment image based lighting, rim lights, a soft ground shadow and a
// slow turntable sway. Drag to rotate, wheel to zoom, double-click to reset.
// Models come from /js/models/weapon-models.js (buildWeaponModel). If that module is missing
// or throws, a procedural placeholder silhouette is shown instead so the page never breaks.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WEAPONS } from '/shared/weapons.js';

const MODELS_URL = '/js/models/weapon-models.js';
const CACHE_MAX = 10;
const DEG = Math.PI / 180;
// Base orientation: barrel (model −Z) points to screen-left, slight three-quarter angle so the
// muzzle comes a little towards the viewer.
const BASE_YAW = Math.PI / 2 + 0.3;
const SWAY_AMP = 0.32;
const CAM_ELEV = 9 * DEG;

let modelsPromise = null;
let modelsFailedAt = 0;

function loadModels() {
  if (!modelsPromise) {
    if (modelsFailedAt && performance.now() - modelsFailedAt < 5000) {
      return Promise.reject(new Error('weapon-models unavailable'));
    }
    modelsPromise = import(MODELS_URL).catch((err) => {
      modelsPromise = null;
      modelsFailedAt = performance.now();
      throw err;
    });
  }
  return modelsPromise;
}

export class WeaponPreview {
  /**
   * @param {HTMLElement} container element the canvas fills (should have a size; position:relative)
   */
  constructor(container) {
    this.container = container;
    this.running = false;
    this.frames = 0;
    this.weaponId = null;
    this.attachments = null;
    this.usingPlaceholder = false;
    this._token = 0;
    this._cache = new Map();
    this._current = null;
    this._t = 0;
    this._last = 0;
    this._raf = 0;
    this._dragYaw = 0;
    this._dragPitch = 0;
    this._idle = 99;
    this._zoom = 1;
    this._zoomTarget = 1;
    this._intro = 1;
    this._fit = { dist: 1.5, len: 0.9, height: 0.25 };
    this._firstFrame = null;
    this.rendered = new Promise((res) => { this._firstFrame = res; });

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sr-wp-canvas';
    this.canvas.setAttribute('aria-label', 'Weapon preview (drag to rotate, scroll to zoom)');
    container.appendChild(this.canvas);

    try {
      this._initGL();
    } catch (err) {
      console.warn('[WeaponPreview] WebGL unavailable:', err);
      this.renderer = null;
      container.classList.add('sr-wp-nogl');
      this._firstFrame();
      return;
    }
    this._bindInput();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);
    this._resize();
    this._loop = this._loop.bind(this);
  }

  _initGL() {
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power',
    });
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.08;
    this.renderer = r;
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this._lost = true; });
    this.canvas.addEventListener('webglcontextrestored', () => { this._lost = false; });

    const scene = new THREE.Scene();
    this.scene = scene;
    const pmrem = new THREE.PMREMGenerator(r);
    const room = new RoomEnvironment();
    this._env = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose();
    room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    scene.environment = this._env;
    scene.environmentIntensity = 0.62;

    this.camera = new THREE.PerspectiveCamera(26, 1, 0.01, 60);

    // Key, cool rim (back-left), warm accent rim (back-right), soft fill.
    const key = new THREE.DirectionalLight(0xfff0dc, 2.1);
    key.position.set(1.5, 3.2, 3.5);
    const rimCool = new THREE.DirectionalLight(0xa9c8ff, 3.2);
    rimCool.position.set(-3.5, 1.6, -3.0);
    const rimWarm = new THREE.DirectionalLight(0xffb347, 2.2);
    rimWarm.position.set(3.8, 0.9, -2.6);
    const top = new THREE.DirectionalLight(0xffffff, 0.8);
    top.position.set(0, 5, 0);
    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x1c140c, 0.35);
    scene.add(key, rimCool, rimWarm, top, hemi);

    // Hierarchy: yaw (turntable) → pitch → centerer → model; shadow/glow follow yaw only.
    this.yawGroup = new THREE.Group();
    this.pitchGroup = new THREE.Group();
    this.centerer = new THREE.Group();
    this.pitchGroup.add(this.centerer);
    this.yawGroup.add(this.pitchGroup);
    scene.add(this.yawGroup);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: radialTexture([[0, 'rgba(0,0,0,0.62)'], [0.45, 'rgba(0,0,0,0.3)'], [1, 'rgba(0,0,0,0)']]),
        transparent: true, depthWrite: false, toneMapped: false,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = -2;
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: radialTexture([[0, 'rgba(255,176,0,0.32)'], [0.5, 'rgba(255,150,0,0.08)'], [1, 'rgba(255,140,0,0)']]),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      }),
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.renderOrder = -3;
    this.yawGroup.add(this.glow, this.shadow);
  }

  _bindInput() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      c.setPointerCapture(e.pointerId);
      c.classList.add('sr-wp-grab');
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      this._dragYaw += dx * 0.011;
      this._dragPitch = Math.max(-0.5, Math.min(0.6, this._dragPitch + dy * 0.006));
      this._idle = 0;
    });
    const end = (e) => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      drag = null;
      c.classList.remove('sr-wp-grab');
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._zoomTarget = Math.max(0.6, Math.min(1.55, this._zoomTarget * Math.exp(e.deltaY * 0.0012)));
      this._idle = 0;
    }, { passive: false });
    c.addEventListener('dblclick', () => this.resetView());
  }

  /** Reset drag rotation and zoom. */
  resetView() {
    this._zoomTarget = 1;
    this._idle = 99;
  }

  /**
   * Show a weapon. Builds via buildWeaponModel(weaponId, attachments, { lod: 'fp' }) when the
   * models module is available, otherwise a placeholder silhouette. Rapid calls: last one wins.
   * @param {string} weaponId
   * @param {{optic?:string, muzzle?:string, grip?:string}} [attachments]
   * @returns {Promise<void>}
   */
  async setWeapon(weaponId, attachments = {}) {
    if (!this.renderer) return;
    const att = { optic: attachments?.optic, muzzle: attachments?.muzzle, grip: attachments?.grip };
    const key = `${weaponId}|${att.optic}|${att.muzzle}|${att.grip}`;
    if (this._current && this._current.key === key) return;
    this.weaponId = weaponId;
    this.attachments = att;
    const token = ++this._token;
    let entry = this._cache.get(key);
    if (!entry) {
      entry = await this._build(weaponId, att, key);
      if (!entry) return;
      this._cachePut(key, entry);
    } else {
      // refresh LRU order
      this._cache.delete(key);
      this._cache.set(key, entry);
    }
    if (token !== this._token) return;
    this._show(entry);
  }

  async _build(weaponId, att, key) {
    let root = null;
    let disposeFn = null;
    let placeholder = false;
    try {
      const mod = await loadModels();
      if (typeof mod.buildWeaponModel !== 'function') throw new Error('buildWeaponModel missing');
      const res = await mod.buildWeaponModel(weaponId, att, { lod: 'fp' });
      root = res && (res.root || (res.isObject3D ? res : null));
      if (!root || !root.isObject3D) throw new Error('buildWeaponModel returned no root');
      if (res.info && typeof res.info.dispose === 'function') disposeFn = () => res.info.dispose();
      else if (typeof res.dispose === 'function') disposeFn = () => res.dispose();
    } catch (err) {
      if (!this._warned) {
        this._warned = true;
        console.info('[WeaponPreview] using placeholder model:', err && err.message ? err.message : err);
      }
      root = buildPlaceholder(weaponId, att);
      placeholder = true;
      disposeFn = () => disposeObject(root);
    }
    if (!this.renderer) return null;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.05, -0.1, -0.5), new THREE.Vector3(0.05, 0.1, 0.4));
    return { key, root, box, placeholder, dispose: disposeFn };
  }

  _cachePut(key, entry) {
    this._cache.set(key, entry);
    while (this._cache.size > CACHE_MAX) {
      const [oldKey, old] = this._cache.entries().next().value;
      if (this._current && this._current.key === oldKey) {
        this._cache.delete(oldKey);
        this._cache.set(oldKey, old);
        continue;
      }
      this._cache.delete(oldKey);
      try { old.dispose && old.dispose(); } catch { /* ignore */ }
    }
  }

  _show(entry) {
    if (this._current) this.centerer.remove(this._current.root);
    this._current = entry;
    this.usingPlaceholder = entry.placeholder;
    const { box, root } = entry;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -center.y, -center.z);
    this.centerer.add(root);
    const len = Math.max(size.z, size.x, 0.2);
    this._fit.len = len;
    this._fit.width = Math.max(0.03, size.x);
    this._fit.height = Math.max(0.05, size.y);
    const floorY = -size.y / 2 - Math.max(0.02, len * 0.05);
    this.shadow.position.set(0, floorY, 0);
    this.shadow.scale.set(Math.max(0.12, size.x * 2.6), len * 1.15, 1);
    this.glow.position.set(0, floorY - 0.001, 0);
    this.glow.scale.set(len * 0.9, len * 1.7, 1);
    this._intro = 0;
    this._fitCamera();
    if (this.running) this._render();
  }

  _fitCamera() {
    const cam = this.camera;
    const aspect = cam.aspect || 1;
    const vFov = cam.fov * DEG;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    // horizontal extent ≈ length projected with three-quarter angle and sway
    const horiz = this._fit.len * 0.98 + this._fit.width * 0.6;
    const fillW = 0.8;
    const fillH = 0.58;
    const dW = (horiz / 2) / Math.tan(hFov / 2) / fillW;
    const dH = (this._fit.height / 2) / Math.tan(vFov / 2) / fillH;
    this._fit.dist = Math.max(dW, dH) + this._fit.width;
  }

  _resize() {
    if (!this.renderer) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._fitCamera();
    if (this.running) this._render();
  }

  /** Start rendering (call when the preview becomes visible). */
  start() {
    if (!this.renderer || this.running) return;
    this.running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._loop);
  }

  /** Stop rendering (call when hidden). */
  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _loop(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min(0.1, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    if (document.hidden || this._lost) return;
    if (!this.container.isConnected || this.container.clientWidth === 0) return;
    this._update(dt);
    this._render();
  }

  _update(dt) {
    this._t += dt;
    this._idle += dt;
    if (this._idle > 2.5) {
      // ease back to the presentation pose after the user lets go
      const k = 1 - Math.exp(-dt * 1.6);
      this._dragYaw += (wrapAngle(this._dragYaw) - this._dragYaw);
      this._dragYaw -= this._dragYaw * k;
      this._dragPitch -= this._dragPitch * k;
    }
    this._zoom += (this._zoomTarget - this._zoom) * (1 - Math.exp(-dt * 10));
    this._intro = Math.min(1, this._intro + dt / 0.45);
  }

  _render() {
    if (!this.renderer || !this._current) return;
    const e = easeOutCubic(this._intro);
    const sway = Math.sin(this._t * 0.33) * SWAY_AMP;
    this.yawGroup.rotation.y = BASE_YAW + sway + this._dragYaw + (1 - e) * 0.5;
    this.pitchGroup.rotation.x = this._dragPitch;
    this.pitchGroup.rotation.z = Math.sin(this._t * 0.5) * 0.015;
    const bob = Math.sin(this._t * 1.1) * this._fit.len * 0.006;
    this.pitchGroup.position.y = bob;
    this.yawGroup.position.x = (1 - e) * this._fit.len * 0.12;
    const s = 0.94 + 0.06 * e;
    this.yawGroup.scale.setScalar(s);
    const d = this._fit.dist * this._zoom;
    this.camera.position.set(0, Math.sin(CAM_ELEV) * d, Math.cos(CAM_ELEV) * d);
    this.camera.lookAt(0, -this._fit.height * 0.08, 0);
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if (this.frames === 1) this._firstFrame();
  }

  /** Promise that resolves once a model has been drawn at least once. */
  whenRendered() {
    return this.rendered;
  }

  /** Render one frame immediately (even when stopped). */
  renderOnce() {
    this._render();
  }

  /** Stop and release all GPU resources; removes the canvas. */
  dispose() {
    this.stop();
    if (this._ro) this._ro.disconnect();
    for (const entry of this._cache.values()) {
      try { entry.dispose && entry.dispose(); } catch { /* ignore */ }
    }
    this._cache.clear();
    this._current = null;
    if (this.renderer) {
      this.shadow.geometry.dispose();
      this.shadow.material.map.dispose();
      this.shadow.material.dispose();
      this.glow.geometry.dispose();
      this.glow.material.map.dispose();
      this.glow.material.dispose();
      this._env.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }
    this.canvas.remove();
  }
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Placeholder model: a procedural silhouette per weapon category. Origin = pistol grip,
// barrel along −Z, y up. Only used when /js/models/weapon-models.js is not available.

const PROFILES = {
  AR: { rec: 0.36, recH: 0.075, hand: 0.25, barrel: 0.13, stock: 0.25, mag: 'curve', magLen: 0.17 },
  SMG: { rec: 0.28, recH: 0.07, hand: 0.13, barrel: 0.06, stock: 0.2, mag: 'straight', magLen: 0.19 },
  LMG: { rec: 0.42, recH: 0.1, hand: 0.27, barrel: 0.24, stock: 0.27, mag: 'box', magLen: 0.11 },
  DMR: { rec: 0.4, recH: 0.078, hand: 0.3, barrel: 0.2, stock: 0.28, mag: 'straight', magLen: 0.11 },
  SNIPER: { rec: 0.36, recH: 0.075, hand: 0.3, barrel: 0.34, stock: 0.32, mag: 'short', magLen: 0.07 },
  SHOTGUN: { rec: 0.3, recH: 0.08, hand: 0.0, barrel: 0.42, stock: 0.3, mag: 'tube', magLen: 0 },
};

const WOOD = new Set(['ak47', 'svd', 'r870']);
const TAN = new Set(['scarh', 'mk14', 'm110']);

function buildPlaceholder(weaponId, att = {}) {
  const w = WEAPONS[weaponId] || WEAPONS.m4a1;
  const root = new THREE.Group();
  root.name = 'placeholder-' + w.id;
  const metal = new THREE.MeshStandardMaterial({ color: 0x2c2f33, metalness: 0.8, roughness: 0.36 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.25, roughness: 0.7 });
  const furnitureColor = WOOD.has(w.id) ? 0x6e3d1f : TAN.has(w.id) ? 0x8a7656 : 0x1d1e20;
  const furniture = new THREE.MeshStandardMaterial({
    color: furnitureColor, metalness: WOOD.has(w.id) ? 0.05 : 0.15, roughness: WOOD.has(w.id) ? 0.55 : 0.68,
  });
  const glass = new THREE.MeshStandardMaterial({ color: 0x5aa0ff, metalness: 0.9, roughness: 0.05, emissive: 0x0a1830 });

  const box = (sx, sy, sz, x, y, z, mat = metal, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    root.add(m);
    return m;
  };
  const cyl = (r, len, x, y, z, mat = metal, axis = 'z', r2 = r) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, 20), mat);
    m.position.set(x, y, z);
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    root.add(m);
    return m;
  };

  if (w.category === 'PISTOL') {
    const slideL = w.id === 'deagle' ? 0.25 : w.id === 'r357' ? 0.2 : 0.19;
    const y = 0.045;
    if (w.id === 'r357') {
      cyl(0.019, 0.05, 0, y - 0.005, -0.03, metal, 'z'); // cylinder
      cyl(0.009, 0.15, 0, y + 0.006, -0.13, metal, 'z'); // barrel
      box(0.016, 0.012, 0.14, 0, y - 0.01, -0.12, metal);
      box(0.026, 0.035, 0.07, 0, y, 0.03, metal);
    } else {
      box(0.028, 0.032, slideL, 0, y, -slideL / 2 + 0.06, metal);
      box(0.024, 0.02, slideL * 0.85, 0, y - 0.025, -slideL / 2 + 0.06, dark);
      cyl(0.006, 0.012, 0, y + 0.004, -slideL + 0.055, dark, 'z');
    }
    box(0.03, 0.11, 0.045, 0, -0.025, 0.03, dark, -0.28); // grip
    box(0.006, 0.022, 0.05, 0, y - 0.045, -0.025, dark); // trigger guard
    if (att.muzzle === 'suppressor') cyl(0.016, 0.13, 0, y + 0.004, -slideL + 0.06 - 0.075, dark, 'z');
    if (att.optic === 'reddot') {
      box(0.022, 0.02, 0.03, 0, y + 0.027, -0.01, dark);
      box(0.018, 0.012, 0.002, 0, y + 0.03, -0.024, glass);
    }
    return root;
  }

  const p = PROFILES[w.category] || PROFILES.AR;
  const recH = p.recH;
  const yC = 0.035 + recH / 2;
  const bull = w.bullpup;
  // receiver spans backwards of the grip for bullpups
  const recFront = bull ? -0.13 : -p.rec + 0.1;
  const recBack = bull ? p.rec - 0.13 : 0.1;
  const recLen = recBack - recFront;
  box(0.055, recH, recLen, 0, yC, (recFront + recBack) / 2, metal);
  box(0.03, 0.012, recLen * 0.85, 0, yC + recH / 2 + 0.006, (recFront + recBack) / 2, dark); // top rail
  // lower receiver
  box(0.048, 0.03, recLen * 0.6, 0, yC - recH / 2 - 0.012, recFront + recLen * 0.35, dark);
  // handguard
  let front = recFront;
  if (p.hand > 0) {
    box(0.058, recH * 0.86, p.hand, 0, yC - 0.004, recFront - p.hand / 2, furniture);
    box(0.026, 0.01, p.hand * 0.92, 0, yC + recH * 0.43 + 0.005, recFront - p.hand / 2, dark);
    front = recFront - p.hand;
  }
  // barrel
  const barrelLen = p.barrel + (p.hand > 0 ? 0.02 : 0);
  const by = yC + 0.008;
  cyl(0.0115, barrelLen, 0, by, front - barrelLen / 2 + 0.02, metal, 'z');
  let tip = front - barrelLen + 0.02;
  if (w.category === 'SHOTGUN') {
    cyl(0.013, p.barrel * 0.8, 0, by - 0.03, front - p.barrel * 0.4, dark, 'z'); // tube
    if (w.fireModes.includes('pump')) box(0.05, 0.045, 0.14, 0, by - 0.032, front - 0.12, furniture);
  }
  // muzzle device
  if (att.muzzle === 'suppressor') {
    cyl(0.02, 0.17, 0, by, tip - 0.085, dark, 'z');
    tip -= 0.17;
  } else if (att.muzzle === 'comp') {
    box(0.03, 0.03, 0.06, 0, by, tip - 0.03, metal);
    tip -= 0.06;
  } else if (att.muzzle === 'flash') {
    cyl(0.015, 0.055, 0, by, tip - 0.027, dark, 'z');
    tip -= 0.055;
  }
  // front sight post
  if (!att.optic || att.optic === 'iron') {
    box(0.008, 0.045, 0.01, 0, yC + recH / 2 + 0.02, front + 0.04, dark);
    box(0.02, 0.03, 0.02, 0, yC + recH / 2 + 0.018, recBack - 0.04, dark);
  }
  // stock
  if (p.stock > 0) {
    const sz = bull ? recBack + p.stock * 0.25 : recBack + p.stock / 2;
    const sl = bull ? p.stock * 0.5 : p.stock;
    box(0.045, recH * 0.95, sl, 0, yC - 0.012, sz, furniture);
    box(0.05, recH * 1.5, 0.02, 0, yC - 0.02, sz + sl / 2 + 0.01, dark); // butt pad
  }
  // pistol grip
  box(0.034, 0.11, 0.042, 0, -0.03, 0.01, dark, -0.32);
  box(0.006, 0.02, 0.07, 0, yC - recH / 2 - 0.035, -0.035, dark); // trigger guard
  // magazine
  const magZ = bull ? 0.11 : -0.085;
  if (p.mag === 'curve') {
    const m = box(0.03, p.magLen, 0.075, 0, yC - recH / 2 - p.magLen / 2 + 0.01, magZ, dark, 0.28);
    m.position.z -= 0.02;
  } else if (p.mag === 'straight') {
    box(0.028, p.magLen, 0.06, 0, yC - recH / 2 - p.magLen / 2 + 0.01, magZ, dark, 0.08);
  } else if (p.mag === 'box') {
    box(0.09, p.magLen, 0.12, -0.045, yC - recH / 2 - p.magLen / 2 + 0.02, magZ - 0.02, dark);
  } else if (p.mag === 'short') {
    box(0.03, p.magLen, 0.07, 0, yC - recH / 2 - p.magLen / 2 + 0.01, magZ, dark);
  }
  // under-barrel grip
  if (att.grip === 'vertical' && p.hand > 0) {
    cyl(0.015, 0.09, 0, yC - recH / 2 - 0.045, recFront - p.hand * 0.55, dark, 'y');
  } else if (att.grip === 'angled' && p.hand > 0) {
    box(0.028, 0.04, 0.08, 0, yC - recH / 2 - 0.016, recFront - p.hand * 0.4, dark, 0.55);
  }
  // bipod (folded)
  if (w.bipod && w.category !== 'DMR') {
    box(0.01, 0.01, 0.16, 0.015, yC - recH / 2 - 0.006, front + 0.1, dark);
    box(0.01, 0.01, 0.16, -0.015, yC - recH / 2 - 0.006, front + 0.1, dark);
  }
  // optic
  const oy = yC + recH / 2 + 0.012;
  const oz = bull ? 0.0 : recFront + recLen * 0.55;
  const optic = att.optic || 'iron';
  if (optic === 'reddot') {
    box(0.032, 0.012, 0.04, 0, oy + 0.006, oz, dark);
    cyl(0.017, 0.035, 0, oy + 0.03, oz, dark, 'z');
    cyl(0.013, 0.002, 0, oy + 0.03, oz - 0.0185, glass, 'z');
  } else if (optic === 'holo') {
    box(0.045, 0.016, 0.075, 0, oy + 0.008, oz, dark);
    box(0.045, 0.04, 0.006, 0, oy + 0.035, oz - 0.03, dark);
    box(0.045, 0.04, 0.006, 0, oy + 0.035, oz + 0.025, dark);
    box(0.006, 0.04, 0.06, 0.02, oy + 0.035, oz, dark);
    box(0.006, 0.04, 0.06, -0.02, oy + 0.035, oz, dark);
    box(0.034, 0.03, 0.002, 0, oy + 0.036, oz - 0.026, glass);
  } else if (optic === 'acog' || optic === 'pso') {
    const x = optic === 'pso' ? -0.035 : 0;
    box(0.03, 0.02, 0.07, x * 0.5, oy + 0.01, oz, dark);
    cyl(0.02, 0.15, x, oy + 0.04, oz, dark, 'z');
    cyl(0.022, 0.03, x, oy + 0.04, oz - 0.075, dark, 'z', 0.019);
    cyl(0.017, 0.002, x, oy + 0.04, oz - 0.091, glass, 'z');
  } else if (optic === 'scope8') {
    box(0.03, 0.022, 0.03, 0, oy + 0.011, oz - 0.05, dark);
    box(0.03, 0.022, 0.03, 0, oy + 0.011, oz + 0.07, dark);
    cyl(0.016, 0.24, 0, oy + 0.045, oz + 0.01, dark, 'z');
    cyl(0.028, 0.07, 0, oy + 0.045, oz - 0.14, dark, 'z', 0.017);
    cyl(0.022, 0.05, 0, oy + 0.045, oz + 0.15, dark, 'z');
    cyl(0.018, 0.035, 0, oy + 0.072, oz + 0.01, metal, 'y');
    cyl(0.026, 0.002, 0, oy + 0.045, oz - 0.176, glass, 'z');
  }
  return root;
}
