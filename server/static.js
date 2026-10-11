// Minimal, dependency-free static file server used by the game server.
// Serves /client as the web root and maps /vendor/three/* to node_modules/three/*.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'client');
const SHARED_DIR = path.join(ROOT, 'shared');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function resolveSafe(base, rel) {
  const p = path.normalize(path.join(base, rel));
  if (!p.startsWith(base)) return null;
  return p;
}

export function resolveRequestPath(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.startsWith('/vendor/three/')) return resolveSafe(THREE_DIR, p.slice('/vendor/three/'.length));
  if (p.startsWith('/shared/')) return resolveSafe(SHARED_DIR, p.slice('/shared/'.length));
  if (p.endsWith('/')) p += 'index.html';
  return resolveSafe(CLIENT_DIR, p.slice(1));
}

export function serveStatic(req, res, { dev = false } = {}) {
  const file = resolveRequestPath(req.url || '/');
  if (!file) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': dev ? 'no-store' : 'public, max-age=300',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}
