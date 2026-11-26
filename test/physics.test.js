// Shared game physics (public/physics.js). Run with: node --test
import test from 'node:test';
import assert from 'node:assert';
import {
  simulate, windFor, makeMap, spawnPoint, planThrow, obstacleHit, mulberry32, throwShowMs,
  BALL_R, PITCH_MIN, PITCH_MAX, ARENA,
} from '../public/physics.js';

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

test('show time covers the flight', () => {
  assert.ok(throwShowMs(240, false) > 2000);
  assert.ok(throwShowMs(240, true) > throwShowMs(240, false));
});
