// Realtime computer players. With no snowballs they run to the nearest one on foot (routes from nav.js, so they
// walk round walls and through fort gates). Holding snowballs, they look for someone they can see within range,
// stop, wind up and throw, then move on for a bit. They move with the same moveStep as people and throw through
// the same throwBall (ammo and cooldown checks included).
import { TAU, lineBlocked, botLevel } from '../../public/shared/physics.js';
import { CARRY_MAX, RUN_SPEED, SPRINT_SPEED, moveStep, botAim } from '../../public/shared/realtimeRules.js';
import { navFor, findPath, nearestBallPath, walkableSpot } from './nav.js';

const REPLAN_MS = 1500; // look for a better snowball or route this often
export const PLANS_PER_TICK = 4; // at most this many bots plan a route in one server tick, so 16 bots planning at
                                 // once (e.g. at GO) can't make one tick slow; the rest plan in the next ticks

function nearest(from, list) {
  let best = null, bd = Infinity;
  for (const o of list) { const d = Math.hypot(o.x - from.x, o.z - from.z); if (d < bd) { bd = d; best = o; } }
  return best ? { o: best, d: bd } : null;
}

// `game` is the realtime mode's helpers: { throwBall, rand }.
export function botStep(room, bot, dt, now, game) {
  const rng = game.rand, level = botLevel(room.botLevel);
  const ai = bot.ai || (bot.ai = { state: 'roam', t: rng() * 0.8, wp: null, plan: null, target: null, stuck: 0, fails: 0, detour: 0 });
  ai.t -= dt;
  const others = room.players.filter((o) => o !== bot);

  if (ai.state === 'aim') {
    const target = others.find((o) => o.id === ai.target);
    bot.vx = bot.vz = 0;
    if (!target || bot.ammo <= 0 || now < target.shieldUntil) { ai.state = 'roam'; bot.chargeAt = 0; return; }
    bot.yaw = Math.atan2(target.x - bot.x, target.z - bot.z);
    if (ai.t > 0) return;
    const plan = botAim(bot, target, room.map, rng, level.rtError, level.rtFineTune);
    try { game.throwBall(room, bot, (plan.yaw % TAU + TAU) % TAU, plan.pitch, now); } catch { /* out of snowballs or too soon */ }
    bot.chargeAt = 0;
    ai.state = 'roam'; ai.t = 0.8 + rng() * 1.6; ai.plan = null;
    return;
  }

  // holding a snowball and ready: anyone in sight?
  if (bot.ammo > 0 && now >= bot.coolUntil && ai.t <= 0) {
    const seen = others.filter((o) => now >= o.shieldUntil && Math.hypot(o.x - bot.x, o.z - bot.z) < level.rtRange
      && !lineBlocked(bot, o, room.map, others.filter((q) => q !== o)));
    const n = nearest(bot, seen);
    if (n) { ai.state = 'aim'; ai.target = n.o.id; ai.t = level.rtWindup[0] + rng() * (level.rtWindup[1] - level.rtWindup[0]); bot.chargeAt = now; bot.vx = bot.vz = 0; return; }
  }

  // Where to go: a snowball if we need one (the nearest on foot), else somewhere a little way from the nearest
  // opponent. Routes come from the path finder (nav.js), so bots walk round walls and through fort gates.
  const nav = navFor(room);
  const planOk = (pl) => pl && (pl.kind !== 'ball' || room.rt.balls.some((b) => b.id === pl.id));
  if (ai.detour > 0) ai.detour -= dt;
  else {
    const canPlan = room.rt.plansLeft == null || room.rt.plansLeft > 0;
    if (!planOk(ai.plan)) ai.plan = null;
    else if (canPlan && now - ai.plan.at > REPLAN_MS) ai.plan = null;
    if (canPlan && !ai.plan && room.rt.plansLeft != null) room.rt.plansLeft--;
    if (canPlan && bot.ammo < CARRY_MAX && (!ai.plan || ai.plan.kind !== 'ball')) {
      const r = nearestBallPath(nav, bot, room.rt.balls);
      if (r && (bot.ammo === 0 || r.dist < 10)) ai.plan = { kind: 'ball', id: r.ball.id, pts: r.pts, dist: r.dist, at: now };
    }
    if (canPlan && !ai.plan) {
      const foe = nearest(bot, others);
      const cx = foe ? foe.o.x : 0, cz = foe ? foe.o.z : 0, a = rng() * TAU, r = 8 + rng() * 6;
      const spot = walkableSpot(nav, cx + Math.cos(a) * r, cz + Math.sin(a) * r);
      const route = spot && findPath(nav, bot, spot);
      ai.plan = route ? { kind: 'roam', pts: route.pts, dist: route.dist, at: now } : null;
    }
  }
  // the next point on the route (a detour overrides it for a moment)
  let goal = ai.detour > 0 ? ai.wp : null;
  if (!goal && ai.plan) {
    const pts = ai.plan.pts;
    while (pts.length > 1 && Math.hypot(pts[0].x - bot.x, pts[0].z - bot.z) < 0.7) pts.shift();
    goal = pts[0];
    if (pts.length === 1 && ai.plan.kind === 'roam' && Math.hypot(goal.x - bot.x, goal.z - bot.z) < 1) ai.plan = null; // got there
  }
  if (!goal) { bot.vx = bot.vz = 0; return; }
  const left = ai.plan && ai.plan.kind === 'ball' ? routeLeft(bot, ai.plan.pts) : 0;
  const sprint = !!ai.plan && ai.plan.kind === 'ball' && bot.ammo === 0 && left > 6 && !(ai.detour > 0); // empty-handed: sprint for one
  const dx = goal.x - bot.x, dz = goal.z - bot.z, d = Math.hypot(dx, dz);
  if (d < 0.2) { bot.vx = bot.vz = 0; return; }
  const to = moveStep(bot, dx / d, dz / d, dt, room.map, others, sprint ? SPRINT_SPEED : RUN_SPEED);
  const moved = Math.hypot(to.x - bot.x, to.z - bot.z);
  bot.vx = dt > 0 ? (to.x - bot.x) / dt : 0; bot.vz = dt > 0 ? (to.z - bot.z) / dt : 0;
  bot.x = to.x; bot.z = to.z;
  if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) bot.yaw = Math.atan2(dx, dz);
  // Stuck (usually on another player): plan a fresh route; if that keeps failing, step aside for a moment.
  if (moved < 0.2 * dt) {
    ai.stuck += dt;
    if (ai.stuck > 0.5) {
      ai.stuck = 0; ai.fails = (ai.fails || 0) + 1; ai.plan = null;
      if (ai.fails >= 2) {
        const a = Math.atan2(dx, dz) + (rng() < 0.5 ? 1 : -1) * (Math.PI / 2 + rng() * 0.6);
        ai.wp = walkableSpot(nav, bot.x + Math.sin(a) * 3, bot.z + Math.cos(a) * 3);
        ai.detour = ai.wp ? 0.6 + rng() * 0.6 : 0; ai.fails = 0;
      }
    }
  } else { ai.stuck = 0; if (moved > 0.5 * RUN_SPEED * dt) ai.fails = 0; }
}

// How far is left along a route from where the bot stands.
function routeLeft(bot, pts) {
  let d = 0, x = bot.x, z = bot.z;
  for (const p of pts) { d += Math.hypot(p.x - x, p.z - z); x = p.x; z = p.z; }
  return d;
}
