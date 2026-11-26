// Realtime mode rules, shared by the server and the browser. Pure functions, no DOM.
// Everyone runs around at once, picks snowballs up off the snow and throws whenever they like.
// No wind and no heavy snowballs here. The server decides every hit; browsers only draw what it says.
import {
  clamp, TAU, GRAV, DT, BALL_R, SPEED_MIN, SPEED_MAX, PITCH_MIN, PITCH_MAX, arenaOf,
  ballHit, obstacleHit, launchPoint, simulate, standOk,
} from './physics.js';

export const RUN_SPEED = 6;            // metres per second
export const SPRINT_SPEED = 9.6;       // holding Shift: faster, but you can't aim or throw
export const TICK_MS = 1000 / 30;      // server simulation step
export const SEND_MS = 1000 / 15;      // how often the server sends positions
export const INPUT_MS = 50;            // how often a browser reports its position
export const CARRY_MAX = 3;            // snowballs you can hold
export const PICKUP_R = 1.0;           // walk this close to a snowball to pick it up
export const PILES_MAX = 64;           // spots on the map that hold snowballs
export const BALL_RESPAWN_MS = 2000;   // a picked-up snowball comes back somewhere else after this
export const THROW_COOLDOWN_MS = 450;
export const THROW_POWER = 0.72;       // every throw goes at the same speed (20 m/s); the angle sets the distance (about 40 m at most)
export const SHIELD_MS = 1500;         // after being hit you can't be hit again for this long
export const MAX_FLIGHT_STEPS = 1200;
export const CALM = Object.freeze({ x: 0, z: 0 });

// How many spots with snowballs lie on the map for this many players (more on a bigger map). Each spot is a pile of
// 1 to 3 (about 1.7 on average), see pileSize().
export const pilesOnMap = (players, map) => Math.min(PILES_MAX, 10 + Math.round(players * 3.5) + Math.floor((arenaOf(map) - 30) * 0.6));
// How many snowballs a new pile holds: 1 (half the time), 2 (30%) or 3 (20%).
export const pileSize = (rng) => { const r = rng(); return r < 0.2 ? 3 : r < 0.5 ? 2 : 1; };

export const THROW_SPEED = SPEED_MIN + THROW_POWER * (SPEED_MAX - SPEED_MIN);

// Can someone step from `from` to `to`? Walls, trees and the arena edge block. Other players only block
// a step that brings you closer to them, so two people who end up overlapping can still walk apart.
export function canStep(from, to, map, others) {
  if (!standOk(to.x, to.z, map, [])) return false;
  for (const o of others) {
    const d = Math.hypot(to.x - o.x, to.z - o.z);
    if (d < 1.0 && d < Math.hypot(from.x - o.x, from.z - o.z)) return false;
  }
  return true;
}

// Run for dt seconds in direction (dx, dz) (length up to 1) at `speed`, sliding along anything in the way.
// Returns the new spot; `p` is not changed.
// Blocked? Try the step turned a little to either side and shortened by how far it turned (like sliding along a
// surface at any angle). Walking straight into a wall still stops you; walking into it at an angle slides.
const SLIDE_ANGLES = [0.25, 0.5, 0.75, 1.0, 1.25, 1.45];
export function moveStep(p, dx, dz, dt, map, others = [], speed = RUN_SPEED) {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6 || dt <= 0) return { x: p.x, z: p.z };
  const k = speed * dt / Math.max(1, len);
  const sx = dx * k, sz = dz * k;
  const full = { x: p.x + sx, z: p.z + sz };
  if (canStep(p, full, map, others)) return full;
  for (const a of SLIDE_ANGLES) {
    const c = Math.cos(a), s = Math.sin(a);
    for (const sign of [1, -1]) {
      const rx = (sx * c - sz * s * sign) * c, rz = (sx * s * sign + sz * c) * c;
      const to = { x: p.x + rx, z: p.z + rz };
      if (canStep(p, to, map, others)) return to;
    }
  }
  return { x: p.x, z: p.z };
}

// Is every point along a straight walk from a to b somewhere you could stand? (No walking through walls.)
export function pathClear(a, b, map) {
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / 0.25));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!standOk(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, map, [])) return false;
  }
  return true;
}

// A free spot for a loose snowball: in the arena, clear of walls, trees, players and other snowballs.
export function ballSpot(rng, map, players, balls) {
  for (let k = 0; k < 200; k++) {
    const a = rng() * TAU, r = 3 + rng() * (arenaOf(map) - 5), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!standOk(x, z, map, [])) continue;
    if (players.some((o) => Math.hypot(o.x - x, o.z - z) < 2)) continue;
    if (balls.some((o) => Math.hypot(o.x - x, o.z - z) < 3)) continue;
    return { x, z };
  }
  return { x: (rng() - 0.5) * 20, z: (rng() - 0.5) * 20 };
}

// A snowball in flight. Same start and same steps as simulate() with no wind, so a browser that replays
// the throw with simulate() draws exactly the path the server checked.
export function newBall(n, by, from, yaw, pitch, power) {
  const v = SPEED_MIN + clamp(power, 0, 1) * (SPEED_MAX - SPEED_MIN);
  const p = launchPoint(from, yaw);
  return {
    n, by, from: { x: from.x, z: from.z }, yaw, pitch, power, steps: 0, acc: 0,
    x: p.x, y: p.y, z: p.z,
    vx: Math.sin(yaw) * Math.cos(pitch) * v, vy: Math.sin(pitch) * v, vz: Math.cos(yaw) * Math.cos(pitch) * v,
  };
}

// Move a ball on by dt seconds in whole physics steps, checking the targets ([{id, x, z}]) where they stand now.
// Returns null while it is still flying, else {kind: 'player' | 'wall' | 'tree' | 'ground' | 'out', hit, part}.
export function stepBall(b, dt, map, targets) {
  b.acc += dt;
  while (b.acc >= DT - 1e-9) {
    b.acc -= DT;
    b.vy -= GRAV * DT;
    b.vx *= 0.9995; b.vz *= 0.9995; b.vy *= 0.9995;
    b.x += b.vx * DT; b.y += b.vy * DT; b.z += b.vz * DT;
    b.steps++;
    const h = targets.length ? ballHit(b.x, b.y, b.z, targets) : null;
    if (h) return { kind: 'player', hit: h.id, part: h.part };
    const ob = obstacleHit(b.x, b.y, b.z, map);
    if (ob) return { kind: ob, hit: null, part: null };
    if (b.y <= BALL_R) { b.y = BALL_R; return { kind: 'ground', hit: null, part: null }; }
    if (Math.hypot(b.x, b.z) > arenaOf(map) + 50 || b.steps >= MAX_FLIGHT_STEPS) return { kind: 'out', hit: null, part: null };
  }
  return null;
}

// A computer player's throw at a (maybe moving) target: solve the flat arc for the fixed throw speed (no drag),
// lead the target by its velocity (vx, vz), check the shot with simulate(), then add some error. `error` 0 = perfect.
export function botAim(from, target, map, rng = Math.random, error = 1) {
  const v = THROW_SPEED;
  const aimAt = (tx, tz) => {
    const yaw = Math.atan2(tx - from.x, tz - from.z);
    const d = Math.max(0.5, Math.hypot(tx - from.x, tz - from.z) - 0.45);
    // launch height 1.75, aim at chest height 1.1: a*u^2 - d*u + (a - 0.65) = 0 with u = tan(pitch)
    const a = GRAV * d * d / (2 * v * v), disc = d * d - 4 * a * (a - 0.65);
    const pitch = disc < 0 ? Math.PI / 4 : Math.atan((d - Math.sqrt(disc)) / (2 * a));
    return { yaw, pitch: clamp(pitch, PITCH_MIN, PITCH_MAX) };
  };
  let plan = aimAt(target.x, target.z);
  const vx = target.vx || 0, vz = target.vz || 0;
  if (vx || vz) for (let i = 0; i < 2; i++) {
    const t = Math.hypot(target.x - from.x, target.z - from.z) / Math.max(1, v * Math.cos(plan.pitch));
    plan = aimAt(target.x + vx * t, target.z + vz * t);
  }
  // fine-tune the angle against the real physics (drag, ball and body sizes)
  if (!vx && !vz) {
    const tgt = [{ id: 't', x: target.x, z: target.z }];
    for (const dp of [0, -0.01, 0.01, -0.02, 0.02, -0.03, 0.03, -0.05, 0.05]) {
      const p = clamp(plan.pitch + dp, PITCH_MIN, PITCH_MAX);
      if (simulate(from, plan.yaw, p, THROW_POWER, CALM, tgt, map, 600).hit) { plan.pitch = p; break; }
    }
  }
  const g = () => (rng() + rng() + rng() - 1.5) * error;
  return { yaw: plan.yaw + g() * 0.05, pitch: clamp(plan.pitch + g() * 0.025, PITCH_MIN, PITCH_MAX) };
}
