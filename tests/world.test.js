import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, MAP_IDS } from '../shared/world.js';
import { dsin, dcos, datan2 } from '../shared/dmath.js';

test('deterministic trig matches Math within tolerance', () => {
  for (let i = 0; i < 2000; i++) {
    const a = (i - 1000) * 0.0173;
    assert.ok(Math.abs(dsin(a) - Math.sin(a)) < 1e-9);
    assert.ok(Math.abs(dcos(a) - Math.cos(a)) < 1e-9);
    const y = Math.sin(i * 1.3) * 7, x = Math.cos(i * 0.7) * 5;
    assert.ok(Math.abs(datan2(y, x) - Math.atan2(y, x)) < 1e-9);
  }
});

for (const id of MAP_IDS) {
  test(`map ${id} generates deterministically`, () => {
    const a = new World(id, { vegetation: false });
    const b = new World(id, { vegetation: false });
    assert.equal(a.checksum(), b.checksum());
    assert.ok(a.trees.length > 50 || id === 'ridge');
    assert.ok(a.structures.length > 20);
    assert.ok(a.spawns.length >= 16, 'enough spawn points');
    // Every spawn is on walkable ground inside the play area.
    for (const s of a.spawns) {
      assert.ok(a.inPlayArea(s.x, s.z), 'spawn inside play area');
      assert.ok(Number.isFinite(s.y));
    }
  });
}

test('terrain heightAt matches grid vertices and interpolates', () => {
  const w = new World('valley', { vegetation: false });
  const t = w.terrain;
  for (const [ix, iz] of [[10, 10], [400, 400], [123, 456]]) {
    const x = -t.half + ix * t.cell, z = -t.half + iz * t.cell;
    assert.ok(Math.abs(t.heightAt(x, z) - t.heights[iz * t.n + ix]) < 1e-4);
  }
  // Ray straight down hits the ground at the right distance.
  const h = t.heightAt(12.3, -45.6);
  const d = t.raycast(12.3, h + 50, -45.6, 0, -1, 0, 100);
  assert.ok(Math.abs(d - 50) < 0.05, `raycast distance ${d}`);
});

test('collision raycast hits structures', () => {
  const w = new World('outpost', { vegetation: false });
  const st = w.structures.find((s) => s.type === 'container_stack');
  assert.ok(st, 'outpost has a container stack');
  const y = st.y + 1.2;
  // Shoot from 20 m away toward the container centre.
  const hit = w.collision.raycast(st.x + 20, y, st.z, -1, 0, 0, 40);
  assert.ok(hit && hit.t < 20, 'ray blocked by the container');
});
