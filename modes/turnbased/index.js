// Turn-based mode: one player at a time walks up to 5 m, then throws (or packs a heavy snowball).
// The server decides every throw's result; browsers only replay it.
import {
  TAU, PITCH_MIN, PITCH_MAX, HIT_POINTS, HEAVY_MULT, PACK_MS, TURN_LIMIT,
  clamp, simulate, windFor, throwShowMs, clampMove, standOk,
} from '../../public/shared/physics.js';
import { rand, place, broadcast, broadcastEvent, broadcastSay, later } from '../../rooms.js';
import { botTurn } from './bots.js';
import { checkWinner } from '../../public/shared/win.js';

const BOT_DELAY = Number(process.env.BOT_DELAY_MS ?? 1500); // pause before a bot throws, so people can follow along

export const curPlayer = (room) => room.players[room.cur] || null;
export const nextPlayer = (room) => room.players.length > 1 ? room.players[(room.cur + 1) % room.players.length] : null;

function clearTimers(room) {
  clearTimeout(room.clock); clearTimeout(room.botTimer);
  room.clock = room.botTimer = null;
}

// A timed round ends on the scores when the clock runs out: one leader wins; a tie is sudden death (the next throw
// that leaves one player leading alone wins). Called by a timer at the deadline and before any throw or pack, so
// nothing done after time is up can change the result. Returns true if the round is over. Any change it makes is
// broadcast right here: the request that noticed the deadline may be refused ("Time's up!"), and a refused request
// doesn't broadcast, so without this everyone would be left on the game screen.
export function resolveClock(room) {
  if (room.over) return true;
  if (!room.endsAt || room.suddenDeath || Date.now() < room.endsAt) return false;
  const result = checkWinner(room.players, room.win, room.endsAt, Date.now());
  if (result && result.winner) {
    room.over = { winner: result.winner.id, reason: 'time' };
    clearTimers(room); clearTimeout(room.endTimer); room.turnEnds = null;
    broadcast(room);
    return true;
  }
  if (result && result.suddenDeath) { room.suddenDeath = true; broadcast(room); }
  return false;
}

// Called when a round's clock starts: end the round right at the deadline, not at the next throw.
function scheduleEnd(room) {
  clearTimeout(room.endTimer); room.endTimer = null;
  if (!room.endsAt) return;
  room.endTimer = later(Math.max(0, room.endsAt - Date.now()) + 10, `Round clock in room ${room.code}`, () => {
    if (room.started && !room.over) resolveClock(room); // broadcasts what it decides
  });
}

function startTurn(room) {
  clearTimers(room);
  room.turnEnds = null;
  if (!room.started || room.over || !room.players.length) return;
  if (resolveClock(room)) return; // time ran out: no new turn
  const p = curPlayer(room);
  room.phase = 'move';
  const wait = Math.max(0, room.busyUntil - Date.now());
  room.turnEnds = Date.now() + wait + TURN_LIMIT * 1000;
  // Out of time: throw for them where they were aiming, with a random power.
  room.clock = later(room.turnEnds - Date.now(), `Turn timer in room ${room.code}`, () => {
    if (curPlayer(room) === p && !room.over) doThrow(room, p, p.yaw, p.pitch, 0.35 + rand() * 0.4);
    broadcast(room);
  });
  if (p.cpu) room.botTimer = later(wait + BOT_DELAY, `Bot ${p.name} in room ${room.code}`, () => botTurn(room, p, game));
}

// Throw a snowball for player p. Decides the result, scores it, moves a hit player, and moves on to the next turn.
function doThrow(room, p, yaw, pitch, power) {
  if (resolveClock(room)) return; // time ran out before this throw (e.g. the turn timer's throw): it doesn't count
  const wind = windFor(room.seed, room.turn);
  const targets = room.players.filter((o) => o !== p).map((o) => ({ id: o.id, x: o.x, z: o.z }));
  const heavy = p.heavy || 1;
  const sim = simulate(p, yaw, pitch, power, wind, targets, room.map, 1200, null, heavy);
  const victim = sim.hit ? room.players.find((o) => o.id === sim.hit) : null;
  p.yaw = yaw; p.pitch = pitch;
  room.lastThrow = {
    n: ++room.throwN, by: p.id, turn: room.turn, yaw, pitch, power, x: p.x, z: p.z,
    heavy, hit: victim ? victim.id : null, part: victim ? sim.part : null, steps: sim.n - 1, from: victim ? { x: victim.x, z: victim.z } : null,
  };
  room.busyUntil = Date.now() + throwShowMs(sim.n - 1, victim ? sim.part : null);
  p.heavy = 1;
  if (victim) {
    p.score += HIT_POINTS[sim.part] * heavy;
    victim.heavy = 1; // dropped it
    place(room, victim);
    if (p.cpu && rand() < 0.6) broadcastSay(room, p, { emote: 'cheer' });
    if (victim.cpu && rand() < 0.5) broadcastSay(room, victim, { line: 3 });
  }
  room.lastActive = Date.now();
  // points: first to the target. Timed: only sudden death is decided by a throw (the clock itself is resolveClock's)
  const result = room.win && room.win.type === 'time'
    ? (room.suddenDeath ? checkWinner(room.players, room.win, room.endsAt, Infinity) : null)
    : checkWinner(room.players, room.win, room.endsAt, Date.now());
  if (result && result.winner) {
    room.over = { winner: result.winner.id, reason: result.reason };
    clearTimeout(room.endTimer);
    clearTimers(room); room.turnEnds = null;
    return;
  }
  nextTurn(room);
}

function nextTurn(room) {
  room.cur = (room.cur + 1) % room.players.length;
  room.turn += 1;
  startTurn(room);
}

// Spend the turn packing a heavy snowball: your next hit counts triple.
function doPack(room, p) {
  if (resolveClock(room)) throw new Error("Time's up!");
  if ((p.heavy || 1) > 1) throw new Error('You already have a heavy snowball. Throw it first');
  p.heavy = HEAVY_MULT;
  room.lastPack = { n: ++room.packN, by: p.id, heavy: p.heavy };
  room.busyUntil = Date.now() + PACK_MS;
  room.lastActive = Date.now();
  nextTurn(room);
}

const game = { curPlayer, nextPlayer, doThrow, doPack, broadcast, broadcastEvent };

function toYaw(v) { return typeof v === 'number' && Number.isFinite(v) ? ((v % TAU) + TAU) % TAU : 0; }
function toPitch(v) { return typeof v === 'number' && Number.isFinite(v) ? clamp(v, PITCH_MIN, PITCH_MAX) : 0.6; }

function requireTurn(room, member) {
  if (!room.started) throw new Error('The game has not started');
  if (room.over) throw new Error('The round is over');
  if (resolveClock(room)) throw new Error("Time's up!"); // the clock ran out just now: the scores at that moment decide it
  if (curPlayer(room) !== member) throw new Error('It is not your turn');
}

export default {
  name: 'turn',

  newPlayer(p) { p.heavy = 1; p.aimAt = 0; },

  start(room) {
    room.cur = rand() * room.players.length | 0;
    room.turn = 0; room.busyUntil = 0; room.throwN = room.throwN || 0; room.packN = room.packN || 0;
    room.lastThrow = null; room.lastPack = null;
    for (const p of room.players) p.heavy = 1;
    startTurn(room);
  },

  again(room) {
    for (const p of room.players) p.heavy = 1;
    room.cur = rand() * room.players.length | 0;
    room.turn += 1;
    room.busyUntil = Math.max(room.busyUntil, Date.now());
    startTurn(room);
  },

  stop(room) { clearTimers(room); clearTimeout(room.endTimer); room.endTimer = null; },

  // the round's clock just started (server.js startClock)
  clockStarted: scheduleEnd,

  // Someone joined a game in progress: they get a spot and wait for their turn.
  join(room, p) { place(room, p); },

  // A seated player left (already taken out of room.players; i is where they sat).
  remove(room, _p, i) {
    if (room.over || !room.players.length) return;
    const wasCurrent = i === room.cur;
    if (i < room.cur) room.cur -= 1;
    room.cur %= room.players.length;
    if (wasCurrent) startTurn(room);
  },

  view(room) {
    const now = Date.now(), cur = curPlayer(room), next = nextPlayer(room);
    return {
      turn: room.turn,
      cur: cur ? cur.id : null,
      next: next ? next.id : null,
      phase: room.phase,
      turnLeft: room.turnEnds ? Math.max(0, room.turnEnds - now) : null,
      busyLeft: Math.max(0, room.busyUntil - now),
      lastThrow: room.lastThrow,
      lastPack: room.lastPack,
    };
  },

  playerView(_room, p) { return { heavy: p.heavy || 1 }; },

  actions: {
    // Where the current player is aiming, so everyone sees them turn. Sent often; answered with a light event.
    aim({ yaw, pitch }, room, member) {
      if (curPlayer(room) !== member) return 'quiet';
      const now = Date.now();
      if (now - member.aimAt < 50) return 'quiet';
      member.aimAt = now;
      member.yaw = toYaw(yaw); member.pitch = toPitch(pitch);
      broadcastEvent(room, 'aim', { id: member.id, yaw: member.yaw, pitch: member.pitch });
      return 'quiet';
    },

    // Walk somewhere inside your move ring, once per turn, before throwing. Moving is optional.
    move({ x, z }, room, member) {
      requireTurn(room, member);
      if (room.phase !== 'move') throw new Error('You have already moved this turn');
      if (Date.now() < room.busyUntil - 150) throw new Error('Wait for the last snowball to land');
      if (![x, z].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('Bad move');
      const to = clampMove(member, { x, z });
      if (!standOk(to.x, to.z, room.map, room.players.filter((o) => o !== member))) throw new Error("You can't stand there");
      member.x = +to.x.toFixed(3); member.z = +to.z.toFixed(3);
      room.phase = 'aim';
    },

    pack(_body, room, member) {
      requireTurn(room, member);
      if (Date.now() < room.busyUntil - 150) throw new Error('Wait for the last snowball to land');
      doPack(room, member);
    },

    throw({ yaw, pitch, power }, room, member) {
      requireTurn(room, member);
      if (Date.now() < room.busyUntil - 150) throw new Error('Wait for the last snowball to land');
      if (![yaw, pitch, power].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('Bad throw');
      doThrow(room, member, toYaw(yaw), toPitch(pitch), clamp(power, 0, 1));
    },
  },
};
