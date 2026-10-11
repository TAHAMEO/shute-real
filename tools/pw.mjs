// Shared Playwright launcher for dev tools/tests (uses the globally installed Playwright if not in node_modules).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export function loadPlaywright() {
  const candidates = [
    'playwright',
    process.env.PLAYWRIGHT_PATH,
    '/opt/node-tools/node_modules/playwright',
    '/opt/node22/lib/node_modules/playwright',
    '/usr/lib/node_modules/playwright',
    '/usr/local/lib/node_modules/playwright',
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* try next */ }
  }
  throw new Error('Playwright not found. Install with: npm i -g playwright');
}

// Chromium flags that give a working (software) WebGL2 context on machines without a GPU.
export const CHROMIUM_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--autoplay-policy=no-user-gesture-required',
  '--no-sandbox',
];

export async function launchBrowser(opts = {}) {
  const { chromium } = loadPlaywright();
  const launchOpts = { headless: true, args: CHROMIUM_ARGS, ...opts };
  if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch(launchOpts);
}
