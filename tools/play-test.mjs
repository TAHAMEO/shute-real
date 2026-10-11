#!/usr/bin/env node
// End-to-end smoke test: boot the game, start a solo match, simulate input, screenshot.
// Usage: node tools/play-test.mjs [--url http://localhost:7777/] [--map valley] [--mode tdm] [--bots 4]
//        [--out tools/out/play] [--size 1280x720] [--quality low] [--secs 6] [--shots 3]
import fs from 'node:fs';
import { launchBrowser } from './pw.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const url = opt('--url', 'http://localhost:7777/');
const map = opt('--map', 'valley');
const mode = opt('--mode', 'tdm');
const bots = Number(opt('--bots', '4'));
const out = opt('--out', 'tools/out/play');
const [w, h] = opt('--size', '1280x720').split('x').map(Number);
const quality = opt('--quality', 'low');
const secs = Number(opt('--secs', '6'));
const shots = Number(opt('--shots', '3'));
const weapon = opt('--weapon', null);
fs.mkdirSync(out, { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')); });
// Pre-seed settings for the requested quality preset.
await page.addInitScript(([q, wpn]) => {
  try {
    localStorage.setItem('shute-real.gpuWarned', '1');
    const s = JSON.parse(localStorage.getItem('shute-real.settings.v1') || 'null');
    if (!s) localStorage.setItem('shute-real.settings.v1', JSON.stringify({ graphics: { preset: q }, playerName: 'Tester' }));
    if (wpn) localStorage.setItem('shute-real.loadout.v1', JSON.stringify({ primary: wpn }));
  } catch { /* ignore */ }
}, [quality, weapon]);
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__READY === true', null, { timeout: 600000, polling: 500 });
console.log('booted in', Date.now() - t0, 'ms');
// Apply the quality preset through the game (the UI menu may have defaults).
await page.evaluate((q) => {
  const g = window.__GAME;
  import('/js/settings.js').then(({ applyPreset }) => g.applySettings(applyPreset(g.settings, q)));
}, quality);
await page.screenshot({ path: `${out}/0-menu.png`, timeout: 300000 });
console.log('menu screenshot');
await page.evaluate(([mapId, mode, bots]) => window.__GAME.startSolo({ mapId, mode, bots, difficulty: 'normal', timeLimit: 600 }), [map, mode, bots]);
await page.waitForFunction('window.__GAME.state === "playing" && window.__GAME.alive', null, { timeout: 600000, polling: 500 });
console.log('in match after', Date.now() - t0, 'ms');
// Fake pointer lock so controls are active in headless mode.
await page.evaluate(() => { const g = window.__GAME; g.input.locked = true; g.menu.show('none'); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/1-spawn.png`, timeout: 300000 });
console.log('spawn screenshot');
// Walk forward, turn, aim and shoot.
await page.keyboard.down('KeyW');
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => { window.__GAME.input.mouse.dx += 60; });
  await page.waitForTimeout(400);
}
await page.keyboard.up('KeyW');
await page.evaluate(() => { const g = window.__GAME; g.input.mouse.buttons |= 4; });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/2-ads.png`, timeout: 300000 });
console.log('ads screenshot');
for (let i = 0; i < shots; i++) {
  await page.evaluate(() => { const g = window.__GAME; g.input.mouse.buttons |= 1; g.input.mousePressed.add(0); });
  await page.waitForTimeout(120);
  await page.evaluate(() => { const g = window.__GAME; g.input.mouse.buttons &= ~1; });
  await page.waitForTimeout(200);
}
await page.evaluate(() => { const g = window.__GAME; g.input.mouse.buttons |= 1; g.input.mousePressed.add(0); });
await page.waitForTimeout(60);
await page.screenshot({ path: `${out}/3-fire.png`, timeout: 300000 });
await page.evaluate(() => { const g = window.__GAME; g.input.mouse.buttons = 0; });
console.log('fire screenshot');
await page.waitForTimeout(secs * 1000);
// Look at the nearest visible bot for a close-up of the soldier models.
const aimed = await page.evaluate(() => {
  const g = window.__GAME;
  const p = g.player.body;
  let best = null, bd = Infinity;
  for (const r of g.remotes.list) {
    if (!r.alive || !r.model) continue;
    const d = Math.hypot(r.pos.x - p.x, r.pos.z - p.z);
    if (d < bd) { bd = d; best = r; }
  }
  if (!best) return null;
  // Teleport near the bot (8 m away) and face it.
  const dx = best.pos.x - p.x, dz = best.pos.z - p.z, l = Math.hypot(dx, dz) || 1;
  const nx = best.pos.x - dx / l * 8, nz = best.pos.z - dz / l * 8;
  g.player.body.x = nx; g.player.body.z = nz;
  g.player.body.y = g.world.collision.groundHeight(nx, nz, 1e4, 0.3);
  g.player.prev.set(g.player.body.x, g.player.body.y, g.player.body.z);
  g.player.yaw = Math.atan2(-(best.pos.x - nx), -(best.pos.z - nz));
  g.player.pitch = -0.05;
  return { name: best.name, dist: bd.toFixed(0) };
});
console.log('aimed at', JSON.stringify(aimed));
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/5-bot.png`, timeout: 300000 });
const info = await page.evaluate(() => {
  const g = window.__GAME;
  return { state: g.state, alive: g.alive, hp: g.hp, pos: [g.player.body.x, g.player.body.y, g.player.body.z].map((v) => +v.toFixed(1)),
    remotes: g.remotes.list.length, mag: g.weapons.slot?.mag, weapon: g.weapons.slot?.id, fps: g.fps, calls: g.rs.stats.calls, tris: g.rs.stats.triangles,
    kills: [...g.players.values()].map((p) => `${p.name}:${p.kills || 0}/${p.deaths || 0}`).join(' ') };
});
console.log('state', JSON.stringify(info));
await page.keyboard.down('Tab');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/4-scoreboard.png`, timeout: 300000 });
await page.keyboard.up('Tab');
console.log('errors:', errors.length);
await browser.close();
process.exit(errors.length ? 1 : 0);
