// GameRoom: authoritative match simulation (players, bots, damage, scores, grenades).
// Transport-agnostic: the Node server runs it for multiplayer, the browser runs it for solo.
import { getWorld, MAP_IDS } from './world.js';
import { RNG } from './random.js';
import { MODES, PLAYER, STANCE, TEAMS } from './constants.js';
import {
  WEAPONS, WEAPON_INDEX, sanitizeLoadout, computeDamage, EQUIPMENT, HIT_ZONES, fireInterval,
  weaponByIndex, MUZZLES,
} from './weapons.js';
import { createBody, stepBody, eyeHeight, fallDamage } from './physics.js';
import { createHitboxes, updateHitboxes, rayHitboxes, pointDistanceToHitboxes } from './hitboxes.js';
import { BotBrain } from './bot.js';
import { getNavGrid } from './nav.js';

const BOT_NAMES = ['Viper', 'Ghost', 'Reaper', 'Hawk', 'Wolf', 'Cobra', 'Raven', 'Saber', 'Titan', 'Blaze', 'Frost',
  'Havoc', 'Specter', 'Nomad', 'Bishop', 'Rook', 'Jester', 'Kodiak', 'Mamba', 'Onyx', 'Falcon', 'Atlas', 'Dingo', 'Sierra'];

const BOT_LOADOUTS = [
  ['m4a1', 'reddot', 6], ['hk416', 'holo', 5], ['ak47', 'iron', 6], ['ak74m', 'reddot', 4], ['scarh', 'acog', 3],
  ['aug', 'acog', 3], ['f2000', 'reddot', 3], ['g36c', 'holo', 3], ['mp5', 'iron', 3], ['p90', 'reddot', 2],
  ['vector', 'reddot', 2], ['ump45', 'holo', 2], ['mp7', 'reddot', 2], ['m249', 'iron', 2], ['pkm', 'iron', 1.5],
  ['svd', 'pso', 1.5], ['mk14', 'acog', 1.5], ['m110', 'scope8', 1], ['m24', 'scope8', 1], ['awm', 'scope8', 0.8],
  ['r870', 'iron', 1.5], ['m1014', 'reddot', 1], ['saiga12', 'iron', 1],
];
const BOT_PISTOLS = ['m9', 'glock18', 'm1911', 'deagle', 'r357'];

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const DEG = Math.PI / 180;

export const FLAG = { ALIVE: 1, ADS: 2, SPRINT: 4, RELOAD: 8, GROUND: 16, PROTECT: 32, BOT: 64, FIRING: 128 };

let roomCounter = 0;
export function makeRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s + (++roomCounter % 10);
}

export class GameRoom {
  /**
   * @param {object} opts { id, name, mapId, mode, maxPlayers, bots, difficulty, timeLimit, scoreLimit, friendlyFire, rotation, host, isLocal }
   * @param {object} [env] { world } supply an existing World (the browser shares its rendering world)
   */
  constructor(opts = {}, env = {}) {
    this.id = opts.id || makeRoomId();
    this.name = String(opts.name || 'Room ' + this.id).slice(0, 32);
    this.mode = MODES[opts.mode] ? opts.mode : 'ffa';
    this.modeDef = MODES[this.mode];
    this.maxPlayers = clampInt(opts.maxPlayers ?? 12, 2, 16);
    this.botCount = clampInt(opts.bots ?? 0, 0, 15);
    this.difficulty = ['easy', 'normal', 'hard'].includes(opts.difficulty) ? opts.difficulty : 'normal';
    this.timeLimit = clampInt(opts.timeLimit ?? this.modeDef.timeLimit, 60, 3600);
    this.scoreLimit = clampInt(opts.scoreLimit ?? this.modeDef.scoreLimit, 5, 500);
    this.friendlyFire = !!opts.friendlyFire;
    this.rotation = opts.rotation !== false && !env.world;
    this.isLocal = !!opts.isLocal;
    this.host = String(opts.host || '').slice(0, 24);
    this.transport = null; // { send(clientId, msg) }
    this.players = new Map();
    this.clients = new Map();
    this.nextId = 1;
    this.now = 0;
    this.rng = new RNG((opts.seed ?? Math.floor(Math.random() * 0x7fffffff)) || 1);
    this.grenades = [];
    this.smokes = [];
    this.nextNadeId = 1;
    this.pathBudget = 3;
    this.snapAcc = 0;
    this.stateAcc = 0;
    this.pingAcc = 0;
    this.emptySince = null;
    this._env = env;
    this.loadWorld(MAP_IDS.includes(opts.mapId) ? opts.mapId : 'valley', env.world);
    this.resetMatch();
    this.fillBots();
  }

  loadWorld(mapId, world) {
    this.mapId = mapId;
    this.world = world || getWorld(mapId, { vegetation: false });
    this.nav = null;
    this.spawnUsed = new Map();
  }

  ensureNav() {
    if (!this.nav) this.nav = getNavGrid(this.world);
    return this.nav;
  }

  resetMatch() {
    this.state = 'playing';
    this.matchStart = this.now;
    this.nextMatchAt = 0;
    this.teamScores = [0, 0];
    this.grenades.length = 0;
    this.smokes.length = 0;
    for (const p of this.players.values()) {
      p.kills = 0; p.deaths = 0; p.assists = 0; p.score = 0; p.streak = 0;
      p.alive = false;
      p.respawnAt = this.now + (p.isBot ? 0.5 + this.rng.next() * 1.5 : 0);
    }
  }

  get timeLeft() {
    if (this.state === 'ended') return Math.max(0, this.nextMatchAt - this.now);
    return Math.max(0, this.timeLimit - (this.now - this.matchStart));
  }

  get humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot) n++;
    return n;
  }

  info() {
    let bots = 0;
    for (const p of this.players.values()) if (p.isBot) bots++;
    return {
      id: this.id, name: this.name, mapId: this.mapId, mode: this.mode, players: this.humanCount, bots,
      maxPlayers: this.maxPlayers, state: this.state, timeLeft: Math.round(this.timeLeft), host: this.host,
      difficulty: this.difficulty, scoreLimit: this.scoreLimit, timeLimit: this.timeLimit,
    };
  }

  // ------------------------------------------------------------------ messaging
  send(p, msg) {
    if (p && p.clientId != null && this.transport) this.transport.send(p.clientId, msg);
  }

  broadcast(msg, except = null) {
    if (!this.transport) return;
    for (const p of this.players.values()) {
      if (p.isBot || p === except) continue;
      this.transport.send(p.clientId, msg);
    }
  }

  // ------------------------------------------------------------------ players
  isEnemy(a, b) {
    if (a === b) return false;
    if (!this.modeDef.teams) return true;
    return a.team !== b.team;
  }

  _teamCounts() {
    const c = [0, 0];
    for (const p of this.players.values()) if (p.team >= 0) c[p.team]++;
    return c;
  }

  _createPlayer({ name, isBot = false, clientId = null, loadout, team = -1 }) {
    const id = this.nextId++;
    if (this.modeDef.teams && team < 0) {
      const c = this._teamCounts();
      team = c[0] < c[1] ? 0 : c[1] < c[0] ? 1 : (this.teamScores[0] <= this.teamScores[1] ? 0 : 1);
    }
    if (!this.modeDef.teams) team = -1;
    const lo = sanitizeLoadout(loadout);
    const p = {
      id, name, isBot, clientId, team, loadout: lo, pendingLoadout: null,
      body: createBody(0, 0, 0), yaw: 0, pitch: 0, lean: 0, flags: 0,
      input: { fwd: 0, right: 0, jump: false, sprint: false, stance: 0, yaw: 0, ads: false, speedMult: 1 },
      weapon: lo.primary, alive: false, hp: PLAYER.maxHealth, respawnAt: this.now + (isBot ? 0.4 + this.rng.next() : 0.5),
      deathTime: -100, kills: 0, deaths: 0, assists: 0, score: 0, streak: 0, ping: 0,
      damageLog: [], lastDamageTime: -100, spawnProtectUntil: 0, spawnProtected: false,
      mag: 0, reloadUntil: 0, reloadEndMag: 0, frags: 2, smokes: 1, shotBudget: 0, lastFireTime: -100,
      hitboxes: createHitboxes(), oobSince: null, lastInputTime: this.now, firingUntil: 0,
      variant: Math.floor(this.rng.next() * 1000),
    };
    this.players.set(id, p);
    return p;
  }

  publicPlayer(p) {
    return { id: p.id, name: p.name, team: p.team, isBot: p.isBot, alive: p.alive, kills: p.kills, deaths: p.deaths,
      assists: p.assists, score: p.score, loadout: p.loadout, variant: p.variant, hp: Math.round(p.hp) };
  }

  /** A human joins. Returns the player or { error }. */
  join(clientId, { name, loadout } = {}) {
    if (this.clients.has(clientId)) return this.players.get(this.clients.get(clientId));
    if (this.humanCount >= this.maxPlayers) return { error: 'Room is full' };
    // Make room by removing a bot if needed.
    if (this.players.size >= this.maxPlayers) this._removeOneBot();
    const clean = String(name || 'Player').replace(/[^\w\- .]/g, '').trim().slice(0, 18) || 'Player';
    let finalName = clean;
    let k = 2;
    const names = new Set([...this.players.values()].map((q) => q.name));
    while (names.has(finalName)) finalName = clean + k++;
    const p = this._createPlayer({ name: finalName, clientId, loadout });
    p.respawnAt = this.now; // humans deploy when ready
    this.clients.set(clientId, p.id);
    this.emptySince = null;
    this.send(p, this._welcome(p));
    this.broadcast({ t: 'pjoin', p: this.publicPlayer(p) }, p);
    this.broadcast({ t: 'chat', sys: true, text: `${p.name} joined the match` }, p);
    this.fillBots();
    return p;
  }

  _welcome(p) {
    return {
      t: 'welcome', you: p.id, room: this.info(), mapId: this.mapId, mode: this.mode,
      players: [...this.players.values()].map((q) => this.publicPlayer(q)),
      teamScores: this.teamScores, state: this.state, timeLeft: this.timeLeft, scoreLimit: this.scoreLimit,
      now: Math.round(this.now * 1000), checksum: this.world.checksum(),
    };
  }

  leave(clientId) {
    const id = this.clients.get(clientId);
    if (id == null) return;
    const p = this.players.get(id);
    this.clients.delete(clientId);
    this.players.delete(id);
    if (p) {
      this.broadcast({ t: 'pleave', id });
      this.broadcast({ t: 'chat', sys: true, text: `${p.name} left the match` });
    }
    if (this.humanCount === 0) this.emptySince = this.now;
    this.fillBots();
  }

  _removeOneBot() {
    let victim = null;
    if (this.modeDef.teams) {
      const c = this._teamCounts();
      const bigger = c[0] >= c[1] ? 0 : 1;
      for (const p of this.players.values()) if (p.isBot && p.team === bigger) victim = p;
    }
    if (!victim) for (const p of this.players.values()) if (p.isBot) victim = p;
    if (victim) {
      this.players.delete(victim.id);
      this.broadcast({ t: 'pleave', id: victim.id });
    }
  }

  fillBots() {
    const humans = this.humanCount;
    const want = Math.max(0, Math.min(this.botCount, this.maxPlayers - humans));
    let bots = 0;
    for (const p of this.players.values()) if (p.isBot) bots++;
    while (bots > want) { this._removeOneBot(); bots--; }
    while (bots < want) { this._addBot(); bots++; }
    // Keep TDM teams balanced by moving bots.
    if (this.modeDef.teams) {
      for (let guard = 0; guard < 16; guard++) {
        const c = this._teamCounts();
        if (Math.abs(c[0] - c[1]) <= 1) break;
        const big = c[0] > c[1] ? 0 : 1;
        const bot = [...this.players.values()].find((p) => p.isBot && p.team === big);
        if (!bot) break;
        bot.team = 1 - big;
        if (bot.alive) this.kill(bot, null, { kind: 'switch', silent: true });
        this.broadcast({ t: 'pteam', id: bot.id, team: bot.team });
      }
    }
  }

  _addBot() {
    const used = new Set([...this.players.values()].map((p) => p.name));
    let name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot' + this.nextId;
    const [primary, optic] = this.rng.weighted(BOT_LOADOUTS.map((l) => [[l[0], l[1]], l[2]]));
    const w = WEAPONS[primary];
    const loadout = sanitizeLoadout({
      primary, primaryAtt: { optic, muzzle: this.rng.chance(0.25) && w.muzzles.includes('suppressor') ? 'suppressor' : w.defaultMuzzle, grip: this.rng.pick(w.grips) },
      secondary: this.rng.pick(BOT_PISTOLS),
    });
    const p = this._createPlayer({ name, isBot: true, loadout });
    p.brain = new BotBrain(this, p, this.difficulty);
    this.broadcast({ t: 'pjoin', p: this.publicPlayer(p) });
    return p;
  }

  // ------------------------------------------------------------------ spawning
  _chooseSpawn(p) {
    const spawns = this.world.spawns;
    let best = spawns[0];
    let bestScore = -Infinity;
    const enemies = [];
    const friends = [];
    for (const q of this.players.values()) {
      if (!q.alive || q === p) continue;
      if (this.isEnemy(p, q)) enemies.push(q); else friends.push(q);
    }
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i];
      let minE = 400;
      let visible = 0;
      for (const e of enemies) {
        const d = Math.hypot(e.body.x - s.x, e.body.z - s.z);
        if (d < minE) minE = d;
        if (d < 140 && this.lineOfSight(e.body.x, e.body.y + 1.6, e.body.z, s.x, s.y + 1.4, s.z)) visible++;
      }
      let score = Math.min(minE, 160);
      if (minE < 30) score -= 300;
      score -= visible * 80;
      if (this.modeDef.teams) {
        // Prefer own side and teammates.
        const sideOk = (p.team === 0) === (s.x < 0);
        score += sideOk ? 60 : -20;
        let nearF = 400;
        for (const f of friends) nearF = Math.min(nearF, Math.hypot(f.body.x - s.x, f.body.z - s.z));
        if (friends.length) score += Math.max(0, 80 - nearF) * 0.6;
      }
      const lastUsed = this.spawnUsed.get(i) || -100;
      if (this.now - lastUsed < 6) score -= 120;
      score += this.rng.next() * 40;
      if (score > bestScore) { bestScore = score; best = s; this._bestSpawnIdx = i; }
    }
    this.spawnUsed.set(this._bestSpawnIdx, this.now);
    return best;
  }

  spawn(p) {
    if (p.pendingLoadout) { p.loadout = p.pendingLoadout; p.pendingLoadout = null; }
    const s = this._chooseSpawn(p);
    const b = p.body;
    b.x = s.x + (this.rng.next() - 0.5) * 2; b.z = s.z + (this.rng.next() - 0.5) * 2;
    b.y = this.world.collision.groundHeight(b.x, b.z, s.y + 1.5, 0.3);
    b.vx = b.vy = b.vz = 0; b.onGround = true; b.stance = STANCE.STAND; b.fallStartY = b.y;
    p.yaw = s.yaw; p.pitch = 0; p.lean = 0;
    p.alive = true; p.hp = PLAYER.maxHealth; p.spawnProtectUntil = this.now + PLAYER.spawnProtection; p.spawnProtected = true;
    p.weapon = p.loadout.primary; p.mag = WEAPONS[p.weapon].mag; p.reloadUntil = 0;
    p.frags = 2; p.smokes = 1; p.oobSince = null; p.damageLog = []; p.lastDamageTime = -100; p.shotBudget = 0;
    if (p.brain) p.brain.reset();
    updateHitboxes(p.hitboxes, b.x, b.y, b.z, p.yaw, b.stance, 0);
    this.broadcast({ t: 'spawn', id: p.id, x: r2(b.x), y: r2(b.y), z: r2(b.z), yaw: r3(p.yaw), lo: p.loadout, team: p.team, prot: PLAYER.spawnProtection });
  }

  // ------------------------------------------------------------------ incoming messages
  receive(clientId, msg) {
    const id = this.clients.get(clientId);
    const p = id != null ? this.players.get(id) : null;
    if (!p || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'in': this._onInput(p, msg); break;
      case 'fire': this._onFire(p, msg); break;
      case 'hit': this._onHit(p, msg); break;
      case 'nade': this._onNade(p, msg); break;
      case 'melee': this._onMelee(p, msg); break;
      case 'deploy': this._onDeploy(p, msg); break;
      case 'loadout': {
        const lo = sanitizeLoadout(msg.loadout);
        if (p.alive) p.pendingLoadout = lo; else p.loadout = lo;
        break;
      }
      case 'chat': this._onChat(p, msg); break;
      case 'pong': if (typeof msg.s === 'number') p.ping = Math.max(0, Math.round((this.now * 1000 - msg.s))); break;
      case 'fall': if (p.alive) this.applyDamage(p, p, Math.min(150, Math.max(0, Number(msg.dmg) || 0)), { kind: 'fall' }); break;
      case 'suicide': if (p.alive) this.kill(p, p, { kind: 'suicide' }); break;
      case 'team': {
        if (!this.modeDef.teams) break;
        const want = msg.team === 1 ? 1 : 0;
        if (want !== p.team) {
          p.team = want;
          if (p.alive) this.kill(p, null, { kind: 'switch' });
          this.broadcast({ t: 'pteam', id: p.id, team: p.team });
          this.fillBots();
        }
        break;
      }
      default: break;
    }
  }

  _onInput(p, m) {
    p.lastInputTime = this.now;
    if (!p.alive) return;
    const b = p.body;
    const x = Number(m.x), y = Number(m.y), z = Number(m.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const dt = Math.max(0.03, this.now - (p.lastPosTime || 0));
    const dist = Math.hypot(x - b.x, z - b.z);
    if (dist > 14 * dt + 3) {
      // Too fast: snap the client back.
      this.send(p, { t: 'correct', x: r2(b.x), y: r2(b.y), z: r2(b.z) });
      return;
    }
    const lim = this.world.half - 5;
    b.x = Math.max(-lim, Math.min(lim, x));
    b.z = Math.max(-lim, Math.min(lim, z));
    b.y = y;
    b.vx = Number(m.vx) || 0; b.vy = Number(m.vy) || 0; b.vz = Number(m.vz) || 0;
    b.stance = m.st === 1 ? 1 : m.st === 2 ? 2 : 0;
    p.yaw = Number(m.yaw) || 0;
    p.pitch = Math.max(-1.55, Math.min(1.55, Number(m.pitch) || 0));
    p.lean = Math.max(-1, Math.min(1, Number(m.ln) || 0));
    p.flags = (m.f | 0) & (FLAG.ADS | FLAG.SPRINT | FLAG.RELOAD | FLAG.GROUND);
    const w = weaponByIndex(m.w | 0);
    if (w && (w.id === p.loadout.primary || w.id === p.loadout.secondary)) p.weapon = w.id;
    p.lastPosTime = this.now;
    // Firing breaks spawn protection.
  }

  _onFire(p, m) {
    if (!p.alive) return;
    const w = weaponByIndex(m.w | 0);
    if (!w || (w.id !== p.loadout.primary && w.id !== p.loadout.secondary)) return;
    const interval = fireInterval(w);
    if (this.now - p.lastFireTime < interval * 0.55) return; // too fast
    p.lastFireTime = this.now;
    p.firingUntil = this.now + 0.12;
    p.spawnProtectUntil = 0;
    const dirs = Array.isArray(m.d) ? m.d.slice(0, 12) : [];
    p.shotBudget = Math.min(p.shotBudget + Math.max(1, dirs.length), 48);
    const o = Array.isArray(m.o) ? m.o.slice(0, 3).map(Number) : [p.body.x, p.body.y + 1.5, p.body.z];
    const att = w.id === p.loadout.primary ? p.loadout.primaryAtt : p.loadout.secondaryAtt;
    const suppressed = MUZZLES[att.muzzle]?.suppressed || false;
    this.broadcast({ t: 'fire', id: p.id, w: m.w | 0, o, d: dirs, s: suppressed ? 1 : 0 }, p);
    this._noise(p, o[0], o[2], suppressed);
  }

  _onHit(p, m) {
    const v = this.players.get(m.v | 0);
    if (!v || !v.alive || v === p) return;
    if (p.shotBudget <= 0) return;
    if (this.now - p.lastFireTime > 3) return;
    const w = weaponByIndex(m.w | 0);
    if (!w || (w.id !== p.loadout.primary && w.id !== p.loadout.secondary)) return;
    p.shotBudget--;
    const zone = m.z === HIT_ZONES.HEAD ? HIT_ZONES.HEAD : m.z === HIT_ZONES.LIMB ? HIT_ZONES.LIMB : HIT_ZONES.TORSO;
    const dist = Math.hypot(v.body.x - p.body.x, v.body.y - p.body.y, v.body.z - p.body.z);
    const claimed = Number(m.dist) || dist;
    if (Math.abs(claimed - dist) > 20 + dist * 0.3) return; // implausible
    if (dist > 1600) return;
    const att = w.id === p.loadout.primary ? p.loadout.primaryAtt : p.loadout.secondaryAtt;
    let dmg = computeDamage(w, dist, zone, att.muzzle);
    if (m.pen) dmg *= 0.55;
    this.applyDamage(v, p, dmg, { kind: 'bullet', weapon: w.id, zone, dist });
  }

  _onNade(p, m) {
    if (!p.alive) return;
    const kind = m.k === 'smoke' ? 'smoke' : 'frag';
    if (kind === 'frag') { if (p.frags <= 0) return; p.frags--; } else { if (p.smokes <= 0) return; p.smokes--; }
    const o = Array.isArray(m.o) ? m.o.map(Number) : null;
    const v = Array.isArray(m.v) ? m.v.map(Number) : null;
    if (!o || !v || o.some((x) => !Number.isFinite(x)) || v.some((x) => !Number.isFinite(x))) return;
    // Clamp origin near the player and speed to the max throw speed.
    const b = p.body;
    if (Math.hypot(o[0] - b.x, o[2] - b.z) > 3) { o[0] = b.x; o[1] = b.y + 1.5; o[2] = b.z; }
    const sp = Math.hypot(v[0], v[1], v[2]);
    const max = EQUIPMENT[kind].throwSpeed * 1.1;
    if (sp > max) { v[0] *= max / sp; v[1] *= max / sp; v[2] *= max / sp; }
    const cook = Math.max(0, Math.min(EQUIPMENT[kind].fuse - 0.5, Number(m.cook) || 0));
    p.spawnProtectUntil = 0;
    this._spawnGrenade(p, kind, o, v, cook);
  }

  _onMelee(p, m) {
    if (!p.alive) return;
    if (this.now - (p.lastMelee || -10) < EQUIPMENT.knife.cooldown * 0.8) return;
    p.lastMelee = this.now;
    p.spawnProtectUntil = 0;
    const v = this.players.get(m.v | 0);
    this.broadcast({ t: 'melee', id: p.id }, p);
    if (!v || !v.alive || v === p) return;
    const d = Math.hypot(v.body.x - p.body.x, v.body.z - p.body.z);
    if (d > EQUIPMENT.knife.range + 0.8 || Math.abs(v.body.y - p.body.y) > 1.8) return;
    // Backstab if the attacker is behind the victim.
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    const dx = (p.body.x - v.body.x) / (d || 1), dz = (p.body.z - v.body.z) / (d || 1);
    const back = fx * dx + fz * dz < -0.3;
    this.applyDamage(v, p, back ? EQUIPMENT.knife.backstab : EQUIPMENT.knife.damage, { kind: 'melee', weapon: 'knife', zone: HIT_ZONES.TORSO, dist: d });
  }

  _onDeploy(p, m) {
    if (p.alive || this.state !== 'playing') return;
    if (m.loadout) p.loadout = sanitizeLoadout(m.loadout);
    if (this.now < p.respawnAt) return;
    this.spawn(p);
  }

  _onChat(p, m) {
    const text = String(m.text || '').replace(/[<>]/g, '').trim().slice(0, 140);
    if (!text) return;
    const teamOnly = !!m.team && this.modeDef.teams;
    const msg = { t: 'chat', id: p.id, name: p.name, team: p.team, text, tm: teamOnly };
    for (const q of this.players.values()) {
      if (q.isBot) continue;
      if (teamOnly && q.team !== p.team) continue;
      this.send(q, msg);
    }
  }

  // ------------------------------------------------------------------ combat
  lineOfSight(ax, ay, az, bx, by, bz) {
    for (const s of this.smokes) {
      if (this.now < s.start + 1.2) continue;
      const r = s.radius * Math.min(1, (this.now - s.start) / 3);
      if (segSphere(ax, ay, az, bx, by, bz, s.x, s.y + 1.5, s.z, r)) return false;
    }
    return !this.world.collision.segmentBlocked(ax, ay, az, bx, by, bz);
  }

  _noise(p, x, z, suppressed) {
    for (const q of this.players.values()) {
      if (q.brain && q.alive && q !== p) q.brain.onShotHeard(p, x, z, suppressed);
    }
  }

  /** Bot fires its current weapon along its view direction (hitscan). */
  botFire(p, spreadMul = 1) {
    const w = WEAPONS[p.weapon];
    const b = p.body;
    const ox = b.x, oy = b.y + eyeHeight(b.stance), oz = b.z;
    const att = w.id === p.loadout.primary ? p.loadout.primaryAtt : p.loadout.secondaryAtt;
    const suppressed = MUZZLES[att.muzzle]?.suppressed || false;
    const cp = Math.cos(p.pitch);
    const fx = -Math.sin(p.yaw) * cp, fy = Math.sin(p.pitch), fz = -Math.cos(p.yaw) * cp;
    const ads = p.input.ads;
    const moving = b.moveSpeed > 1;
    let spreadDeg = ads
      ? (w.spread.ads + (moving ? w.spread.move * 0.15 : 0)) * spreadMul
      : (w.spread.hip * 0.6 + (moving ? w.spread.move * 0.4 : 0)) * spreadMul;
    if (w.category === 'SHOTGUN') spreadDeg = ads ? w.spread.ads : w.spread.hip;
    const dirs = [];
    for (let i = 0; i < w.pellets; i++) {
      const d = spreadDir(fx, fy, fz, spreadDeg * DEG, this.rng);
      dirs.push([r3(d[0]), r3(d[1]), r3(d[2])]);
      this._traceShot(p, ox, oy, oz, d[0], d[1], d[2], w, att.muzzle);
    }
    p.firingUntil = this.now + 0.12;
    p.spawnProtectUntil = 0;
    this.broadcast({ t: 'fire', id: p.id, w: WEAPON_INDEX[w.id], o: [r2(ox), r2(oy), r2(oz)], d: dirs, s: suppressed ? 1 : 0 });
    this._noise(p, ox, oz, suppressed);
  }

  _traceShot(shooter, ox, oy, oz, dx, dy, dz, w, muzzle) {
    const col = this.world.collision;
    const maxD = Math.min(1200, w.range[1] * 4 + 200);
    const solid = col.raycast(ox, oy, oz, dx, dy, dz, maxD, { skipPen: true });
    const solidT = solid ? solid.t : maxD;
    const thin = col.raycast(ox, oy, oz, dx, dy, dz, solidT, { skipPen: false });
    const thinT = thin ? thin.t : solidT;
    let best = null, bestT = solidT, bestZone = 0;
    for (const q of this.players.values()) {
      if (q === shooter || !q.alive) continue;
      if (!this.friendlyFire && !this.isEnemy(shooter, q)) continue;
      const h = rayHitboxes(q.hitboxes, ox, oy, oz, dx, dy, dz, bestT);
      if (h) { best = q; bestT = h.t; bestZone = h.zone; }
    }
    if (!best) return null;
    if (bestT > thinT && w.penetration <= 0) return null;
    let dmg = computeDamage(w, bestT, bestZone, muzzle);
    if (bestT > thinT + 0.05) dmg *= 0.55;
    this.applyDamage(best, shooter, dmg, { kind: 'bullet', weapon: w.id, zone: bestZone, dist: bestT });
    return best;
  }

  botThrow(p, kind, vx, vy, vz) {
    if (kind === 'frag') { if (p.frags <= 0) return; p.frags--; }
    const b = p.body;
    this._spawnGrenade(p, kind, [b.x, b.y + 1.6, b.z], [vx, vy, vz], 0.4);
  }

  _spawnGrenade(p, kind, o, v, cook = 0) {
    const g = {
      id: this.nextNadeId++, kind, owner: p.id, x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2],
      fuseAt: this.now + EQUIPMENT[kind].fuse - cook, rest: false,
    };
    this.grenades.push(g);
    this.broadcast({ t: 'nade', id: g.id, k: kind, owner: p.id, o: [r2(g.x), r2(g.y), r2(g.z)], v: [r2(g.vx), r2(g.vy), r2(g.vz)], fuse: r2(g.fuseAt - this.now) });
  }

  _updateGrenades(dt) {
    const col = this.world.collision;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      const steps = 3;
      const sdt = dt / steps;
      for (let s = 0; s < steps && !g.rest; s++) {
        stepGrenade(col, g, sdt);
      }
      if (this.now >= g.fuseAt) {
        this.grenades.splice(i, 1);
        this._explode(g);
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) if (this.now > this.smokes[i].until) this.smokes.splice(i, 1);
  }

  _explode(g) {
    this.broadcast({ t: 'boom', id: g.id, k: g.kind, x: r2(g.x), y: r2(g.y), z: r2(g.z) });
    const owner = this.players.get(g.owner) || null;
    if (g.kind === 'smoke') {
      this.smokes.push({ x: g.x, y: g.y, z: g.z, radius: EQUIPMENT.smoke.radius, start: this.now, until: this.now + EQUIPMENT.smoke.duration });
      return;
    }
    const E = EQUIPMENT.frag;
    for (const q of this.players.values()) {
      if (!q.alive) continue;
      const d = pointDistanceToHitboxes(q.hitboxes, g.x, g.y + 0.2, g.z);
      if (d > E.radius) continue;
      const qb = q.body;
      if (!this.lineOfSight(g.x, g.y + 0.3, g.z, qb.x, qb.y + eyeHeight(qb.stance) * 0.6, qb.z)
        && !this.lineOfSight(g.x, g.y + 0.3, g.z, qb.x, qb.y + eyeHeight(qb.stance), qb.z)) continue;
      const f = d <= E.innerRadius ? 1 : 1 - (d - E.innerRadius) / (E.radius - E.innerRadius);
      const dmg = E.damage * f * f;
      if (dmg < 3) continue;
      if (owner && q !== owner && !this.friendlyFire && !this.isEnemy(owner, q)) continue;
      this.applyDamage(q, owner || q, dmg, { kind: 'explosion', weapon: 'frag', zone: HIT_ZONES.TORSO, dist: d, ox: g.x, oz: g.z });
    }
    this._noise(owner || { team: -2, body: g }, g.x, g.z, false);
  }

  applyDamage(victim, attacker, amount, info = {}) {
    if (!victim.alive || this.state !== 'playing' || !(amount > 0)) return;
    const selfHarm = !attacker || attacker === victim;
    if (victim.spawnProtected && !selfHarm && info.kind !== 'oob') return;
    if (!selfHarm && !this.friendlyFire && !this.isEnemy(attacker, victim)) return;
    victim.hp -= amount;
    victim.lastDamageTime = this.now;
    if (!selfHarm) victim.damageLog.push({ id: attacker.id, amount, time: this.now });
    const src = attacker && !selfHarm ? attacker.body : null;
    this.send(victim, {
      t: 'dmg', from: attacker && !selfHarm ? attacker.id : 0, amt: Math.round(amount), hp: Math.max(0, Math.round(victim.hp)),
      zone: info.zone ?? 1, kind: info.kind || 'bullet',
      x: src ? r2(src.x) : info.ox ?? null, z: src ? r2(src.z) : info.oz ?? null,
    });
    if (attacker && !selfHarm) {
      this.send(attacker, { t: 'hitok', v: victim.id, zone: info.zone ?? 1, amt: Math.round(amount), kill: victim.hp <= 0, kind: info.kind || 'bullet' });
    }
    if (victim.brain) victim.brain.onDamaged(attacker && !selfHarm ? attacker : null);
    if (victim.hp <= 0) this.kill(victim, attacker, info);
  }

  kill(victim, attacker, info = {}) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.deathTime = this.now;
    victim.respawnAt = this.now + this.modeDef.respawn;
    if (info.kind === 'switch') victim.respawnAt = this.now + 1;
    victim.streak = 0;
    const counts = info.kind !== 'switch';
    if (counts) victim.deaths++;
    const enemyKill = attacker && attacker !== victim && this.isEnemy(attacker, victim);
    const headshot = info.zone === HIT_ZONES.HEAD && info.kind === 'bullet';
    if (enemyKill) {
      attacker.kills++;
      attacker.streak++;
      attacker.score += 100 + (headshot ? 50 : 0) + (info.kind === 'melee' ? 50 : 0);
      if (this.modeDef.teams) this.teamScores[attacker.team]++;
    } else if (attacker && attacker !== victim) {
      attacker.score = Math.max(0, attacker.score - 100); // team kill
    } else if (counts && info.kind !== 'switch') {
      victim.score = Math.max(0, victim.score - 50);
    }
    // Assist.
    let assister = null;
    if (counts) {
      const totals = new Map();
      for (const e of victim.damageLog) {
        if (this.now - e.time > 15) continue;
        if (attacker && e.id === attacker.id) continue;
        totals.set(e.id, (totals.get(e.id) || 0) + e.amount);
      }
      let bestAmt = 34;
      for (const [id, amt] of totals) {
        if (amt > bestAmt) { const q = this.players.get(id); if (q && this.isEnemy(q, victim)) { assister = q; bestAmt = amt; } }
      }
      if (assister) { assister.assists++; assister.score += 50; }
    }
    victim.damageLog = [];
    if (!info.silent) {
      const wIdx = info.weapon && WEAPON_INDEX[info.weapon] !== undefined ? WEAPON_INDEX[info.weapon] : -1;
      this.broadcast({
        t: 'kill', k: attacker ? attacker.id : 0, v: victim.id, w: wIdx, special: wIdx < 0 ? (info.weapon || info.kind || 'world') : null,
        hs: headshot ? 1 : 0, d: Math.round(info.dist || 0), a: assister ? assister.id : 0, streak: enemyKill ? attacker.streak : 0,
        respawn: Math.round((victim.respawnAt - this.now) * 10) / 10,
      });
    }
    // Score limit.
    if (this.state === 'playing') {
      if (this.modeDef.teams) {
        if (this.teamScores[0] >= this.scoreLimit || this.teamScores[1] >= this.scoreLimit) this.endMatch();
      } else if (enemyKill && attacker.kills >= this.scoreLimit) this.endMatch();
    }
  }

  results() {
    const list = [...this.players.values()].map((p) => this.publicPlayer(p));
    list.sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
    return list;
  }

  endMatch() {
    if (this.state !== 'playing') return;
    this.state = 'ended';
    this.nextMatchAt = this.now + 15;
    const results = this.results();
    let winner = null;
    if (this.modeDef.teams) {
      winner = this.teamScores[0] === this.teamScores[1] ? -1 : this.teamScores[0] > this.teamScores[1] ? 0 : 1;
    } else winner = results[0] ? results[0].id : null;
    this.nextMap = this.rotation ? MAP_IDS[(MAP_IDS.indexOf(this.mapId) + 1) % MAP_IDS.length] : this.mapId;
    this.broadcast({ t: 'match', state: 'ended', winner, teamScores: this.teamScores, results, mvp: results[0] || null, nextMap: this.nextMap, nextIn: 15 });
  }

  restartMatch() {
    const changed = this.nextMap && this.nextMap !== this.mapId;
    if (changed) this.loadWorld(this.nextMap);
    this.resetMatch();
    for (const p of this.players.values()) {
      if (p.brain) p.brain.reset();
      if (!p.isBot) this.send(p, this._welcome(p));
    }
    this.broadcast({ t: 'match', state: 'playing', mapId: this.mapId });
  }

  // ------------------------------------------------------------------ simulation
  tick(dt) {
    this.now += dt;
    this.pathBudget = 4;
    if (this.state === 'playing' && this.now - this.matchStart >= this.timeLimit) this.endMatch();
    if (this.state === 'ended' && this.now >= this.nextMatchAt) this.restartMatch();
    const hasBots = [...this.players.values()].some((p) => p.isBot);
    if (hasBots) this.ensureNav();

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (p.isBot && this.state === 'playing' && this.now >= p.respawnAt) this.spawn(p);
        continue;
      }
      p.spawnProtected = this.now < p.spawnProtectUntil;
      if (p.isBot) {
        const w = WEAPONS[p.weapon];
        if (p.reloadUntil && this.now >= p.reloadUntil) { p.mag = p.reloadEndMag || (w ? w.mag : 30); p.reloadUntil = 0; }
        p.brain.update(dt);
        p.input.speedMult = w ? w.moveSpeed : 1;
        const ev = stepBody(this.world, p.body, p.input, dt);
        if (ev.landed && ev.fallDistance > 4.5) this.applyDamage(p, p, fallDamage(ev.fallDistance), { kind: 'fall' });
        let f = FLAG.ALIVE | FLAG.BOT;
        if (p.input.ads) f |= FLAG.ADS;
        if (p.body.sprinting) f |= FLAG.SPRINT;
        if (this.now < p.reloadUntil) f |= FLAG.RELOAD;
        if (p.body.onGround) f |= FLAG.GROUND;
        p.flags = f;
        p.lean = 0;
      }
      // Regeneration.
      if (this.now - p.lastDamageTime > PLAYER.regenDelay && p.hp < PLAYER.maxHealth) {
        p.hp = Math.min(PLAYER.maxHealth, p.hp + PLAYER.regenRate * dt);
      }
      // Out of bounds.
      const b = p.body;
      if (!this.world.inPlayArea(b.x, b.z)) {
        if (p.oobSince === null) { p.oobSince = this.now; this.send(p, { t: 'oob', left: 10 }); }
        else if (this.now - p.oobSince > 10) this.applyDamage(p, p, 1000, { kind: 'oob' });
      } else if (p.oobSince !== null) {
        p.oobSince = null;
        this.send(p, { t: 'oob', left: null });
      }
      updateHitboxes(p.hitboxes, b.x, b.y, b.z, p.yaw, b.stance, p.lean);
    }
    this._updateGrenades(dt);

    this.snapAcc += dt;
    if (this.snapAcc >= 0.05) {
      this.snapAcc = 0;
      this._sendSnapshot();
    }
    this.stateAcc += dt;
    if (this.stateAcc >= 0.5) {
      this.stateAcc = 0;
      this._sendState();
    }
    this.pingAcc += dt;
    if (this.pingAcc >= 2) {
      this.pingAcc = 0;
      this.broadcast({ t: 'ping', s: Math.round(this.now * 1000) });
    }
  }

  _sendSnapshot() {
    const ps = [];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const b = p.body;
      let f = p.flags | FLAG.ALIVE;
      if (p.spawnProtected) f |= FLAG.PROTECT;
      if (this.now < p.firingUntil) f |= FLAG.FIRING;
      ps.push([p.id, r2(b.x), r2(b.y), r2(b.z), r3(p.yaw), r3(p.pitch), b.stance, f, WEAPON_INDEX[p.weapon] ?? 0, r2(p.lean), r2(b.vx), r2(b.vz)]);
    }
    const gs = this.grenades.map((g) => [g.id, r2(g.x), r2(g.y), r2(g.z)]);
    this.broadcast({ t: 'snap', st: Math.round(this.now * 1000), p: ps, g: gs });
  }

  _sendState() {
    const sc = [];
    for (const p of this.players.values()) sc.push([p.id, p.kills, p.deaths, p.assists, p.score, p.ping, p.alive ? 1 : 0, Math.round(p.hp)]);
    this.broadcast({ t: 'state', tl: Math.round(this.timeLeft), ts: this.teamScores, s: this.state, sc });
  }
}

// ------------------------------------------------------------------ helpers
function clampInt(v, a, b) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return a;
  return Math.max(a, Math.min(b, v));
}

/** Random direction inside a cone of half-angle `ang` around (fx, fy, fz). */
export function spreadDir(fx, fy, fz, ang, rng) {
  if (ang <= 0) return [fx, fy, fz];
  // Orthonormal basis.
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(fy) > 0.95) { ux = 1; uy = 0; }
  let rx = uy * fz - uz * fy, ry = uz * fx - ux * fz, rz = ux * fy - uy * fx;
  let l = Math.hypot(rx, ry, rz);
  rx /= l; ry /= l; rz /= l;
  const vx = fy * rz - fz * ry, vy = fz * rx - fx * rz, vz = fx * ry - fy * rx;
  const r = Math.sqrt(rng.next()) * Math.tan(ang);
  const a = rng.next() * Math.PI * 2;
  const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
  let dx = fx + rx * ca + vx * sa, dy = fy + ry * ca + vy * sa, dz = fz + rz * ca + vz * sa;
  l = Math.hypot(dx, dy, dz);
  return [dx / l, dy / l, dz / l];
}

function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz || 1;
  let t = ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
  return px * px + py * py + pz * pz < r * r;
}

/** Grenade physics step (bounces on terrain and colliders). Shared with the client for visuals. */
export function stepGrenade(col, g, dt) {
  g.vy -= PLAYER.gravity * dt;
  const sp = Math.hypot(g.vx, g.vy, g.vz);
  if (sp < 1e-4) return;
  const dist = sp * dt;
  const dx = g.vx / sp, dy = g.vy / sp, dz = g.vz / sp;
  const hit = col.raycast(g.x, g.y, g.z, dx, dy, dz, dist + 0.06, { includeNonShoot: true });
  if (hit) {
    // Move to the contact point and reflect.
    const t = Math.max(0, hit.t - 0.05);
    g.x += dx * t; g.y += dy * t; g.z += dz * t;
    const vn = g.vx * hit.nx + g.vy * hit.ny + g.vz * hit.nz;
    g.vx -= 1.45 * vn * hit.nx; g.vy -= 1.45 * vn * hit.ny; g.vz -= 1.45 * vn * hit.nz;
    g.vx *= 0.62; g.vy *= 0.62; g.vz *= 0.62;
    g.bounced = (g.bounced || 0) + 1;
    if (hit.ny > 0.6 && Math.hypot(g.vx, g.vy, g.vz) < 1.2) { g.vx = g.vy = g.vz = 0; g.rest = true; }
  } else {
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
  }
  const ground = col.terrain.heightAt(g.x, g.z);
  if (g.y < ground + 0.05) { g.y = ground + 0.05; if (g.vy < 0) g.vy = 0; }
}
