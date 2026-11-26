// Realtime mode on the server, driven tick by tick with a fake clock. Run with: node --test
import test from 'node:test';
import assert from 'node:assert';
const { actions, rooms, findMember } = await import('../server.js');
const rtMode = await import('../modes/realtime/index.js');
const { clock, tick, stopTick } = rtMode;
const { CARRY_MAX, THROW_COOLDOWN_MS, THROW_POWER, TICK_MS } = await import('../public/shared/realtimeRules.js');
const { WIN_SCORE } = await import('../public/shared/physics.js');

let T = 1e6;
clock.now = () => T;
const EMPTY = { walls: [], trees: [], deco: [] };

const act = (name, code, token, body = {}) => {
  const { room, member } = findMember(code, token);
  return actions[name](body, room, member);
};
// A started realtime game with an empty map, a at (0, 0) facing +z and b 6 m in front.
function game(n = 2) {
  const host = actions.create({ name: 'Ann' });
  const joined = [host];
  for (let i = 1; i < n; i++) joined.push(actions.join({ code: host.code, name: 'P' + i }));
  act('setMode', host.code, host.token, { mode: 'realtime' });
  act('start', host.code, host.token);
  const room = rooms.get(host.code);
  room.map = EMPTY;
  room.rt.balls = [];
  room.rt.respawns = [];
  const [a, b] = room.players;
  a.x = 0; a.z = 0; b.x = 0; b.z = 6;
  for (const p of room.players) p.shieldUntil = 0;
  return { room, code: host.code, tok: joined.map((j) => j.token), a, b };
}
const run = (room, ms) => { for (let t = 0; t < ms; t += TICK_MS) { T += TICK_MS; tick(room, T); } };

// Throw from a at b (6 m in front) at this angle, then let the ball land. Returns whether b was hit.
function throwAt(g, pitch) {
  const { room, code, tok, a, b } = g;
  a.ammo = 1; a.coolUntil = 0; a.x = 0; a.z = 0; b.x = 0; b.z = 6;
  const before = a.score;
  act('throw', code, tok[0], { yaw: 0, pitch });
  run(room, 3000);
  return a.score > before;
}
function findHit(g) {
  for (let pitch = 0.08; pitch <= 1; pitch += 0.01) if (throwAt(g, pitch)) return pitch;
  return null;
}

test('positions: a normal step is taken, too far or through a wall snaps you back', () => {
  const { room, code, tok, a } = game();
  a.lastIn = T - 100;
  act('input', code, tok[0], { x: 0.5, z: 0, yaw: 1, pitch: 0.4 });
  assert.deepStrictEqual([a.x, a.z, a.yaw], [0.5, 0, 1]);
  const fix = a.fix;
  T += 50;
  act('input', code, tok[0], { x: 5, z: 0, yaw: 1, pitch: 0.4 });
  assert.strictEqual(a.x, 0.5, 'too fast: refused');
  assert.strictEqual(a.fix, fix + 1, 'told to snap back');
  T += 10;
  act('input', code, tok[0], { x: 0.6, z: 0, yaw: 1, pitch: 0.4 });
  assert.strictEqual(a.x, 0.5, 'more than ~30 reports a second are dropped');
  room.map = { walls: [{ x: 0, z: 3, w: 6, h: 1.5, d: 0.7, ry: 0 }], trees: [], deco: [] };
  a.x = 0; a.z = 0; T += 1000;
  act('input', code, tok[0], { x: 0, z: 6, yaw: 0, pitch: 0.4 });
  assert.strictEqual(a.z, 0, 'no walking through walls');
  assert.throws(() => act('input', code, tok[0], { x: 'a', z: 0, yaw: 0, pitch: 0 }), /Bad input/);
  stopTick(room);
});

test('pick up snowballs you walk over, up to 3', () => {
  const { room, a } = game();
  a.ammo = 0;
  for (let i = 0; i < CARRY_MAX + 1; i++) {
    room.rt.balls.push({ id: 100 + i, x: a.x + 0.3, z: a.z });
    run(room, TICK_MS);
  }
  assert.strictEqual(a.ammo, CARRY_MAX);
  assert.strictEqual(room.rt.balls.length, 1, 'the fourth stays on the snow');
  assert.strictEqual(room.rt.respawns.length, CARRY_MAX, 'picked ones come back later');
  room.rt.balls = [];
  run(room, 5100);
  assert.ok(room.rt.balls.length >= 1, 'and they did');
  stopTick(room);
});

test('throwing needs a snowball, always goes at the same speed, and respects the cooldown', () => {
  const { room, code, tok, a } = game();
  a.ammo = 0;
  assert.throws(() => act('throw', code, tok[0], { yaw: 0, pitch: 0.4 }), /No snowballs/);
  a.ammo = 2;
  act('throw', code, tok[0], { yaw: 0, pitch: 0.4, power: 1 });
  assert.strictEqual(a.ammo, 1);
  assert.strictEqual(room.rt.flying[0].power, THROW_POWER, 'a power sent by the browser is ignored');
  T += 200;
  assert.throws(() => act('throw', code, tok[0], { yaw: 0, pitch: 0.4 }), /Too fast/);
  T += THROW_COOLDOWN_MS;
  act('throw', code, tok[0], { yaw: 0, pitch: 0.4 });
  assert.strictEqual(a.ammo, 0);
  assert.throws(() => act('throw', code, tok[0], { yaw: 'x', pitch: 0.4 }), /Bad throw/);
  stopTick(room);
});

test('the server decides hits: from where it has you, against where people stand now; no respawning', () => {
  const g = game();
  const { room, code, tok, a, b } = g;
  // a forged launch spot is ignored
  a.ammo = 1; a.coolUntil = 0;
  act('throw', code, tok[0], { yaw: 0, pitch: 0.3, x: 50, z: 50 });
  assert.deepStrictEqual(room.rt.flying[0].from, { x: 0, z: 0 });
  run(room, 3000);
  const pitch = findHit(g);
  assert.ok(pitch != null, 'some angle hits');
  assert.deepStrictEqual([b.x, b.z], [0, 6], 'the victim stays where they were hit');
  assert.ok(b.shieldUntil > T - 3000, 'and is protected for a moment');
  // a protected player isn't hit by the same throw
  const score = a.score;
  b.shieldUntil = T + 1e6;
  throwAt(g, pitch);
  assert.strictEqual(a.score, score);
  b.shieldUntil = 0;
  // someone who walks out of the way in time isn't hit either
  a.ammo = 1; a.coolUntil = 0; a.x = 0; a.z = 0; b.x = 0; b.z = 6;
  act('throw', code, tok[0], { yaw: 0, pitch });
  b.x = 4;
  run(room, 3000);
  assert.strictEqual(a.score, score);
  stopTick(room);
});

test('reaching the winning score ends the round; again resets it', () => {
  const g = game();
  const { room, code, tok, a } = g;
  a.score = WIN_SCORE - 1;
  assert.ok(findHit(g) != null);
  assert.deepStrictEqual(room.over, { winner: a.id });
  assert.throws(() => act('throw', code, tok[0], { yaw: 0, pitch: 0.4 }), /over/);
  act('again', code, tok[0]);
  assert.strictEqual(room.over, null);
  assert.ok(room.players.every((p) => p.score === 0 && p.ammo === 0));
  assert.ok(room.rt.balls.length >= 3);
  stopTick(room);
});

test('spectators cannot move or throw', () => {
  const host = actions.create({ name: 'Watcher' });
  act('spectate', host.code, host.token);
  act('addBot', host.code, host.token); act('addBot', host.code, host.token);
  act('setMode', host.code, host.token, { mode: 'realtime' });
  act('start', host.code, host.token);
  assert.throws(() => act('input', host.code, host.token, { x: 0, z: 0, yaw: 0, pitch: 0.5 }), /watching/);
  assert.throws(() => act('throw', host.code, host.token, { yaw: 0, pitch: 0.4 }), /watching/);
  stopTick(rooms.get(host.code));
});

test('bots pick up, throw and play a game to the end; they pause while nobody watches', () => {
  const host = actions.create({ name: 'Watcher' });
  act('spectate', host.code, host.token);
  for (let i = 0; i < 4; i++) act('addBot', host.code, host.token);
  act('setMode', host.code, host.token, { mode: 'realtime' });
  act('start', host.code, host.token);
  const room = rooms.get(host.code);
  assert.strictEqual(room.rt.timer, null, 'no one has the room open: no ticking');
  const res = { write() {}, end() {} };
  room.spectators[0].clients.add(res);
  rtMode.default.wake(room);
  assert.ok(room.rt.timer, 'someone opened it: ticking');
  stopTick(room);
  let threw = 0;
  for (let i = 0; i < 20 * 60 * 30 && !room.over; i++) {
    const before = room.rt.throwN;
    T += TICK_MS; tick(room, T);
    threw += room.rt.throwN - before;
  }
  assert.ok(threw > 10, `bots threw ${threw} snowballs`);
  assert.ok(room.over, 'someone won within 20 minutes');
  const w = room.players.find((p) => p.id === room.over.winner);
  assert.ok(w.score >= WIN_SCORE);
  for (const p of room.players) assert.ok(p.ammo >= 0 && p.ammo <= CARRY_MAX);
  room.spectators[0].clients.clear();
});

test('sprinting allows a faster step, but no throwing until you stop', () => {
  const { room, code, tok, a } = game();
  a.ammo = 2; a.coolUntil = 0;
  a.lastIn = T - 100;
  // 1.3 m in 0.1 s: too far for running (up to 1.05 m with slack), fine for sprinting (up to 1.5 m)
  act('input', code, tok[0], { x: 1.3, z: 0, yaw: 0, pitch: 0.4 });
  assert.strictEqual(a.x, 0, 'too fast without sprint');
  a.lastIn = T - 100;
  act('input', code, tok[0], { x: 1.3, z: 0, yaw: 0, pitch: 0.4, sprint: true });
  assert.strictEqual(a.x, 1.3, 'fine while sprinting');
  assert.throws(() => act('throw', code, tok[0], { yaw: 0, pitch: 0.4 }), /sprinting/);
  T += 100;
  act('input', code, tok[0], { x: 1.6, z: 0, yaw: 0, pitch: 0.4, sprint: false });
  act('throw', code, tok[0], { yaw: 0, pitch: 0.4 });
  assert.strictEqual(a.ammo, 1);
  assert.strictEqual(a.sprinting, false);
  stopTick(room);
});
