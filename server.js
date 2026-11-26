// The Big Snowball Fight server: lobbies with 4-letter codes, two game modes, bots and spectators.
// No dependencies, just `node server.js`. Clients send actions to POST /api/<action> and get room updates over
// Server-Sent Events from GET /events. The server decides every hit; clients only draw it.
//   rooms.js              rooms, members, views and sending updates
//   modes/turnbased/      one player at a time: walk, then throw or pack a heavy snowball
//   modes/realtime/       everyone at once: run, pick snowballs up, throw
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CHAT_LINES, EMOTES, MAX_PLAYERS, COLORS, BOT_NAMES, makeMap } from './public/shared/physics.js';
import { rooms, MODES, members, humans, place, viewFor, broadcast, broadcastSay } from './rooms.js';
import turnbased from './modes/turnbased/index.js';
import realtime from './modes/realtime/index.js';

export { rooms, viewFor };
MODES.turn = turnbased;
MODES.realtime = realtime;

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const ROOM_TTL = 6 * 3600e3; // forget rooms nobody has touched for this long

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  while (rooms.has(code));
  return code;
}

// One line of plain text: no control or text-direction characters, cut to `max` characters.
export function cleanName(name, fallback) {
  const s = String(name ?? '').normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, '')
    .trim();
  return Array.from(s).slice(0, 14).join('') || fallback;
}

function pickColor(room, wanted) {
  const used = new Set(room.players.map((p) => p.color));
  if (COLORS.includes(wanted) && !used.has(wanted)) return wanted;
  return COLORS.find((c) => !used.has(c)) || COLORS[room.players.length % COLORS.length];
}

function newRoom(code) {
  return {
    code, mode: 'turn', players: [], spectators: [], host: null, started: false, over: null, seed: 1, round: 0,
    cur: 0, turn: 0, phase: 'move', throwN: 0, packN: 0, lastPack: null, lastThrow: null, busyUntil: 0, turnEnds: null,
    clock: null, botTimer: null, rt: null, lastActive: Date.now(),
  };
}

// A new seat for someone (or a bot), with what every mode needs.
function newMember(fields) {
  const m = {
    id: crypto.randomBytes(5).toString('hex'), token: null, cpu: false,
    x: 0, z: 0, yaw: 0, pitch: 0.6, score: 0, clients: new Set(), sayTimes: [], placed: false, ...fields,
  };
  for (const mode of Object.values(MODES)) mode.newPlayer(m);
  return m;
}

function removeMember(room, p) {
  for (const res of p.clients) res.end();
  const si = room.spectators.indexOf(p);
  if (si >= 0) room.spectators.splice(si, 1);
  const i = room.players.indexOf(p);
  if (i >= 0) room.players.splice(i, 1);
  if (room.host === p) room.host = humans(room)[0] || null;
  if (!humans(room).length) { stopRoom(room); rooms.delete(room.code); return; }
  if (i >= 0 && room.started) MODES[room.mode].remove(room, p, i);
}

function stopRoom(room) { for (const mode of Object.values(MODES)) mode.stop(room); }

function requireHost(room, member) { if (room.host !== member) throw new Error('Only the host can do that'); }

// Fresh scores and spots for a new round.
function resetRound(room) {
  for (const p of room.players) { p.placed = false; p.score = 0; }
  for (const p of room.players) place(room, p);
}

// ---------- lobby actions (any mode) ----------
const lobbyActions = {
  create(body) {
    const room = newRoom(newCode());
    rooms.set(room.code, room);
    const result = actions.join({ ...body, code: room.code });
    room.host = room.players[0];
    return result;
  },

  // Join by code. Joining a game in progress is fine. A full room makes you a spectator.
  join({ code, name, color }) {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) throw new Error('No room with that code');
    if (members(room).length >= MAX_PLAYERS * 2) throw new Error('That room is full');
    const full = room.players.length >= MAX_PLAYERS;
    const member = newMember({
      token: crypto.randomUUID(),
      name: cleanName(name, `Player ${members(room).length + 1}`), color: pickColor(room, color),
    });
    if (full) room.spectators.push(member);
    else {
      room.players.push(member);
      if (room.started) MODES[room.mode].join(room, member);
    }
    room.lastActive = Date.now();
    broadcast(room);
    return { code: room.code, token: member.token, id: member.id };
  },

  leave(_body, room, member) { removeMember(room, member); },

  // Lobby only: switch between a seat and watching. The host stays host while watching.
  spectate(_body, room, member) {
    if (room.started) throw new Error('You can only switch before the game starts');
    if (room.spectators.includes(member)) {
      if (room.players.length >= MAX_PLAYERS) throw new Error('All seats are taken');
      room.spectators.splice(room.spectators.indexOf(member), 1);
      member.color = pickColor(room, member.color);
      room.players.push(member);
    } else {
      room.players.splice(room.players.indexOf(member), 1);
      room.spectators.push(member);
    }
  },

  setMode({ mode }, room, member) {
    requireHost(room, member);
    if (room.started) throw new Error('Pick the mode before the game starts');
    if (!Object.hasOwn(MODES, mode)) throw new Error('Unknown mode');
    room.mode = mode;
  },

  addBot(_body, room, member) {
    requireHost(room, member);
    if (room.started) throw new Error('Add computer players before the game starts');
    if (room.players.length >= MAX_PLAYERS) throw new Error('The room is full');
    const used = new Set(members(room).map((p) => p.name));
    room.players.push(newMember({ cpu: true, name: BOT_NAMES.find((n) => !used.has(n)) || 'Snowbot', color: pickColor(room) }));
  },

  removeBot({ id }, room, member) {
    requireHost(room, member);
    const bot = room.players.find((p) => p.cpu && p.id === id);
    if (!bot) throw new Error('No computer player with that id');
    removeMember(room, bot);
  },

  start(_body, room, member) {
    requireHost(room, member);
    if (room.started) throw new Error('The game has already started');
    if (room.players.length < 2) throw new Error('You need at least 2 players');
    room.started = true;
    room.seed = crypto.randomInt(1, 2 ** 31);
    room.mapSize = room.mode === 'realtime' ? 'large' : 'small';
    room.map = makeMap(room.seed, room.mapSize);
    room.over = null;
    resetRound(room);
    MODES[room.mode].start(room);
  },

  again(_body, room, member) {
    requireHost(room, member);
    if (!room.over) throw new Error('The round is still going');
    room.over = null; room.round += 1;
    resetRound(room);
    MODES[room.mode].again(room);
  },

  // Quick chat: one of the fixed lines or emotes. Works in the lobby and in the game, for spectators too.
  say({ line, emote }, room, member) {
    const now = Date.now();
    member.sayTimes = (member.sayTimes || []).filter((t) => now - t < 5000);
    if (member.sayTimes.length >= 4) throw new Error('Slow down a little');
    let what;
    if (Number.isInteger(line) && line >= 0 && line < CHAT_LINES.length) what = { line };
    else if (EMOTES.includes(emote)) what = { emote };
    else throw new Error('Unknown message');
    member.sayTimes.push(now);
    broadcastSay(room, member, what);
    return 'quiet';
  },
};

// Game actions go to the room's mode. Each one is only accepted in its own mode, and only from a seated player.
function modeAction(name) {
  return (body, room, member) => {
    const fn = Object.hasOwn(MODES[room.mode].actions, name) ? MODES[room.mode].actions[name] : null;
    if (!fn) throw new Error('Not in this mode');
    if (!room.players.includes(member)) throw new Error('You are watching');
    return fn(body || {}, room, member);
  };
}

export const actions = { ...lobbyActions };
for (const mode of Object.values(MODES))
  for (const name of Object.keys(mode.actions)) if (!Object.hasOwn(actions, name)) actions[name] = modeAction(name);

// A player or spectator, by their secret token.
export function findMember(code, token) {
  const room = rooms.get(String(code || '').toUpperCase());
  const member = room && typeof token === 'string' && members(room).find((m) => m.token === token);
  if (!member) throw new Error('Unknown room or player');
  return { room, member };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e4) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Bad JSON')); } });
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/events') {
    let found;
    try { found = findMember(url.searchParams.get('code'), url.searchParams.get('token')); }
    catch { res.writeHead(404); return res.end(); }
    const { room, member } = found;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    member.clients.add(res);
    room.lastActive = Date.now();
    broadcast(room);
    if (room.started && MODES[room.mode].wake) MODES[room.mode].wake(room);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      member.clients.delete(res);
      if (rooms.get(room.code) === room) broadcast(room);
    });
    return;
  }

  if (url.pathname === '/api/hello') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, game: 'snowball', modes: Object.keys(MODES) }));
  }

  const m = url.pathname.match(/^\/api\/(\w+)$/);
  if (m && req.method === 'POST' && Object.hasOwn(actions, m[1])) {
    try {
      const body = await readBody(req);
      let result = {};
      if (m[1] === 'create' || m[1] === 'join') result = actions[m[1]](body);
      else {
        const { room, member } = findMember(body.code, body.token);
        room.lastActive = Date.now();
        const quiet = actions[m[1]](body, room, member) === 'quiet';
        if (!quiet && rooms.get(room.code) === room) broadcast(room);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

setInterval(() => {
  for (const [code, room] of rooms)
    if (Date.now() - room.lastActive > ROOM_TTL) { stopRoom(room); rooms.delete(code); }
}, 600e3).unref();

// Start listening only when run directly (`node server.js`); tests import this file instead.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`❄️  The Big Snowball Fight running on http://localhost:${PORT}`));
}
