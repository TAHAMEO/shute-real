// SHUTE REAL client: owns the renderer, world, menus/HUD, local player, weapons, remote
// players, networking (solo room or server) and the main loop.
import * as THREE from 'three';
import { World } from '/shared/world.js';
import { MAPS, MAP_BY_ID } from '/shared/maps.js';
import { MODES, TEAMS, PLAYER, STANCE } from '/shared/constants.js';
import { WEAPONS, WEAPON_INDEX, weaponByIndex, sanitizeLoadout } from '/shared/weapons.js';
import { RenderSystem } from '../engine/renderer.js';
import { Input } from '../engine/input.js';
import { WorldView } from '../world/world-view.js';
import { buildMapImage } from '../world/minimap.js';
import { LocalPlayer } from './local-player.js';
import { WeaponController } from './weapons.js';
import { Viewmodel } from './viewmodel.js';
import { Effects } from './effects.js';
import { Projectiles } from './projectiles.js';
import { RemotePlayers } from './remote-players.js';
import { GrenadeVisuals } from './grenades.js';
import { NetTransport, LocalTransport, defaultServerUrl, serverUrlFromAddress } from '../net/transport.js';
import { loadSettings, saveSettings, loadLoadout, saveLoadout, applyPreset } from '../settings.js';

const DEG = Math.PI / 180;
const AMBIENT = { valley: 'valley', outpost: 'outpost', ridge: 'alpine' };
const SPECIAL_WEAPON_NAMES = { frag: 'Frag Grenade', knife: 'Knife', fall: 'Fall Damage', oob: 'Left Combat Area', suicide: 'Suicide', explosion: 'Explosion', world: 'World' };

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.settings = loadSettings();
    this.loadout = loadLoadout();
    this.state = 'boot';     // boot | menu | loading | playing
    this.world = null;
    this.view = null;
    this.mapId = null;
    this.transport = null;
    this.lobby = null;
    this.myId = -1;
    this.myTeam = -1;
    this.mode = 'ffa';
    this.modeTeams = false;
    this.players = new Map(); // id -> public info
    this.hp = PLAYER.maxHealth;
    this.alive = false;
    this.matchState = 'playing';
    this.timeLeft = 0;
    this.teamScores = [0, 0];
    this.serverOffset = null;
    this.lastFrame = performance.now();
    this.inputAcc = 0;
    this.fps = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this.deathCam = null;
    this.paused = false;
    this.scoreboardOpen = false;
    this.bigMapOpen = false;
    this.hudVisible = true;
    this.menuOrbit = 0;
    this.respawnAt = 0;
    this.killStreak = 0;
    this.lastKillTime = -10;
    this.multiKill = 0;
    this.oobLeft = null;
    this.pingMs = null;
    this.session = this._makeSessionApi();
  }

  // ---------------------------------------------------------------------------- boot
  async boot() {
    const rs = new RenderSystem(this.canvas);
    this.rs = rs;
    if (rs.softwareGPU && !localStorage.getItem('shute-real.gpuWarned')) {
      // Software rendering (VM without GPU passthrough): start on the Low preset.
      this.settings = applyPreset(this.settings, 'low');
      try { localStorage.setItem('shute-real.gpuWarned', '1'); } catch { /* ignore */ }
      this._softwareNotice = true;
    }
    this.input = new Input(this.canvas);
    this.input.onLockChange = (locked) => this._onLockChange(locked);
    this._resize();
    window.addEventListener('resize', () => this._resize());

    // UI.
    const [{ MenuUI }, { HUD }] = await Promise.all([import('../ui/menu.js'), import('../ui/hud.js')]);
    this.hud = new HUD(this.uiRoot);
    this.hud.setVisible(false);
    this.hud.callbacks = {
      onOpenLoadout: () => { this.menu.setInMatch(true); this.menu.show('loadout'); },
      onDeploy: () => this._deploy(),
    };
    this.menu = new MenuUI(this.uiRoot, {
      onPlaySolo: (cfg) => this.startSolo(cfg),
      onRefreshRooms: () => this._lobbySend({ t: 'list' }),
      onCreateRoom: (cfg) => this.createRoom(cfg),
      onJoinRoom: (id) => this.joinRoom(id),
      onConnectServer: (addr) => this.connectLobby(serverUrlFromAddress(addr)),
      onLoadoutChange: (lo) => { this.loadout = sanitizeLoadout(lo); saveLoadout(this.loadout); this._sendLoadout(); },
      onSettingsChange: (s) => this.applySettings(s),
      onPlayerNameChange: (name) => { this.settings.playerName = name; saveSettings(this.settings); },
      onResume: () => this.resume(),
      onLeaveMatch: () => this.leaveMatch(),
      onQuit: () => this._quit(),
      onSound: (name) => this.audio?.playUI(name === 'back' ? 'back' : name),
    });
    this.menu.setSettings(this.settings);
    this.menu.setLoadout(this.loadout);
    this.menu.setLoading(true, 0.05, 'Starting engine');

    // Audio (bank synthesis starts on the first user gesture).
    try {
      const { AudioEngine } = await import('../engine/audio.js');
      this.audio = new AudioEngine();
      const unlock = () => {
        this.audio.init();
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
      this.audio.setVolumes(this.settings.audio);
    } catch (e) {
      console.warn('Audio unavailable', e);
      this.audio = null;
    }

    // Background world for the main menu (also the first map players usually pick).
    await this.loadWorld('valley', (p, text) => this.menu.setLoading(true, 0.1 + p * 0.85, text));
    this.applySettings(this.settings, false);
    this.menu.setLoading(false);
    this.state = 'menu';
    this.menu.show('main');
    if (this._softwareNotice) {
      this.menu.showToast('No GPU acceleration detected (virtual machine?). Graphics set to LOW. Enable 3D acceleration for ultra graphics.', 'info');
    }
    this.connectLobby(defaultServerUrl(), true);
    requestAnimationFrame((t) => this._frame(t));
    window.__GAME = this;
    window.__READY = true;
  }

  _resize() {
    this.rs.setSize(window.innerWidth, window.innerHeight);
    this._applyFov();
  }

  _applyFov(zoom = 1) {
    const h = this.settings.gameplay.fov || 90;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const v = 2 * Math.atan(Math.tan((h * DEG) / 2) / aspect) / DEG;
    const fov = Math.max(8, v / zoom);
    if (Math.abs(this.rs.camera.fov - fov) > 0.01) {
      this.rs.camera.fov = fov;
      this.rs.camera.updateProjectionMatrix();
    }
    this.baseVFov = v;
    if (this.rs.vmCamera.fov !== 52) {
      this.rs.vmCamera.fov = 52;
      this.rs.vmCamera.updateProjectionMatrix();
    }
  }

  applySettings(s, save = true) {
    this.settings = s;
    if (save) saveSettings(s);
    const g = s.graphics;
    this.rs.setQuality({ renderScale: g.renderScale, ao: g.ao, bloom: g.bloom, antialias: g.antialias, godrays: g.godrays, shadows: g.shadows });
    this.view?.setQuality(g);
    this._applyFov();
    this.audio?.setVolumes(s.audio);
    if (this.player) this.player.headBob = s.gameplay.headBob;
    this.hud?.setFps(g.showFps ? this.fps : null);
  }

  // ---------------------------------------------------------------------------- world
  async loadWorld(mapId, onProgress = () => {}) {
    if (this.mapId === mapId && this.view) return;
    onProgress(0, `Generating ${MAP_BY_ID[mapId]?.name || mapId}`);
    await new Promise((r) => setTimeout(r, 30));
    if (this.view) {
      this._disposeGameplay();
      this.view.dispose();
      this.view = null;
    }
    const world = new World(mapId);
    this.world = world;
    this.mapId = mapId;
    const view = new WorldView(this.rs, world);
    await view.build((p, text) => onProgress(0.15 + p * 0.8, text), this.settings.graphics);
    this.view = view;
    this.mapImage = buildMapImage(world, 1024);
    this._createGameplay();
    // Warm up soldier textures/geometry so the first enemy sighting doesn't stall.
    try {
      const sm = await import('../models/soldier.js');
      sm.preloadSoldierAssets?.([{ team: 0, variant: 0, lod: 'high' }, { team: 1, variant: 1, lod: 'high' }, { team: -1, variant: 2, lod: 'high' }]);
    } catch { /* optional */ }
    onProgress(1, 'Ready');
  }

  _createGameplay() {
    this.effects = new Effects(this.rs.scene, this.world);
    this.effects.onShellLand = (s) => { /* casing sounds are played at eject time */ void s; };
    this.player = new LocalPlayer(this.world);
    this.player.headBob = this.settings.gameplay.headBob;
    this.remotes = new RemotePlayers(this);
    this.projectiles = new Projectiles({
      world: this.world, effects: this.effects, audio: this.audio, remotes: this.remotes,
      onLocalHit: (victimId, zone, dist, pen) => this._onLocalHit(victimId, zone, dist, pen),
    });
    this.projectiles.onNearMiss = (d) => { this.player.addShake(0.15); this.rs.fx.aberration = 0.015 + (3.5 - d) * 0.02; };
    this.weapons = new WeaponController(this);
    if (!this.viewmodel) this.viewmodel = new Viewmodel(this);
    this.viewmodel.setVisible(false);
    this.grenades = new GrenadeVisuals(this);
  }

  _disposeGameplay() {
    this.effects?.dispose();
    this.remotes?.dispose();
    this.grenades?.clear();
    this.projectiles?.clear();
  }

  // ---------------------------------------------------------------------------- session api
  _makeSessionApi() {
    const game = this;
    return {
      get modeTeams() { return game.modeTeams; },
      isEnemy(id) {
        if (id === game.myId) return false;
        if (!game.modeTeams) return true;
        const p = game.players.get(id);
        return !p || p.team !== game.myTeam;
      },
      sendFire(w, o, d) { game._send({ t: 'fire', w, o: o.map((v) => +v.toFixed(2)), d }); },
      sendHit(v, z, dist, w, pen) { game._send({ t: 'hit', v, z, dist: +dist.toFixed(1), w, pen: pen ? 1 : 0 }); },
      sendNade(k, o, v) { game._send({ t: 'nade', k, o: o.map((x) => +x.toFixed(2)), v: v.map((x) => +x.toFixed(2)) }); },
      sendMelee(v) { game._send({ t: 'melee', v }); },
    };
  }

  _send(msg) {
    this.transport?.send(msg);
  }

  _sendLoadout() {
    if (this.state === 'playing') this._send({ t: 'loadout', loadout: this.loadout });
  }

  // ---------------------------------------------------------------------------- lobby
  async connectLobby(url, quiet = false) {
    if (this.lobby && this.lobby.url === url && this.lobby.connected) {
      this._lobbySend({ t: 'list' });
      return this.lobby;
    }
    // Never run two connection attempts at once (they would race for this.lobby).
    if (this._lobbyConnecting) return this._lobbyConnecting;
    this._lobbyConnecting = this._connectLobby(url, quiet).finally(() => { this._lobbyConnecting = null; });
    return this._lobbyConnecting;
  }

  async _connectLobby(url, quiet) {
    if (this.lobby && this.lobby !== this.transport) this.lobby.close();
    this.lobby = null;
    const t = new NetTransport(url);
    try {
      await t.connect(9000);
    } catch (e) {
      this.menu.setServerInfo({ connected: false, address: url.replace(/^wss?:\/\//, '').replace(/\/ws$/, ''), lanUrls: [], playersOnline: 0, error: quiet ? 'Offline — start the server with ./start.sh to play multiplayer' : e.message });
      if (!quiet) this.menu.showToast(e.message, 'error');
      return null;
    }
    this.lobby = t;
    t.onMessage((m) => this._onLobbyMessage(m, t));
    t.onClose(() => {
      if (this.lobby === t) this.lobby = null;
      this.menu.setServerInfo({ connected: false, address: url, lanUrls: [], playersOnline: 0, error: 'Disconnected from server' });
      if (this.transport === t) this._onDisconnected();
    });
    t.send({ t: 'hello', name: this.settings.playerName });
    return t;
  }

  _lobbySend(msg) {
    if (this.lobby?.connected) this.lobby.send(msg);
    else this.connectLobby(defaultServerUrl(), true);
  }

  _onLobbyMessage(m, socket) {
    if (socket !== this.lobby && socket !== this.transport) return; // stale connection
    switch (m.t) {
      case 'hello':
        this.menu.setServerInfo({ connected: true, address: socket.url.replace(/^wss?:\/\//, '').replace(/\/ws$/, ''), lanUrls: m.lanUrls || [], playersOnline: m.playersOnline || 0, error: null });
        this.menu.setRooms(m.rooms || []);
        break;
      case 'rooms':
        this.menu.setRooms(m.rooms || []);
        break;
      case 'created':
        this.joinRoom(m.id);
        break;
      case 'error':
        this.menu.showToast(m.msg || 'Server error', 'error');
        if (this.state === 'loading') { this.state = 'menu'; this.menu.setLoading(false); this.menu.show('multiplayer'); }
        break;
      default:
        if (this.transport === socket) this._onMessage(m);
    }
  }

  createRoom(cfg) {
    this._lobbySend({ t: 'create', config: cfg });
  }

  joinRoom(id) {
    if (!this.lobby?.connected) { this.menu.showToast('Not connected to a server', 'error'); return; }
    this._leaveTransport();
    this.transport = this.lobby;
    this.state = 'loading';
    this.menu.setLoading(true, 0.05, 'Joining match');
    this.lobby.send({ t: 'join', id, name: this.settings.playerName, loadout: this.loadout });
  }

  // ---------------------------------------------------------------------------- solo
  async startSolo(cfg) {
    this._leaveTransport();
    this.state = 'loading';
    const mapId = cfg.mapId || 'valley';
    this.menu.setLoading(true, 0.02, { mapId, title: MAP_BY_ID[mapId]?.name, status: 'Preparing' });
    await this.loadWorld(mapId, (p, text) => this.menu.setLoading(true, p * 0.9, { mapId, title: MAP_BY_ID[mapId]?.name, status: text }));
    this.menu.setLoading(true, 0.92, { mapId, title: MAP_BY_ID[mapId]?.name, status: 'Deploying squad' });
    const t = new LocalTransport({
      name: 'Solo', mapId, mode: cfg.mode || 'tdm', bots: cfg.bots ?? 8, difficulty: cfg.difficulty || 'normal',
      timeLimit: cfg.timeLimit, scoreLimit: cfg.scoreLimit, maxPlayers: Math.min(16, (cfg.bots ?? 8) + 1), host: this.settings.playerName,
    }, { world: this.world });
    this.transport = t;
    t.onMessage((m) => this._onMessage(m));
    t.join(this.settings.playerName, this.loadout);
    t.flush();
  }

  _leaveTransport() {
    if (!this.transport) return;
    if (this.transport.isLocal) this.transport.close();
    else if (this.transport === this.lobby) this.lobby.send({ t: 'leave' });
    this.transport = null;
  }

  leaveMatch() {
    this._leaveTransport();
    this._endMatchView();
    this.state = 'menu';
    this.menu.setInMatch(false);
    this.menu.show('main');
    this._lobbySend({ t: 'list' });
  }

  _onDisconnected() {
    if (this.state === 'playing' || this.state === 'loading') {
      this.transport = null;
      this._endMatchView();
      this.state = 'menu';
      this.menu.setLoading(false);
      this.menu.setInMatch(false);
      this.menu.show('main');
      this.menu.showToast('Lost connection to the server', 'error');
    }
  }

  _endMatchView() {
    this.input.unlock();
    this.hud.setVisible(false);
    this.hud.hideDeath();
    this.hud.hideMatchEnd();
    this.hud.setScoreboard(false, null);
    this.hud.setBigMap(false, null);
    this.viewmodel.setVisible(false);
    this.remotes.clear();
    this.grenades.clear();
    this.projectiles.clear();
    this.players.clear();
    this.alive = false;
    this.player.alive = false;
    this.audio?.stopAmbient();
    this.audio?.setLowHealth(0);
    this.rs.fx.lowHealth = 0;
    this.rs.fx.damage = 0;
    this.rs.fx.scope = 0;
  }

  _quit() {
    this.menu.showToast('Close the browser tab or press Ctrl+W to quit.', 'info');
  }

  // ---------------------------------------------------------------------------- messages
  async _onMessage(m) {
    switch (m.t) {
      case 'welcome': await this._onWelcome(m); break;
      case 'pjoin': this._addPlayer(m.p); if (m.p.id !== this.myId) this.audio?.playUI('join'); break;
      case 'pleave': this.players.delete(m.id); this.remotes.remove(m.id); break;
      case 'pteam': {
        const p = this.players.get(m.id);
        if (p) p.team = m.team;
        if (m.id === this.myId) { this.myTeam = m.team; this.viewmodel.setTeam(m.team); } else this.remotes.setTeam(m.id, m.team);
        break;
      }
      case 'snap': {
        const st = m.st / 1000;
        const local = performance.now() / 1000;
        const off = st - local;
        this.serverOffset = this.serverOffset === null || Math.abs(off - this.serverOffset) > 1 ? off : this.serverOffset + (off - this.serverOffset) * 0.05;
        this.remotes.onSnapshot(m, st);
        this.grenades.correct(m.g || []);
        break;
      }
      case 'state': this._onState(m); break;
      case 'spawn': this._onSpawn(m); break;
      case 'fire': this.remotes.onFire(m); break;
      case 'dmg': this._onDamage(m); break;
      case 'hitok': this._onHitConfirm(m); break;
      case 'kill': this._onKill(m); break;
      case 'nade': this.grenades.add(m); break;
      case 'boom': this.grenades.boom(m); break;
      case 'melee': {
        const r = this.remotes.get(m.id);
        if (r) this.audio?.playMechanical('knife_swing', { position: { x: r.pos.x, y: r.pos.y + 1.4, z: r.pos.z }, isLocal: false });
        break;
      }
      case 'chat':
        this.hud.addChat({ name: m.name, team: m.team, text: m.text, system: !!m.sys, teamOnly: !!m.tm });
        if (!m.sys) this.audio?.playUI('chat');
        break;
      case 'match': this._onMatch(m); break;
      case 'correct':
        this.player.body.x = m.x; this.player.body.y = m.y; this.player.body.z = m.z;
        this.player.prev.set(m.x, m.y, m.z);
        break;
      case 'oob':
        this.oobLeft = m.left;
        this.hud.setOutOfBounds(m.left);
        break;
      case 'ping':
        this._send({ t: 'pong', s: m.s });
        break;
      case 'error':
        this.menu.showToast(m.msg || 'Error', 'error');
        break;
      default: break;
    }
  }

  async _onWelcome(m) {
    this.myId = m.you;
    this.mode = m.mode;
    this.modeTeams = !!MODES[m.mode]?.teams;
    if (m.mapId !== this.mapId) {
      this.state = 'loading';
      await this.loadWorld(m.mapId, (p, text) => this.menu.setLoading(true, p * 0.95, { mapId: m.mapId, title: MAP_BY_ID[m.mapId]?.name, status: text }));
      if (this.world.checksum() !== m.checksum) console.warn('World checksum mismatch with server — collisions may differ.');
    }
    this.remotes.clear();
    this.grenades.clear();
    this.players.clear();
    this.projectiles.localId = this.myId;
    for (const p of m.players) this._addPlayer(p);
    const me = this.players.get(this.myId);
    this.myTeam = me ? me.team : -1;
    this.viewmodel.setTeam(this.myTeam);
    this.teamScores = m.teamScores || [0, 0];
    this.timeLeft = m.timeLeft;
    this.matchState = m.state;
    this.scoreLimit = m.scoreLimit;
    this.roomInfo = m.room;
    this.state = 'playing';
    this.menu.setLoading(false);
    this.menu.setInMatch(true);
    this.menu.show('none');
    this.hud.setVisible(true);
    this.hud.hideMatchEnd();
    this.alive = false;
    this.player.alive = false;
    this.audio?.startAmbient(AMBIENT[this.mapId] || 'valley');
    this.audio?.setPaused(false);
    this.audio?.playUI('match_start');
    this.hud.showMessage(MAP_BY_ID[this.mapId]?.name.toUpperCase() || 'DEPLOY', { kind: 'big', duration: 3, sub: MODES[this.mode]?.name });
    this._deploy();
    this.input.lock();
  }

  _addPlayer(p) {
    this.players.set(p.id, { ...p });
    if (p.id !== this.myId) {
      const r = this.remotes.add(p);
      if (r && p.alive === false) r.alive = false;
    }
  }

  _deploy() {
    if (this.alive || this.state !== 'playing') return;
    this._send({ t: 'deploy', loadout: this.loadout });
  }

  _onSpawn(m) {
    const p = this.players.get(m.id);
    if (p) { p.alive = true; p.loadout = m.lo; if (m.team !== undefined) p.team = m.team; }
    if (m.id !== this.myId) { this.remotes.onSpawn(m); return; }
    this.alive = true;
    this.hp = PLAYER.maxHealth;
    this.deathCam = null;
    this.player.spawn(m.x, m.y, m.z, m.yaw);
    this.loadout = sanitizeLoadout(m.lo);
    this.weapons.setLoadout(this.loadout);
    this.viewmodel.setVisible(true);
    this.hud.hideDeath();
    this.hud.setHealth(this.hp, PLAYER.maxHealth);
    this.hud.setSpawnProtection(true);
    this._protectUntil = performance.now() + (m.prot || 2) * 1000;
    this.rs.fx.lowHealth = 0;
    this.audio?.setLowHealth(0);
    this.audio?.playUI('spawn');
    if (this.menu.isOpen() && this.menu.screen === 'loadout') this.menu.show('none');
  }

  _onState(m) {
    this.timeLeft = m.tl;
    this.teamScores = m.ts;
    this.matchState = m.s;
    for (const row of m.sc) {
      const p = this.players.get(row[0]);
      if (!p) continue;
      p.kills = row[1]; p.deaths = row[2]; p.assists = row[3]; p.score = row[4]; p.ping = row[5]; p.alive = !!row[6]; p.hp = row[7];
      const r = this.remotes.get(row[0]);
      if (r) r.hp = row[7];
      if (row[0] === this.myId) {
        this.pingMs = row[5];
        if (this.alive && row[6]) this.hp = row[7];
      }
    }
  }

  _onDamage(m) {
    this.hp = m.hp;
    this.hud.setHealth(this.hp, PLAYER.maxHealth);
    this.rs.fx.damage = Math.min(1, this.rs.fx.damage + 0.35 + m.amt / 100);
    this.player.addShake(Math.min(0.5, m.amt / 80));
    this.audio?.playHurt(true);
    if (m.x !== null && m.x !== undefined) {
      const b = this.player.body;
      const ang = Math.atan2(-(m.x - b.x), -(m.z - b.z)); // yaw that would face the attacker
      let rel = this.player.yaw - ang;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      this.hud.showDamage(rel);
    }
  }

  _onLocalHit(victimId, zone, dist, pen) {
    const w = this.weapons.def;
    this.session.sendHit(victimId, zone, dist, WEAPON_INDEX[w.id] ?? 0, pen);
    this.hud.showHitmarker(zone === 0 ? 'head' : 'hit');
    this.audio?.playHitmarker(zone === 0 ? 'head' : 'hit');
  }

  _onHitConfirm(m) {
    if (m.kill) {
      this.hud.showHitmarker('kill');
      this.audio?.playHitmarker(m.zone === 0 ? 'headkill' : 'kill');
    }
  }

  _weaponName(m) {
    if (m.w >= 0) return weaponByIndex(m.w)?.name || 'Unknown';
    return SPECIAL_WEAPON_NAMES[m.special] || m.special || '';
  }

  _onKill(m) {
    const killer = this.players.get(m.k);
    const victim = this.players.get(m.v);
    if (victim) { victim.alive = false; victim.deaths = (victim.deaths || 0); }
    const weaponName = this._weaponName(m);
    this.hud.addKillFeed({
      killer: killer && m.k !== m.v ? killer.name : '', killerTeam: killer ? killer.team : -1,
      victim: victim ? victim.name : '?', victimTeam: victim ? victim.team : -1,
      weapon: weaponName, headshot: !!m.hs, local: m.k === this.myId ? 'killer' : m.v === this.myId ? 'victim' : null,
    });
    const killerPos = m.k === this.myId ? this.player.body : this.remotes.get(m.k)?.pos;
    if (m.v === this.myId) {
      this._onLocalDeath(m, killer, weaponName, killerPos);
    } else {
      this.remotes.onDeath(m.v, killerPos);
    }
    if (m.k === this.myId && m.v !== this.myId) {
      const now = performance.now() / 1000;
      this.multiKill = now - this.lastKillTime < 4 ? this.multiKill + 1 : 1;
      this.lastKillTime = now;
      const names = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'QUAD KILL', 'RAMPAGE'];
      this.hud.showMessage(`${m.hs ? 150 : 100} ${m.hs ? 'HEADSHOT' : 'ELIMINATED'} ${victim ? victim.name.toUpperCase() : ''}`, { kind: 'kill', duration: 2.2 });
      if (this.multiKill >= 2) this.hud.showMessage(names[Math.min(5, this.multiKill)], { kind: 'big', duration: 2 });
      if (m.streak && m.streak % 5 === 0) { this.hud.showMessage(`${m.streak} KILL STREAK`, { kind: 'big', duration: 2.5 }); this.audio?.playUI('killstreak'); }
    }
    if (m.a === this.myId) this.hud.showMessage('50 ASSIST', { kind: 'kill', duration: 1.8 });
  }

  _onLocalDeath(m, killer, weaponName, killerPos) {
    this.alive = false;
    this.player.alive = false;
    this.hp = 0;
    this.viewmodel.setVisible(false);
    this.weapons.adsAmount = 0;
    this.rs.fx.scope = 0;
    const b = this.player.body;
    const eye = new THREE.Vector3(b.x, b.y + this.player.eyeY, b.z);
    this.deathCam = { t: 0, from: eye, target: killerPos ? new THREE.Vector3(killerPos.x, (killerPos.y || 0) + 1.4, killerPos.z) : eye.clone().add(new THREE.Vector3(0, -1, -1)) };
    this.respawnAt = performance.now() / 1000 + (m.respawn || 4);
    const self = !killer || m.k === m.v;
    this.hud.showDeath({
      killerName: self ? 'YOURSELF' : killer.name, killerTeam: killer ? killer.team : -1, weaponName,
      distance: m.d, headshot: !!m.hs, respawnIn: m.respawn || 4,
    });
    this.audio?.setLowHealth(0);
    this.rs.fx.lowHealth = 0;
  }

  _onMatch(m) {
    this.matchState = m.state;
    if (m.state === 'ended') {
      const me = this.players.get(this.myId);
      let title = 'MATCH OVER';
      if (this.modeTeams) title = m.winner === -1 ? 'DRAW' : m.winner === this.myTeam ? 'VICTORY' : 'DEFEAT';
      else title = m.winner === this.myId ? 'VICTORY' : 'MATCH OVER';
      this.hud.showMatchEnd({
        title, subtitle: this.modeTeams ? `${TEAMS[0].name} ${m.teamScores[0]} — ${m.teamScores[1]} ${TEAMS[1].name}` : `Winner: ${m.mvp ? m.mvp.name : '—'}`,
        players: m.results.map((p) => ({ ...p, isLocal: p.id === this.myId })), mvp: m.mvp, nextIn: m.nextIn,
      });
      this.audio?.playUI('match_end');
      this.input.unlock();
      void me;
    } else if (m.state === 'playing') {
      this.hud.hideMatchEnd();
    }
  }

  // ---------------------------------------------------------------------------- pause / lock
  _onLockChange(locked) {
    if (this.state !== 'playing') return;
    if (!locked && !this.menu.isOpen() && !this.hud.chatOpen && this.matchState !== 'ended' && !this._expectUnlock) {
      this.pause();
    }
    this._expectUnlock = false;
  }

  pause() {
    if (this.state !== 'playing') return;
    this.menu.setInMatch(true);
    this.menu.show('pause');
  }

  resume() {
    this.menu.show('none');
    if (this.state === 'playing') {
      this.input.lock();
      if (!this.alive && this.matchState === 'playing' && performance.now() / 1000 >= this.respawnAt) this._deploy();
    }
  }

  // ---------------------------------------------------------------------------- frame
  _frame(nowMs) {
    requestAnimationFrame((t) => this._frame(t));
    const lim = this.settings.graphics.fpsLimit;
    if (lim > 0 && nowMs - this.lastFrame < 1000 / lim - 1) return;
    const dt = Math.min(0.1, Math.max(0.0005, (nowMs - this.lastFrame) / 1000));
    this.lastFrame = nowMs;
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
      if (this.settings.graphics.showFps) this.hud.setFps(this.fps);
    }
    try {
      if (this.transport?.tick) this.transport.tick(dt);
      if (this.state === 'playing') this._updatePlaying(dt);
      else this._updateMenu(dt);
      this.rs.render(dt);
    } catch (e) {
      console.error(e);
    }
    this.input.endFrame();
  }

  _updateMenu(dt) {
    if (!this.view) return;
    // Slow cinematic orbit around the map's main point of interest.
    this.menuOrbit += dt * 0.025;
    const poi = this.world.pois[0];
    const r = 85;
    const x = poi.x + Math.cos(this.menuOrbit) * r;
    const z = poi.z + Math.sin(this.menuOrbit) * r;
    const y = this.world.terrain.heightAt(x, z) + 14 + Math.sin(this.menuOrbit * 1.7) * 3;
    const cam = this.rs.camera;
    cam.position.set(x, y, z);
    cam.lookAt(poi.x, this.world.terrain.heightAt(poi.x, poi.z) + 4, poi.z);
    this._applyFov();
    this.view.update(dt, cam);
    this.effects?.update(dt, cam);
    this.hud.update(dt);
  }

  _updatePlaying(dt) {
    const inp = this.input;
    const p = this.player;
    const menuOpen = this.menu.isOpen();
    const chat = this.hud.chatOpen;
    const active = this.alive && inp.locked && !menuOpen && !chat;
    inp.enabled = !menuOpen && !chat;
    // ---- global keys
    if (!menuOpen && !chat) {
      if (inp.hit('chat') || inp.hit('teamChat')) {
        const team = inp.hit('teamChat');
        this._expectUnlock = true;
        this.input.unlock();
        this.hud.openChat(team, (text) => {
          if (text) this._send({ t: 'chat', text, team });
          this.input.lock();
        });
      }
      this.scoreboardOpen = inp.down('scoreboard');
      if (inp.hit('map')) this.bigMapOpen = !this.bigMapOpen;
      if (inp.hit('toggleHud')) { this.hudVisible = !this.hudVisible; this.hud.setVisible(this.hudVisible); }
    }
    // ---- look + controls
    const mouse = inp.takeMouse();
    if (active) {
      const zoom = this.weapons.slot ? 1 + (this.weapons.slot.h.zoom - 1) * this.weapons.adsAmount : 1;
      const adsSens = 1 + (this.settings.controls.adsSensitivity - 1) * this.weapons.adsAmount;
      p.look(mouse.dx, mouse.dy, this.settings.controls.sensitivity * adsSens / zoom, this.settings.controls.invertY);
      p.readControls(inp, this.settings, this.weapons.adsAmount > 0.2 || inp.mouseDown(0));
    } else {
      p.input.fwd = 0; p.input.right = 0; p.input.sprint = false; p.leanTarget = 0;
    }
    // ---- simulation
    if (this.alive) {
      const events = p.update(dt);
      for (const e of events) this._playerEvent(e);
      this.weapons.update(dt, active);
      this.weapons.postUpdate();
      // FOV zoom while aiming.
      const slot = this.weapons.slot;
      const zoom = slot ? 1 + (slot.h.zoom - 1) * this.weapons.adsAmount : 1;
      this._applyFov(zoom);
      p.applyCamera(this.rs.camera, dt);
      // Network input at 30 Hz.
      this.inputAcc += dt;
      if (this.inputAcc >= 1 / 30) {
        this.inputAcc = 0;
        const b = p.body;
        let f = 0;
        if (p.ads) f |= 2;
        if (p.sprinting) f |= 4;
        if (this.weapons.state === 'reload' || this.weapons.state === 'reloadShell') f |= 8;
        if (b.onGround) f |= 16;
        this._send({
          t: 'in', x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), vx: +b.vx.toFixed(2), vy: +b.vy.toFixed(2), vz: +b.vz.toFixed(2),
          yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), st: b.stance, ln: +p.lean.toFixed(2), w: this._weaponIndex(), f,
        });
      }
      // Low health effects.
      const low = this.hp < 45 ? 1 - this.hp / 45 : 0;
      this.rs.fx.lowHealth += (low - this.rs.fx.lowHealth) * Math.min(1, dt * 3);
      this.audio?.setLowHealth(this.rs.fx.lowHealth);
      // Regen (mirrors the server so the HUD feels responsive; server values override).
      if (this._protectUntil && performance.now() > this._protectUntil) { this._protectUntil = 0; this.hud.setSpawnProtection(false); }
    } else {
      this._updateDeathCam(dt);
    }
    this.rs.fx.damage = Math.max(0, this.rs.fx.damage - dt * 1.4);
    this.rs.fx.flash = Math.max(0, this.rs.fx.flash - dt * 0.8);
    this.rs.fx.aberration += (0.015 - this.rs.fx.aberration) * Math.min(1, dt * 3);
    // Scope tunnel (no PiP) / magnified optic overlay.
    const slot = this.weapons.slot;
    this.rs.fx.scope = slot && slot.h.pip && this.alive ? Math.max(0, this.weapons.adsAmount - 0.7) * 1.2 : 0;

    // ---- world + entities
    const cam = this.rs.camera;
    const serverNow = performance.now() / 1000 + (this.serverOffset ?? 0);
    this.remotes.update(dt, serverNow, cam);
    if (this.alive) this.viewmodel.update(dt, mouse);
    this.projectiles.update(dt, cam.position);
    this.grenades.update(dt);
    this.effects.update(dt, cam);
    this.view.update(dt, cam);
    // ---- audio listener
    if (this.audio) {
      const fwd = cam.getWorldDirection(new THREE.Vector3());
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      this.audio.setListener(cam.position, fwd, up);
    }
    this._updateHud(dt);
  }

  _weaponIndex() {
    const id = this.weapons.slot?.id;
    return id ? WEAPON_INDEX[id] : 0;
  }

  _playerEvent(e) {
    const a = this.audio;
    if (!a) return;
    const b = this.player.body;
    switch (e.type) {
      case 'step': a.playFootstep(e.surface, { isLocal: true, sprinting: e.sprint, crouched: e.crouch }); break;
      case 'jump': a.playJump({ isLocal: true }); break;
      case 'land': a.playLand(e.impact, { isLocal: true, surface: e.surface }); break;
      case 'fall': this._send({ t: 'fall', dmg: Math.round(e.damage) }); break;
      default: break;
    }
    void b;
  }

  _updateDeathCam(dt) {
    const dc = this.deathCam;
    const cam = this.rs.camera;
    if (!dc) return;
    dc.t += dt;
    const k = Math.min(1, dc.t / 1.6);
    const s = k * k * (3 - 2 * k);
    cam.position.set(dc.from.x, dc.from.y + s * 2.2 - (1 - s) * 0.0, dc.from.z);
    cam.position.y -= Math.min(1.2, dc.t * 2) * (1 - s);
    const look = new THREE.Vector3().lerpVectors(new THREE.Vector3(dc.from.x, dc.from.y - 2, dc.from.z - 0.01), dc.target, s);
    cam.lookAt(look);
    cam.updateMatrixWorld();
    const left = this.respawnAt - performance.now() / 1000;
    this.hud.updateRespawn(Math.max(0, left));
  }

  _updateHud(dt) {
    const hud = this.hud;
    const p = this.player;
    const cam = this.rs.camera;
    hud.update(dt);
    if (!this.hudVisible) return;
    // Compass: heading 0 = north (-Z), clockwise.
    let heading = -p.yaw;
    while (heading < 0) heading += Math.PI * 2;
    hud.setCompass(heading % (Math.PI * 2));
    hud.setStance(p.body.stance);
    const w = this.weapons;
    const showCross = this.alive && w.adsAmount < 0.5 && !p.sprinting && w.state !== 'throw' && w.state !== 'melee';
    hud.setCrosshair({
      visible: showCross, spread: w.slot ? w.crosshairGap(cam.fov, window.innerHeight) : 8,
      style: this.settings.gameplay.crosshair, color: this.settings.gameplay.crosshairColor,
    });
    // Match info.
    const me = this.players.get(this.myId);
    let leader = null;
    for (const q of this.players.values()) if (!leader || (q.score || 0) > (leader.score || 0)) leader = q;
    hud.setMatchInfo({
      mode: this.mode, timeLeft: this.timeLeft, scoreLimit: this.scoreLimit, myTeam: this.myTeam, teamScores: this.teamScores,
      myScore: me ? (this.modeTeams ? me.score : me.kills) : 0, leaderName: leader ? leader.name : '', leaderScore: leader ? (this.modeTeams ? leader.score : leader.kills) : 0,
      state: this.matchState,
    });
    // Minimap.
    if (this.settings.gameplay.showMinimap && this.mapImage) {
      const friendlies = [];
      const enemies = [];
      for (const r of this.remotes.list) {
        if (!r.alive) continue;
        if (this.modeTeams && r.team === this.myTeam) friendlies.push({ x: r.pos.x, z: r.pos.z, yaw: r.yaw });
        else if (r.firingT > 0 && !r.suppressed) enemies.push({ x: r.pos.x, z: r.pos.z });
      }
      hud.setMinimap({ visible: true, image: this.mapImage, worldSize: this.world.size, rotate: true, player: { x: p.body.x, z: p.body.z, yaw: p.yaw }, friendlies, enemies, objectives: [] });
    } else hud.setMinimap({ visible: false });
    if (this.bigMapOpen) {
      const friendlies = this.remotes.list.filter((r) => r.alive && this.modeTeams && r.team === this.myTeam).map((r) => ({ x: r.pos.x, z: r.pos.z, yaw: r.yaw }));
      hud.setBigMap(true, { image: this.mapImage, worldSize: this.world.size, player: { x: p.body.x, z: p.body.z, yaw: p.yaw }, friendlies, mapName: MAP_BY_ID[this.mapId]?.name });
    } else hud.setBigMap(false, null);
    // Scoreboard.
    if (this.scoreboardOpen) {
      hud.setScoreboard(true, {
        mode: this.mode, mapName: MAP_BY_ID[this.mapId]?.name, teamScores: this.teamScores, timeLeft: this.timeLeft, scoreLimit: this.scoreLimit,
        players: [...this.players.values()].map((q) => ({ id: q.id, name: q.name, team: q.team, kills: q.kills || 0, deaths: q.deaths || 0, assists: q.assists || 0, score: q.score || 0, ping: q.isBot ? 0 : q.ping || 0, isBot: q.isBot, isLocal: q.id === this.myId, alive: q.alive })),
      });
    } else hud.setScoreboard(false, null);
    // Squad list (TDM).
    if (this.modeTeams) {
      const squad = [...this.players.values()].filter((q) => q.team === this.myTeam).slice(0, 7).map((q) => ({ name: q.name, alive: q.id === this.myId ? this.alive : q.alive !== false, isLocal: q.id === this.myId }));
      hud.setSquad(squad);
    }
    // Nameplates.
    const aim = this.alive ? cam.getWorldDirection(new THREE.Vector3()) : null;
    hud.setNameplates(this.remotes.nameplates(cam, window.innerWidth, window.innerHeight, this.myTeam, this.modeTeams, aim));
    hud.setPing(this.transport && !this.transport.isLocal ? this.pingMs : null);
    if (this.alive) hud.setHealth(this.hp, PLAYER.maxHealth);
  }
}
