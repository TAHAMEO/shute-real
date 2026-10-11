#!/usr/bin/env node
// Multiplayer end-to-end test: real server + browser client + a scripted WebSocket player.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';
import { launchBrowser } from './pw.mjs';

const PORT = 7791;
const out = 'tools/out/mp';
fs.mkdirSync(out, { recursive: true });
const server = spawn(process.execPath, ['server/index.js', '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
server.stderr.on('data', (d) => process.stdout.write('[server-err] ' + d));
const cleanup = () => { try { server.kill(); } catch { /* ignore */ } };
process.on('exit', cleanup);
await new Promise((r) => setTimeout(r, 4000));

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
await page.addInitScript(() => {
  localStorage.setItem('shute-real.gpuWarned', '1');
  localStorage.setItem('shute-real.settings.v1', JSON.stringify({ graphics: { preset: 'low' }, playerName: 'BrowserGuy' }));
});
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction('window.__READY === true', null, { timeout: 600000, polling: 500 });
console.log('page booted');
const rooms = await page.evaluate(async () => {
  const g = window.__GAME;
  for (let i = 0; i < 5 && !(g.lobby && g.lobby.connected); i++) await g.connectLobby(location.origin.replace('http', 'ws') + '/ws');
  return new Promise((resolve) => {
    const off = g.lobby.onMessage((m) => { if (m.t === 'rooms') { off(); resolve(m.rooms); } });
    g.lobby.send({ t: 'list' });
  });
});
console.log('rooms seen by browser:', rooms.map((r) => `${r.id}:${r.name}`).join(', '));
const roomId = rooms.find((r) => r.mode === 'tdm')?.id || rooms[0].id;
await page.evaluate((id) => window.__GAME.joinRoom(id), roomId);
await page.waitForFunction('window.__GAME.state === "playing" && window.__GAME.alive', null, { timeout: 600000, polling: 500 });
const me = await page.evaluate(() => ({ id: window.__GAME.myId, team: window.__GAME.myTeam, pos: window.__GAME.player.body }));
console.log('browser player in room', roomId, 'id', me.id, 'team', me.team);

// Scripted player.
const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
let botId = null;
let hitsSent = 0;
const got = {};
await new Promise((res) => ws.on('open', res));
let myPos = null;
let targetPos = null;
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  got[m.t] = (got[m.t] || 0) + 1;
  if (m.t === 'snap') {
    for (const p of m.p) if (p[0] === me.id) targetPos = [p[1], p[2], p[3]];
  }
  if (m.t === 'welcome') { botId = m.you; ws.send(JSON.stringify({ t: 'deploy' })); }
  if (m.t === 'spawn' && m.id === botId) {
    // Teleport-ish walk next to the browser player, then shoot them.
    let x = m.x, z = m.z;
    const iv = setInterval(() => ws.send(JSON.stringify({ t: 'in', x, y: m.y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, st: 0, ln: 0, w: 0, f: 16 })), 50);
    setTimeout(() => {
      clearInterval(iv);
      for (let i = 0; i < 6; i++) {
        setTimeout(() => {
          ws.send(JSON.stringify({ t: 'fire', w: 0, o: [x, m.y + 1.6, z], d: [[0, 0, -1]] }));
          const dist = targetPos ? Math.hypot(targetPos[0] - x, targetPos[1] - m.y, targetPos[2] - z) : 30;
          ws.send(JSON.stringify({ t: 'hit', v: me.id, z: 1, dist, w: 0, pen: 0 }));
          hitsSent++;
        }, 2600 + i * 250);
      }
    }, 300);
  }
});
ws.send(JSON.stringify({ t: 'hello', name: 'ScriptBot' }));
ws.send(JSON.stringify({ t: 'join', id: roomId, name: 'ScriptBot' }));
await new Promise((r) => setTimeout(r, 7000));
const state = await page.evaluate((bid) => {
  const g = window.__GAME;
  return { hp: g.hp, alive: g.alive, remotes: g.remotes.list.map((r) => r.name), sawScriptBot: g.remotes.list.some((r) => r.id === bid), players: g.players.size };
}, botId);
console.log('browser state:', JSON.stringify(state), 'hits sent', hitsSent, 'ws msgs', JSON.stringify(got));
await page.screenshot({ path: `${out}/mp.png`, timeout: 300000 });
ws.close();
await browser.close();
cleanup();
const ok = state.sawScriptBot && (state.hp < 100 || !state.alive) && errors.length === 0;
console.log(ok ? 'MULTIPLAYER TEST PASSED' : 'MULTIPLAYER TEST FAILED');
process.exit(ok ? 0 : 1);
