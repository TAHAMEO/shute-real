import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/room.js';
import { computeDamage, HIT_ZONES, WEAPONS, WEAPON_INDEX, sanitizeLoadout, defaultLoadout } from '../shared/weapons.js';

function makeRoom(opts = {}) {
  const room = new GameRoom({ mapId: 'outpost', mode: 'ffa', bots: 0, seed: 7, ...opts });
  const inbox = new Map();
  room.transport = { send(cid, m) { if (!inbox.has(cid)) inbox.set(cid, []); inbox.get(cid).push(m); } };
  return { room, inbox };
}

test('damage model', () => {
  const m4 = WEAPONS.m4a1;
  assert.equal(computeDamage(m4, 10, HIT_ZONES.TORSO), m4.damage[0]);
  assert.equal(computeDamage(m4, 10, HIT_ZONES.HEAD), m4.damage[0] * m4.headMult);
  assert.ok(computeDamage(m4, 500, HIT_ZONES.TORSO) === m4.damage[1]);
  assert.ok(computeDamage('awm', 50, HIT_ZONES.TORSO) >= 100, 'AWM one-shots the chest');
});

test('sanitizeLoadout rejects invalid data', () => {
  const lo = sanitizeLoadout({ primary: 'glock18', secondary: 'awm', primaryAtt: { optic: 'scope8' } });
  assert.equal(lo.primary, defaultLoadout().primary);
  assert.equal(lo.secondary, defaultLoadout().secondary);
  const ok = sanitizeLoadout({ primary: 'm24', primaryAtt: { optic: 'acog', muzzle: 'suppressor' } });
  assert.equal(ok.primaryAtt.optic, 'acog');
  assert.equal(ok.primaryAtt.muzzle, 'suppressor');
});

test('players join, shoot and score', () => {
  const { room, inbox } = makeRoom();
  const a = room.join('A', { name: 'Alpha' });
  const b = room.join('B', { name: 'Bravo' });
  assert.ok(inbox.get('A').some((m) => m.t === 'welcome'));
  room.receive('A', { t: 'deploy' });
  room.receive('B', { t: 'deploy' });
  room.tick(1 / 30);
  assert.ok(a.alive && b.alive);
  // Expire spawn protection.
  for (let i = 0; i < 90; i++) room.tick(1 / 30);
  // Alpha fires rifle rounds at Bravo's chest until he drops (at most 8).
  const w = WEAPON_INDEX.m4a1;
  for (let i = 0; i < 8 && b.alive; i++) {
    room.receive('A', { t: 'fire', w, o: [a.body.x, a.body.y + 1.6, a.body.z], d: [[1, 0, 0]] });
    room.receive('A', { t: 'hit', v: b.id, z: HIT_ZONES.TORSO, dist: Math.hypot(a.body.x - b.body.x, a.body.z - b.body.z), w });
    room.tick(0.1);
  }
  assert.equal(b.alive, false, 'Bravo died');
  assert.equal(a.kills, 1);
  assert.equal(b.deaths, 1);
  assert.ok(inbox.get('B').some((m) => m.t === 'kill' && m.v === b.id));
});

test('hit validation rejects hits without shots', () => {
  const { room } = makeRoom();
  const a = room.join('A', { name: 'Alpha' });
  const b = room.join('B', { name: 'Bravo' });
  room.receive('A', { t: 'deploy' });
  room.receive('B', { t: 'deploy' });
  for (let i = 0; i < 90; i++) room.tick(1 / 30);
  room.receive('A', { t: 'hit', v: b.id, z: 0, dist: 10, w: WEAPON_INDEX.m4a1 });
  assert.equal(b.hp, 100, 'no damage without a fire message');
  void a;
});

test('bots fight each other in team deathmatch', () => {
  const { room } = makeRoom({ mode: 'tdm', bots: 8, maxPlayers: 8, mapId: 'outpost' });
  let kills = 0;
  const orig = room.broadcast.bind(room);
  room.broadcast = (m, ex) => { if (m.t === 'kill') kills++; orig(m, ex); };
  for (let i = 0; i < 30 * 90; i++) room.tick(1 / 30);
  assert.ok(kills > 0, 'bots scored kills in 90 s');
  assert.ok(room.teamScores[0] + room.teamScores[1] > 0);
});
