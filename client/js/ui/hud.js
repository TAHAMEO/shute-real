// SHUTE REAL — in-game HUD: compass, match info, minimap, kill feed, health, squad, chat, ammo,
// stance, crosshair, hitmarkers, damage indicators, messages, nameplates, scoreboard, big map,
// death screen and match end. Per-frame setters only touch the DOM when values change; animated
// elements use transforms/opacity; compass, minimap and big map are canvases.
import { h, svg, clear, setText, setClass, icon, clamp, fmtTime, hexToRgbTriplet } from './dom.js';
import { TEAMS, MODES } from '/shared/constants.js';

const TAU = Math.PI * 2;
const RAD2DEG = 180 / Math.PI;
const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const GRID_N = 8;
const GRID_COLS = 'ABCDEFGHIJKLMNOP';
const MINIMAP_RANGE = 120;
const FEED_MAX = 6;
const FEED_TTL = 6;
const CHAT_TTL = 10;
const CHAT_MAX = 60;

const STANCE_SVG = [
  // stand
  '<svg viewBox="0 0 48 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M24 17v18" stroke-width="10"/><path d="M21.5 38l-1 22M26.5 38l1 22" stroke-width="5.5"/><path d="M18 19l-3 13M30 19l3 13" stroke-width="4"/></g><circle cx="24" cy="7.5" r="5.5" fill="currentColor"/></svg>',
  // crouch
  '<svg viewBox="0 0 48 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M27 33l-5 14" stroke-width="10"/><path d="M23 49l11 1 0 11M19 48l-5 12-6 1" stroke-width="5.5"/><path d="M29 35l7 7" stroke-width="4"/></g><circle cx="28.5" cy="24" r="5.5" fill="currentColor"/></svg>',
  // prone
  '<svg viewBox="0 0 48 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M33 56.5H17" stroke-width="9"/><path d="M15 55.5L3 54.5M15 58.5L3 60.5" stroke-width="5"/><path d="M34 58l9 3" stroke-width="4"/></g><circle cx="41" cy="52.5" r="5" fill="currentColor"/></svg>',
];

function teamColor(team, fallback = '#ffffff') {
  const t = TEAMS[team];
  return t ? t.color : fallback;
}

function headingOf(o) {
  if (!o) return 0;
  if (typeof o.heading === 'number') return o.heading;
  if (typeof o.yaw === 'number') return -o.yaw;
  return 0;
}

function gridRef(x, z, worldSize) {
  if (!worldSize) return '';
  const c = clamp(Math.floor((x / worldSize + 0.5) * GRID_N), 0, GRID_N - 1);
  const r = clamp(Math.floor((z / worldSize + 0.5) * GRID_N), 0, GRID_N - 1);
  return `${GRID_COLS[c]}${r + 1}`;
}

function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}

function sizeCanvas(cv, cssW, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(cssW * dpr));
  const hh = Math.max(1, Math.round(cssH * dpr));
  if (cv.width !== w || cv.height !== hh) {
    cv.width = w;
    cv.height = hh;
  }
  return dpr;
}

function arrowPath(ctx, x, y, angle, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -7 * s);
  ctx.lineTo(5.2 * s, 6 * s);
  ctx.lineTo(0, 3 * s);
  ctx.lineTo(-5.2 * s, 6 * s);
  ctx.closePath();
  ctx.restore();
}

export class HUD {
  /** @param {HTMLElement} root container (e.g. #ui-root); the HUD appends its own layer */
  constructor(root) {
    this.root = root;
    /** @type {{onOpenLoadout?:Function, onDeploy?:Function}} */
    this.callbacks = {};
    /** When true (default) the HUD calls callbacks.onDeploy on Space once the respawn timer is ready. */
    this.handleDeployKey = true;
    this._visible = true;
    this._time = 0;
    this._s = {
      hp: null, maxHp: 100, ammo: {}, stance: -1, heading: null, xh: {}, match: {}, squadSig: '',
      fps: null, ping: null, oob: null, interact: null, spawnProt: false,
    };
    this._hit = { t: 0, dur: 0 };
    this._hurtT = 0;
    this._ghost = 1;
    this._ghostHold = 0;
    this._feed = [];
    this._msgs = [];
    this._chat = [];
    this._chatOpen = false;
    this._chatSubmit = null;
    this._dmg = [];
    this._np = [];
    this._death = { visible: false, left: 0, total: 1, ready: false, deployed: false };
    this._me = { visible: false, left: 0 };
    this._sbSig = '';
    this._mm = { visible: true, data: null, sig: '' };
    this._bm = { visible: false, data: null };
    this._build();
    this._bind();
    this.setCrosshair({ visible: true, spread: 6, style: 'default', color: '#ffffff' });
  }

  // ============================================================ construction

  _build() {
    const E = (this._e = {});
    E.root = h('div.sr-hud', { 'aria-hidden': 'true' });
    E.vignette = h('div.sr-vignette');
    E.hurt = h('div.sr-hurt');
    E.oobEdge = h('div.sr-oob-edge');
    E.nameplates = h('div.sr-nameplates');

    // centre: damage indicators, crosshair, hitmarker
    E.center = h('div.sr-center');
    const gradDefs = svg('<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="sr-dmg-grad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff2a1a" stop-opacity="0"/><stop offset="0.5" stop-color="#ff2a1a" stop-opacity="0.95"/><stop offset="1" stop-color="#ff2a1a" stop-opacity="0"/></linearGradient><linearGradient id="sr-dmg-grad2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd0c8" stop-opacity="0"/><stop offset="0.5" stop-color="#ffd0c8" stop-opacity="0.9"/><stop offset="1" stop-color="#ffd0c8" stop-opacity="0"/></linearGradient></defs></svg>');
    E.center.append(gradDefs);
    for (let i = 0; i < 6; i++) {
      const el = h('div.sr-dmg');
      el.append(svg('<svg viewBox="-170 -170 340 340"><path d="M-62.4 -133.8 A147.6 147.6 0 0 1 62.4 -133.8" fill="none" stroke="url(#sr-dmg-grad)" stroke-width="16"/><path d="M-50.7 -116.1 A126.7 126.7 0 0 1 50.7 -116.1" fill="none" stroke="url(#sr-dmg-grad2)" stroke-width="2.5"/><path d="M-9 -150 L0 -162 L9 -150" fill="none" stroke="#ff4a3a" stroke-width="3" stroke-linejoin="miter"/></svg>'));
      E.center.append(el);
      this._dmg.push({ el, t: 0, angle: 0 });
    }
    E.xhair = h('div.sr-xhair', h('i.sr-xh-l'), h('i.sr-xh-r'), h('i.sr-xh-t'), h('i.sr-xh-b'), h('i.sr-xh-dot'), h('i.sr-xh-circle'));
    E.hit = h('div.sr-hitmarker', h('i'), h('i'), h('i'), h('i'));
    E.center.append(E.xhair, E.hit);

    // compass + match info
    E.compassCanvas = h('canvas');
    E.compassHdg = h('div.sr-compass-hdg', '000');
    E.compass = h('div.sr-compass', E.compassCanvas, E.compassHdg);
    E.match = h('div.sr-match');

    // minimap
    E.mmCanvas = h('canvas');
    E.mmGrid = h('b');
    E.mmRange = h('span');
    E.minimap = h('div.sr-minimap',
      h('div.sr-minimap-ring', E.mmCanvas),
      h('div.sr-minimap-meta', h('span', 'GRID ', E.mmGrid), E.mmRange));
    E.minimap.style.display = 'none';

    // top-right
    E.fps = h('span');
    E.ping = h('span');
    E.perf = h('div.sr-perf', E.fps, E.ping);
    E.feed = h('div.sr-killfeed');

    // bottom-left: chat, squad, spawn protection, health
    E.chatLog = h('div.sr-chat-log');
    E.chatMode = h('span.sr-chat-mode', 'ALL');
    E.chatInput = h('input.sr-chat-input', { type: 'text', maxLength: 120, spellcheck: false, autocomplete: 'off', 'aria-label': 'Chat message' });
    E.chat = h('div.sr-chat', E.chatLog, h('div.sr-chat-input-row', E.chatMode, E.chatInput));
    E.squad = h('div.sr-squad');
    E.squad.style.display = 'none';
    E.spawnProt = h('div.sr-spawnprot', icon('shield'), 'SPAWN PROTECTION');
    E.hpNum = h('span.sr-health-num', '100');
    E.hpFill = h('i.sr-health-fill');
    E.hpGhost = h('i.sr-health-ghost');
    E.hpLabel = h('span', '100');
    E.health = h('div.sr-health', icon('cross'), E.hpNum,
      h('div.sr-health-bar-wrap', h('div.sr-health-label', h('span', 'HEALTH'), E.hpLabel),
        h('div.sr-health-bar', E.hpGhost, E.hpFill, h('i.sr-health-segs'))));
    E.bl = h('div.sr-bl', E.chat, E.squad, E.spawnProt, E.health);

    // bottom-right: stance + ammo
    E.stance = h('div.sr-stance');
    E.ammoWeapon = h('span.sr-ammo-weapon');
    E.ammoMode = h('span.sr-ammo-mode');
    E.ammoMag = h('span.sr-ammo-mag', '0');
    E.ammoRes = h('span.sr-ammo-res', '0');
    E.ammoPips = h('div.sr-ammo-pips');
    E.fragCount = h('span', '0');
    E.smokeCount = h('span', '0');
    E.frag = h('span.sr-gear', h('span.sr-key', 'G'), icon('frag'), E.fragCount);
    E.smoke = h('span.sr-gear', h('span.sr-key', '4'), icon('smoke'), E.smokeCount);
    E.ammoAlert = h('div.sr-ammo-alert');
    E.ammo = h('div.sr-ammo', E.ammoAlert,
      h('div.sr-ammo-top', E.ammoMode, E.ammoWeapon),
      h('div.sr-ammo-count', E.ammoMag, E.ammoRes),
      E.ammoPips,
      h('div.sr-ammo-gear', E.frag, E.smoke));
    E.br = h('div.sr-br', E.stance, E.ammo);

    // messages, kill banners, interaction, out-of-bounds
    E.msgs = h('div.sr-msgs');
    E.kills = h('div.sr-kills');
    E.interact = h('div.sr-interact');
    E.oobNum = h('div.sr-oob-num', '10');
    E.oob = h('div.sr-oob',
      h('div.sr-oob-title', icon('warn'), 'RETURN TO THE COMBAT AREA'),
      E.oobNum, h('div.sr-oob-sub', 'SECONDS'));

    // overlays
    E.death = this._buildDeath();
    E.sb = h('div.sr-ovl.sr-sb');
    E.bigmap = this._buildBigMap();
    E.me = h('div.sr-ovl.sr-me');

    E.root.append(E.vignette, E.hurt, E.oobEdge, E.nameplates, E.center, E.compass, E.match, E.minimap, E.perf, E.feed,
      E.bl, E.br, E.msgs, E.kills, E.interact, E.oob, E.death, E.sb, E.bigmap, E.me);
    this.root.append(E.root);
    this.setStance(0);
  }

  _buildDeath() {
    const E = this._e;
    E.dKicker = h('span', 'KILLED BY');
    E.dKiller = h('div.sr-death-killer');
    E.dFacts = h('div.sr-death-facts');
    const C = 2 * Math.PI * 44;
    E.dRing = svg(`<svg viewBox="0 0 100 100"><circle class="sr-ring-bg" cx="50" cy="50" r="44"/><circle class="sr-ring" cx="50" cy="50" r="44" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="0"/></svg>`);
    E.dRingC = C;
    E.dNum = h('div.sr-deploy-num', '5');
    E.dDeployBtn = h('button.sr-btn.sr-btn-primary', { type: 'button', disabled: true, onclick: () => this._deploy() }, 'Deploy', icon('arrowR'));
    E.dLoadoutBtn = h('button.sr-btn', { type: 'button', onclick: () => this._cb('onOpenLoadout') }, 'Change loadout');
    return h('div.sr-ovl.sr-death',
      h('div.sr-death-card',
        h('div.sr-death-kicker', icon('skull'), E.dKicker),
        E.dKiller, E.dFacts,
        h('div.sr-deploy',
          h('div.sr-deploy-label', 'DEPLOY IN'),
          h('div.sr-deploy-timer', E.dRing, E.dNum),
          h('div.sr-deploy-ready', 'PRESS', h('span.sr-key', 'SPACE'), 'TO DEPLOY')),
        h('div.sr-death-actions', E.dLoadoutBtn, E.dDeployBtn)));
  }

  _buildBigMap() {
    const E = this._e;
    E.bmCanvas = h('canvas');
    E.bmTitle = h('div.sr-bigmap-title', 'Tactical map');
    E.bmGrid = h('span.sr-fact-val', '—');
    const legendIcon = (kind) => {
      const c = h('canvas', { width: 40, height: 40 });
      const ctx = c.getContext('2d');
      ctx.translate(20, 20);
      if (kind === 'you' || kind === 'friendly') {
        arrowPath(ctx, 0, 0, 0, 2.2);
        ctx.fillStyle = kind === 'you' ? '#ffb000' : TEAMS[0].color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0,0,0,.7)';
        ctx.stroke();
      } else if (kind === 'enemy') {
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, TAU);
        ctx.fillStyle = '#ff4a3d';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0,0,0,.7)';
        ctx.stroke();
      } else {
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-8, -8, 16, 16);
      }
      return c;
    };
    E.bmLegend = h('div.sr-legend',
      h('div.sr-legend-row', legendIcon('you'), 'You'),
      h('div.sr-legend-row', legendIcon('friendly'), 'Friendly'),
      h('div.sr-legend-row', legendIcon('enemy'), 'Enemy (spotted)'),
      h('div.sr-legend-row', legendIcon('obj'), 'Objective'));
    return h('div.sr-ovl.sr-bigmap',
      h('div.sr-bigmap-inner',
        h('div.sr-bigmap-canvas-wrap', E.bmCanvas),
        h('div.sr-bigmap-side.sr-panel', { style: 'padding:calc(var(--sr-u)*22)' },
          h('div.sr-kicker', 'Tactical map'), E.bmTitle,
          h('div.sr-fact', h('span.sr-label', 'Your grid'), E.bmGrid),
          h('hr.sr-sep', { style: 'margin:0' }),
          E.bmLegend,
          h('div', { style: 'flex:1' }),
          h('div.sr-foot-hint', { style: 'font-weight:600;font-size:var(--sr-fs-xs);letter-spacing:.16em;color:var(--sr-text-3)' }, h('span.sr-key', 'M'), 'CLOSE MAP'))));
  }

  _bind() {
    const E = this._e;
    E.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = E.chatInput.value.trim();
        const cb = this._chatSubmit;
        this.closeChat();
        if (text && cb) cb(text);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeChat();
      }
    });
    E.chatInput.addEventListener('blur', () => {
      // keep the box open if focus was lost by clicking elsewhere; re-focus on next frame
      if (this._chatOpen) setTimeout(() => { if (this._chatOpen) E.chatInput.focus({ preventScroll: true }); }, 0);
    });
    this._onKey = (e) => {
      if (!this.handleDeployKey || e.code !== 'Space' || e.repeat) return;
      if (!this._death.visible || !this._death.ready || this._death.deployed || this._chatOpen) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      this._deploy();
    };
    window.addEventListener('keydown', this._onKey);
    this._onResize = () => {
      this._layoutCanvases();
      this._drawCompass(true);
      this._drawMinimap();
      if (this._bm.visible) this._drawBigMap();
    };
    window.addEventListener('resize', this._onResize);
    this._layoutCanvases();
    if (document.fonts && document.fonts.load) {
      Promise.all([
        document.fonts.load('700 20px "Barlow Condensed"'),
        document.fonts.load('600 20px "Barlow Condensed"'),
        document.fonts.load('700 20px "Rajdhani"'),
      ]).then(() => this._onResize()).catch(() => {});
    }
  }

  _layoutCanvases() {
    const E = this._e;
    const cr = E.compass.getBoundingClientRect();
    this._cmpDpr = sizeCanvas(E.compassCanvas, cr.width, cr.width ? E.compassCanvas.getBoundingClientRect().height : 40);
    const mr = E.mmCanvas.getBoundingClientRect();
    if (mr.width) this._mmDpr = sizeCanvas(E.mmCanvas, mr.width, mr.height);
  }

  _cb(name, ...args) {
    const fn = this.callbacks && this.callbacks[name];
    if (typeof fn === 'function') {
      try { fn(...args); } catch (err) { console.error(`[HUD] ${name} callback failed`, err); }
    }
  }

  // ============================================================ public API

  /** Show / hide the whole HUD layer. */
  setVisible(visible) {
    this._visible = !!visible;
    setClass(this._e.root, 'sr-is-hidden', !this._visible);
  }

  /** Per-frame tick: drives hitmarker, damage arcs, feeds, messages, countdowns. */
  update(dt) {
    dt = Math.min(0.25, Math.max(0, Number(dt) || 0));
    this._time += dt;
    const E = this._e;
    // hitmarker
    if (this._hit.t > 0) {
      this._hit.t -= dt;
      const p = 1 - Math.max(0, this._hit.t) / this._hit.dur;
      const sc = 1 + (this._hit.kind === 'kill' ? 0.7 : 0.45) * (1 - easeOut(Math.min(1, p * 3.5)));
      const op = this._hit.t <= 0 ? 0 : p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
      E.hit.style.transform = `scale(${sc.toFixed(3)})`;
      E.hit.style.opacity = op.toFixed(3);
    }
    // damage arcs
    for (const d of this._dmg) {
      if (d.t <= 0) continue;
      d.t -= dt;
      const life = Math.max(0, d.t) / 1.5;
      const age = 1.5 - Math.max(0, d.t);
      const sc = 1 + 0.12 * Math.max(0, 1 - age / 0.18);
      d.el.style.opacity = d.t <= 0 ? '0' : Math.min(1, life * 1.6).toFixed(3);
      d.el.style.transform = `rotate(${d.angle.toFixed(4)}rad) scale(${sc.toFixed(3)})`;
    }
    // hurt flash
    if (this._hurtT > 0) {
      this._hurtT = Math.max(0, this._hurtT - dt);
      E.hurt.style.opacity = (Math.min(1, this._hurtT / 0.45) * this._hurtAmp).toFixed(3);
    }
    // health ghost bar
    const f = this._s.hp === null ? 1 : clamp(this._s.hp / this._s.maxHp, 0, 1);
    if (this._ghost > f + 0.0005) {
      if (this._ghostHold > 0) this._ghostHold -= dt;
      else {
        this._ghost = Math.max(f, this._ghost - dt * 0.9);
        E.hpGhost.style.transform = `scaleX(${this._ghost.toFixed(4)})`;
      }
    }
    // kill feed expiry
    for (const k of this._feed) {
      if (k.out) continue;
      k.t -= dt;
      if (k.t <= 0) this._expireFeed(k);
    }
    // messages
    for (const m of this._msgs) {
      if (m.out) continue;
      m.t -= dt;
      if (m.t <= 0) this._expireMsg(m);
    }
    // chat fade
    if (!this._chatOpen) {
      for (const c of this._chat) {
        if (!c.faded && this._time - c.at > CHAT_TTL) {
          c.faded = true;
          c.el.classList.add('sr-is-faded');
        }
      }
    }
    // respawn countdown
    const D = this._death;
    if (D.visible && !D.ready) {
      D.left -= dt;
      this._renderRespawn();
    }
    // match end countdown
    if (this._me.visible && this._me.left > 0 && this._me.nextEl) {
      this._me.left = Math.max(0, this._me.left - dt);
      setText(this._me.nextEl, String(Math.ceil(this._me.left)));
    }
  }

  /** Bottom-left health bar. Flashes and drops a ghost bar on damage; red vignette when low. */
  setHealth(hp, maxHp = 100) {
    const S = this._s;
    const E = this._e;
    hp = Math.max(0, Number(hp) || 0);
    maxHp = Math.max(1, Number(maxHp) || 100);
    if (S.hp === hp && S.maxHp === maxHp) return;
    const prev = S.hp;
    const prevF = prev === null ? 1 : clamp(prev / S.maxHp, 0, 1);
    S.hp = hp;
    S.maxHp = maxHp;
    const f = clamp(hp / maxHp, 0, 1);
    if (prev === null) {
      this._ghost = f;
      E.hpGhost.style.transform = `scaleX(${f.toFixed(4)})`;
    } else if (hp < prev) {
      const dmg = (prev - hp) / maxHp;
      this._hurtT = 0.45;
      this._hurtAmp = clamp(0.35 + dmg * 2.2, 0.35, 1);
      E.hurt.style.opacity = this._hurtAmp.toFixed(3);
      this._ghost = Math.max(this._ghost, prevF);
      this._ghostHold = 0.35;
      E.hpGhost.style.transform = `scaleX(${this._ghost.toFixed(4)})`;
      E.health.classList.remove('sr-is-flash');
      void E.health.offsetWidth;
      E.health.classList.add('sr-is-flash');
    } else if (f >= this._ghost) {
      this._ghost = f;
      E.hpGhost.style.transform = `scaleX(${f.toFixed(4)})`;
    }
    E.hpFill.style.transform = `scaleX(${f.toFixed(4)})`;
    const txt = String(Math.ceil(hp));
    setText(E.hpNum, txt);
    setText(E.hpLabel, `${txt} / ${Math.round(maxHp)}`);
    setClass(E.health, 'sr-is-mid', f <= 0.5 && f > 0.25);
    setClass(E.health, 'sr-is-low', f <= 0.25);
    const v = clamp((0.62 - f) / 0.62, 0, 1);
    E.vignette.style.opacity = hp <= 0 ? '0' : Math.pow(v, 1.25).toFixed(3);
    setClass(E.vignette, 'sr-is-critical', f <= 0.25 && hp > 0);
  }

  /**
   * Bottom-right ammo panel. Any subset of fields may be passed; others keep their last value.
   * @param {{mag?:number, magSize?:number, reserve?:number, weaponName?:string, fireMode?:string,
   *   frags?:number, smokes?:number, reloading?:boolean}} a
   */
  setAmmo(a = {}) {
    const S = this._s.ammo;
    const E = this._e;
    const n = { ...S, ...a };
    if (n.weaponName !== S.weaponName) setText(E.ammoWeapon, n.weaponName || '');
    if (n.fireMode !== S.fireMode) {
      setText(E.ammoMode, String(n.fireMode || '').toUpperCase());
      E.ammoMode.style.display = n.fireMode ? '' : 'none';
    }
    const mag = Math.max(0, n.mag | 0);
    const magSize = Math.max(1, (n.magSize | 0) || 1);
    const reserve = Math.max(0, n.reserve | 0);
    if (mag !== S.mag) setText(E.ammoMag, String(mag));
    if (reserve !== S.reserve) setText(E.ammoRes, String(reserve));
    if (magSize !== S.magSize) this._buildPips(magSize);
    if (mag !== S.mag || magSize !== S.magSize) this._updatePips(mag, magSize);
    const lowN = Math.max(1, Math.ceil(magSize * 0.3));
    const critN = Math.max(0, Math.ceil(magSize * 0.12));
    const empty = mag === 0;
    setClass(E.ammo, 'sr-is-low', mag <= lowN && mag > critN);
    setClass(E.ammo, 'sr-is-crit', mag <= critN && !empty);
    setClass(E.ammo, 'sr-is-empty', empty);
    // alert line
    let alert = '';
    if (n.reloading) alert = 'reloading';
    else if (empty && reserve === 0) alert = 'noammo';
    else if (mag <= lowN && reserve > 0) alert = 'reload';
    if (alert !== this._ammoAlert) {
      this._ammoAlert = alert;
      const el = E.ammoAlert;
      el.className = 'sr-ammo-alert' + (alert ? ` sr-is-on sr-is-${alert}` : '');
      clear(el);
      if (alert === 'reloading') el.append('RELOADING', h('span.sr-reload-bar', h('i')));
      else if (alert === 'noammo') el.append('NO AMMO');
      else if (alert === 'reload') el.append(h('span.sr-key', 'R'), 'RELOAD');
    }
    const frags = Math.max(0, n.frags | 0);
    const smokes = Math.max(0, n.smokes | 0);
    if (frags !== S.frags) { setText(E.fragCount, String(frags)); setClass(E.frag, 'sr-is-zero', frags === 0); }
    if (smokes !== S.smokes) { setText(E.smokeCount, String(smokes)); setClass(E.smoke, 'sr-is-zero', smokes === 0); }
    Object.assign(S, n, { mag, magSize, reserve, frags, smokes });
  }

  _buildPips(magSize) {
    const E = this._e;
    clear(E.ammoPips);
    const bar = magSize > 40;
    setClass(E.ammoPips, 'sr-is-bar', bar);
    if (bar) {
      const bg = h('i.sr-is-spent', { style: 'position:relative;max-width:none' });
      const fill = h('i', { style: 'position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:left;max-width:none' });
      bg.append(fill);
      E.ammoPips.append(bg);
      this._pipFill = fill;
      this._pips = null;
    } else {
      this._pips = [];
      for (let i = 0; i < magSize; i++) {
        const p = h('i');
        this._pips.push(p);
        E.ammoPips.append(p);
      }
      this._pipFill = null;
    }
  }

  _updatePips(mag, magSize) {
    if (this._pipFill) {
      this._pipFill.style.transform = `scaleX(${(mag / magSize).toFixed(4)})`;
    } else if (this._pips) {
      // rounds are consumed from the left so the remaining ones stay right-aligned under the counter
      const spent = magSize - mag;
      this._pips.forEach((p, i) => setClass(p, 'sr-is-spent', i < spent));
    }
  }

  /** Stance pictogram: 0 stand, 1 crouch, 2 prone. */
  setStance(stance) {
    stance = clamp(stance | 0, 0, 2);
    if (stance === this._s.stance) return;
    this._s.stance = stance;
    clear(this._e.stance).append(svg(STANCE_SVG[stance]));
    this._e.stance.title = ['Standing', 'Crouching', 'Prone'][stance];
  }

  /** Compass heading in radians: 0 = north (−Z), clockwise positive (east = +X = π/2). */
  setCompass(headingRad) {
    let deg = (Number(headingRad) || 0) * RAD2DEG;
    deg = ((deg % 360) + 360) % 360;
    if (this._s.heading !== null && Math.abs(deg - this._s.heading) < 0.05) return;
    this._s.heading = deg;
    setText(this._e.compassHdg, String(Math.round(deg) % 360).padStart(3, '0'));
    this._drawCompass();
  }

  _drawCompass(force) {
    const cv = this._e.compassCanvas;
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    if (!W || !H) return;
    if (!force && this._s.heading === null) return;
    const deg = this._s.heading || 0;
    const dpr = this._cmpDpr || 1;
    const u = H / 40; // canvas units relative to the CSS height (40u)
    ctx.clearRect(0, 0, W, H);
    // backplate band
    const band = ctx.createLinearGradient(0, 0, W, 0);
    band.addColorStop(0, 'rgba(0,0,0,0)');
    band.addColorStop(0.18, 'rgba(0,0,0,0.38)');
    band.addColorStop(0.82, 'rgba(0,0,0,0.38)');
    band.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, H * 0.08, W, H * 0.84);
    const span = 130;
    const ppd = W / span;
    const start = Math.ceil((deg - span / 2) / 5) * 5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 3 * dpr;
    for (let d = start; d <= deg + span / 2; d += 5) {
      const x = W / 2 + (d - deg) * ppd;
      const dn = ((d % 360) + 360) % 360;
      const edge = Math.abs(x - W / 2) / (W / 2);
      const alpha = Math.max(0, 1 - Math.pow(edge, 2.2));
      if (alpha <= 0.01) continue;
      ctx.globalAlpha = alpha;
      const card = CARDINALS[dn];
      let tick = 5 * u;
      if (card) tick = 11 * u;
      else if (dn % 15 === 0) tick = 8 * u;
      ctx.fillStyle = dn === 0 ? '#ffb000' : 'rgba(255,255,255,0.9)';
      ctx.fillRect(Math.round(x - u), H - 4 * u - tick, Math.max(1, Math.round(2 * u * (card ? 1 : 0.75))), tick);
      if (card) {
        ctx.font = `${card.length === 1 ? 700 : 600} ${Math.round((card.length === 1 ? 20 : 15) * u)}px "Barlow Condensed", "Rajdhani", sans-serif`;
        ctx.fillStyle = dn === 0 ? '#ffb000' : '#ffffff';
        ctx.fillText(card, x, H - 17 * u);
      } else if (dn % 15 === 0) {
        ctx.font = `700 ${Math.round(12.5 * u)}px "Rajdhani", "Barlow Condensed", sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.fillText(String(dn), x, H - 17 * u);
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    // centre index line
    ctx.fillStyle = '#ffb000';
    ctx.fillRect(Math.round(W / 2 - u), H - 15 * u, Math.max(2, Math.round(2 * u)), 15 * u);
  }

  /**
   * Crosshair. Fields are optional; `spread` is the px gap from the centre.
   * @param {{visible?:boolean, spread?:number, style?:'default'|'dot'|'cross'|'circle', color?:string}} o
   */
  setCrosshair(o = {}) {
    const S = this._s.xh;
    const E = this._e;
    if (o.visible !== undefined && o.visible !== S.visible) {
      S.visible = !!o.visible;
      setClass(E.xhair, 'sr-is-hidden', !S.visible);
    }
    if (o.style && o.style !== S.style) {
      S.style = o.style;
      E.xhair.dataset.style = o.style;
    }
    if (o.color && o.color !== S.color) {
      S.color = o.color;
      E.xhair.style.setProperty('--xc', o.color);
    }
    if (o.spread !== undefined) {
      const g = clamp(Number(o.spread) || 0, 1, 260);
      if (S.spread === undefined || Math.abs(g - S.spread) >= 0.25) {
        S.spread = g;
        E.xhair.style.setProperty('--gap', `${g.toFixed(1)}px`);
      }
    }
  }

  /** Hitmarker: 'hit' (white), 'head' (amber), 'kill' (red, bigger pop). */
  showHitmarker(kind = 'hit') {
    const E = this._e;
    const k = kind === 'kill' ? 'kill' : kind === 'head' ? 'head' : 'hit';
    E.hit.className = `sr-hitmarker sr-is-${k}`;
    this._hit = { kind: k, dur: k === 'kill' ? 0.5 : 0.3, t: k === 'kill' ? 0.5 : 0.3 };
    E.hit.style.opacity = '1';
    E.hit.style.transform = `scale(${k === 'kill' ? 1.7 : 1.45})`;
  }

  /** Damage direction arc: angle relative to view (0 = in front, + = to the right). Fades over 1.5 s. */
  showDamage(angleRad) {
    const a = Number(angleRad) || 0;
    // reuse an arc pointing roughly the same way, else the oldest
    let slot = this._dmg.find((d) => d.t > 0 && Math.abs(Math.atan2(Math.sin(d.angle - a), Math.cos(d.angle - a))) < 0.2);
    if (!slot) slot = this._dmg.reduce((m, d) => (d.t < m.t ? d : m), this._dmg[0]);
    slot.t = 1.5;
    slot.angle = a;
    slot.el.style.opacity = '1';
    slot.el.style.transform = `rotate(${a.toFixed(4)}rad) scale(1.12)`;
  }

  /**
   * Kill feed entry (top-right, max 6, 6 s).
   * @param {{killer?:string, killerTeam?:number|null, victim:string, victimTeam?:number|null, weapon?:string,
   *   headshot?:boolean, local?:'killer'|'victim'|null}} k
   */
  addKillFeed(k = {}) {
    const name = (n, team, me) => h('span.sr-kf-name', {
      class: me ? 'sr-is-me' : '',
      style: { color: me ? 'var(--sr-accent)' : team === null || team === undefined ? '#ffffff' : teamColor(team) },
    }, n || '');
    const row = h('div.sr-kf-row', { class: k.local ? 'sr-is-local' : '' },
      k.killer ? name(k.killer, k.killerTeam, k.local === 'killer') : null,
      h('span.sr-kf-weapon', k.weapon || '', k.headshot ? icon('headshot') : null),
      name(k.victim, k.victimTeam, k.local === 'victim'));
    this._e.feed.append(row);
    const entry = { el: row, t: FEED_TTL, out: false };
    this._feed.push(entry);
    const live = this._feed.filter((e) => !e.out);
    if (live.length > FEED_MAX) {
      const old = live[0];
      old.out = true;
      old.el.remove();
      this._feed = this._feed.filter((e) => e !== old);
    }
  }

  _expireFeed(k) {
    k.out = true;
    k.el.classList.add('sr-is-out');
    setTimeout(() => {
      k.el.remove();
      this._feed = this._feed.filter((e) => e !== k);
    }, 420);
  }

  /**
   * Match status under the compass.
   * @param {{mode?:string, timeLeft?:number, scoreLimit?:number, myTeam?:number, teamScores?:number[],
   *   myScore?:number, leaderName?:string, leaderScore?:number, state?:'warmup'|'playing'|'ended'}} m
   */
  setMatchInfo(m = {}) {
    const S = this._s.match;
    const n = { ...S, ...m };
    const E = this._e;
    const mode = MODES[n.mode] || MODES.ffa;
    const teams = !!mode.teams;
    const layoutKey = `${teams}|${n.myTeam}`;
    if (layoutKey !== this._matchLayout) {
      this._matchLayout = layoutKey;
      clear(E.match);
      const M = (this._mEls = {});
      const block = (cls) => {
        const el = h(`div.sr-match-team.${cls}`);
        const bg = h('i.sr-mt-bg');
        const nm = h('span.sr-mt-name');
        const sc = h('span.sr-num', '0');
        const pr = h('i.sr-mt-prog');
        if (cls === 'sr-is-a') el.append(bg, nm, sc, pr);
        else el.append(bg, sc, nm, pr);
        return { el, nm, sc, pr };
      };
      M.a = block('sr-is-a');
      M.b = block('sr-is-b');
      M.timer = h('span.sr-match-timer', '0:00');
      M.state = h('span.sr-match-state');
      M.limit = h('span.sr-match-limit');
      const mid = h('div.sr-match-mid', M.timer, M.state);
      E.match.append(M.a.el, mid, M.b.el, M.limit);
      setClass(E.match, 'sr-match-ffa', !teams);
      if (teams) {
        const my = n.myTeam === 1 ? 1 : 0;
        const other = 1 - my;
        M.a.el.style.setProperty('--tc', teamColor(my));
        M.b.el.style.setProperty('--tc', teamColor(other));
        setText(M.a.nm, (TEAMS[my] || {}).name || 'FRIENDLY');
        setText(M.b.nm, (TEAMS[other] || {}).name || 'ENEMY');
      } else {
        M.a.el.style.setProperty('--tc', '#ffb000');
        M.b.el.style.setProperty('--tc', '#ffffff');
        setText(M.a.nm, 'YOU');
      }
    }
    const M = this._mEls;
    const limit = n.scoreLimit || mode.scoreLimit || 0;
    let sa;
    let sb;
    if (teams) {
      const my = n.myTeam === 1 ? 1 : 0;
      const ts = Array.isArray(n.teamScores) ? n.teamScores : [0, 0];
      sa = ts[my] || 0;
      sb = ts[1 - my] || 0;
    } else {
      sa = n.myScore || 0;
      sb = n.leaderScore || 0;
      setText(M.b.nm, n.leaderName ? `${n.leaderName}` : 'LEADER');
    }
    setText(M.a.sc, String(sa));
    setText(M.b.sc, String(sb));
    const pa = limit ? clamp(sa / limit, 0, 1) : 0;
    const pb = limit ? clamp(sb / limit, 0, 1) : 0;
    if (pa !== this._pa) { this._pa = pa; M.a.pr.style.transform = `scaleX(${pa.toFixed(4)})`; }
    if (pb !== this._pb) { this._pb = pb; M.b.pr.style.transform = `scaleX(${pb.toFixed(4)})`; }
    const tl = Math.max(0, Number(n.timeLeft) || 0);
    setText(M.timer, fmtTime(tl));
    setClass(M.timer, 'sr-is-low', n.state === 'playing' && tl <= 60);
    const stateText = n.state === 'warmup' ? 'WARMUP' : n.state === 'ended' ? 'MATCH OVER' : mode.short;
    setText(M.state, stateText);
    setClass(M.state, 'sr-is-warm', n.state === 'warmup');
    setText(M.limit, limit ? `FIRST TO ${limit}${teams ? '' : ' KILLS'}` : '');
    this._myTeam = n.myTeam;
    Object.assign(S, n);
  }

  /** Squad list above the health bar: [{ name, alive, isLocal }] (up to 6; empty hides it). */
  setSquad(list) {
    const arr = Array.isArray(list) ? list.slice(0, 6) : [];
    const sig = JSON.stringify(arr.map((p) => [p.name, !!p.alive, !!p.isLocal])) + '|' + this._myTeam;
    if (sig === this._s.squadSig) return;
    this._s.squadSig = sig;
    const E = this._e;
    clear(E.squad);
    E.squad.style.display = arr.length ? '' : 'none';
    if (!arr.length) return;
    const tc = this._myTeam === undefined || this._myTeam === null ? '#4aa3ff' : teamColor(this._myTeam, '#4aa3ff');
    E.squad.style.setProperty('--tc', tc);
    const alive = arr.filter((p) => p.alive).length;
    E.squad.append(h('div.sr-squad-head', `SQUAD · ${alive}/${arr.length} ALIVE`));
    for (const p of arr) {
      E.squad.append(h('div.sr-squad-row', { class: `${p.alive ? '' : 'sr-is-dead'} ${p.isLocal ? 'sr-is-local' : ''}` }, h('i'), h('span', p.name || '')));
    }
  }

  /**
   * Centre banners. kind: 'info' | 'warn' | 'kill' | 'big'. 'big' and 'warn' replace the previous
   * banner of the same kind (countdowns); pass `id` to replace a specific banner.
   * @param {string} text
   * @param {{kind?:string, duration?:number, sub?:string, id?:string}} [opts]
   */
  showMessage(text, opts = {}) {
    const kind = ['info', 'warn', 'kill', 'big'].includes(opts.kind) ? opts.kind : 'info';
    const duration = opts.duration === undefined ? 2.5 : Math.max(0.3, Number(opts.duration) || 2.5);
    const id = opts.id || (kind === 'big' || kind === 'warn' ? `__${kind}` : null);
    const container = kind === 'kill' ? this._e.kills : this._e.msgs;
    if (id) {
      const ex = this._msgs.find((m) => m.id === id && !m.out);
      if (ex) {
        ex.out = true;
        ex.el.remove();
        this._msgs = this._msgs.filter((m) => m !== ex);
      }
    }
    let el;
    if (kind === 'kill') {
      const mm = /^\s*([+-]?\d+)\s*(.*)$/.exec(String(text));
      el = h('div.sr-msg.sr-msg-kill',
        mm ? h('span.sr-msg-pts', mm[1].startsWith('+') || mm[1].startsWith('-') ? mm[1] : `+${mm[1]}`) : null,
        h('span.sr-msg-text', mm ? mm[2] : String(text)),
        opts.sub ? h('span.sr-msg-sub', opts.sub) : null);
    } else {
      el = h(`div.sr-msg.sr-msg-${kind}`,
        h('div.sr-msg-text', kind === 'warn' ? icon('warn') : null, String(text)),
        opts.sub ? h('div.sr-msg-sub', opts.sub) : null);
    }
    if (kind === 'kill') container.prepend(el);
    else container.append(el);
    const m = { el, t: duration, kind, id, out: false };
    this._msgs.push(m);
    const max = kind === 'kill' ? 4 : 4;
    const same = this._msgs.filter((x) => !x.out && (x.kind === 'kill') === (kind === 'kill'));
    while (same.length > max) {
      const old = same.shift();
      old.out = true;
      old.el.remove();
      this._msgs = this._msgs.filter((x) => x !== old);
    }
  }

  _expireMsg(m) {
    m.out = true;
    m.el.classList.add('sr-is-out');
    setTimeout(() => {
      m.el.remove();
      this._msgs = this._msgs.filter((x) => x !== m);
    }, 360);
  }

  /** Chat line: { name, team, text, system, teamOnly? }. */
  addChat(c = {}) {
    const el = h('div.sr-chat-line', { class: c.system ? 'sr-is-system' : '' });
    if (c.system) el.append(String(c.text || ''));
    else {
      if (c.teamOnly) el.append(h('span.sr-chat-tag', '[TEAM]'));
      el.append(h('b', { style: { color: c.team === null || c.team === undefined ? '#ffffff' : teamColor(c.team) } }, `${c.name || '?'}:`), String(c.text || ''));
    }
    this._e.chatLog.append(el);
    this._chat.push({ el, at: this._time, faded: false });
    while (this._chat.length > CHAT_MAX) this._chat.shift().el.remove();
    if (this._chatOpen) this._e.chatLog.scrollTop = this._e.chatLog.scrollHeight;
  }

  /** Open the chat input; onSubmit(text) is called on Enter with non-empty text. Esc cancels. */
  openChat(teamOnly, onSubmit) {
    const E = this._e;
    this._chatOpen = true;
    this._chatSubmit = typeof onSubmit === 'function' ? onSubmit : null;
    setText(E.chatMode, teamOnly ? '[TEAM]' : '[ALL]');
    E.chatInput.value = '';
    E.chat.classList.add('sr-is-open');
    E.chatLog.scrollTop = E.chatLog.scrollHeight;
    // focus after the current key event so the opening key is not typed into the box
    setTimeout(() => { if (this._chatOpen) E.chatInput.focus({ preventScroll: true }); }, 0);
  }

  /** Close the chat input (no submit). */
  closeChat() {
    const E = this._e;
    if (!this._chatOpen) return;
    this._chatOpen = false;
    this._chatSubmit = null;
    E.chat.classList.remove('sr-is-open');
    E.chatInput.value = '';
    E.chatInput.blur();
    for (const c of this._chat) {
      if (this._time - c.at > CHAT_TTL && !c.faded) { c.faded = true; c.el.classList.add('sr-is-faded'); }
    }
  }

  /** @returns {boolean} true while the chat input is open */
  get chatOpen() {
    return this._chatOpen;
  }

  /**
   * Circular radar (top-left), heading-up when rotate is true, range ~120 m.
   * `image` covers the world square [-worldSize/2, worldSize/2] on X (left→right) and Z (top→bottom;
   * top = north = −Z). `yaw` follows three.js rotation.y (0 faces −Z, positive turns left);
   * alternatively pass `heading` (clockwise radians, like setCompass).
   * @param {{visible?:boolean, image?:CanvasImageSource, worldSize?:number, rotate?:boolean, range?:number,
   *   player?:{x:number,z:number,yaw?:number,heading?:number}, friendlies?:Array, enemies?:Array, objectives?:Array}} d
   */
  setMinimap(d = {}) {
    const vis = d.visible !== false;
    if (vis !== this._mm.visible || this._mm.data === null) {
      this._mm.visible = vis;
      this._e.minimap.style.display = vis ? '' : 'none';
      if (vis) this._layoutCanvases();
    }
    this._mm.data = { ...(this._mm.data || {}), ...d };
    if (vis) this._drawMinimap();
  }

  _drawMinimap() {
    const d = this._mm.data;
    if (!d || !this._mm.visible) return;
    const E = this._e;
    const cv = E.mmCanvas;
    if (!cv.width) this._layoutCanvases();
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    if (!W) return;
    const dpr = this._mmDpr || 1;
    const R = W / 2 - 2 * dpr;
    const range = d.range || MINIMAP_RANGE;
    const scale = R / range;
    const p = d.player || { x: 0, z: 0 };
    const hdg = headingOf(p);
    const rot = d.rotate !== false;
    const ws = d.worldSize || 0;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, R, 0, TAU);
    ctx.clip();
    ctx.fillStyle = 'rgba(12,16,14,0.62)';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    if (rot) ctx.rotate(-hdg);
    if (d.image && ws) {
      ctx.globalAlpha = 0.92;
      try {
        ctx.drawImage(d.image, (-ws / 2 - p.x) * scale, (-ws / 2 - p.z) * scale, ws * scale, ws * scale);
      } catch { /* image not ready */ }
      ctx.globalAlpha = 1;
      // world edge
      ctx.strokeStyle = 'rgba(255,90,60,0.7)';
      ctx.lineWidth = 2 * dpr;
      ctx.strokeRect((-ws / 2 - p.x) * scale, (-ws / 2 - p.z) * scale, ws * scale, ws * scale);
    }
    // 50 m grid lines aligned to world
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1 * dpr;
    const gs = 50;
    const gx0 = Math.floor((p.x - range * 1.5) / gs) * gs;
    const gz0 = Math.floor((p.z - range * 1.5) / gs) * gs;
    ctx.beginPath();
    for (let gx = gx0; gx <= p.x + range * 1.5; gx += gs) {
      ctx.moveTo((gx - p.x) * scale, -range * 1.5 * scale);
      ctx.lineTo((gx - p.x) * scale, range * 1.5 * scale);
    }
    for (let gz = gz0; gz <= p.z + range * 1.5; gz += gs) {
      ctx.moveTo(-range * 1.5 * scale, (gz - p.z) * scale);
      ctx.lineTo(range * 1.5 * scale, (gz - p.z) * scale);
    }
    ctx.stroke();
    ctx.restore();
    // shade toward the rim + view cone
    const rim = ctx.createRadialGradient(W / 2, H / 2, R * 0.55, W / 2, H / 2, R);
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = rim;
    ctx.fillRect(0, 0, W, H);
    const coneDir = rot ? -Math.PI / 2 : hdg - Math.PI / 2;
    const cone = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, R);
    cone.addColorStop(0, 'rgba(255,255,255,0.16)');
    cone.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(W / 2, H / 2);
    ctx.arc(W / 2, H / 2, R, coneDir - 0.6, coneDir + 0.6);
    ctx.closePath();
    ctx.fill();
    // range rings
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1 * dpr;
    for (const rr of [50, 100]) {
      if (rr >= range) continue;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, rr * scale, 0, TAU);
      ctx.stroke();
    }
    const toScreen = (x, z) => {
      let dx = x - p.x;
      let dz = z - p.z;
      if (rot) {
        const c = Math.cos(-hdg);
        const s = Math.sin(-hdg);
        const rx = dx * c - dz * s;
        const rz = dx * s + dz * c;
        dx = rx;
        dz = rz;
      }
      return [W / 2 + dx * scale, H / 2 + dz * scale, Math.hypot(dx, dz) * scale];
    };
    // objectives
    for (const o of d.objectives || []) {
      let [sx, sy, dist] = toScreen(o.x, o.z);
      if (dist > R - 8 * dpr) {
        const k = (R - 8 * dpr) / dist;
        sx = W / 2 + (sx - W / 2) * k;
        sy = H / 2 + (sy - H / 2) * k;
      }
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = o.color || '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.fillRect(-5 * dpr, -5 * dpr, 10 * dpr, 10 * dpr);
      ctx.strokeRect(-5 * dpr, -5 * dpr, 10 * dpr, 10 * dpr);
      ctx.restore();
      if (o.label) {
        ctx.font = `700 ${Math.round(9 * dpr)}px "Barlow Condensed", sans-serif`;
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(o.label).slice(0, 2), sx, sy + 0.5 * dpr);
      }
    }
    // enemies
    for (const e of d.enemies || []) {
      const [sx, sy, dist] = toScreen(e.x, e.z);
      if (dist > R - 3 * dpr) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, 4.2 * dpr, 0, TAU);
      ctx.fillStyle = '#ff4a3d';
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.stroke();
    }
    // friendlies
    const fc = this._myTeam === undefined || this._myTeam === null ? TEAMS[0].color : teamColor(this._myTeam, TEAMS[0].color);
    for (const f of d.friendlies || []) {
      let [sx, sy, dist] = toScreen(f.x, f.z);
      if (dist > R - 6 * dpr) {
        const k = (R - 6 * dpr) / dist;
        sx = W / 2 + (sx - W / 2) * k;
        sy = H / 2 + (sy - H / 2) * k;
      }
      arrowPath(ctx, sx, sy, headingOf(f) - (rot ? hdg : 0), 0.95 * dpr);
      ctx.fillStyle = fc;
      ctx.fill();
      ctx.lineWidth = 1.4 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.stroke();
    }
    ctx.restore();
    // player
    arrowPath(ctx, W / 2, H / 2, rot ? 0 : hdg, 1.25 * dpr);
    ctx.fillStyle = '#ffb000';
    ctx.fill();
    ctx.lineWidth = 1.6 * dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.stroke();
    // ring + cardinal markers
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, R, 0, TAU);
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.stroke();
    ctx.font = `700 ${Math.round(12 * dpr)}px "Barlow Condensed", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [lbl, a0] of [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', Math.PI * 1.5]]) {
      const a = (rot ? a0 - hdg : a0) - Math.PI / 2;
      const rx = W / 2 + Math.cos(a) * (R - 9 * dpr);
      const ry = H / 2 + Math.sin(a) * (R - 9 * dpr);
      if (lbl === 'N') {
        ctx.beginPath();
        ctx.arc(rx, ry, 8 * dpr, 0, TAU);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fill();
        ctx.fillStyle = '#ffb000';
      } else ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 2 * dpr;
      ctx.fillText(lbl, rx, ry + 0.5 * dpr);
      ctx.shadowBlur = 0;
    }
    setText(E.mmGrid, ws ? gridRef(p.x, p.z, ws) : '—');
    setText(E.mmRange, `${Math.round(range)} M`);
  }

  /**
   * Full-screen tactical map (M). Same data shape as setMinimap (+ optional mapName); north-up.
   * Grid: columns A.. (west→east), rows 1.. (north→south), 8×8 over the world square.
   */
  setBigMap(visible, data) {
    const was = this._bm.visible;
    this._bm.visible = !!visible;
    setClass(this._e.bigmap, 'sr-is-on', this._bm.visible);
    setClass(this._e.root, 'sr-ovl-map', this._bm.visible);
    if (data) this._bm.data = { ...(this._bm.data || {}), ...data };
    if (!this._bm.visible) return;
    if (!was || !this._bmSized) {
      const r = this._e.bmCanvas.getBoundingClientRect();
      this._bmDpr = sizeCanvas(this._e.bmCanvas, r.width, r.height);
      this._bmSized = true;
    }
    this._drawBigMap();
  }

  _drawBigMap() {
    const d = this._bm.data || {};
    const E = this._e;
    const cv = E.bmCanvas;
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    if (!W) return;
    const dpr = this._bmDpr || 1;
    const m = 30 * dpr; // label margin
    const S = Math.min(W, H) - m * 2;
    const ws = d.worldSize || 1000;
    const k = S / ws;
    const X = (x) => m + (x + ws / 2) * k;
    const Z = (z) => m + (z + ws / 2) * k;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,13,15,0.9)';
    ctx.fillRect(m, m, S, S);
    if (d.image) {
      try { ctx.drawImage(d.image, m, m, S, S); } catch { /* not ready */ }
    }
    // grid
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    for (let i = 0; i <= GRID_N; i++) {
      const t = m + (S / GRID_N) * i;
      ctx.moveTo(t, m); ctx.lineTo(t, m + S);
      ctx.moveTo(m, t); ctx.lineTo(m + S, t);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
    // sub grid
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    for (let i = 0; i < GRID_N * 3; i++) {
      if (i % 3 === 0) continue;
      const t = m + (S / (GRID_N * 3)) * i;
      ctx.moveTo(t, m); ctx.lineTo(t, m + S);
      ctx.moveTo(m, t); ctx.lineTo(m + S, t);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeRect(m, m, S, S);
    // labels
    ctx.font = `700 ${Math.round(15 * dpr)}px "Barlow Condensed", sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < GRID_N; i++) {
      const c = m + (S / GRID_N) * (i + 0.5);
      ctx.fillText(GRID_COLS[i], c, m / 2);
      ctx.fillText(GRID_COLS[i], c, m + S + m / 2);
      ctx.fillText(String(i + 1), m / 2, c);
      ctx.fillText(String(i + 1), m + S + m / 2, c);
    }
    // objectives
    for (const o of d.objectives || []) {
      ctx.save();
      ctx.translate(X(o.x), Z(o.z));
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = o.color || '#ffffff';
      ctx.fillRect(-7 * dpr, -7 * dpr, 14 * dpr, 14 * dpr);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 2 * dpr;
      ctx.strokeRect(-7 * dpr, -7 * dpr, 14 * dpr, 14 * dpr);
      ctx.restore();
      if (o.label) {
        ctx.font = `700 ${Math.round(12 * dpr)}px "Barlow Condensed", sans-serif`;
        ctx.fillStyle = '#000';
        ctx.fillText(String(o.label).slice(0, 2), X(o.x), Z(o.z) + 0.5 * dpr);
      }
    }
    for (const e of d.enemies || []) {
      ctx.beginPath();
      ctx.arc(X(e.x), Z(e.z), 5.5 * dpr, 0, TAU);
      ctx.fillStyle = '#ff4a3d';
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.stroke();
    }
    const fc = this._myTeam === undefined || this._myTeam === null ? TEAMS[0].color : teamColor(this._myTeam, TEAMS[0].color);
    for (const f of d.friendlies || []) {
      arrowPath(ctx, X(f.x), Z(f.z), headingOf(f), 1.3 * dpr);
      ctx.fillStyle = fc;
      ctx.fill();
      ctx.lineWidth = 1.6 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.stroke();
    }
    const p = d.player;
    if (p) {
      const px = X(p.x);
      const pz = Z(p.z);
      ctx.beginPath();
      ctx.arc(px, pz, 16 * dpr, 0, TAU);
      ctx.strokeStyle = 'rgba(255,176,0,0.45)';
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
      arrowPath(ctx, px, pz, headingOf(p), 1.8 * dpr);
      ctx.fillStyle = '#ffb000';
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.stroke();
      setText(E.bmGrid, gridRef(p.x, p.z, ws));
    }
    // scale bar (bottom-left inside map)
    const nice = [50, 100, 200, 250, 500, 1000];
    const target = ws / 6;
    const len = nice.reduce((b, v) => (Math.abs(v - target) < Math.abs(b - target) ? v : b), nice[0]);
    const bx = m + 14 * dpr;
    const by = m + S - 16 * dpr;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx - 8 * dpr, by - 22 * dpr, len * k + 16 * dpr, 32 * dpr);
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx, by, len * k, 3 * dpr);
    ctx.fillRect(bx, by - 5 * dpr, 2 * dpr, 8 * dpr);
    ctx.fillRect(bx + len * k - 2 * dpr, by - 5 * dpr, 2 * dpr, 8 * dpr);
    ctx.font = `700 ${Math.round(12 * dpr)}px "Rajdhani", sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`${len} M`, bx, by - 11 * dpr);
    if (d.mapName || d.title) setText(E.bmTitle, d.mapName || d.title);
  }

  /**
   * Floating name tags (pooled). screenX/Y in CSS px (anchor = above the head).
   * @param {Array<{id:any, screenX:number, screenY:number, name:string, team?:number, friendly?:boolean,
   *   distance?:number, health?:number}>} list
   */
  setNameplates(list) {
    const arr = Array.isArray(list) ? list : [];
    const pool = this._np;
    while (pool.length < arr.length) {
      const el = h('div.sr-np');
      const name = h('span.sr-np-name');
      const hpFill = h('i');
      const hp = h('span.sr-np-hp', hpFill);
      const dist = h('span.sr-np-dist');
      const marker = h('i.sr-np-marker');
      el.append(name, hp, dist, marker);
      this._e.nameplates.append(el);
      pool.push({ el, name, hp, hpFill, dist, marker, shown: true, s: {} });
    }
    for (let i = 0; i < pool.length; i++) {
      const P = pool[i];
      const it = arr[i];
      if (!it) {
        if (P.shown) { P.shown = false; P.el.style.display = 'none'; }
        continue;
      }
      if (!P.shown) { P.shown = true; P.el.style.display = ''; }
      const s = P.s;
      if (s.name !== it.name) { s.name = it.name; setText(P.name, it.name || ''); }
      const friendly = it.friendly !== false;
      const col = it.team !== undefined && it.team !== null ? teamColor(it.team) : friendly ? TEAMS[0].color : '#ff5a4a';
      if (s.col !== col) { s.col = col; P.el.style.setProperty('--tc', col); }
      if (s.friendly !== friendly) { s.friendly = friendly; setClass(P.el, 'sr-is-enemy', !friendly); }
      const hasHp = typeof it.health === 'number';
      if (s.hasHp !== hasHp) { s.hasHp = hasHp; P.hp.style.display = hasHp ? '' : 'none'; }
      if (hasHp) {
        const hf = clamp(it.health > 1 ? it.health / 100 : it.health, 0, 1);
        if (s.hf !== hf) { s.hf = hf; P.hpFill.style.transform = `scaleX(${hf.toFixed(3)})`; }
      }
      const dtxt = typeof it.distance === 'number' && it.distance >= 25 ? `${Math.round(it.distance)} M` : '';
      if (s.dtxt !== dtxt) { s.dtxt = dtxt; setText(P.dist, dtxt); P.dist.style.display = dtxt ? '' : 'none'; }
      const x = Math.round(it.screenX * 2) / 2;
      const y = Math.round(it.screenY * 2) / 2;
      if (s.x !== x || s.y !== y) {
        s.x = x;
        s.y = y;
        P.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
      }
    }
  }

  /**
   * Scoreboard (Tab). data: { mode, mapName, teamScores, players: [{ id, name, team, kills, deaths,
   * assists, score, ping, isBot, isLocal, alive }], timeLeft? }
   */
  setScoreboard(visible, data) {
    const E = this._e;
    setClass(E.sb, 'sr-is-on', !!visible);
    setClass(E.root, 'sr-ovl-sb', !!visible);
    if (!visible || !data) return;
    const sig = JSON.stringify(data);
    if (sig === this._sbSig) return;
    this._sbSig = sig;
    const mode = MODES[data.mode] || MODES.ffa;
    const players = (data.players || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0) || (b.kills || 0) - (a.kills || 0));
    const head = h('div.sr-sb-head',
      h('div', h('div.sr-kicker', data.mapName || ''), h('div.sr-sb-title', mode.name)),
      h('div.sr-sb-meta',
        typeof data.timeLeft === 'number' ? h('div.sr-fact', h('span.sr-label', 'Time left'), h('span.sr-fact-val', fmtTime(data.timeLeft))) : null,
        h('div.sr-fact', h('span.sr-label', 'Players'), h('span.sr-fact-val', String(players.length))),
        h('div.sr-fact', h('span.sr-label', 'Score limit'), h('span.sr-fact-val', String(data.scoreLimit || mode.scoreLimit)))));
    let body;
    let inner;
    if (mode.teams) {
      const local = players.find((p) => p.isLocal);
      const my = local && local.team === 1 ? 1 : 0;
      const cols = [my, 1 - my].map((t) => {
        const list = players.filter((p) => p.team === t);
        return { t, list };
      });
      const rows = Math.max(...cols.map((c) => c.list.length), 1);
      body = h('div.sr-sb-cols', cols.map(({ t, list }) => {
        const team = TEAMS[t] || { name: `TEAM ${t + 1}`, color: '#ffffff' };
        const score = Array.isArray(data.teamScores) ? data.teamScores[t] || 0 : list.reduce((s, p) => s + (p.kills || 0), 0);
        const table = h('div.sr-sb-table', this._sbRow(null), list.map((p, i) => this._sbRow(p, i + 1)));
        for (let i = list.length; i < rows; i++) table.append(h('div.sr-sb-row.sr-sb-empty'));
        return h('div.sr-sb-team', { style: { '--tcr': hexToRgbTriplet(team.color) } },
          h('div.sr-sb-team-head', h('div', h('div.sr-sb-team-name', { style: { color: team.color } }, team.name),
            h('div.sr-sb-team-tag', t === my ? 'YOUR TEAM' : 'ENEMY TEAM')), h('span.sr-sb-team-score', String(score))),
          table);
      }));
      inner = h('div.sr-sb-inner', head, body, h('div.sr-sb-hint', 'RELEASE TAB TO CLOSE'));
    } else {
      body = h('div.sr-sb-table', this._sbRow(null), players.map((p, i) => this._sbRow(p, i + 1)));
      inner = h('div.sr-sb-inner.sr-sb-ffa', head, body, h('div.sr-sb-hint', 'RELEASE TAB TO CLOSE'));
    }
    clear(E.sb).append(inner);
  }

  _sbRow(p, rank, compact = false) {
    const cls = compact ? 'div.sr-sb-row.sr-me-row' : 'div.sr-sb-row';
    if (!p) {
      const cells = compact ? ['#', 'PLAYER', 'K', 'D', 'A', 'SCORE'] : ['#', 'PLAYER', 'K', 'D', 'A', 'K/D', 'SCORE', 'PING'];
      return h(`${cls}.sr-sb-th`, cells.map((c, i) => h('span', { class: i === 1 ? 'sr-sb-name' : i === 0 ? 'sr-sb-rank' : '' }, c)));
    }
    const kd = p.deaths ? (p.kills || 0) / p.deaths : (p.kills || 0);
    const name = h('span.sr-sb-name', p.alive === false ? icon('skull', 'sr-sb-skull') : null, h('em', p.name || '?'), p.isBot ? h('span.sr-sb-bot', 'BOT') : null);
    const cells = [
      h('span.sr-sb-rank', String(rank)), name,
      h('span', String(p.kills || 0)), h('span', String(p.deaths || 0)), h('span', String(p.assists || 0)),
    ];
    if (!compact) cells.push(h('span', kd.toFixed(2)));
    cells.push(h('span.sr-sb-score', String(p.score || 0)));
    if (!compact) cells.push(h('span.sr-sb-ping', p.isBot ? '—' : p.ping === undefined || p.ping === null ? '' : String(Math.round(p.ping))));
    return h(cls, { class: `${p.isLocal ? 'sr-is-local' : ''} ${p.alive === false ? 'sr-is-dead' : ''}` }, cells);
  }

  /**
   * Death overlay with killer card and respawn countdown; "PRESS SPACE TO DEPLOY" when ready.
   * @param {{killerName?:string, killerTeam?:number, weaponName?:string, distance?:number, headshot?:boolean, respawnIn?:number}} d
   */
  showDeath(d = {}) {
    const E = this._e;
    const D = this._death;
    D.visible = true;
    D.total = Math.max(0.01, Number(d.respawnIn) || 0);
    D.left = Number(d.respawnIn) || 0;
    D.ready = false;
    D.deployed = false;
    setText(E.dKicker, d.killerName ? 'KILLED BY' : 'KILLED IN ACTION');
    setText(E.dKiller, d.killerName || 'YOU DIED');
    E.dKiller.style.color = d.killerName ? (d.killerTeam !== undefined && d.killerTeam !== null ? teamColor(d.killerTeam) : '#ff6b5e') : '#ffffff';
    clear(E.dFacts);
    if (d.weaponName) E.dFacts.append(h('div.sr-death-fact', h('span.sr-label', 'Weapon'), h('span.sr-num', d.weaponName)));
    if (typeof d.distance === 'number') E.dFacts.append(h('div.sr-death-fact', h('span.sr-label', 'Distance'), h('span.sr-num', `${Math.round(d.distance)} M`)));
    if (d.headshot) E.dFacts.append(h('div.sr-death-fact.sr-is-head', h('span.sr-label', 'Hit'), h('span.sr-num', 'HEADSHOT')));
    setClass(E.death, 'sr-is-on', true);
    setClass(E.root, 'sr-ovl-death', true);
    E.death.classList.remove('sr-is-ready');
    E.dDeployBtn.disabled = true;
    this._renderRespawn();
  }

  /** Override the respawn countdown (seconds). */
  updateRespawn(secondsLeft) {
    const D = this._death;
    if (!D.visible) return;
    D.left = Math.max(0, Number(secondsLeft) || 0);
    if (D.left > D.total) D.total = D.left;
    if (D.left > 0 && D.ready) {
      D.ready = false;
      this._e.death.classList.remove('sr-is-ready');
      this._e.dDeployBtn.disabled = true;
    }
    this._renderRespawn();
  }

  _renderRespawn() {
    const D = this._death;
    const E = this._e;
    const left = Math.max(0, D.left);
    setText(E.dNum, String(Math.ceil(left)));
    const frac = D.total > 0 ? 1 - left / D.total : 1;
    const ring = E.dRing.querySelector('.sr-ring');
    const off = (E.dRingC * (1 - frac)).toFixed(2);
    if (ring._off !== off) { ring._off = off; ring.setAttribute('stroke-dashoffset', off); }
    if (left <= 0 && !D.ready) {
      D.ready = true;
      E.death.classList.add('sr-is-ready');
      E.dDeployBtn.disabled = false;
    }
  }

  _deploy() {
    const D = this._death;
    if (!D.visible || !D.ready || D.deployed) return;
    D.deployed = true;
    this._cb('onDeploy');
  }

  /** Hide the death overlay. */
  hideDeath() {
    this._death.visible = false;
    setClass(this._e.death, 'sr-is-on', false);
    setClass(this._e.root, 'sr-ovl-death', false);
  }

  /**
   * End-of-match overlay.
   * @param {{title?:string, subtitle?:string, players?:Array, mvp?:{name:string,kills:number,deaths:number,score:number}, nextIn?:number}} d
   */
  showMatchEnd(d = {}) {
    const E = this._e;
    const title = String(d.title || 'MATCH OVER').toUpperCase();
    const cls = title === 'VICTORY' ? 'sr-is-win' : title === 'DEFEAT' ? 'sr-is-loss' : '';
    const players = (d.players || []).slice(0, 10);
    const nextEl = h('b', String(Math.ceil(d.nextIn || 0)));
    const mvp = d.mvp;
    const stat = (label, v) => h('div.sr-fact', h('span.sr-label', label), h('span.sr-fact-val', String(v)));
    clear(E.me).append(h('div.sr-me-inner',
      h('div.sr-kicker', 'Match complete'),
      h('div.sr-me-title', { class: cls }, title),
      d.subtitle ? h('div.sr-me-sub', d.subtitle) : null,
      h('div.sr-me-body',
        mvp ? h('div.sr-me-mvp.sr-panel.sr-brackets',
          h('div.sr-kicker', 'Most valuable player'),
          h('div.sr-me-mvp-name', mvp.name || '?'),
          h('div.sr-me-mvp-stats', stat('Kills', mvp.kills || 0), stat('Deaths', mvp.deaths || 0), stat('Score', mvp.score || 0))) : null,
        players.length ? h('div.sr-me-table.sr-sb-table', this._sbRow(null, 0, true), players.map((p, i) => this._sbRow(p, i + 1, true))) : null),
      typeof d.nextIn === 'number' ? h('div.sr-me-next', 'NEXT MATCH IN ', nextEl) : null));
    this._me = { visible: true, left: Number(d.nextIn) || 0, nextEl };
    setClass(E.me, 'sr-is-on', true);
    setClass(E.root, 'sr-ovl-end', true);
  }

  /** Hide the match end overlay. */
  hideMatchEnd() {
    this._me.visible = false;
    setClass(this._e.me, 'sr-is-on', false);
    setClass(this._e.root, 'sr-ovl-end', false);
  }

  /** FPS counter (top-right); null hides it. */
  setFps(fps) {
    const v = fps === null || fps === undefined ? null : Math.round(fps);
    if (v === this._s.fps) return;
    this._s.fps = v;
    const el = this._e.fps;
    clear(el);
    if (v !== null) el.append(String(v), h('small', 'FPS'));
  }

  /** Ping (top-right); null hides it. */
  setPing(ms) {
    const v = ms === null || ms === undefined ? null : Math.round(ms);
    if (v === this._s.ping) return;
    this._s.ping = v;
    const el = this._e.ping;
    clear(el);
    if (v !== null) {
      el.append(String(v), h('small', 'MS'));
      el.style.color = v > 150 ? '#ff6b5e' : v > 80 ? '#ffb000' : '';
    }
  }

  /** Spawn protection badge above the health bar. */
  setSpawnProtection(on) {
    on = !!on;
    if (on === this._s.spawnProt) return;
    this._s.spawnProt = on;
    setClass(this._e.spawnProt, 'sr-is-on', on);
  }

  /** "Return to the combat area" warning with countdown; null hides it. */
  setOutOfBounds(secondsLeft) {
    const on = secondsLeft !== null && secondsLeft !== undefined;
    const E = this._e;
    setClass(E.oob, 'sr-is-on', on);
    setClass(E.oobEdge, 'sr-is-on', on);
    if (on) setText(E.oobNum, String(Math.max(0, Math.ceil(secondsLeft))));
  }

  /** Interaction prompt under the crosshair, e.g. '[F] Open door'; null hides it. */
  setInteraction(text) {
    const t = text === null || text === undefined || text === '' ? null : String(text);
    if (t === this._s.interact) return;
    this._s.interact = t;
    const E = this._e;
    clear(E.interact);
    setClass(E.interact, 'sr-is-on', !!t);
    if (!t) return;
    const m = /^\[([^\]]+)\]\s*(.*)$/.exec(t);
    if (m) E.interact.append(h('span.sr-key', m[1]), m[2]);
    else E.interact.append(t);
  }

  /** Remove listeners and DOM. */
  dispose() {
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize);
    this._e.root.remove();
  }
}
