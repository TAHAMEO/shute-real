// Procedural 3D weapon + equipment models (Three.js r186, WebGLRenderer).
//
// buildWeaponModel(id, attachments, { lod }) -> WeaponModel
//   root: THREE.Group whose origin is the right-hand grip point (web of the hand on the pistol grip),
//         bore axis parallel to -Z, +Y up, +X = weapon's right side. Units: metres.
//   anchors: muzzle, eject (+X = ejection direction), sight (ADS eye point), rightHand, leftHand,
//            magazine (group), bolt (group), cylinder (group), lens (PiP mesh), reticle (red dot mesh)
//   info: { weaponId, optic, muzzle, grip, lensRadius, length, sightHeight, triangles }
//   dispose(): frees per-instance materials (lens/reticle clones) only.
// Each (weapon, attachments, lod) is built once and cached; calls return clones that share
// geometry and materials (lens/reticle materials are cloned per instance).
import * as THREE from 'three';
import { WEAPONS } from '/shared/weapons.js';
import { initWeaponMaterials, getReticleTexture } from './weapon-materials.js';
import { Builder, QUALITY } from './weapon-parts.js';
import { AR_BUILDERS } from './weapons/rifles-ar.js';
import { AK_BUILDERS } from './weapons/rifles-ak.js';
import { BULLPUP_BUILDERS } from './weapons/bullpups.js';
import { SMG_BUILDERS } from './weapons/smgs.js';
import { HEAVY_BUILDERS } from './weapons/heavy.js';
import { SHOTGUN_BUILDERS } from './weapons/shotguns.js';
import { PISTOL_BUILDERS } from './weapons/pistols.js';
import { EQUIPMENT_BUILDERS } from './weapons/equipment.js';

const BUILDERS = {
  ...AR_BUILDERS, ...AK_BUILDERS, ...BULLPUP_BUILDERS, ...SMG_BUILDERS,
  ...HEAVY_BUILDERS, ...SHOTGUN_BUILDERS, ...PISTOL_BUILDERS,
};

const TEMPLATES = new Map();
const ANCHOR_NAMES = ['muzzle', 'eject', 'sight', 'rightHand', 'leftHand'];

/** Build shared materials/textures up front (idempotent). */
export function preloadWeaponAssets() {
  initWeaponMaterials();
  getReticleTexture('reddot');
  getReticleTexture('holo');
}

/** Resolve attachments against what the weapon allows (missing/invalid -> weapon default). */
export function resolveAttachments(weaponId, attachments = {}) {
  const w = WEAPONS[weaponId];
  if (!w) throw new Error(`unknown weapon '${weaponId}'`);
  const a = attachments || {};
  const pick = (v, list, def) => (typeof v === 'string' && list.includes(v) ? v : def);
  return {
    optic: pick(a.optic, w.optics, w.defaultOptic),
    muzzle: pick(a.muzzle, w.muzzles, w.defaultMuzzle),
    grip: pick(a.grip, w.grips, w.defaultGrip),
  };
}

function countTriangles(root) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });
  return Math.round(n);
}

function finishTemplate(b, id, extra) {
  const root = b.build();
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (o.isMesh && o.name !== 'reticle') {
      o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    }
  });
  const info = {
    weaponId: id,
    ...extra,
    lensRadius: b.meta.lensRadius || 0,
    length: box.isEmpty() ? 0 : +(box.max.z - box.min.z).toFixed(4),
    sightHeight: +(b.meta.sightY ?? 0).toFixed(4),
    triangles: countTriangles(root),
  };
  return { root, info };
}

function instantiate(tpl) {
  const root = tpl.root.clone(true);
  const owned = [];
  root.traverse((o) => {
    if (o.isMesh && (o.name === 'lens' || o.name === 'reticle')) {
      o.material = o.material.clone();
      owned.push(o.material);
    }
  });
  const find = (n) => root.getObjectByName(n) || null;
  const anchors = {};
  for (const n of ANCHOR_NAMES) anchors[n] = find(`anchor:${n}`);
  anchors.magazine = find('magazine');
  anchors.bolt = find('bolt');
  anchors.cylinder = find('cylinder');
  anchors.lens = find('lens');
  anchors.reticle = find('reticle');
  return {
    root,
    anchors,
    info: { ...tpl.info },
    dispose() {
      for (const m of owned) m.dispose();
      owned.length = 0;
    },
  };
}

/**
 * Build (or clone from cache) a weapon model.
 * @param {string} weaponId id from /shared/weapons.js
 * @param {{optic?:string, muzzle?:string, grip?:string}} [attachments] invalid/missing -> defaults
 * @param {{lod?:'fp'|'tp'}} [options] 'fp' first-person quality (default), 'tp' third-person
 * @returns {{root:THREE.Group, anchors:object, info:object, dispose:Function}}
 */
export function buildWeaponModel(weaponId, attachments = {}, options = {}) {
  const w = WEAPONS[weaponId];
  if (!w || !BUILDERS[weaponId]) throw new Error(`unknown weapon '${weaponId}'`);
  const lod = options && options.lod === 'tp' ? 'tp' : 'fp';
  const att = resolveAttachments(weaponId, attachments);
  const key = `${weaponId}|${att.optic}|${att.muzzle}|${att.grip}|${lod}`;
  let tpl = TEMPLATES.get(key);
  if (!tpl) {
    initWeaponMaterials();
    const b = new Builder(weaponId, QUALITY[lod]);
    BUILDERS[weaponId](b, att, w);
    if (!b.anchors.rightHand) b.anchor('rightHand', b.origin.x, b.origin.y, -b.origin.z);
    tpl = finishTemplate(b, weaponId, { optic: att.optic, muzzle: att.muzzle, grip: att.grip, lod });
    TEMPLATES.set(key, tpl);
  }
  return instantiate(tpl);
}

/**
 * Build (or clone from cache) an equipment model: 'frag' | 'smoke' | 'knife'.
 * Same WeaponModel shape; anchors that do not apply are null.
 */
export function buildEquipmentModel(id, options = {}) {
  if (!EQUIPMENT_BUILDERS[id]) throw new Error(`unknown equipment '${id}'`);
  const lod = options && options.lod === 'tp' ? 'tp' : 'fp';
  const key = `equip:${id}|${lod}`;
  let tpl = TEMPLATES.get(key);
  if (!tpl) {
    initWeaponMaterials();
    const b = new Builder(id, QUALITY[lod]);
    EQUIPMENT_BUILDERS[id](b);
    if (!b.anchors.rightHand) b.anchor('rightHand', b.origin.x, b.origin.y, -b.origin.z);
    tpl = finishTemplate(b, id, { optic: null, muzzle: null, grip: null, lod });
    TEMPLATES.set(key, tpl);
  }
  return instantiate(tpl);
}

/** Ids of all weapons that have a model builder. */
export function listWeaponModels() {
  return Object.keys(BUILDERS);
}
