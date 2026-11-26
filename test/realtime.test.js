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

test('a pile gives you as many as you can carry and leaves the rest', () => {
  const { room, a, b } = game();
  a.ammo = 2; b.x = 20; b.z = 20;
  room.rt.balls.push({ id: 500, x: a.x + 0.3, z: a.z, n: 3 });
  run(room, TICK_MS);
  assert.strictEqual(a.ammo, 3, 'took one, hands full');
  assert.strictEqual(room.rt.balls.find((p) => p.id === 500).n, 2, 'two left in the pile');
  a.ammo = 0;
  run(room, TICK_MS);
  assert.strictEqual(a.ammo, 2, 'took the other two');
  assert.ok(!room.rt.balls.some((p) => p.id === 500), 'the empty pile is gone');
  assert.strictEqual(room.rt.respawns.length, 1, 'and comes back somewhere else');
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

// ---------- bot path finding (modes/realtime/nav.js) ----------
const nav = await import('../modes/realtime/nav.js');
const { makeMap, standOk: canStand } = await import('../public/shared/physics.js');
const { pathClear } = await import('../public/shared/realtimeRules.js');

test('the walk grid matches standOk exactly, and paths go round walls and through fort gates', () => {
  const big = makeMap(4242, 'large'), grid = nav.buildNav(big);
  for (let i = 0; i < grid.walk.length; i += 7) {
    const x = grid.o + (i % grid.n) + 0.5, z = grid.o + Math.floor(i / grid.n) + 0.5;
    assert.strictEqual(!!grid.walk[i], canStand(x, z, big, []), `square ${i}`);
  }
  // from outside the central fort to its middle: the route must go through a gate, so it's longer than straight
  const f = big.forts[0], c = Math.cos(f.rot), s = Math.sin(f.rot);
  const outside = { x: (f.half + 3) * c - (f.half - 1.5) * s, z: (f.half + 3) * s + (f.half - 1.5) * c }; // beside a wall, next to a corner
  const route = nav.findPath(grid, outside, { x: 0, z: 0 });
  assert.ok(route, 'there is a way in');
  assert.ok(route.dist > Math.hypot(outside.x, outside.z) + 1, 'not straight through the wall');
  let at = outside;
  for (const p of route.pts) { assert.ok(pathClear(at, p, big), 'every leg is walkable by the movement rules'); at = p; }
});

test('bots choose the snowball nearest on foot, not the one behind a wall', () => {
  const map = { walls: [{ x: 0, z: 2, w: 30, h: 1.5, d: 0.7, ry: 0 }], trees: [], deco: [], size: 30 };
  const grid = nav.buildNav(map);
  const near = { id: 1, x: 0, z: 4 };   // 4 m away, but behind a 30 m wall
  const far = { id: 2, x: 9, z: -2 };   // 9 m away, on our side
  const r = nav.nearestBallPath(grid, { x: 0, z: 0 }, [near, far]);
  assert.strictEqual(r.ball.id, 2);
});

test('bots in a fort map keep moving: little time stuck, and a game still finishes', () => {
  const host = actions.create({ name: 'W' });
  act('spectate', host.code, host.token);
  act('addBot', host.code, host.token, { count: 6 });
  act('setMode', host.code, host.token, { mode: 'realtime' });
  act('start', host.code, host.token);
  const room = rooms.get(host.code);
  const last = new Map();
  let windows = 0, stuckN = 0;
  for (let i = 0; i < 30 * 120 && !room.over; i++) {
    T += TICK_MS; tick(room, T);
    if (i % 90) continue;
    for (const b of room.players) {
      const p = last.get(b.id); last.set(b.id, { x: b.x, z: b.z, aim: b.ai && b.ai.state === 'aim' });
      if (!p || p.aim || (b.ai && b.ai.state === 'aim') || T < b.shieldUntil) continue;
      windows++; if (Math.hypot(b.x - p.x, b.z - p.z) < 3) stuckN++;
    }
  }
  assert.ok(room.over, 'someone won within 2 minutes');
  assert.ok(stuckN / Math.max(1, windows) < 0.2, `stuck ${stuckN} of ${windows} walking windows`);
  stopTick(room);
});

test('path search: settles every square once and finds far snowballs; shortcuts respect the collision rules', () => {
  // review of #42: Float32 costs could re-queue squares forever and run out of budget on long searches
  const empty = { walls: [], trees: [], deco: [], snowmen: [], size: 30 };
  const g = nav.buildNav(empty);
  assert.ok(nav.nearestBallPath(g, { x: -25, z: 0 }, [{ id: 1, x: 25, z: 0 }]), 'a snowball 50 m away is found');
  const big = makeMap(77, 'large'), gb = nav.buildNav(big);
  const far = nav.findPath(gb, { x: -40, z: -40 }, { x: 40, z: 40 });
  assert.ok(far, 'a route corner to corner across the big map');
  // review of #42: a shortcut the grid allowed could clip a tree the movement rules block
  const treeMap = { walls: [], trees: [{ x: 0, z: 0, s: 1 }], deco: [], snowmen: [], size: 30 };
  const gt = nav.buildNav(treeMap);
  assert.strictEqual(nav.segmentClear(gt, { x: 1.05, z: -2 }, { x: 1.05, z: 2 }), false, 'too close to the tree');
  assert.strictEqual(pathClear({ x: 1.05, z: -2 }, { x: 1.05, z: 2 }, treeMap), false);
  const round = nav.findPath(gt, { x: 1.05, z: -3 }, { x: 1.05, z: 3 });
  let at = { x: 1.05, z: -3 };
  for (const p of round.pts) { assert.ok(pathClear(at, p, treeMap), 'the route goes round the tree'); at = p; }
});
