// Player settings: defaults, graphics presets and persistence (localStorage).
import { defaultLoadout, sanitizeLoadout } from '/shared/weapons.js';

export const GRAPHICS_PRESETS = {
  low: {
    renderScale: 0.7, shadows: 'low', viewDistance: 700, grassDensity: 0.25, treeDetail: 'low',
    ao: false, bloom: false, antialias: 'fxaa', godrays: false, pipScopes: false, anisotropy: 2,
  },
  medium: {
    renderScale: 0.85, shadows: 'medium', viewDistance: 1100, grassDensity: 0.5, treeDetail: 'medium',
    ao: false, bloom: true, antialias: 'fxaa', godrays: false, pipScopes: true, anisotropy: 4,
  },
  high: {
    renderScale: 1.0, shadows: 'high', viewDistance: 1600, grassDensity: 0.8, treeDetail: 'high',
    ao: true, bloom: true, antialias: 'smaa', godrays: true, pipScopes: true, anisotropy: 8,
  },
  ultra: {
    renderScale: 1.0, shadows: 'ultra', viewDistance: 2400, grassDensity: 1.0, treeDetail: 'ultra',
    ao: true, bloom: true, antialias: 'smaa', godrays: true, pipScopes: true, anisotropy: 16,
  },
};

export const SETTING_OPTIONS = {
  preset: ['low', 'medium', 'high', 'ultra', 'custom'],
  shadows: ['off', 'low', 'medium', 'high', 'ultra'],
  treeDetail: ['low', 'medium', 'high', 'ultra'],
  antialias: ['off', 'fxaa', 'smaa'],
  fpsLimit: [0, 30, 60, 75, 120, 144, 165, 240],
  crosshair: ['default', 'dot', 'cross', 'circle'],
};

export function defaultSettings() {
  return {
    playerName: 'Operator' + Math.floor(100 + Math.random() * 900),
    graphics: { preset: 'high', ...GRAPHICS_PRESETS.high, fpsLimit: 0, showFps: false },
    controls: { sensitivity: 1.0, adsSensitivity: 0.8, invertY: false, toggleAds: false, toggleCrouch: true },
    audio: { master: 0.8, sfx: 1.0, ambient: 0.6, ui: 0.8 },
    gameplay: { fov: 80, crosshair: 'default', crosshairColor: '#ffffff', showMinimap: true, headBob: true },
  };
}

const KEY_SETTINGS = 'shute-real.settings.v1';
const KEY_LOADOUT = 'shute-real.loadout.v1';

function safeGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(base)) {
    if (!(k in over)) continue;
    const b = base[k];
    const o = over[k];
    if (b && typeof b === 'object' && !Array.isArray(b)) out[k] = deepMerge(b, o);
    else if (typeof o === typeof b) out[k] = o;
  }
  return out;
}

export function loadSettings() {
  return deepMerge(defaultSettings(), safeGet(KEY_SETTINGS));
}

export function saveSettings(settings) {
  safeSet(KEY_SETTINGS, settings);
}

/** Apply a named preset to a settings object (returns a new object). */
export function applyPreset(settings, preset) {
  if (!GRAPHICS_PRESETS[preset]) return { ...settings, graphics: { ...settings.graphics, preset: 'custom' } };
  return { ...settings, graphics: { ...settings.graphics, ...GRAPHICS_PRESETS[preset], preset } };
}

export function loadLoadout() {
  return sanitizeLoadout(safeGet(KEY_LOADOUT) || defaultLoadout());
}

export function saveLoadout(loadout) {
  safeSet(KEY_LOADOUT, sanitizeLoadout(loadout));
}
