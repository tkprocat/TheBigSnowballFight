// Shared game physics (public/physics.js). Run with: node --test
import test from 'node:test';
import assert from 'node:assert';
import {
  simulate, windFor, makeMap, spawnPoint, planThrow, obstacleHit, mulberry32, throwShowMs,
  BALL_R, PITCH_MIN, PITCH_MAX, ARENA, HIT_POINTS, MOVE_RADIUS, clampMove, standOk, lineBlocked, chooseCover,
} from '../public/shared/physics.js';

const EMPTY = { walls: [], trees: [], deco: [] };
const CALM = { x: 0, z: 0 };

test('a throw is deterministic: same inputs, same path', () => {
  const map = makeMap(1234);
  const a = simulate({ x: 1, z: 2 }, 0.4, 0.6, 0.7, windFor(9, 3), [], map);
  const b = simulate({ x: 1, z: 2 }, 0.4, 0.6, 0.7, windFor(9, 3), [], map);
  assert.strictEqual(a.n, b.n);
  assert.deepStrictEqual(Array.from(a.pts.slice(0, a.n * 3)), Array.from(b.pts.slice(0, b.n * 3)));
});

test('a snowball lands on the ground, and more power goes further', () => {
  const near = simulate({ x: 0, z: 0 }, 0, 0.6, 0.2, CALM, [], EMPTY);
  const far = simulate({ x: 0, z: 0 }, 0, 0.6, 0.9, CALM, [], EMPTY);
  assert.strictEqual(near.kind, 'ground');
  assert.strictEqual(far.kind, 'ground');
  assert.ok(Math.abs(near.end.y - BALL_R) < 1e-6);
  assert.ok(far.end.z > near.end.z + 10, `${far.end.z} vs ${near.end.z}`);
  assert.ok(Math.abs(far.end.x) < 1e-9, 'no sideways drift without wind');
});

test('wind pushes the snowball sideways', () => {
  const s = simulate({ x: 0, z: 0 }, 0, 0.6, 0.6, { x: 2, z: 0 }, [], EMPTY);
  assert.ok(s.end.x > 1, `drift ${s.end.x}`);
});

test('wind is the same for everyone on a turn, and changes between turns', () => {
  assert.deepStrictEqual(windFor(42, 7), windFor(42, 7));
  const turns = new Set(Array.from({ length: 10 }, (_, t) => windFor(42, t).a.toFixed(5)));
  assert.ok(turns.size > 5);
  for (let t = 0; t < 50; t++) assert.ok(windFor(5, t).s <= 3);
});

test('hits a player standing in the way, and reports who', () => {
  const target = { id: 'bob', x: 0, z: 6 };
  let hit = null;
  for (let pw = 0; pw <= 1 && !hit; pw += 0.01) hit = simulate({ x: 0, z: 0 }, 0, 0.3, pw, CALM, [target], EMPTY).hit;
  assert.strictEqual(hit, 'bob');
  const miss = simulate({ x: 0, z: 0 }, Math.PI, 0.3, 0.5, CALM, [target], EMPTY);
  assert.strictEqual(miss.hit, null);
});

test('a snow wall blocks a throw', () => {
  const map = { walls: [{ x: 0, z: 4, w: 4, h: 1.5, d: 0.7, ry: 0 }], trees: [], deco: [] };
  assert.strictEqual(obstacleHit(0, 1, 4, map), 'wall');
  assert.strictEqual(obstacleHit(0, 2, 4, map), null);
  const s = simulate({ x: 0, z: 0 }, 0, 0.05, 0.3, CALM, [{ id: 'bob', x: 0, z: 8 }], map);
  assert.strictEqual(s.kind, 'wall');
  assert.strictEqual(s.hit, null);
});

test('stops at the step limit when replaying a throw', () => {
  const s = simulate({ x: 0, z: 0 }, 0, 0.6, 0.9, CALM, [], EMPTY, 30);
  assert.strictEqual(s.n, 31);
});

test('spawn points stay in the arena, clear of walls, trees and each other', () => {
  const map = makeMap(77), rng = mulberry32(3), placed = [];
  for (let i = 0; i < 8; i++) placed.push(spawnPoint(rng, map, placed));
  for (const p of placed) {
    assert.ok(Math.hypot(p.x, p.z) <= ARENA, 'inside the arena');
    for (const t of map.trees) assert.ok(Math.hypot(t.x - p.x, t.z - p.z) >= 2.4);
    for (const w of map.walls) assert.ok(Math.hypot(w.x - p.x, w.z - p.z) >= w.w / 2 + 1.3);
  }
});

test('a perfect computer player hits an open target, and plans stay in range', () => {
  const me = { x: 0, z: 0 }, bob = { id: 'bob', x: 3, z: 14 };
  const plan = planThrow(me, [bob], { x: 1, z: -0.5 }, EMPTY, mulberry32(1), 0);
  const s = simulate(me, plan.yaw, plan.pitch, plan.power, { x: 1, z: -0.5 }, [bob], EMPTY);
  assert.strictEqual(s.hit, 'bob');
  const rng = mulberry32(2);
  for (let i = 0; i < 5; i++) {
    const p = planThrow(me, [bob], windFor(1, i), makeMap(i), rng, 3);
    assert.ok(p.pitch >= PITCH_MIN && p.pitch <= PITCH_MAX && p.power >= 0 && p.power <= 1);
  }
});

test('show time covers the flight, and head shots get extra for the slow-motion camera', () => {
  assert.ok(throwShowMs(240, null) > 2000);
  assert.ok(throwShowMs(240, 'body') > throwShowMs(240, null));
  assert.ok(throwShowMs(240, 'head') > throwShowMs(240, 'body') + 1500);
});

test('tells a head hit from a body hit', () => {
  const target = { id: 'bob', x: 0, z: 6 };
  const parts = new Set();
  for (let pitch = 0.05; pitch < 0.6; pitch += 0.01)
    for (let pw = 0; pw <= 1; pw += 0.02) {
      const s = simulate({ x: 0, z: 0 }, 0, pitch, pw, CALM, [target], EMPTY);
      if (s.hit) {
        parts.add(s.part);
        const dy = s.end.y;
        if (s.part === 'head') assert.ok(dy > 1.2, `head hit at y=${dy}`);
      } else assert.strictEqual(s.part, null);
    }
  assert.deepStrictEqual([...parts].sort(), ['body', 'head']);
  assert.deepStrictEqual(HIT_POINTS, { head: 2, body: 1 });
});

test('moves are kept inside the 5 m ring', () => {
  assert.deepStrictEqual(clampMove({ x: 0, z: 0 }, { x: 3, z: 0 }), { x: 3, z: 0 });
  const far = clampMove({ x: 1, z: 1 }, { x: 1, z: 20 });
  assert.ok(Math.abs(Math.hypot(far.x - 1, far.z - 1) - MOVE_RADIUS) < 1e-9);
});

test('you cannot stand in a wall, a tree, on someone, or outside the arena', () => {
  const map = { walls: [{ x: 0, z: 0, w: 4, h: 1.2, d: 0.7, ry: 0 }], trees: [{ x: 10, z: 0, s: 1 }], deco: [] };
  assert.ok(!standOk(0, 0, map, []));
  assert.ok(!standOk(10.3, 0, map, []));
  assert.ok(!standOk(5, 5, map, [{ x: 5.5, z: 5 }]));
  assert.ok(!standOk(0, ARENA + 10, map, []));
  assert.ok(!standOk(NaN, 0, map, []));
  assert.ok(standOk(0, 3, map, []));
});

test('walls and other players block the line of sight', () => {
  const map = { walls: [{ x: 0, z: 5, w: 4, h: 1.5, d: 0.7, ry: 0 }], trees: [], deco: [] };
  assert.ok(lineBlocked({ x: 0, z: 0 }, { x: 0, z: 10 }, map, []));
  assert.ok(!lineBlocked({ x: 10, z: 0 }, { x: 10, z: 10 }, map, []));
  assert.ok(lineBlocked({ x: 10, z: 0 }, { x: 10, z: 10 }, map, [{ x: 10, z: 5 }]), 'hiding behind Joe works');
});

test('a computer player walks to cover from the next thrower when it can', () => {
  // a wall off to one side; stepping behind it hides the bot from the next thrower
  const map = { walls: [{ x: 3, z: -2, w: 3, h: 1.5, d: 0.7, ry: 0 }], trees: [], deco: [] };
  const bot = { x: 0, z: 0 }, jack = { x: 0, z: -15 };
  assert.ok(!lineBlocked(jack, bot, map, []), 'exposed to start with');
  const spot = chooseCover(bot, jack, map, [bot, jack], mulberry32(4));
  assert.ok(Math.hypot(spot.x, spot.z) <= MOVE_RADIUS + 1e-9);
  assert.ok(standOk(spot.x, spot.z, map, [jack]));
  assert.ok(lineBlocked(jack, spot, map, []), 'hidden behind the wall');
});

test('a heavy snowball flies a bit shorter and the wind moves it less', () => {
  const wind = { x: 2, z: 0 };
  const normal = simulate({ x: 0, z: 0 }, 0, 0.6, 0.8, wind, [], EMPTY);
  const heavy = simulate({ x: 0, z: 0 }, 0, 0.6, 0.8, wind, [], EMPTY, 1200, null, 2);
  assert.ok(heavy.end.z < normal.end.z, 'shorter');
  assert.ok(Math.abs(heavy.end.x) < Math.abs(normal.end.x) * 0.6, 'less drift');
  const again = simulate({ x: 0, z: 0 }, 0, 0.6, 0.8, wind, [], EMPTY, 1200, null, 2);
  assert.strictEqual(again.n, heavy.n, 'still deterministic');
});

// ---------- realtime rules (public/shared/realtimeRules.js) ----------
import { newBall, stepBall, moveStep, canStep, pathClear, botAim, ballSpot, pilesOnMap, pileSize, RUN_SPEED, SPRINT_SPEED, THROW_POWER } from '../public/shared/realtimeRules.js';

test('a realtime snowball follows exactly the path simulate() draws', () => {
  const map = makeMap(99);
  const from = { x: 2, z: -3 };
  const sim = simulate(from, 0.7, 0.5, 0.6, CALM, [], map);
  const b = newBall(1, 'a', from, 0.7, 0.5, 0.6);
  let res = null, guard = 0;
  while (!res && guard++ < 1000) res = stepBall(b, 1 / 30, map, []);
  assert.strictEqual(b.steps, sim.n - 1);
  assert.strictEqual(res.kind, sim.kind);
  assert.ok(Math.abs(b.x - sim.end.x) < 1e-4 && Math.abs(b.z - sim.end.z) < 1e-4, "same end (simulate keeps float32 points)");
});

test('a realtime snowball hits whoever stands in its way at that moment', () => {
  const b = newBall(1, 'a', { x: 0, z: 0 }, 0, 0.1, 0.4);
  let res = null;
  while (!res) res = stepBall(b, 1 / 30, EMPTY, [{ id: 'bob', x: 0, z: 5 }]);
  assert.strictEqual(res.hit, 'bob');
  assert.ok(res.part === 'head' || res.part === 'body');
});

test('running slides along walls and never ends up inside one', () => {
  const map = { walls: [{ x: 0, z: 2, w: 6, h: 1.5, d: 0.7, ry: 0 }], trees: [], deco: [] };
  let p = { x: 0, z: 0 };
  for (let i = 0; i < 60; i++) p = moveStep(p, 0.7, 0.7, 1 / 30, map); // into the wall at an angle
  assert.ok(p.x > 1, 'slid sideways');
  assert.ok(standOk(p.x, p.z, map, []));
  const one = moveStep({ x: 10, z: 10 }, 1, 0, 0.5, EMPTY);
  assert.ok(Math.abs(one.x - 10 - RUN_SPEED * 0.5) < 1e-9, 'runs at RUN_SPEED');
  const fast = moveStep({ x: 10, z: 10 }, 1, 0, 0.5, EMPTY, [], SPRINT_SPEED);
  assert.ok(Math.abs(fast.x - 10 - SPRINT_SPEED * 0.5) < 1e-9, 'sprints at SPRINT_SPEED');
  assert.ok(pilesOnMap(2, { size: 60 }) >= 30 && pilesOnMap(16, { size: 60 }) > pilesOnMap(2, { size: 60 }), 'plenty of snowball piles on the big map');
  const sizes = Array.from({ length: 2000 }, ((r) => () => pileSize(r))(mulberry32(5)));
  assert.ok(sizes.every((n) => n >= 1 && n <= 3) && sizes.includes(2) && sizes.includes(3), 'piles of 1 to 3');
  const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  assert.ok(avg > 1.6 && avg < 1.8, `about 1.7 snowballs per pile (${avg.toFixed(2)})`);
  assert.ok(pathClear({ x: 10, z: 0 }, { x: 10, z: 6 }, map));
  assert.ok(!pathClear({ x: 0, z: 0 }, { x: 0, z: 5 }, map), 'a straight line through the wall is not');
});

test('players block each other, but two who overlap can walk apart', () => {
  assert.ok(!canStep({ x: 0, z: 0 }, { x: 0, z: 0.5 }, EMPTY, [{ x: 0, z: 1 }]));
  assert.ok(canStep({ x: 0, z: 0.5 }, { x: 0, z: 0.3 }, EMPTY, [{ x: 0, z: 1 }]));
});

test('a perfect realtime bot hits a still target at the fixed throw speed; loose snowballs land on open snow', () => {
  const me = { x: 0, z: 0 };
  for (const t of [{ x: 0, z: 6 }, { x: 8, z: 9 }, { x: -15, z: 5 }, { x: 4, z: -22 }]) {
    const plan = botAim(me, t, EMPTY, mulberry32(1), 0);
    const s = simulate(me, plan.yaw, plan.pitch, THROW_POWER, CALM, [{ id: 't', x: t.x, z: t.z }], EMPTY);
    assert.strictEqual(s.hit, 't', `target at ${t.x},${t.z}`);
  }
  const map = makeMap(5), rng = mulberry32(8), balls = [];
  for (let i = 0; i < 10; i++) balls.push(ballSpot(rng, map, [], balls));
  for (const b of balls) assert.ok(standOk(b.x, b.z, map, []));
});

// ---------- the large realtime map ----------
import { ARENA_LARGE, MAX_PLAYERS, COLORS, BOT_NAMES } from '../public/shared/physics.js';

test('the realtime map is big, has forts with walk-through gates, and is the same for everyone', () => {
  const m = makeMap(4242, 'large');
  assert.strictEqual(m.size, ARENA_LARGE);
  assert.deepStrictEqual(makeMap(4242, 'large'), m, 'same seed, same map');
  assert.strictEqual(m.forts.length, 4);
  assert.strictEqual(m.walls.filter((w) => w.kind === 'tower').length, 16);
  assert.ok(m.walls.filter((w) => !w.kind).length >= 30, 'plenty of loose walls');
  assert.ok(m.trees.length >= 35 && m.snowmen.length >= 10);
  // you can walk into the central fort through a gate: the gate's middle is standable, the wall beside it is not
  const f = m.forts[0], c = Math.cos(f.rot), s = Math.sin(f.rot);
  const at = (lx, lz) => ({ x: lx * c - lz * s, z: lx * s + lz * c });
  const gate = at(0, f.half), wall = at(3.5, f.half);
  assert.ok(standOk(gate.x, gate.z, m, []), 'gate is open');
  assert.ok(!standOk(wall.x, wall.z, m, []), 'wall is solid');
  assert.ok(standOk(0, 0, m, []), 'room inside');
  // 16 players fit, apart from each other
  const rng = mulberry32(1), placed = [];
  for (let i = 0; i < 16; i++) placed.push(spawnPoint(rng, m, placed));
  for (const p of placed) assert.ok(standOk(p.x, p.z, m, []) && Math.hypot(p.x, p.z) <= ARENA_LARGE);
  assert.ok(standOk(ARENA_LARGE - 3, 0, { ...EMPTY, size: ARENA_LARGE }, []), 'the big arena reaches further');
  assert.ok(!standOk(ARENA_LARGE - 3, 0, EMPTY, []), 'than the turn-based one');
  assert.strictEqual(MAX_PLAYERS, 16);
  assert.strictEqual(new Set(COLORS).size, 16);
  assert.strictEqual(new Set(BOT_NAMES).size, 16);
});

test('snowmen block throws and you cannot stand in one', () => {
  const map = { ...EMPTY, snowmen: [{ x: 0, z: 4, s: 1 }] };
  assert.strictEqual(obstacleHit(0, 1.35, 4, map), 'snowman');
  assert.strictEqual(obstacleHit(0, 3, 4, map), null, 'over its hat');
  const sim = simulate({ x: 0, z: 0 }, 0, 0.1, 0.4, CALM, [{ id: 'bob', x: 0, z: 8 }], map);
  assert.strictEqual(sim.kind, 'snowman');
  assert.ok(!standOk(0, 4.3, map, []));
  assert.ok(lineBlocked({ x: 0, z: 0 }, { x: 0, z: 8 }, map, []), 'hiding behind a snowman works');
});

test('the turn-based bot planner is quick and still finds the shot (it runs on the server between frames)', () => {
  let hits = 0;
  const t = performance.now();
  for (let seed = 1; seed <= 40; seed++) {
    const map = makeMap(seed), rng = mulberry32(seed);
    const me = spawnPoint(rng, map, []), o = spawnPoint(rng, map, [me]);
    const tgt = { id: 'a', x: o.x, z: o.z }, wind = windFor(seed, seed % 7);
    const plan = planThrow(me, [tgt], wind, map, rng, 0);
    if (simulate(me, plan.yaw, plan.pitch, plan.power, wind, [tgt], map).hit) hits++;
  }
  const ms = (performance.now() - t) / 40;
  assert.ok(hits >= 34, `a perfect bot hits most open shots (${hits}/40)`);
  assert.ok(ms < 40, `about ${ms.toFixed(1)} ms per plan`);
});

test('running into a wall at an angle slides along it, whatever way the wall is turned', () => {
  for (const ry of [0, 0.6, 1.1, 2.3]) {
    const map = { ...EMPTY, walls: [{ x: 0, z: 0, w: 8, h: 1.2, d: 0.7, ry }] };
    // stand just off the wall's face and push into it at 45° to its length
    const c = Math.cos(ry), s = Math.sin(ry), nx = -s, nz = c; // the wall's length runs along (c, s); its face normal is (-s, c)
    let p = { x: nx * 1.0, z: nz * 1.0 };
    const start = { ...p };
    const dir = { x: (-nx + c) / Math.SQRT2, z: (-nz + s) / Math.SQRT2 };
    for (let i = 0; i < 30; i++) p = moveStep(p, dir.x, dir.z, 1 / 30, map);
    const along = (p.x - start.x) * c + (p.z - start.z) * s;
    assert.ok(along > 1.5, `slid ${along.toFixed(2)} m along a wall turned ${ry}`);
    assert.ok(standOk(p.x, p.z, map, []));
  }
});
