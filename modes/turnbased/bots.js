// Turn-based computer players: walk to cover from the next thrower, then aim and throw (or now and then pack).
import { windFor, planThrow, chooseCover, botLevel } from '../../public/shared/physics.js';
import { rand, later } from '../../rooms.js';

// `game` is the turn-based mode's own helpers: { curPlayer, nextPlayer, doThrow, doPack, broadcast, broadcastEvent }.
export function botTurn(room, bot, game) {
  if (game.curPlayer(room) !== bot || room.over) return;
  const spot = chooseCover(bot, game.nextPlayer(room), room.map, room.players, rand);
  bot.x = +spot.x.toFixed(3); bot.z = +spot.z.toFixed(3);
  room.phase = 'aim';
  game.broadcast(room);
  room.botTimer = later(900, `Bot ${bot.name} in room ${room.code}`, () => botAim(room, bot, game));
}

function botAim(room, bot, game) {
  if (game.curPlayer(room) !== bot || room.over) return;
  // now and then a bot packs a heavier snowball instead of throwing
  const level = botLevel(room.botLevel);
  if ((bot.heavy || 1) === 1 && rand() < level.packChance) { game.doPack(room, bot); game.broadcast(room); return; }
  const plan = planThrow(bot, room.players.filter((o) => o !== bot), windFor(room.seed, room.turn), room.map, rand, level.turnError, bot.heavy || 1);
  bot.yaw = plan.yaw; bot.pitch = plan.pitch;
  game.broadcastEvent(room, 'aim', { id: bot.id, yaw: bot.yaw, pitch: bot.pitch });
  room.botTimer = later(1300, `Bot ${bot.name} in room ${room.code}`, () => {
    if (game.curPlayer(room) === bot && !room.over) { game.doThrow(room, bot, plan.yaw, plan.pitch, plan.power); game.broadcast(room); }
  });
}
