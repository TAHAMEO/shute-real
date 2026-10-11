#!/usr/bin/env node
// Usage: node tools/screenshot.mjs <url> <out.png> [--size 1280x720] [--wait 3000]
//        [--until "window.__READY===true"] [--timeout 120000] [--eval "js code run after ready"]
// Prints browser console output and page errors. Exit code 1 on page errors.
import { launchBrowser } from './pw.mjs';

const args = process.argv.slice(2);
const url = args[0];
const out = args[1] || 'tools/out/shot.png';
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const [w, h] = opt('--size', '1280x720').split('x').map(Number);
const wait = Number(opt('--wait', '1000'));
const until = opt('--until', null);
const timeout = Number(opt('--timeout', '120000'));
const evalCode = opt('--eval', null);

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: w, height: h } });
let errors = 0;
page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => { errors++; console.log(`[pageerror] ${e.message}\n${e.stack || ''}`); });
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout });
if (until) await page.waitForFunction(until, null, { timeout, polling: 250 });
if (evalCode) {
  const r = await page.evaluate(evalCode);
  if (r !== undefined) console.log('[eval]', typeof r === 'string' ? r : JSON.stringify(r));
}
await page.waitForTimeout(wait);
await page.screenshot({ path: out, timeout: timeout });
console.log(`saved ${out} in ${Date.now() - t0}ms`);
await browser.close();
process.exit(errors ? 1 : 0);
