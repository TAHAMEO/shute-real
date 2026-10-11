// Transports between the client session and a game room:
//  - NetTransport: WebSocket to a SHUTE REAL server (multiplayer / LAN)
//  - LocalTransport: an in-browser GameRoom (solo vs bots, works offline)
import { GameRoom } from '/shared/room.js';

const LOCAL_CLIENT = 1;
const TICK = 1 / 30;

export class NetTransport {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = new Set();
    this.closeHandlers = new Set();
    this.isLocal = false;
  }

  /** Resolves once the socket is open. */
  connect(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch { /* ignore */ } reject(new Error('Connection timed out')); } }, timeoutMs);
      ws.onopen = () => { if (done) return; done = true; clearTimeout(timer); resolve(this); };
      ws.onerror = () => { if (done) return; done = true; clearTimeout(timer); reject(new Error('Could not connect to ' + this.url)); };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        for (const h of this.handlers) h(msg);
      };
      ws.onclose = () => { for (const h of this.closeHandlers) h(); };
    });
  }

  get connected() { return !!this.ws && this.ws.readyState === 1; }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  onMessage(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  onClose(fn) { this.closeHandlers.add(fn); return () => this.closeHandlers.delete(fn); }

  /** Called by the game loop (nothing to do for sockets). */
  tick() {}

  close() {
    this.handlers.clear();
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
  }
}

/** Solo play: runs the authoritative GameRoom in this page. */
export class LocalTransport {
  constructor(roomOpts, env) {
    this.room = new GameRoom({ ...roomOpts, isLocal: true }, env);
    this.queue = [];
    this.handlers = new Set();
    this.closeHandlers = new Set();
    this.acc = 0;
    this.isLocal = true;
    this.room.transport = { send: (cid, msg) => { if (cid === LOCAL_CLIENT) this.queue.push(msg); } };
  }

  get connected() { return true; }

  join(name, loadout) {
    return this.room.join(LOCAL_CLIENT, { name, loadout });
  }

  send(msg) {
    // Copy so the room can't share references with client-side objects.
    this.room.receive(LOCAL_CLIENT, JSON.parse(JSON.stringify(msg)));
  }

  onMessage(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  onClose(fn) { this.closeHandlers.add(fn); return () => this.closeHandlers.delete(fn); }

  /** Advance the room at a fixed 30 Hz and deliver queued messages. */
  tick(dt) {
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.room.tick(TICK);
    }
    this.flush();
  }

  flush() {
    if (!this.queue.length) return;
    const q = this.queue;
    this.queue = [];
    for (const m of q) for (const h of this.handlers) h(m);
  }

  close() {
    this.room.leave(LOCAL_CLIENT);
    this.handlers.clear();
    for (const h of this.closeHandlers) h();
  }
}

/** Default WebSocket URL for the server that served this page. */
export function defaultServerUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/** Normalise "host:port" / "http://host:port" into a ws:// URL. */
export function serverUrlFromAddress(addr) {
  let a = String(addr || '').trim();
  if (!a) return defaultServerUrl();
  a = a.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
  if (!/:\d+$/.test(a)) a += ':7777';
  return `ws://${a}/ws`;
}
