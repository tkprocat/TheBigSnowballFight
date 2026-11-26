// Game rules and physics shared by the browser game and the tests. Pure functions, no DOM.
// Everything here must stay deterministic: online players replay each other's throws with it.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;
export function angDiff(a, b) { return ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; }
export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export const GRAV = 9.8, DT = 1 / 120, BALL_R = 0.15, SPEED_MIN = 7, SPEED_MAX = 25;
export const ARENA = 30;
export const PITCH_MIN = 5 * Math.PI / 180, PITCH_MAX = 70 * Math.PI / 180;

export function makeMap(seed) {
  const rng = mulberry32(seed);
  const walls = [], trees = [], deco = [];
  for (let i = 0; i < 9; i++) {
    const a = rng() * TAU, r = 5 + rng() * 21;
    walls.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, w: 2.6 + rng() * 2.2, h: 1.0 + rng() * 0.5, d: 0.7, ry: rng() * Math.PI });
  }
  let tries = 0;
  while (trees.length < 11 && tries++ < 300) {
    const a = rng() * TAU, r = 7 + rng() * 21, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (walls.some(w => Math.hypot(w.x - x, w.z - z) < w.w / 2 + 2)) continue;
    if (trees.some(t => Math.hypot(t.x - x, t.z - z) < 4)) continue;
    trees.push({ x, z, s: 0.85 + rng() * 0.4 });
  }
  for (let i = 0; i < 70; i++) { const a = rng() * TAU, r = 36 + rng() * 40; deco.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, s: 0.9 + rng() * 0.9 }); }
  return { walls, trees, deco };
}

export function obstacleHit(x, y, z, map) {
  for (const t of map.trees) {
    const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz), s = t.s;
    if (y < 1.2 * s && d < 0.3 * s + BALL_R) return 'tree';
    if (y >= 1.0 * s && y < 6 * s) { const r = 1.7 * s * (1 - (y - s) / (5 * s)); if (d < r + BALL_R) return 'tree'; }
  }
  for (const w of map.walls) {
    const dx = x - w.x, dz = z - w.z, c = Math.cos(-w.ry), sn = Math.sin(-w.ry);
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    if (Math.abs(lx) < w.w / 2 + BALL_R && Math.abs(lz) < w.d / 2 + BALL_R && y < w.h + BALL_R) return 'wall';
  }
  return null;
}

export function launchPoint(from, yaw) { return { x: from.x + Math.sin(yaw) * 0.45, y: 1.75, z: from.z + Math.cos(yaw) * 0.45 }; }

/* simulate: returns sampled path + what it hit. targets = [{id,x,z}] */
// `heavy` is the packed snowball's multiplier (1 = normal): heavier balls fly a little slower and the wind moves them less.
export function simulate(from, yaw, pitch, power, wind, targets, map, maxSteps = 1200, probe = null, heavy = 1) {
  const v = (SPEED_MIN + clamp(power, 0, 1) * (SPEED_MAX - SPEED_MIN)) * (heavy > 1 ? HEAVY_SPEED : 1);
  const wk = heavy > 1 ? HEAVY_WIND : 1;
  const p = launchPoint(from, yaw);
  let x = p.x, y = p.y, z = p.z;
  let vx = Math.sin(yaw) * Math.cos(pitch) * v, vy = Math.sin(pitch) * v, vz = Math.cos(yaw) * Math.cos(pitch) * v;
  const pts = new Float32Array((maxSteps + 1) * 3);
  pts[0] = x; pts[1] = y; pts[2] = z;
  let n = 1, hit = null, part = null, kind = 'out', best = Infinity;
  for (let i = 0; i < maxSteps; i++) {
    vx += wind.x * wk * DT; vz += wind.z * wk * DT; vy -= GRAV * DT;
    vx *= 0.9995; vz *= 0.9995; vy *= 0.9995;
    x += vx * DT; y += vy * DT; z += vz * DT;
    pts[n * 3] = x; pts[n * 3 + 1] = y; pts[n * 3 + 2] = z; n++;
    if (probe) { const d = Math.hypot(x - probe.x, (y - 1.1) * 0.7, z - probe.z); if (d < best) best = d; }
    let done = false;
    for (const t of targets) {
      const bx = x - t.x, bz = z - t.z;
      // the head is checked first, so a ball clipping both counts as a head hit
      if (Math.hypot(bx, y - 1.72, bz) < 0.34 + BALL_R) { hit = t.id; part = 'head'; kind = 'player'; done = true; break; }
      if (Math.hypot(bx, y - 1.0, bz) < 0.55 + BALL_R || (y < 0.7 && Math.hypot(bx, bz) < 0.3 + BALL_R)) { hit = t.id; part = 'body'; kind = 'player'; done = true; break; }
    }
    if (done) break;
    const ob = obstacleHit(x, y, z, map); if (ob) { kind = ob; break; }
    if (y <= BALL_R) { pts[(n - 1) * 3 + 1] = BALL_R; kind = 'ground'; break; }
    if (Math.hypot(x, z) > 80) { kind = 'out'; break; }
  }
  return { pts, n, hit, part, kind, end: { x: pts[(n - 1) * 3], y: pts[(n - 1) * 3 + 1], z: pts[(n - 1) * 3 + 2] }, best };
}

export function windFor(seed, turn) {
  const rng = mulberry32((seed ^ Math.imul(turn + 1, 2654435761)) >>> 0);
  const a = rng() * TAU, s = rng() < 0.15 ? 0 : 0.4 + rng() * 2.6;
  return { x: Math.sin(a) * s, z: Math.cos(a) * s, s, a };
}

export function spawnPoint(rng, map, others) {
  for (let k = 0; k < 300; k++) {
    const a = rng() * TAU, r = 5 + rng() * (ARENA - 7), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (map.walls.some(w => Math.hypot(w.x - x, w.z - z) < w.w / 2 + 1.3)) continue;
    if (map.trees.some(t => Math.hypot(t.x - x, t.z - z) < 2.4)) continue;
    const minD = k < 200 ? 9 : 4;
    if (others.some(o => Math.hypot(o.x - x, o.z - z) < minD)) continue;
    return { x, z };
  }
  return { x: (rng() - 0.5) * 20, z: (rng() - 0.5) * 20 };
}

// Game settings shared by the browser and the server.
export const WIN_SCORE = 10;     // points needed to win a round
export const HIT_POINTS = { head: 2, body: 1 };
// Heavy snowballs: spend a turn packing instead of throwing and your next hit counts triple.
// One pack at a time: two turns for 3x a hit beats two plain throws unless you're likely to be hit first.
// You drop it if you get hit before you throw it.
export const HEAVY_MAX = 3, HEAVY_MULT = 3, HEAVY_SPEED = 0.88, HEAVY_WIND = 0.5, PACK_MS = 1400;
// Quick chat: fixed lines and emotes, so there is nothing to moderate.
export const CHAT_LINES = ['Nice shot!', 'Missed me!', 'Watch this…', 'Oops!', 'Hide!', 'Incoming!', 'So close!', 'GG'];
export const EMOTES = ['wave', 'dance', 'cheer'];
export const TURN_LIMIT = 30;    // seconds per turn before a throw is made for you
export const MAX_PLAYERS = 8;
export const COLORS = ['#e2434b', '#2f7de1', '#f2a20c', '#2bb673', '#9b5de5', '#ff6fa3', '#14b8c4', '#8a5a2b'];
export const BOT_NAMES = ['Frosty', 'Blizzard', 'Sleet', 'Flurry', 'Icicle', 'Slushie', 'Hailey', 'Yeti'];

// How long the client needs to show a throw: wind-up, flight, and the pause after it lands.
// Head shots play the end of the flight in slow motion (the critical-hit camera), then hold a little longer.
export const SLOW_WINDOW = 0.6, SLOW_SPEED = 0.25; // seconds of flight shown slowed, and how slow
export const HOLD_MS = { head: 2000, body: 1600, miss: 1000 };
export function throwShowMs(steps, part) {
  const flight = steps * DT * 1000;
  const slow = part === 'head' ? Math.min(flight, SLOW_WINDOW * 1000) * (1 / SLOW_SPEED - 1) : 0;
  return 100 + flight + slow + HOLD_MS[part || 'miss'];
}

// A computer player's throw: search for the shot that comes closest to a random opponent, then add some error.
// `rng` returns numbers in [0, 1); `error` scales the miss (0 = perfect).
export function planThrow(p, opponents, wind, map, rng = Math.random, error = 1, heavy = 1) {
  if (!opponents.length) return { yaw: Math.atan2(-p.x, -p.z), pitch: 0.6, power: 0.5 };
  const tgt = opponents[Math.floor(rng() * opponents.length)];
  const base = Math.atan2(tgt.x - p.x, tgt.z - p.z);
  let best = { d: Infinity, yaw: base, pitch: 0.6, power: 0.5 };
  for (const pitch of [0.35, 0.6, 0.85]) {
    for (let dy = -0.36; dy <= 0.361; dy += 0.04) {
      for (let pw = 0.02; pw <= 1; pw += 0.04) {
        const s = simulate(p, base + dy, pitch, pw, wind, [{ id: 'tgt', x: tgt.x, z: tgt.z }], map, 900, tgt, heavy);
        const d = s.hit ? 0 : s.best;
        if (d < best.d) best = { d, yaw: base + dy, pitch, power: pw };
      }
    }
  }
  const g = () => (rng() + rng() + rng() - 1.5) * error;
  return {
    yaw: best.yaw + g() * 0.06,
    pitch: clamp(best.pitch + g() * 0.04, PITCH_MIN, PITCH_MAX),
    power: clamp(best.power + g() * 0.06, 0.02, 1),
  };
}

// ---------- moving before you throw ----------
export const MOVE_RADIUS = 5; // metres you may walk at the start of your turn

// Pull a wanted spot back inside your move ring.
export function clampMove(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz);
  if (d <= MOVE_RADIUS) return { x: to.x, z: to.z };
  return { x: from.x + dx / d * MOVE_RADIUS, z: from.z + dz / d * MOVE_RADIUS };
}

// Can someone stand here? Not inside a wall or tree, not on top of another player, not out of the arena.
export function standOk(x, z, map, others) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) > ARENA + 4) return false;
  for (const w of map.walls) {
    const dx = x - w.x, dz = z - w.z, c = Math.cos(-w.ry), s = Math.sin(-w.ry);
    if (Math.abs(dx * c - dz * s) < w.w / 2 + 0.55 && Math.abs(dx * s + dz * c) < w.d / 2 + 0.55) return false;
  }
  for (const t of map.trees) if (Math.hypot(x - t.x, z - t.z) < 0.5 * t.s + 0.6) return false;
  for (const o of others) if (Math.hypot(x - o.x, z - o.z) < 1.3) return false;
  return true;
}

// Is the straight line between two players blocked at chest height by a wall, a tree or someone else?
export function lineBlocked(a, b, map, others) {
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(2, Math.ceil(d / 0.25));
  for (let i = 1; i < n; i++) {
    const t = i / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    if (obstacleHit(x, 1.2, z, map)) return true;
    for (const o of others) if (Math.hypot(x - o.x, z - o.z) < 0.55) return true;
  }
  return false;
}

// A computer player's move: somewhere in its ring, hidden from the next thrower if it can find such a spot.
export function chooseCover(p, next, map, players, rng = Math.random) {
  const others = players.filter((o) => o !== p);
  const shields = players.filter((o) => o !== p && o !== next);
  let best = { x: p.x, z: p.z }, bestScore = (next && lineBlocked(next, p, map, shields) ? 10 : 0) + rng();
  for (let i = 0; i < 32; i++) {
    const a = rng() * TAU, r = Math.sqrt(rng()) * MOVE_RADIUS;
    const c = { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r };
    if (!standOk(c.x, c.z, map, others)) continue;
    const score = (next && lineBlocked(next, c, map, shields) ? 10 : 0) + rng();
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}
