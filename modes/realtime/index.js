// Realtime mode: everyone runs around at once, picks snowballs up off the snow (carry up to 3) and throws whenever
// they like. The server is the authority on everything that scores: it owns ammo, pickups, cooldowns and shields,
// steps every snowball in flight against where players stand right now, and decides each hit. Browsers report
// where they are (checked for speed and walls) and ask to throw; they only draw what the server sends back.
import { TAU, PITCH_MIN, PITCH_MAX, WIN_SCORE, HIT_POINTS, clamp } from '../../public/shared/physics.js';
import {
  RUN_SPEED, SPRINT_SPEED, TICK_MS, SEND_MS, CARRY_MAX, PICKUP_R, BALL_RESPAWN_MS, THROW_COOLDOWN_MS, THROW_POWER, SHIELD_MS,
  pilesOnMap, pileSize, pathClear, ballSpot, newBall, stepBall,
} from '../../public/shared/realtimeRules.js';
import { rand, place, broadcast, broadcastEvent, broadcastSay, humanWatching } from '../../rooms.js';
import { botStep, PLANS_PER_TICK } from './bots.js';

// The server's clock; tests swap it for a fake one.
export const clock = { now: () => Date.now() };

const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

function freshState(room) {
  room.rt = { balls: [], ballN: 0, respawns: [], flying: [], throwN: room.rt ? room.rt.throwN : 0, events: [], timer: null, last: clock.now(), lastSend: 0 };
}

function resetPlayer(p, now) {
  p.ammo = 0; p.coolUntil = 0; p.chargeAt = 0; p.lastIn = 0; p.vx = 0; p.vz = 0; p.ai = null; p.sprinting = false;
  p.shieldUntil = now + SHIELD_MS; p.fix = (p.fix || 0) + 1;
}

function addBall(room) {
  const rt = room.rt, at = ballSpot(rand, room.map, room.players, rt.balls);
  rt.balls.push({ id: ++rt.ballN, x: round2(at.x), z: round2(at.z), n: pileSize(rand) });
}

function startRound(room) {
  const now = clock.now();
  stopTick(room);
  freshState(room);
  for (const p of room.players) resetPlayer(p, now);
  for (let i = pilesOnMap(room.players.length, room.map); i > 0; i--) addBall(room);
  ensureTick(room);
}

// ---------- the tick ----------
export function ensureTick(room) {
  const rt = room.rt;
  if (!rt || rt.timer || !room.started || room.over || !humanWatching(room)) return;
  rt.last = clock.now();
  rt.timer = setInterval(() => {
    try {
      // bots pause while nobody has the room open
      if (!humanWatching(room) || room.over || !room.started) { stopTick(room); return; }
      tick(room, clock.now());
    } catch (e) { console.error(`Realtime tick in room ${room.code} failed:`, e); }
  }, TICK_MS);
  if (rt.timer.unref) rt.timer.unref();
}

export function stopTick(room) {
  if (room.rt && room.rt.timer) { clearInterval(room.rt.timer); room.rt.timer = null; }
}

// One step of the game: bots, pickups, snowballs coming back, flying snowballs and hits, then send.
export function tick(room, now) {
  const rt = room.rt;
  if (!rt || !room.started || room.over) return;
  const dt = clamp((now - rt.last) / 1000, 0, 0.1);
  rt.last = now;

  rt.plansLeft = PLANS_PER_TICK;
  for (const p of room.players) if (p.cpu) botStep(room, p, dt, now, game);

  // pick up snowballs you walk over: as many from the pile as you can carry; the rest stay for someone else
  for (const p of room.players) {
    if (p.ammo >= CARRY_MAX) continue;
    const i = rt.balls.findIndex((b) => Math.hypot(b.x - p.x, b.z - p.z) < PICKUP_R);
    if (i < 0) continue;
    const pile = rt.balls[i], take = Math.min(pile.n || 1, CARRY_MAX - p.ammo);
    p.ammo += take;
    pile.n = (pile.n || 1) - take;
    if (pile.n <= 0) { rt.balls.splice(i, 1); rt.respawns.push(now + BALL_RESPAWN_MS); }
    rt.events.push({ t: 'pick', by: p.id, n: take });
  }
  // and they come back somewhere else
  while (rt.respawns.length && rt.respawns[0] <= now) {
    rt.respawns.shift();
    if (rt.balls.length < pilesOnMap(room.players.length, room.map)) addBall(room);
  }

  // snowballs in flight, checked against where everyone stands now
  for (let i = rt.flying.length - 1; i >= 0; i--) {
    const b = rt.flying[i];
    const targets = room.players.filter((o) => o.id !== b.by && now >= o.shieldUntil).map((o) => ({ id: o.id, x: o.x, z: o.z }));
    const res = stepBall(b, dt, room.map, targets);
    if (!res) continue;
    rt.flying.splice(i, 1);
    const end = { t: 'end', n: b.n, steps: b.steps, kind: res.kind, hit: null, part: null, x: round3(b.x), y: round3(b.y), z: round3(b.z) };
    const thrower = room.players.find((o) => o.id === b.by);
    const victim = res.hit ? room.players.find((o) => o.id === res.hit) : null;
    if (victim) {
      end.hit = victim.id; end.part = res.part;
      if (thrower) thrower.score += HIT_POINTS[res.part];
      // the victim stays where they are, protected for a moment so they can't be hit again straight away
      victim.shieldUntil = now + SHIELD_MS; victim.chargeAt = 0;
      if (thrower && thrower.cpu && rand() < 0.3) broadcastSay(room, thrower, { emote: 'cheer' });
      if (victim.cpu && rand() < 0.25) broadcastSay(room, victim, { line: 3 });
    }
    rt.events.push(end);
  }

  const winner = room.players.find((p) => p.score >= WIN_SCORE);
  if (winner) {
    room.over = { winner: winner.id };
    stopTick(room);
    sendState(room, now);
    broadcast(room);
    return;
  }
  if (now - rt.lastSend >= SEND_MS - 1 || rt.events.length) sendState(room, now);
}

// Positions, ammo and scores for everyone, the loose snowballs, and what happened since the last send.
export function snapshot(room, now = clock.now()) {
  const rt = room.rt;
  return {
    t: now,
    p: room.players.map((p) => [p.id, round2(p.x), round2(p.z), round3(p.yaw), round3(p.pitch), p.ammo, p.score, p.fix,
      now < p.shieldUntil ? 1 : 0, p.chargeAt ? 1 : 0]),
    b: rt.balls.map((b) => [b.id, b.x, b.z, b.n || 1]),
    e: rt.events,
  };
}

function sendState(room, now) {
  const rt = room.rt;
  rt.lastSend = now;
  broadcastEvent(room, 'rt', snapshot(room, now));
  rt.events = [];
}

// Throw one of p's snowballs from where the server has them. Used by people and bots alike.
function throwBall(room, p, yaw, pitch, now) {
  const power = THROW_POWER;
  const rt = room.rt;
  if (p.ammo <= 0) throw new Error('No snowballs. Pick some up');
  if (now < p.coolUntil) throw new Error('Too fast');
  const b = newBall(++rt.throwN, p.id, p, yaw, pitch, power);
  rt.flying.push(b);
  p.ammo -= 1; p.coolUntil = now + THROW_COOLDOWN_MS; p.chargeAt = 0;
  p.yaw = yaw; p.pitch = pitch;
  rt.events.push({ t: 'throw', n: b.n, by: p.id, x: round3(p.x), z: round3(p.z), yaw: round3(yaw), pitch: round3(pitch), power: round3(power) });
  room.lastActive = Date.now();
  return b;
}

const game = { throwBall, rand };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const toYaw = (v) => ((v % TAU) + TAU) % TAU;
const toPitch = (v) => clamp(v, PITCH_MIN, PITCH_MAX);

function requirePlaying(room) {
  if (!room.started) throw new Error('The game has not started');
  if (room.over) throw new Error('The round is over');
}

export default {
  name: 'realtime',

  newPlayer(p) { resetPlayer(p, 0); p.fix = 0; },

  start: startRound,
  again: startRound,
  stop: stopTick,

  // A browser opened the room again: start ticking if it had paused.
  wake: ensureTick,

  // Someone joined a game in progress: drop them in with no snowballs and a moment's protection.
  join(room, p) {
    place(room, p);
    resetPlayer(p, clock.now());
    if (room.rt && room.rt.balls.length < pilesOnMap(room.players.length, room.map)) addBall(room);
  },

  remove(room) {
    if (room.players.length && room.rt) room.rt.flying = room.rt.flying.filter((b) => room.players.some((p) => p.id === b.by));
  },

  view(room) { return { rt: room.rt ? { ...snapshot(room), e: [] } : null }; },

  playerView(_room, p) { return { ammo: p.ammo }; },

  actions: {
    // Where you are, where you're looking and whether you're sprinting, about 20 times a second. Too far for the
    // time since the last report (sprinting allows more), or through a wall, and the server keeps your old spot
    // and tells you to snap back (`fix`). While you're sprinting you can't throw.
    input({ x, z, yaw, pitch, sprint }, room, member) {
      requirePlaying(room);
      if (![x, z, yaw, pitch].every(isNum)) throw new Error('Bad input');
      const now = clock.now();
      if (now - member.lastIn < 30) return 'quiet'; // more than ~30 a second is dropped
      const elapsed = Math.min(1000, now - member.lastIn) / 1000;
      member.lastIn = now;
      member.yaw = toYaw(yaw); member.pitch = toPitch(pitch);
      member.sprinting = sprint === true;
      const to = { x: round3(x), z: round3(z) };
      const d = Math.hypot(to.x - member.x, to.z - member.z);
      const speed = member.sprinting ? SPRINT_SPEED : RUN_SPEED;
      if (d > speed * elapsed * 1.25 + 0.3 || !pathClear(member, to, room.map)) { member.fix += 1; return 'quiet'; }
      member.vx = (to.x - member.x) / elapsed; member.vz = (to.z - member.z) / elapsed;
      member.x = to.x; member.z = to.z;
      return 'quiet';
    },

    // Throw from where the server has you. Only the direction comes from the browser: every throw goes at the
    // same speed, so the angle sets the distance.
    throw({ yaw, pitch }, room, member) {
      requirePlaying(room);
      if (![yaw, pitch].every(isNum)) throw new Error('Bad throw');
      if (member.sprinting) throw new Error("Can't throw while sprinting");
      throwBall(room, member, toYaw(yaw), toPitch(pitch), clock.now());
      return 'quiet';
    },
  },
};
