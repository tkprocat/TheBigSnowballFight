// Game rules and physics shared by the browser game and the tests. Pure functions, no DOM.
// Everything here must stay deterministic: online players replay each other's throws with it.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;
export function angDiff(a, b) { return ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; }
export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export const GRAV = 9.8, DT = 1 / 120, BALL_R = 0.15, SPEED_MIN = 7, SPEED_MAX = 25;
export const ARENA = 30;          // the turn-based map's radius
export const ARENA_LARGE = 60;    // the realtime map's radius (room for 16 players)
export const arenaOf = (map) => (map && map.size) || ARENA;
export const PITCH_MIN = 5 * Math.PI / 180, PITCH_MAX = 70 * Math.PI / 180;

// `size`: 'small' (turn-based) or 'large' (realtime: forts, more walls and trees, snowmen to hide behind).
export function makeMap(seed, size = 'small') {
  if (size === 'large') return makeLargeMap(seed);
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
  return { size: ARENA, walls, trees, deco, snowmen: [], forts: [] };
}

// A fort: four walls with corner towers and gates. Walls get kind 'fort' and towers kind 'tower', so they can be
// drawn with battlements. `gates` lists the sides (0..3) that have a gap to walk through.
function addFort(walls, cx, cz, half, rot, gates) {
  const c = Math.cos(rot), s = Math.sin(rot), T = 1.8, GATE = 3.0;
  // local (lx, lz) to world, the same way obstacleHit() turns a wall's ry
  const put = (lx, lz, w, d, h, ry, kind) => walls.push({ x: cx + lx * c - lz * s, z: cz + lx * s + lz * c, w, h, d, ry: rot + ry, kind });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) put(sx * half, sz * half, T, T, 2.3, 0, 'tower');
  const run = half - T / 2;
  for (let side = 0; side < 4; side++) {
    const segs = gates.includes(side) ? [[-run, -GATE / 2], [GATE / 2, run]] : [[-run, run]];
    for (const [a, b] of segs) {
      const u = (a + b) / 2, len = b - a;
      if (side === 0) put(u, half, len, 0.8, 1.5, 0, 'fort');
      else if (side === 1) put(half, u, len, 0.8, 1.5, Math.PI / 2, 'fort');
      else if (side === 2) put(u, -half, len, 0.8, 1.5, 0, 'fort');
      else put(-half, u, len, 0.8, 1.5, Math.PI / 2, 'fort');
    }
  }
}

// The realtime map: a fort in the middle, three outposts around it, loose walls (some L-shaped corners),
// trees and snowmen to hide behind.
function makeLargeMap(seed) {
  const rng = mulberry32(seed ^ 0x5eed);
  const S = ARENA_LARGE, walls = [], trees = [], deco = [], snowmen = [], forts = [];
  const fortRot = rng() * TAU;
  forts.push({ x: 0, z: 0, half: 7, rot: fortRot });
  addFort(walls, 0, 0, 7, fortRot, [0, 1, 2, 3]);
  const a0 = rng() * TAU;
  for (let k = 0; k < 3; k++) {
    const a = a0 + k * TAU / 3, x = Math.cos(a) * 38, z = Math.sin(a) * 38;
    forts.push({ x, z, half: 4.5, rot: -a });
    addFort(walls, x, z, 4.5, -a, [1, 3]);
  }
  const nearFort = (x, z, pad) => forts.some((f) => Math.hypot(f.x - x, f.z - z) < f.half * 1.45 + pad);
  const clearOfWalls = (x, z, w, pad) => walls.every((o) => Math.hypot(o.x - x, o.z - z) > (o.w + w) / 2 + pad);
  // loose walls, a few of them with a second wall at one end to make a corner
  let tries = 0;
  const fortPieces = walls.length;
  while (walls.length - fortPieces < 34 && tries++ < 1500) {
    const a = rng() * TAU, r = 12 + rng() * (S - 16), x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = 2.6 + rng() * 3, ry = rng() * Math.PI;
    if (nearFort(x, z, 2) || !clearOfWalls(x, z, w, 2.5)) continue;
    walls.push({ x, z, w, h: 1.0 + rng() * 0.5, d: 0.7, ry });
    if (rng() < 0.3) {
      const w2 = 2 + rng() * 1.5, end = (rng() < 0.5 ? 1 : -1) * (w / 2 + 0.35);
      const lx = end, lz = (w2 / 2 - 0.35) * (rng() < 0.5 ? 1 : -1);
      const c = Math.cos(ry), s = Math.sin(ry);
      walls.push({ x: x + lx * c - lz * s, z: z + lx * s + lz * c, w: w2, h: walls[walls.length - 1].h, d: 0.7, ry: ry + Math.PI / 2 });
    }
  }
  tries = 0;
  while (trees.length < 40 && tries++ < 1500) {
    const a = rng() * TAU, r = 10 + rng() * (S - 12), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (nearFort(x, z, 2) || walls.some((w) => Math.hypot(w.x - x, w.z - z) < w.w / 2 + 2)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 4)) continue;
    trees.push({ x, z, s: 0.85 + rng() * 0.45 });
  }
  tries = 0;
  while (snowmen.length < 14 && tries++ < 1000) {
    const a = rng() * TAU, r = 9 + rng() * (S - 12), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (nearFort(x, z, 1) || walls.some((w) => Math.hypot(w.x - x, w.z - z) < w.w / 2 + 1.8)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3) || snowmen.some((o) => Math.hypot(o.x - x, o.z - z) < 6)) continue;
    snowmen.push({ x, z, s: 0.9 + rng() * 0.3, ry: rng() * TAU });
  }
  for (let i = 0; i < 150; i++) { const a = rng() * TAU, r = S + 6 + rng() * 44; deco.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, s: 0.9 + rng() * 0.9 }); }
  return { size: S, walls, trees, deco, snowmen, forts };
}

// A snowman: three stacked balls. Returns true if a ball at (x, y, z) touches it.
function snowmanHit(x, y, z, m) {
  const s = m.s, d = Math.hypot(x - m.x, z - m.z);
  if (d > 0.8 * s + BALL_R) return false;
  return Math.hypot(d, y - 0.55 * s) < 0.62 * s + BALL_R || Math.hypot(d, y - 1.35 * s) < 0.45 * s + BALL_R || Math.hypot(d, y - 1.95 * s) < 0.32 * s + BALL_R;
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
  if (map.snowmen) for (const m of map.snowmen) if (snowmanHit(x, y, z, m)) return 'snowman';
  return null;
}

// Does a ball at (x, y, z) hit one of the targets ([{id, x, z}])? Returns {id, part} or null.
// The head is checked first, so a ball clipping both counts as a head hit.
export function ballHit(x, y, z, targets) {
  for (const t of targets) {
    const bx = x - t.x, bz = z - t.z;
    if (Math.hypot(bx, y - 1.72, bz) < 0.34 + BALL_R) return { id: t.id, part: 'head' };
    if (Math.hypot(bx, y - 1.0, bz) < 0.55 + BALL_R || (y < 0.7 && Math.hypot(bx, bz) < 0.3 + BALL_R)) return { id: t.id, part: 'body' };
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
    const h = targets.length ? ballHit(x, y, z, targets) : null;
    if (h) { hit = h.id; part = h.part; kind = 'player'; break; }
    const ob = obstacleHit(x, y, z, map); if (ob) { kind = ob; break; }
    if (y <= BALL_R) { pts[(n - 1) * 3 + 1] = BALL_R; kind = 'ground'; break; }
    if (Math.hypot(x, z) > arenaOf(map) + 50) { kind = 'out'; break; }
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
    const a = rng() * TAU, r = 5 + rng() * (arenaOf(map) - 7), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (map.walls.some(w => Math.hypot(w.x - x, w.z - z) < w.w / 2 + 1.3)) continue;
    if (map.trees.some(t => Math.hypot(t.x - x, t.z - z) < 2.4)) continue;
    if (map.snowmen && map.snowmen.some(m => Math.hypot(m.x - x, m.z - z) < 2)) continue;
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
export const MAX_PLAYERS = 16;
export const COLORS = ['#e2434b', '#2f7de1', '#f2a20c', '#2bb673', '#9b5de5', '#ff6fa3', '#14b8c4', '#8a5a2b',
  '#1e3a8a', '#84cc16', '#0f766e', '#f97316', '#be185d', '#64748b', '#facc15', '#1f2937'];
export const BOT_NAMES = ['Frosty', 'Blizzard', 'Sleet', 'Flurry', 'Icicle', 'Slushie', 'Hailey', 'Yeti',
  'Glacier', 'Powder', 'Drift', 'Frostbite', 'Tundra', 'Avalanche', 'Mittens', 'Snowflake'];

// How long the client needs to show a throw: wind-up, flight, and the pause after it lands.
// Head shots play the end of the flight in slow motion (the critical-hit camera), then hold a little longer.
export const SLOW_WINDOW = 0.6, SLOW_SPEED = 0.25; // seconds of flight shown slowed, and how slow
export const HOLD_MS = { head: 2000, body: 1600, miss: 1000 };
export function throwShowMs(steps, part) {
  const flight = steps * DT * 1000;
  const slow = part === 'head' ? Math.min(flight, SLOW_WINDOW * 1000) * (1 / SLOW_SPEED - 1) : 0;
  return 100 + flight + slow + HOLD_MS[part || 'miss'];
}

// A computer player's throw: aim at a random opponent and correct the shot a few times from where the simulated
// ball goes (sideways miss turns the aim, short or long changes the power), for each of three angles; keep the
// closest. A few dozen simulations instead of a brute-force search, so the server never stalls. Then add error.
// `rng` returns numbers in [0, 1); `error` scales the miss (0 = perfect).
export function planThrow(p, opponents, wind, map, rng = Math.random, error = 1, heavy = 1) {
  if (!opponents.length) return { yaw: Math.atan2(-p.x, -p.z), pitch: 0.6, power: 0.5 };
  const tgt = opponents[Math.floor(rng() * opponents.length)];
  const base = Math.atan2(tgt.x - p.x, tgt.z - p.z), dist = Math.hypot(tgt.x - p.x, tgt.z - p.z);
  const targets = [{ id: 'tgt', x: tgt.x, z: tgt.z }];
  let best = { d: Infinity, yaw: base, pitch: 0.6, power: 0.5 };
  for (const pitch of [0.35, 0.6, 0.85]) {
    let yaw = base, power = 0.5, step = 0.25, lastShort = null;
    for (let it = 0; it < 12; it++) {
      const s = simulate(p, yaw, pitch, power, wind, targets, map, 900, tgt, heavy);
      const d = s.hit ? 0 : s.best;
      if (d < best.d) best = { d, yaw, pitch, power };
      if (s.hit) break;
      // where the ball is as it passes the target's distance (or where it stopped, if it fell short)
      let k = s.n - 1;
      for (let i = 1; i < s.n; i++) if (Math.hypot(s.pts[i * 3] - p.x, s.pts[i * 3 + 2] - p.z) >= dist) { k = i; break; }
      const bx = s.pts[k * 3] - p.x, bz = s.pts[k * 3 + 2] - p.z, by = s.pts[k * 3 + 1];
      const reached = Math.hypot(bx, bz) >= dist - 0.01;
      yaw += angDiff(Math.atan2(bx, bz), base);                    // turn the miss sideways back onto the target
      const short = !reached || by < 0.6;                          // fell short, or reached it below the knees
      const long = reached && by > 1.9;                            // went over its head
      if (!short && !long) step *= 0.5;                            // at the right height: just fine-tune the aim
      else {
        if (lastShort !== null && lastShort !== short) step *= 0.5; // overshot the other way: smaller steps (bisection)
        power = clamp(power + (short ? step : -step), 0.02, 1);
        lastShort = short;
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
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) > arenaOf(map) + 4) return false;
  for (const w of map.walls) {
    const dx = x - w.x, dz = z - w.z, c = Math.cos(-w.ry), s = Math.sin(-w.ry);
    if (Math.abs(dx * c - dz * s) < w.w / 2 + 0.55 && Math.abs(dx * s + dz * c) < w.d / 2 + 0.55) return false;
  }
  for (const t of map.trees) if (Math.hypot(x - t.x, z - t.z) < 0.5 * t.s + 0.6) return false;
  if (map.snowmen) for (const m of map.snowmen) if (Math.hypot(x - m.x, z - m.z) < 0.75 * m.s + 0.55) return false;
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
