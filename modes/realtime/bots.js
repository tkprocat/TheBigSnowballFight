// Realtime computer players. With no snowballs they run to the nearest one. Holding snowballs, they look for
// someone they can see within range, stop, wind up and throw, then move on for a bit. They move with the same
// moveStep as people and throw through the same throwBall (ammo and cooldown checks included).
import { TAU, lineBlocked, botLevel } from '../../public/shared/physics.js';
import { CARRY_MAX, RUN_SPEED, SPRINT_SPEED, moveStep, botAim } from '../../public/shared/realtimeRules.js';


function nearest(from, list) {
  let best = null, bd = Infinity;
  for (const o of list) { const d = Math.hypot(o.x - from.x, o.z - from.z); if (d < bd) { bd = d; best = o; } }
  return best ? { o: best, d: bd } : null;
}

// `game` is the realtime mode's helpers: { throwBall, rand }.
export function botStep(room, bot, dt, now, game) {
  const rng = game.rand, level = botLevel(room.botLevel);
  const ai = bot.ai || (bot.ai = { state: 'roam', t: rng() * 0.8, wp: null, target: null, stuck: 0, detour: 0 });
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
    ai.state = 'roam'; ai.t = 0.8 + rng() * 1.6; ai.wp = null;
    return;
  }

  // holding a snowball and ready: anyone in sight?
  if (bot.ammo > 0 && now >= bot.coolUntil && ai.t <= 0) {
    const seen = others.filter((o) => now >= o.shieldUntil && Math.hypot(o.x - bot.x, o.z - bot.z) < level.rtRange
      && !lineBlocked(bot, o, room.map, others.filter((q) => q !== o)));
    const n = nearest(bot, seen);
    if (n) { ai.state = 'aim'; ai.target = n.o.id; ai.t = level.rtWindup[0] + rng() * (level.rtWindup[1] - level.rtWindup[0]); bot.chargeAt = now; bot.vx = bot.vz = 0; return; }
  }

  // where to go: a snowball if we need one, else somewhere a little way from the nearest opponent
  let goal = null, sprint = false;
  const ball = nearest(bot, room.rt.balls);
  if (ai.detour > 0) { ai.detour -= dt; goal = ai.wp; }
  else if (ball && bot.ammo < CARRY_MAX && (bot.ammo === 0 || ball.d < 10)) { goal = ball.o; sprint = bot.ammo === 0 && ball.d > 6; } // empty-handed: sprint for one
  else {
    if (!ai.wp || Math.hypot(ai.wp.x - bot.x, ai.wp.z - bot.z) < 1 || ai.t < -4) {
      const foe = nearest(bot, others);
      const cx = foe ? foe.o.x : 0, cz = foe ? foe.o.z : 0, a = rng() * TAU, r = 8 + rng() * 6;
      ai.wp = { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r }; ai.t = 0;
    }
    goal = ai.wp;
  }
  if (!goal) return;
  const dx = goal.x - bot.x, dz = goal.z - bot.z, d = Math.hypot(dx, dz);
  if (d < 0.2) { bot.vx = bot.vz = 0; return; }
  const to = moveStep(bot, dx / d, dz / d, dt, room.map, others, sprint ? SPRINT_SPEED : RUN_SPEED);
  const moved = Math.hypot(to.x - bot.x, to.z - bot.z);
  bot.vx = dt > 0 ? (to.x - bot.x) / dt : 0; bot.vz = dt > 0 ? (to.z - bot.z) / dt : 0;
  bot.x = to.x; bot.z = to.z;
  if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) bot.yaw = Math.atan2(dx, dz);
  // stuck behind something: walk off sideways for a moment
  if (moved < 0.2 * dt) {
    ai.stuck += dt;
    if (ai.stuck > 0.4) {
      const a = Math.atan2(dx, dz) + (rng() < 0.5 ? 1 : -1) * (Math.PI / 2 + rng() * 0.6);
      ai.wp = { x: bot.x + Math.sin(a) * 4, z: bot.z + Math.cos(a) * 4 };
      ai.detour = 1 + rng(); ai.stuck = 0;
    }
  } else ai.stuck = 0;
}
