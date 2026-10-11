// UI dev harness: renders every menu screen and HUD state with mock data over a painted
// landscape backdrop. Usage: /dev/ui.html?screen=main|solo|multiplayer|create|loadout|settings|
// controls|pause|loading|hud|scoreboard|death|matchend|bigmap
// Extra params: w=<weaponId> (loadout), mode=ffa|tdm, hp=<n>, bg=day|dusk|overcast, nav=1 (screen links),
// anim=1 (live HUD demo + keyboard: Tab, M, T/Y, Esc, F1, K, H, R, C), match=1 (menus in-match),
// tab=graphics|controls|audio|gameplay (settings), oob=1, reload=1, chat=1, ready=1 (death), map=<id>.
import { MenuUI } from '/js/ui/menu.js';
import { HUD } from '/js/ui/hud.js';
import { loadSettings, defaultSettings } from '/js/settings.js';
import { MAPS, MAP_BY_ID } from '/shared/maps.js';
import { WEAPONS, defaultLoadout, defaultAttachments, sanitizeLoadout } from '/shared/weapons.js';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') || 'main';
const MENU_SCREENS = ['main', 'solo', 'multiplayer', 'create', 'loadout', 'settings', 'controls', 'pause'];
const HUD_SCREENS = ['hud', 'scoreboard', 'death', 'matchend', 'bigmap'];
const mode = q.get('mode') === 'ffa' ? 'ffa' : 'tdm';
const DEG = Math.PI / 180;

// ------------------------------------------------------------------ deterministic random
let seed = 1337;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

// ------------------------------------------------------------------ painted backdrop
const PALETTES = {
  day: {
    sky: ['#3f7fc0', '#7fb3df', '#d8e8f0'], sun: [0.78, 0.16, '#ffffff', 'rgba(255,250,225,0.85)'],
    far: '#8ea6b8', mid: '#5f7d58', hill: '#4a6a3c', trees: '#24391f', grass: ['#7e9a43', '#5d7a30', '#45602a'], haze: 'rgba(220,235,245,0.55)',
  },
  dusk: {
    sky: ['#1d2a48', '#7a5a70', '#f0a060'], sun: [0.7, 0.55, '#fff0c8', 'rgba(255,170,80,0.85)'],
    far: '#8a6670', mid: '#5a4248', hill: '#3c2e2c', trees: '#1b1614', grass: ['#5d4a24', '#3e3219', '#261f10'], haze: 'rgba(255,170,110,0.4)',
  },
  overcast: {
    sky: ['#56606a', '#8b939b', '#c3c7cb'], sun: null,
    far: '#7e868e', mid: '#5b6168', hill: '#454b45', trees: '#262b28', grass: ['#5c6450', '#434a3a', '#30352a'], haze: 'rgba(200,205,210,0.5)',
  },
};

function ridge(ctx, W, H, base, amp, color, rough, n = 160) {
  const pts = [];
  const o1 = Array.from({ length: 6 }, () => rnd());
  const o2 = Array.from({ length: 14 }, () => rnd());
  const o3 = Array.from({ length: 40 }, () => rnd());
  const s = (arr, x) => {
    const t = x * (arr.length - 1);
    const i = Math.floor(t);
    const f = t - i;
    const k = f * f * (3 - 2 * f);
    return arr[i] * (1 - k) + arr[Math.min(arr.length - 1, i + 1)] * k;
  };
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    const v = s(o1, x) * 0.6 + s(o2, x) * 0.3 * rough + s(o3, x) * 0.12 * rough;
    pts.push([x * W, H * (base - amp * v)]);
  }
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  return pts;
}

function drawBackdrop(cv, kind) {
  const P = PALETTES[kind] || PALETTES.day;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = (cv.width = Math.round(innerWidth * dpr));
  const H = (cv.height = Math.round(innerHeight * dpr));
  const ctx = cv.getContext('2d');
  seed = 4242;
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.62);
  sky.addColorStop(0, P.sky[0]);
  sky.addColorStop(0.55, P.sky[1]);
  sky.addColorStop(1, P.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  if (P.sun) {
    const [sx, sy, core, glow] = P.sun;
    const g = ctx.createRadialGradient(sx * W, sy * H, 0, sx * W, sy * H, H * 0.75);
    g.addColorStop(0, glow);
    g.addColorStop(0.25, glow.replace(/[\d.]+\)$/, '0.25)'));
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.beginPath();
    ctx.arc(sx * W, sy * H, H * 0.03, 0, Math.PI * 2);
    ctx.fillStyle = core;
    ctx.fill();
  }
  // clouds
  ctx.save();
  ctx.filter = `blur(${Math.round(18 * dpr)}px)`;
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    ctx.ellipse(rnd() * W, H * (0.05 + rnd() * 0.3), W * (0.06 + rnd() * 0.12), H * (0.02 + rnd() * 0.03), 0, 0, Math.PI * 2);
    ctx.fillStyle = kind === 'overcast' ? 'rgba(90,98,108,0.5)' : kind === 'dusk' ? 'rgba(255,190,150,0.35)' : 'rgba(255,255,255,0.55)';
    ctx.fill();
  }
  ctx.restore();
  ridge(ctx, W, H, 0.6, 0.22, P.far, 1);
  const hz = ctx.createLinearGradient(0, H * 0.4, 0, H * 0.62);
  hz.addColorStop(0, 'rgba(0,0,0,0)');
  hz.addColorStop(1, P.haze);
  ctx.fillStyle = hz;
  ctx.fillRect(0, H * 0.4, W, H * 0.25);
  ridge(ctx, W, H, 0.64, 0.1, P.mid, 0.7);
  const hill = ridge(ctx, W, H, 0.7, 0.07, P.hill, 0.5);
  // tree line
  ctx.fillStyle = P.trees;
  for (let i = 0; i < 220; i++) {
    const x = rnd() * W;
    const idx = Math.min(hill.length - 1, Math.round((x / W) * (hill.length - 1)));
    const y = hill[idx][1] + rnd() * H * 0.02;
    const th = H * (0.02 + rnd() * 0.035);
    const tw = th * 0.45;
    ctx.beginPath();
    ctx.moveTo(x, y - th);
    ctx.lineTo(x + tw / 2, y);
    ctx.lineTo(x - tw / 2, y);
    ctx.closePath();
    ctx.fill();
  }
  // field
  const gy = H * 0.74;
  const field = ctx.createLinearGradient(0, gy, 0, H);
  field.addColorStop(0, P.grass[0]);
  field.addColorStop(0.5, P.grass[1]);
  field.addColorStop(1, P.grass[2]);
  ctx.beginPath();
  ctx.moveTo(0, gy + H * 0.02);
  for (let i = 0; i <= 40; i++) ctx.lineTo((i / 40) * W, gy + Math.sin(i * 0.7) * H * 0.008 + H * 0.01);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = field;
  ctx.fill();
  // grass blades
  for (let i = 0; i < 9000; i++) {
    const y = gy + Math.pow(rnd(), 0.7) * (H - gy);
    const depth = (y - gy) / (H - gy);
    const x = rnd() * W;
    const len = (2 + depth * 22) * dpr * (0.5 + rnd());
    ctx.strokeStyle = rnd() < 0.5 ? `rgba(20,30,10,${0.15 + depth * 0.3})` : `rgba(230,240,160,${0.06 + depth * 0.14})`;
    ctx.lineWidth = Math.max(1, depth * 2 * dpr);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * len * 0.5, y - len);
    ctx.stroke();
  }
  // dirt track
  ctx.strokeStyle = kind === 'dusk' ? 'rgba(120,90,60,0.5)' : 'rgba(170,150,110,0.55)';
  ctx.lineWidth = H * 0.05;
  ctx.beginPath();
  ctx.moveTo(W * 0.38, H * 1.05);
  ctx.quadraticCurveTo(W * 0.5, H * 0.85, W * 0.62, gy + H * 0.015);
  ctx.stroke();
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// ------------------------------------------------------------------ mock top-down map
function mockMapImage(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  seed = 99;
  g.fillStyle = '#5f7a3f';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 20 + rnd() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const t = rnd();
    const col = t < 0.33 ? '120,140,70' : t < 0.66 ? '80,100,50' : '140,130,80';
    grd.addColorStop(0, `rgba(${col},0.45)`);
    grd.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // fields
  for (let i = 0; i < 14; i++) {
    g.save();
    g.translate(rnd() * size, rnd() * size);
    g.rotate(rnd() * Math.PI);
    g.fillStyle = rnd() < 0.5 ? 'rgba(190,170,90,0.55)' : 'rgba(150,170,80,0.5)';
    g.fillRect(-60, -35, 80 + rnd() * 80, 50 + rnd() * 50);
    g.restore();
  }
  // forests
  for (let k = 0; k < 9; k++) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    for (let i = 0; i < 90; i++) {
      g.beginPath();
      g.arc(cx + (rnd() - 0.5) * 220, cy + (rnd() - 0.5) * 180, 6 + rnd() * 10, 0, Math.PI * 2);
      g.fillStyle = `rgba(${30 + rnd() * 20},${55 + rnd() * 20},${28 + rnd() * 10},0.85)`;
      g.fill();
    }
  }
  // river
  g.strokeStyle = '#3e6f8f';
  g.lineWidth = 14;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-20, size * 0.3);
  g.bezierCurveTo(size * 0.3, size * 0.15, size * 0.45, size * 0.7, size * 1.05, size * 0.62);
  g.stroke();
  g.strokeStyle = 'rgba(160,200,220,0.35)';
  g.lineWidth = 4;
  g.stroke();
  // roads
  g.strokeStyle = '#b9a77e';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(size * 0.1, size * 0.95);
  g.bezierCurveTo(size * 0.35, size * 0.6, size * 0.55, size * 0.55, size * 0.92, size * 0.08);
  g.moveTo(size * 0.2, size * 0.2);
  g.lineTo(size * 0.62, size * 0.48);
  g.lineTo(size * 0.85, size * 0.9);
  g.stroke();
  // buildings
  for (let i = 0; i < 26; i++) {
    const t = rnd();
    const x = size * (0.4 + (rnd() - 0.5) * 0.3);
    const y = size * (0.45 + (rnd() - 0.5) * 0.25);
    g.save();
    g.translate(x, y);
    g.rotate(t * 0.6);
    g.fillStyle = 'rgba(70,70,72,0.95)';
    g.fillRect(-8, -6, 16 + rnd() * 10, 12 + rnd() * 6);
    g.fillStyle = 'rgba(160,160,160,0.6)';
    g.fillRect(-8, -6, 16, 3);
    g.restore();
  }
  // relief shading
  for (let i = 0; i < 18; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 60 + rnd() * 140;
    const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,240,0.14)');
    grd.addColorStop(0.6, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return c;
}

// ------------------------------------------------------------------ mock data
const ROOMS = [
  { id: 'r1', name: 'Friday Night Ops', mapId: 'valley', mode: 'tdm', players: 7, maxPlayers: 12, bots: 4, state: 'playing', timeLeft: 412, host: 'Sgt.Kowalski' },
  { id: 'r2', name: 'Sniper Alley · no shotguns', mapId: 'ridge', mode: 'ffa', players: 3, maxPlayers: 8, bots: 2, state: 'warmup', timeLeft: 38, host: 'Vortex' },
  { id: 'r3', name: 'Outpost CQB', mapId: 'outpost', mode: 'tdm', players: 12, maxPlayers: 12, bots: 0, state: 'playing', timeLeft: 141, host: 'kali_wolf' },
  { id: 'r4', name: 'Training', mapId: 'valley', mode: 'ffa', players: 1, maxPlayers: 6, bots: 5, state: 'ended', timeLeft: 0, host: 'Operator421' },
  { id: 'r5', name: 'LAN party room', mapId: 'outpost', mode: 'ffa', players: 5, maxPlayers: 16, bots: 0, state: 'playing', timeLeft: 534, host: 'Hex' },
];
const SERVER = {
  connected: true, address: '192.168.1.20:7777', playersOnline: 28, error: null,
  lanUrls: ['http://192.168.1.20:7777', 'http://10.8.0.4:7777'],
};
const NAMES = ['Operator421', 'Sgt.Kowalski', 'Vortex', 'kali_wolf', 'Hex', 'Ghost-7', 'Reaper', 'Nomad', 'Viper', 'Bishop'];
const PLAYERS = NAMES.map((name, i) => ({
  id: `p${i}`, name, team: i % 2, kills: [14, 11, 18, 6, 9, 12, 7, 4, 10, 3][i], deaths: [6, 9, 7, 10, 8, 5, 11, 9, 6, 12][i],
  assists: [3, 5, 2, 4, 1, 6, 2, 3, 2, 1][i], score: 0, ping: [23, 41, 18, 67, 0, 0, 52, 0, 140, 0][i],
  isBot: [false, false, false, false, true, true, false, true, false, true][i], isLocal: i === 0, alive: ![3, 7].includes(i),
})).map((p) => ({ ...p, score: p.kills * 100 + p.assists * 25 }));

// ------------------------------------------------------------------ boot
const backdrop = document.getElementById('game-canvas');
const root = document.getElementById('ui-root');
const bg = q.get('bg') || (HUD_SCREENS.includes(screen) ? 'day' : screen === 'loading' ? 'dusk' : 'dusk');
drawBackdrop(backdrop, bg);
addEventListener('resize', () => drawBackdrop(backdrop, bg));

const log = (name) => (...a) => console.log(`[cb] ${name}`, ...a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)));
const settings = loadSettings();
if (q.get('tab')) settings.__tab = q.get('tab');
const hud = new HUD(root);
const menu = new MenuUI(root, {
  onPlaySolo: log('onPlaySolo'), onRefreshRooms: log('onRefreshRooms'), onCreateRoom: log('onCreateRoom'),
  onJoinRoom: log('onJoinRoom'), onConnectServer: log('onConnectServer'), onLoadoutChange: log('onLoadoutChange'),
  onSettingsChange: (s) => {
    console.log('[cb] onSettingsChange', JSON.stringify(s.graphics));
    hud.setCrosshair({ style: s.gameplay.crosshair, color: s.gameplay.crosshairColor });
  },
  onPlayerNameChange: log('onPlayerNameChange'),
  onResume: () => { console.log('[cb] onResume'); menu.show('none'); },
  onLeaveMatch: () => { console.log('[cb] onLeaveMatch'); menu.setInMatch(false); hud.setVisible(false); menu.show('main'); },
  onQuit: log('onQuit'), onSound: () => {},
});
window.menu = menu;
window.hud = hud;
hud.callbacks = { onOpenLoadout: () => menu.show('loadout'), onDeploy: () => { console.log('[cb] onDeploy'); hud.hideDeath(); } };

menu.setSettings(settings);
const lo = defaultLoadout();
if (q.get('w') && WEAPONS[q.get('w')]) {
  const w = WEAPONS[q.get('w')];
  if (w.slot === 'primary') { lo.primary = w.id; lo.primaryAtt = defaultAttachments(w.id); } else { lo.secondary = w.id; lo.secondaryAtt = defaultAttachments(w.id); }
}
menu.setLoadout(sanitizeLoadout(lo));
menu.setServerInfo(q.get('offline') ? { connected: false, address: '', lanUrls: [], playersOnline: 0, error: q.get('offline') === 'err' ? 'Connection refused (192.168.1.50:7777)' : null } : SERVER);
menu.setRooms(q.get('norooms') ? [] : ROOMS);

const mapImg = mockMapImage();
const WORLD = 1600;
const player = { x: 140, z: -260, yaw: -247 * DEG };
const friendlies = [{ x: 175, z: -235, yaw: -200 * DEG }, { x: 110, z: -300, yaw: -260 * DEG }, { x: 60, z: -190, yaw: -300 * DEG }, { x: 260, z: -420, yaw: -120 * DEG }];
const enemies = [{ x: 60, z: -350 }, { x: 205, z: -330 }];
const objectives = [{ x: 220, z: -280, label: 'A' }, { x: -300, z: 250, label: 'B', color: '#ffb000' }];

function setupHud(full = true) {
  hud.setVisible(true);
  hud.setHealth(Number(q.get('hp') ?? 76), 100);
  hud.setAmmo({ mag: Number(q.get('mag') ?? 21), magSize: 30, reserve: 120, weaponName: WEAPONS[q.get('w') || 'm4a1']?.name || 'M4A1', fireMode: 'AUTO', frags: 2, smokes: 1, reloading: !!q.get('reload') });
  hud.setStance(Number(q.get('stance') || 0));
  hud.setCompass(247 * DEG);
  hud.setCrosshair({ visible: true, spread: 9, style: settings.gameplay.crosshair, color: settings.gameplay.crosshairColor });
  if (mode === 'tdm') hud.setMatchInfo({ mode: 'tdm', timeLeft: 431, scoreLimit: 75, myTeam: 0, teamScores: [42, 37], state: 'playing' });
  else hud.setMatchInfo({ mode: 'ffa', timeLeft: 312, scoreLimit: 30, myScore: 14, leaderName: 'Vortex', leaderScore: 18, state: 'playing' });
  hud.setMinimap({ visible: true, image: mapImg, worldSize: WORLD, rotate: true, player, friendlies: mode === 'tdm' ? friendlies : [], enemies, objectives });
  if (mode === 'tdm') {
    hud.setSquad([
      { name: 'Operator421', alive: true, isLocal: true }, { name: 'Vortex', alive: true }, { name: 'Hex', alive: false },
      { name: 'Reaper', alive: true }, { name: 'Viper', alive: true },
    ]);
  }
  hud.setFps(144);
  hud.setPing(23);
  if (!full) return;
  const feed = [
    { killer: 'Ghost-7', killerTeam: 1, victim: 'Hex', victimTeam: 0, weapon: 'AK-47', headshot: false },
    { killer: 'Vortex', killerTeam: 0, victim: 'Bishop', victimTeam: 1, weapon: 'M24 SWS', headshot: true },
    { killer: 'Reaper', killerTeam: 0, victim: 'Nomad', victimTeam: 1, weapon: 'MP5A3' },
    { killer: 'Operator421', killerTeam: 0, victim: 'kali_wolf', victimTeam: 1, weapon: 'M4A1', headshot: true, local: 'killer' },
    { killer: 'Sgt.Kowalski', killerTeam: 1, victim: 'Viper', victimTeam: 0, weapon: 'M67 Frag' },
  ];
  for (const k of feed) {
    if (mode === 'ffa') { k.killerTeam = null; k.victimTeam = null; }
    hud.addKillFeed(k);
  }
  hud.addChat({ system: true, text: 'Match started · first team to 75 wins' });
  hud.addChat({ name: 'Vortex', team: 0, text: 'enemy sniper on the radio hill, NE' });
  hud.addChat({ name: 'Ghost-7', team: 1, text: 'gg' });
  hud.addChat({ name: 'Reaper', team: 0, teamOnly: true, text: 'pushing the farm, cover me' });
  hud.addChat({ system: true, text: 'Hex was killed by a grenade' });
  hud.showMessage('+100 ELIMINATION', { kind: 'kill', sub: 'HEADSHOT +50', duration: 30 });
  hud.showHitmarker('head');
  hud.showDamage(-0.9);
  hud.showDamage(2.2);
  hud.setNameplates([
    { id: 1, screenX: innerWidth * 0.36, screenY: innerHeight * 0.52, name: 'Vortex', team: 0, friendly: true, distance: 18, health: 0.8 },
    { id: 2, screenX: innerWidth * 0.66, screenY: innerHeight * 0.55, name: 'Reaper', team: 0, friendly: true, distance: 64, health: 0.35 },
    { id: 3, screenX: innerWidth * 0.555, screenY: innerHeight * 0.585, name: 'Bishop', team: 1, friendly: false, distance: 41 },
  ]);
  if (q.get('oob')) hud.setOutOfBounds(8);
  if (q.get('msg') === 'big') hud.showMessage('MATCH STARTS IN 5', { kind: 'big', sub: 'Team Deathmatch · Highland Valley', duration: 30 });
  if (q.get('msg') === 'warn') hud.showMessage('Enemy UAV overhead', { kind: 'warn', duration: 30 });
  if (q.get('spawn')) hud.setSpawnProtection(true);
  if (q.get('interact')) hud.setInteraction('[F] Pick up M249 SAW');
  if (q.get('chat')) hud.openChat(false, (t) => hud.addChat({ name: 'Operator421', team: 0, text: t }));
  // freeze animations in their visible pose for the screenshot
  hud.update(0.06);
}

function ready() {
  const done = () => requestAnimationFrame(() => requestAnimationFrame(() => { window.__READY = true; }));
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(done);
}

async function run() {
  if (MENU_SCREENS.includes(screen)) {
    hud.setVisible(false);
    if (q.get('match') || screen === 'pause') {
      menu.setInMatch(true);
      setupHud(false);
    }
    if (screen === 'settings' && q.get('tab')) menu._setTab = q.get('tab');
    menu.show(screen);
    if (screen === 'loadout') {
      const p = menu.preview;
      if (p) await Promise.race([p.whenRendered(), new Promise((r) => setTimeout(r, 60000))]);
      await new Promise((r) => setTimeout(r, 300));
    }
    ready();
    return;
  }
  if (screen === 'loading') {
    hud.setVisible(false);
    const map = MAP_BY_ID[q.get('map')] || MAPS[0];
    menu.setLoading(true, Number(q.get('p') ?? 0.64), map.name);
    menu.setLoading(true, Number(q.get('p') ?? 0.64), 'Generating terrain and vegetation');
    ready();
    return;
  }
  menu.show('none');
  menu.setInMatch(true);
  setupHud(screen === 'hud');
  const sbData = { mode, mapName: 'Highland Valley', teamScores: [42, 37], scoreLimit: mode === 'tdm' ? 75 : 30, timeLeft: 431, players: mode === 'tdm' ? PLAYERS : PLAYERS.map((p) => ({ ...p, team: null })) };
  if (screen === 'scoreboard') hud.setScoreboard(true, sbData);
  if (screen === 'death') {
    hud.showDeath({ killerName: 'Ghost-7', killerTeam: 1, weaponName: 'SVD Dragunov', distance: 187.4, headshot: true, respawnIn: q.get('ready') ? 0 : 5 });
    for (let i = 0; i < (q.get('ready') ? 1 : 8); i++) hud.update(0.2);
  }
  if (screen === 'matchend') {
    const sorted = PLAYERS.slice().sort((a, b) => b.score - a.score);
    hud.showMatchEnd({ title: q.get('title') || 'VICTORY', subtitle: 'NATO 75 — 61 OPFOR', players: sorted, mvp: { name: sorted[0].name, kills: sorted[0].kills, deaths: sorted[0].deaths, score: sorted[0].score }, nextIn: 15 });
  }
  if (screen === 'bigmap') {
    hud.setBigMap(true, { image: mapImg, worldSize: WORLD, player, friendlies: mode === 'tdm' ? friendlies : [], enemies, objectives, mapName: 'Highland Valley' });
  }
  if (q.get('anim')) startAnim(sbData);
  ready();
}

// ------------------------------------------------------------------ live demo (anim=1)
function startAnim(sbData) {
  let last = performance.now();
  let t = 0;
  let hp = 76;
  let mag = 21;
  let stance = 0;
  let tab = false;
  let bigmap = false;
  const loop = (now) => {
    const dt = (now - last) / 1000;
    last = now;
    t += dt;
    player.yaw = -247 * DEG + Math.sin(t * 0.25) * 1.2;
    player.x = 140 + Math.sin(t * 0.1) * 40;
    hud.setCompass(-player.yaw);
    hud.setCrosshair({ spread: 8 + Math.abs(Math.sin(t * 2)) * 18 });
    hud.setMinimap({ player });
    if (bigmap) hud.setBigMap(true, { player });
    hud.setFps(Math.round(1 / Math.max(dt, 1e-3)));
    hud.update(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  addEventListener('keydown', (e) => {
    if (hud.chatOpen || menu.isOpen()) {
      if (e.key === 'Escape' && !hud.chatOpen && menu.screen === 'none') menu.show('pause');
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); if (!tab) { tab = true; hud.setScoreboard(true, sbData); } }
    if (e.key === 'm' || e.key === 'M') { bigmap = !bigmap; hud.setBigMap(bigmap, { image: mapImg, worldSize: WORLD, player, friendlies, enemies, objectives, mapName: 'Highland Valley' }); }
    if (e.key === 't' || e.key === 'T' || e.key === 'y' || e.key === 'Y') hud.openChat(e.key.toLowerCase() === 'y', (txt) => hud.addChat({ name: 'Operator421', team: 0, teamOnly: e.key.toLowerCase() === 'y', text: txt }));
    if (e.key === 'Escape') menu.show('pause');
    if (e.key === 'F1') { e.preventDefault(); hud.setVisible(!hud._visible); }
    if (e.key === 'k' || e.key === 'K') {
      hud.showHitmarker('kill');
      hud.addKillFeed({ killer: 'Operator421', killerTeam: 0, victim: NAMES[Math.floor(Math.random() * 9) + 1], victimTeam: 1, weapon: 'M4A1', headshot: Math.random() < 0.4, local: 'killer' });
      hud.showMessage('+100 ELIMINATION', { kind: 'kill' });
    }
    if (e.key === 'h' || e.key === 'H') {
      hp = Math.max(0, hp - 17);
      hud.setHealth(hp, 100);
      hud.showDamage((Math.random() - 0.5) * Math.PI * 2);
      if (hp === 0) hud.showDeath({ killerName: 'Ghost-7', killerTeam: 1, weaponName: 'AK-47', distance: 42, headshot: false, respawnIn: 4 });
    }
    if (e.key === 'r' || e.key === 'R') { hud.setAmmo({ reloading: true }); setTimeout(() => { mag = 30; hud.setAmmo({ reloading: false, mag }); }, 2200); }
    if (e.key === ' ' && !hud._death.visible) { mag = Math.max(0, mag - 1); hud.setAmmo({ mag }); hud.showHitmarker('hit'); }
    if (e.key === 'c' || e.key === 'C') { stance = (stance + 1) % 3; hud.setStance(stance); }
    if (e.key === 'g' || e.key === 'G') hud.showMessage('DOUBLE KILL', { kind: 'big', sub: '+150', duration: 2 });
  });
  addEventListener('keyup', (e) => { if (e.key === 'Tab') { tab = false; hud.setScoreboard(false); } });
}

// ------------------------------------------------------------------ optional nav
if (q.get('nav')) {
  const nav = document.createElement('div');
  nav.className = 'dev-nav';
  for (const s of [...MENU_SCREENS, 'loading', ...HUD_SCREENS]) {
    const a = document.createElement('a');
    const p = new URLSearchParams(location.search);
    p.set('screen', s);
    a.href = `?${p}`;
    a.textContent = s;
    if (s === screen) a.className = 'on';
    nav.append(a);
  }
  document.body.append(nav);
}

void defaultSettings;
run().catch((err) => {
  console.error(err);
  window.__READY = true;
});
