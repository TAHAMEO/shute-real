// SHUTE REAL — menus: main, solo setup, multiplayer browser, room creation, loadout (with live
// 3D preview), settings, controls, pause, loading overlay and toasts.
// All markup is built inside the root element passed to the constructor; classes use `sr-`.
import {
  h, svg, clear, setText, icon, clamp, fmtTime, seededRandom,
} from './dom.js';
import { MAPS, MAP_BY_ID } from '/shared/maps.js';
import { MODES, BOT_DIFFICULTY, GAME_NAME, GAME_VERSION } from '/shared/constants.js';
import {
  WEAPONS, WEAPON_LIST, CATEGORIES, OPTICS, MUZZLES, GRIPS, EQUIPMENT,
  weaponStatBars, sanitizeLoadout, defaultAttachments, defaultLoadout, weaponHandling,
} from '/shared/weapons.js';
import { GRAPHICS_PRESETS, SETTING_OPTIONS, applyPreset, defaultSettings } from '../settings.js';
import { WeaponPreview } from './weapon-preview.js';

const SCREENS = ['main', 'solo', 'multiplayer', 'create', 'loadout', 'settings', 'controls', 'pause', 'none'];
const TIME_LIMITS = [300, 600, 900, 1200];
const PRIMARY_CATS = Object.keys(CATEGORIES).filter((c) => c !== 'PISTOL');
const SECONDARIES = WEAPON_LIST.filter((w) => w.slot === 'secondary');
const UI_STORE_KEY = 'shute-real.ui.v1';
const NAME_MAX = 16;

export const TIPS = [
  'Health regenerates after a few seconds out of combat. Break line of sight to recover.',
  'Battle rifles, machine guns and sniper rifles punch through thin wood and sheet metal.',
  'Bolt-action rifles are lethal with a single headshot at any range.',
  'Crouch or go prone to tighten your spread and shrink your silhouette.',
  'Lean around corners with Q and E to expose as little of yourself as possible.',
  'Suppressors hide your muzzle report but slightly reduce effective range.',
  'Bullets travel at realistic velocities. Lead moving targets at long range.',
  'Press B to switch fire modes. Semi-auto keeps your rounds on target at distance.',
  'Frag grenades have a 3.5 second fuse. Bounce them around corners to flush enemies out.',
  'Smoke grenades screen you for about 28 seconds. Use them to cross open ground.',
  'Switching to your pistol is faster than reloading in a close fight.',
  'Compensators and grips reduce recoil. Check the control bar in the loadout.',
  'Hold Tab for the scoreboard and press M for the tactical map.',
  'Spawn protection keeps you safe for two seconds after you deploy.',
  'Shotgun pellets lose their punch quickly beyond twenty metres.',
  'Loadout changes made mid-match apply the next time you deploy.',
];

// --------------------------------------------------------------------------------------------
// Stylised map art (SVG): gradient sky, sun glow, layered mountain ridges, tree lines, landmark.

const MAP_ART = {
  valley: {
    sky: [[0, '#1f2f52'], [0.42, '#6d5a78'], [0.72, '#e39a5e'], [1, '#ffd796']],
    sun: { x: 0.72, y: 0.6, r: 0.055, core: '#fff1cf', glow: '#ffb45a' },
    layers: [
      { color: '#a3787a', base: 0.6, amp: 0.2, rough: 0.5, haze: '#f2a866' },
      { color: '#674a4a', base: 0.7, amp: 0.13, rough: 0.55, haze: '#d98b5a' },
      { color: '#352820', base: 0.82, amp: 0.05, rough: 0.35, trees: { color: '#1a1611', count: 26, h: 0.085 } },
    ],
    ground: ['#5e4b25', '#1f190f'],
    feature: 'radio',
  },
  outpost: {
    sky: [[0, '#3f82c4'], [0.55, '#8fc0e6'], [1, '#e4f2f7']],
    sun: { x: 0.22, y: 0.24, r: 0.05, core: '#ffffff', glow: '#fff4cf' },
    layers: [
      { color: '#93b2c3', base: 0.58, amp: 0.12, rough: 0.45, haze: '#d4e8f0' },
      { color: '#45705a', base: 0.7, amp: 0.06, rough: 0.4, trees: { color: '#2d523d', count: 46, h: 0.08 }, haze: '#bcd8d8' },
      { color: '#21402c', base: 0.84, amp: 0.03, rough: 0.3, trees: { color: '#163222', count: 30, h: 0.13 } },
    ],
    ground: ['#4f6e33', '#1b2a14'],
    feature: 'cabins',
  },
  ridge: {
    sky: [[0, '#454d57'], [0.5, '#7b838c'], [1, '#b2b7bc']],
    sun: null,
    clouds: true,
    layers: [
      { color: '#848b93', base: 0.48, amp: 0.3, rough: 1, haze: '#a9aeb3' },
      { color: '#5a6168', base: 0.64, amp: 0.2, rough: 0.9, haze: '#8e949a' },
      { color: '#2f343a', base: 0.82, amp: 0.07, rough: 0.6 },
    ],
    ground: ['#3d423f', '#181b1a'],
    feature: 'tower',
  },
};

let artCounter = 0;

function artFor(map) {
  if (MAP_ART[map.id]) return MAP_ART[map.id];
  // deterministic fallback palette for unknown maps
  const r = seededRandom(map.id || 'map');
  const hue = Math.floor(r() * 360);
  const hsl = (s, l, hh = hue) => `hsl(${hh} ${s}% ${l}%)`;
  return {
    sky: [[0, hsl(40, 25)], [0.6, hsl(35, 55)], [1, hsl(30, 78, hue + 20)]],
    sun: { x: 0.3 + r() * 0.4, y: 0.35, r: 0.05, core: '#fffbe8', glow: hsl(80, 75, hue + 30) },
    layers: [
      { color: hsl(18, 50), base: 0.58, amp: 0.16, rough: 0.6, haze: hsl(30, 70) },
      { color: hsl(20, 32), base: 0.7, amp: 0.1, rough: 0.5 },
      { color: hsl(22, 16), base: 0.83, amp: 0.05, rough: 0.4, trees: { color: hsl(25, 10), count: 20, h: 0.09 } },
    ],
    ground: [hsl(30, 22), hsl(30, 8)],
    feature: null,
  };
}

function ridgeHeights(rng, n, rough) {
  const oct = [
    { f: 2, a: 1 }, { f: 5, a: 0.25 + 0.45 * rough }, { f: 11, a: 0.08 + 0.3 * rough }, { f: 27, a: 0.14 * rough },
  ];
  const tables = oct.map((o) => Array.from({ length: o.f + 2 }, () => rng()));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    let v = 0;
    let norm = 0;
    oct.forEach((o, k) => {
      const t = x * o.f;
      const i0 = Math.floor(t);
      const fr = t - i0;
      const s = rough > 0.8 ? fr : fr * fr * (3 - 2 * fr);
      v += o.a * (tables[k][i0] * (1 - s) + tables[k][i0 + 1] * s);
      norm += o.a;
    });
    out.push(v / norm);
  }
  return out;
}

/**
 * Stylised SVG landscape for a map (thumbnail / loading art).
 * @param {object} map entry of MAPS
 * @returns {string} SVG markup (viewBox 400x225, slice-scaled)
 */
export function mapArtSVG(map) {
  const W = 400;
  const H = 225;
  const A = artFor(map);
  const id = `sra${++artCounter}`;
  const rng = seededRandom('art-' + map.id);
  const f = (n) => n.toFixed(1);
  let defs = `<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">${A.sky.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
  defs += `<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${A.ground[0]}"/><stop offset="1" stop-color="${A.ground[1]}"/></linearGradient>`;
  defs += `<radialGradient id="${id}v" cx="0.5" cy="0.45" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>`;
  let body = `<rect width="${W}" height="${H}" fill="url(#${id}s)"/>`;
  if (A.sun) {
    const sx = A.sun.x * W;
    const sy = A.sun.y * H;
    defs += `<radialGradient id="${id}sun"><stop offset="0" stop-color="${A.sun.glow}" stop-opacity="0.85"/><stop offset="0.35" stop-color="${A.sun.glow}" stop-opacity="0.32"/><stop offset="1" stop-color="${A.sun.glow}" stop-opacity="0"/></radialGradient>`;
    body += `<circle cx="${f(sx)}" cy="${f(sy)}" r="${f(H * 0.75)}" fill="url(#${id}sun)"/>`;
    body += `<circle cx="${f(sx)}" cy="${f(sy)}" r="${f(A.sun.r * H)}" fill="${A.sun.core}"/>`;
  }
  if (A.clouds) {
    defs += `<filter id="${id}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>`;
    let c = '';
    for (let i = 0; i < 9; i++) {
      const cx = rng() * W;
      const cy = 20 + rng() * 70;
      c += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(50 + rng() * 80)}" ry="${f(10 + rng() * 14)}" fill="${i % 2 ? '#cfd3d7' : '#5d646c'}" opacity="${(0.25 + rng() * 0.35).toFixed(2)}"/>`;
    }
    body += `<g filter="url(#${id}b)">${c}</g>`;
  }
  const N = 64;
  A.layers.forEach((L, li) => {
    const hts = ridgeHeights(rng, N, L.rough);
    const ys = hts.map((v) => (L.base - L.amp * (v - 0.35)) * H);
    let d = `M0 ${H} `;
    for (let i = 0; i <= N; i++) d += `L${f((i / N) * W)} ${f(ys[i])} `;
    d += `L${W} ${H} Z`;
    if (L.haze) {
      const hy = Math.min(...ys);
      defs += `<linearGradient id="${id}h${li}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.haze}" stop-opacity="0"/><stop offset="1" stop-color="${L.haze}" stop-opacity="0.55"/></linearGradient>`;
      body += `<rect x="0" y="${f(hy - 30)}" width="${W}" height="${f(H - hy + 30)}" fill="url(#${id}h${li})"/>`;
    }
    body += `<path d="${d}" fill="${L.color}"/>`;
    if (L.trees) {
      let t = '';
      for (let k = 0; k < L.trees.count; k++) {
        const x = rng() * W;
        const i = Math.min(N, Math.max(0, Math.round((x / W) * N)));
        const y = ys[i] + 2 + rng() * 6;
        const th = L.trees.h * H * (0.6 + rng() * 0.6);
        const tw = th * 0.42;
        t += `M${f(x)} ${f(y - th)}L${f(x + tw / 2)} ${f(y - th * 0.3)}L${f(x + tw * 0.18)} ${f(y - th * 0.36)}L${f(x + tw * 0.6)} ${f(y)}L${f(x - tw * 0.6)} ${f(y)}L${f(x - tw * 0.18)} ${f(y - th * 0.36)}L${f(x - tw / 2)} ${f(y - th * 0.3)}Z`;
      }
      body += `<path d="${t}" fill="${L.trees.color}"/>`;
    }
    if (li === 1 && A.feature) {
      // landmark on the mid ridge's highest point (right half)
      let bi = Math.floor(N * 0.55);
      for (let i = Math.floor(N * 0.55); i < Math.floor(N * 0.9); i++) if (ys[i] < ys[bi]) bi = i;
      const x = (bi / N) * W;
      const y = ys[bi] + 1;
      const col = L.color;
      if (A.feature === 'radio') {
        body += `<g stroke="${A.layers[2].color}" stroke-width="1.4" fill="none"><path d="M${f(x)} ${f(y)}V${f(y - 46)}M${f(x - 7)} ${f(y)}L${f(x)} ${f(y - 30)}L${f(x + 7)} ${f(y)}M${f(x - 5)} ${f(y - 14)}H${f(x + 5)}M${f(x - 3)} ${f(y - 26)}H${f(x + 3)}"/></g><circle cx="${f(x)}" cy="${f(y - 47)}" r="1.8" fill="#ff5a3a"/>`;
      } else if (A.feature === 'tower') {
        body += `<g stroke="#262a2f" stroke-width="1.3" fill="none"><path d="M${f(x - 9)} ${f(y)}L${f(x - 2)} ${f(y - 70)}M${f(x + 9)} ${f(y)}L${f(x + 2)} ${f(y - 70)}M${f(x - 8)} ${f(y - 8)}L${f(x + 7)} ${f(y - 24)}M${f(x + 8)} ${f(y - 8)}L${f(x - 7)} ${f(y - 24)}M${f(x - 6)} ${f(y - 26)}L${f(x + 5)} ${f(y - 44)}M${f(x + 6)} ${f(y - 26)}L${f(x - 5)} ${f(y - 44)}M${f(x - 4)} ${f(y - 46)}L${f(x + 3)} ${f(y - 64)}M${f(x + 4)} ${f(y - 46)}L${f(x - 3)} ${f(y - 64)}"/></g><path d="M${f(x)} ${f(y - 70)}V${f(y - 84)}" stroke="#262a2f" stroke-width="1.6"/><ellipse cx="${f(x + 7)}" cy="${f(y - 58)}" rx="3" ry="6" fill="#262a2f"/><circle cx="${f(x)}" cy="${f(y - 85)}" r="1.8" fill="#ff4a3a"/>`;
      } else if (A.feature === 'cabins') {
        const cx = W * 0.36;
        const cy = H * 0.86;
        body += `<g fill="#3a2a1d"><path d="M${f(cx)} ${f(cy)}h34v-14l-17-10-17 10z"/><path d="M${f(cx + 46)} ${f(cy + 3)}h24v-11l-12-8-12 8z"/></g><g fill="#2a1d14"><rect x="${f(cx + 13)}" y="${f(cy - 8)}" width="7" height="8"/></g>`;
        void col;
      }
    }
  });
  body += `<rect y="${f(H * 0.86)}" width="${W}" height="${f(H * 0.14)}" fill="url(#${id}g)" opacity="0.85"/>`;
  body += `<rect width="${W}" height="${H}" fill="url(#${id}v)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${defs}</defs>${body}</svg>`;
}

// --------------------------------------------------------------------------------------------
// Static data for the settings and controls screens.

const upper = (v) => String(v).toUpperCase();
const pct = (v) => `${Math.round(v * 100)}%`;

const SETTINGS_SCHEMA = {
  graphics: [
    { section: 'Quality' },
    { key: 'preset', label: 'Graphics Preset', type: 'cycle', options: SETTING_OPTIONS.preset, fmt: upper,
      desc: 'Applies a balanced set of graphics options. Changing any individual option switches the preset to Custom.' },
    { key: 'renderScale', label: 'Render Scale', type: 'range', min: 0.5, max: 1, step: 0.05, fmt: pct, impact: 'high',
      desc: 'Resolution of the 3D scene relative to your screen. Lower values greatly improve performance on integrated graphics.' },
    { key: 'viewDistance', label: 'View Distance', type: 'range', min: 400, max: 3000, step: 100, fmt: (v) => `${v} M`, impact: 'high',
      desc: 'How far terrain, trees and objects are drawn before fading into the haze.' },
    { key: 'shadows', label: 'Shadow Quality', type: 'cycle', options: SETTING_OPTIONS.shadows, fmt: upper, impact: 'high',
      desc: 'Resolution and reach of sun shadows. Shadows help spot enemies hiding in foliage.' },
    { key: 'grassDensity', label: 'Grass Density', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, impact: 'medium',
      desc: 'Amount of grass and ground foliage. Grass is rendered for every player identically far away, so it is purely visual up close.' },
    { key: 'treeDetail', label: 'Tree Detail', type: 'cycle', options: SETTING_OPTIONS.treeDetail, fmt: upper, impact: 'medium',
      desc: 'Level of detail of trees and vegetation at distance.' },
    { key: 'antialias', label: 'Anti-Aliasing', type: 'cycle', options: SETTING_OPTIONS.antialias,
      fmt: (v) => ({ off: 'OFF', fxaa: 'FXAA', smaa: 'SMAA' })[v] || upper(v), impact: 'low',
      desc: 'Smooths jagged edges. SMAA is sharper, FXAA is cheaper.' },
    { key: 'anisotropy', label: 'Texture Filtering', type: 'cycle', options: [1, 2, 4, 8, 16],
      fmt: (v) => (v <= 1 ? 'BILINEAR' : `${v}× ANISOTROPIC`), impact: 'low',
      desc: 'Keeps ground textures sharp at grazing angles.' },
    { section: 'Effects' },
    { key: 'ao', label: 'Ambient Occlusion', type: 'toggle', impact: 'medium',
      desc: 'Adds soft contact shadows in corners, under objects and between foliage.' },
    { key: 'bloom', label: 'Bloom', type: 'toggle', impact: 'low', desc: 'Glow around the sun, muzzle flashes and bright highlights.' },
    { key: 'godrays', label: 'God Rays', type: 'toggle', impact: 'medium', desc: 'Volumetric light shafts from the sun through trees and haze.' },
    { key: 'pipScopes', label: 'Picture-in-Picture Scopes', type: 'toggle', impact: 'medium',
      desc: 'Magnified optics render a zoomed view inside the scope lens while the surroundings stay at normal zoom. Off: the whole view zooms instead.' },
    { section: 'Display' },
    { key: 'fpsLimit', label: 'Frame Rate Limit', type: 'cycle', options: SETTING_OPTIONS.fpsLimit,
      fmt: (v) => (v ? `${v} FPS` : 'UNLIMITED'), desc: 'Caps the frame rate to reduce heat, fan noise and power usage.' },
    { key: 'showFps', label: 'Show FPS Counter', type: 'toggle', desc: 'Shows a frame-rate counter in the top-right corner of the HUD.' },
  ],
  controls: [
    { section: 'Mouse' },
    { key: 'sensitivity', label: 'Mouse Sensitivity', type: 'range', min: 0.1, max: 5, step: 0.05, fmt: (v) => v.toFixed(2),
      desc: 'Look speed when firing from the hip.' },
    { key: 'adsSensitivity', label: 'Aim Sensitivity Multiplier', type: 'range', min: 0.2, max: 1.5, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`,
      desc: 'Multiplier applied to look speed while aiming down sights. Scopes scale it further by magnification.' },
    { key: 'invertY', label: 'Invert Vertical Look', type: 'toggle', desc: 'Moving the mouse forward looks down.' },
    { section: 'Actions' },
    { key: 'toggleAds', label: 'Toggle Aim', type: 'toggle', desc: 'Click once to aim instead of holding the right mouse button.' },
    { key: 'toggleCrouch', label: 'Toggle Crouch', type: 'toggle', desc: 'Press C once to crouch instead of holding it.' },
  ],
  audio: [
    { section: 'Volume' },
    { key: 'master', label: 'Master Volume', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, desc: 'Overall game volume.' },
    { key: 'sfx', label: 'Effects', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, desc: 'Weapons, footsteps, impacts and explosions.' },
    { key: 'ambient', label: 'Ambience', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, desc: 'Wind, birds and environmental sounds.' },
    { key: 'ui', label: 'Interface', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, desc: 'Menu and HUD sounds.' },
  ],
  gameplay: [
    { section: 'Profile' },
    { key: 'playerName', root: true, label: 'Callsign', type: 'text', desc: 'Your name as shown to other players in the kill feed and scoreboard.' },
    { section: 'View' },
    { key: 'fov', label: 'Field of View', type: 'range', min: 60, max: 110, step: 1, fmt: (v) => `${Math.round(v)}°`,
      desc: 'Higher values show more of the battlefield but make distant targets smaller.' },
    { key: 'headBob', label: 'Camera Bob', type: 'toggle', desc: 'Camera motion while walking and sprinting.' },
    { section: 'HUD' },
    { key: 'crosshair', label: 'Crosshair Style', type: 'cycle', options: SETTING_OPTIONS.crosshair, fmt: upper,
      desc: 'Crosshair shape shown when firing from the hip.', preview: true },
    { key: 'crosshairColor', label: 'Crosshair Colour', type: 'color', preview: true,
      swatches: ['#ffffff', '#7dff6a', '#3df2ff', '#ffe14a', '#ff4df0', '#ff4a3d'],
      desc: 'Pick a colour that stands out against both foliage and sky.' },
    { key: 'showMinimap', label: 'Show Minimap', type: 'toggle', desc: 'Shows the radar in the top-left corner.' },
  ],
};
const SETTINGS_TABS = [
  ['graphics', 'Graphics'], ['controls', 'Controls'], ['audio', 'Audio'], ['gameplay', 'Gameplay'],
];
const PRESET_KEYS = Object.keys(GRAPHICS_PRESETS.high);

const CONTROL_GROUPS = [
  ['Movement', [
    ['Move', [['W'], ['A'], ['S'], ['D']]],
    ['Sprint', [['Shift', 'wide']]],
    ['Jump', [['Space', 'wide']]],
    ['Crouch', [['C']], 'crouch'],
    ['Prone', [['Z']]],
    ['Lean left / right', [['Q'], ['E']]],
  ]],
  ['Combat', [
    ['Fire', [['@mouseL']]],
    ['Aim down sights', [['@mouseR']], 'ads'],
    ['Reload', [['R']]],
    ['Fire mode', [['B']]],
    ['Primary / secondary', [['1'], ['2']]],
    ['Switch weapon', [['@mouseW']]],
    ['Throw frag grenade', [['G']]],
    ['Throw smoke grenade', [['4']]],
    ['Melee', [['V']]],
  ]],
  ['Interface', [
    ['Scoreboard', [['Tab', 'wide']], 'hold'],
    ['Tactical map', [['M']]],
    ['Chat (all)', [['T']]],
    ['Chat (team)', [['Y']]],
    ['Pause menu', [['Esc']]],
    ['Toggle HUD', [['F1']]],
    ['Menu navigation', [['↑'], ['↓'], ['←'], ['→']], 'pad'],
    ['Menu tabs', [['Q'], ['E']], 'tabs'],
  ]],
];

const OPTIC_SHORT = { iron: 'Iron', reddot: 'Red Dot', holo: 'Holo', acog: '4× ACOG', pso: '4× PSO-1', scope8: '8× Scope' };

const LOGO_MARK = '<svg viewBox="0 0 34 20" aria-hidden="true"><path d="M0 14l8-8 8 8-3 3-5-5-5 5z" fill="currentColor"/><path d="M18 14l8-8 8 8-3 3-5-5-5 5z" fill="currentColor" opacity=".55"/></svg>';

// --------------------------------------------------------------------------------------------

function readStore() {
  try { return JSON.parse(localStorage.getItem(UI_STORE_KEY) || 'null') || {}; } catch { return {}; }
}
function writeStore(v) {
  try { localStorage.setItem(UI_STORE_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}
const clone = (o) => JSON.parse(JSON.stringify(o));

function scoreOptions(modeId) {
  const m = MODES[modeId] || MODES.ffa;
  const b = m.scoreLimit;
  const r5 = (v) => Math.max(5, Math.round(v / 5) * 5);
  return [...new Set([r5(b * 2 / 3), b, r5(b * 4 / 3), r5(b * (m.teams ? 2 : 5 / 3))])];
}

function sanitizeName(name) {
  return String(name || '').replace(/[^\w .\-[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

function isTextInput(el) {
  return el && el.tagName === 'INPUT' && /^(text|search|url|email|number|password)$/i.test(el.type || 'text');
}

function fmtModes(w) {
  return w.fireModes.map((m) => m.toUpperCase()).join(' · ');
}

function attEffects(kind, id) {
  const fx = [];
  const p = (mult, label) => {
    const d = Math.round((mult - 1) * 100);
    if (d) fx.push([`${d > 0 ? '+' : '−'}${Math.abs(d)}% ${label}`, d < 0 ? 'good' : 'bad']);
  };
  if (kind === 'optic') {
    const o = OPTICS[id];
    if (!o) return fx;
    fx.push([o.magnification ? `${o.magnification}× magnified` : `${o.zoom.toFixed(2)}× zoom`, 'note']);
    const d = Math.round((o.adsTimeMult - 1) * 100);
    if (d) fx.push([`+${d}% aim time`, 'bad']);
  } else if (kind === 'muzzle') {
    const m = MUZZLES[id];
    if (!m) return fx;
    p(m.recoilV, 'vertical recoil');
    p(m.recoilH, 'horizontal recoil');
    if (m.range !== 1) fx.push([`−${Math.round((1 - m.range) * 100)}% range`, 'bad']);
    if (m.suppressed) fx.push(['suppressed', 'note']);
  } else if (kind === 'grip') {
    const g = GRIPS[id];
    if (!g) return fx;
    p(g.recoilV, 'vertical recoil');
    p(g.recoilH, 'horizontal recoil');
    const d = Math.round((g.adsTimeMult - 1) * 100);
    if (d) fx.push([`${d > 0 ? '+' : '−'}${Math.abs(d)}% aim time`, d < 0 ? 'good' : 'bad']);
  }
  if (!fx.length) fx.push(['no modifiers', '']);
  return fx;
}

/** Stat bars for a weapon with attachments applied (control/range). */
function statsFor(w, att) {
  const s = { ...weaponStatBars(w) };
  try {
    const hd = weaponHandling(w.id, att || defaultAttachments(w.id));
    s.control = Math.max(0.05, Math.min(1, 1 - hd.recoilV / 3.5));
    s.range = Math.max(0.05, Math.min(1, (w.range[1] * hd.muzzle.range) / 500));
  } catch { /* keep base */ }
  return s;
}

const STAT_ROWS = [
  ['damage', 'Damage', (w) => (w.pellets > 1 ? `${w.damage[0]}×${w.pellets}` : `${w.damage[0]}`)],
  ['fireRate', 'Fire rate', (w) => `${w.rpm}`],
  ['range', 'Range', (w, att) => `${Math.round(w.range[1] * ((MUZZLES[att?.muzzle] || MUZZLES.none).range || 1))} m`],
  ['accuracy', 'Accuracy', (w, att, s) => `${Math.round(s.accuracy * 100)}`],
  ['control', 'Control', (w, att, s) => `${Math.round(s.control * 100)}`],
  ['mobility', 'Mobility', (w, att, s) => `${Math.round(s.mobility * 100)}`],
];

// ============================================================================================

export class MenuUI {
  /**
   * @param {HTMLElement} root container (e.g. #ui-root); the menu appends its own layer
   * @param {object} callbacks see module docs (onPlaySolo, onRefreshRooms, onCreateRoom, onJoinRoom,
   *   onConnectServer, onLoadoutChange, onSettingsChange, onPlayerNameChange, onResume, onLeaveMatch,
   *   onQuit, onSound)
   */
  constructor(root, callbacks = {}) {
    this.root = root;
    this.callbacks = callbacks || {};
    /** While a menu screen is open, <html> gets `sr-menu-open`, which hides the HUD layer. */
    this.hideHudWhenOpen = true;
    this._screen = 'none';
    this._history = [];
    this._inMatch = false;
    this._rooms = [];
    this._roomsAt = performance.now();
    this._server = { connected: false, address: '', lanUrls: [], playersOnline: 0, error: null };
    this._loadout = defaultLoadout();
    this._settings = defaultSettings();
    this._attMemory = {};
    this._built = {};
    this._loSlot = 'primary';
    this._loCat = WEAPONS[this._loadout.primary].category;
    this._loHover = null;
    this._setTab = 'graphics';
    this._setFocusKey = null;
    this._confirmLeave = false;
    this._lastSound = 0;
    this._padState = { up: {}, down: {}, left: {}, right: {}, btn: {} };
    this._loading = { visible: false, map: null, tipIdx: Math.floor(Math.random() * TIPS.length), tipTimer: 0, fixedTip: null };

    const st = readStore();
    const firstMap = MAPS[0] ? MAPS[0].id : 'valley';
    this._solo = Object.assign({
      mapId: firstMap, mode: 'ffa', bots: 7, difficulty: 'normal', timeLimit: 600, scoreLimit: MODES.ffa.scoreLimit,
    }, st.solo || {});
    this._create = Object.assign({
      name: '', mapId: firstMap, mode: 'tdm', maxPlayers: 12, bots: 6, difficulty: 'normal', timeLimit: 600,
      scoreLimit: MODES.tdm.scoreLimit,
    }, st.create || {});
    this._fixSetup(this._solo);
    this._fixSetup(this._create);

    this._buildLayer();
    this._bindGlobal();
  }

  // =========================================================== public API

  /** Current screen name. */
  get screen() {
    return this._screen;
  }

  /** The loadout screen's WeaponPreview (null until the loadout screen has been opened once). */
  get preview() {
    return this._preview || null;
  }

  /**
   * Show a screen: 'main' | 'solo' | 'multiplayer' | 'create' | 'loadout' | 'settings' | 'controls' |
   * 'pause' | 'none'. 'main', 'pause' and 'none' reset the back-navigation history.
   */
  show(screen) {
    if (!SCREENS.includes(screen)) screen = 'main';
    if (screen === 'main' || screen === 'pause' || screen === 'none') this._history = [];
    else if (this._screen !== 'none' && this._screen !== screen) this._history.push(this._screen);
    this._activate(screen);
  }

  /** Navigate back (same as Esc / the BACK button). */
  back() {
    this._sound('back');
    if (this._screen === 'pause') {
      this._resume();
      return;
    }
    const prev = this._history.pop();
    if (prev) this._activate(prev);
    else if (this._inMatch) this._resume();
    else if (this._screen !== 'main') this._activate('main');
  }

  /** @returns {boolean} true while a menu screen or the loading overlay is visible */
  isOpen() {
    return this._screen !== 'none' || this._loading.visible;
  }

  /** Room list for the multiplayer screen. */
  setRooms(rooms) {
    this._rooms = Array.isArray(rooms) ? rooms.slice() : [];
    this._roomsAt = performance.now();
    if (this._built.multiplayer) this._renderRooms();
  }

  /** Server connection info ({ connected, address, lanUrls, playersOnline, error }). */
  setServerInfo(info) {
    this._server = Object.assign({ connected: false, address: '', lanUrls: [], playersOnline: 0, error: null }, info || {});
    this._renderStatusLine();
    if (this._built.multiplayer) this._renderServer();
  }

  /** Loadout ({ primary, primaryAtt, secondary, secondaryAtt, lethal, tactical }). */
  setLoadout(loadout) {
    this._loadout = sanitizeLoadout(loadout);
    this._attMemory[this._loadout.primary] = { ...this._loadout.primaryAtt };
    this._attMemory[this._loadout.secondary] = { ...this._loadout.secondaryAtt };
    this._loCat = WEAPONS[this._loadout.primary].category;
    if (this._built.loadout) this._renderLoadout();
    this._renderMainLoadoutDesc();
  }

  /** Settings object (shape of loadSettings()). */
  setSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    this._settings = clone(Object.assign(defaultSettings(), settings));
    for (const k of ['graphics', 'controls', 'audio', 'gameplay']) {
      this._settings[k] = Object.assign(defaultSettings()[k], settings[k] || {});
    }
    this._settings.playerName = settings.playerName || this._settings.playerName;
    this.el.classList.toggle('sr-lowfx', this._settings.graphics.preset === 'low');
    if (this._els.callsign && document.activeElement !== this._els.callsign) this._els.callsign.value = this._settings.playerName;
    if (this._built.settings && this._screen === 'settings') this._renderSettingsList();
    if (this._built.controls) this._renderControls();
    for (const n of ['solo', 'create']) if (this._built[n]) this._renderHeadChip(n);
  }

  /**
   * Full-screen loading overlay.
   * @param {boolean} visible
   * @param {number} [progress] 0..1
   * @param {string|{mapId?:string,title?:string,status?:string}} [text] status text; if it contains a
   *   map name or id (e.g. 'Highland Valley' / 'Loading valley…') the map art, title and description are shown
   * @param {string} [tip] fixed tip text (otherwise built-in tips rotate)
   */
  setLoading(visible, progress = 0, text = '', tip) {
    const L = this._loading;
    const el = this._els.loading;
    if (!visible) {
      if (L.visible) {
        L.visible = false;
        el.classList.remove('sr-is-open');
        clearInterval(L.tipTimer);
        L.tipTimer = 0;
        L.map = null;
      }
      return;
    }
    const firstShow = !L.visible;
    L.visible = true;
    let status = '';
    let map = null;
    if (text && typeof text === 'object') {
      map = MAP_BY_ID[text.mapId] || null;
      status = text.status || '';
      if (text.title) L.title = text.title;
    } else {
      status = String(text || '');
      const t = status.toLowerCase();
      map = MAPS.find((m) => t.includes(m.name.toLowerCase()))
        || MAPS.find((m) => new RegExp(`(^|[^a-z])${m.id}([^a-z]|$)`).test(t)) || null;
      if (map && t.trim() === map.name.toLowerCase()) status = '';
    }
    if (map && map !== L.map) {
      L.map = map;
      this._els.loadArt.innerHTML = mapArtSVG(map);
      setText(this._els.loadTitle, map.name);
      setText(this._els.loadDesc, map.description);
      this._els.loadFacts.replaceChildren(
        this._fact('Time of day', map.timeOfDay),
        this._fact('Area', `${(map.size / 1000).toFixed(1)} km`),
        this._fact('Terrain', 'Procedural'),
      );
      this._els.loadKicker.textContent = 'Deploying to';
      this._els.loadFacts.style.display = '';
    } else if (!L.map && firstShow) {
      this._els.loadArt.innerHTML = mapArtSVG(MAPS[0] || { id: 'x' });
      setText(this._els.loadTitle, (text && text.title) || 'Loading');
      setText(this._els.loadDesc, '');
      this._els.loadKicker.textContent = GAME_NAME;
      this._els.loadFacts.style.display = 'none';
    }
    setText(this._els.loadStatus, status || 'Preparing battlefield');
    const p = clamp(Number(progress) || 0, 0, 1);
    this._els.loadBar.style.width = `${(p * 100).toFixed(2)}%`;
    setText(this._els.loadPct, `${Math.round(p * 100)}%`);
    if (tip) {
      L.fixedTip = tip;
      setText(this._els.loadTip, tip);
    } else if (firstShow) {
      L.fixedTip = null;
      setText(this._els.loadTip, TIPS[L.tipIdx % TIPS.length]);
    }
    if (firstShow) {
      el.classList.add('sr-is-open');
      clearInterval(L.tipTimer);
      L.tipTimer = setInterval(() => this._rotateTip(), 6500);
    }
  }

  /** Small notification (top-right). kind: 'info' | 'error' | 'success' */
  showToast(text, kind = 'info') {
    const k = ['info', 'error', 'success'].includes(kind) ? kind : 'info';
    const t = h(`div.sr-toast.sr-toast-${k}`, { role: k === 'error' ? 'alert' : 'status' },
      icon(k === 'error' ? 'error' : k === 'success' ? 'check' : 'info'), h('span', String(text)));
    this._els.toasts.prepend(t);
    while (this._els.toasts.children.length > 4) this._els.toasts.lastChild.remove();
    const ttl = k === 'error' ? 5200 : 3600;
    setTimeout(() => {
      t.classList.add('sr-is-out');
      setTimeout(() => t.remove(), 320);
    }, ttl);
    if (k === 'error') this._sound('error');
  }

  /** In-match mode: pause menu shows Resume/Loadout/Settings/Controls/Leave; loadout shows a notice. */
  setInMatch(inMatch) {
    this._inMatch = !!inMatch;
    this.menu.classList.toggle('sr-in-match', this._inMatch);
    this._confirmLeave = false;
    if (this._built.pause) this._renderPause();
    if (this._built.loadout) this._renderLoNotice();
  }

  /** Remove listeners, stop the preview and remove the DOM. */
  dispose() {
    document.documentElement.classList.remove('sr-menu-open');
    window.removeEventListener('keydown', this._onKeyDown, true);
    window.removeEventListener('gamepadconnected', this._onPad);
    this._padActive = false;
    clearInterval(this._loading.tipTimer);
    clearInterval(this._mpTimer);
    if (this._preview) this._preview.dispose();
    this.el.remove();
  }

  // =========================================================== layer + navigation

  _buildLayer() {
    this._els = {};
    this.el = h('div.sr-menu-layer');
    this.menu = h('div.sr-menu.sr-is-closed', { dataset: { screen: 'none' } });
    this.menu.append(h('div.sr-menu-scrim'), h('div.sr-menu-grain'));
    this._screensEl = {};
    this.el.append(this.menu);
    this._buildLoading();
    this._els.toasts = h('div.sr-toasts', { 'aria-live': 'polite' });
    this.el.append(this._els.toasts);
    this.root.append(this.el);
  }

  _activate(screen) {
    const prev = this._screen;
    if (prev !== screen && this._screensEl[prev]) {
      this._screensEl[prev].classList.remove('sr-is-active');
      this._onHide(prev);
    }
    this._screen = screen;
    this.menu.dataset.screen = screen;
    this.menu.classList.toggle('sr-is-closed', screen === 'none');
    document.documentElement.classList.toggle('sr-menu-open', screen !== 'none' && this.hideHudWhenOpen !== false);
    if (screen === 'none') {
      if (document.activeElement && this.el.contains(document.activeElement)) document.activeElement.blur();
      this._updatePadLoop();
      return;
    }
    if (!this._built[screen]) this._build(screen);
    const el = this._screensEl[screen];
    this._refresh(screen);
    if (prev !== screen) {
      el.classList.add('sr-is-active');
      this._onShow(screen);
      this._focusDefault(screen);
    }
    this._updatePadLoop();
  }

  _build(screen) {
    const fn = {
      main: () => this._buildMain(),
      solo: () => this._buildSetup('solo'),
      create: () => this._buildSetup('create'),
      multiplayer: () => this._buildMultiplayer(),
      loadout: () => this._buildLoadout(),
      settings: () => this._buildSettings(),
      controls: () => this._buildControlsScreen(),
      pause: () => this._buildPause(),
    }[screen];
    const el = fn();
    el.dataset.screenName = screen;
    this._screensEl[screen] = el;
    this.menu.append(el);
    this._built[screen] = true;
  }

  _refresh(screen) {
    if (screen === 'main') {
      this._renderStatusLine();
      this._renderMainLoadoutDesc();
      if (document.activeElement !== this._els.callsign) this._els.callsign.value = this._settings.playerName;
    } else if (screen === 'solo' || screen === 'create') this._renderSetup(screen);
    else if (screen === 'multiplayer') { this._renderRooms(); this._renderServer(); }
    else if (screen === 'loadout') this._renderLoadout();
    else if (screen === 'settings') this._renderSettings();
    else if (screen === 'controls') this._renderControls();
    else if (screen === 'pause') this._renderPause();
  }

  _onShow(screen) {
    if (screen === 'loadout' && this._preview) this._preview.start();
    if (screen === 'multiplayer') {
      this._call('onRefreshRooms');
      clearInterval(this._mpTimer);
      this._mpTimer = setInterval(() => {
        this._tickRoomTimes();
        this._mpTick = (this._mpTick || 0) + 1;
        if (this._mpTick % 6 === 0) this._call('onRefreshRooms');
      }, 1000);
    }
  }

  _onHide(screen) {
    if (screen === 'loadout' && this._preview) this._preview.stop();
    if (screen === 'multiplayer') clearInterval(this._mpTimer);
    if (screen === 'pause') this._confirmLeave = false;
  }

  _resume() {
    if (this.callbacks.onResume) this.callbacks.onResume();
    else this.show('none');
  }

  _call(name, ...args) {
    const fn = this.callbacks && this.callbacks[name];
    if (typeof fn === 'function') {
      try { return fn(...args); } catch (err) { console.error(`[MenuUI] ${name} callback failed`, err); }
    }
    return undefined;
  }

  _sound(name) {
    if (name === 'hover') {
      const now = performance.now();
      if (now - this._lastSound < 45) return;
      this._lastSound = now;
    }
    this._call('onSound', name);
  }

  _go(screen) {
    if (this._screen !== 'none' && this._screen !== screen) this._history.push(this._screen);
    this._activate(screen);
  }

  _bindGlobal() {
    this._onKeyDown = (e) => this._handleKey(e);
    window.addEventListener('keydown', this._onKeyDown, true);
    // mouse ↔ keyboard mode (focus rings only when navigating with keys / gamepad)
    this.el.addEventListener('pointermove', () => this._keynav(false), { passive: true });
    this.el.addEventListener('pointerdown', () => this._keynav(false), { passive: true });
    // hover = focus for buttons and custom controls (unified highlight, sounds)
    this.menu.addEventListener('mouseover', (e) => {
      const el = e.target.closest('button:not([disabled]), .sr-cycler');
      if (!el || !this.menu.contains(el) || el === document.activeElement) return;
      if (el.tabIndex < 0 && !el.classList.contains('sr-cycler')) return;
      if (isTextInput(document.activeElement)) return;
      el.focus({ preventScroll: true });
    });
    this.menu.addEventListener('focusin', (e) => {
      if (e.target.matches('button, .sr-cycler, input, .sr-range')) this._sound('hover');
      const row = e.target.closest('.sr-set-row');
      if (row && row.dataset.key) this._showSettingDesc(row.dataset.key);
    });
    this.menu.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && !b.disabled && !b.classList.contains('sr-back') && !b.dataset.nosound) this._sound('click');
    });
    this._onPad = () => this._updatePadLoop();
    window.addEventListener('gamepadconnected', this._onPad);
  }

  _keynav(on) {
    if (this._keynavOn === on) return;
    this._keynavOn = on;
    this.el.classList.toggle('sr-keynav', on);
  }

  _handleKey(e) {
    if (this._loading.visible && this._screen === 'none') return;
    if (this._screen === 'none') return;
    const t = document.activeElement;
    const inText = isTextInput(t);
    const key = e.key;
    if (key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this._loading.visible) return;
      if (inText) { t.blur(); return; }
      if (this._screen === 'pause' && this._confirmLeave) { this._confirmLeave = false; this._renderPause(); return; }
      this.back();
      return;
    }
    if (this._loading.visible) return;
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[key];
    if (dir) {
      if (inText && (dir === 'left' || dir === 'right')) return;
      this._keynav(true);
      e.preventDefault();
      e.stopPropagation();
      this._direction(dir);
      return;
    }
    if (key === 'Tab') { this._keynav(true); return; }
    if (inText) return;
    if (key === 'Enter' && t && t.classList && t.classList.contains('sr-cycler')) {
      e.preventDefault();
      this._cycle(t, 1);
      return;
    }
    if (key === 'q' || key === 'Q' || key === 'PageUp') { if (this._tabStep(-1)) e.preventDefault(); }
    if (key === 'e' || key === 'E' || key === 'PageDown') { if (this._tabStep(1)) e.preventDefault(); }
  }

  /** Directional input (keyboard arrows / gamepad d-pad). */
  _direction(dir) {
    const t = document.activeElement;
    const horiz = dir === 'left' || dir === 'right';
    if (t && this.menu.contains(t) && horiz) {
      if (t.classList.contains('sr-cycler')) { this._cycle(t, dir === 'left' ? -1 : 1); return; }
      if (t.classList.contains('sr-range')) {
        const step = Number(t.step) || 1;
        const v = clamp(Number(t.value) + (dir === 'left' ? -step : step), Number(t.min), Number(t.max));
        t.value = String(Math.round(v / step) * step);
        t.dispatchEvent(new Event('input', { bubbles: true }));
        t.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      if (t.classList.contains('sr-toggle')) {
        if (t.classList.contains('sr-is-on') !== (dir === 'right')) t.click();
        return;
      }
    }
    this._spatial(dir);
  }

  _focusables() {
    const scr = this._screensEl[this._screen];
    if (!scr) return [];
    const list = scr.querySelectorAll('button:not([disabled]), input:not([disabled]), .sr-cycler');
    const out = [];
    for (const el of list) {
      if (el.tabIndex < 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      out.push(el);
    }
    return out;
  }

  _spatial(dir) {
    const els = this._focusables();
    if (!els.length) return;
    const cur = document.activeElement;
    if (!cur || !els.includes(cur)) {
      this._focusDefault(this._screen, true);
      return;
    }
    const r0 = cur.getBoundingClientRect();
    const cx0 = (r0.left + r0.right) / 2;
    const cy0 = (r0.top + r0.bottom) / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of els) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const overlapX = Math.min(r.right, r0.right) - Math.max(r.left, r0.left) > 2;
      const overlapY = Math.min(r.bottom, r0.bottom) - Math.max(r.top, r0.top) > 2;
      let primary;
      let secondary;
      if (dir === 'down') {
        if (cy <= cy0 + 2 || r.top < r0.top + 2) continue;
        primary = Math.max(0, r.top - r0.bottom);
        secondary = overlapX ? Math.abs(cx - cx0) * 0.05 : Math.abs(cx - cx0);
      } else if (dir === 'up') {
        if (cy >= cy0 - 2 || r.bottom > r0.bottom - 2) continue;
        primary = Math.max(0, r0.top - r.bottom);
        secondary = overlapX ? Math.abs(cx - cx0) * 0.05 : Math.abs(cx - cx0);
      } else if (dir === 'right') {
        if (cx <= cx0 + 2 || r.left < r0.left + 2) continue;
        primary = Math.max(0, r.left - r0.right);
        secondary = overlapY ? Math.abs(cy - cy0) * 0.05 : Math.abs(cy - cy0);
      } else {
        if (cx >= cx0 - 2 || r.right > r0.right - 2) continue;
        primary = Math.max(0, r0.left - r.right);
        secondary = overlapY ? Math.abs(cy - cy0) * 0.05 : Math.abs(cy - cy0);
      }
      const score = primary + secondary * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) best.focus();
  }

  _focusDefault(screen, force = false) {
    const scr = this._screensEl[screen];
    if (!scr) return;
    const el = scr.querySelector('[data-default-focus]:not([disabled])') || this._focusables()[0];
    if (!el) return;
    if (force || !isTextInput(document.activeElement)) el.focus({ preventScroll: true });
  }

  _tabStep(d) {
    if (this._screen === 'settings') {
      const i = SETTINGS_TABS.findIndex(([k]) => k === this._setTab);
      const n = SETTINGS_TABS[(i + d + SETTINGS_TABS.length) % SETTINGS_TABS.length][0];
      this._setTab = n;
      this._sound('click');
      this._renderSettings();
      return true;
    }
    if (this._screen === 'loadout') {
      const i = PRIMARY_CATS.indexOf(this._loCat);
      this._loCat = PRIMARY_CATS[(i + d + PRIMARY_CATS.length) % PRIMARY_CATS.length];
      this._sound('click');
      this._renderLoLeft();
      return true;
    }
    return false;
  }

  _updatePadLoop() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const want = this._screen !== 'none' && pads.length > 0;
    if (want && !this._padActive) {
      this._padActive = true;
      const loop = () => {
        if (!this._padActive) return;
        this._pollPad();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    } else if (!want) {
      this._padActive = false;
    }
  }

  _pollPad() {
    if (this._screen === 'none') { this._padActive = false; return; }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) return;
    const now = performance.now();
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const ax = gp.axes[0] || 0;
    const ay = gp.axes[1] || 0;
    const dirs = { up: b(12) || ay < -0.6, down: b(13) || ay > 0.6, left: b(14) || ax < -0.6, right: b(15) || ax > 0.6 };
    for (const d of Object.keys(dirs)) {
      const s = this._padState[d];
      if (dirs[d]) {
        if (!s.held) { s.held = true; s.next = now + 380; this._keynav(true); this._direction(d); }
        else if (now >= s.next) { s.next = now + 110; this._direction(d); }
      } else s.held = false;
    }
    const edge = (i) => {
      const was = this._padState.btn[i];
      const is = b(i);
      this._padState.btn[i] = is;
      return is && !was;
    };
    if (edge(0)) {
      this._keynav(true);
      const t = document.activeElement;
      if (t && this.menu.contains(t)) {
        if (t.classList.contains('sr-cycler')) this._cycle(t, 1);
        else if (isTextInput(t)) t.blur();
        else if (t.click) t.click();
      } else this._focusDefault(this._screen, true);
    }
    if (edge(1)) {
      const t = document.activeElement;
      if (isTextInput(t)) t.blur();
      else if (this._screen === 'pause' && this._confirmLeave) { this._confirmLeave = false; this._renderPause(); }
      else this.back();
    }
    if (edge(4)) this._tabStep(-1);
    if (edge(5)) this._tabStep(1);
    if (edge(9) && this._screen === 'pause') this._resume();
  }

  /** Rebuild a container while keeping keyboard focus on the element with the same data-fk. */
  _rerender(container, build) {
    const a = document.activeElement;
    const fk = a && container.contains(a) ? a.dataset.fk : null;
    const scroll = container.scrollTop;
    clear(container);
    build(container);
    container.scrollTop = scroll;
    if (fk) {
      const el = container.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
      if (el) el.focus({ preventScroll: true });
    }
  }

  // =========================================================== shared builders

  _shell(name, title, kicker, opts = {}) {
    const back = h('button.sr-back', { type: 'button', onclick: () => this.back(), dataset: { fk: 'back' } },
      icon('back'), 'Back', h('span.sr-key', 'Esc'));
    const right = h('div.sr-head-right');
    const head = h('header.sr-head', back,
      h('div.sr-head-titles', h('div.sr-kicker', kicker), h('h1.sr-head-title', title)), right);
    const body = h('div.sr-body');
    const foot = h('footer.sr-foot',
      h('div.sr-foot-left', opts.footLeft || null),
      this._hint(['↑', '↓', '←', '→'], 'Navigate'),
      this._hint(['Enter'], 'Select'),
      opts.tabs ? this._hint(['Q', 'E'], opts.tabs) : null,
      this._hint(['Esc'], 'Back'));
    const el = h(`section.sr-screen.sr-screen-${name}`, head, body, foot);
    return { el, head, right, body, foot };
  }

  _hint(keys, label) {
    return h('span.sr-foot-hint', keys.map((k) => h('span.sr-key', k)), label);
  }

  _fact(label, value) {
    return h('div.sr-fact', h('span.sr-label', label), h('span.sr-fact-val', value));
  }

  _seg(fk, options, current, onPick) {
    return h('div.sr-seg', { role: 'radiogroup' }, options.map((o) => h('button.sr-seg-opt', {
      type: 'button',
      class: o.value === current ? 'sr-is-sel' : '',
      role: 'radio',
      'aria-checked': String(o.value === current),
      dataset: { fk: `${fk}:${o.value}` },
      onclick: () => onPick(o.value),
    }, o.label, o.sub ? h('small', o.sub) : null)));
  }

  _stepper(fk, { min, max, step = 1, value, fmt = String, onChange }) {
    const val = h('span.sr-step-val', fmt(value));
    const range = h('input.sr-range', {
      type: 'range', min, max, step, value, dataset: { fk: `${fk}:range` }, 'aria-label': fk,
    });
    const setP = () => range.style.setProperty('--p', `${((range.value - min) / (max - min)) * 100}%`);
    setP();
    const commit = (v, fromRange) => {
      v = clamp(Math.round(v / step) * step, min, max);
      if (!fromRange) range.value = v;
      setP();
      setText(val, fmt(v));
      onChange(v);
    };
    range.addEventListener('input', () => commit(Number(range.value), true));
    const dec = h('button.sr-step-btn', { type: 'button', 'aria-label': 'Decrease', dataset: { fk: `${fk}:dec` },
      onclick: () => commit(Number(range.value) - step) }, icon('minus'));
    const inc = h('button.sr-step-btn', { type: 'button', 'aria-label': 'Increase', dataset: { fk: `${fk}:inc` },
      onclick: () => commit(Number(range.value) + step) }, icon('plus'));
    return h('div.sr-form-stepper', { style: 'display:flex;flex-direction:column;gap:calc(var(--sr-u)*8)' },
      h('div.sr-stepper', dec, val, inc, h('div', { style: 'flex:1;display:flex;align-items:center' }, range)));
  }

  _formRow(label, control, hint) {
    return h('div.sr-form-row',
      h('div.sr-form-row-head', h('span.sr-label', label), hint ? h('span.sr-hint', hint) : null), control);
  }

  _renderHeadChip(name) {
    const right = this._screensEl[name] && this._screensEl[name].querySelector('.sr-head-right');
    if (!right) return;
    clear(right).append(h('span.sr-head-chip', icon('user'), h('b', this._settings.playerName)));
  }

  // =========================================================== MAIN

  _buildMain() {
    const el = h('section.sr-screen.sr-screen-main');
    const logo = h('div.sr-logo', { 'aria-label': GAME_NAME },
      h('div.sr-logo-mark', svg(LOGO_MARK), h('span', 'EST. 2026')),
      h('div.sr-logo-word', h('span.sr-logo-a', 'SHUTE'), h('span.sr-logo-b', 'REAL')),
      h('div.sr-logo-tag', h('i'), h('span', 'TACTICAL COMBAT'), h('i')));
    const item = (key, label, desc, idx, extra = '') => h(`button.sr-mm-item${extra}`, {
      type: 'button',
      dataset: { fk: `mm:${key}`, ...(idx === 1 ? { defaultFocus: '' } : {}) },
      onclick: () => this._mainAction(key),
    },
    h('span.sr-mm-idx', String(idx).padStart(2, '0')),
    h('span.sr-mm-text', h('span.sr-mm-label', label), desc !== null ? h('span.sr-mm-desc', desc) : null),
    h('span.sr-mm-arrow', icon('chevronR')));
    this._els.mmLoadoutDesc = h('span');
    const loadoutItem = item('loadout', 'Loadout', '', 3);
    loadoutItem.querySelector('.sr-mm-desc').replaceWith(h('span.sr-mm-desc', this._els.mmLoadoutDesc));
    const nav = h('nav.sr-mm', { 'aria-label': 'Main menu' },
      item('solo', 'Solo vs Bots', 'Skirmish against AI squads, offline', 1),
      item('multiplayer', 'Multiplayer', 'LAN and online rooms · host or join', 2),
      loadoutItem,
      item('settings', 'Settings', 'Graphics, controls, audio, gameplay', 4),
      item('controls', 'Controls', 'Key bindings reference', 5),
      h('div.sr-mm-gap'),
      item('quit', 'Quit', null, 6, '.sr-mm-quit'));

    const callsign = h('input.sr-input', {
      type: 'text', maxLength: NAME_MAX, spellcheck: false, autocomplete: 'off', value: this._settings.playerName,
      'aria-label': 'Callsign', dataset: { fk: 'callsign' },
    });
    callsign.addEventListener('keydown', (e) => { if (e.key === 'Enter') callsign.blur(); });
    callsign.addEventListener('change', () => this._commitName(callsign));
    callsign.addEventListener('blur', () => this._commitName(callsign));
    this._els.callsign = callsign;
    this._els.statusDot = h('i.sr-dot');
    this._els.statusText = h('span');
    const bottom = h('div.sr-main-bottom',
      h('label.sr-callsign', h('span.sr-label', 'Callsign'), h('div.sr-callsign-row', icon('user'), callsign)),
      h('div.sr-status-line', this._els.statusDot, this._els.statusText));
    el.append(h('div.sr-main-left', logo, nav, bottom));

    // news / intel panel
    const day = Math.floor(Date.now() / 86400000);
    const featured = MAPS.length ? MAPS[day % MAPS.length] : null;
    const tip = TIPS[day % TIPS.length];
    const news = h('aside.sr-news.sr-panel',
      featured ? h('div.sr-news-feature', { html: mapArtSVG(featured) },
        h('div.sr-news-feature-text', h('div.sr-kicker', 'Featured map'), h('div.sr-news-feature-title', featured.name))) : null,
      h('div.sr-news-list',
        h('div.sr-news-item',
          h('div.sr-news-item-head', h('span.sr-badge.sr-is-accent', 'Update'), h('span.sr-news-item-title', `Version ${GAME_VERSION}`)),
          h('p', `Initial deployment: ${WEAPON_LIST.length} weapons with attachments, ${MAPS.length} procedurally built maps and bots with three difficulty levels.`)),
        h('div.sr-news-item',
          h('div.sr-news-item-head', h('span.sr-badge', 'LAN'), h('span.sr-news-item-title', 'Play with friends')),
          h('p', 'Run the server on one machine and share the address shown in Multiplayer with everyone on your network.')),
        h('div.sr-news-item',
          h('div.sr-news-item-head', h('span.sr-badge', 'Field tip'), h('span.sr-news-item-title', 'Briefing')),
          h('p', tip))));
    el.append(news);
    el.append(h('div.sr-version', h('span', GAME_NAME), h('span', 'Version ', h('b', GAME_VERSION))));
    return el;
  }

  _mainAction(key) {
    if (key === 'quit') this._call('onQuit');
    else this._go(key);
  }

  _commitName(input) {
    const name = sanitizeName(input.value);
    if (!name) {
      input.value = this._settings.playerName;
      return;
    }
    input.value = name;
    if (name !== this._settings.playerName) {
      this._settings.playerName = name;
      this._call('onPlayerNameChange', name);
      for (const n of ['solo', 'create']) if (this._built[n]) this._renderHeadChip(n);
    }
  }

  _renderStatusLine() {
    if (!this._els.statusText) return;
    const s = this._server;
    this._els.statusDot.className = 'sr-dot ' + (s.error ? 'sr-is-bad' : s.connected ? 'sr-is-ok' : 'sr-is-warn');
    clear(this._els.statusText);
    if (s.error) this._els.statusText.append('Server error · ', h('b', s.error));
    else if (s.connected) {
      this._els.statusText.append('Server online · ', h('b', s.address || 'local'), ` · ${s.playersOnline || 0} online`);
    } else this._els.statusText.append('Offline · solo play available');
  }

  _renderMainLoadoutDesc() {
    if (!this._els.mmLoadoutDesc) return;
    const p = WEAPONS[this._loadout.primary];
    const s = WEAPONS[this._loadout.secondary];
    setText(this._els.mmLoadoutDesc, `${p.name} · ${s.name} · frag · smoke`);
  }

  // =========================================================== SOLO / CREATE

  _fixSetup(st) {
    if (!MAP_BY_ID[st.mapId]) st.mapId = MAPS[0] ? MAPS[0].id : st.mapId;
    if (!MODES[st.mode]) st.mode = 'ffa';
    if (!BOT_DIFFICULTY[st.difficulty]) st.difficulty = 'normal';
    if (!TIME_LIMITS.includes(st.timeLimit)) st.timeLimit = 600;
    if (!scoreOptions(st.mode).includes(st.scoreLimit)) st.scoreLimit = MODES[st.mode].scoreLimit;
    st.bots = clamp(Math.round(Number(st.bots) || 0), 0, 15);
    if (st.maxPlayers !== undefined) {
      st.maxPlayers = clamp(Math.round(Number(st.maxPlayers) || 12), 2, 16);
      st.bots = clamp(st.bots, 0, Math.min(12, st.maxPlayers - 1));
    } else st.bots = Math.max(1, st.bots);
  }

  _saveSetup() {
    const { name, ...create } = this._create;
    void name;
    writeStore({ solo: this._solo, create });
  }

  _buildSetup(kind) {
    const solo = kind === 'solo';
    const s = this._shell(kind, solo ? 'Solo vs Bots' : 'Create Room', solo ? 'Offline skirmish' : 'Multiplayer · host a match');
    const left = h('div.sr-col.sr-col-main');
    const els = { maps: h('div.sr-maps'), info: h('div.sr-mapinfo.sr-panel') };
    if (!solo) {
      els.name = h('input.sr-input', {
        type: 'text', maxLength: 32, spellcheck: false, autocomplete: 'off', placeholder: 'Room name', dataset: { fk: 'room-name' },
      });
      els.name.addEventListener('input', () => { this._create.name = els.name.value.slice(0, 32); this._renderSetupSummary(kind); });
      els.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.name.blur(); });
      left.append(this._formRow('Room name', els.name));
    }
    left.append(h('div.sr-section-label', h('span.sr-label', 'Select map')), els.maps, els.info);
    els.form = h('div.sr-form');
    els.summary = h('div.sr-form-summary');
    els.cta = h('button.sr-btn.sr-btn-primary.sr-btn-lg.sr-btn-block', {
      type: 'button', dataset: { fk: 'cta' }, onclick: () => this._submitSetup(kind),
    }, solo ? 'Start match' : 'Create room', icon('arrowR'));
    const side = h('div.sr-col.sr-col-side',
      h('div.sr-panel.sr-side-panel', { style: 'flex:1' },
        h('div.sr-panel-head', h('div.sr-panel-title', 'Match settings')),
        h('div.sr-panel-body.sr-scroll', els.form),
        h('div.sr-cta', els.summary, els.cta)));
    s.body.append(left, side);
    this._setupEls = this._setupEls || {};
    this._setupEls[kind] = els;
    return s.el;
  }

  _renderSetup(kind) {
    const st = kind === 'solo' ? this._solo : this._create;
    const els = this._setupEls[kind];
    this._renderHeadChip(kind);
    if (els.name && document.activeElement !== els.name) {
      if (!st.name) st.name = `${this._settings.playerName}'s room`.slice(0, 32);
      els.name.value = st.name;
    }
    this._rerender(els.maps, (c) => {
      for (const m of MAPS) {
        c.append(h('button.sr-mapcard', {
          type: 'button', class: m.id === st.mapId ? 'sr-is-sel' : '', dataset: { fk: `map:${m.id}` },
          'aria-pressed': String(m.id === st.mapId),
          onclick: () => { st.mapId = m.id; this._saveSetup(); this._renderSetup(kind); },
        },
        h('div.sr-mapcard-art', { html: mapArtSVG(m) }, h('span.sr-mapcard-tod', m.timeOfDay), h('span.sr-mapcard-check', icon('check'))),
        h('div.sr-mapcard-info', h('div.sr-mapcard-name', m.name), h('div.sr-mapcard-meta', `${(m.size / 1000).toFixed(1)} km · ${m.timeOfDay}`))));
      }
    });
    const map = MAP_BY_ID[st.mapId] || MAPS[0];
    const sug = Math.round(map.size / 200);
    clear(els.info).append(
      h('div.sr-mapinfo-main', h('div.sr-kicker', 'Area of operations'), h('div.sr-mapinfo-name', map.name), h('p.sr-mapinfo-desc', map.description)),
      h('div.sr-mapinfo-facts',
        this._fact('Time of day', map.timeOfDay),
        this._fact('Area', `${(map.size / 1000).toFixed(1)} km`),
        this._fact('Suggested', `${Math.max(2, sug - 2)}–${Math.min(15, sug + 2)} bots`),
        this._fact('Terrain', 'Procedural')));

    this._rerender(els.form, (c) => {
      const modes = Object.values(MODES).map((m) => ({ value: m.id, label: m.name }));
      c.append(this._formRow('Mode', this._seg(`${kind}-mode`, modes, st.mode, (v) => {
        st.mode = v;
        st.scoreLimit = MODES[v].scoreLimit;
        this._saveSetup();
        this._renderSetup(kind);
      })));
      if (kind === 'create') {
        c.append(this._formRow('Max players', this._stepper('maxp', {
          min: 2, max: 16, value: st.maxPlayers, onChange: (v) => {
            st.maxPlayers = v;
            if (st.bots > v - 1) { st.bots = Math.min(12, v - 1); this._renderSetup(kind); }
            this._saveSetup();
            this._renderSetupSummary(kind);
          },
        })));
      }
      const botMax = kind === 'solo' ? 15 : Math.min(12, st.maxPlayers - 1);
      c.append(this._formRow(kind === 'solo' ? 'Bots' : 'Bots to fill', this._stepper('bots', {
        min: kind === 'solo' ? 1 : 0, max: Math.max(kind === 'solo' ? 1 : 0, botMax), value: st.bots,
        onChange: (v) => { st.bots = v; this._saveSetup(); this._renderSetupSummary(kind); },
      }), kind === 'create' ? 'Bots leave as players join' : null));
      const diffs = Object.values(BOT_DIFFICULTY).map((d) => ({ value: d.id, label: d.name }));
      c.append(this._formRow('Bot difficulty', this._seg(`${kind}-diff`, diffs, st.difficulty, (v) => {
        st.difficulty = v; this._saveSetup(); this._renderSetup(kind);
      })));
      const times = TIME_LIMITS.map((t) => ({ value: t, label: String(t / 60), sub: 'min' }));
      c.append(this._formRow('Time limit', this._seg(`${kind}-time`, times, st.timeLimit, (v) => {
        st.timeLimit = v; this._saveSetup(); this._renderSetup(kind);
      })));
      const unit = MODES[st.mode].teams ? 'team kills' : 'kills';
      const scores = scoreOptions(st.mode).map((v) => ({ value: v, label: String(v) }));
      c.append(this._formRow('Score limit', this._seg(`${kind}-score`, scores, st.scoreLimit, (v) => {
        st.scoreLimit = v; this._saveSetup(); this._renderSetup(kind);
      }), unit));
    });
    this._renderSetupSummary(kind);
  }

  _renderSetupSummary(kind) {
    const st = kind === 'solo' ? this._solo : this._create;
    const els = this._setupEls[kind];
    const map = MAP_BY_ID[st.mapId] || MAPS[0];
    const parts = [
      ['Map', map.name], ['Mode', MODES[st.mode].short],
      ...(kind === 'create' ? [['Slots', String(st.maxPlayers)]] : []),
      ['Bots', `${st.bots} · ${BOT_DIFFICULTY[st.difficulty].name}`], ['Time', `${st.timeLimit / 60} min`], ['Score', String(st.scoreLimit)],
    ];
    clear(els.summary).append(...parts.map(([k, v]) => h('span', `${k} `, h('b', v))));
  }

  _submitSetup(kind) {
    if (kind === 'solo') {
      const s = this._solo;
      this._call('onPlaySolo', {
        mapId: s.mapId, mode: s.mode, bots: s.bots, difficulty: s.difficulty, timeLimit: s.timeLimit, scoreLimit: s.scoreLimit,
      });
    } else {
      const s = this._create;
      const name = (s.name || '').trim() || `${this._settings.playerName}'s room`;
      this._call('onCreateRoom', {
        name: name.slice(0, 32), mapId: s.mapId, mode: s.mode, maxPlayers: s.maxPlayers, bots: s.bots,
        difficulty: s.difficulty, timeLimit: s.timeLimit, scoreLimit: s.scoreLimit,
      });
    }
  }

  // =========================================================== MULTIPLAYER

  _buildMultiplayer() {
    const s = this._shell('multiplayer', 'Multiplayer', 'LAN & online');
    const els = {};
    els.count = h('span.sr-rooms-count');
    els.list = h('div.sr-rooms-list.sr-scroll');
    const rooms = h('div.sr-rooms.sr-panel',
      h('div.sr-panel-head',
        h('div.sr-panel-title', 'Rooms'), els.count, h('div.sr-spacer'),
        h('button.sr-btn.sr-btn-sm', { type: 'button', dataset: { fk: 'refresh' }, onclick: () => this._call('onRefreshRooms') }, icon('refresh'), 'Refresh'),
        h('button.sr-btn.sr-btn-sm.sr-btn-primary', { type: 'button', dataset: { fk: 'create', defaultFocus: '' }, onclick: () => this._go('create') }, icon('plus'), 'Create room')),
      h('div.sr-rooms-th.sr-rooms-grid', ['Room', 'Map', 'Mode', 'Players', 'Status', 'Time', ''].map((t) => h('span', t))),
      els.list);
    els.server = h('div.sr-panel-body');
    const server = h('div.sr-server.sr-panel',
      h('div.sr-panel-head', h('div.sr-panel-title', 'Server')), h('div.sr-scroll', { style: 'flex:1;min-height:0' }, els.server));
    s.body.append(rooms, server);
    this._mpEls = els;
    return s.el;
  }

  _renderRooms() {
    const els = this._mpEls;
    if (!els) return;
    const rooms = this._rooms;
    setText(els.count, rooms.length ? `${rooms.length}` : '');
    this._rerender(els.list, (c) => {
      if (!rooms.length) {
        c.append(h('div.sr-rooms-empty', icon('globe'), h('b', 'No rooms yet'),
          h('span.sr-hint', this._server.connected ? 'Create a room and invite your friends.' : 'Not connected to a server. Connect below or play solo.'),
          h('button.sr-btn.sr-btn-sm', { type: 'button', dataset: { fk: 'empty-create' }, onclick: () => this._go('create') }, icon('plus'), 'Create room')));
        return;
      }
      for (const r of rooms) {
        const map = MAP_BY_ID[r.mapId];
        const mode = MODES[r.mode];
        const full = (r.players || 0) >= (r.maxPlayers || 0) && r.maxPlayers > 0;
        const stateBadge = r.state === 'playing' ? h('span.sr-badge.sr-is-ok', 'Live')
          : r.state === 'warmup' ? h('span.sr-badge.sr-is-accent', 'Warmup') : h('span.sr-badge', 'Ended');
        const fill = r.maxPlayers ? clamp((r.players || 0) / r.maxPlayers, 0, 1) : 0;
        const join = () => { if (!full) this._call('onJoinRoom', r.id); };
        const time = h('span.sr-room-time', fmtTime(r.timeLeft));
        time.dataset.t = String(r.timeLeft || 0);
        time.dataset.live = r.state === 'ended' ? '' : '1';
        c.append(h('div.sr-room.sr-rooms-grid', { ondblclick: join },
          h('div.sr-room-name', h('b', r.name || 'Room'), h('small', `Host · ${r.host || 'unknown'}`)),
          h('div.sr-room-map', map ? h('span.sr-room-thumb', { html: mapArtSVG(map) }) : null, h('span', map ? map.name : r.mapId)),
          h('span.sr-room-cell', mode ? mode.short : String(r.mode || '').toUpperCase()),
          h('div.sr-room-players',
            h('span', h('span.sr-num', `${r.players || 0}/${r.maxPlayers || 0}`), r.bots ? h('small', `  +${r.bots} bots`) : null),
            h('div.sr-room-fill', h('i', { style: `width:${(fill * 100).toFixed(0)}%` }))),
          h('span', stateBadge),
          time,
          h('button.sr-btn.sr-btn-sm', { type: 'button', disabled: full, dataset: { fk: `join:${r.id}` }, onclick: join }, full ? 'Full' : 'Join')));
      }
    });
  }

  _tickRoomTimes() {
    if (!this._mpEls) return;
    const el = (performance.now() - this._roomsAt) / 1000;
    for (const t of this._mpEls.list.querySelectorAll('.sr-room-time')) {
      if (!t.dataset.live) continue;
      setText(t, fmtTime(Number(t.dataset.t) - el));
    }
  }

  _renderServer() {
    const els = this._mpEls;
    if (!els) return;
    const s = this._server;
    const a = document.activeElement;
    const keepConnect = a && a.dataset && a.dataset.fk === 'connect-input' ? a.value : (this._connectDraft || '');
    const hadFocus = a && els.server.contains(a) ? a.dataset.fk : null;
    clear(els.server);
    els.server.append(
      h('div.sr-server-status', h('i.sr-dot', { class: s.error ? 'sr-is-bad' : s.connected ? 'sr-is-ok' : 'sr-is-warn' }),
        s.error ? 'Error' : s.connected ? 'Connected' : 'Not connected'),
      h('dl.sr-kv',
        h('dt.sr-label', 'Address'), h('dd', s.address || '—'),
        h('dt.sr-label', 'Players online'), h('dd', String(s.connected ? (s.playersOnline || 0) : 0))));
    if (s.error) els.server.append(h('div.sr-server-error', icon('warn'), h('span', s.error)));
    const urls = Array.isArray(s.lanUrls) ? s.lanUrls : [];
    els.server.append(h('hr.sr-sep', { style: 'margin:0' }));
    els.server.append(h('div', { style: 'display:flex;flex-direction:column;gap:calc(var(--sr-u)*8)' },
      h('span.sr-label', 'Invite friends on your network'),
      urls.length ? h('div.sr-lan-list', urls.map((u, i) => h('div.sr-lan-url', icon('link'), h('code', u),
        h('button.sr-btn.sr-btn-xs', { type: 'button', dataset: { fk: `copy:${i}` }, onclick: () => this._copy(u) }, icon('copy'), 'Copy'))))
        : h('span.sr-hint', 'Share links appear here when this machine hosts the server.'),
      urls.length ? h('span.sr-hint', 'Friends open this address in Firefox or Chromium on the same network.') : null));
    els.server.append(h('hr.sr-sep', { style: 'margin:0' }));
    const input = h('input.sr-input', {
      type: 'text', placeholder: 'host:port', spellcheck: false, autocomplete: 'off', value: keepConnect,
      dataset: { fk: 'connect-input' }, 'aria-label': 'Server address',
    });
    input.addEventListener('input', () => { this._connectDraft = input.value; input.classList.remove('sr-is-invalid'); });
    const go = () => {
      const v = input.value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      if (!/^(\[[0-9a-f:.]+\]|[\w.-]+)(:\d{1,5})?$/i.test(v)) {
        input.classList.remove('sr-is-invalid');
        void input.offsetWidth;
        input.classList.add('sr-is-invalid');
        this.showToast('Enter an address like 192.168.1.42:7777', 'error');
        return;
      }
      this._call('onConnectServer', v);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    els.server.append(h('div', { style: 'display:flex;flex-direction:column;gap:calc(var(--sr-u)*8)' },
      h('span.sr-label', 'Connect to another server'),
      h('div.sr-connect-row', input, h('button.sr-btn', { type: 'button', dataset: { fk: 'connect' }, onclick: go }, 'Connect')),
      h('span.sr-hint', 'Example: 192.168.1.42:7777 · default port 7777')));
    if (hadFocus) {
      const el = els.server.querySelector(`[data-fk="${CSS.escape(hadFocus)}"]`);
      if (el) el.focus({ preventScroll: true });
    }
  }

  async _copy(text) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    this.showToast(ok ? `Copied ${text}` : 'Copy failed. Select the address manually.', ok ? 'success' : 'error');
  }

  // =========================================================== LOADOUT

  _buildLoadout() {
    const s = this._shell('loadout', 'Loadout', 'Armory', { tabs: 'Category' });
    const els = {};
    this._loEls = els;
    els.headRight = s.right;
    // left column
    els.cats = h('div.sr-lo-cats');
    els.catName = h('div.sr-lo-catname');
    els.list = h('div.sr-lo-list.sr-scroll');
    const left = h('div.sr-lo-left.sr-panel', h('div.sr-panel-head', h('div.sr-panel-title', 'Primary')), els.cats, els.catName, els.list);
    // center
    els.preview = h('div.sr-lo-preview');
    els.name = h('h2.sr-lo-name');
    els.cal = h('div.sr-lo-cal');
    els.desc = h('p.sr-lo-desc');
    els.kicker = h('div.sr-kicker');
    els.slots = h('div.sr-lo-slots');
    els.stats = h('div.sr-lo-stats');
    els.nums = h('div.sr-lo-nums');
    const center = h('div.sr-lo-center',
      h('div.sr-lo-grid'), els.preview,
      h('div.sr-lo-top', h('div.sr-lo-title', els.kicker, els.name, els.cal, els.desc), els.slots),
      h('div.sr-lo-stage', h('div.sr-lo-hint', h('span', 'Drag to rotate'), h('span', '·'), h('span', 'Scroll to zoom'), h('span', '·'), h('span', 'Double-click to reset'))),
      h('div.sr-lo-stats-wrap.sr-panel', els.stats, els.nums));
    // right
    els.right = h('div.sr-panel-body.sr-scroll', { style: 'flex:1;min-height:0' });
    const right = h('div.sr-lo-right.sr-panel', h('div.sr-panel-head', h('div.sr-panel-title', 'Attachments & gear')), els.right);
    s.body.append(left, center, right);
    // stat rows (persistent DOM; values animate)
    els.statRows = {};
    for (const [key, label] of STAT_ROWS) {
      const num = h('span.sr-num');
      const fill = h('i.sr-stat-fill');
      const delta = h('i.sr-stat-delta');
      const row = h('div.sr-stat', h('div.sr-stat-head', h('span.sr-label', label), num), h('div.sr-stat-bar', delta, fill));
      els.statRows[key] = { row, num, fill, delta };
      els.stats.append(row);
    }
    try {
      this._preview = new WeaponPreview(els.preview);
    } catch (err) {
      console.warn('[MenuUI] weapon preview unavailable', err);
      this._preview = null;
    }
    return s.el;
  }

  _renderLoadout() {
    if (!this._loEls) return;
    this._renderLoNotice();
    this._renderLoLeft();
    this._renderLoCenter();
    this._renderLoRight();
  }

  _renderLoNotice() {
    const r = this._loEls.headRight;
    clear(r);
    if (this._inMatch) r.append(h('span.sr-lo-notice', icon('info'), 'Changes apply on next deploy'));
    r.append(h('span.sr-head-chip', icon('user'), h('b', this._settings.playerName)));
  }

  _emitLoadout() {
    this._loadout = sanitizeLoadout(this._loadout);
    this._call('onLoadoutChange', clone(this._loadout));
    this._renderMainLoadoutDesc();
  }

  _equipPrimary(id) {
    if (this._loadout.primary === id) { this._loSlot = 'primary'; this._renderLoadout(); return; }
    this._attMemory[this._loadout.primary] = { ...this._loadout.primaryAtt };
    this._loadout.primary = id;
    this._loadout.primaryAtt = { ...(this._attMemory[id] || defaultAttachments(id)) };
    this._loSlot = 'primary';
    this._emitLoadout();
    this._renderLoadout();
  }

  _equipSecondary(id) {
    this._attMemory[this._loadout.secondary] = { ...this._loadout.secondaryAtt };
    this._loadout.secondary = id;
    this._loadout.secondaryAtt = { ...(this._attMemory[id] || defaultAttachments(id)) };
    this._loSlot = 'secondary';
    this._emitLoadout();
    this._renderLoadout();
  }

  _setAtt(slot, kind, id) {
    const key = slot === 'primary' ? 'primaryAtt' : 'secondaryAtt';
    this._loadout[key] = { ...this._loadout[key], [kind]: id };
    this._attMemory[this._loadout[slot]] = { ...this._loadout[key] };
    this._loSlot = slot;
    this._emitLoadout();
    this._renderLoCenter();
    this._renderLoRight();
  }

  _renderLoLeft() {
    const els = this._loEls;
    this._rerender(els.cats, (c) => {
      for (const cat of PRIMARY_CATS) {
        c.append(h('button.sr-lo-cat', {
          type: 'button', class: cat === this._loCat ? 'sr-is-sel' : '', dataset: { fk: `cat:${cat}` },
          title: CATEGORIES[cat].name,
          onclick: () => { this._loCat = cat; this._renderLoLeft(); },
        }, CATEGORIES[cat].short));
      }
    });
    const weapons = WEAPON_LIST.filter((w) => w.category === this._loCat && w.slot === 'primary');
    clear(els.catName).append(h('span.sr-label', CATEGORIES[this._loCat].name), h('span.sr-label', String(weapons.length)));
    this._rerender(els.list, (c) => {
      for (const w of weapons) {
        const bars = weaponStatBars(w);
        const sel = w.id === this._loadout.primary;
        const row = h('button.sr-lo-weapon', {
          type: 'button', class: sel ? 'sr-is-sel' : '', dataset: { fk: `w:${w.id}`, ...(sel ? { defaultFocus: '' } : {}) },
          'aria-pressed': String(sel),
          onclick: () => this._equipPrimary(w.id),
        },
        h('span.sr-lo-wtext', h('span.sr-lo-wname', w.name), h('span.sr-lo-wcal', w.caliber)),
        h('span.sr-lo-wmini', h('i', { style: `--v:${(bars.damage * 100).toFixed(0)}%` }), h('i', { style: `--v:${(bars.fireRate * 100).toFixed(0)}%` }), h('i', { style: `--v:${(bars.range * 100).toFixed(0)}%` })),
        h('span.sr-lo-eq', icon('check')));
        const hoverOn = () => { if (!sel) { this._loHover = w.id; this._renderLoStats(); } };
        const hoverOff = () => { if (this._loHover === w.id) { this._loHover = null; this._renderLoStats(); } };
        row.addEventListener('mouseenter', hoverOn);
        row.addEventListener('focus', hoverOn);
        row.addEventListener('mouseleave', hoverOff);
        row.addEventListener('blur', hoverOff);
        c.append(row);
      }
    });
  }

  _loWeapon() {
    const slot = this._loSlot;
    const id = slot === 'primary' ? this._loadout.primary : this._loadout.secondary;
    const att = slot === 'primary' ? this._loadout.primaryAtt : this._loadout.secondaryAtt;
    return { w: WEAPONS[id], att };
  }

  _renderLoCenter() {
    const els = this._loEls;
    const { w, att } = this._loWeapon();
    setText(els.kicker, `${this._loSlot === 'primary' ? 'Primary' : 'Secondary'} · ${CATEGORIES[w.category].name}`);
    setText(els.name, w.name);
    setText(els.cal, w.caliber);
    setText(els.desc, w.desc);
    this._rerender(els.slots, (c) => {
      for (const [slot, label] of [['primary', 'Primary'], ['secondary', 'Secondary']]) {
        c.append(h('button.sr-lo-slot', {
          type: 'button', class: slot === this._loSlot ? 'sr-is-sel' : '', dataset: { fk: `slot:${slot}` },
          onclick: () => { this._loSlot = slot; this._renderLoCenter(); },
        }, label));
      }
    });
    this._renderLoStats();
    if (this._preview) this._preview.setWeapon(w.id, att);
  }

  _renderLoStats() {
    const els = this._loEls;
    const { w: cur, att: curAtt } = this._loWeapon();
    let w = cur;
    let att = curAtt;
    const comparing = this._loHover && this._loSlot === 'primary' && WEAPONS[this._loHover];
    if (comparing) {
      w = WEAPONS[this._loHover];
      att = this._attMemory[w.id] || defaultAttachments(w.id);
    }
    const s = statsFor(w, att);
    const base = comparing ? statsFor(cur, curAtt) : s;
    for (const [key, , fmt] of STAT_ROWS) {
      const r = els.statRows[key];
      const v = s[key];
      const b = base[key];
      const lo = Math.min(v, b);
      const diff = Math.abs(v - b);
      r.fill.style.transform = `scaleX(${lo.toFixed(4)})`;
      r.delta.style.transform = `translateX(${(lo * 100).toFixed(2)}%) scaleX(${diff.toFixed(4)})`;
      r.row.classList.toggle('sr-is-up', diff > 0.004 && v > b);
      r.row.classList.toggle('sr-is-down', diff > 0.004 && v < b);
      setText(r.num, fmt(w, att, s));
    }
    const dmg = w.pellets > 1 ? `${w.damage[0]}×${w.pellets}` : `${w.damage[0]}–${w.damage[1]}`;
    clear(els.nums).append(
      h('div.sr-lo-numcell', h('span.sr-label', 'Damage'), h('span.sr-num', dmg)),
      h('div.sr-lo-numcell', h('span.sr-label', 'Fire rate'), h('span.sr-num', String(w.rpm), h('small', 'RPM'))),
      h('div.sr-lo-numcell', h('span.sr-label', 'Magazine'), h('span.sr-num', String(w.mag), h('small', `/ ${w.reserve}`))),
      h('div.sr-lo-numcell', h('span.sr-label', 'Fire modes'), h('span.sr-num', { style: 'font-size:var(--sr-fs-lg);padding-top:calc(var(--sr-u)*6)' }, fmtModes(w))));
  }

  _attGroup(slot, kind, label, ids, table, current) {
    const fx = attEffects(kind, current);
    const names = (id) => (kind === 'optic' ? OPTIC_SHORT[id] || table[id].name : table[id].name);
    return h('div.sr-att-group',
      h('div', { style: 'display:flex;justify-content:space-between;gap:8px' },
        h('span.sr-label', label), h('span.sr-label', { style: 'color:var(--sr-text-2);letter-spacing:.08em' }, table[current] ? table[current].name : '')),
      h('div.sr-chips', ids.map((id) => h('button.sr-chip', {
        type: 'button', class: id === current ? 'sr-is-sel' : '', title: table[id] ? table[id].name : id,
        dataset: { fk: `att:${slot}:${kind}:${id}` }, 'aria-pressed': String(id === current),
        onclick: () => this._setAtt(slot, kind, id),
      }, names(id)))),
      h('div.sr-att-fx', fx.map(([t, k]) => h('span', { class: k ? `sr-is-${k}` : '' }, t))));
  }

  _renderLoRight() {
    const els = this._loEls;
    const L = this._loadout;
    const pw = WEAPONS[L.primary];
    const sw = WEAPONS[L.secondary];
    this._rerender(els.right, (c) => {
      c.append(h('div.sr-att-sec',
        h('div.sr-att-sec-title', h('b', pw.name), h('span.sr-badge', 'Primary')),
        this._attGroup('primary', 'optic', 'Optic', pw.optics, OPTICS, L.primaryAtt.optic),
        this._attGroup('primary', 'muzzle', 'Muzzle', pw.muzzles, MUZZLES, L.primaryAtt.muzzle),
        this._attGroup('primary', 'grip', 'Underbarrel', pw.grips, GRIPS, L.primaryAtt.grip)));
      c.append(h('div.sr-att-sec',
        h('div.sr-att-sec-title', h('b', 'Sidearm'), h('span.sr-badge', 'Secondary')),
        h('div.sr-chips', SECONDARIES.map((w) => h('button.sr-chip', {
          type: 'button', class: w.id === L.secondary ? 'sr-is-sel' : '', dataset: { fk: `sec:${w.id}` },
          title: `${w.name} · ${w.caliber}`, 'aria-pressed': String(w.id === L.secondary),
          onclick: () => this._equipSecondary(w.id),
        }, w.name))),
        h('div', { style: 'height:calc(var(--sr-u)*12)' }),
        this._attGroup('secondary', 'optic', 'Optic', sw.optics, OPTICS, L.secondaryAtt.optic),
        this._attGroup('secondary', 'muzzle', 'Muzzle', sw.muzzles, MUZZLES, L.secondaryAtt.muzzle)));
      const eq = (ic, name, sub, key) => h('div.sr-equip-item', icon(ic),
        h('div.sr-equip-text', h('b', name), h('small', sub)), h('span.sr-key', key));
      const F = EQUIPMENT.frag;
      const S = EQUIPMENT.smoke;
      const K = EQUIPMENT.knife;
      c.append(h('div.sr-att-sec',
        h('div.sr-att-sec-title', h('b', 'Equipment'), h('span.sr-badge', 'Standard issue')),
        h('div.sr-equip',
          eq('frag', F.name, `${F.damage} dmg · ${F.radius} m radius · ${F.fuse} s fuse`, 'G'),
          eq('smoke', S.name, `${S.duration} s screen · ${S.radius} m radius`, '4'),
          eq('knife', K.name, `${K.damage} dmg · backstab ${K.backstab}`, 'V'))));
    });
  }

  // =========================================================== SETTINGS

  _buildSettings() {
    const s = this._shell('settings', 'Settings', 'Options', { tabs: 'Tab' });
    const els = {};
    this._setEls = els;
    els.tabs = h('div.sr-set-tabs');
    s.el.insertBefore(els.tabs, s.body);
    s.body.classList.add('sr-set-body');
    els.list = h('div.sr-set-scroll.sr-scroll');
    els.reset = h('button.sr-btn.sr-btn-sm.sr-btn-ghost', { type: 'button', dataset: { fk: 'reset' }, onclick: () => this._resetTab() }, icon('refresh'), 'Reset tab to defaults');
    const list = h('div.sr-set-list.sr-panel', els.list, h('div.sr-set-foot', els.reset));
    els.side = h('div.sr-panel-body');
    const side = h('div.sr-set-side.sr-panel', h('div.sr-panel-head', h('div.sr-panel-title', 'Details')), els.side);
    s.body.append(list, side);
    return s.el;
  }

  _renderSettings() {
    const els = this._setEls;
    this._rerender(els.tabs, (c) => {
      c.append(h('span.sr-key', 'Q'));
      for (const [key, label] of SETTINGS_TABS) {
        c.append(h('button.sr-tab', {
          type: 'button', class: key === this._setTab ? 'sr-is-sel' : '', dataset: { fk: `tab:${key}` },
          onclick: () => { this._setTab = key; this._renderSettings(); },
        }, label.toUpperCase()));
      }
      c.append(h('span.sr-key', 'E'));
    });
    this._renderSettingsList();
    const first = SETTINGS_SCHEMA[this._setTab].find((r) => r.key);
    this._showSettingDesc(this._setFocusKey && SETTINGS_SCHEMA[this._setTab].some((r) => r.key === this._setFocusKey) ? this._setFocusKey : first.key);
  }

  _settingValue(row) {
    if (row.root) return this._settings[row.key];
    return this._settings[this._setTab][row.key];
  }

  _renderSettingsList() {
    const els = this._setEls;
    if (!els) return;
    this._rerender(els.list, (c) => {
      for (const row of SETTINGS_SCHEMA[this._setTab]) {
        if (row.section) { c.append(h('div.sr-set-section', row.section)); continue; }
        const r = h('div.sr-set-row', { dataset: { key: row.key } }, h('span.sr-set-label', row.label), h('div.sr-set-ctl', this._settingControl(row)));
        r.addEventListener('mouseenter', () => this._showSettingDesc(row.key));
        c.append(r);
      }
    });
  }

  _settingControl(row) {
    const v = this._settingValue(row);
    const fk = `set:${this._setTab}:${row.key}`;
    if (row.type === 'cycle') {
      const idx = Math.max(0, row.options.findIndex((o) => o === v));
      const el = h('div.sr-cycler', { tabIndex: 0, role: 'spinbutton', 'aria-label': row.label, 'aria-valuetext': row.fmt ? row.fmt(v) : String(v), dataset: { fk } },
        h('button.sr-cyc-arrow', { type: 'button', tabIndex: -1, 'aria-label': 'Previous', onclick: (e) => { e.stopPropagation(); this._cycle(el, -1); } }, icon('chevronL')),
        h('div.sr-cyc-mid', h('span.sr-cyc-val', row.fmt ? row.fmt(v) : String(v)),
          h('span.sr-cyc-dots', row.options.map((o, i) => h('i', { class: i === idx ? 'sr-is-sel' : '' })))),
        h('button.sr-cyc-arrow', { type: 'button', tabIndex: -1, 'aria-label': 'Next', onclick: (e) => { e.stopPropagation(); this._cycle(el, 1); } }, icon('chevronR')));
      el._row = row;
      el.addEventListener('click', () => this._cycle(el, 1));
      return el;
    }
    if (row.type === 'range') {
      const val = h('span.sr-set-val', row.fmt(v));
      const input = h('input.sr-range', { type: 'range', min: row.min, max: row.max, step: row.step, value: v, dataset: { fk }, 'aria-label': row.label });
      const setP = () => input.style.setProperty('--p', `${((input.value - row.min) / (row.max - row.min)) * 100}%`);
      setP();
      let tm = 0;
      input.addEventListener('input', () => {
        const nv = Number(input.value);
        setP();
        setText(val, row.fmt(nv));
        clearTimeout(tm);
        tm = setTimeout(() => this._setSetting(row, nv, false), 90);
      });
      input.addEventListener('change', () => { clearTimeout(tm); this._setSetting(row, Number(input.value), false); });
      return [input, val];
    }
    if (row.type === 'toggle') {
      const el = h('button.sr-toggle', {
        type: 'button', class: v ? 'sr-is-on' : '', role: 'switch', 'aria-checked': String(!!v), 'aria-label': row.label, dataset: { fk },
        onclick: () => this._setSetting(row, !this._settingValue(row), true),
      }, h('span.sr-toggle-opt', 'Off'), h('span.sr-toggle-opt', 'On'));
      return el;
    }
    if (row.type === 'color') {
      const cur = String(v || '#ffffff').toLowerCase();
      const custom = h('input.sr-swatch-custom', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#ffffff', title: 'Custom colour', dataset: { fk: `${fk}:custom` } });
      custom.addEventListener('input', () => this._setSetting(row, custom.value, false));
      custom.addEventListener('change', () => this._setSetting(row, custom.value, true));
      return h('div.sr-swatches', row.swatches.map((c) => h('button.sr-swatch', {
        type: 'button', class: c === cur ? 'sr-is-sel' : '', title: c, style: { '--c': c }, dataset: { fk: `${fk}:${c}` },
        'aria-label': `Colour ${c}`, onclick: () => this._setSetting(row, c, true),
      }, h('i'))), custom);
    }
    if (row.type === 'text') {
      const input = h('input.sr-input', { type: 'text', maxLength: NAME_MAX, value: v, spellcheck: false, autocomplete: 'off', dataset: { fk }, 'aria-label': row.label });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      input.addEventListener('change', () => {
        this._commitName(input);
        if (this._els.callsign) this._els.callsign.value = this._settings.playerName;
      });
      return input;
    }
    return null;
  }

  _cycle(el, d) {
    const row = el._row;
    if (!row) return;
    const cur = this._settingValue(row);
    const i = row.options.findIndex((o) => o === cur);
    const n = row.options[((i < 0 ? 0 : i) + d + row.options.length) % row.options.length];
    this._sound('click');
    this._setSetting(row, n, true);
  }

  _setSetting(row, value, rerender) {
    let s = clone(this._settings);
    if (row.root) {
      s[row.key] = value;
    } else if (this._setTab === 'graphics') {
      if (row.key === 'preset') {
        s = applyPreset(s, value);
        rerender = true;
      } else {
        s.graphics[row.key] = value;
        if (PRESET_KEYS.includes(row.key)) {
          const match = Object.keys(GRAPHICS_PRESETS).find((p) => PRESET_KEYS.every((k) => GRAPHICS_PRESETS[p][k] === s.graphics[k]));
          const was = s.graphics.preset;
          s.graphics.preset = match || 'custom';
          if (was !== s.graphics.preset) rerender = true;
        }
      }
    } else {
      s[this._setTab][row.key] = value;
    }
    this._settings = s;
    this.el.classList.toggle('sr-lowfx', s.graphics.preset === 'low');
    this._call('onSettingsChange', clone(s));
    if (rerender) this._renderSettingsList();
    else if (!rerender && this._setTab === 'graphics' && row.key !== 'preset') this._refreshPresetCycler();
    if (row.preview) this._showSettingDesc(row.key);
  }

  _refreshPresetCycler() {
    const el = this._setEls.list.querySelector('[data-fk="set:graphics:preset"]');
    if (!el) return;
    const row = el._row;
    setText(el.querySelector('.sr-cyc-val'), row.fmt(this._settings.graphics.preset));
    const idx = row.options.indexOf(this._settings.graphics.preset);
    [...el.querySelectorAll('.sr-cyc-dots i')].forEach((d, i) => d.classList.toggle('sr-is-sel', i === idx));
  }

  _showSettingDesc(key) {
    const els = this._setEls;
    if (!els) return;
    const row = SETTINGS_SCHEMA[this._setTab].find((r) => r.key === key);
    if (!row) return;
    this._setFocusKey = key;
    for (const r of els.list.querySelectorAll('.sr-set-row')) r.classList.toggle('sr-is-focus', r.dataset.key === key);
    const meta = h('div.sr-set-desc-meta');
    if (row.impact) {
      meta.append(h('span.sr-badge', { class: row.impact === 'high' ? 'sr-is-bad' : row.impact === 'medium' ? 'sr-is-accent' : 'sr-is-ok' },
        `${row.impact} performance impact`));
    }
    if (this._setTab === 'graphics') meta.append(h('span.sr-badge', `Preset · ${this._settings.graphics.preset}`));
    const parts = [h('div.sr-kicker', SETTINGS_TABS.find(([k]) => k === this._setTab)[1]), h('div.sr-set-desc-title', row.label), h('p.sr-set-desc-text', row.desc || ''), meta];
    if (this._setTab === 'gameplay') parts.push(this._crosshairPreview());
    clear(els.side).append(...parts);
  }

  _crosshairPreview() {
    const g = this._settings.gameplay;
    const xh = h('div.sr-xhair', { dataset: { style: g.crosshair }, style: { '--xc': g.crosshairColor, '--gap': '7px' } },
      h('i.sr-xh-l'), h('i.sr-xh-r'), h('i.sr-xh-t'), h('i.sr-xh-b'), h('i.sr-xh-dot'), h('i.sr-xh-circle'));
    return h('div', { style: 'display:flex;flex-direction:column;gap:calc(var(--sr-u)*8);margin-top:calc(var(--sr-u)*8)' },
      h('span.sr-label', 'Crosshair preview'), h('div.sr-xh-preview', xh));
  }

  _resetTab() {
    const d = defaultSettings();
    let s = clone(this._settings);
    if (this._setTab === 'gameplay') s.gameplay = d.gameplay;
    else if (this._setTab === 'graphics') s = applyPreset({ ...s, graphics: { ...d.graphics } }, d.graphics.preset);
    else s[this._setTab] = d[this._setTab];
    this._settings = s;
    this.el.classList.toggle('sr-lowfx', s.graphics.preset === 'low');
    this._call('onSettingsChange', clone(s));
    this._renderSettings();
    this.showToast(`${SETTINGS_TABS.find(([k]) => k === this._setTab)[1]} settings reset`, 'info');
  }

  // =========================================================== CONTROLS

  _buildControlsScreen() {
    const s = this._shell('controls', 'Controls', 'Field manual');
    this._ctlEls = { grid: h('div.sr-ctl') };
    s.body.append(this._ctlEls.grid);
    return s.el;
  }

  _renderControls() {
    if (!this._ctlEls) return;
    const c = this._settings.controls || {};
    const grid = clear(this._ctlEls.grid);
    for (const [group, rows] of CONTROL_GROUPS) {
      const panel = h('div.sr-ctl-group.sr-panel', h('div.sr-panel-head', h('div.sr-panel-title', group)));
      for (const [label, keys, note] of rows) {
        let sub = null;
        if (note === 'crouch') sub = c.toggleCrouch ? 'Toggle' : 'Hold';
        if (note === 'ads') sub = c.toggleAds ? 'Toggle' : 'Hold';
        if (note === 'hold') sub = 'Hold';
        if (note === 'pad') sub = 'Gamepad: D-pad · A select · B back';
        if (note === 'tabs') sub = 'Gamepad: LB / RB';
        const keyEls = [];
        keys.forEach(([k, mod], i) => {
          if (i > 0 && (label.includes('/') || note === 'tabs')) keyEls.push(h('span.sr-or', '/'));
          if (k.startsWith('@')) keyEls.push(h('span.sr-key.sr-key-mouse', icon(k.slice(1))));
          else keyEls.push(h(`span.sr-key.sr-key-lg${mod === 'wide' ? '.sr-key-wide' : ''}`, k));
        });
        panel.append(h('div.sr-ctl-row', h('span.sr-ctl-action', label, sub ? h('small', sub) : null), h('div.sr-ctl-keys', keyEls)));
      }
      grid.append(panel);
    }
  }

  // =========================================================== PAUSE

  _buildPause() {
    const el = h('section.sr-screen.sr-screen-pause');
    this._pauseEls = { left: h('div.sr-pause-left') };
    el.append(this._pauseEls.left);
    el.append(h('footer.sr-foot', h('div.sr-foot-left'), this._hint(['↑', '↓'], 'Navigate'), this._hint(['Enter'], 'Select'), this._hint(['Esc'], 'Resume')));
    return el;
  }

  _renderPause() {
    const left = this._pauseEls.left;
    const item = (key, label, desc, idx, fn, extra = '') => h(`button.sr-mm-item${extra}`, {
      type: 'button', dataset: { fk: `pause:${key}`, ...(idx === 1 ? { defaultFocus: '' } : {}) }, onclick: fn,
    }, h('span.sr-mm-idx', String(idx).padStart(2, '0')),
    h('span.sr-mm-text', h('span.sr-mm-label', label), desc ? h('span.sr-mm-desc', desc) : null),
    h('span.sr-mm-arrow', icon('chevronR')));
    this._rerender(left, (c) => {
      c.append(h('div.sr-kicker', this._inMatch ? 'Match in progress' : GAME_NAME), h('div.sr-pause-title', 'PAUSED', h('span', '.')));
      const nav = h('nav.sr-mm');
      nav.append(
        item('resume', 'Resume', 'Return to the fight', 1, () => { this._sound('back'); this._resume(); }),
        item('loadout', 'Loadout', this._inMatch ? 'Applies on next deploy' : 'Weapons and attachments', 2, () => this._go('loadout')),
        item('settings', 'Settings', 'Graphics, controls, audio', 3, () => this._go('settings')),
        item('controls', 'Controls', 'Key bindings reference', 4, () => this._go('controls')),
        h('div.sr-mm-gap'));
      if (this._inMatch) {
        nav.append(item('leave', 'Leave match', 'Return to the main menu', 5, () => { this._confirmLeave = true; this._renderPause(); }, '.sr-mm-quit'));
      } else {
        nav.append(item('menu', 'Main menu', null, 5, () => this.show('main'), '.sr-mm-quit'));
      }
      c.append(nav);
      if (this._confirmLeave) {
        const box = h('div.sr-confirm.sr-panel.sr-brackets',
          h('b', { style: 'font-size:var(--sr-fs-lg);letter-spacing:.08em' }, 'LEAVE THE CURRENT MATCH?'),
          h('span.sr-hint', 'Your score for this match will be lost.'),
          h('div.sr-confirm-actions',
            h('button.sr-btn', { type: 'button', dataset: { fk: 'leave-cancel' }, onclick: () => { this._confirmLeave = false; this._renderPause(); } }, 'Cancel'),
            h('button.sr-btn.sr-btn-primary', { type: 'button', dataset: { fk: 'leave-ok' }, onclick: () => { this._confirmLeave = false; this._call('onLeaveMatch'); } }, 'Leave match')));
        c.append(box);
        requestAnimationFrame(() => box.querySelector('[data-fk="leave-cancel"]').focus({ preventScroll: true }));
      }
    });
  }

  // =========================================================== LOADING

  _buildLoading() {
    const els = this._els;
    els.loadArt = h('div.sr-loading-art');
    els.loadKicker = h('div.sr-kicker', 'Deploying to');
    els.loadTitle = h('div.sr-loading-title');
    els.loadDesc = h('p.sr-loading-desc');
    els.loadFacts = h('div.sr-loading-facts');
    els.loadStatus = h('span');
    els.loadPct = h('span.sr-loading-pct', '0%');
    els.loadBar = h('i', h('b'));
    els.loadTip = h('p');
    els.loading = h('div.sr-loading', { role: 'progressbar', 'aria-label': 'Loading' },
      els.loadArt, h('div.sr-loading-shade'),
      h('div.sr-loading-logo', 'SHUTE ', h('span', 'REAL')),
      h('div.sr-loading-main',
        h('div.sr-loading-info', els.loadKicker, els.loadTitle, els.loadDesc, els.loadFacts,
          h('div.sr-loading-progress',
            h('div.sr-loading-status', h('span.sr-loading-status-text', h('span.sr-chevrons', h('i'), h('i'), h('i')), els.loadStatus), els.loadPct),
            h('div.sr-loading-bar', els.loadBar))),
        h('div.sr-loading-tip.sr-panel', h('span.sr-kicker', 'Field tip'), els.loadTip)));
    this.el.append(els.loading);
  }

  _rotateTip() {
    const L = this._loading;
    if (!L.visible || L.fixedTip) return;
    const p = this._els.loadTip;
    p.classList.add('sr-is-fading');
    setTimeout(() => {
      L.tipIdx = (L.tipIdx + 1) % TIPS.length;
      setText(p, TIPS[L.tipIdx]);
      p.classList.remove('sr-is-fading');
    }, 360);
  }
}
