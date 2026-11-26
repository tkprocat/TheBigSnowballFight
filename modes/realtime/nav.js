// Path finding for realtime bots. The map is marked out in 1 m squares once per round (can someone stand here?
// walls, trees, snowmen and the arena edge block), then bots find routes with A* (or, to choose a snowball, a
// search that stops at the first one reached, so "nearest" means nearest on foot). Paths are smoothed into a few
// straight legs. Other players aren't in the grid: bots step round them as they walk (moveStep).
import { arenaOf, standOk } from '../../public/shared/physics.js';

const CELL = 1;
// How many route searches have run (tests check the per-tick budget against this).
export const stats = { searches: 0 };
const DIAG = Math.SQRT2;

// The walkability grid for a map: the same rules as standOk() (arena edge, walls, trees, snowmen; players don't
// count), applied by marking each obstacle's own footprint instead of testing every square against every obstacle.
export function buildNav(map) {
  const half = arenaOf(map) + 4, n = Math.ceil((2 * half) / CELL), o = -half, edge = arenaOf(map) + 4;
  const walk = new Uint8Array(n * n);
  const cx = (ix) => o + (ix + 0.5) * CELL;
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) walk[iz * n + ix] = Math.hypot(cx(ix), cx(iz)) > edge ? 0 : 1;
  // block every square whose centre is within `r` of (x, z) and passes `inside`
  const block = (x, z, r, inside) => {
    const x0 = Math.max(0, Math.floor((x - r - o) / CELL)), x1 = Math.min(n - 1, Math.floor((x + r - o) / CELL));
    const z0 = Math.max(0, Math.floor((z - r - o) / CELL)), z1 = Math.min(n - 1, Math.floor((z + r - o) / CELL));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) if (inside(cx(ix), cx(iz))) walk[iz * n + ix] = 0;
  };
  for (const w of map.walls) {
    const c = Math.cos(-w.ry), sn = Math.sin(-w.ry), hw = w.w / 2 + 0.55, hd = w.d / 2 + 0.55;
    block(w.x, w.z, Math.hypot(hw, hd), (x, z) => { const dx = x - w.x, dz = z - w.z; return Math.abs(dx * c - dz * sn) < hw && Math.abs(dx * sn + dz * c) < hd; });
  }
  for (const t of map.trees) { const r = 0.5 * t.s + 0.6; block(t.x, t.z, r, (x, z) => Math.hypot(x - t.x, z - t.z) < r); }
  for (const m of map.snowmen || []) { const r = 0.75 * m.s + 0.55; block(m.x, m.z, r, (x, z) => Math.hypot(x - m.x, z - m.z) < r); }
  // squares within 2 of a blocked one: steps between them get checked against the real collision rules (the line
  // between two clear square centres can still graze a tree's edge or a turned wall's corner)
  const near = new Uint8Array(n * n);
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      if (walk[iz * n + ix]) continue;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const jx = ix + dx, jz = iz + dz;
        if (jx >= 0 && jz >= 0 && jx < n && jz < n) near[jz * n + jx] = 1;
      }
    }
  // per square and direction (8): 0 not checked yet, 1 the step is clear, 2 it isn't
  return { map, n, o, walk, near, steps: new Uint8Array(n * n * 8) };
}

const DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
// Can someone walk from square i one step in direction d (index into DIRS)? Exact near obstacles, cached both ways.
function stepClear(nav, i, d, j) {
  if (!nav.near[i] && !nav.near[j]) return true;
  const k = i * 8 + d;
  if (!nav.steps[k]) {
    const ok = segmentClear(nav, centre(nav, i), centre(nav, j));
    nav.steps[k] = nav.steps[j * 8 + (7 - d)] = ok ? 1 : 2; // DIRS[7 - d] is the opposite direction
  }
  return nav.steps[k] === 1;
}

// The grid for the room's current map (built on first use, rebuilt if the map changes).
export function navFor(room) {
  const rt = room.rt;
  if (!rt.nav || rt.nav.map !== room.map) rt.nav = buildNav(room.map);
  return rt.nav;
}

const cellOf = (nav, x, z) => {
  const ix = Math.max(0, Math.min(nav.n - 1, Math.floor((x - nav.o) / CELL)));
  const iz = Math.max(0, Math.min(nav.n - 1, Math.floor((z - nav.o) / CELL)));
  return iz * nav.n + ix;
};
const centre = (nav, i) => ({ x: nav.o + ((i % nav.n) + 0.5) * CELL, z: nav.o + (Math.floor(i / nav.n) + 0.5) * CELL });

// The nearest walkable square to (x, z), looking up to 3 squares away (players can stand a little closer to
// walls than a square's centre allows).
function walkableNear(nav, x, z) {
  const i = cellOf(nav, x, z);
  if (nav.walk[i]) return i;
  const n = nav.n, cx = i % n, cz = Math.floor(i / n);
  let best = -1, bd = Infinity;
  for (let r = 1; r <= 3 && best < 0; r++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const ix = cx + dx, iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= n || iz >= n || !nav.walk[iz * n + ix]) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = iz * n + ix; }
      }
  return best;
}

// Can someone walk the straight line from a to b? The same rules as moving does (standOk / pathClear: checked every
// 0.25 m against walls, trees, snowmen and the arena edge), but only against the obstacles near the line, so it's
// cheap enough to test every shortcut while smoothing a route. (The grid alone only knows square centres, so a
// shortcut it allowed could still clip the edge of a tree.)
export function segmentClear(nav, a, b) {
  const map = nav.map, pad = 4; // more than any obstacle's reach (a 2.3 m tower's corner plus the 0.55 m margin)
  const x0 = Math.min(a.x, b.x) - pad, x1 = Math.max(a.x, b.x) + pad, z0 = Math.min(a.z, b.z) - pad, z1 = Math.max(a.z, b.z) + pad;
  const near = (o) => o.x > x0 - (o.w || 0) && o.x < x1 + (o.w || 0) && o.z > z0 - (o.w || 0) && o.z < z1 + (o.w || 0);
  const local = { size: map.size, walls: map.walls.filter(near), trees: map.trees.filter(near), snowmen: (map.snowmen || []).filter(near) };
  const d = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.max(1, Math.ceil(d / 0.25));
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    if (!standOk(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, local, [])) return false;
  }
  return true;
}

// A small binary heap of square indices ordered by priority.
function makeHeap() {
  const idx = [], pri = [];
  return {
    get size() { return idx.length; },
    push(i, p) {
      idx.push(i); pri.push(p);
      let c = idx.length - 1;
      while (c > 0) { const up = (c - 1) >> 1; if (pri[up] <= pri[c]) break; [idx[up], idx[c]] = [idx[c], idx[up]]; [pri[up], pri[c]] = [pri[c], pri[up]]; c = up; }
    },
    // the lowest-priority square; its priority is left in `last`
    last: 0,
    pop() {
      const top = idx[0]; this.last = pri[0];
      const li = idx.pop(), lp = pri.pop();
      if (idx.length) {
        idx[0] = li; pri[0] = lp;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1, r = l + 1;
          let m = c;
          if (l < idx.length && pri[l] < pri[m]) m = l;
          if (r < idx.length && pri[r] < pri[m]) m = r;
          if (m === c) break;
          [idx[m], idx[c]] = [idx[c], idx[m]]; [pri[m], pri[c]] = [pri[c], pri[m]]; c = m;
        }
      }
      return top;
    },
  };
}

// Search from `from` until a square in `goals` (a Map from square to anything) is reached. With `target`, A* towards
// that one square. Returns { end, cost, prev } or null.
function search(nav, from, goals, target) {
  const n = nav.n, cost = new Float64Array(n * n).fill(Infinity), prev = new Int32Array(n * n).fill(-1), done = new Uint8Array(n * n);
  const tx = target != null ? target % n : 0, tz = target != null ? Math.floor(target / n) : 0;
  const h = (i) => {
    if (target == null) return 0;
    const dx = Math.abs((i % n) - tx), dz = Math.abs(Math.floor(i / n) - tz);
    return (dx + dz) + (DIAG - 2) * Math.min(dx, dz); // octile distance
  };
  const heap = makeHeap();
  cost[from] = 0; heap.push(from, h(from));
  while (heap.size) {
    const i = heap.pop();
    if (done[i]) continue; // an older, worse entry for a square we've already settled
    done[i] = 1;
    if (goals.has(i)) return { end: i, cost: cost[i], prev };
    const ix = i % n, iz = Math.floor(i / n);
    for (let d = 0; d < 8; d++) {
        const [dx, dz] = DIRS[d];
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
        const j = jz * n + jx;
        if (!nav.walk[j] || done[j]) continue;
        if (dx && dz && (!nav.walk[iz * n + jx] || !nav.walk[jz * n + ix])) continue; // no cutting corners
        if (!stepClear(nav, i, d, j)) continue;
        const c = cost[i] + (dx && dz ? DIAG : 1) * CELL;
        if (c < cost[j]) { cost[j] = c; prev[j] = i; heap.push(j, c + h(j)); }
      }
  }
  return null;
}

// The squares from the search start to `end`, as a smoothed list of points (a few straight legs), ending at `last`.
function toPoints(nav, prev, end, start, last) {
  const cells = [];
  for (let i = end; i !== -1; i = prev[i]) cells.push(i);
  cells.reverse();
  const pts = cells.map((i) => centre(nav, i));
  pts[pts.length - 1] = last;
  // keep only the corners: walk forward from each kept point as far as a straight line stays walkable
  const out = [];
  let anchor = start;
  for (let k = 0; k < pts.length; k++) {
    if (k + 1 < pts.length && segmentClear(nav, anchor, pts[k + 1])) continue;
    out.push(pts[k]); anchor = pts[k];
  }
  return out;
}

// A walking route from `from` to `to`: { pts, dist }, or null if there isn't one.
export function findPath(nav, from, to) {
  stats.searches++;
  const a = walkableNear(nav, from.x, from.z), b = walkableNear(nav, to.x, to.z);
  if (a < 0 || b < 0) return null;
  if (segmentClear(nav, from, to)) return { pts: [{ x: to.x, z: to.z }], dist: Math.hypot(to.x - from.x, to.z - from.z) };
  const r = search(nav, a, new Map([[b, true]]), b);
  return r ? { pts: toPoints(nav, r.prev, r.end, from, { x: to.x, z: to.z }), dist: r.cost } : null;
}

// The snowball pile nearest on foot, and the route to it: { ball, pts, dist }, or null.
export function nearestBallPath(nav, from, balls) {
  stats.searches++;
  const a = walkableNear(nav, from.x, from.z);
  if (a < 0 || !balls.length) return null;
  const goals = new Map();
  for (const b of balls) { const i = walkableNear(nav, b.x, b.z); if (i >= 0 && !goals.has(i)) goals.set(i, b); }
  const r = search(nav, a, goals, null);
  if (!r) return null;
  const ball = goals.get(r.end);
  return { ball, pts: toPoints(nav, r.prev, r.end, from, { x: ball.x, z: ball.z }), dist: r.cost };
}

// A walkable spot near (x, z), or null.
export function walkableSpot(nav, x, z) {
  const i = walkableNear(nav, x, z);
  return i < 0 ? null : centre(nav, i);
}
