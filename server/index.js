#!/usr/bin/env node
// SHUTE REAL game server: serves the game files and hosts multiplayer rooms over WebSockets.
//   node server/index.js [--port 7777] [--host 0.0.0.0] [--name "My Server"] [--dev] [--no-default-room]
import http from 'node:http';
import os from 'node:os';
import { WebSocketServer } from 'ws';
import { serveStatic } from './static.js';
import { GameRoom } from '../shared/room.js';
import { GAME_NAME, GAME_VERSION, PROTOCOL_VERSION, DEFAULT_PORT } from '../shared/constants.js';
import { MAP_IDS, getWorld } from '../shared/world.js';

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = Number(argVal('--port', process.env.PORT || DEFAULT_PORT));
const HOST = argVal('--host', process.env.HOST || '0.0.0.0');
const DEV = args.includes('--dev');
const SERVER_NAME = argVal('--name', process.env.SERVER_NAME || `${os.hostname()}'s server`).slice(0, 40);
const MAX_ROOMS = 16;
const TICK_HZ = 30;

export function lanAddresses(port = PORT) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(`http://${ni.address}:${port}`);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------- rooms
const rooms = new Map();
const clients = new Map(); // clientId -> { ws, room, name, msgCount, lastReset }
let nextClientId = 1;

function makeTransport() {
  let lastMsg = null;
  let lastJson = '';
  return {
    send(clientId, msg) {
      const c = clients.get(clientId);
      if (!c || c.ws.readyState !== 1) return;
      if (msg !== lastMsg) { lastMsg = msg; lastJson = JSON.stringify(msg); }
      // Drop snapshots for clients that can't keep up.
      if (msg.t === 'snap' && c.ws.bufferedAmount > 512 * 1024) return;
      c.ws.send(lastJson);
    },
  };
}

function createRoom(config, host = '') {
  if (rooms.size >= MAX_ROOMS) throw new Error('Server room limit reached');
  const room = new GameRoom({ ...config, host });
  room.transport = makeTransport();
  room.persistent = !!config.persistent;
  rooms.set(room.id, room);
  log(`room ${room.id} created: "${room.name}" ${room.mode} on ${room.mapId} (bots ${room.botCount}, max ${room.maxPlayers})`);
  return room;
}

function roomList() {
  return [...rooms.values()].map((r) => r.info());
}

function playersOnline() {
  let n = 0;
  for (const c of clients.values()) if (c.room) n++;
  return n;
}

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

// ------------------------------------------------------------------------------- http + ws
const server = http.createServer((req, res) => {
  if (req.url === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ name: SERVER_NAME, game: GAME_NAME, version: GAME_VERSION, protocol: PROTOCOL_VERSION, rooms: roomList(), lanUrls: lanAddresses(), playersOnline: playersOnline() }));
    return;
  }
  serveStatic(req, res, { dev: DEV });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
  const id = nextClientId++;
  const client = { ws, room: null, name: 'Player', msgCount: 0, lastReset: Date.now(), addr: req.socket.remoteAddress };
  clients.set(id, client);
  const sendRaw = (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  ws.on('message', (data) => {
    // Flood protection.
    const now = Date.now();
    if (now - client.lastReset > 1000) { client.lastReset = now; client.msgCount = 0; }
    if (++client.msgCount > 200) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'hello':
        client.name = String(msg.name || 'Player').slice(0, 18);
        sendRaw({ t: 'hello', name: SERVER_NAME, version: GAME_VERSION, protocol: PROTOCOL_VERSION, rooms: roomList(), lanUrls: lanAddresses(), playersOnline: playersOnline(), maps: MAP_IDS });
        break;
      case 'list':
        sendRaw({ t: 'rooms', rooms: roomList(), playersOnline: playersOnline() });
        break;
      case 'create': {
        try {
          const room = createRoom(msg.config || {}, client.name);
          sendRaw({ t: 'created', id: room.id, room: room.info() });
        } catch (e) {
          sendRaw({ t: 'error', msg: e.message });
        }
        break;
      }
      case 'join': {
        const room = rooms.get(String(msg.id || ''));
        if (!room) { sendRaw({ t: 'error', msg: 'Room not found' }); break; }
        if (client.room) client.room.leave(id);
        client.name = String(msg.name || client.name).slice(0, 18);
        const res = room.join(id, { name: client.name, loadout: msg.loadout });
        if (res && res.error) { sendRaw({ t: 'error', msg: res.error }); break; }
        client.room = room;
        log(`${client.name} (${client.addr}) joined room ${room.id}`);
        break;
      }
      case 'leave':
        if (client.room) { client.room.leave(id); client.room = null; }
        sendRaw({ t: 'left' });
        break;
      default:
        if (client.room) client.room.receive(id, msg);
    }
  });

  ws.on('close', () => {
    if (client.room) {
      client.room.leave(id);
      log(`${client.name} left room ${client.room.id}`);
    }
    clients.delete(id);
  });
  ws.on('error', () => {});
});

// ------------------------------------------------------------------------------- loop
let last = process.hrtime.bigint();
setInterval(() => {
  const now = process.hrtime.bigint();
  let dt = Number(now - last) / 1e9;
  last = now;
  if (dt > 0.25) dt = 0.25;
  for (const room of rooms.values()) {
    try {
      room.tick(dt);
    } catch (e) {
      console.error(`room ${room.id} tick error:`, e);
    }
    // Close abandoned rooms.
    if (!room.persistent && room.humanCount === 0 && room.emptySince !== null && room.now - room.emptySince > 90) {
      rooms.delete(room.id);
      log(`room ${room.id} closed (empty)`);
    }
    if (!room.persistent && room.humanCount === 0 && room.emptySince === null) room.emptySince = room.now;
  }
}, 1000 / TICK_HZ);

// ------------------------------------------------------------------------------- start
function start() {
  // --dev serves files only (used while developing art/UI) unless --rooms is given.
  const withRooms = !DEV || args.includes('--rooms');
  if (withRooms) {
    const t0 = Date.now();
    for (const m of MAP_IDS) getWorld(m, { vegetation: false });
    log(`maps generated in ${Date.now() - t0} ms`);
  }
  if (withRooms && !args.includes('--no-default-room')) {
    createRoom({ name: 'Highland Valley · TDM', mapId: 'valley', mode: 'tdm', maxPlayers: 12, bots: 8, difficulty: 'normal', persistent: true }, 'server');
    createRoom({ name: 'Forest Outpost · FFA', mapId: 'outpost', mode: 'ffa', maxPlayers: 10, bots: 6, difficulty: 'normal', persistent: true }, 'server');
  }
  server.listen(PORT, HOST, () => {
    const lan = lanAddresses();
    console.log('');
    console.log(`  ${GAME_NAME} v${GAME_VERSION} — server "${SERVER_NAME}"`);
    console.log(`  Play on this computer:   http://localhost:${PORT}`);
    for (const u of lan) console.log(`  Friends on your network: ${u}`);
    console.log('');
  });
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Is the server already running? Try: node server/index.js --port ${PORT + 1}`);
    process.exit(1);
  }
  throw e;
});

start();
