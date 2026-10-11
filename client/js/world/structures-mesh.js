// Builds merged, textured meshes for all structures from the shared part lists
// (the same parts that generate the colliders), batched by material and spatial cell.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STRUCTURE_RECIPES } from './surface-recipes.js';

const CELL = 160;

const MAT_DEFS = {
  wood: { recipe: 'wood' },
  wood_dark: { recipe: 'wood_dark' },
  plank_grey: { recipe: 'plank_grey' },
  wood_floor: { recipe: 'wood_floor' },
  wood_beam: { recipe: 'wood_beam' },
  corrugated: { recipe: 'corrugated', metalness: 0.55 },
  corrugated_rust: { recipe: 'corrugated_rust', metalness: 0.35 },
  concrete: { recipe: 'concrete' },
  concrete_dark: { recipe: 'concrete_dark' },
  plaster: { recipe: 'plaster' },
  plaster_white: { recipe: 'plaster_white' },
  stone: { recipe: 'stone' },
  brick: { recipe: 'brick' },
  container_red: { recipe: 'container', color: '#a0372a', metalness: 0.35 },
  container_blue: { recipe: 'container', color: '#2f5683', metalness: 0.35 },
  container_green: { recipe: 'container', color: '#46613d', metalness: 0.35 },
  container_tan: { recipe: 'container', color: '#a88a5c', metalness: 0.35 },
  metal_rust: { recipe: 'metal_rust', metalness: 0.3 },
  metal_dark: { recipe: 'metal_dark', metalness: 0.5 },
  black_metal: { recipe: 'metal_dark', color: '#5a5a5a', metalness: 0.4 },
  steel: { recipe: 'steel', metalness: 0.7 },
  barrel_blue: { recipe: 'container', color: '#2c4f86', metalness: 0.4 },
  barrel_red: { recipe: 'container', color: '#9b2a20', metalness: 0.4 },
  barrel_green: { recipe: 'container', color: '#4c5d34', metalness: 0.4 },
  sandbag: { recipe: 'sandbag' },
  hay: { recipe: 'hay' },
  tarp: { recipe: 'tarp' },
  tarp_tan: { recipe: 'tarp', color: '#d9c49a' },
  glass: { special: 'glass' },
  red_light: { special: 'light' },
  red_glow: { special: 'light' },
  chainlink: { special: 'chainlink' },
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Assign planar UVs (meters / tile) from structure-local positions so textures flow across segments. */
function applyPlanarUV(geo, tile) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const t = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i);
    let u, v;
    if (Math.abs(_n.y) > 0.6) {
      u = _p.x; v = _p.z;
    } else {
      t.crossVectors(UP, _n).normalize();
      u = _p.dot(t); v = _p.y;
    }
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function gableGeometry(w, h, d) {
  // Triangle in XY (base w at -h/2, apex at +h/2), extruded along Z by d.
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -h / 2);
  shape.lineTo(w / 2, -h / 2);
  shape.lineTo(0, h / 2);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

function frustumGeometry(w, h, d, top) {
  const g = new THREE.CylinderGeometry(Math.SQRT1_2 * top, Math.SQRT1_2, 1, 4, 1, false, Math.PI / 4);
  g.scale(w, h, d);
  return g.toNonIndexed();
}

function sandbagsGeometry(w, h, d) {
  const bag = new THREE.SphereGeometry(1, 7, 5);
  bag.scale(0.3, 0.1, 0.17);
  const parts = [];
  const rows = Math.max(1, Math.round(h / 0.17));
  const rowH = h / rows;
  const deep = Math.max(1, Math.round(d / 0.36));
  const cols = Math.max(1, Math.round(w / 0.56));
  let seed = Math.floor(w * 13 + h * 7 + d * 3);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? 0.28 : 0;
    for (let k = 0; k < deep; k++) {
      for (let c = 0; c < cols + (off ? 0 : 0); c++) {
        let x = -w / 2 + (c + 0.5) * (w / cols) + off * (c === cols - 1 ? -0.5 : 0.5) * 0.5;
        const z = -d / 2 + (k + 0.5) * (d / deep);
        const y = -h / 2 + (r + 0.5) * rowH;
        const b = bag.clone();
        b.rotateY((rnd() - 0.5) * 0.15);
        b.scale(w / cols / 0.56, rowH / 0.17 * 0.95, d / deep / 0.36);
        b.translate(x, y, z);
        parts.push(b);
      }
    }
  }
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  bag.dispose();
  return g;
}

function beam(a, b, t) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.BoxGeometry(t, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

function latticeGeometry(w, h, d, top = 0.25) {
  const parts = [];
  const levels = Math.max(2, Math.round(h / 4));
  const half = (y) => (w / 2) * (1 - (1 - top) * ((y + h / 2) / h));
  const corner = (y, sx, sz) => new THREE.Vector3(sx * half(y), y, sz * half(y));
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) parts.push(beam(corner(-h / 2, sx, sz), corner(h / 2, sx, sz), 0.16));
  for (let l = 0; l < levels; l++) {
    const y0 = -h / 2 + (l / levels) * h, y1 = -h / 2 + ((l + 1) / levels) * h;
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c], [bx, bz] = corners[(c + 1) % 4];
      parts.push(beam(corner(y0, ax, az), corner(y1, bx, bz), 0.07));
      parts.push(beam(corner(y0, bx, bz), corner(y1, ax, az), 0.07));
      parts.push(beam(corner(y1, ax, az), corner(y1, bx, bz), 0.08));
    }
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  parts.forEach((p) => p.dispose());
  return g;
}

function jerseyGeometry(w, h, d) {
  const s = new THREE.Shape();
  s.moveTo(-d / 2, -h / 2);
  s.lineTo(d / 2, -h / 2);
  s.lineTo(d / 2 * 0.8, -h / 2 + h * 0.18);
  s.lineTo(d / 4, h / 2);
  s.lineTo(-d / 4, h / 2);
  s.lineTo(-d / 2 * 0.8, -h / 2 + h * 0.18);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

function crateGeometry(w, h, d) {
  const parts = [new THREE.BoxGeometry(w * 0.96, h * 0.96, d * 0.96)];
  const t = Math.min(w, h, d) * 0.09;
  // Edge battens.
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const b = new THREE.BoxGeometry(w, t, t); b.translate(0, sy * (h / 2 - t / 2), sz * (d / 2 - t / 2)); parts.push(b);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const b = new THREE.BoxGeometry(t, h, t); b.translate(sx * (w / 2 - t / 2), 0, sz * (d / 2 - t / 2)); parts.push(b);
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const b = new THREE.BoxGeometry(t, t, d); b.translate(sx * (w / 2 - t / 2), sy * (h / 2 - t / 2), 0); parts.push(b);
  }
  // Diagonal braces on two faces.
  const diag = Math.hypot(w, h) * 0.92;
  for (const sz of [-1, 1]) {
    const b = new THREE.BoxGeometry(diag, t * 0.9, t * 0.6);
    b.rotateZ(Math.atan2(h, w) * (sz > 0 ? 1 : -1));
    b.translate(0, 0, sz * (d / 2));
    parts.push(b);
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  parts.forEach((p) => p.dispose());
  return g;
}

function partGeometry(p) {
  switch (p.shape) {
    case 'gable': return gableGeometry(p.w, p.h, p.d);
    case 'cyl': return new THREE.CylinderGeometry(p.w / 2, p.w / 2, p.h, 16, 1);
    case 'cylx': {
      const g = new THREE.CylinderGeometry(p.h / 2, p.h / 2, p.w, 16, 1);
      g.rotateZ(Math.PI / 2);
      if (p.d !== p.h) g.scale(1, 1, p.d / p.h);
      return g;
    }
    case 'sphere': return new THREE.SphereGeometry(p.w / 2, 12, 8);
    case 'sandbags': return sandbagsGeometry(p.w, p.h, p.d);
    case 'lattice': return latticeGeometry(p.w, p.h, p.d, p.top ?? 0.25);
    case 'frustum': return frustumGeometry(p.w, p.h, p.d, p.top ?? 0.5);
    case 'dish': {
      const g = new THREE.SphereGeometry(p.w / 2, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.35);
      g.rotateX(Math.PI / 2);
      return g;
    }
    default:
      if (p.detail === 'jersey') return jerseyGeometry(p.w, p.h, p.d);
      if (p.detail === 'crate') return crateGeometry(p.w, p.h, p.d);
      return new THREE.BoxGeometry(p.w, p.h, p.d);
  }
}

function chainlinkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(160,165,170,1)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 32); g.lineTo(32, 0); g.lineTo(64, 32); g.lineTo(32, 64); g.closePath();
  g.moveTo(-32, 32); g.lineTo(0, 64);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class StructureMeshes {
  /**
   * @param {import('/shared/world.js').World} world
   * @param {import('../engine/texture-baker.js').TextureBaker} baker
   */
  constructor(world, baker) {
    this.world = world;
    this.baker = baker;
    this.group = new THREE.Group();
    this.group.name = 'structures';
    this.materials = new Map();
    this.lights = [];
    this.time = 0;
    this._build();
  }

  material(tag) {
    if (this.materials.has(tag)) return this.materials.get(tag);
    const def = MAT_DEFS[tag] || MAT_DEFS.concrete;
    let mat;
    if (def.special === 'light') {
      mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 0.25, 0.15) });
    } else if (def.special === 'glass') {
      mat = new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.45 });
    } else if (def.special === 'chainlink') {
      mat = new THREE.MeshStandardMaterial({ map: chainlinkTexture(), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
    } else {
      const recipe = STRUCTURE_RECIPES[def.recipe];
      const tex = this.baker.bake(recipe);
      mat = new THREE.MeshStandardMaterial({
        map: tex.map, normalMap: tex.normalMap, color: new THREE.Color(def.color || '#ffffff'),
        roughness: 1, metalness: def.metalness || 0,
      });
      mat.normalScale.set(1, 1);
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          'float roughnessFactor = roughness * texture2D( map, vMapUv ).a;',
        );
      };
      mat.customProgramCacheKey = () => 'structure-rough-a';
    }
    mat.name = 'struct-' + tag;
    this.materials.set(tag, mat);
    return mat;
  }

  _build() {
    const buckets = new Map(); // key cell|tag -> geometries
    const world = this.world;
    for (const st of world.structures) {
      const cosR = Math.cos(st.rot), sinR = Math.sin(st.rot);
      for (const p of st.parts) {
        if (p.visible === false || p.mat === 'invisible') continue;
        const tag = p.mat === 'red_light' && p.light === 'glow' ? 'red_glow' : p.mat;
        const def = MAT_DEFS[tag] || MAT_DEFS.concrete;
        let g = partGeometry(p);
        if (g.index) g = g.toNonIndexed();
        // Part transform in structure-local space.
        _e.set(p.rx || 0, p.ry || 0, p.rz || 0, 'YXZ');
        _q.setFromEuler(_e);
        _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(1, 1, 1));
        g.applyMatrix4(_m);
        if (!def.special) {
          const tile = STRUCTURE_RECIPES[def.recipe]?.tile || 2;
          applyPlanarUV(g, tile);
        } else if (def.special === 'chainlink') {
          applyPlanarUV(g, 0.12);
        } else if (!g.attributes.uv) {
          g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        }
        // Structure transform to world.
        _e.set(0, st.rot, 0, 'YXZ');
        _q.setFromEuler(_e);
        _m.compose(_p.set(st.x, st.y, st.z), _q, _s.set(1, 1, 1));
        g.applyMatrix4(_m);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        const wx = st.x + p.x * cosR + p.z * sinR, wz = st.z - p.x * sinR + p.z * cosR;
        const cell = Math.floor(wx / CELL) + ',' + Math.floor(wz / CELL);
        const key = cell + '|' + tag;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(g);
        if (p.light) this.lights.push({ x: wx, y: st.y + p.y, z: wz, kind: p.light });
      }
    }
    let draws = 0, tris = 0;
    for (const [key, geos] of buckets) {
      const tag = key.split('|')[1];
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.material(tag));
      const special = (MAT_DEFS[tag] || {}).special;
      mesh.castShadow = special !== 'light' && special !== 'glass';
      mesh.receiveShadow = special !== 'light';
      mesh.matrixAutoUpdate = false;
      mesh.name = 'structures-' + key;
      this.group.add(mesh);
      draws++;
      tris += merged.attributes.position.count / 3;
    }
    this.stats = { draws, triangles: Math.round(tris) };
    // A couple of real lights for the big glowing features.
    for (const l of this.lights) {
      if (l.kind === 'glow' && !this._glowLight) {
        const pl = new THREE.PointLight(0xff2a1a, 60, 90, 1.6);
        pl.position.set(l.x, l.y, l.z);
        this.group.add(pl);
        this._glowLight = pl;
      }
    }
  }

  update(dt) {
    this.time += dt;
    const m = this.materials.get('red_light');
    if (m) {
      const blink = (Math.sin(this.time * 3.2) > 0.2 ? 1 : 0.08);
      m.color.setRGB(9 * blink + 0.6, 0.25 * blink, 0.15 * blink);
    }
    const g = this.materials.get('red_glow');
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 1.3);
    if (g) g.color.setRGB(14 * pulse, 0.5 * pulse, 0.3 * pulse);
    if (this._glowLight) this._glowLight.intensity = 50 * pulse;
  }

  dispose() {
    this.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    for (const m of this.materials.values()) { m.map?.dispose?.(); m.dispose(); }
  }
}
