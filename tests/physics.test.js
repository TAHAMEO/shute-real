import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/world.js';
import { createBody, stepBody } from '../shared/physics.js';
import { createHitboxes, updateHitboxes, rayHitboxes } from '../shared/hitboxes.js';
import { HIT_ZONES } from '../shared/weapons.js';

const world = new World('valley', { vegetation: false });

function bodyAt(x, z) {
  const b = createBody(x, 0, z);
  b.y = world.collision.groundHeight(x, z, 1e4, 0.3);
  return b;
}

test('standing still stays on the ground', () => {
  const s = world.spawns[0];
  const b = bodyAt(s.x, s.z);
  const y0 = b.y;
  for (let i = 0; i < 120; i++) stepBody(world, b, { fwd: 0, right: 0, yaw: 0, stance: 0 }, 1 / 60);
  assert.ok(Math.abs(b.y - y0) < 0.05, `drifted ${b.y - y0}`);
  assert.ok(b.onGround);
});

test('walking forward moves about walk speed', () => {
  const s = world.spawns[1];
  const b = bodyAt(s.x, s.z);
  const x0 = b.x, z0 = b.z;
  for (let i = 0; i < 120; i++) stepBody(world, b, { fwd: 1, right: 0, yaw: s.yaw, stance: 0 }, 1 / 60);
  const d = Math.hypot(b.x - x0, b.z - z0);
  assert.ok(d > 6 && d < 10.5, `moved ${d.toFixed(2)} m in 2 s`);
});

test('cannot walk through a wall', () => {
  const house = world.structures.find((s) => s.type === 'house_plaster');
  // Start 3 m outside the back wall and push toward it for 3 s.
  const c = Math.cos(house.rot), sn = Math.sin(house.rot);
  const back = -(house.hd + 2.5);
  const x = house.x + back * sn, z = house.z + back * c;
  const b = bodyAt(x, z);
  const yaw = Math.atan2(-(house.x - x), -(house.z - z));
  for (let i = 0; i < 180; i++) stepBody(world, b, { fwd: 1, right: 0, yaw, stance: 0 }, 1 / 60);
  const lx = (b.x - house.x) * c - (b.z - house.z) * sn;
  const lz = (b.x - house.x) * sn + (b.z - house.z) * c;
  void lx;
  assert.ok(lz < -2.6, `ended at local z ${lz.toFixed(2)} (should stay outside the wall)`);
});

test('jumping leaves and returns to the ground', () => {
  const s = world.spawns[2];
  const b = bodyAt(s.x, s.z);
  let maxY = b.y;
  stepBody(world, b, { jump: true, yaw: 0, stance: 0 }, 1 / 60);
  for (let i = 0; i < 120; i++) {
    stepBody(world, b, { yaw: 0, stance: 0 }, 1 / 60);
    maxY = Math.max(maxY, b.y);
  }
  assert.ok(maxY - world.collision.groundHeight(s.x, s.z, 1e4, 0.3) > 0.6, 'jump height');
  assert.ok(b.onGround, 'landed');
});

test('hitbox zones', () => {
  const h = createHitboxes();
  updateHitboxes(h, 0, 0, 0, 0, 0, 0);
  const head = rayHitboxes(h, 0, 1.62, 10, 0, 0, -1, 100);
  assert.equal(head.zone, HIT_ZONES.HEAD);
  const chest = rayHitboxes(h, 0, 1.25, 10, 0, 0, -1, 100);
  assert.equal(chest.zone, HIT_ZONES.TORSO);
  const legs = rayHitboxes(h, 0, 0.4, 10, 0, 0, -1, 100);
  assert.equal(legs.zone, HIT_ZONES.LIMB);
  const miss = rayHitboxes(h, 2, 1.0, 10, 0, 0, -1, 100);
  assert.equal(miss, null);
});
