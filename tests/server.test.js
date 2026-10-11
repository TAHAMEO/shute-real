import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 7899;

test('server serves the game and hosts rooms', async (t) => {
  const srv = spawn(process.execPath, ['server/index.js', '--port', String(PORT)], { stdio: 'ignore' });
  t.after(() => srv.kill());
  // Wait for it to listen.
  let info = null;
  for (let i = 0; i < 60 && !info; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { info = await (await fetch(`http://localhost:${PORT}/api/info`)).json(); } catch { /* not yet */ }
  }
  assert.ok(info, 'server responded');
  assert.equal(info.game, 'SHUTE REAL');
  assert.ok(info.rooms.length >= 1, 'default rooms exist');
  const html = await (await fetch(`http://localhost:${PORT}/`)).text();
  assert.match(html, /SHUTE REAL/);
  const three = await fetch(`http://localhost:${PORT}/vendor/three/build/three.module.js`);
  assert.equal(three.status, 200);
  const traversal = await fetch(`http://localhost:${PORT}/vendor/three/../../package.json`);
  assert.notEqual(traversal.status, 200);

  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  ws.send(JSON.stringify({ t: 'hello', name: 'Tester' }));
  ws.send(JSON.stringify({ t: 'create', config: { name: 'Test Room', mapId: 'ridge', mode: 'ffa', bots: 2 } }));
  for (let i = 0; i < 40 && !msgs.some((m) => m.t === 'created'); i++) await new Promise((r) => setTimeout(r, 100));
  const created = msgs.find((m) => m.t === 'created');
  assert.ok(created, 'room created');
  ws.send(JSON.stringify({ t: 'join', id: created.id, name: 'Tester' }));
  for (let i = 0; i < 40 && !msgs.some((m) => m.t === 'welcome'); i++) await new Promise((r) => setTimeout(r, 100));
  const welcome = msgs.find((m) => m.t === 'welcome');
  assert.ok(welcome, 'joined room');
  assert.equal(welcome.mapId, 'ridge');
  ws.send(JSON.stringify({ t: 'deploy' }));
  for (let i = 0; i < 40 && !msgs.some((m) => m.t === 'spawn' && m.id === welcome.you); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(msgs.some((m) => m.t === 'spawn' && m.id === welcome.you), 'spawned');
  for (let i = 0; i < 20 && !msgs.some((m) => m.t === 'snap'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(msgs.some((m) => m.t === 'snap'), 'receives snapshots');
  ws.close();
});
