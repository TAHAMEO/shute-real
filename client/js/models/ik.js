// Small allocation-free IK / rotation helpers used by the procedural soldier rigs.
//
// Bone frame convention used throughout the soldier rigs: a limb bone points along its local −Y
// axis (from its joint toward the child joint), +X is the hinge axis of the joint at its child
// (elbow / knee / finger knuckle) and −Z is the "front" (palm side for arms, shin front for legs).
import * as THREE from 'three';

const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/** Any unit vector perpendicular to `v` (v must be normalized). */
export function anyPerpendicular(v, out) {
  if (Math.abs(v.y) < 0.9) out.set(v.z, 0, -v.x);
  else out.set(0, -v.z, v.y);
  return out.normalize();
}

/**
 * Analytic two-bone IK: positions the middle joint of a chain root→mid→end with segment lengths
 * l1, l2 so that the end reaches `target` (clamped to the reachable range), bending toward `pole`.
 * @param {THREE.Vector3} root chain root joint position
 * @param {THREE.Vector3} target desired end position
 * @param {THREE.Vector3} pole direction (not point) the middle joint should bend toward
 * @param {number} l1 root→mid length
 * @param {number} l2 mid→end length
 * @param {THREE.Vector3} outMid receives the middle joint position
 * @param {THREE.Vector3} outEnd receives the reached end position (== target when reachable)
 * @returns {number} how far (m) the target was beyond reach (0 when reachable)
 */
export function solveTwoBone(root, target, pole, l1, l2, outMid, outEnd) {
  _d.subVectors(target, root);
  let dist = _d.length();
  if (dist < 1e-6) { _d.set(0, -1, 0); dist = 1e-6; } else _d.multiplyScalar(1 / dist);
  const maxR = (l1 + l2) * 0.9995;
  const minR = Math.abs(l1 - l2) + 1e-3;
  const over = Math.max(0, dist - maxR);
  const r = Math.min(Math.max(dist, minR), maxR);
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-10) anyPerpendicular(_d, _p); else _p.normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + r * r - l2 * l2) / (2 * l1 * r), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  outMid.copy(root).addScaledVector(_d, l1 * cosA).addScaledVector(_p, l1 * sinA);
  outEnd.copy(root).addScaledVector(_d, r);
  return over;
}

/**
 * Rotation (in the space of the inputs) whose local −Y axis points along `dir` and whose local +Z
 * axis is as close as possible to `zHint`.
 * @param {THREE.Vector3} dir bone direction (need not be normalized)
 * @param {THREE.Vector3} zHint desired local +Z direction
 * @param {THREE.Quaternion} out
 */
export function boneLookRotation(dir, zHint, out) {
  _y.copy(dir).normalize().negate();
  _z.copy(zHint).addScaledVector(_y, -zHint.dot(_y));
  if (_z.lengthSq() < 1e-10) anyPerpendicular(_y, _z); else _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/**
 * Rotation from two directions: local −Y → `fingers`, local −Z → `palm` (orthogonalized, fingers win).
 * Used to express hand orientations.
 */
export function handRotation(fingers, palm, out) {
  _y.copy(fingers).normalize().negate();
  _z.copy(palm).negate();
  _z.addScaledVector(_y, -_z.dot(_y));
  if (_z.lengthSq() < 1e-10) anyPerpendicular(_y, _z); else _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/**
 * Computes the two bone rotations of a solved chain (positions from solveTwoBone) with a consistent
 * hinge axis (local +X of both bones), so the lower joint is a pure hinge.
 * @param {THREE.Vector3} root
 * @param {THREE.Vector3} mid
 * @param {THREE.Vector3} end
 * @param {THREE.Vector3} pole same pole used for the solve (used when the chain is straight)
 * @param {number} zSign +1 when the upper bone's local +Z faces the pole (elbows), −1 for knees
 * @param {THREE.Quaternion} outUpper rotation of the upper bone
 * @param {THREE.Quaternion} outLower rotation of the lower bone
 */
export function chainRotations(root, mid, end, pole, zSign, outUpper, outLower) {
  _u.subVectors(mid, root).normalize();
  _w.subVectors(end, mid).normalize();
  // upper bone: Y = −u, Z toward (sign) pole, perpendicular to u
  _y.copy(_u).negate();
  _z.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_z.lengthSq() < 1e-10) {
    // fall back to the bend direction of the lower bone
    _z.copy(_w).addScaledVector(_u, -_w.dot(_u)).multiplyScalar(-zSign);
    if (_z.lengthSq() < 1e-10) anyPerpendicular(_y, _z);
  }
  _z.normalize().multiplyScalar(zSign);
  _x.crossVectors(_y, _z).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  outUpper.setFromRotationMatrix(_m);
  // lower bone shares the hinge axis X
  _y.copy(_w).negate();
  _y.addScaledVector(_x, -_y.dot(_x)).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  outLower.setFromRotationMatrix(_m);
}

/**
 * Swing-twist decomposition: extracts the twist of `q` around the (unit) `axis` into `outTwist`.
 * q = swing * twist.
 */
export function twistAround(q, axis, outTwist) {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  outTwist.set(axis.x * d, axis.y * d, axis.z * d, q.w);
  const len = Math.hypot(outTwist.x, outTwist.y, outTwist.z, outTwist.w);
  if (len < 1e-9) outTwist.identity(); else outTwist.set(outTwist.x / len, outTwist.y / len, outTwist.z / len, outTwist.w / len);
  return outTwist;
}

/** out = inverse(parent) * world  (local rotation from a world/parent-space rotation). */
export function toLocalRotation(parentRot, worldRot, out) {
  _q.copy(parentRot).invert();
  return out.multiplyQuaternions(_q, worldRot);
}
