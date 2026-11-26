// Lobby: modes, spectators, and which actions each mode accepts. Run with: node --test
import test from 'node:test';
import assert from 'node:assert';
process.env.BOT_DELAY_MS = '0';
const { actions, rooms, findMember, viewFor } = await import('../server.js');
const { MAX_PLAYERS } = await import('../public/shared/physics.js');

const act = (name, code, token, body = {}) => {
  const { room, member } = findMember(code, token);
  return actions[name](body, room, member);
};
function lobby(n = 1) {
  const host = actions.create({ name: 'Host' });
  const others = [];
  for (let i = 1; i < n; i++) others.push(actions.join({ code: host.code, name: 'Friend ' + i }));
  return { host, others, room: rooms.get(host.code) };
}
const stop = (room) => { clearTimeout(room.clock); clearTimeout(room.botTimer); if (room.rt) clearInterval(room.rt.timer); };

test('the host picks the mode, in the lobby only', () => {
  const { host, others, room } = lobby(2);
  assert.strictEqual(room.mode, 'turn');
  assert.throws(() => act('setMode', host.code, others[0].token, { mode: 'realtime' }), /Only the host/);
  assert.throws(() => act('setMode', host.code, host.token, { mode: 'chaos' }), /Unknown mode/);
  assert.throws(() => act('setMode', host.code, host.token, { mode: 'toString' }), /Unknown mode/);
  act('setMode', host.code, host.token, { mode: 'realtime' });
  assert.strictEqual(viewFor(room, room.players[1]).mode, 'realtime');
  act('start', host.code, host.token);
  assert.throws(() => act('setMode', host.code, host.token, { mode: 'turn' }), /before the game starts/);
  stop(room);
});

test('the host can watch instead and still run the room; bots alone can play', () => {
  const { host, room } = lobby(1);
  act('spectate', host.code, host.token);
  assert.strictEqual(room.players.length, 0);
  assert.strictEqual(room.spectators.length, 1);
  const v = viewFor(room, room.spectators[0]);
  assert.ok(v.watching);
  assert.strictEqual(v.host, v.you);
  act('addBot', host.code, host.token);
  assert.throws(() => act('start', host.code, host.token), /at least 2/);
  act('addBot', host.code, host.token);
  act('start', host.code, host.token);
  assert.ok(room.started);
  assert.throws(() => act('spectate', host.code, host.token), /before the game starts/);
  // a spectator can't play
  assert.throws(() => act('throw', host.code, host.token, { yaw: 0, pitch: 0.5, power: 0.5 }), /watching/);
  act('say', host.code, host.token, { line: 0 }); // but can chat
  stop(room);
});

test('switching back to a seat, and a full room makes newcomers spectators', () => {
  const { host, room } = lobby(1);
  act('spectate', host.code, host.token);
  act('spectate', host.code, host.token);
  assert.ok(room.players.includes(room.host));
  for (let i = room.players.length; i < MAX_PLAYERS; i++) actions.join({ code: host.code, name: 'P' + i });
  const late = actions.join({ code: host.code, name: 'Late' });
  const { member } = findMember(host.code, late.token);
  assert.ok(room.spectators.includes(member));
  assert.throws(() => act('spectate', host.code, late.token), /All seats/);
});

test('each mode only accepts its own actions', () => {
  const turn = lobby(2);
  act('start', turn.host.code, turn.host.token);
  assert.throws(() => act('input', turn.host.code, turn.host.token, { x: 0, z: 0, yaw: 0, pitch: 0.5 }), /Not in this mode/);
  stop(turn.room);
  const rt = lobby(2);
  act('setMode', rt.host.code, rt.host.token, { mode: 'realtime' });
  act('start', rt.host.code, rt.host.token);
  assert.throws(() => act('pack', rt.host.code, rt.host.token), /Not in this mode/);
  assert.throws(() => act('move', rt.host.code, rt.host.token, { x: 0, z: 0 }), /Not in this mode/);
  stop(rt.room);
});

test('a realtime view carries the loose snowballs and ammo; no tokens anywhere', () => {
  const { host, room } = lobby(2);
  act('setMode', host.code, host.token, { mode: 'realtime' });
  act('start', host.code, host.token);
  const v = viewFor(room, room.players[1]);
  assert.ok(v.rt && Array.isArray(v.rt.b) && v.rt.b.length >= 3);
  assert.strictEqual(v.rt.p.length, 2);
  assert.strictEqual(v.players[0].ammo, 0);
  assert.ok(!JSON.stringify(v).includes(host.token));
  stop(room);
});

test('the host picks the bot level in the lobby; everyone sees it', () => {
  const { host, others, room } = lobby(2);
  assert.strictEqual(viewFor(room, room.players[1]).botLevel, 'normal');
  assert.throws(() => act('setBotLevel', host.code, others[0].token, { level: 'hard' }), /Only the host/);
  assert.throws(() => act('setBotLevel', host.code, host.token, { level: 'godlike' }), /Unknown bot level/);
  assert.throws(() => act('setBotLevel', host.code, host.token, { level: '__proto__' }), /Unknown bot level/);
  act('setBotLevel', host.code, host.token, { level: 'easy' });
  assert.strictEqual(viewFor(room, room.players[1]).botLevel, 'easy');
  act('start', host.code, host.token);
  assert.throws(() => act('setBotLevel', host.code, host.token, { level: 'hard' }), /before the game starts/);
  stop(room);
});

test('names are unique in a room; the host can add several bots at once', () => {
  const host = actions.create({ name: 'Frosty' });
  const room = rooms.get(host.code);
  actions.join({ code: host.code, name: 'Frosty' });
  actions.join({ code: host.code, name: 'Frosty' });
  assert.deepStrictEqual(room.players.map((p) => p.name), ['Frosty', 'Frosty 2', 'Frosty 3']);
  act('addBot', host.code, host.token, { count: 4 });
  assert.strictEqual(room.players.filter((p) => p.cpu).length, 4);
  assert.strictEqual(new Set(room.players.map((p) => p.name)).size, room.players.length, 'bots get unique names too');
  act('addBot', host.code, host.token, { count: 99 });
  assert.strictEqual(room.players.length, MAX_PLAYERS, 'stops at a full room');
  assert.throws(() => act('addBot', host.code, host.token, { count: 2 }), /full/);
});

test('everyone hears when someone joins or leaves, and who hosts after the host leaves', () => {
  const { host, others, room } = lobby(2);
  const res = { lines: [], write(x) { this.lines.push(x); }, end() {} };
  room.players[1].clients.add(res);
  actions.join({ code: host.code, name: 'Late' });
  assert.match(res.lines.join(''), /event: notice\ndata: \{"joined":"Late","watching":false\}/);
  act('leave', host.code, host.token);
  const last = res.lines.filter((l) => l.startsWith('event: notice')).pop();
  assert.match(last, /"left":"Host"/);
  assert.match(last, new RegExp('"host":"' + room.players[0].id + '"'));
  assert.strictEqual(room.host, room.players[0]);
  void others;
});

test('the host picks how to win in the lobby: first to N points or a time limit', () => {
  const { host, others, room } = lobby(2);
  assert.deepStrictEqual(viewFor(room, room.players[1]).win, { type: 'points', points: 10 });
  assert.throws(() => act('setWin', host.code, others[0].token, { type: 'time', minutes: 5 }), /Only the host/);
  assert.throws(() => act('setWin', host.code, host.token, { type: 'points', points: 7 }), /Unknown win/);
  assert.throws(() => act('setWin', host.code, host.token, { type: 'time', minutes: 999 }), /Unknown win/);
  assert.throws(() => act('setWin', host.code, host.token, { type: 'sudden' }), /Unknown win/);
  act('setWin', host.code, host.token, { type: 'time', minutes: 3 });
  act('start', host.code, host.token);
  const v = viewFor(room, room.players[1]);
  assert.deepStrictEqual(v.win, { type: 'time', minutes: 3 });
  assert.ok(v.timeLeft > 170000 && v.timeLeft <= 180000, 'the clock is running');
  assert.throws(() => act('setWin', host.code, host.token, { type: 'points', points: 5 }), /before the game starts/);
  stop(room);
});
