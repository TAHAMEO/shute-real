// Small DOM helpers shared by the menu and the HUD (no framework).

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an element. `tag` accepts a CSS-like shorthand: 'div.sr-a.sr-b#id'.
 * `props`: attributes / properties. Keys starting with 'on' attach listeners,
 * `class` / `className` add classes, `style` accepts a string or object, `dataset` an object,
 * `html` sets innerHTML. Children may be nodes, strings, numbers, arrays, null/false (skipped).
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  if (m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) applyProps(el, props);
  append(el, children);
  return el;
}

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class' || k === 'className') {
      for (const c of String(v).split(/\s+/)) if (c) el.classList.add(c);
    } else if (k === 'style') {
      if (typeof v === 'string') el.style.cssText += v;
      else for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (k === 'html') {
      el.innerHTML = v;
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k in el && typeof v !== 'string') {
      el[k] = v;
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, v);
    }
  }
}

/** Append children (nodes, strings, arrays; null/false skipped). */
export function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Parse an SVG markup string into an element. */
export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

/** Create an SVG element by tag name with attributes. */
export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Remove all children. */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Set textContent only when it changed (avoids needless layout/paint). */
export function setText(el, text) {
  const t = text === null || text === undefined ? '' : String(text);
  if (el._srText !== t) {
    el._srText = t;
    el.textContent = t;
  }
}

/** Toggle a class only when the state changed. */
export function setClass(el, cls, on) {
  on = !!on;
  const key = '_src_' + cls;
  if (el[key] !== on) {
    el[key] = on;
    el.classList.toggle(cls, on);
  }
}

/** Set a style property only when it changed. */
export function setStyle(el, prop, value) {
  const key = '_srs_' + prop;
  if (el[key] !== value) {
    el[key] = value;
    if (prop.startsWith('--')) el.style.setProperty(prop, value);
    else el.style[prop] = value;
  }
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/** Format seconds as m:ss (or h:mm:ss). Negative / invalid → 0:00. */
export function fmtTime(s) {
  s = Math.max(0, Math.ceil(Number(s) || 0));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** Deterministic PRNG (mulberry32) seeded from a string or number. */
export function seededRandom(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** `#rrggbb` → `r g b` (for rgb(var(--x) / a) usage) */
export function hexToRgbTriplet(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '255 255 255';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Inline SVG icon strings used by both menu and HUD (currentColor based). */
export const ICONS = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/></svg>',
  chevronL: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/></svg>',
  chevronR: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/></svg>',
  arrowR: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.8h-4.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v10H9zM5 15V5h10" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14l4-4M8.5 11.5l-2 2a3.5 3.5 0 0 0 5 5l2-2M15.5 12.5l2-2a3.5 3.5 0 0 0-5-5l-2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" fill="currentColor"/></svg>',
  bot: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="8" width="14" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4v4M9 13h.01M15 13h.01" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z" fill="currentColor"/><path d="M12 10v5M12 17.5v.5" stroke="#000" stroke-width="2.2" stroke-linecap="square"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v6M12 7.5v.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/></svg>',
  error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="currentColor" stroke-width="2.2"/></svg>',
  skull: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c-4.7 0-8 3.2-8 7.6 0 2.5 1.1 4.3 2.8 5.5V19h2.4v-2h1.6v2h2.4v-2h1.6v2h2.4v-3.4c1.7-1.2 2.8-3 2.8-5.5 0-4.4-3.3-7.6-8-7.6zM8.6 13.4a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm6.8 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" fill="currentColor"/></svg>',
  headshot: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 3v6.5c0 5-3.4 8.9-8 10.5-4.6-1.6-8-5.5-8-10.5V5z" fill="currentColor"/></svg>',
  cross: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="currentColor"/></svg>',
  frag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5h5v2.2h-5z" fill="currentColor"/><path d="M14.5 4.2l3.6-1.4.6 1.6-3.4 1.6z" fill="currentColor"/><ellipse cx="11.5" cy="14.2" rx="6.3" ry="7.3" fill="currentColor"/><path d="M5.6 12h11.8M5.6 16.2h11.8M11.5 7v14.4" stroke="rgba(0,0,0,.45)" stroke-width="1.1"/></svg>',
  smoke: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="6" width="10" height="16" rx="1.6" fill="currentColor"/><rect x="8.5" y="3" width="7" height="2.4" fill="currentColor"/><path d="M7 11h10M7 17h10" stroke="rgba(0,0,0,.45)" stroke-width="1.2"/></svg>',
  knife: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 14.5L15 8.2l2.2 1.6-11.6 6.4z" fill="currentColor"/><path d="M16.6 8.6l4.9-2.1.9 2-4.8 2.4z" fill="currentColor"/></svg>',
  mouseL: '<svg viewBox="0 0 24 32" aria-hidden="true"><rect x="3" y="2" width="18" height="28" rx="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v11M3 13h18" stroke="currentColor" stroke-width="1.6"/><path d="M12 2.9a8.1 8.1 0 0 0-8.1 8.1V13H12z" fill="var(--sr-accent)"/></svg>',
  mouseR: '<svg viewBox="0 0 24 32" aria-hidden="true"><rect x="3" y="2" width="18" height="28" rx="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v11M3 13h18" stroke="currentColor" stroke-width="1.6"/><path d="M12 2.9a8.1 8.1 0 0 1 8.1 8.1V13H12z" fill="var(--sr-accent)"/></svg>',
  mouseW: '<svg viewBox="0 0 24 32" aria-hidden="true"><rect x="3" y="2" width="18" height="28" rx="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v4.5M12 11.5V13M3 13h18" stroke="currentColor" stroke-width="1.6"/><rect x="10" y="5.5" width="4" height="7" rx="2" fill="var(--sr-accent)"/></svg>',
};

/** Create an element from one of the ICONS. */
export function icon(name, cls = '') {
  const el = svg(ICONS[name] || ICONS.info);
  el.setAttribute('class', ('sr-ico ' + cls).trim());
  return el;
}
