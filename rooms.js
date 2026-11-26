// Rooms and what every game mode shares: members, views, sending updates, placing players.
// server.js handles HTTP and the lobby; modes/turnbased and modes/realtime run the game itself.
import crypto from 'node:crypto';
import { spawnPoint } from './public/shared/physics.js';

export const rooms = new Map();
export const rand = () => crypto.randomInt(2 ** 32) / 2 ** 32;

// The game modes, filled in by server.js: { turn: turnbased, realtime }.
export const MODES = {};

// Everyone in a room: players have a seat (room.players, bots included), spectators only watch.
export const members = (room) => [...room.players, ...room.spectators];
// People (not bots), seated or watching.
export const humans = (room) => members(room).filter((m) => !m.cpu);
// Has any person got the room open right now?
export const humanWatching = (room) => humans(room).some((m) => m.clients.size > 0);

export function place(room, p) {
  const sp = spawnPoint(rand, room.map, room.players.filter((o) => o !== p && o.placed));
  p.x = +sp.x.toFixed(3); p.z = +sp.z.toFixed(3); p.placed = true;
}

// ---------- what each client sees ----------
export function viewFor(room, member) {
  const mode = MODES[room.mode];
  return {
    code: room.code,
    you: member ? member.id : null,
    watching: !!member && room.spectators.includes(member),
    host: room.host ? room.host.id : null,
    mode: room.mode,
    started: room.started,
    over: room.over,
    seed: room.seed,
    map: room.mapSize || 'small',
    round: room.round,
    players: room.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, x: p.x, z: p.z, score: p.score,
      yaw: p.yaw, pitch: p.pitch, cpu: !!p.cpu, online: !!p.cpu || p.clients.size > 0,
      ...(room.started && mode.playerView ? mode.playerView(room, p) : {}),
    })),
    spectators: room.spectators.map((s) => ({ id: s.id, name: s.name, color: s.color, online: s.clients.size > 0 })),
    ...(room.started && mode.view ? mode.view(room, member) : {}),
  };
}

export function send(res, event, data) { res.write((event ? `event: ${event}\n` : '') + `data: ${JSON.stringify(data)}\n\n`); }

export function broadcast(room) {
  for (const m of members(room)) for (const res of m.clients) send(res, null, viewFor(room, m));
}

// The same named event to everyone in the room (encoded once).
export function broadcastEvent(room, event, data) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const m of members(room)) for (const res of m.clients) res.write(line);
}

export function broadcastSay(room, p, what) { broadcastEvent(room, 'say', { id: p.id, ...what }); }

// setTimeout that doesn't keep the process alive and logs instead of crashing.
export function later(ms, what, fn) {
  const t = setTimeout(() => { try { fn(); } catch (e) { console.error(`${what} failed:`, e); } }, ms);
  if (t.unref) t.unref();
  return t;
}
