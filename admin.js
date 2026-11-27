// The admin dashboard: live lobbies and games, and the anonymous statistics (stats.js).
// Off unless ADMIN_TOKEN is set. GET /admin serves the page (it holds no data); the page asks for the token and
// fetches GET /api/admin with `Authorization: Bearer <token>`. Lobby codes are shown (an admin may want to drop
// in and watch), never names or tokens.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { rooms } from './rooms.js';
import { statsSummary } from './stats.js';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'admin', 'index.html');
const MAX_FAILS = 10; // wrong tokens per address in FAIL_WINDOW before it is refused for a while
const FAIL_WINDOW = 10 * 60e3;
const fails = new Map(); // address -> { n, since }; memory only, never written anywhere

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

// Is this the admin token? Compared in constant time, so the answer doesn't leak through timing.
export function tokenOk(given, token = process.env.ADMIN_TOKEN) {
  if (!token || typeof given !== 'string' || !given) return false;
  return crypto.timingSafeEqual(sha(given), sha(token));
}

// What's going on right now, room by room.
export function liveSummary(now = Date.now()) {
  const list = [];
  for (const room of rooms.values()) {
    const people = room.players.filter((p) => !p.cpu);
    list.push({
      code: room.code,
      mode: room.mode,
      state: !room.started ? 'lobby' : room.over ? 'over' : 'playing',
      humans: people.length,
      online: people.filter((p) => p.clients.size > 0).length + room.spectators.filter((s) => s.clients.size > 0).length,
      bots: room.players.length - people.length,
      spectators: room.spectators.length,
      round: room.round + (room.started ? 1 : 0),
      win: room.win,
      topScore: room.players.reduce((m, p) => Math.max(m, p.score || 0), 0),
      ageMs: now - (room.createdAt || now),
      roundMs: room.roundStartedAt && room.started && !room.over ? now - room.roundStartedAt : null,
      idleMs: now - room.lastActive,
    });
  }
  list.sort((a, b) => b.online - a.online || a.ageMs - b.ageMs);
  const sum = (k, rows = list) => rows.reduce((n, r) => n + r[k], 0);
  const playing = list.filter((r) => r.state === 'playing');
  return {
    rooms: list.length, lobbies: list.filter((r) => r.state === 'lobby').length, playing: playing.length,
    humans: sum('humans') + sum('spectators'), online: sum('online'), bots: sum('bots'), botsPlaying: sum('bots', playing),
    list,
  };
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

// Who is asking, for counting wrong tokens. Behind a reverse proxy every request comes from the proxy, so one
// visitor's wrong tokens would lock everyone out; with TRUST_PROXY set, the address the proxy put last in
// X-Forwarded-For is used instead (only the last one: anything before it the visitor could have sent). Leave it
// unset when nothing sits in front of the server, or anyone could pick their own address.
export function clientAddr(req) {
  const peer = req.socket.remoteAddress || '?';
  if (!process.env.TRUST_PROXY) return peer;
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return hops.at(-1) || peer;
}

export function handleAdmin(req, res, url) {
  if (!process.env.ADMIN_TOKEN) { res.writeHead(404); return res.end('Not found'); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

  if (url.pathname === '/admin') {
    return fs.readFile(PAGE, (err, data) => {
      if (err) { res.writeHead(500); return res.end(); }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex',
      });
      res.end(data);
    });
  }
  if (url.pathname !== '/api/admin') return json(res, 404, { ok: false, error: 'Not found' });

  const addr = clientAddr(req);
  const now = Date.now();
  const f = fails.get(addr);
  if (f && now - f.since > FAIL_WINDOW) fails.delete(addr);
  else if (f && f.n >= MAX_FAILS) return json(res, 429, { ok: false, error: 'Too many wrong tokens. Try again later' });

  const auth = String(req.headers.authorization || '');
  if (!tokenOk(auth.startsWith('Bearer ') ? auth.slice(7) : '')) {
    const g = fails.get(addr) || { n: 0, since: now };
    g.n++; fails.set(addr, g);
    return json(res, 401, { ok: false, error: 'Wrong token' });
  }
  fails.delete(addr);
  json(res, 200, { ok: true, now: new Date(now).toISOString(), uptimeS: Math.round(process.uptime()), live: liveSummary(now), stats: statsSummary() });
}

// forget old wrong-token counts now and then
setInterval(() => {
  const now = Date.now();
  for (const [a, f] of fails) if (now - f.since > FAIL_WINDOW) fails.delete(a);
}, FAIL_WINDOW).unref();
