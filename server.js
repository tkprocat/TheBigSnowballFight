// The Big Snowball Fight server: lobbies with 4-letter codes, bots, and server-checked throws.
// No dependencies, just `node server.js`. Clients send actions to POST /api/<action> and get room updates over
// Server-Sent Events from GET /events. The server decides every throw's result; clients only replay it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  TAU, DT, PITCH_MIN, PITCH_MAX, WIN_SCORE, TURN_LIMIT, MAX_PLAYERS, COLORS, BOT_NAMES,
  clamp, makeMap, simulate, windFor, spawnPoint, planThrow, throwShowMs, clampMove, standOk, chooseCover,
} from './public/physics.js';

const PORT = process.env.PORT || 3000;
const BOT_DELAY = Number(process.env.BOT_DELAY_MS ?? 1500); // pause before a bot throws, so people can follow along
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const ROOM_TTL = 6 * 3600e3; // forget rooms nobody has touched for this long

export const rooms = new Map();
const rand = () => crypto.randomInt(2 ** 32) / 2 ** 32;

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
    code, players: [], host: null, started: false, over: null, seed: 1, round: 0,
    cur: 0, turn: 0, phase: 'move', throwN: 0, lastThrow: null, busyUntil: 0, turnEnds: null,
    clock: null, botTimer: null, lastActive: Date.now(),
  };
}

const humans = (room) => room.players.filter((p) => !p.cpu);
const curPlayer = (room) => room.players[room.cur] || null;
const nextPlayer = (room) => room.players.length > 1 ? room.players[(room.cur + 1) % room.players.length] : null;

function place(room, p) {
  const sp = spawnPoint(rand, room.map, room.players.filter((o) => o !== p && o.placed));
  p.x = +sp.x.toFixed(3); p.z = +sp.z.toFixed(3); p.placed = true;
}

// ---------- what each client sees ----------
export function viewFor(room, member) {
  const now = Date.now();
  return {
    code: room.code,
    you: member ? member.id : null,
    host: room.host ? room.host.id : null,
    started: room.started,
    over: room.over,
    seed: room.seed,
    round: room.round,
    turn: room.turn,
    cur: room.started && curPlayer(room) ? curPlayer(room).id : null,
    next: room.started && nextPlayer(room) ? nextPlayer(room).id : null,
    phase: room.phase,
    turnLeft: room.turnEnds ? Math.max(0, room.turnEnds - now) : null,
    busyLeft: Math.max(0, room.busyUntil - now),
    lastThrow: room.lastThrow,
    players: room.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, x: p.x, z: p.z, score: p.score,
      yaw: p.yaw, pitch: p.pitch, cpu: !!p.cpu, online: !!p.cpu || p.clients.size > 0,
    })),
  };
}

function send(res, event, data) { res.write((event ? `event: ${event}\n` : '') + `data: ${JSON.stringify(data)}\n\n`); }
function broadcast(room) {
  for (const p of room.players) for (const res of p.clients) send(res, null, viewFor(room, p));
}
function broadcastAim(room, p) {
  const data = { id: p.id, yaw: p.yaw, pitch: p.pitch };
  for (const q of room.players) for (const res of q.clients) send(res, 'aim', data);
}

// ---------- turns ----------
function clearTimers(room) {
  clearTimeout(room.clock); clearTimeout(room.botTimer);
  room.clock = room.botTimer = null;
}

function startTurn(room) {
  clearTimers(room);
  room.turnEnds = null;
  if (!room.started || room.over || !room.players.length) return;
  const p = curPlayer(room);
  room.phase = 'move';
  const wait = Math.max(0, room.busyUntil - Date.now());
  room.turnEnds = Date.now() + wait + TURN_LIMIT * 1000;
  room.clock = setTimeout(() => {
    // Out of time: throw for them where they were aiming, with a random power.
    try { if (curPlayer(room) === p && !room.over) doThrow(room, p, p.yaw, p.pitch, 0.35 + rand() * 0.4); broadcast(room); }
    catch (e) { console.error(`Turn timer failed in room ${room.code}:`, e); }
  }, room.turnEnds - Date.now());
  if (room.clock.unref) room.clock.unref();
  if (p.cpu) {
    room.botTimer = setTimeout(() => {
      try { botTurn(room, p); } catch (e) { console.error(`Bot ${p.name} in room ${room.code} failed:`, e); }
    }, wait + BOT_DELAY);
    if (room.botTimer.unref) room.botTimer.unref();
  }
}

// A bot first walks to cover from the next thrower, then aims and throws.
function botTurn(room, bot) {
  if (curPlayer(room) !== bot || room.over) return;
  const spot = chooseCover(bot, nextPlayer(room), room.map, room.players, rand);
  bot.x = +spot.x.toFixed(3); bot.z = +spot.z.toFixed(3);
  room.phase = 'aim';
  broadcast(room);
  room.botTimer = setTimeout(() => {
    try { botAim(room, bot); } catch (e) { console.error(`Bot ${bot.name} in room ${room.code} failed:`, e); }
  }, 900);
  if (room.botTimer.unref) room.botTimer.unref();
}

function botAim(room, bot) {
  if (curPlayer(room) !== bot || room.over) return;
  const plan = planThrow(bot, room.players.filter((o) => o !== bot), windFor(room.seed, room.turn), room.map, rand);
  bot.yaw = plan.yaw; bot.pitch = plan.pitch;
  broadcastAim(room, bot);
  room.botTimer = setTimeout(() => {
    try { if (curPlayer(room) === bot && !room.over) { doThrow(room, bot, plan.yaw, plan.pitch, plan.power); broadcast(room); } }
    catch (e) { console.error(`Bot ${bot.name} in room ${room.code} failed:`, e); }
  }, 1300);
  if (room.botTimer.unref) room.botTimer.unref();
}

// Throw a snowball for player p. Decides the result, scores it, moves a hit player, and moves on to the next turn.
function doThrow(room, p, yaw, pitch, power) {
  const wind = windFor(room.seed, room.turn);
  const targets = room.players.filter((o) => o !== p).map((o) => ({ id: o.id, x: o.x, z: o.z }));
  const sim = simulate(p, yaw, pitch, power, wind, targets, room.map);
  const victim = sim.hit ? room.players.find((o) => o.id === sim.hit) : null;
  p.yaw = yaw; p.pitch = pitch;
  room.lastThrow = {
    n: ++room.throwN, by: p.id, turn: room.turn, yaw, pitch, power, x: p.x, z: p.z,
    hit: victim ? victim.id : null, steps: sim.n - 1, from: victim ? { x: victim.x, z: victim.z } : null,
  };
  room.busyUntil = Date.now() + throwShowMs(sim.n - 1, !!victim);
  if (victim) { p.score += 1; place(room, victim); }
  room.lastActive = Date.now();
  if (p.score >= WIN_SCORE) {
    room.over = { winner: p.id };
    clearTimers(room); room.turnEnds = null;
    return;
  }
  room.cur = (room.cur + 1) % room.players.length;
  room.turn += 1;
  startTurn(room);
}

function removeMember(room, p) {
  const i = room.players.indexOf(p);
  if (i < 0) return;
  for (const res of p.clients) res.end();
  room.players.splice(i, 1);
  if (room.host === p) room.host = humans(room)[0] || null;
  if (!humans(room).length) { clearTimers(room); rooms.delete(room.code); return; }
  if (room.started && !room.over) {
    const wasCurrent = i === room.cur;
    if (i < room.cur) room.cur -= 1;
    room.cur %= room.players.length;
    if (wasCurrent) startTurn(room);
  }
}

function requireHost(room, member) { if (room.host !== member) throw new Error('Only the host can do that'); }

// ---------- actions ----------
export const actions = {
  create(body) {
    const room = newRoom(newCode());
    rooms.set(room.code, room);
    const result = actions.join({ ...body, code: room.code });
    room.host = room.players[0];
    return result;
  },

  // Join by code. Joining a game in progress is fine: you get a spot and wait for your turn.
  join({ code, name, color }) {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) throw new Error('No room with that code');
    if (room.players.length >= MAX_PLAYERS) throw new Error('That room is full');
    const member = {
      id: crypto.randomBytes(5).toString('hex'), token: crypto.randomUUID(),
      name: cleanName(name, `Player ${room.players.length + 1}`), color: pickColor(room, color),
      x: 0, z: 0, yaw: 0, pitch: 0.6, score: 0, cpu: false, clients: new Set(), aimAt: 0, placed: false,
    };
    room.players.push(member);
    if (room.started) place(room, member);
    room.lastActive = Date.now();
    broadcast(room);
    return { code: room.code, token: member.token, id: member.id };
  },

  leave(_body, room, member) { removeMember(room, member); },

  addBot(_body, room, member) {
    requireHost(room, member);
    if (room.started) throw new Error('Add computer players before the game starts');
    if (room.players.length >= MAX_PLAYERS) throw new Error('The room is full');
    const used = new Set(room.players.map((p) => p.name));
    room.players.push({
      id: crypto.randomBytes(5).toString('hex'), token: null, name: BOT_NAMES.find((n) => !used.has(n)) || 'Snowbot',
      color: pickColor(room), x: 0, z: 0, yaw: 0, pitch: 0.6, score: 0, cpu: true, clients: new Set(), placed: false,
    });
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
    room.map = makeMap(room.seed);
    for (const p of room.players) { p.placed = false; p.score = 0; }
    for (const p of room.players) place(room, p);
    room.cur = crypto.randomInt(room.players.length);
    room.turn = 0; room.over = null; room.busyUntil = 0;
    startTurn(room);
  },

  again(_body, room, member) {
    requireHost(room, member);
    if (!room.over) throw new Error('The round is still going');
    room.over = null; room.round += 1;
    for (const p of room.players) { p.placed = false; p.score = 0; }
    for (const p of room.players) place(room, p);
    room.cur = crypto.randomInt(room.players.length);
    room.turn += 1;
    room.busyUntil = Math.max(room.busyUntil, Date.now());
    startTurn(room);
  },

  // Where the current player is aiming, so everyone sees them turn. Sent often; answered with a light event.
  aim({ yaw, pitch }, room, member) {
    if (curPlayer(room) !== member) return 'quiet';
    const now = Date.now();
    if (now - member.aimAt < 50) return 'quiet';
    member.aimAt = now;
    member.yaw = toYaw(yaw); member.pitch = toPitch(pitch);
    broadcastAim(room, member);
    return 'quiet';
  },

  // Walk somewhere inside your move ring, once per turn, before throwing. Moving is optional.
  move({ x, z }, room, member) {
    if (!room.started) throw new Error('The game has not started');
    if (room.over) throw new Error('The round is over');
    if (curPlayer(room) !== member) throw new Error('It is not your turn');
    if (room.phase !== 'move') throw new Error('You have already moved this turn');
    if (Date.now() < room.busyUntil - 150) throw new Error('Wait for the last snowball to land');
    if (![x, z].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('Bad move');
    const to = clampMove(member, { x, z });
    if (!standOk(to.x, to.z, room.map, room.players.filter((o) => o !== member))) throw new Error("You can't stand there");
    member.x = +to.x.toFixed(3); member.z = +to.z.toFixed(3);
    room.phase = 'aim';
  },

  throw({ yaw, pitch, power }, room, member) {
    if (!room.started) throw new Error('The game has not started');
    if (room.over) throw new Error('The round is over');
    if (curPlayer(room) !== member) throw new Error('It is not your turn');
    if (Date.now() < room.busyUntil - 150) throw new Error('Wait for the last snowball to land');
    if (![yaw, pitch, power].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('Bad throw');
    doThrow(room, member, toYaw(yaw), toPitch(pitch), clamp(power, 0, 1));
  },
};

function toYaw(v) { return typeof v === 'number' && Number.isFinite(v) ? ((v % TAU) + TAU) % TAU : 0; }
function toPitch(v) { return typeof v === 'number' && Number.isFinite(v) ? clamp(v, PITCH_MIN, PITCH_MAX) : 0.6; }

// A player, by their secret token.
export function findMember(code, token) {
  const room = rooms.get(String(code || '').toUpperCase());
  const member = room && typeof token === 'string' && room.players.find((m) => m.token === token);
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
    return res.end(JSON.stringify({ ok: true, game: 'snowball' }));
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
    if (Date.now() - room.lastActive > ROOM_TTL) { clearTimers(room); rooms.delete(code); }
}, 600e3).unref();

// Start listening only when run directly (`node server.js`); tests import this file instead.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`❄️  The Big Snowball Fight running on http://localhost:${PORT}`));
}
